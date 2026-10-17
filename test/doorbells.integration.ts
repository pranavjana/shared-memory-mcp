import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { connectMemoryStore, type Actor } from "../src/memory.js";
import { DoorbellService } from "../src/doorbells.js";

const sender: Actor = {
  userId: "bell-sender",
  name: "Pranav",
  clientId: "dot",
  email: "bell-sender@example.com",
};
const receiver: Actor = {
  userId: "bell-receiver",
  name: "Afshal",
  clientId: "grok",
  email: "bell-receiver@example.com",
};
const outsider: Actor = { userId: "bell-outsider", clientId: "grok" };
const note = (text: string, key: string) => ({
  text,
  evidence: text,
  kind: "fact",
  basis: "user_statement",
  entities: [],
  idempotencyKey: "doorbell-test-" + key,
});

test("Grok doorbells ring once per batch with content-free payloads, retry transient failures and stop on auth errors", async () => {
  const s = await connectMemoryStore({
    FALKORDB_HOST: process.env.FALKORDB_TEST_HOST ?? "127.0.0.1",
    FALKORDB_PORT: process.env.FALKORDB_TEST_PORT ?? "16379",
    FALKORDB_PASSWORD: process.env.FALKORDB_TEST_PASSWORD ?? "local-verification",
    FALKORDB_MEMORY_GRAPH: "doorbell_verification_" + randomUUID().replaceAll("-", ""),
  });
  const sent: { url: string; body: any; headers: Record<string, string> }[] = [];
  let reply = 202;
  const bells = new DoorbellService(
    s,
    randomBytes(32).toString("base64"),
    "https://memory.example.com",
    async (url, body, headers) => {
      sent.push({ url, body: JSON.parse(body), headers });
      if (reply === 0) throw new Error("network down");
      return { status: reply, body: "" };
    },
  );
  let ringing: Promise<void> | undefined;
  const stop = s.onChange(() => {
    ringing = bells.ring();
  });
  try {
    const space = await s.createSpace(sender, "Apollo");
    await s.accept(
      receiver,
      (await s.invite(sender, space.id, receiver.email!, "reader")).token,
    );
    // These tests cover delivery mechanics, so every update is instant here.
    await s.setPreferences(receiver, { mode: "all" });
    await assert.rejects(
      bells.add(receiver, { kind: "grok_webhook", url: "http://hooks.example.com/x", authorization: "Bearer crsr_abcdefgh" }),
      /HTTPS/,
    );
    const bell = await bells.add(receiver, {
      kind: "grok_webhook",
      url: "https://hooks.example.com/routine/1",
      authorization: "Authorization: Bearer crsr_abcdefgh",
      label: "My Grok Bot",
    });
    assert.equal(bell.host, "hooks.example.com");
    assert.ok(!JSON.stringify(bell).includes("crsr_abcdefgh"));
    assert.ok(!JSON.stringify(await bells.list(receiver)).includes("crsr_abcdefgh"));
    const stored = await s.query<{ auth: string }>(
      "MATCH (b:Doorbell {id:$id}) RETURN b.authorization AS auth",
      { id: bell.id },
      true,
    );
    assert.ok(!stored[0].auth.includes("crsr_abcdefgh"), "Stored encrypted");
    await bells.add(sender, {
      kind: "grok_webhook",
      url: "https://hooks.example.com/routine/sender",
      authorization: "Bearer crsr_sender00",
    });
    await bells.add(outsider, {
      kind: "grok_webhook",
      url: "https://hooks.example.com/routine/outsider",
      authorization: "Bearer crsr_outsider",
    });

    // Test button.
    const tested = await bells.test(receiver, bell.id);
    assert.equal(tested.ok, true);
    assert.equal(sent.at(-1)!.body.type, "shared_memory.test");
    assert.equal(sent.at(-1)!.headers.Authorization, "Bearer crsr_abcdefgh");
    await assert.rejects(bells.test(outsider, bell.id), /not found/);
    sent.length = 0;

    // A share rings the receiver immediately; the author and outsiders are not rung.
    const m = (await s.remember(sender, note("Launch moved to Nov 20. PRIVATE detail.", "bell-1"))).memory;
    await s.share(sender, m.id, space.id, true, "bell-share-1");
    await ringing;
    assert.equal(sent.length, 1);
    const ring = sent[0];
    assert.equal(ring.url, "https://hooks.example.com/routine/1");
    assert.equal(ring.headers.Authorization, "Bearer crsr_abcdefgh");
    assert.equal(ring.body.type, "shared_memory.updates");
    assert.equal(ring.body.updates.length, 1);
    assert.equal(ring.body.updates[0].actorName, "Pranav");
    assert.equal(ring.body.updates[0].spaceName, "Apollo");
    assert.equal(ring.body.readWith, "check_inbox");
    assert.match(ring.body.summary, /Pranav/);
    assert.ok(!JSON.stringify(ring.body).includes("PRIVATE"), "No memory content in the doorbell");
    assert.ok(!JSON.stringify(ring.body).includes(m.id), "No memory ID in the doorbell");
    assert.equal(ring.headers["Idempotency-Key"], ring.body.id);
    await bells.ring();
    assert.equal(sent.length, 1, "A delivered ring is not repeated");

    // Several updates before a pass coalesce into one ring.
    stop();
    const a = (await s.remember(sender, note("Budget approved", "bell-2"))).memory;
    const b = (await s.remember(sender, note("Design done", "bell-3"))).memory;
    await s.share(sender, a.id, space.id, true, "bell-share-2");
    await s.share(sender, b.id, space.id, true, "bell-share-3");
    await bells.ring();
    assert.equal(sent.length, 2);
    assert.equal(sent[1].body.updates.length, 2);

    // A retracted share never rings.
    const c = (await s.remember(sender, note("Draft idea", "bell-4"))).memory;
    await s.share(sender, c.id, space.id, true, "bell-share-4");
    await s.share(sender, c.id, space.id, false, "bell-retract-4");
    await bells.ring();
    assert.equal(sent.length, 2);

    // Transient failures retry with the same batch ID; success stops retries.
    reply = 503;
    const d = (await s.remember(sender, note("Hiring freeze", "bell-5"))).memory;
    await s.share(sender, d.id, space.id, true, "bell-share-5");
    await bells.ring();
    assert.equal(sent.length, 3);
    await bells.ring();
    assert.equal(sent.length, 3, "Backoff delays the retry");
    await s.query("MATCH (r:DoorbellRing) WHERE r.status='retry' SET r.nextAt=0");
    reply = 0;
    await bells.ring();
    assert.equal(sent.length, 4, "A network error is also retried");
    await s.query("MATCH (r:DoorbellRing) WHERE r.status='retry' SET r.nextAt=0");
    reply = 202;
    await bells.ring();
    assert.equal(sent.length, 5);
    assert.equal(sent[4].body.id, sent[2].body.id, "Retries keep the batch ID");
    await bells.ring();
    assert.equal(sent.length, 5);

    // An auth failure stops retrying and flags the doorbell for the owner.
    reply = 401;
    const e = (await s.remember(sender, note("Offsite booked", "bell-6"))).memory;
    await s.share(sender, e.id, space.id, true, "bell-share-6");
    await bells.ring();
    await s.query("MATCH (r:DoorbellRing) SET r.nextAt=0");
    await bells.ring();
    assert.equal(sent.length, 6, "A rejected key is not retried");
    const [flagged] = await bells.list(receiver);
    assert.equal(flagged.needsAttention, true);
    assert.equal(flagged.lastStatus, 401);

    // Removing a doorbell stops it and erases its secret.
    reply = 202;
    assert.deepEqual(await bells.remove(receiver, bell.id), { removed: true });
    assert.deepEqual(await bells.list(receiver), []);
    const erased = await s.query<{ auth: string | null }>(
      "MATCH (b:Doorbell {id:$id}) RETURN b.authorization AS auth",
      { id: bell.id },
      true,
    );
    assert.equal(erased[0].auth, null);
    const f = (await s.remember(sender, note("After removal", "bell-7"))).memory;
    await s.share(sender, f.id, space.id, true, "bell-share-7");
    await bells.ring();
    assert.equal(sent.length, 6);
    assert.deepEqual(await bells.remove(outsider, bell.id), { removed: false });
  } finally {
    stop();
    await s.graph.delete();
    await s.close();
  }
});

test("a doorbell only rings for updates after it was added and while the owner is a member", async () => {
  const s = await connectMemoryStore({
    FALKORDB_HOST: process.env.FALKORDB_TEST_HOST ?? "127.0.0.1",
    FALKORDB_PORT: process.env.FALKORDB_TEST_PORT ?? "16379",
    FALKORDB_PASSWORD: process.env.FALKORDB_TEST_PASSWORD ?? "local-verification",
    FALKORDB_MEMORY_GRAPH: "doorbell_scope_" + randomUUID().replaceAll("-", ""),
  });
  const sent: any[] = [];
  const bells = new DoorbellService(
    s,
    randomBytes(32).toString("base64"),
    "https://memory.example.com",
    async (_url, body) => {
      sent.push(JSON.parse(body));
      return { status: 200, body: "" };
    },
  );
  try {
    const space = await s.createSpace(sender, "Scope");
    await s.accept(
      receiver,
      (await s.invite(sender, space.id, receiver.email!, "reader")).token,
    );
    const old = (await s.remember(sender, note("Before the doorbell", "scope-1"))).memory;
    await s.share(sender, old.id, space.id, true, "scope-share-1");
    await new Promise((r) => setTimeout(r, 5));
    await bells.add(receiver, {
      kind: "grok_webhook",
      url: "https://hooks.example.com/routine/2",
      authorization: "Bearer crsr_scope000",
    });
    await bells.ring();
    assert.equal(sent.length, 0, "Earlier activity does not ring a new doorbell");
    await s.revoke(sender, space.id, receiver.userId);
    const later = (await s.remember(sender, note("After revocation", "scope-2"))).memory;
    await s.share(sender, later.id, space.id, true, "scope-share-2");
    await bells.ring();
    assert.equal(sent.length, 0, "A revoked member's doorbell does not ring");
  } finally {
    await s.graph.delete();
    await s.close();
  }
});
