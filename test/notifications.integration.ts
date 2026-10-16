import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { connectMemoryStore, type Actor } from "../src/memory.js";
import { KnowledgeStore } from "../src/knowledge.js";
import { EventService } from "../src/events.js";
import { memoryTools, runTool } from "../src/tools.js";

const sender: Actor = {
  userId: "sender",
  name: "Sender",
  clientId: "sender-agent",
  email: "sender@example.com",
};
const receiver: Actor = {
  userId: "receiver",
  name: "Receiver",
  clientId: "receiver-agent",
  email: "receiver@example.com",
};
const outsider: Actor = { userId: "outsider", clientId: "outsider-agent" };
test("whole-memory and selected-claim notifications stay separate, scoped, signed and idempotent", async () => {
  const s = await connectMemoryStore({
    FALKORDB_HOST: "127.0.0.1",
    FALKORDB_PORT: "16379",
    FALKORDB_PASSWORD: "local-verification",
    FALKORDB_MEMORY_GRAPH:
      "notifications_verification_" + randomUUID().replaceAll("-", ""),
  });
  const k = new KnowledgeStore(s);
  const secret = "whsec_" + randomBytes(32).toString("base64");
  const received: any[] = [];
  let fail = false;
  const service = new EventService(
    s,
    randomBytes(32).toString("base64"),
    "https://memory.example.com",
    async (_url, body, headers) => {
      const payload = new Webhook(secret).verify(body, headers) as any;
      if (payload.type === "verification")
        return {
          status: 200,
          body: JSON.stringify({ challenge: payload.challenge }),
        };
      received.push(payload);
      return { status: fail ? 503 : 204, body: "" };
    },
  );
  try {
    const space = await s.createSpace(sender, "Notification test");
    await s.accept(
      receiver,
      (await s.invite(sender, space.id, receiver.email!, "reader")).token,
    );
    const otherSpace = await s.createSpace(sender, "Other scope");
    const params = (name: string) => ({
      name,
      arguments: { space_id: space.id },
      delivery: {
        mode: "webhook",
        url: "https://receiver.example.com/events",
        secret,
      },
    });
    await assert.rejects(
      service.subscribe(outsider, params("knowledge.changed")),
    );
    const memorySub = await service.subscribe(
      receiver,
      params("memory.changed"),
    );
    const knowledgeSub = await service.subscribe(
      receiver,
      params("knowledge.changed"),
    );
    assert.notEqual(memorySub.id, knowledgeSub.id);
    assert.equal(
      (await service.subscribe(receiver, params("knowledge.changed"))).id,
      knowledgeSub.id,
    );
    await service.subscribe(sender, params("memory.changed"));
    await service.subscribe(sender, params("knowledge.changed"));
    const source = (
      await s.remember(sender, {
        text: "Project Atlas is in progress. PRIVATE detail stays private.",
        evidence: "Project Atlas is in progress.",
        kind: "fact",
        basis: "user_statement",
        entities: [],
        idempotencyKey: "notification-source-001",
      })
    ).memory;
    const batch = await k.record(sender, {
      sourceMemoryId: source.id,
      sourceRevision: 1,
      idempotencyKey: "notification-claims-001",
      entities: [
        {
          key: "atlas",
          type: "project",
          name: "Atlas",
          aliases: ["PRIVATE ALIAS"],
          properties: { description: "PRIVATE DESCRIPTION" },
        },
      ],
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
    const publicationInput = {
      claimId: batch.claimIds[0],
      spaceId: space.id,
      enabled: true,
      userRequested: true,
      idempotencyKey: "notification-publication-001",
    };
    const publication = await k.publish(sender, publicationInput);
    assert.equal(publication.delivery, "queued_for_active_subscribers");
    await k.publish(sender, publicationInput);
    fail = true;
    await service.tick();
    assert.equal(received.length, 1);
    assert.equal(received[0].name, "knowledge.changed");
    assert.equal(received[0].data.publication_id, publication.publicationId);
    assert.ok(!("memory_id" in received[0].data));
    assert.ok(!JSON.stringify(received[0]).includes(source.id));
    assert.ok(!JSON.stringify(received[0]).includes("PRIVATE"));
    fail = false;
    await s.query("MATCH (d:Delivery) WHERE d.status='retry' SET d.nextAt=0");
    await service.tick();
    assert.equal(received.length, 2);
    assert.equal(received[0].eventId, received[1].eventId);
    await service.tick();
    assert.equal(received.length, 2);
    const packet = await k.sharedUpdate(
      receiver,
      publication.publicationId,
      space.id,
    );
    assert.ok(!JSON.stringify(packet).includes("PRIVATE"));
    assert.ok(!JSON.stringify(packet).includes(source.id));
    await assert.rejects(
      k.sharedUpdate(receiver, source.id, space.id),
      /unavailable/,
    );
    await assert.rejects(
      k.sharedUpdate(sender, source.id, space.id),
      /unavailable/,
      "Even the source owner cannot read an unshared source through the space packet",
    );
    await assert.rejects(
      k.sharedUpdate(receiver, publication.publicationId, otherSpace.id),
    );
    await assert.rejects(
      k.sharedUpdate(outsider, publication.publicationId, space.id),
    );
    const tools = memoryTools(
      s,
      "",
      undefined,
      "https://memory.example.com/mcp",
      true,
    );
    const setup: any = await runTool(tools, receiver, "notification_setup", {
      host: "dot",
      spaceId: space.id,
    });
    assert.equal(setup.subscriptions.length, 2);
    assert.equal(setup.eventsAvailable, true);
    assert.ok(!JSON.stringify(setup).includes(secret));
    assert.ok(!JSON.stringify(setup).includes("receiver.example.com"));
    assert.ok(setup.prompt.includes("https://memory.example.com/mcp"));
    await assert.rejects(
      runTool(tools, outsider, "notification_setup", {
        host: "muse",
        spaceId: space.id,
      }),
    );
    await s.share(sender, source.id, space.id, true, "notification-share-001");
    await service.tick();
    assert.equal(received.at(-1).name, "memory.changed");
    assert.equal(
      received.length,
      3,
      "No sender echo or delivery to the wrong event subscription",
    );
    const memoryPacket: any = await k.sharedUpdate(
      receiver,
      source.id,
      space.id,
    );
    assert.equal(memoryPacket.update.memory.text, source.text);
    await s.share(
      sender,
      source.id,
      space.id,
      false,
      "notification-unshare-001",
    );
    await service.tick();
    await assert.rejects(
      k.sharedUpdate(receiver, source.id, space.id),
      /unavailable/,
    );
    const retraction = { ...publicationInput, enabled: false };
    await k.publish(sender, retraction);
    await k.publish(sender, retraction);
    await service.tick();
    assert.equal(received.at(-1).data.change, "retracted");
    assert.equal(received.length, 5);
    await assert.rejects(
      k.sharedUpdate(receiver, publication.publicationId, space.id),
      /unavailable/,
    );
    await k.publish(sender, publicationInput);
    await service.tick();
    assert.equal(
      received.length,
      5,
      "Retry cannot republish a withdrawn snapshot",
    );
    await s.share(
      sender,
      source.id,
      space.id,
      true,
      "notification-share-revoked",
    );
    await s.revoke(sender, space.id, receiver.userId);
    await service.tick();
    assert.equal(received.length, 5);
    await assert.rejects(k.sharedUpdate(receiver, source.id, space.id));
    await service.unsubscribe(sender, params("memory.changed"));
    await service.unsubscribe(sender, params("knowledge.changed"));
    assert.equal((await s.subscriptions()).length, 0);
  } finally {
    await s.graph.delete();
    await s.close();
  }
});

test("unreadable queued updates cannot starve later notifications and stopped subscriptions do not replay the gap", async () => {
  const s = await connectMemoryStore({
    FALKORDB_HOST: "127.0.0.1",
    FALKORDB_PORT: "16379",
    FALKORDB_PASSWORD: "local-verification",
    FALKORDB_MEMORY_GRAPH:
      "notification_recovery_" + randomUUID().replaceAll("-", ""),
  });
  const delivered: any[] = [];
  const service = new EventService(
    s,
    randomBytes(32).toString("base64"),
    "https://memory.example.com",
    async (_u, body) => {
      const p = JSON.parse(body);
      if (p.type === "verification")
        return {
          status: 200,
          body: JSON.stringify({ challenge: p.challenge }),
        };
      delivered.push(p);
      return { status: 204, body: "" };
    },
  );
  try {
    const space = await s.createSpace(sender, "Queue recovery");
    await s.accept(
      receiver,
      (await s.invite(sender, space.id, receiver.email!, "reader")).token,
    );
    const params = {
      name: "memory.changed",
      arguments: { space_id: space.id },
      delivery: {
        mode: "webhook",
        url: "https://receiver.example.com/queue",
        secret: "whsec_" + randomBytes(32).toString("base64"),
      },
    };
    await service.subscribe(receiver, params);
    const [subscription] = await s.subscriptions(receiver.userId);
    const memory = (
      await s.remember(sender, {
        text: "Queue test update",
        evidence: "Queue test update",
        kind: "fact",
        basis: "user_statement",
        entities: [],
        idempotencyKey: "queue-recovery-source",
      })
    ).memory;
    // Test-only backlog of former shares that are no longer readable, plus sender echoes.
    await s.query(
      `UNWIND range(0,54) AS i CREATE (:Change {id:'blocked_'+toString(i),memoryId:$memory,spaceId:$space,actorId:$sender,actorName:'Sender',clientId:'sender-agent',revision:1,kind:'shared',createdAt:$created}) CREATE (:Change {id:'own_'+toString(i),memoryId:$memory,spaceId:$space,actorId:$recipient,actorName:'Receiver',clientId:'receiver-agent',revision:1,kind:'shared',createdAt:$created})`,
      {
        memory: memory.id,
        space: space.id,
        sender: sender.userId,
        recipient: receiver.userId,
        created: subscription.createdAt!,
      },
    );
    assert.ok(
      (await s.pendingChanges(subscription)).every(
        (c) => c.actorId !== receiver.userId,
      ),
    );
    const later = (
      await s.remember(sender, {
        text: "Later visible update",
        evidence: "Later visible update",
        kind: "fact",
        basis: "user_statement",
        entities: [],
        idempotencyKey: "queue-recovery-later",
      })
    ).memory;
    await s.share(sender, later.id, space.id, true, "queue-recovery-share");
    await service.tick();
    assert.equal(delivered.length, 0);
    await service.tick();
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].data.memory_id, later.id);
    await service.unsubscribe(receiver, params);
    const gap = await s.share(
      sender,
      memory.id,
      space.id,
      true,
      "inactive-gap-share",
    );
    await s.query("MATCH (c:Change {id:$id}) SET c.createdAt=$created", {
      id: gap.eventId,
      created: Date.now() - 1000,
    });
    await service.subscribe(receiver, params);
    await service.tick();
    assert.equal(
      delivered.length,
      1,
      "Reactivation skips activity from the inactive gap",
    );
  } finally {
    await s.graph.delete();
    await s.close();
  }
});
