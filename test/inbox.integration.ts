import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectMemoryStore, type Actor } from "../src/memory.js";
import { KnowledgeStore } from "../src/knowledge.js";
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

    // check_inbox returns short previews, 10 by default, to keep host context small.
    const long = "Q4 plan: " + "detail ".repeat(100);
    for (let n = 0; n < 12; n++) {
      const item = (await s.remember(sender, note(n === 0 ? long : `Update number ${n}`, "preview-" + n))).memory;
      await s.share(sender, item.id, space.id, true, "preview-share-" + n);
    }
    const previews = await call(receiver, "check_inbox");
    assert.equal(previews.unread, 12);
    assert.equal(previews.items.length, 10, "Ten items by default");
    const longItem = (await call(receiver, "check_inbox", { limit: 50 })).items.find(
      (i: any) => i.update.memory.text.startsWith("Q4 plan:"),
    );
    assert.equal(longItem.update.memory.text.length, 301, "300 characters plus an ellipsis");
    assert.ok(longItem.update.memory.text.endsWith("…"));
    assert.equal(longItem.update.memory.truncated, true);
    assert.ok(!("evidence" in longItem.update.memory), "Evidence is left for get_shared_update");
    const full: any = await runToolWithInbox(tools, s, receiver, "get_shared_update", {
      id: longItem.update.memory.id,
      spaceId: space.id,
    });
    assert.equal(full.update.memory.text, long.trim(), "The full note is one call away");
    await call(receiver, "mark_inbox_seen", { all: true });

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

test("committed shares, revisions and publications notify change listeners", async () => {
  const s = await connect();
  const k = new KnowledgeStore(s);
  let calls = 0;
  const stop = s.onChange(() => {
    calls++;
  });
  // A failing listener must not fail the write that already committed.
  const stopBroken = s.onChange(() => {
    throw new Error("listener failure");
  });
  try {
    const space = await s.createSpace(sender, "Listeners");
    const m = (await s.remember(sender, note("Ship it", "listener-1"))).memory;
    assert.equal(calls, 0, "A private save is not a shared change");
    await s.share(sender, m.id, space.id, true, "listener-share");
    assert.equal(calls, 1);
    await s.revise(sender, m.id, 1, note("Ship it today", "listener-r2"));
    assert.equal(calls, 2);
    const batch = await k.record(sender, {
      sourceMemoryId: m.id,
      sourceRevision: 2,
      idempotencyKey: "listener-claims",
      entities: [{ key: "ship", type: "task", name: "Ship" }],
      claims: [
        {
          subject: "ship",
          predicate: "HAS_STATUS",
          value: "in_progress",
          basis: "explicit",
          evidence: "Ship it today",
        },
      ],
    });
    await k.publish(sender, {
      claimId: batch.claimIds[0],
      spaceId: space.id,
      enabled: true,
      userRequested: true,
      idempotencyKey: "listener-publication",
    });
    assert.equal(calls, 3);
    stop();
    await s.share(sender, m.id, space.id, false, "listener-retract");
    assert.equal(calls, 3, "An unsubscribed listener is not called");
  } finally {
    stop();
    stopBroken();
    await s.graph.delete();
    await s.close();
  }
});
