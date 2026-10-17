import { z } from "zod";
import { KnowledgeSearch, claimText, searchTerms } from "./knowledge-search.js";
import type { Embedder } from "./embeddings.js";
import { DomainError, digest, type Actor, type MemoryStore } from "./memory.js";
import {
  knowledgeInputFor,
  knowledgeQuery,
  type KnowledgeInput,
} from "./ontology.js";
import { PredicateRegistry } from "./predicates.js";

type Entity = KnowledgeInput["entities"][number] & {
  id: string;
  /** Set on a shared snapshot when this person is a member of the space. */
  memberId?: string;
};
export interface Claim {
  id: string;
  predicate: string;
  negated?: true;
  subject: Entity;
  object?: Entity;
  value?: string;
  evidence: string;
  basis: string;
  status: string;
  validFrom?: string;
  validUntil?: string;
  sourceMemoryId?: string;
  sourceRevision: number;
  sourceClient: string;
  authorId: string;
  authorName: string;
  recordedAt: number;
  supersedes?: string;
  scope: "personal" | "space";
  spaceId?: string;
  publishedAt?: number;
}
const entityId = (owner: string, type: string, key: string) =>
  "ke_" + digest(JSON.stringify([owner, type, key]));
type Member = { id: string; name: string };
const personName = (s: string) =>
  s.normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g, " ");
/** The space member a shared person mention refers to, when that is unambiguous:
 *  the claim's own author ("self" or their own name), or the only member whose
 *  full or first name matches. Two members with that name link to neither. */
export function memberFor(
  e: Pick<Entity, "type" | "key" | "name">,
  claim: Pick<Claim, "authorId" | "authorName">,
  members: Member[],
) {
  if (e.type !== "person") return;
  const name = personName(e.name);
  const author = members.find((m) => m.id === claim.authorId);
  if (
    author &&
    (e.key === "auto:self" || name === personName(claim.authorName))
  )
    return author;
  const matches = members.filter((m) => {
    const full = personName(m.name ?? "");
    return (
      full === name || (!name.includes(" ") && full.split(" ")[0] === name)
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}
/** A claim entity as it appears in a space: one node per member, otherwise one
 *  node per original entity. Never private aliases or properties. */
const spaceEntity = (
  spaceId: string,
  e: Entity,
  claim: Pick<Claim, "authorId" | "authorName">,
  members: Member[],
): Entity => {
  const member = memberFor(e, claim, members);
  if (!member) {
    const id = entityId(spaceId, e.type, e.id);
    return {
      id,
      key: id,
      type: e.type,
      name: e.name,
      aliases: [],
      properties: {},
    };
  }
  const id = entityId(spaceId, "person", "member:" + member.id);
  return {
    id,
    key: id,
    type: "person",
    name: member.name,
    aliases: personName(e.name) === personName(member.name) ? [] : [e.name],
    properties: {},
    memberId: member.id,
  };
};
export class KnowledgeStore {
  private search: KnowledgeSearch;
  readonly predicates: PredicateRegistry;
  constructor(
    private store: MemoryStore,
    embedder?: Embedder,
  ) {
    this.search = new KnowledgeSearch(store, embedder);
    this.predicates = new PredicateRegistry(store);
  }
  async index(actor: Actor, limit = 20) {
    return this.search.backfill(actor, limit);
  }
  async record(actor: Actor, raw: unknown) {
    const input = knowledgeInputFor(await this.predicates.active()).parse(raw);
    const source = await this.store.get(actor, input.sourceMemoryId);
    if (source.owner !== actor.userId)
      throw new DomainError(
        403,
        "Only the source author can structure their memory",
      );
    if (source.revision !== input.sourceRevision)
      throw new DomainError(
        409,
        "Source changed; retrieve its latest revision",
      );
    for (const c of input.claims) {
      if (
        !source.text.includes(c.evidence) &&
        !source.evidence.includes(c.evidence)
      )
        throw new DomainError(
          400,
          "Claim evidence must be an exact excerpt of this source revision",
        );
      if (c.basis === "explicit" && source.basis !== "user_statement")
        throw new DomainError(
          400,
          "An observed source cannot be relabeled as an explicit user statement",
        );
    }
    const batchId =
      "kb_" + digest(JSON.stringify([actor.userId, input.idempotencyKey]));
    const hash = digest(JSON.stringify(input));
    const existing = await this.store.query<{ hash: string }>(
      "MATCH (b:KnowledgeBatch {id:$id}) RETURN b.requestHash AS hash",
      { id: batchId },
      true,
    );
    if (existing[0]) {
      if (existing[0].hash !== hash)
        throw new DomainError(
          409,
          "This knowledge retry key was already used with different input",
        );
      return {
        saved: true,
        claimIds: input.claims.map((_, i) => batchId + ":" + i),
        receipt: batchId,
        searchIndex: await this.search.indexIds(
          actor,
          input.claims.map((_, i) => batchId + ":" + i),
        ),
      };
    }
    const entities = new Map(
      input.entities.map((e) => [
        e.key,
        { ...e, id: entityId(actor.userId, e.type, e.key) },
      ]),
    );
    const now = Date.now();
    const claims: Claim[] = input.claims.map(
      ({ subject, object, ...c }, i) => ({
        ...c,
        id: batchId + ":" + i,
        subject: entities.get(subject)!,
        ...(object ? { object: entities.get(object)! } : {}),
        sourceMemoryId: source.id,
        sourceRevision: source.revision,
        sourceClient: actor.clientId,
        authorId: actor.userId,
        authorName: actor.name ?? "Member",
        recordedAt: now,
        scope: "personal",
      }),
    );
    const supersedes = claims.flatMap((c) =>
      c.supersedes ? [c.supersedes] : [],
    );
    for (const c of claims.filter((c) => c.supersedes)) {
      const old = await this.store.query<{
        subject: string;
        predicate: string;
        payload: string;
      }>(
        "MATCH (c:KnowledgeClaim {id:$id}) WHERE c.owner=$user AND c.status IN ['active','disputed'] RETURN c.subjectId AS subject,c.predicate AS predicate,c.payload AS payload",
        { id: c.supersedes!, user: actor.userId },
        true,
      );
      if (
        !old[0] ||
        old[0].subject !== c.subject.id ||
        old[0].predicate !== c.predicate
      )
        throw new DomainError(
          400,
          "Supersession must correct your own claim about the same subject and predicate",
        );
      if (
        c.basis === "inferred" &&
        JSON.parse(old[0].payload).basis !== "inferred"
      )
        throw new DomainError(
          400,
          "An inference cannot supersede an explicit or observed assertion",
        );
    }
    const rows = await this.store.query<{ id: string }>(
      `MATCH (m:Memory {id:$memory})-[:HAS_REVISION]->(revision:Revision) WHERE m.owner=$user AND m.deletedAt IS NULL AND m.revision=$revision AND revision.revision=$revision
      OPTIONAL MATCH (old:KnowledgeClaim) WHERE old.id IN $supersedes AND old.owner=$user AND old.status IN ['active','disputed']
      WITH m,revision,collect(old) AS olds WHERE size(olds)=$oldCount
      MERGE (b:KnowledgeBatch {id:$batch}) ON CREATE SET b.requestHash=$hash,b.owner=$user
      WITH m,revision,b,olds WHERE b.requestHash=$hash
      FOREACH (old IN olds | SET old.status='superseded')
      MERGE (b)-[:SUPPORTED_BY]->(m)
      WITH m,revision,b UNWIND $claims AS item
      MERGE (c:KnowledgeClaim {id:item.id}) ON CREATE SET c.owner=$user,c.predicate=item.predicate,c.subjectId=item.subjectId,c.objectId=item.objectId,c.payload=item.payload,c.status=item.status,c.recordedAt=$now,c.sourceRevision=$revision
      MERGE (c)-[:SUPPORTED_BY]->(m) MERGE (c)-[:BASED_ON]->(revision) MERGE (b)-[:CONTAINS]->(c)
      MERGE (subject:KnowledgeEntity {id:item.subjectId}) ON CREATE SET subject.owner=$user,subject.kind=item.subjectType
      MERGE (c)-[:SUBJECT]->(subject)
      FOREACH (_ IN CASE WHEN item.objectId='' THEN [] ELSE [1] END | MERGE (object:KnowledgeEntity {id:item.objectId}) ON CREATE SET object.owner=$user,object.kind=item.objectType MERGE (c)-[:OBJECT]->(object))
      WITH c,item OPTIONAL MATCH (prior:KnowledgeClaim {id:item.supersedes})
      FOREACH (p IN CASE WHEN prior IS NULL THEN [] ELSE [prior] END | MERGE (c)-[:SUPERSEDES]->(p))
      RETURN c.id AS id`,
      {
        memory: source.id,
        user: actor.userId,
        revision: source.revision,
        batch: batchId,
        hash,
        supersedes,
        oldCount: supersedes.length,
        now,
        claims: claims.map((c) => ({
          id: c.id,
          predicate: c.predicate,
          subjectId: c.subject.id,
          subjectType: c.subject.type,
          objectId: c.object?.id ?? "",
          objectType: c.object?.type ?? "",
          payload: JSON.stringify(c),
          status: c.status,
          supersedes: c.supersedes ?? "",
        })),
      },
    );
    if (rows.length !== claims.length)
      throw new DomainError(
        409,
        "Source or superseded claim changed; retrieve current knowledge before retrying",
      );
    // Return IDs in input order, not row order. UNWIND keeps list order, but
    // the later MERGE/OPTIONAL MATCH steps have no ORDER BY, and newer FalkorDB
    // images reorder these rows. Callers map claimIds[i] to claims[i].
    const claimIds = claims.map((c) => c.id);
    return {
      saved: true,
      claimIds,
      receipt: batchId,
      searchIndex: await this.search.indexIds(actor, claimIds),
    };
  }
  async recall(actor: Actor, raw: unknown = {}) {
    const input = knowledgeQuery.parse(raw);
    if (input.spaceId) await this.store.requireSpace(actor, input.spaceId);
    const privateRows = input.spaceId
      ? []
      : await this.store.query<{
          payload: string;
          status: string;
          current: boolean;
        }>(
          `MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory) WHERE c.owner=$user AND m.deletedAt IS NULL AND ($entity='' OR c.subjectId=$entity OR c.objectId=$entity) AND ($history OR (c.sourceRevision=m.revision AND NOT c.status IN ['superseded','retired'])) RETURN c.payload AS payload,c.status AS status,c.sourceRevision=m.revision AS current ORDER BY c.recordedAt DESC,c.id DESC LIMIT 501`,
          {
            user: actor.userId,
            history: input.includeHistory,
            entity: input.entityId ?? "",
          },
          true,
        );
    const shared = input.personalOnly
      ? []
      : await this.store.query<{
          payload: string;
          status: string;
          current: boolean;
        }>(
          `MATCH (:Person {id:$user})-[:MEMBER_OF {active:true}]->(s:Space)<-[:PUBLISHED_IN]-(p:Publication)-[:DERIVED_FROM]->(:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory)
      WHERE p.active=true AND m.deletedAt IS NULL AND ($space='' OR s.id=$space) ${input.entityId ? "WITH p,m MATCH (p)-[:SUBJECT|OBJECT]->(e:KnowledgeEntity {id:$entity})" : ""} RETURN DISTINCT p.payload AS payload,'snapshot' AS status,true AS current ORDER BY p.publishedAt DESC,p.id DESC LIMIT 501`,
          {
            user: actor.userId,
            space: input.spaceId ?? "",
            entity: input.entityId ?? "",
          },
          true,
        );
    const indexed =
      input.query.trim() && !input.entityId
        ? await this.search.search(
            actor,
            input.query,
            input.spaceId,
            input.personalOnly,
          )
        : {
            hits: [],
            truncated: false,
            semantic: this.search.embedder ? "not_requested" : "not_configured",
          };
    const candidates = [
      ...new Map(
        [
          ...privateRows.slice(0, 500).map((r) => ({
            ...JSON.parse(r.payload),
            status: r.status,
            sourceCurrent: r.current,
          })),
          ...shared.slice(0, 500).map((r) => ({
            ...JSON.parse(r.payload),
            publicationSemantics: "frozen_snapshot",
          })),
          ...indexed.hits.map((h) => ({
            ...h.claim,
            ...(h.claim.scope === "space"
              ? { publicationSemantics: "frozen_snapshot" }
              : { sourceCurrent: true }),
          })),
        ].map((c) => [c.id, c]),
      ).values(),
    ] as (Claim & { sourceCurrent?: boolean })[];
    const time = input.asOf ? Date.parse(input.asOf) : Date.now();
    const filtered = candidates.filter(
      (c) =>
        (!input.predicate || c.predicate === input.predicate) &&
        (!c.validFrom || Date.parse(c.validFrom) <= time) &&
        (!c.validUntil || Date.parse(c.validUntil) > time),
    );
    const terms = searchTerms(input.query);
    const nativeLexical = new Map(
      indexed.hits
        .filter((h) => h.channel === "lexical")
        .map((h) => [h.claim.id, h.score]),
    );
    const lexical = filtered
      .map((c) => ({
        claim: c,
        score:
          nativeLexical.get(c.id) ??
          (input.entityId
            ? [c.subject.id, c.object?.id].includes(input.entityId)
              ? 100
              : 0
            : !terms.length
              ? input.query.trim()
                ? 0
                : 1
              : terms.reduce(
                  (n, t) =>
                    n + (claimText(c).toLowerCase().includes(t) ? 1 : 0),
                  0,
                )),
      }))
      .filter((r) => r.score > 0)
      .sort(
        (a, b) =>
          Number(nativeLexical.has(b.claim.id)) -
            Number(nativeLexical.has(a.claim.id)) ||
          b.score - a.score ||
          b.claim.recordedAt - a.claim.recordedAt,
      );
    const validIds = new Set(filtered.map((c) => c.id));
    const semantic = [
      ...new Map(
        indexed.hits
          .filter((h) => h.channel === "semantic" && validIds.has(h.claim.id))
          .map((h) => [h.claim.id, h]),
      ).values(),
    ].sort((a, b) => b.score - a.score);
    // Reciprocal-rank fusion avoids treating TF-IDF, word counts and cosine as comparable scales.
    const ranks = new Map<
      string,
      { claim: Claim; score: number; reason: string; channels: string[] }
    >();
    for (const [channel, ranked] of [
      ["lexical", lexical],
      ["semantic", semantic],
    ] as const)
      ranked.forEach((r, i) => {
        const old = ranks.get(r.claim.id);
        const channels = [...(old?.channels ?? []), channel];
        ranks.set(r.claim.id, {
          claim: r.claim,
          score: (old?.score ?? 0) + 1 / (60 + i + 1),
          channels,
          reason: channels.join(" + ") + " match",
        });
      });
    const seeds = [...ranks.values()].sort(
      (a, b) => b.score - a.score || b.claim.recordedAt - a.claim.recordedAt,
    );
    const ids = new Set(
      seeds
        .slice(0, input.limit)
        .flatMap((c) =>
          [c.claim.subject.id, c.claim.object?.id].filter(
            (id): id is string => typeof id === "string",
          ),
        ),
    );
    const seedIds = new Set(seeds.map((c) => c.claim.id));
    // Fetch neighbors from FalkorDB rather than only the recent listing window.
    const expansionRows: {
      payload: string;
      status: string;
      current: boolean;
    }[] = [];
    if (ids.size && (terms.length || input.entityId)) {
      if (!input.spaceId)
        expansionRows.push(
          ...(await this.store.query<{
            payload: string;
            status: string;
            current: boolean;
          }>(
            `MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory) WHERE c.owner=$user AND m.deletedAt IS NULL AND c.sourceRevision=m.revision AND c.status IN ['active','disputed'] AND (c.subjectId IN $ids OR c.objectId IN $ids) RETURN c.payload AS payload,c.status AS status,true AS current ORDER BY c.recordedAt DESC,c.id LIMIT 201`,
            { user: actor.userId, ids: [...ids] },
            true,
          )),
        );
      if (!input.personalOnly)
        expansionRows.push(
          ...(await this.store.query<{
            payload: string;
            status: string;
            current: boolean;
          }>(
            `MATCH (:Person {id:$user})-[:MEMBER_OF {active:true}]->(s:Space)<-[:PUBLISHED_IN]-(p:Publication)-[:SUBJECT|OBJECT]->(e:KnowledgeEntity), (p)-[:DERIVED_FROM]->(:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory) WHERE p.active=true AND m.deletedAt IS NULL AND ($space='' OR s.id=$space) AND e.id IN $ids RETURN DISTINCT p.payload AS payload,'snapshot' AS status,true AS current ORDER BY p.publishedAt DESC,p.id LIMIT 201`,
            { user: actor.userId, space: input.spaceId ?? "", ids: [...ids] },
            true,
          )),
        );
    }
    const neighbors = [
      ...new Map(
        [
          ...filtered,
          ...expansionRows.map((r) => ({
            ...JSON.parse(r.payload),
            ...(r.status === "snapshot"
              ? { publicationSemantics: "frozen_snapshot" }
              : { status: r.status, sourceCurrent: r.current }),
          })),
        ].map((c) => [c.id, c]),
      ).values(),
    ].filter(
      (c) =>
        (!input.predicate || c.predicate === input.predicate) &&
        (!c.validFrom || Date.parse(c.validFrom) <= time) &&
        (!c.validUntil || Date.parse(c.validUntil) > time),
    );
    const related =
      terms.length || input.entityId
        ? neighbors
            .filter(
              (c) =>
                !seedIds.has(c.id) &&
                (ids.has(c.subject.id) || ids.has(c.object?.id)),
            )
            .map((c) => ({
              claim: c,
              score: 0,
              reason: "Connected through the same scoped entity",
            }))
        : [];
    const selected = [...seeds, ...related].slice(0, input.limit);
    return {
      claims: selected.map((r) => ({ ...r.claim, reason: r.reason })),
      asOf: new Date(time).toISOString(),
      truncated:
        indexed.truncated ||
        privateRows.length > 500 ||
        shared.length > 500 ||
        expansionRows.length > 200 ||
        seeds.length + related.length > input.limit,
      scope:
        input.spaceId ??
        (input.personalOnly ? "personal" : "personal_and_authorized_spaces"),
      retrieval:
        "FalkorDB full-text + Gemini vector search with reciprocal-rank fusion and one-hop scoped entity expansion",
      semanticSearch: indexed.semantic,
      semanticCoverage:
        "Only indexed current claims; older unindexed claims use keyword fallback",
      candidateLimit: 500,
      temporalSemantics:
        "asOf filters known validity bounds; missing validity remains unknown. includeHistory returns earlier assertions, not a resolved historical truth.",
    };
  }
  async sharedUpdate(actor: Actor, id: string, spaceId: string) {
    await this.store.requireSpace(actor, spaceId);
    let update: unknown, query: string;
    if (id.startsWith("pub_")) {
      const [row] = await this.store.query<{ payload: string }>(
        `MATCH (:Person {id:$user})-[:MEMBER_OF {active:true}]->(:Space {id:$space})<-[:PUBLISHED_IN]-(p:Publication {id:$id})-[:DERIVED_FROM]->(:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory) WHERE p.active=true AND m.deletedAt IS NULL RETURN p.payload AS payload`,
        { user: actor.userId, space: spaceId, id },
        true,
      );
      if (!row)
        throw new DomainError(404, "Shared update unavailable or withdrawn");
      const claim = JSON.parse(row.payload) as Claim;
      update = { type: "publication", claim };
      query = [claim.subject.name, claim.object?.name]
        .filter(Boolean)
        .join(" ");
    } else {
      const [row] = await this.store.query<{
        value: import("./memory.js").Memory;
      }>(
        `MATCH (:Person {id:$user})-[:MEMBER_OF {active:true}]->(:Space {id:$space})<-[:SHARED_IN {active:true}]-(m:Memory {id:$id}) WHERE m.deletedAt IS NULL RETURN properties(m) AS value`,
        { user: actor.userId, space: spaceId, id },
        true,
      );
      if (!row)
        throw new DomainError(404, "Shared update unavailable or withdrawn");
      update = { type: "memory", memory: this.store.publicMemory(row.value) };
      query = row.value.text.slice(0, 1000);
    }
    return {
      spaceId,
      update,
      context: await this.recall(actor, { spaceId, query, limit: 5 }),
    };
  }
  /** Keep a shared memory's current claims visible in each space it is shared into.
   *  These snapshots follow the memory: a revision, retraction or re-share replaces them.
   *  Explicitly published claims (publish_claim) stay frozen and are never touched here. */
  async syncSharedClaims(actor: Actor, memoryId: string) {
    const shares = await this.store.query<{
      space: string;
      active: boolean;
      epoch: number | null;
      role: string | null;
    }>(
      `MATCH (m:Memory {id:$id})-[share:SHARED_IN]->(s:Space) WHERE m.owner=$user AND m.deletedAt IS NULL
       OPTIONAL MATCH (:Person {id:$user})-[member:MEMBER_OF {active:true}]->(s)
       RETURN s.id AS space,share.active AS active,share.updatedAt AS epoch,member.role AS role`,
      { id: memoryId, user: actor.userId },
      true,
    );
    if (!shares.length) return { published: 0, retracted: 0 };
    const claims = (
      await this.store.query<{ id: string }>(
        `MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory {id:$id}) WHERE c.owner=$user AND m.deletedAt IS NULL AND c.sourceRevision=m.revision AND c.status IN ['active','disputed'] RETURN c.id AS id ORDER BY c.id`,
        { id: memoryId, user: actor.userId },
        true,
      )
    ).map((r) => r.id);
    // A claim the user already published on its own is not shown a second time.
    const explicit = await this.store.query<{ claim: string; space: string }>(
      `MATCH (p:Publication)-[:DERIVED_FROM]->(c:KnowledgeClaim)-[:SUPPORTED_BY]->(:Memory {id:$id}),(p)-[:PUBLISHED_IN]->(s:Space) WHERE p.owner=$user AND p.active=true AND coalesce(p.viaShare,false)=false RETURN DISTINCT c.id AS claim,s.id AS space`,
      { id: memoryId, user: actor.userId },
      true,
    );
    const existing = await this.store.query<{
      id: string;
      space: string;
      active: boolean;
    }>(
      `MATCH (p:Publication)-[:DERIVED_FROM]->(:KnowledgeClaim)-[:SUPPORTED_BY]->(:Memory {id:$id}),(p)-[:PUBLISHED_IN]->(s:Space) WHERE p.owner=$user AND p.viaShare=true RETURN DISTINCT p.id AS id,s.id AS space,p.active AS active`,
      { id: memoryId, user: actor.userId },
      true,
    );
    let published = 0,
      retracted = 0;
    for (const share of shares) {
      // A former member can neither publish nor retract in that space.
      if (!share.role) continue;
      const writable =
        share.active && ["owner", "contributor"].includes(share.role);
      // Each share epoch gets fresh snapshot IDs, so re-sharing never needs to revive a retraction.
      const wanted = new Map(
        (writable ? claims : [])
          .filter(
            (claim) =>
              !explicit.some(
                (e) => e.claim === claim && e.space === share.space,
              ),
          )
          .map((claim) => [
            "pub_" +
              digest(
                JSON.stringify([share.space, claim, "share", share.epoch ?? 0]),
              ),
            claim,
          ]),
      );
      for (const [publicationId, claimId] of wanted) {
        if (existing.some((p) => p.id === publicationId)) continue;
        await this.publish(
          actor,
          {
            claimId,
            spaceId: share.space,
            userRequested: true,
            idempotencyKey: "memory-share:" + publicationId,
          },
          { publicationId, viaShare: true },
        );
        published++;
      }
      for (const p of existing)
        if (p.space === share.space && p.active && !wanted.has(p.id)) {
          await this.publish(actor, {
            claimId: p.id,
            spaceId: share.space,
            enabled: false,
            userRequested: true,
            idempotencyKey: "memory-share:" + p.id + ":retract",
          });
          retracted++;
        }
    }
    return { published, retracted };
  }
  private spaceMembers(spaceId: string) {
    return this.store.query<Member>(
      "MATCH (p:Person)-[:MEMBER_OF {active:true}]->(:Space {id:$space}) RETURN p.id AS id,p.name AS name",
      { space: spaceId },
      true,
    );
  }
  /** Re-resolve people in a space's snapshots after membership changes, so every
   *  mention of a member is one node. Only entity identity changes; the assertion,
   *  evidence and attribution of each snapshot stay as published. */
  async relinkSpace(spaceId: string) {
    const members = await this.spaceMembers(spaceId);
    const rows = await this.store.query<{
      id: string;
      owner: string;
      payload: string;
      source: string;
    }>(
      `MATCH (:Space {id:$space})<-[:PUBLISHED_IN]-(p:Publication)-[:DERIVED_FROM]->(c:KnowledgeClaim) WHERE p.active=true RETURN p.id AS id,p.owner AS owner,p.payload AS payload,c.payload AS source`,
      { space: spaceId },
      true,
    );
    let relinked = 0;
    for (const row of rows) {
      const snapshot = JSON.parse(row.payload) as Claim;
      const source = JSON.parse(row.source) as Claim;
      const subject = spaceEntity(spaceId, source.subject, snapshot, members);
      const object = source.object
        ? spaceEntity(spaceId, source.object, snapshot, members)
        : undefined;
      if (
        subject.id === snapshot.subject.id &&
        subject.name === snapshot.subject.name &&
        object?.id === snapshot.object?.id &&
        object?.name === snapshot.object?.name
      )
        continue;
      const updated: Claim = {
        ...snapshot,
        subject,
        ...(object ? { object } : {}),
      };
      await this.store.query(
        `MATCH (p:Publication {id:$id}) SET p.payload=$payload
         WITH p OPTIONAL MATCH (p)-[r:SUBJECT|OBJECT]->() DELETE r
         WITH DISTINCT p MERGE (subject:KnowledgeEntity {id:$subjectId}) ON CREATE SET subject.kind=$subjectType,subject.spaceId=$space
         MERGE (p)-[:SUBJECT]->(subject)
         FOREACH (_ IN CASE WHEN $objectId='' THEN [] ELSE [1] END | MERGE (object:KnowledgeEntity {id:$objectId}) ON CREATE SET object.kind=$objectType,object.spaceId=$space MERGE (p)-[:OBJECT]->(object))`,
        {
          id: row.id,
          space: spaceId,
          payload: JSON.stringify(updated),
          subjectId: subject.id,
          subjectType: subject.type,
          objectId: object?.id ?? "",
          objectType: object?.type ?? "",
        },
      );
      await this.search
        .index({ userId: row.owner, clientId: "relink" }, updated)
        .catch(() => undefined);
      relinked++;
    }
    return { relinked };
  }
  async publish(
    actor: Actor,
    raw: unknown,
    internal: { publicationId?: string; viaShare?: boolean } = {},
  ) {
    const input = z
      .object({
        claimId: z.string().min(1),
        spaceId: z.string().min(1),
        enabled: z.boolean().default(true),
        userRequested: z.literal(true),
        idempotencyKey: z.string().min(8).max(200),
      })
      .strict()
      .parse(raw);
    await this.store.requireSpace(actor, input.spaceId, input.enabled);
    const publicationId =
      internal.publicationId ??
      (!input.enabled && input.claimId.startsWith("pub_")
        ? input.claimId
        : "pub_" + digest(JSON.stringify([input.spaceId, input.claimId])));
    const eventId =
      "evt_" +
      digest(publicationId + (input.enabled ? ":published" : ":retracted"));
    if (!input.enabled) {
      const rows = await this.store.query<{ id: string }>(
        `MATCH (p:Publication {id:$id})-[:PUBLISHED_IN]->(s:Space {id:$space})<-[:MEMBER_OF {active:true}]-(:Person {id:$user}) WHERE p.owner=$user
         WITH p,p.active AS wasActive SET p.active=false
         FOREACH (_ IN CASE WHEN wasActive THEN [1] ELSE [] END | MERGE (event:Change {id:$event}) ON CREATE SET event.publicationId=p.id,event.spaceId=$space,event.actorId=$user,event.actorName=$name,event.clientId=$client,event.revision=coalesce(p.sourceRevision,0),event.kind='retracted',event.createdAt=$now)
         RETURN p.id AS id`,
        {
          id: publicationId,
          user: actor.userId,
          space: input.spaceId,
          event: eventId,
          name: actor.name ?? "Member",
          client: actor.clientId,
          now: Date.now(),
        },
      );
      if (!rows[0]) throw new DomainError(404, "Publication not found");
      await this.store.query(
        "MATCH (d:KnowledgeSearchDocument)-[:INDEXES]->(p:Publication {id:$id}) DETACH DELETE d",
        { id: publicationId },
      );
      return { published: false, publicationId, spaceId: input.spaceId };
    }
    const rows = await this.store.query<{ payload: string }>(
      `MATCH (c:KnowledgeClaim {id:$id})-[:SUPPORTED_BY]->(m:Memory) WHERE c.owner=$user AND m.deletedAt IS NULL AND c.sourceRevision=m.revision AND c.status IN ['active','disputed'] RETURN c.payload AS payload`,
      { id: input.claimId, user: actor.userId },
      true,
    );
    if (!rows[0])
      throw new DomainError(404, "Current authored claim not found");
    const c = JSON.parse(rows[0].payload) as Claim;
    const members = await this.spaceMembers(input.spaceId);
    const sharedEntity = (e: Entity) =>
      spaceEntity(input.spaceId, e, c, members);
    // Publish only the selected assertion and its entity names, never private aliases,
    // entity properties, source IDs, replacement IDs, or adjacent source text.
    const snapshot: Claim = {
      id: publicationId,
      predicate: c.predicate,
      ...(c.negated ? { negated: true as const } : {}),
      subject: sharedEntity(c.subject),
      ...(c.object ? { object: sharedEntity(c.object) } : {}),
      ...(c.value ? { value: c.value } : {}),
      evidence: c.evidence,
      basis: c.basis,
      status: c.status,
      ...(c.validFrom ? { validFrom: c.validFrom } : {}),
      ...(c.validUntil ? { validUntil: c.validUntil } : {}),
      sourceRevision: c.sourceRevision,
      sourceClient: c.sourceClient,
      authorId: c.authorId,
      authorName: c.authorName,
      recordedAt: c.recordedAt,
      scope: "space",
      spaceId: input.spaceId,
      publishedAt: Date.now(),
    };
    const operation = digest(
      JSON.stringify([actor.userId, input.idempotencyKey]),
    );
    const receipt = await this.store.query<{ id: string; active: boolean }>(
      `MATCH (c:KnowledgeClaim {id:$claim})-[:SUPPORTED_BY]->(m:Memory),(:Person {id:$user})-[member:MEMBER_OF {active:true}]->(s:Space {id:$space})
      WHERE c.owner=$user AND c.status IN ['active','disputed'] AND c.sourceRevision=m.revision AND m.deletedAt IS NULL AND member.role IN ['owner','contributor']
      MERGE (p:Publication {id:$id}) ON CREATE SET p.owner=$user,p.payload=$payload,p.publishedAt=$now,p.operation=$operation,p.active=true,p.sourceRevision=$revision,p.viaShare=$viaShare
      MERGE (p)-[:DERIVED_FROM]->(c) MERGE (p)-[:PUBLISHED_IN]->(s)
      FOREACH (_ IN CASE WHEN p.active THEN [1] ELSE [] END | MERGE (event:Change {id:$event}) ON CREATE SET event.publicationId=p.id,event.spaceId=$space,event.actorId=$user,event.actorName=$name,event.clientId=$client,event.revision=$revision,event.kind='published',event.createdAt=$now)
      MERGE (subject:KnowledgeEntity {id:$subjectId}) ON CREATE SET subject.kind=$subjectType,subject.spaceId=$space
      MERGE (p)-[:SUBJECT]->(subject)
      FOREACH (_ IN CASE WHEN $objectId='' THEN [] ELSE [1] END | MERGE (object:KnowledgeEntity {id:$objectId}) ON CREATE SET object.kind=$objectType,object.spaceId=$space MERGE (p)-[:OBJECT]->(object))
      RETURN p.id AS id,p.active AS active`,
      {
        claim: input.claimId,
        user: actor.userId,
        space: input.spaceId,
        id: publicationId,
        payload: JSON.stringify(snapshot),
        now: snapshot.publishedAt!,
        operation,
        event: eventId,
        name: actor.name ?? "Member",
        client: actor.clientId,
        revision: snapshot.sourceRevision,
        subjectId: snapshot.subject.id,
        subjectType: snapshot.subject.type,
        objectId: snapshot.object?.id ?? "",
        objectType: snapshot.object?.type ?? "",
        viaShare: internal.viaShare === true,
      },
    );
    if (!receipt[0])
      throw new DomainError(409, "Claim or sharing permission changed");
    // A retry cannot reactivate a withdrawn publication. Publish a new source claim
    // to issue an updated snapshot, rather than mutating what recipients saw.
    return {
      searchIndex: receipt[0].active
        ? await this.search.index(actor, snapshot).catch(() => "pending")
        : "inactive",
      published: receipt[0].active,
      publicationId,
      spaceId: input.spaceId,
      snapshot: true,
      eventId: receipt[0].active ? eventId : null,
    };
  }
}
