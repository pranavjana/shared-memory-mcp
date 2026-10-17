import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectMemoryStore, type Actor } from "../src/memory.js";
import { PulseService } from "../src/pulse.js";

const sender: Actor = {
  userId: "pulse-sender",
  name: "Pranav",
  clientId: "dot",
  email: "pulse-sender@example.com",
};
const receiver: Actor = {
  userId: "pulse-receiver",
  name: "Afshal",
  clientId: "muse",
  email: "pulse-receiver@example.com",
};
const note = (text: string, key: string) => ({
  text,
  evidence: text,
  kind: "fact",
  basis: "user_statement",
  entities: [],
  idempotencyKey: "pulse-test-" + key,
});

test("a pulse link exposes only an unread counter that changes with new updates", async () => {
  const s = await connectMemoryStore({
    FALKORDB_HOST: process.env.FALKORDB_TEST_HOST ?? "127.0.0.1",
    FALKORDB_PORT: process.env.FALKORDB_TEST_PORT ?? "16379",
    FALKORDB_PASSWORD: process.env.FALKORDB_TEST_PASSWORD ?? "local-verification",
    FALKORDB_MEMORY_GRAPH: "pulse_verification_" + randomUUID().replaceAll("-", ""),
  });
  const pulse = new PulseService(s, "https://memory.example.com");
  try {
    const space = await s.createSpace(sender, "Apollo");
    await s.accept(
      receiver,
      (await s.invite(sender, space.id, receiver.email!, "reader")).token,
    );
    // These tests cover delivery mechanics, so every update is instant here.
    await s.setPreferences(receiver, { mode: "all" });
    const link = await pulse.create(receiver);
    assert.match(link.url, /^https:\/\/memory\.example\.com\/pulse\/smp_[A-Za-z0-9_-]{43}$/);
    const token = link.url.split("/pulse/")[1];
    const stored = await s.query<{ value: Record<string, unknown> }>(
      "MATCH (l:PulseLink {id:$id}) RETURN properties(l) AS value",
      { id: link.id },
      true,
    );
    assert.ok(!JSON.stringify(stored).includes(token), "Only a hash of the token is stored");
    assert.ok(!JSON.stringify(await pulse.list(receiver)).includes(token));

    const empty = await pulse.read(token);
    assert.deepEqual(empty, { unread: 0, version: "0" });

    const m = (await s.remember(sender, note("Launch moved. PRIVATE detail.", "one"))).memory;
    await s.share(sender, m.id, space.id, true, "pulse-share-1");
    const first = await pulse.read(token);
    assert.equal(first!.unread, 1);
    assert.notEqual(first!.version, "0");
    assert.deepEqual(Object.keys(first!).sort(), ["unread", "version"], "No content, IDs or names");
    assert.deepEqual(await pulse.read(token), first, "Stable until something changes");
    const [listed] = await pulse.list(receiver);
    assert.ok(listed.lastUsedAt, "Reads are visible to the owner");

    const m2 = (await s.remember(sender, note("Budget approved", "two"))).memory;
    await s.share(sender, m2.id, space.id, true, "pulse-share-2");
    const second = await pulse.read(token);
    assert.equal(second!.unread, 2);
    assert.notEqual(second!.version, first!.version);

    await s.markInboxSeen(receiver, { all: true });
    assert.deepEqual(await pulse.read(token), { unread: 0, version: "0" });

    // Malformed, unknown and revoked tokens read nothing.
    assert.equal(await pulse.read("nope"), undefined);
    assert.equal(await pulse.read("smp_" + "A".repeat(43)), undefined);
    assert.deepEqual(await pulse.revoke(sender, link.id), { revoked: false }, "Only the owner can revoke");
    assert.deepEqual(await pulse.revoke(receiver, link.id), { revoked: true });
    assert.equal(await pulse.read(token), undefined);
    assert.deepEqual(await pulse.list(receiver), []);

    // At most three live links; a fourth retires the oldest.
    const links = [];
    for (let i = 0; i < 4; i++) links.push(await pulse.create(receiver));
    const live = await pulse.list(receiver);
    assert.equal(live.length, 3);
    assert.ok(!live.some((l) => l.id === links[0].id));
    assert.equal(await pulse.read(links[0].url.split("/pulse/")[1]), undefined);
    assert.ok(await pulse.read(links[3].url.split("/pulse/")[1]));
  } finally {
    await s.graph.delete();
    await s.close();
  }
});
