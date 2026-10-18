import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectMemoryStore, type Actor } from "../src/memory.js";
import { KnowledgeStore } from "../src/knowledge.js";
import {
  AutomaticOntology,
  type OntologyExtractor,
} from "../src/ontology-extraction.js";
import { memoryTools, runTool } from "../src/tools.js";

const owner: Actor = {
  userId: "space_ontology_owner",
  name: "Owner",
  clientId: "dot",
  email: "owner@example.com",
};
const reader: Actor = {
  userId: "space_ontology_reader",
  name: "Reader",
  clientId: "muse",
  email: "reader@example.com",
};
const connect = () =>
  connectMemoryStore({
    FALKORDB_HOST: "127.0.0.1",
    FALKORDB_PORT: "16379",
    FALKORDB_PASSWORD: "local-verification",
    FALKORDB_MEMORY_GRAPH:
      "space_ontology_verification_" + randomUUID().replaceAll("-", ""),
  });
const save = (idempotencyKey: string, text: string) => ({
  text,
  evidence: text,
  basis: "user_statement",
  kind: "fact",
  entities: [],
  idempotencyKey,
});
// The provider's common mistake: a preference value placed on PREFERENCE_OF.
const preference = (text: string, value: string) => ({
  entities: [
    {
      key: "self",
      type: "person",
      name: "Owner",
      existingKey: null,
      identityEvidence: null,
    },
    {
      key: "pref",
      type: "preference",
      name: "Answer length",
      existingKey: null,
      identityEvidence: null,
    },
  ],
  claims: [
    {
      subject: "pref",
      predicate: "PREFERENCE_OF",
      object: "self",
      value,
      evidence: text,
      validFrom: null,
      validUntil: null,
    },
  ],
});
const spaceClaims = async (k: KnowledgeStore, spaceId: string) =>
  (await k.recall(reader, { spaceId, limit: 50 })).claims
    .map((c: any) => c.predicate + ":" + (c.value ?? c.object?.name))
    .sort();

test("a preference value placed on PREFERENCE_OF is recovered as HAS_VALUE", async () => {
  const s = await connect();
  const extractor: OntologyExtractor = {
    extract: async (c) =>
      preference(
        c.source.text,
        c.source.text.includes("short") ? "short answers" : "invented",
      ),
  };
  const auto = new AutomaticOntology(s, new KnowledgeStore(s), extractor);
  const tools = memoryTools(s, "", auto);
  try {
    const r: any = await runTool(tools, owner, "remember", {
      ...save("space-ontology-pref-01", "I prefer short answers."),
      kind: "preference",
    });
    assert.equal(r.ontology.status, "structured");
    assert.equal(r.ontology.claimIds.length, 2);
    const own = await new KnowledgeStore(s).recall(owner, { limit: 10 });
    assert.deepEqual(
      own.claims
        .map((c: any) => c.predicate + ":" + (c.value ?? c.object.name))
        .sort(),
      ["HAS_VALUE:short answers", "PREFERENCE_OF:Owner"],
    );
    // A value that is not in the source is dropped, never promoted to a claim.
    const g: any = await runTool(tools, owner, "remember", {
      ...save("space-ontology-pref-02", "I prefer long walks."),
      kind: "preference",
    });
    assert.equal(g.ontology.claimIds.length, 1);
  } finally {
    await s.graph.delete();
    await s.close();
  }
});

test("the final failed extraction settles as failed instead of pending forever", async () => {
  const s = await connect();
  const extractor: OntologyExtractor = {
    extract: async () => {
      throw new Error("provider down");
    },
  };
  const auto = new AutomaticOntology(s, new KnowledgeStore(s), extractor);
  try {
    const m = (
      await s.remember(
        owner,
        save("space-ontology-fail-01", "Lee works at Acme."),
      )
    ).memory;
    await s.query("MATCH (j:OntologyJob {id:$id}) SET j.attempts=4", {
      id: m.id + ":1",
    });
    const r = await auto.process(owner, m.id);
    assert.equal(r.status, "failed");
    assert.equal(r.retryScheduled, false);
    assert.equal((await auto.process(owner, m.id)).status, "failed");
  } finally {
    await s.graph.delete();
    await s.close();
  }
});

test("shared memories publish their current claims into the space and follow revisions and retractions", async () => {
  const s = await connect();
  const k = new KnowledgeStore(s);
  const extractor: OntologyExtractor = {
    extract: async (c) => {
      const company = c.source.text.includes("Beta") ? "Beta" : "Acme";
      return {
        entities: [
          {
            key: "lee",
            type: "person",
            name: "Lee",
            existingKey: null,
            identityEvidence: null,
          },
          {
            key: "co",
            type: "organization",
            name: company,
            existingKey: null,
            identityEvidence: null,
          },
        ],
        claims: [
          {
            subject: "lee",
            predicate: "WORKS_AT",
            object: "co",
            value: null,
            evidence: c.source.text,
            validFrom: null,
            validUntil: null,
          },
        ],
      };
    },
  };
  const auto = new AutomaticOntology(s, k, extractor);
  const tools = memoryTools(s, "", auto);
  try {
    const space = await s.createSpace(owner, "Ontology sharing test");
    await s.accept(
      reader,
      (await s.invite(owner, space.id, reader.email!, "reader")).token,
    );
    const saved: any = await runTool(
      tools,
      owner,
      "remember",
      save("space-ontology-share-01", "Lee works at Acme."),
    );
    const id = saved.memory.id;
    // Private until shared.
    assert.deepEqual(await spaceClaims(k, space.id), []);
    const shared: any = await runTool(tools, owner, "share_memory", {
      id,
      spaceId: space.id,
      userRequested: true,
      idempotencyKey: "space-ontology-share-on-01",
    });
    assert.equal(shared.shared, true);
    assert.deepEqual(shared.sharedClaims, { published: 1, retracted: 0 });
    assert.deepEqual(await spaceClaims(k, space.id), ["WORKS_AT:Acme"]);
    // Retrying the same share is idempotent.
    await runTool(tools, owner, "share_memory", {
      id,
      spaceId: space.id,
      userRequested: true,
      idempotencyKey: "space-ontology-share-on-01",
    });
    assert.deepEqual(await spaceClaims(k, space.id), ["WORKS_AT:Acme"]);
    // A revision replaces the derived snapshot instead of leaving the stale claim.
    await runTool(tools, owner, "revise_memory", {
      id,
      expectedRevision: 1,
      memory: save("space-ontology-share-rev-01", "Lee works at Beta."),
    });
    assert.deepEqual(await spaceClaims(k, space.id), ["WORKS_AT:Beta"]);
    // Retracting the memory withdraws its claims; re-sharing restores them.
    await runTool(tools, owner, "share_memory", {
      id,
      spaceId: space.id,
      enabled: false,
      userRequested: true,
      idempotencyKey: "space-ontology-share-off-01",
    });
    assert.deepEqual(await spaceClaims(k, space.id), []);
    await runTool(tools, owner, "share_memory", {
      id,
      spaceId: space.id,
      userRequested: true,
      idempotencyKey: "space-ontology-share-on-02",
    });
    assert.deepEqual(await spaceClaims(k, space.id), ["WORKS_AT:Beta"]);
    // An explicitly published claim of another memory stays frozen and untouched.
    const other: any = await runTool(
      tools,
      owner,
      "remember",
      save("space-ontology-share-02", "Lee works at Acme."),
    );
    await k.publish(owner, {
      claimId: other.ontology.claimIds[0],
      spaceId: space.id,
      userRequested: true,
      idempotencyKey: "space-ontology-explicit-01",
    });
    assert.deepEqual(await k.syncSharedClaims(owner, other.memory.id), {
      published: 0,
      retracted: 0,
    });
    assert.deepEqual(await spaceClaims(k, space.id), [
      "WORKS_AT:Acme",
      "WORKS_AT:Beta",
    ]);
  } finally {
    await s.graph.delete();
    await s.close();
  }
});
