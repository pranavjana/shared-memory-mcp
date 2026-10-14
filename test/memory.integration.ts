import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { connectMemoryStore, DomainError, type Actor } from "../src/memory.js";
import {
  EventService,
  publicAddress,
  decrypt,
  encrypt,
} from "../src/events.js";

const env = {
  ...process.env,
  FALKORDB_HOST: process.env.FALKORDB_TEST_HOST ?? "127.0.0.1",
  FALKORDB_PORT: process.env.FALKORDB_TEST_PORT ?? "16379",
  FALKORDB_PASSWORD: process.env.FALKORDB_TEST_PASSWORD ?? "local-verification",
  FALKORDB_MEMORY_GRAPH: "verification_" + randomUUID().replaceAll("-", ""),
};
const alice: Actor = {
  userId: "user_alice",
  clientId: "alice-agent",
  name: "Alice",
  email: "alice@example.com",
};
const bob: Actor = {
  userId: "user_bob",
  clientId: "bob-agent",
  name: "Bob",
  email: "bob@example.com",
};
const stranger: Actor = {
  userId: "user_stranger",
  clientId: "test",
  email: "stranger@example.com",
};
const input = (key: string, text = "Authentication finished") => ({
  text,
  kind: "task",
  basis: "observed_outcome",
  evidence: "Observed successful build",
  entities: [{ type: "project", name: "Atlas" }],
  idempotencyKey: key,
});

test("real graph: ownership, relationships, retries, revisions, sharing and revocation", async () => {
  const s = await connectMemoryStore(env);
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => s.remember(alice, input("initial-key"))),
    );
    const id = results[0].memory.id;
    assert.equal(new Set(results.map((r) => r.memory.id)).size, 1);
    assert.equal((await s.recall(alice, "")).memories.length, 1);
    await assert.rejects(
      s.remember(alice, input("initial-key", "Different payload")),
      (e: unknown) => e instanceof DomainError && e.status === 409,
    );
    await assert.rejects(
      s.get(bob, id),
      (e: unknown) => e instanceof DomainError && e.status === 404,
    );
    await s.remember(
      alice,
      input("another-key", "Deployments require an approval"),
    );
    const r = await s.recall(alice, "Authentication");
    assert.equal(r.memories.length, 1);
    assert.equal(
      r.related.length,
      1,
      "Graph traversal retrieves related project context without keyword overlap",
    );
    await s.remember(bob, input("bob-own-key", "Bob private notes"));
    assert.equal((await s.recall(alice, "Bob")).memories.length, 0);
    const noEntity = await s.remember(alice, {
      ...input("no-entity-key"),
      entities: [],
    });
    assert.ok(noEntity.saved);
    const space = await s.createSpace(alice, "Atlas collaboration");
    const invitation = await s.invite(alice, space.id, bob.email!, "reader");
    await assert.rejects(s.accept(stranger, invitation.token));
    await s.accept(bob, invitation.token);
    await assert.rejects(
      s.share(bob, (await s.recall(bob, "")).memories[0].id, space.id),
    );
    await s.share(alice, id, space.id);
    assert.equal((await s.get(bob, id)).text, "Authentication finished");
    await assert.rejects(s.revise(bob, id, 1, input("foreign-edit")));
    const revised = await s.revise(
      alice,
      id,
      1,
      input("revision-key", "Authentication and deployment finished"),
    );
    assert.equal((revised.memory as any).revision, 2);
    assert.equal(
      (await s.get(bob, id)).revision,
      2,
      "Shared reference follows current revision",
    );
    assert.equal((await s.explain(alice, id)).history.length, 2);
    assert.equal(
      (await s.explain(bob, id)).history.length,
      0,
      "No private historic revisions leak to a recipient",
    );
    await s.revise(
      alice,
      id,
      1,
      input("revision-key", "Authentication and deployment finished"),
    );
    await assert.rejects(s.revise(alice, id, 1, input("stale-other-key")));
    await s.share(alice, id, space.id, false);
    await assert.rejects(s.get(bob, id));
    await s.share(alice, id, space.id, true, "new-share-operation");
    await s.revoke(alice, space.id, bob.userId);
    await assert.rejects(s.get(bob, id));
    await assert.rejects(s.accept(bob, invitation.token));
    assert.equal(
      (await s.spaces(bob)).length,
      0,
      "Old invite cannot bypass revocation",
    );
    const newInvite = await s.invite(
      alice,
      space.id,
      bob.email!,
      "contributor",
    );
    await s.accept(bob, newInvite.token);
    const rule = await s.addRule(alice, space.id, "task", "Atlas");
    const automatic = await s.remember(
      alice,
      input("automatic-rule-key", "Rule-matched completion"),
    );
    assert.equal((await s.applyRules(alice, automatic.memory.id)).length, 1);
    assert.ok(await s.get(bob, automatic.memory.id));
    assert.equal(
      (await s.applyRules(alice, automatic.memory.id)).length,
      0,
      "Repeated rules do not create repeated shares",
    );
    await s.disableRule(alice, rule.id);
    const unmatched = await s.remember(alice, input("disabled-rule-key"));
    assert.equal((await s.applyRules(alice, unmatched.memory.id)).length, 0);
    await assert.rejects(s.get(bob, unmatched.memory.id));
    await s.authorizeClient(bob);
    const connection = (await s.connections(bob))[0];
    await s.setConnection(bob, String(connection.id), false);
    assert.equal(
      await s.authorizeClient(bob),
      false,
      "A new request cannot reactivate a revoked client",
    );
    await s.setConnection(bob, String(connection.id), true);
    assert.equal(await s.authorizeClient(bob), true);
    await s.forget(alice, id);
    await assert.rejects(s.get(alice, id));
    const rows = await s.query<any>(
      "MATCH (m:Memory {id:$id})-[:HAS_REVISION]->(r) RETURN r.text AS text,r.evidence AS evidence",
      { id },
      true,
    );
    assert.ok(rows.every((r) => r.text === null && r.evidence === null));
    await assert.rejects(
      s.remember(alice, input("initial-key")),
      "Replay cannot resurrect forgotten memory",
    );
    await s.init(); // Existing schema can be safely reopened.
  } finally {
    await s.graph.delete();
    await s.close();
  }
});

test("real graph: signed subscriptions, stable retry IDs, no origin echo, revocation", async () => {
  const s = await connectMemoryStore({
    ...env,
    FALKORDB_MEMORY_GRAPH: env.FALKORDB_MEMORY_GRAPH + "_events",
  });
  const encryptionKey = randomBytes(32).toString("base64");
  const signingSecret = "whsec_" + randomBytes(32).toString("base64");
  const requests: {
    url: string;
    payload: any;
    headers: Record<string, string>;
  }[] = [];
  let fail = false;
  const events = new EventService(
    s,
    encryptionKey,
    "https://memory.example.com",
    async (url, body, headers) => {
      const payload = JSON.parse(body);
      requests.push({ url, payload, headers });
      return payload.type === "verification"
        ? {
            status: 200,
            body: JSON.stringify({ challenge: payload.challenge }),
          }
        : { status: fail ? 503 : 204, body: "" };
    },
  );
  try {
    const space = await s.createSpace(alice, "Events");
    const inv = await s.invite(alice, space.id, bob.email!, "contributor");
    await s.accept(bob, inv.token);
    const params = {
      name: "memory.changed",
      arguments: { space_id: space.id },
      delivery: {
        mode: "webhook",
        url: "https://callback.example.com/receive",
        secret: signingSecret,
      },
    };
    await assert.rejects(events.subscribe(stranger, params));
    const sub = await events.subscribe(bob, params);
    const again = await events.subscribe(bob, params);
    assert.equal(sub.id, again.id);
    const stored = (await s.subscriptions())[0];
    assert.notEqual(stored.secret, signingSecret);
    assert.equal(decrypt(stored.secret, encryptionKey), signingSecret);
    const id = (await s.remember(alice, input("signed-event-key"))).memory.id;
    await s.share(alice, id, space.id);
    await events.tick();
    await events.tick();
    const deliveries = requests.filter((r) => !r.payload.type);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].payload.name, "memory.changed");
    assert.equal(deliveries[0].payload.data.memory_id, id);
    assert.equal(
      deliveries[0].headers["webhook-id"],
      deliveries[0].payload.eventId,
    );
    assert.ok(deliveries[0].headers["webhook-signature"].startsWith("v1,"));
    await events.subscribe(alice, {
      ...params,
      delivery: {
        ...params.delivery,
        url: "https://callback.example.com/alice",
      },
    });
    await events.tick();
    assert.equal(
      requests.filter((r) => !r.payload.type).length,
      1,
      "The sender is not notified of its own event",
    );
    fail = true;
    const retryMemory = (
      await s.remember(alice, input("retry-delivery-key", "Retry event"))
    ).memory.id;
    await s.share(alice, retryMemory, space.id);
    await events.tick();
    const failed = requests.filter((r) => !r.payload.type).at(-1)!;
    assert.equal(
      (await s.deliveries(bob)).some((d) => d.status === "retry"),
      true,
    );
    fail = false;
    await s.query('MATCH (d:Delivery) WHERE d.status="retry" SET d.nextAt=0');
    await events.tick();
    assert.equal(
      requests.filter((r) => !r.payload.type).at(-1)!.payload.eventId,
      failed.payload.eventId,
      "Retry preserves event ID",
    );
    const countBeforeRevoke = requests.filter((r) => !r.payload.type).length;
    await s.revoke(alice, space.id, bob.userId);
    await s.revise(
      alice,
      id,
      1,
      input("updated-signed-key", "New completed task"),
    );
    await events.tick();
    assert.equal(
      requests.filter((r) => !r.payload.type).length,
      countBeforeRevoke,
      "Revoked members receive no later updates",
    );
    await events.unsubscribe(bob, params);
    assert.equal(
      (await s.subscriptions()).some((x) => x.owner === bob.userId),
      false,
    );
    assert.equal(
      encrypt("same", encryptionKey) === encrypt("same", encryptionKey),
      false,
    );
    for (const addr of [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "192.168.1.1",
      "0.0.0.0",
    ])
      assert.equal(publicAddress(addr), false, addr);
    assert.equal(publicAddress("8.8.8.8"), true);
  } finally {
    await s.graph.delete();
    await s.close();
  }
});
