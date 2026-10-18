import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectMemoryStore } from "../src/memory.js";
import { KnowledgeStore } from "../src/knowledge.js";
// @ts-expect-error plain ESM operator script
import { seedDemoOntology } from "../scripts/sandbox-demo-ontology.mjs";

test("demo ontology seed writes valid, connected claims once and leaves no extraction pending", async () => {
  const store = await connectMemoryStore({
    FALKORDB_HOST: "127.0.0.1",
    FALKORDB_PORT: "16379",
    FALKORDB_PASSWORD: "local-verification",
    FALKORDB_MEMORY_GRAPH: "demo_ontology_" + randomUUID().replaceAll("-", ""),
  });
  const knowledge = new KnowledgeStore(store, undefined);
  const owner = { userId: "user_owner", name: "Pranav Janakiraman" };
  const clients = {
    chatgpt: "https://chatgpt.com/oauth/client.json",
    codex: "https://chatgpt.com/oauth/codex/client.json",
    muse: "muse-client",
  };
  try {
    const dry = await seedDemoOntology(store, knowledge, owner, clients);
    assert.equal(dry.applied, false);
    assert.equal(
      (await store.recall({ ...owner, clientId: "x" }, "", 50)).memories.length,
      0,
      "dry run writes nothing",
    );
    const first = await seedDemoOntology(store, knowledge, owner, clients, {
      apply: true,
    });
    assert.equal(first.memories, dry.memories);
    assert.equal(first.claims, dry.claims);
    const again = await seedDemoOntology(store, knowledge, owner, clients, {
      apply: true,
    });
    assert.deepEqual(again, first, "rerun is idempotent");

    const actor = { ...owner, clientId: clients.chatgpt };
    const memories = (await store.recall(actor, "", 50)).memories;
    assert.equal(memories.length, first.memories);
    assert.deepEqual(
      [...new Set(memories.map((m) => m.sourceClient))].sort(),
      Object.values(clients).sort(),
    );
    const claims = await store.query<{ n: number }>(
      "MATCH (c:KnowledgeClaim) WHERE c.owner=$user RETURN count(c) AS n",
      { user: owner.userId },
      true,
    );
    assert.equal(claims[0].n, first.claims, "no duplicate claims on rerun");
    const pending = await store.query<{ n: number }>(
      "MATCH (j:OntologyJob) WHERE j.owner=$user AND j.status<>'structured' RETURN count(j) AS n",
      { user: owner.userId },
      true,
    );
    assert.equal(pending[0].n, 0, "worker has nothing to re-extract");
    const status = await store.ontologyStatus(
      actor,
      memories.map((m) => m.id),
    );
    assert.ok(Object.values(status).every((s) => s === "structured"));

    const recalled = await knowledge.recall(actor, {
      query: "Maya",
      limit: 50,
    });
    const predicates = recalled.claims.map((c: any) => c.predicate);
    assert.ok(predicates.includes("WORKS_AT"));
    assert.ok(
      recalled.claims.some(
        (c: any) => c.predicate === "WORKS_ON" && c.negated === true,
      ),
      "negated claim stays negated",
    );
    // Reused keys connect Maya across several memories into one entity.
    const mayaIds = new Set(
      recalled.claims
        .flatMap((c: any) => [c.subject, c.object])
        .filter((e: any) => e?.name === "Maya Chen")
        .map((e: any) => e.id),
    );
    assert.equal(mayaIds.size, 1);
  } finally {
    await store.graph.delete();
    await store.close();
  }
});
