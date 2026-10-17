import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { connectMemoryStore, type Actor } from "../src/memory.js";
import { DoorbellService } from "../src/doorbells.js";
import { PulseService } from "../src/pulse.js";
import { lastDigestAt } from "../src/preferences.js";

const pranav: Actor = { userId: "ay-pranav", name: "Pranav Jana", clientId: "dot", email: "ay-pranav@example.com" };
const roshan: Actor = { userId: "ay-roshan", name: "Roshan K", clientId: "grok", email: "ay-roshan@example.com" };
const afshal: Actor = { userId: "ay-afshal", name: "Afshal Gulam", clientId: "muse", email: "ay-afshal@example.com" };
const outsider: Actor = { userId: "ay-outsider", name: "Out Sider", clientId: "x", email: "ay-out@example.com" };
const note = (text: string, key: string) => ({
  text,
  evidence: text,
  kind: "fact",
  basis: "user_statement",
  entities: [],
  idempotencyKey: "about-you-" + key,
});

test("updates that name the reader are flagged, ranked first, confirmable and due immediately", async () => {
  const s = await connectMemoryStore({
    FALKORDB_HOST: process.env.FALKORDB_TEST_HOST ?? "127.0.0.1",
    FALKORDB_PORT: process.env.FALKORDB_TEST_PORT ?? "16379",
    FALKORDB_PASSWORD: process.env.FALKORDB_TEST_PASSWORD ?? "local-verification",
    FALKORDB_MEMORY_GRAPH: "about_you_" + randomUUID().replaceAll("-", ""),
  });
  const sent: any[] = [];
  const bells = new DoorbellService(s, randomBytes(32).toString("base64"), "https://m.example.com", async (_u, body) => {
    sent.push(JSON.parse(body));
    return { status: 200, body: "" };
  });
  const pulse = new PulseService(s, "https://m.example.com");
  try {
    const space = await s.createSpace(pranav, "Apollo");
    for (const member of [afshal, roshan])
      await s.accept(member, (await s.invite(pranav, space.id, member.email!, "contributor")).token);
    const token = (await pulse.create(afshal)).url.split("/pulse/")[1];
    await bells.add(afshal, { kind: "grok_webhook", url: "https://hooks.example.com/a", authorization: "Bearer crsr_afshal00" });
    const share = async (actor: Actor, text: string, key: string) => {
      const m = (await s.remember(actor, note(text, key))).memory;
      await s.share(actor, m.id, space.id, true, "share-" + key);
      return m;
    };

    // Not about Afshal: unread, but held for the digest under the default preferences.
    await share(pranav, "Budget approved for Q4", "plain");
    let box = await s.inbox(afshal);
    assert.equal(box.items[0].aboutYou, null);
    assert.equal(box.items[0].dueNow, false);
    assert.deepEqual(await pulse.read(token), { unread: 1, version: "0" });
    await bells.ring();
    assert.equal(sent.length, 0, "A non-urgent update waits for the digest");

    // Names are matched as whole words, case-insensitively.
    await share(pranav, "Afshalx is a different account", "near-miss");
    await share(pranav, "afshal is leading the launch", "mention");
    box = await s.inbox(afshal);
    const mention = box.items[0];
    assert.deepEqual(mention.aboutYou, { status: "possible", name: "Afshal" });
    assert.equal(mention.dueNow, true);
    assert.ok(box.items.slice(1).every((i) => i.aboutYou === null), "Mentions rank first; near-misses don't count");
    assert.notEqual((await pulse.read(token))!.version, "0", "The pulse moves for an update about the member");
    await bells.ring();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].updates.length, 1, "Only the due update rings");
    assert.equal(sent[0].updates[0].aboutYou, true);

    // The digest releases held updates.
    const prefs = await s.preferences(afshal);
    // Simulate time passing: the updates, Afshal's membership and the doorbell all
    // predate the most recent digest boundary.
    const before = lastDigestAt(prefs, Date.now()) - 60_000;
    await s.query("MATCH (c:Change) WHERE c.actorId=$a SET c.createdAt=$t", { a: pranav.userId, t: before });
    await s.query("MATCH (:Person {id:$u})-[m:MEMBER_OF]->() SET m.joinedAt=$t", { u: afshal.userId, t: before - 60_000 });
    await s.query("MATCH (b:Doorbell) WHERE b.owner=$u SET b.createdAt=$t", { u: afshal.userId, t: before - 60_000 });
    await bells.ring();
    assert.equal(sent.length, 2);
    assert.equal(sent[1].updates.length, 2, "The two held updates arrive together at digest time");

    // Confirming a nickname makes that author's future uses count as about Afshal.
    await assert.rejects(s.confirmIdentity(outsider, { changeId: mention.changeId, name: "Afshal", isMe: true }), /not found/);
    await s.confirmIdentity(afshal, { changeId: mention.changeId, name: "Afshal", isMe: true });
    assert.equal((await s.inbox(afshal)).items[0].aboutYou?.status, "confirmed");
    const nickname = await share(pranav, "Kutti chellam boy finished the deck", "nickname");
    box = await s.inbox(afshal);
    const nick = box.items.find((i) => (i.update as any).memory?.id === nickname.id)!;
    assert.equal(nick.aboutYou, null);
    await s.confirmIdentity(afshal, { changeId: nick.changeId, name: "Kutti chellam boy", isMe: true });
    box = await s.inbox(afshal);
    assert.deepEqual(box.items.find((i) => i.changeId === nick.changeId)!.aboutYou, {
      status: "confirmed",
      name: "Kutti chellam boy",
    });
    const fromRoshan = await share(roshan, "kutti chellam boy is a band name", "other-author");
    box = await s.inbox(afshal);
    assert.equal(
      box.items.find((i) => (i.update as any).memory?.id === fromRoshan.id)!.aboutYou,
      null,
      "A confirmation applies only to the author whose notes used the name",
    );

    // "Not me" suppresses that name from that author.
    const other = await share(roshan, "Afshal from accounting called", "not-me");
    box = await s.inbox(afshal);
    const otherItem = box.items.find((i) => (i.update as any).memory?.id === other.id)!;
    assert.equal(otherItem.aboutYou?.status, "possible");
    await s.confirmIdentity(afshal, { changeId: otherItem.changeId, name: "Afshal", isMe: false });
    box = await s.inbox(afshal);
    assert.equal(box.items.find((i) => i.changeId === otherItem.changeId)!.aboutYou, null);
    assert.ok(
      box.items.some((i) => i.aboutYou?.status === "confirmed" && i.aboutYou.name === "Afshal"),
      "Pranav's mentions stay confirmed",
    );

    // Quiet hours hold even updates about the member; "all" makes everything instant.
    const hour = new Date().getUTCHours();
    await s.setPreferences(afshal, { timezone: "UTC", quietStart: hour, quietEnd: (hour + 1) % 24 });
    assert.ok((await s.inbox(afshal)).items.every((i) => !i.dueNow));
    await s.setPreferences(afshal, { mode: "all", timezone: "UTC" });
    assert.ok((await s.inbox(afshal)).items.every((i) => i.dueNow));
    await assert.rejects(Promise.resolve().then(() => s.setPreferences(afshal, { timezone: "Nowhere/Land" })));
  } finally {
    await s.graph.delete();
    await s.close();
  }
});
