import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { connectMemoryStore, type Actor } from "../src/memory.js";
import { KnowledgeStore } from "../src/knowledge.js";
import { EventService } from "../src/events.js";
import { memoryTools, runToolWithInbox } from "../src/tools.js";

const sender: Actor = {
  userId: "inbox-sender",
  name: "Sender",
  clientId: "sender-agent",
  email: "inbox-sender@example.com",
};
const receiver: Actor = {
  userId: "inbox-receiver",
  name: "Receiver",
  clientId: "receiver-agent",
  email: "inbox-receiver@example.com",
};
const late: Actor = {
  userId: "inbox-late",
  name: "Late",
  clientId: "late-agent",
  email: "inbox-late@example.com",
};
const outsider: Actor = { userId: "inbox-outsider", clientId: "outsider-agent" };

const connect = () =>
  connectMemoryStore({
    FALKORDB_HOST: process.env.FALKORDB_TEST_HOST ?? "127.0.0.1",
    FALKORDB_PORT: process.env.FALKORDB_TEST_PORT ?? "16379",
    FALKORDB_PASSWORD: process.env.FALKORDB_TEST_PASSWORD ?? "local-verification",
    FALKORDB_MEMORY_GRAPH:
      "inbox_verification_" + randomUUID().replaceAll("-", ""),
  });

const note = (text: string, key: string) => ({
  text,
  evidence: text,
  kind: "fact",
  basis: "user_statement",
  entities: [],
  idempotencyKey: key,
});

test("inbox lists other members' current shared updates, scoped, deduplicated and marked seen", async () => {
  const s = await connect();
  const k = new KnowledgeStore(s);
  try {
    const space = await s.createSpace(sender, "Apollo");
    await s.accept(
      receiver,
      (await s.invite(sender, space.id, receiver.email!, "reader")).token,
    );
    const empty = await s.inbox(receiver);
    assert.deepEqual(empty, { unread: 0, items: [] });

    const early = (await s.remember(sender, note("Kickoff is Monday", "inbox-early"))).memory;
    await s.share(sender, early.id, space.id, true, "inbox-early-share");
    const privateNote = (await s.remember(sender, note("PRIVATE salary detail", "inbox-private"))).memory;

    // A member who joins later does not inherit earlier activity.
    await s.accept(
      late,
      (await s.invite(sender, space.id, late.email!, "reader")).token,
    );
    assert.equal((await s.inbox(late)).unread, 0);

    let box = await s.inbox(receiver);
    assert.equal(box.unread, 1);
    assert.equal(box.items.length, 1);
    const [item] = box.items;
    assert.equal(item.kind, "shared");
    assert.equal(item.spaceId, space.id);
    assert.equal(item.spaceName, "Apollo");
    assert.equal(item.actorName, "Sender");
    assert.equal(item.seen, false);
    assert.equal(item.update.type, "memory");
    assert.equal((item.update as any).memory.text, "Kickoff is Monday");
    assert.ok(!JSON.stringify(box).includes("PRIVATE"));
    assert.ok(!JSON.stringify(box).includes(privateNote.id));

    // Authors never see their own activity; outsiders see nothing.
    assert.equal((await s.inbox(sender)).unread, 0);
    assert.deepEqual(await s.inbox(outsider), { unread: 0, items: [] });

    // A revision replaces the earlier entry instead of adding a second one.
    await s.revise(sender, early.id, 1, note("Kickoff moved to Tuesday", "inbox-early-r2"));
    box = await s.inbox(receiver);
    assert.equal(box.unread, 1);
    assert.equal(box.items.length, 1);
    assert.equal(box.items[0].kind, "revised");
    assert.equal((box.items[0].update as any).memory.text, "Kickoff moved to Tuesday");
    assert.equal((await s.inbox(late)).unread, 1, "Changes after joining are visible");

    // Marking seen is per reader and per change.
    const marked = await s.markInboxSeen(receiver, {
      changeIds: [box.items[0].changeId],
    });
    assert.equal(marked.unread, 0);
    assert.deepEqual((await s.inbox(receiver)).items, []);
    const withSeen = await s.inbox(receiver, { includeSeen: true });
    assert.equal(withSeen.items.length, 1);
    assert.equal(withSeen.items[0].seen, true);
    assert.equal((await s.inbox(late)).unread, 1, "Another reader is unaffected");
    await assert.rejects(s.markInboxSeen(receiver, {}), /changeIds or all/);

    // A further revision is new information again.
    await s.revise(sender, early.id, 2, note("Kickoff moved to Wednesday", "inbox-early-r3"));
    assert.equal((await s.inbox(receiver)).unread, 1);

    // Selected-claim publications appear with only their frozen snapshot.
    const source = (
      await s.remember(sender, note("Project Atlas is in progress. PRIVATE context.", "inbox-source"))
    ).memory;
    const batch = await k.record(sender, {
      sourceMemoryId: source.id,
      sourceRevision: 1,
      idempotencyKey: "inbox-claims-001",
      entities: [{ key: "atlas", type: "project", name: "Atlas" }],
      claims: [
        {
          subject: "atlas",
          predicate: "HAS_STATUS",
          value: "in_progress",
          basis: "explicit",
          evidence: "Project Atlas is in progress.",
        },
      ],
    });
    const publication = await k.publish(sender, {
      claimId: batch.claimIds[0],
      spaceId: space.id,
      enabled: true,
      userRequested: true,
      idempotencyKey: "inbox-publication-001",
    });
    box = await s.inbox(receiver);
    assert.equal(box.unread, 2);
    const published = box.items.find((i) => i.kind === "published")!;
    assert.equal(published.update.type, "publication");
    assert.equal((published.update as any).publicationId, publication.publicationId);
    assert.ok(!JSON.stringify(published).includes("PRIVATE"));
    assert.ok(!JSON.stringify(published).includes(source.id));

    // "all" clears everything at once.
    assert.equal((await s.markInboxSeen(receiver, { all: true })).unread, 0);

    // Retracted, forgotten and revoked items drop out.
    const second = (await s.remember(sender, note("Budget approved", "inbox-second"))).memory;
    await s.share(sender, second.id, space.id, true, "inbox-second-share");
    assert.equal((await s.inbox(late)).items.length, 3);
    await s.share(sender, second.id, space.id, false, "inbox-second-retract");
    assert.ok(!(await s.inbox(late)).items.some((i) => (i.update as any).memory?.id === second.id));
    await s.forget(sender, early.id);
    assert.ok(!(await s.inbox(late)).items.some((i) => (i.update as any).memory?.id === early.id));
    await s.revoke(sender, space.id, late.userId);
    assert.deepEqual(await s.inbox(late), { unread: 0, items: [] });
  } finally {
    await s.graph.delete();
    await s.close();
  }
});

test("tool results carry an inbox footer and check_inbox is exposed", async () => {
  const s = await connect();
  try {
    const space = await s.createSpace(sender, "Footer");
    await s.accept(
      receiver,
      (await s.invite(sender, space.id, receiver.email!, "contributor")).token,
    );
    const tools = memoryTools(s, "", undefined, "https://memory.example.com/mcp", true);
    const call = (actor: Actor, name: string, input: unknown = {}) =>
      runToolWithInbox(tools, s, actor, name, input) as Promise<any>;

    assert.ok(!("inbox" in (await call(receiver, "list_spaces"))), "No footer when nothing is unread");
    const m = (await s.remember(sender, note("Launch moved to Nov 20", "footer-1"))).memory;
    await s.share(sender, m.id, space.id, true, "footer-share");

    const spaces = await call(receiver, "list_spaces");
    assert.equal(spaces.inbox.unread, 1);
    assert.match(spaces.inbox.hint, /check_inbox/);
    assert.ok(!("inbox" in (await call(sender, "list_spaces"))), "Authors get no footer for their own share");

    const box = await call(receiver, "check_inbox");
    assert.ok(!("inbox" in box), "check_inbox is not decorated with its own footer");
    assert.equal(box.items[0].update.memory.text, "Launch moved to Nov 20");
    await call(receiver, "mark_inbox_seen", { changeIds: [box.items[0].changeId] });
    assert.ok(!("inbox" in (await call(receiver, "list_spaces"))));

    // A broken inbox lookup never breaks the underlying tool.
    const broken = Object.create(s, {
      inboxCount: { value: async () => { throw new Error("boom"); } },
    });
    const result: any = await runToolWithInbox(tools, broken, receiver, "list_spaces", {});
    assert.ok(Array.isArray(result.spaces));
  } finally {
    await s.graph.delete();
    await s.close();
  }
});

test("a commit delivers webhooks immediately instead of waiting for the worker interval", async () => {
  const s = await connect();
  const secret = "whsec_" + randomBytes(32).toString("base64");
  const received: any[] = [];
  const service = new EventService(
    s,
    randomBytes(32).toString("base64"),
    "https://memory.example.com",
    async (_url, body, headers) => {
      const payload = new Webhook(secret).verify(body, headers) as any;
      if (payload.type === "verification")
        return { status: 200, body: JSON.stringify({ challenge: payload.challenge }) };
      received.push(payload);
      return { status: 204, body: "" };
    },
  );
  let pending: Promise<void> | undefined;
  const stop = s.onChange(() => {
    pending = service.tick();
  });
  try {
    const space = await s.createSpace(sender, "Instant");
    await s.accept(
      receiver,
      (await s.invite(sender, space.id, receiver.email!, "reader")).token,
    );
    await service.subscribe(receiver, {
      name: "memory.changed",
      arguments: { space_id: space.id },
      delivery: { mode: "webhook", url: "https://receiver.example.com/events", secret },
    });
    const m = (await s.remember(sender, note("Ship it", "instant-1"))).memory;
    pending = undefined;
    await s.share(sender, m.id, space.id, true, "instant-share");
    assert.ok(pending, "Sharing notifies change listeners");
    await pending;
    assert.equal(received.length, 1);
    assert.equal(received[0].data.memory_id, m.id);

    // Overlapping triggers coalesce into a follow-up pass, not a lost change.
    const a = service.tick();
    const m2 = (await s.remember(sender, note("Ship it again", "instant-2"))).memory;
    await s.share(sender, m2.id, space.id, true, "instant-share-2");
    await Promise.all([a, pending]);
    assert.equal(received.length, 2);
  } finally {
    stop();
    await s.graph.delete();
    await s.close();
  }
});
