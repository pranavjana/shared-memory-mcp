import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectMemoryStore, type Actor } from "../src/memory.js";
import { KnowledgeStore } from "../src/knowledge.js";
import type { Embedder } from "../src/embeddings.js";

const owner: Actor = {
  userId: "search_owner",
  name: "Owner",
  clientId: "dot",
  email: "owner@example.com",
};
const reader: Actor = {
  userId: "search_reader",
  name: "Reader",
  clientId: "muse",
  email: "reader@example.com",
};
// Deterministic synthetic vectors: the sandbox runs with embeddings on, so
// space search must work with both full-text and vector indexes present.
const embedder: Embedder = {
  signature: "synthetic-768",
  dimensions: 768,
  async embed(text) {
    const v = Array.from({ length: 768 }, (_, i) => Math.sin(i + text.length));
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  },
};

for (const [label, vectors] of [
  ["lexical only", undefined],
  ["with embeddings", embedder],
] as const)
  test(`space search and get_shared_update work (${label})`, async () => {
    const s = await connectMemoryStore({
      FALKORDB_HOST: "127.0.0.1",
      FALKORDB_PORT: "16379",
      FALKORDB_PASSWORD: "local-verification",
      FALKORDB_MEMORY_GRAPH: "space_search_" + randomUUID().replaceAll("-", ""),
    });
    const k = new KnowledgeStore(s, vectors);
    try {
      const space = await s.createSpace(owner, "Search test");
      await s.accept(
        reader,
        (await s.invite(owner, space.id, reader.email!, "reader")).token,
      );
      const text = "Pranav can't speak Tamil.";
      const m = (
        await s.remember(owner, {
          text,
          evidence: text,
          basis: "user_statement",
          kind: "fact",
          entities: [],
          idempotencyKey: "space-search-01",
        })
      ).memory;
      const r = await k.record(owner, {
        sourceMemoryId: m.id,
        sourceRevision: 1,
        idempotencyKey: "space-search-claims",
        entities: [
          { key: "p", type: "person", name: "Pranav" },
          { key: "t", type: "topic", name: "Tamil" },
        ],
        claims: [
          {
            subject: "p",
            predicate: "HAS_SKILL",
            object: "t",
            negated: true,
            basis: "explicit",
            evidence: text,
          },
        ],
      });
      const pub = await k.publish(owner, {
        claimId: r.claimIds[0],
        spaceId: space.id,
        userRequested: true,
        idempotencyKey: "space-search-publish",
      });
      await s.share(owner, m.id, space.id, true, "space-search-share");
      // A query with terms runs the indexed space search.
      const found = await k.recall(reader, {
        spaceId: space.id,
        query: "Tamil",
        limit: 5,
      });
      assert.ok(found.claims.some((c: any) => c.object?.name === "Tamil"));
      for (const id of [m.id, pub.publicationId]) {
        const update: any = await k.sharedUpdate(reader, id, space.id);
        assert.equal(update.spaceId, space.id);
      }
    } finally {
      await s.graph.delete();
      await s.close();
    }
  });
