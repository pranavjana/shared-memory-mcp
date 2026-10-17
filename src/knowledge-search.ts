import { digest, type Actor, type MemoryStore } from "./memory.js";
import { configuredEmbedder, type Embedder } from "./embeddings.js";
import type { Claim } from "./knowledge.js";

export const claimText = (c: Claim) =>
  [
    c.subject.name,
    ...c.subject.aliases,
    c.predicate.replaceAll("_", " "),
    c.object?.name,
    ...(c.object?.aliases ?? []),
    c.value,
    c.evidence,
  ]
    .filter(Boolean)
    .join(". ");
export const searchTerms = (query: string) =>
  [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter(
      (t) =>
        t.length > 1 &&
        !new Set([
          "the",
          "and",
          "who",
          "what",
          "where",
          "when",
          "does",
          "is",
          "are",
          "was",
          "of",
          "to",
          "for",
          "at",
          "in",
          "my",
          "me",
          "about",
          "tell",
          "do",
          "with",
        ]).has(t),
    )
    .slice(0, 16);
const indexCache = new WeakMap<MemoryStore, Map<string, Promise<void>>>();
const PRIVATE = `MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory) WHERE c.id=$id AND c.owner=$user AND m.deletedAt IS NULL AND c.sourceRevision=m.revision AND c.status IN ['active','disputed']`;
const PUBLIC = `MATCH (:Person {id:$user})-[:MEMBER_OF {active:true}]->(s:Space {id:$space})<-[:PUBLISHED_IN]-(c:Publication)-[:DERIVED_FROM]->(:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory) WHERE c.id=$id AND c.active=true AND m.deletedAt IS NULL`;
export class KnowledgeSearch {
  constructor(
    private store: MemoryStore,
    public embedder: Embedder | undefined = configuredEmbedder(),
  ) {}
  get signature() {
    return this.embedder?.signature ?? "lexical_v1";
  }
  label(scope: string) {
    return "KS_" + digest(scope + ":" + this.signature).slice(0, 32);
  }
  async ensure(scope: string) {
    const label = this.label(scope);
    let cache = indexCache.get(this.store);
    if (!cache) {
      cache = new Map();
      indexCache.set(this.store, cache);
    }
    if (!cache.has(label)) {
      const ready = (async () => {
        try {
          await this.store.query(
            `CREATE FULLTEXT INDEX FOR (d:${label}) ON (d.text)`,
          );
        } catch (e) {
          if (
            !(e instanceof Error) ||
            !/already indexed|already exists/i.test(e.message)
          )
            throw e;
        }
        if (this.embedder) {
          try {
            await this.store.query(
              `CREATE VECTOR INDEX FOR (d:${label}) ON (d.embedding) OPTIONS {dimension:${this.embedder.dimensions},similarityFunction:'cosine',M:16,efConstruction:200,efRuntime:100}`,
            );
          } catch (e) {
            if (
              !(e instanceof Error) ||
              !/already indexed|already exists/i.test(e.message)
            )
              throw e;
          }
        }
      })().catch((e) => {
        cache!.delete(label);
        throw e;
      });
      cache.set(label, ready);
    }
    await cache.get(label);
    return label;
  }
  async index(actor: Actor, claim: Claim) {
    const scope =
      claim.scope === "personal"
        ? "user:" + actor.userId
        : "space:" + claim.spaceId;
    const label = await this.ensure(scope);
    const id = "ks_" + digest(claim.id + ":" + this.signature);
    const text = claimText(claim),
      hash = digest(text);
    const old = await this.store.query<{ hash: string }>(
      "MATCH (d:KnowledgeSearchDocument {id:$id}) RETURN d.hash AS hash",
      { id },
      true,
    );
    if (old[0]?.hash === hash) return "indexed";
    const vector = this.embedder
      ? await this.embedder.embed(text, "document")
      : undefined;
    const guard =
      claim.scope === "personal" ? PRIVATE : PUBLIC + " AND c.owner=$user";
    const rows = await this.store.query<{ id: string }>(
      `${guard}
      MERGE (d:KnowledgeSearchDocument:${label} {id:$doc}) SET d.text=$text,d.hash=$hash,d.signature=$signature
      ${vector ? "SET d.embedding=vecf32($vector)" : ""}
      MERGE (d)-[:INDEXES]->(c) RETURN d.id AS id`,
      {
        id: claim.id,
        user: actor.userId,
        space: claim.spaceId ?? "",
        doc: id,
        text,
        hash,
        signature: this.signature,
        ...(vector ? { vector } : {}),
      },
    );
    return rows.length ? "indexed" : "source_changed";
  }
  async indexIds(actor: Actor, ids: string[]) {
    const rows = await this.store.query<{ payload: string }>(
      `MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory) WHERE c.id IN $ids AND c.owner=$user AND m.deletedAt IS NULL AND c.sourceRevision=m.revision AND c.status IN ['active','disputed'] RETURN c.payload AS payload`,
      { ids, user: actor.userId },
      true,
    );
    let indexed = 0,
      failed = 0;
    // Bounded parallelism, no whole-chat submission, and document hashes avoid repeat charges.
    for (let i = 0; i < rows.length; i += 3)
      await Promise.all(
        rows.slice(i, i + 3).map(async (r) => {
          try {
            if ((await this.index(actor, JSON.parse(r.payload))) === "indexed")
              indexed++;
            else failed++;
          } catch {
            failed++;
          }
        }),
      );
    return {
      indexed,
      pending: failed,
      semantic: this.embedder ? "configured" : "not_configured",
    };
  }
  async backfill(actor: Actor, limit: number) {
    const rows = await this.store.query<{ id: string }>(
      `MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory) WHERE c.owner=$user AND m.deletedAt IS NULL AND c.sourceRevision=m.revision AND c.status IN ['active','disputed']
      OPTIONAL MATCH (d:KnowledgeSearchDocument)-[:INDEXES]->(c) WHERE d.signature=$signature
      WITH c,count(d) AS indexed WHERE indexed=0 RETURN c.id AS id ORDER BY c.recordedAt LIMIT $limit`,
      { user: actor.userId, signature: this.signature, limit: limit + 1 },
      true,
    );
    return {
      ...(await this.indexIds(
        actor,
        rows.slice(0, limit).map((r) => r.id),
      )),
      hasMore: rows.length > limit,
    };
  }
  async search(
    actor: Actor,
    query: string,
    spaceId?: string,
    personalOnly = false,
  ) {
    const scopes = spaceId
      ? [{ scope: "space:" + spaceId, space: spaceId }]
      : [
          { scope: "user:" + actor.userId, space: "" },
          ...(personalOnly ? [] : await this.store.spaces(actor)).map((s) => ({
            scope: "space:" + s.id,
            space: s.id,
          })),
        ];
    let vector: number[] | undefined,
      semantic = this.embedder ? "available" : "not_configured";
    if (this.embedder)
      try {
        vector = await this.embedder.embed(query, "query");
      } catch {
        semantic = "unavailable";
      }
    const terms = searchTerms(query),
      lexical = terms.join("|");
    let truncated = false;
    const hits: {
      claim: Claim;
      channel: "lexical" | "semantic";
      score: number;
    }[] = [];
    for (const scope of scopes) {
      const label = this.label(scope.scope);
      // No index is created by a read; legacy/unindexed records use the ordinary lexical path.
      const exists = await this.store.query<{ id: string }>(
        `MATCH (d:${label}) RETURN d.id AS id LIMIT 1`,
        {},
        true,
      );
      if (!exists.length) continue;
      const guard = scope.space
        ? `MATCH (node)-[:INDEXES]->(c:Publication)-[:PUBLISHED_IN]->(s:Space {id:$space})<-[:MEMBER_OF {active:true}]-(:Person {id:$user}) MATCH (c)-[:DERIVED_FROM]->(:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory) WHERE c.active=true AND m.deletedAt IS NULL`
        : `MATCH (node)-[:INDEXES]->(c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory) WHERE c.owner=$user AND c.sourceRevision=m.revision AND c.status IN ['active','disputed'] AND m.deletedAt IS NULL`;
      const params = {
        label,
        user: actor.userId,
        space: scope.space,
        lexical,
        ...(vector ? { vector } : {}),
      };
      if (lexical) {
        const rows = await this.store.query<{
          payload: string;
          score: number;
          status: string;
        }>(
          `CALL db.idx.fulltext.queryNodes($label,$lexical) YIELD node,score ${guard} RETURN c.payload AS payload,c.status AS status,score ORDER BY score DESC,c.id LIMIT 201`,
          params,
          true,
        );
        if (rows.length >= 201) truncated = true;
        for (const r of rows)
          hits.push({
            claim: { ...JSON.parse(r.payload), status: r.status },
            channel: "lexical",
            score: r.score,
          });
      }
      if (vector) {
        // FalkorDB returns cosine DISTANCE (lower is better), despite the procedure's field name 'score'.
        const rows = await this.store.query<{
          payload: string;
          distance: number;
          status: string;
        }>(
          `CALL db.idx.vector.queryNodes($label,'embedding',200,vecf32($vector)) YIELD node,score ${guard} AND score<=0.32 RETURN c.payload AS payload,c.status AS status,score AS distance ORDER BY distance,c.id LIMIT 100`,
          params,
          true,
        );
        // Exact, authorization-filtered fallback prevents stale indexed revisions starving live results.
        const exact =
          rows.length < 20
            ? await this.store.query<{
                payload: string;
                distance: number;
                status: string;
              }>(
                `MATCH (node:${label}) ${guard} AND node.embedding IS NOT NULL WITH c,vec.cosineDistance(node.embedding,vecf32($vector)) AS distance WHERE distance<=0.32 RETURN c.payload AS payload,c.status AS status,distance ORDER BY distance,c.id LIMIT 100`,
                params,
                true,
              )
            : [];
        if (rows.length >= 100 || exact.length >= 100) truncated = true;
        for (const r of [...rows, ...exact])
          hits.push({
            claim: { ...JSON.parse(r.payload), status: r.status },
            channel: "semantic",
            score: 1 - r.distance,
          });
      }
    }
    return { hits, semantic, truncated };
  }
}
