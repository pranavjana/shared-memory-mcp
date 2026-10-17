import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectMemoryStore, type Actor } from "../src/memory.js";
import { KnowledgeStore } from "../src/knowledge.js";
import { memoryTools } from "../src/tools.js";

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
test("shared memories and selected claims are readable only within their space", async () => {
  const s = await connectMemoryStore({
    FALKORDB_HOST: "127.0.0.1",
    FALKORDB_PORT: "16379",
    FALKORDB_PASSWORD: "local-verification",
    FALKORDB_MEMORY_GRAPH:
      "shared_updates_verification_" + randomUUID().replaceAll("-", ""),
  });
  const k = new KnowledgeStore(s);
  try {
    const space = await s.createSpace(sender, "Shared update test");
    await s.accept(
      receiver,
      (await s.invite(sender, space.id, receiver.email!, "reader")).token,
    );
    const otherSpace = await s.createSpace(sender, "Other scope");
    const source = (
      await s.remember(sender, {
        text: "Project Atlas is in progress. PRIVATE detail stays private.",
        evidence: "Project Atlas is in progress.",
        kind: "fact",
        basis: "user_statement",
        entities: [],
        idempotencyKey: "shared-update-source-001",
      })
    ).memory;
    const batch = await k.record(sender, {
      sourceMemoryId: source.id,
      sourceRevision: 1,
      idempotencyKey: "shared-update-claims-001",
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
      idempotencyKey: "shared-update-publication-001",
    };
    const publication = await k.publish(sender, publicationInput);
    assert.ok(!("delivery" in publication));
    assert.equal(
      (await k.publish(sender, publicationInput)).publicationId,
      publication.publicationId,
    );
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
    const tools = memoryTools(s, "");
    assert.ok(!tools.some((t) => t.name === "notification_setup"));
    const shared = await s.share(
      sender,
      source.id,
      space.id,
      true,
      "shared-update-share-001",
    );
    assert.ok(!("delivery" in shared));
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
      "shared-update-unshare-001",
    );
    await assert.rejects(
      k.sharedUpdate(receiver, source.id, space.id),
      /unavailable/,
    );
    const retraction = { ...publicationInput, enabled: false };
    await k.publish(sender, retraction);
    await k.publish(sender, retraction);
    await assert.rejects(
      k.sharedUpdate(receiver, publication.publicationId, space.id),
      /unavailable/,
    );
    await k.publish(sender, publicationInput);
    await assert.rejects(
      k.sharedUpdate(receiver, publication.publicationId, space.id),
      /unavailable/,
      "Retry cannot republish a withdrawn snapshot",
    );
    await s.share(
      sender,
      source.id,
      space.id,
      true,
      "shared-update-share-revoked",
    );
    await s.revoke(sender, space.id, receiver.userId);
    await assert.rejects(k.sharedUpdate(receiver, source.id, space.id));
  } finally {
    await s.graph.delete();
    await s.close();
  }
});

test("startup clears stored secrets from legacy webhook subscriptions", async () => {
  const s = await connectMemoryStore({
    FALKORDB_HOST: "127.0.0.1",
    FALKORDB_PORT: "16379",
    FALKORDB_PASSWORD: "local-verification",
    FALKORDB_MEMORY_GRAPH:
      "legacy_subscriptions_" + randomUUID().replaceAll("-", ""),
  });
  try {
    await s.query(
      "CREATE (:Subscription {id:'sub_legacy',owner:'receiver',active:true,secret:'enc',previousSecret:'old',grantToken:'grant',expiresAt:$future})",
      { future: Date.now() + 86400000 },
    );
    await s.init();
    const [row] = await s.query<{ value: Record<string, unknown> }>(
      "MATCH (s:Subscription {id:'sub_legacy'}) RETURN properties(s) AS value",
      {},
      true,
    );
    assert.equal(row.value.active, false);
    for (const key of ["secret", "previousSecret", "grantToken"])
      assert.ok(!(key in row.value), `${key} is cleared`);
  } finally {
    await s.graph.delete();
    await s.close();
  }
});
