import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { connectMemoryStore, DomainError, type Actor } from "../src/memory.js";
import { KnowledgeStore } from "../src/knowledge.js";
// @ts-ignore JavaScript sandbox operator helpers; no CLI execution on import.
import { seedWorkspace, FixtureStateError } from "../scripts/sandbox-seed.mjs";
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

test("ontology claims enforce provenance, scoped identity, corrections and frozen shared projections", async () => {
  const s = await connectMemoryStore({
    ...env,
    FALKORDB_MEMORY_GRAPH: env.FALKORDB_MEMORY_GRAPH + "_ontology",
  });
  const k = new KnowledgeStore(s);
  try {
    const source = (
      await s.remember(alice, {
        ...input(
          "ontology-source-001",
          "OAuth is completed. Roshan can test. Private launch concern.",
        ),
        basis: "user_statement",
      })
    ).memory;
    const data = {
      sourceMemoryId: source.id,
      sourceRevision: 1,
      idempotencyKey: "ontology-batch-001",
      entities: [
        {
          key: "task:oauth",
          type: "task",
          name: "OAuth",
          aliases: ["login setup"],
          properties: { description: "PRIVATE ENTITY DETAIL" },
        },
        { key: "task:tests", type: "task", name: "Connector tests" },
        { key: "person:roshan", type: "person", name: "Roshan" },
      ],
      claims: [
        {
          subject: "task:oauth",
          predicate: "HAS_STATUS",
          value: "completed",
          basis: "explicit",
          evidence: "OAuth is completed.",
        },
        {
          subject: "task:tests",
          predicate: "DEPENDS_ON",
          object: "task:oauth",
          basis: "inferred",
          evidence: "Roshan can test.",
        },
        {
          subject: "task:tests",
          predicate: "ASSIGNED_TO",
          object: "person:roshan",
          basis: "inferred",
          evidence: "Roshan can test.",
        },
      ],
    };
    await assert.rejects(k.record(bob, data));
    await assert.rejects(
      k.record(alice, {
        ...data,
        claims: [{ ...data.claims[0], evidence: "fabricated evidence" }],
      }),
    );
    const saved = await k.record(alice, data);
    // claimIds[i] must identify claims[i]; agents select claims by position.
    assert.deepEqual(
      saved.claimIds,
      data.claims.map((_, i) => saved.receipt + ":" + i),
    );
    assert.deepEqual(await k.record(alice, data), saved);
    await assert.rejects(
      k.record(alice, {
        ...data,
        idempotencyKey: "inferred-correction-denied",
        claims: [
          {
            ...data.claims[0],
            basis: "inferred",
            supersedes: saved.claimIds[0],
          },
        ],
      }),
      "An inference cannot replace an explicit statement",
    );
    await assert.rejects(
      k.record(alice, { ...data, claims: [data.claims[0]] }),
    );
    assert.equal((await k.recall(bob, {})).claims.length, 0);
    const recalled = await k.recall(alice, { query: "login setup" });
    assert.equal(
      recalled.claims.length,
      3,
      "Alias seeds expand to connected task context",
    );
    assert.ok(recalled.claims.some((c) => c.basis === "inferred"));
    assert.equal(
      (await k.recall(alice, { predicate: "ACCEPTED_BY" })).claims.length,
      0,
      "An assignment never creates acceptance",
    );
    const entity = (await k.recall(alice, {})).claims.find(
      (c) => c.predicate === "HAS_STATUS",
    )!.subject.id;
    const otherSource = (
      await s.remember(bob, {
        ...input("ontology-bob-source", "OAuth is blocked."),
        basis: "user_statement",
      })
    ).memory;
    await k.record(bob, {
      ...data,
      sourceMemoryId: otherSource.id,
      idempotencyKey: "ontology-bob-batch",
      claims: [
        { ...data.claims[0], value: "blocked", evidence: "OAuth is blocked." },
      ],
    });
    assert.notEqual(
      (await k.recall(bob, {})).claims[0].subject.id,
      entity,
      "Same key/name in another author's namespace stays separate",
    );
    const space = await s.createSpace(alice, "Ontology test space");
    const invite = await s.invite(alice, space.id, bob.email!, "reader");
    await s.accept(bob, invite.token);
    const pubInput = {
      claimId: saved.claimIds[0],
      spaceId: space.id,
      userRequested: true,
      idempotencyKey: "ontology-publish-001",
    };
    await assert.rejects(k.publish(bob, pubInput));
    const pub = await k.publish(alice, pubInput);
    const visible = (await k.recall(bob, { spaceId: space.id })).claims;
    assert.equal(visible.length, 1);
    assert.equal(visible[0].scope, "space");
    assert.equal(visible[0].sourceMemoryId, undefined);
    assert.notEqual(visible[0].subject.id, entity);
    assert.equal(
      JSON.stringify(visible).includes("PRIVATE ENTITY DETAIL"),
      false,
    );
    assert.equal(
      JSON.stringify(visible).includes("Private launch concern"),
      false,
    );
    assert.equal(
      JSON.stringify(visible).includes("login setup"),
      false,
      "Private aliases are not published",
    );
    await assert.rejects(
      s.get(bob, source.id),
      "A claim publication does not share its private source",
    );
    await assert.rejects(k.recall(stranger, { spaceId: space.id }));
    await s.revise(alice, source.id, 1, {
      ...input("ontology-revision-002", "OAuth is blocked."),
      basis: "user_statement",
    });
    assert.equal(
      (await k.recall(alice, { query: "completed" })).claims.filter(
        (c) => c.scope === "personal",
      ).length,
      0,
    );
    assert.equal(
      (await k.recall(alice, { includeHistory: true })).claims.filter(
        (c) => c.scope === "personal",
      ).length,
      3,
    );
    assert.equal(
      (await k.recall(bob, { spaceId: space.id })).claims[0].value,
      "completed",
      "Private source edits do not silently modify a published snapshot",
    );
    const corrected = await k.record(alice, {
      ...data,
      sourceRevision: 2,
      idempotencyKey: "ontology-correction-002",
      claims: [
        {
          ...data.claims[0],
          value: "blocked",
          evidence: "OAuth is blocked.",
          supersedes: saved.claimIds[0],
        },
      ],
    });
    assert.equal(corrected.claimIds.length, 1);
    assert.ok(
      (await k.recall(alice, { includeHistory: true })).claims.some(
        (c) => c.status === "superseded",
      ),
    );
    await assert.rejects(
      k.record(bob, {
        ...data,
        sourceMemoryId: otherSource.id,
        idempotencyKey: "ontology-cross-correction",
        claims: [
          {
            ...data.claims[0],
            evidence: "OAuth is blocked.",
            supersedes: corrected.claimIds[0],
          },
        ],
      }),
    );
    await k.publish(alice, {
      ...pubInput,
      claimId: pub.publicationId,
      enabled: false,
    });
    assert.equal((await k.recall(bob, { spaceId: space.id })).claims.length, 0);
    const pub2 = await k.publish(alice, {
      ...pubInput,
      claimId: corrected.claimIds[0],
      idempotencyKey: "ontology-publish-002",
    });
    assert.equal(pub2.published, true);
    await s.revoke(alice, space.id, bob.userId);
    await assert.rejects(k.recall(bob, { spaceId: space.id }));
    assert.equal(
      (await k.recall(bob, {})).claims.filter((c) => c.scope === "space")
        .length,
      0,
    );
    await s.forget(alice, source.id);
    assert.equal(
      (await k.recall(alice, { includeHistory: true })).claims.length,
      0,
    );
    const payloads = await s.query<{ payload: string }>(
      "MATCH (c:KnowledgeClaim) WHERE c.owner=$user RETURN c.payload AS payload",
      { user: alice.userId },
      true,
    );
    assert.ok(
      payloads.every((c) => c.payload == null),
      "Forgetting scrubs claim content, not just query visibility",
    );
    const snapshots = await s.query<{ payload: string; active: boolean }>(
      "MATCH (p:Publication) WHERE p.owner=$user RETURN p.payload AS payload,p.active AS active",
      { user: alice.userId },
      true,
    );
    assert.ok(snapshots.every((p) => p.payload == null && !p.active));
    const timedSource = (
      await s.remember(alice, {
        ...input("ontology-time-source", "The target date is January 2, 2050."),
        basis: "user_statement",
      })
    ).memory;
    const timed = await k.record(alice, {
      sourceMemoryId: timedSource.id,
      sourceRevision: 1,
      idempotencyKey: "ontology-time-claim",
      entities: [{ key: "goal:timed", type: "goal", name: "Future goal" }],
      claims: [
        {
          subject: "goal:timed",
          predicate: "DUE_AT",
          value: "2050-01-02T00:00:00Z",
          basis: "explicit",
          evidence: "The target date is January 2, 2050.",
          validFrom: "2050-01-01T00:00:00Z",
          validUntil: "2051-01-01T00:00:00Z",
        },
      ],
    });
    assert.equal(
      (await k.recall(alice, { asOf: "2049-12-31T23:59:59Z" })).claims.length,
      0,
    );
    assert.equal(
      (await k.recall(alice, { asOf: "2050-01-01T00:00:00Z" })).claims.length,
      1,
    );
    assert.equal(
      (await k.recall(alice, { asOf: "2051-01-01T00:00:00Z" })).claims.length,
      0,
    );
    const timedPublication = {
      ...pubInput,
      claimId: timed.claimIds[0],
      idempotencyKey: "ontology-time-publish",
    };
    await k.publish(alice, timedPublication);
    await k.publish(alice, { ...timedPublication, enabled: false });
    assert.equal(
      (await k.publish(alice, timedPublication)).published,
      false,
      "A repeated publish cannot resurrect a retracted snapshot",
    );
  } finally {
    await s.graph.delete();
    await s.close();
  }
});

test("own-account demo fixtures preserve privacy, retries, retractions and explicit revocation", async () => {
  const s = await connectMemoryStore({
    ...env,
    FALKORDB_MEMORY_GRAPH: env.FALKORDB_MEMORY_GRAPH + "_own_account",
  });
  const owner: Actor = {
    userId: "user_own_account",
    clientId: "sandbox-fixtures",
    name: "Real Sandbox User",
    email: "owner@example.com",
  };
  const demo: Actor = {
    userId: "user_demo_teammate",
    clientId: "sandbox-fixtures",
    name: "Demo Teammate",
    email: "demo+clerk_test@example.com",
  };
  try {
    const first = await seedWorkspace(s, owner, demo);
    assert.equal(first.demoSharedIds.length, 2);
    const feed = await s.spaceMemories(owner, first.space.id, 1);
    assert.equal(feed.memories.length, 1);
    assert.ok(feed.nextCursor);
    const page2 = await s.spaceMemories(
      owner,
      first.space.id,
      1,
      feed.nextCursor!,
    );
    assert.equal(page2.memories.length, 1);
    assert.equal(page2.nextCursor, null);
    assert.notEqual(feed.memories[0].id, page2.memories[0].id);
    assert.deepEqual(
      new Set([...feed.memories, ...page2.memories].map((m) => m.id)),
      new Set(first.demoSharedIds),
    );
    const emptySpace = await s.createSpace(owner, "Unrelated private space");
    assert.deepEqual(
      (await s.spaceMemories(owner, emptySpace.id)).memories,
      [],
    );
    await assert.rejects(
      s.spaceMemories(
        { userId: "user_outsider", clientId: "test" },
        first.space.id,
      ),
      (e: any) => e.status === 403,
    );
    assert.equal((await s.spaces(owner))[0].role, "owner");
    assert.equal(
      (await s.get(owner, first.demoSharedIds[0])).owner,
      demo.userId,
    );
    await assert.rejects(
      s.get(owner, first.demoPrivateId),
      (e: any) => e.status === 404,
    );
    await assert.rejects(
      s.get(demo, first.ownPrivateId),
      (e: any) => e.status === 404,
    );
    const again = await seedWorkspace(s, owner, demo);
    assert.deepEqual(again, first, "Reruns reuse the space and memory IDs");
    const update = await seedWorkspace(s, owner, demo, {
      demoUpdate: "test-progress-001",
    });
    const retry = await seedWorkspace(s, owner, demo, {
      demoUpdate: "test-progress-001",
    });
    assert.equal(update.demoUpdateId, retry.demoUpdateId);
    await assert.rejects(
      s.revise(owner, update.demoUpdateId, 1, input("foreign-demo-edit")),
      (e: any) => e.status === 403,
    );
    await s.share(
      demo,
      first.demoSharedIds[0],
      first.space.id,
      false,
      "explicit-retraction",
    );
    const afterRetraction = await seedWorkspace(s, owner, demo);
    assert.deepEqual(afterRetraction.demoRetractedIds, [
      first.demoSharedIds[0],
    ]);
    await assert.rejects(s.get(owner, first.demoSharedIds[0]));
    assert.ok(
      !(await s.spaceMemories(owner, first.space.id)).memories.some(
        (m) => m.id === first.demoSharedIds[0],
      ),
    );
    const fresh = await seedWorkspace(s, owner, demo, {
      demoUpdate: "test-progress-002",
    });
    assert.ok(await s.get(owner, fresh.demoUpdateId));
    await s.share(
      owner,
      first.ownPrivateId,
      first.space.id,
      true,
      "owner-chooses-to-share",
    );
    const afterExplicitShare = await seedWorkspace(s, owner, demo, {
      demoUpdate: "after-owner-share-001",
    });
    assert.equal(
      afterExplicitShare.ownPrivateShared,
      true,
      "Demo updates still work after the user explicitly shares their seeded note",
    );
    assert.ok(await s.get(demo, first.ownPrivateId));
    await s.revoke(owner, first.space.id, demo.userId);
    await assert.rejects(
      s.spaceMemories(demo, first.space.id),
      (e: any) => e.status === 403,
    );
    await assert.rejects(seedWorkspace(s, owner, demo), FixtureStateError);
    assert.equal(
      (await s.spaces(demo)).length,
      0,
      "Seeding must not restore a manually revoked member",
    );
    await seedWorkspace(s, owner, demo, { restoreDemoMembership: true });
    assert.equal((await s.spaces(demo))[0].role, "contributor");
  } finally {
    await s.graph.delete();
    await s.close();
  }
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
    for (const stop of ["unsubscribe", "expire"] as const) {
      await events.subscribe(bob, params);
      const memory = (
        await s.remember(
          alice,
          input(`stop-in-flight-${stop}`, "Queued update"),
        )
      ).memory;
      await s.share(alice, memory.id, space.id);
      const before = requests.filter((r) => !r.payload.type).length;
      const claimDelivery = s.claimDelivery.bind(s);
      s.claimDelivery = async (subscription, change) => {
        const claim = await claimDelivery(subscription, change);
        if (subscription.owner === bob.userId) {
          if (stop === "unsubscribe")
            await s.unsubscribe(bob.userId, subscription.id);
          else
            await s.query("MATCH (s:Subscription {id:$id}) SET s.expiresAt=0", {
              id: subscription.id,
            });
        }
        return claim;
      };
      try {
        await events.tick();
      } finally {
        s.claimDelivery = claimDelivery;
      }
      assert.equal(
        requests.filter((r) => !r.payload.type).length,
        before,
        `${stop} after leasing prevents delivery from a stale subscription snapshot`,
      );
      assert.equal(
        (await s.deliveries(bob)).some(
          (d) => d.status === "revoked" && d.memoryId === memory.id,
        ),
        true,
      );
    }
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

test("FalkorDB hybrid search stores vectors, ranks paraphrases and excludes private, revoked, revised and forgotten data", async () => {
  const s = await connectMemoryStore({
    ...env,
    FALKORDB_MEMORY_GRAPH: env.FALKORDB_MEMORY_GRAPH + "_hybrid",
  });
  let calls = 0;
  // Deterministic vectors verify DB/search behavior; real model quality is a separate live benchmark.
  const embedder = {
    signature: "fixture_semantics_v1",
    dimensions: 3,
    async embed(text: string) {
      calls++;
      return /companies|switching jobs|PRIVATE_ALIAS/.test(text)
        ? [1, 0, 0]
        : [0, 1, 0];
    },
  };
  const k = new KnowledgeStore(s, embedder);
  try {
    const source = (
      await s.remember(alice, {
        ...input(
          "hybrid-career-source",
          "Test Person wants to change companies.",
        ),
        basis: "user_statement",
      })
    ).memory;
    const data = {
      sourceMemoryId: source.id,
      sourceRevision: 1,
      idempotencyKey: "hybrid-claims-001",
      entities: [
        {
          key: "p",
          type: "person",
          name: "Test Person",
          aliases: ["PRIVATE_ALIAS"],
        },
        { key: "g", type: "goal", name: "Changing companies" },
      ],
      claims: [
        {
          subject: "p",
          predicate: "WANTS",
          object: "g",
          basis: "explicit",
          evidence: source.text,
        },
      ],
    };
    const saved = await k.record(alice, data);
    assert.equal(saved.searchIndex.indexed, 1);
    const original = (await k.recall(alice, {})).claims[0];
    await s.query(
      `UNWIND range(1,501) AS i MATCH (m:Memory {id:$memory}) CREATE (c:KnowledgeClaim {id:'recent_'+toString(i),owner:$user,subjectId:'unrelated_'+toString(i),objectId:'',status:'active',sourceRevision:1,recordedAt:$now,payload:$payload}) CREATE (c)-[:SUPPORTED_BY]->(m)`,
      {
        memory: source.id,
        user: alice.userId,
        now: Date.now() + 1000,
        payload: JSON.stringify({
          ...original,
          id: "synthetic-recent",
          subject: { ...original.subject, id: "unrelated", name: "Gardening" },
          predicate: "ABOUT",
          object: { ...original.object, name: "Plants", id: "plants" },
          evidence: "Unrelated gardening record",
        }),
      },
    );
    const before = calls;
    await k.record(alice, data);
    assert.equal(
      calls,
      before,
      "Stable document hashes avoid re-embedding retry writes",
    );
    const found = await k.recall(alice, {
      query: "switching jobs",
      personalOnly: true,
    });
    assert.equal(found.semanticSearch, "available");
    assert.equal(
      found.claims[0]?.id,
      saved.claimIds[0],
      "Indexed candidates find the older relevant claim outside the recent-500 window",
    );
    assert.match(found.claims[0].reason, /semantic/);
    assert.equal(
      (await k.recall(bob, { query: "switching jobs" })).claims.length,
      0,
    );
    const space = await s.createSpace(alice, "Hybrid synthetic space");
    const invite = await s.invite(alice, space.id, bob.email!, "reader");
    await s.accept(bob, invite.token);
    const publication = await k.publish(alice, {
      claimId: saved.claimIds[0],
      spaceId: space.id,
      userRequested: true,
      idempotencyKey: "hybrid-publication",
    });
    assert.equal(publication.searchIndex, "indexed");
    const docs = await s.query<{ text: string }>(
      "MATCH (d:KnowledgeSearchDocument)-[:INDEXES]->(p:Publication {id:$id}) RETURN d.text AS text",
      { id: publication.publicationId },
      true,
    );
    assert.ok(docs.length);
    assert.ok(
      !docs[0].text.includes("PRIVATE_ALIAS"),
      "Shared search indexes only the frozen projection",
    );
    assert.equal(
      (await k.recall(bob, { query: "switching jobs", spaceId: space.id }))
        .claims.length,
      1,
    );
    await s.query(
      "MATCH (:Person {id:$user})-[m:MEMBER_OF]->(:Space {id:$space}) SET m.active=false",
      { user: bob.userId, space: space.id },
    );
    assert.equal(
      (await k.recall(bob, { query: "switching jobs" })).claims.length,
      0,
    );
    await k.publish(alice, {
      claimId: saved.claimIds[0],
      spaceId: space.id,
      userRequested: true,
      idempotencyKey: "hybrid-retraction",
      enabled: false,
    });
    assert.equal(
      (
        await s.query(
          "MATCH (d:KnowledgeSearchDocument)-[:INDEXES]->(p:Publication {id:$id}) RETURN d.id",
          { id: publication.publicationId },
          true,
        )
      ).length,
      0,
    );
    await s.revise(alice, source.id, 1, {
      ...input("hybrid-revision", "Test Person likes gardening."),
      basis: "user_statement",
    });
    assert.equal(
      (await k.recall(alice, { query: "switching jobs" })).claims.length,
      0,
      "Outdated vectors cannot restore old assertions",
    );
    await s.forget(alice, source.id);
    assert.equal(
      (await s.query("MATCH (d:KnowledgeSearchDocument) RETURN d.id", {}, true))
        .length,
      0,
      "Forgetting deletes private and publication vectors/text",
    );
  } finally {
    await s.graph.delete();
    await s.close();
  }
});
