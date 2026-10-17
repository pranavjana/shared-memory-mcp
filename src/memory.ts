import { createHash, randomUUID } from "node:crypto";
import { FalkorDB, ConstraintType, EntityType } from "falkordb";
type QueryParams = NonNullable<
  NonNullable<
    Parameters<ReturnType<FalkorDB["selectGraph"]>["query"]>[1]
  >["params"]
>;
import { z } from "zod";
import { entityTypes } from "./ontology.js";
import {
  defaultPreferences,
  isDue,
  parsePreferences,
  type Preferences,
} from "./preferences.js";

export const kinds = [
  "fact",
  "preference",
  "event",
  "goal",
  "task",
  "decision",
  "relationship",
] as const;
export const entitySchema = z
  .object({
    type: z.enum(entityTypes),
    name: z.string().trim().min(1).max(120),
  })
  .strict();
export const memoryInput = z
  .object({
    text: z.string().trim().min(1).max(6000),
    kind: z.enum(kinds),
    basis: z.enum(["user_statement", "observed_outcome"]),
    entities: z.array(entitySchema).max(20).default([]),
    evidence: z.string().trim().min(1).max(6000),
    eventAt: z.string().datetime({ offset: true }).optional(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();
export type MemoryInput = z.infer<typeof memoryInput>;
export interface Actor {
  userId: string;
  clientId: string;
  name?: string | null;
  email?: string | null;
  token?: string;
  expiresAt?: number;
}
export interface Memory {
  id: string;
  owner: string;
  authorName: string;
  kind: string;
  text: string;
  basis: string;
  entities: string;
  evidence: string;
  sourceClient: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  eventAt: string | null;
  deletedAt: number | null;
  requestHash: string;
}
export interface Space {
  id: string;
  name: string;
  owner: string;
  createdAt: number;
  role?: string;
}
export interface Change {
  id: string;
  memoryId?: string;
  publicationId?: string;
  spaceId: string;
  actorId: string;
  actorName: string;
  clientId: string;
  revision: number;
  kind: string;
  createdAt: number;
}
export interface InboxItem {
  changeId: string;
  kind: string;
  spaceId: string;
  spaceName: string;
  actorName: string;
  createdAt: number;
  seen: boolean;
  /** The update names the reader; "confirmed" once the reader said that name is them. */
  aboutYou: { status: "possible" | "confirmed"; name: string } | null;
  /** Whether it should interrupt the reader now under their notification preferences. */
  dueNow: boolean;
  update:
    | { type: "memory"; memory: ReturnType<MemoryStore["publicMemory"]> }
    | { type: "publication"; publicationId: string; claim: unknown };
}
// Inbox reads are bounded: only the most recent changes in the reader's
// spaces are considered, which keeps every tool-result footer cheap.
const INBOX_WINDOW = 500;
/** Names a reader is likely called by: their full name and their first name. */
function ownNames(fullName: string) {
  const full = fullName.normalize("NFKC").trim();
  const first = full.split(/\s+/)[0] ?? "";
  return [...new Set([full, first].filter((n) => n.length >= 2))];
}
function mentionText(update: InboxItem["update"]) {
  if (update.type === "memory")
    return [
      update.memory.text,
      ...((update.memory.entities ?? []) as { name?: string }[]).map((e) => e.name ?? ""),
    ].join(" \n ");
  const claim = update.claim as {
    subject?: { name?: string };
    object?: { name?: string };
    value?: string;
  };
  return [claim.subject?.name, claim.object?.name, claim.value].filter(Boolean).join(" \n ");
}
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Finds the reader's name as a whole word in an update. A name match alone is
 * only "possible"; it becomes "confirmed" after the reader says that author's
 * use of the name means them, and a "not me" answer suppresses it.
 */
function mentionOf(
  reader: { names: string[]; links: { author: string; name: string; isMe: boolean }[] },
  author: string,
  text: string,
): InboxItem["aboutYou"] {
  const fromAuthor = reader.links.filter((l) => l.author === author);
  const candidates = [
    ...new Set([...reader.names, ...fromAuthor.filter((l) => l.isMe).map((l) => l.name)]),
  ];
  const haystack = text.normalize("NFKC");
  let possible: string | null = null;
  for (const name of candidates) {
    const answer = fromAuthor.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (answer && !answer.isMe) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "iu");
    if (!pattern.test(haystack)) continue;
    if (answer?.isMe) return { status: "confirmed", name };
    possible ??= name;
  }
  return possible ? { status: "possible", name: possible } : null;
}
export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const access = (extra = "") =>
  `OPTIONAL MATCH (m)-[:SHARED_IN {active:true}]->(:Space)<-[membership:MEMBER_OF {active:true}]-(:Person {id:$user}) WITH m${extra},count(membership) AS memberships WHERE m.deletedAt IS NULL AND (m.owner=$user OR memberships>0)`;
export class MemoryStore {
  private changeListeners = new Set<() => void>();
  constructor(
    public db: FalkorDB,
    public graphName: string,
  ) {}
  /** Called after a committed share, revision or publication so delivery can start immediately. */
  onChange(listener: () => void) {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }
  emitChange() {
    for (const listener of this.changeListeners) {
      // A failing listener must never fail the write that already committed.
      try {
        listener();
      } catch {
        console.error("Change listener failed");
      }
    }
  }
  get graph() {
    return this.db.selectGraph(this.graphName);
  }
  async query<T = Record<string, unknown>>(
    cypher: string,
    params: QueryParams = {},
    read = false,
  ): Promise<T[]> {
    const result = await (read
      ? this.graph.roQuery<T>(cypher, { params })
      : this.graph.query<T>(cypher, { params }));
    return result.data ?? [];
  }
  async init() {
    for (const label of [
      "Person",
      "Memory",
      "Revision",
      "Entity",
      "Space",
      "Invitation",
      "Change",
      "Connection",
      "SharingRule",
      "KnowledgeSearchDocument",
      "KnowledgeClaim",
      "KnowledgeEntity",
      "KnowledgeBatch",
      "OntologyJob",
      "Publication",
      "Doorbell",
      "DoorbellRing",
      "PulseLink",
      "IdentityLink",
    ]) {
      try {
        await this.graph.createNodeRangeIndex(label, "id");
      } catch (e) {
        if (!(e instanceof Error) || !/already indexed/i.test(e.message))
          throw e;
      }
      const constraints = await this.query<{
        label: string;
        properties: string[];
        type: string;
        status: string;
      }>("CALL db.constraints()", {}, true);
      if (
        !constraints.some(
          (c) =>
            c.label === label &&
            c.type === "UNIQUE" &&
            c.properties[0] === "id",
        )
      ) {
        try {
          await this.graph.constraintCreate(
            ConstraintType.UNIQUE,
            EntityType.NODE,
            label,
            "id",
          );
        } catch (e) {
          if (!(e instanceof Error) || !/already exists/i.test(e.message))
            throw e;
        }
      }
    }
    // Webhook event subscriptions were removed; clear stored callback secrets and grants.
    await this.query(
      `MATCH (s:Subscription) WHERE s.active=true OR s.secret IS NOT NULL OR s.previousSecret IS NOT NULL OR s.grantToken IS NOT NULL SET s.active=false,s.secret=NULL,s.previousSecret=NULL,s.grantToken=NULL`,
    );
    // Inbox reads filter changes by space; pulse reads look links up by token hash.
    for (const [label, property] of [
      ["Change", "spaceId"],
      ["PulseLink", "tokenHash"],
    ])
      try {
        await this.graph.createNodeRangeIndex(label, property);
      } catch (e) {
        // The pinned server says "already indexed"; FalkorDB's client docs say "already exists".
        if (!(e instanceof Error) || !/already (indexed|exists)/i.test(e.message))
          throw e;
      }
    for (let attempt = 0; attempt < 100; attempt++) {
      const cs = await this.query<{ status: string }>(
        "CALL db.constraints()",
        {},
        true,
      );
      if (cs.some((c) => c.status === "FAILED"))
        throw new Error("Memory schema constraint failed");
      if (cs.every((c) => c.status === "OPERATIONAL")) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Memory schema is not ready");
  }
  async get(actor: Actor, id: string) {
    const rows = await this.query<{ value: Memory }>(
      `MATCH (m:Memory {id:$id}) ${access()} RETURN properties(m) AS value`,
      { id, user: actor.userId },
      true,
    );
    if (!rows[0]) throw new DomainError(404, "Memory not found");
    return rows[0].value;
  }
  async remember(actor: Actor, raw: unknown) {
    const input = memoryInput.parse(raw);
    const now = Date.now();
    const id =
      "mem_" + digest(actor.userId + "|" + input.idempotencyKey).slice(0, 32);
    const hash = digest(JSON.stringify(input));
    const entityIds = input.entities.map((e) =>
      digest(
        actor.userId +
          "|" +
          e.type +
          "|" +
          e.name.normalize("NFKC").toLowerCase(),
      ),
    );
    const rows = await this.query<{ value: Memory }>(
      `MERGE (p:Person {id:$user}) SET p.name=$name
      MERGE (m:Memory {id:$id}) ON CREATE SET m.owner=$user,m.authorName=$name,m.kind=$kind,m.text=$text,m.basis=$basis,m.entities=$entities,
        m.evidence=$evidence,m.sourceClient=$client,m.revision=1,m.createdAt=$now,m.updatedAt=$now,m.eventAt=$eventAt,m.requestHash=$hash
      WITH p,m WHERE m.deletedAt IS NULL AND m.requestHash=$hash
      MERGE (p)-[:AUTHORED]->(m)
      MERGE (r:Revision {id:$revisionId}) ON CREATE SET r.text=m.text,r.kind=m.kind,r.basis=m.basis,r.entities=m.entities,r.evidence=m.evidence,r.sourceClient=m.sourceClient,r.revision=1,r.createdAt=$now,r.eventAt=m.eventAt
      MERGE (m)-[:HAS_REVISION]->(r)
      MERGE (job:OntologyJob {id:$revisionId}) ON CREATE SET job.owner=$user,job.revision=1,job.status='pending',job.attempts=0,job.nextAt=0
      MERGE (job)-[:SUPPORTED_BY]->(m)
      FOREACH (i IN range(0,size($entityIds)-1) | MERGE (e:Entity {id:$entityIds[i]}) ON CREATE SET e.name=$names[i],e.kind=$types[i] MERGE (m)-[:ABOUT]->(e))
      RETURN properties(m) AS value`,
      {
        user: actor.userId,
        name: actor.name ?? "Member",
        id,
        revisionId: id + ":1",
        kind: input.kind,
        text: input.text,
        basis: input.basis,
        entities: JSON.stringify(input.entities),
        entityIds,
        names: input.entities.map((e) => e.name),
        types: input.entities.map((e) => e.type),
        evidence: input.evidence,
        client: actor.clientId,
        now,
        eventAt: input.eventAt ?? null,
        hash,
      },
    );
    if (!rows[0])
      throw new DomainError(
        409,
        "This retry key was already used or forgotten; use a new key for a new memory",
      );
    return { saved: true, memory: rows[0].value, receipt: id + ":1" };
  }
  async recall(actor: Actor, query = "", limit = 20) {
    const terms = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1)
      .slice(0, 12);
    const params = {
      user: actor.userId,
      terms,
      limit: Math.min(50, Math.max(1, limit)),
    };
    const seeds = await this.query<{ value: Memory }>(
      `MATCH (m:Memory) ${access()} AND (size($terms)=0 OR any(t IN $terms WHERE toLower(m.text) CONTAINS t OR toLower(m.entities) CONTAINS t OR toLower(m.authorName) CONTAINS t)) RETURN properties(m) AS value ORDER BY m.updatedAt DESC LIMIT $limit`,
      params,
      true,
    );
    const related =
      seeds.length && terms.length
        ? await this.query<{ value: Memory; entity: string }>(
            `MATCH (seed:Memory)-[:ABOUT]->(e:Entity)<-[:ABOUT]-(m:Memory) WHERE seed.id IN $ids AND NOT m.id IN $ids WITH DISTINCT m,e ${access(",e")} RETURN DISTINCT properties(m) AS value,e.name AS entity ORDER BY m.updatedAt DESC LIMIT 10`,
            { user: actor.userId, ids: seeds.map((s) => s.value.id) },
            true,
          )
        : [];
    const sharedRelated =
      seeds.length && terms.length
        ? await this.query<{ value: Memory; entity: string }>(
            `MATCH (seed:Memory)-[:SHARED_IN {active:true}]->(s:Space)<-[:SHARED_IN {active:true}]-(m:Memory) WHERE seed.id IN $ids AND NOT m.id IN $ids WITH DISTINCT m,s ${access(",s")} RETURN DISTINCT properties(m) AS value,s.name AS entity ORDER BY m.updatedAt DESC LIMIT 10`,
            { user: actor.userId, ids: seeds.map((s) => s.value.id) },
            true,
          )
        : [];
    const connected = [
      ...new Map(
        [...related, ...sharedRelated].map((r) => [r.value.id, r]),
      ).values(),
    ];
    return {
      memories: seeds.map((s) => ({
        ...this.publicMemory(s.value),
        reason: "Matched content or entity",
      })),
      related: connected.map((r) => ({
        ...this.publicMemory(r.value),
        reason: "Connected through " + r.entity,
      })),
      query,
    };
  }
  publicMemory(m: Memory) {
    const { requestHash: _, entities, ...rest } = m;
    return { ...rest, entities: JSON.parse(entities) };
  }
  async explain(actor: Actor, id: string) {
    const m = await this.get(actor, id);
    const revisions =
      m.owner === actor.userId
        ? await this.query<{ value: Record<string, unknown> }>(
            `MATCH (:Memory {id:$id})-[:HAS_REVISION]->(r:Revision) RETURN properties(r) AS value ORDER BY r.revision DESC`,
            { id },
            true,
          )
        : [];
    return {
      memory: this.publicMemory(m),
      history: revisions.map((r) => ({
        ...r.value,
        entities: JSON.parse(String(r.value.entities ?? "[]")),
      })),
      historyAvailable: m.owner === actor.userId,
    };
  }
  async revise(
    actor: Actor,
    id: string,
    expectedRevision: number,
    raw: unknown,
  ) {
    const input = memoryInput.parse(raw);
    const now = Date.now();
    const rev = expectedRevision + 1;
    const revisionId = id + ":" + rev;
    const hash = digest(JSON.stringify(input));
    const previous = await this.get(actor, id);
    if (previous.owner !== actor.userId)
      throw new DomainError(403, "Only the author can revise a memory");
    const replay = await this.query<{ hash: string }>(
      `MATCH (m:Memory {id:$id})-[:HAS_REVISION]->(r:Revision {id:$rid}) WHERE m.owner=$user RETURN r.requestHash AS hash`,
      { id, rid: revisionId, user: actor.userId },
      true,
    );
    if (replay[0]?.hash === hash)
      return {
        saved: true,
        memory: this.publicMemory(previous),
        receipt: revisionId,
      };
    const rows = await this.query<{ value: Memory }>(
      `MATCH (m:Memory {id:$id}) WHERE m.owner=$user AND m.deletedAt IS NULL AND m.revision=$expected
      SET m.text=$text,m.kind=$kind,m.basis=$basis,m.entities=$entities,m.evidence=$evidence,m.eventAt=$eventAt,m.sourceClient=$client,m.updatedAt=$now,m.revision=$rev
      CREATE (r:Revision {id:$rid,text:$text,kind:$kind,basis:$basis,entities:$entities,evidence:$evidence,eventAt:$eventAt,sourceClient:$client,createdAt:$now,revision:$rev,requestHash:$hash})
      CREATE (m)-[:HAS_REVISION]->(r)
      CREATE (job:OntologyJob {id:$rid,owner:$user,revision:$rev,status:'pending',attempts:0,nextAt:0})
      CREATE (job)-[:SUPPORTED_BY]->(m)
      WITH m OPTIONAL MATCH (m)-[link:ABOUT]->(:Entity) DELETE link
      WITH DISTINCT m
      FOREACH (i IN range(0,size($entityIds)-1) | MERGE (e:Entity {id:$entityIds[i]}) ON CREATE SET e.name=$names[i],e.kind=$types[i] MERGE (m)-[:ABOUT]->(e))
      WITH m OPTIONAL MATCH (m)-[share:SHARED_IN {active:true}]->(s:Space)
      FOREACH (space IN CASE WHEN s IS NULL THEN [] ELSE [s] END | MERGE (c:Change {id:$rid+':'+space.id}) ON CREATE SET c.memoryId=m.id,c.spaceId=space.id,c.actorId=$user,c.actorName=$name,c.clientId=$client,c.revision=$rev,c.kind='revised',c.createdAt=$now)
      RETURN DISTINCT properties(m) AS value`,
      {
        id,
        user: actor.userId,
        expected: expectedRevision,
        text: input.text,
        kind: input.kind,
        basis: input.basis,
        entities: JSON.stringify(input.entities),
        evidence: input.evidence,
        eventAt: input.eventAt ?? null,
        client: actor.clientId,
        now,
        rev,
        rid: revisionId,
        hash,
        name: actor.name ?? "Member",
        entityIds: input.entities.map((e) =>
          digest(
            actor.userId +
              "|" +
              e.type +
              "|" +
              e.name.normalize("NFKC").toLowerCase(),
          ),
        ),
        names: input.entities.map((e) => e.name),
        types: input.entities.map((e) => e.type),
      },
    );
    if (!rows[0])
      throw new DomainError(
        409,
        "Memory changed; retrieve the latest revision before correcting it",
      );
    this.emitChange();
    return {
      saved: true,
      memory: this.publicMemory(rows[0].value),
      receipt: revisionId,
    };
  }
  async forget(actor: Actor, id: string) {
    const m = await this.get(actor, id);
    if (m.owner !== actor.userId)
      throw new DomainError(403, "Only the author can forget this memory");
    await this.query(
      `MATCH (m:Memory {id:$id}) WHERE m.owner=$user
      OPTIONAL MATCH (m)-[:HAS_REVISION]->(r:Revision)
      SET r.text=NULL,r.evidence=NULL,r.entities=NULL,r.eventAt=NULL,m.text=NULL,m.evidence=NULL,m.entities='[]',m.eventAt=NULL,m.deletedAt=$now
      WITH DISTINCT m OPTIONAL MATCH (m)-[share:SHARED_IN]->(:Space) SET share.active=false
      WITH DISTINCT m OPTIONAL MATCH (m)-[link:ABOUT]->(:Entity) DELETE link
      WITH DISTINCT m OPTIONAL MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m)
      SET c.payload=NULL,c.status='forgotten'
      WITH DISTINCT c OPTIONAL MATCH (p:Publication)-[:DERIVED_FROM]->(c)
      SET p.payload=NULL,p.active=false`,
      { id, user: actor.userId, now: Date.now() },
    );
    await this.query(
      `MATCH (job:OntologyJob)-[:SUPPORTED_BY]->(m:Memory {id:$id}) WHERE m.owner=$user SET job.plan=NULL,job.status='forgotten',job.lease=NULL`,
      { id, user: actor.userId },
    );
    await this.query(
      `MATCH (d:KnowledgeSearchDocument)-[:INDEXES]->(c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory {id:$id}) WHERE m.owner=$user DETACH DELETE d`,
      { id, user: actor.userId },
    );
    await this.query(
      `MATCH (d:KnowledgeSearchDocument)-[:INDEXES]->(:Publication)-[:DERIVED_FROM]->(:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory {id:$id}) WHERE m.owner=$user DETACH DELETE d`,
      { id, user: actor.userId },
    );
    await this.query(
      "MATCH (e:Entity) OPTIONAL MATCH (m:Memory)-[:ABOUT]->(e) WITH e,count(m) AS refs WHERE refs=0 DELETE e",
    );
    return { forgotten: true, id };
  }
  async spaces(actor: Actor) {
    return (
      await this.query<{ value: Space; role: string }>(
        `MATCH (:Person {id:$user})-[member:MEMBER_OF {active:true}]->(s:Space) RETURN properties(s) AS value,member.role AS role ORDER BY s.createdAt DESC`,
        { user: actor.userId },
        true,
      )
    ).map((r) => ({ ...r.value, role: r.role }));
  }
  async requireSpace(actor: Actor, id: string, write = false, owner = false) {
    const spaces = await this.spaces(actor);
    const s = spaces.find((s) => s.id === id);
    if (
      !s ||
      (owner && s.role !== "owner") ||
      (write && !["owner", "contributor"].includes(s.role))
    )
      throw new DomainError(403, "Space permission required");
    return s;
  }
  async createSpace(actor: Actor, name: string) {
    const id = "space_" + randomUUID();
    const now = Date.now();
    await this.query(
      `MERGE (p:Person {id:$user}) SET p.name=$personName CREATE (s:Space {id:$id,name:$name,owner:$user,createdAt:$now}) CREATE (p)-[:MEMBER_OF {active:true,role:'owner',joinedAt:$now}]->(s)`,
      { id, name, user: actor.userId, personName: actor.name ?? "Member", now },
    );
    return { id, name, owner: actor.userId, role: "owner", createdAt: now };
  }
  async spaceMemories(
    actor: Actor,
    spaceId: string,
    limit = 30,
    cursor?: { updatedAt: number; id: string },
  ) {
    const space = await this.requireSpace(actor, spaceId);
    const rows = await this.query<{ value: Memory }>(
      `MATCH (:Person {id:$user})-[:MEMBER_OF {active:true}]->(s:Space {id:$space})<-[:SHARED_IN {active:true}]-(m:Memory)
       WHERE m.deletedAt IS NULL AND ($before IS NULL OR m.updatedAt<$before OR (m.updatedAt=$before AND m.id<$beforeId))
       WITH DISTINCT m RETURN properties(m) AS value ORDER BY m.updatedAt DESC,m.id DESC LIMIT $limit`,
      {
        user: actor.userId,
        space: spaceId,
        before: cursor?.updatedAt ?? null,
        beforeId: cursor?.id ?? "",
        limit: limit + 1,
      },
      true,
    );
    const page = rows.slice(0, limit).map((r) => r.value);
    const last = page.at(-1);
    return {
      space,
      memories: page.map((m) => this.publicMemory(m)),
      nextCursor:
        rows.length > limit && last
          ? { updatedAt: last.updatedAt, id: last.id }
          : null,
    };
  }
  async invite(
    actor: Actor,
    spaceId: string,
    email: string,
    role: "reader" | "contributor",
  ) {
    await this.requireSpace(actor, spaceId, false, true);
    const token = randomUUID() + randomUUID();
    const id = "invite_" + digest(token);
    const expiresAt = Date.now() + 7 * 86400000;
    await this.query(
      `MATCH (s:Space {id:$space}) WHERE s.owner=$user CREATE (i:Invitation {id:$id,spaceId:$space,email:$email,role:$role,expiresAt:$expires,createdAt:$now}) CREATE (i)-[:FOR_SPACE]->(s)`,
      {
        space: spaceId,
        user: actor.userId,
        id,
        email: email.toLowerCase(),
        role,
        expires: expiresAt,
        now: Date.now(),
      },
    );
    return { token, expiresAt };
  }
  async accept(actor: Actor, token: string) {
    if (!actor.email)
      throw new DomainError(
        403,
        "Verify your primary email to accept this invitation",
      );
    const rows = await this.query<{ value: Space }>(
      `MATCH (i:Invitation {id:$id})-[:FOR_SPACE]->(s:Space) WHERE i.email=$email AND i.expiresAt>$now AND (i.acceptedBy IS NULL OR i.acceptedBy=$user)
      MERGE (p:Person {id:$user}) SET p.name=$personName MERGE (p)-[member:MEMBER_OF]->(s)
      ON CREATE SET member.active=true,member.role=i.role,member.joinedAt=$now
      WITH i,s,p,member WHERE i.acceptedBy IS NULL OR member.active=true
      FOREACH (_ IN CASE WHEN i.acceptedBy IS NULL AND member.role <> 'owner' THEN [1] ELSE [] END | SET member.active=true,member.role=i.role,member.joinedAt=$now)
      SET i.acceptedBy=$user RETURN properties(s) AS value`,
      {
        id: "invite_" + digest(token),
        email: actor.email.toLowerCase(),
        now: Date.now(),
        user: actor.userId,
        personName: actor.name ?? "Member",
      },
    );
    if (!rows[0])
      throw new DomainError(
        403,
        "Invitation is expired or belongs to another email address",
      );
    return rows[0].value;
  }
  async members(actor: Actor, spaceId: string) {
    await this.requireSpace(actor, spaceId);
    return this.query<{ id: string; role: string }>(
      `MATCH (p:Person)-[member:MEMBER_OF {active:true}]->(:Space {id:$id}) RETURN p.id AS id,p.name AS name,member.role AS role`,
      { id: spaceId },
      true,
    );
  }
  async revoke(actor: Actor, spaceId: string, userId: string) {
    await this.requireSpace(actor, spaceId, false, true);
    if (userId === actor.userId)
      throw new DomainError(
        400,
        "The owner cannot revoke their own membership",
      );
    await this.query(
      `MATCH (s:Space {id:$space})<-[member:MEMBER_OF]-(p:Person {id:$target}) WHERE s.owner=$user SET member.active=false`,
      { space: spaceId, target: userId, user: actor.userId },
    );
    return { revoked: true };
  }
  async share(
    actor: Actor,
    id: string,
    spaceId: string,
    enabled = true,
    operationKey = "default",
  ) {
    const m = await this.get(actor, id);
    if (m.owner !== actor.userId)
      throw new DomainError(403, "Only the author can share this memory");
    await this.requireSpace(actor, spaceId, enabled);
    const eventId =
      "evt_" +
      digest(
        actor.userId +
          "|" +
          id +
          "|" +
          spaceId +
          "|" +
          operationKey +
          "|" +
          enabled,
      );
    const rows = await this.query<{ id: string }>(
      `MATCH (m:Memory {id:$id}),(p:Person {id:$user})-[member:MEMBER_OF {active:true}]->(s:Space {id:$space})
      WHERE m.owner=$user AND m.deletedAt IS NULL AND ($enabled=false OR member.role IN ['owner','contributor'])
      MERGE (m)-[share:SHARED_IN]->(s)
      MERGE (c:Change {id:$event}) ON CREATE SET c.memoryId=$id,c.spaceId=$space,c.actorId=$user,c.actorName=$name,c.clientId=$client,c.revision=m.revision,c.kind=$kind,c.createdAt=$now
      FOREACH (_ IN CASE WHEN c.applied IS NULL THEN [1] ELSE [] END | SET share.active=$enabled,share.updatedAt=$now,c.applied=true)
      RETURN m.id AS id`,
      {
        id,
        user: actor.userId,
        space: spaceId,
        enabled,
        now: Date.now(),
        event: eventId,
        name: actor.name ?? "Member",
        client: actor.clientId,
        kind: enabled ? "shared" : "retracted",
      },
    );
    if (!rows[0]) throw new DomainError(403, "Sharing permission changed");
    this.emitChange();
    return {
      shared: enabled,
      memoryId: id,
      spaceId,
      eventId,
    };
  }
  /**
   * Updates other members shared into the reader's spaces since they joined,
   * newest first, one entry per memory or publication (its latest change).
   * Only items the reader can still read are returned; retractions drop out.
   */
  async inbox(
    actor: Actor,
    options: { limit?: number; includeSeen?: boolean } = {},
  ): Promise<{ unread: number; items: InboxItem[] }> {
    const rows = await this.query<{
      change: Change;
      spaceName: string;
      seen: boolean;
      watermark: number | null;
    }>(
      `MATCH (p:Person {id:$user})-[member:MEMBER_OF {active:true}]->(s:Space)
      MATCH (c:Change) WHERE c.spaceId=s.id AND c.actorId<>$user AND c.createdAt>=coalesce(member.joinedAt,0)
      OPTIONAL MATCH (p)-[seen:SEEN]->(c)
      RETURN properties(c) AS change,s.name AS spaceName,seen IS NOT NULL AS seen,p.inboxSeenAt AS watermark
      ORDER BY c.createdAt DESC,c.revision DESC LIMIT ${INBOX_WINDOW}`,
      { user: actor.userId },
      true,
    );
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const c = row.change;
      const key =
        (c.publicationId ? "pub:" + c.publicationId : "mem:" + c.memoryId) +
        "|" +
        c.spaceId;
      if (!latest.has(key)) latest.set(key, row);
    }
    const candidates = [...latest.values()].filter(
      (r) => r.change.kind !== "retracted",
    );
    const memoryIds = [
      ...new Set(candidates.flatMap((r) => r.change.memoryId ?? [])),
    ];
    const publicationIds = [
      ...new Set(candidates.flatMap((r) => r.change.publicationId ?? [])),
    ];
    // Re-check current state: a share may since be retracted or its source forgotten.
    const memories = new Map<string, Memory>();
    if (memoryIds.length)
      for (const r of await this.query<{
        id: string;
        spaceId: string;
        value: Memory;
      }>(
        `MATCH (m:Memory)-[:SHARED_IN {active:true}]->(s:Space) WHERE m.id IN $ids AND m.deletedAt IS NULL RETURN m.id AS id,s.id AS spaceId,properties(m) AS value`,
        { ids: memoryIds },
        true,
      ))
        memories.set(r.id + "|" + r.spaceId, r.value);
    const publications = new Map<string, string>();
    if (publicationIds.length)
      for (const r of await this.query<{
        id: string;
        spaceId: string;
        payload: string;
      }>(
        `MATCH (pub:Publication)-[:PUBLISHED_IN]->(s:Space),(pub)-[:DERIVED_FROM]->(:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory) WHERE pub.id IN $ids AND pub.active=true AND m.deletedAt IS NULL RETURN pub.id AS id,s.id AS spaceId,pub.payload AS payload`,
        { ids: publicationIds },
        true,
      ))
        publications.set(r.id + "|" + r.spaceId, r.payload);
    const reader = await this.reader(actor);
    const now = Date.now();
    const items: InboxItem[] = [];
    for (const { change: c, spaceName, seen, watermark } of candidates) {
      let update: InboxItem["update"] | undefined;
      if (c.publicationId) {
        const payload = publications.get(c.publicationId + "|" + c.spaceId);
        if (payload)
          update = {
            type: "publication",
            publicationId: c.publicationId,
            claim: JSON.parse(payload),
          };
      } else {
        const m = memories.get(c.memoryId + "|" + c.spaceId);
        if (m) update = { type: "memory", memory: this.publicMemory(m) };
      }
      if (!update) continue;
      const aboutYou = mentionOf(reader, c.actorId, mentionText(update));
      items.push({
        changeId: c.id,
        kind: c.kind,
        spaceId: c.spaceId,
        spaceName,
        actorName: c.actorName,
        createdAt: c.createdAt,
        seen: seen || (watermark != null && c.createdAt <= watermark),
        aboutYou,
        dueNow: isDue(
          reader.preferences,
          { createdAt: c.createdAt, urgent: aboutYou !== null },
          now,
        ),
        update,
      });
    }
    // Updates about the reader first (confirmed before possible), then newest first.
    const rank = (i: InboxItem) =>
      i.aboutYou?.status === "confirmed" ? 2 : i.aboutYou ? 1 : 0;
    items.sort((a, b) => rank(b) - rank(a) || b.createdAt - a.createdAt);
    return {
      unread: items.filter((i) => !i.seen).length,
      items: (options.includeSeen ? items : items.filter((i) => !i.seen)).slice(
        0,
        options.limit ?? 20,
      ),
    };
  }
  /** The reader's display name, notification preferences and identity answers. */
  private async reader(actor: Actor) {
    const [person] = await this.query<{ name: string | null; prefs: string | null }>(
      "MATCH (p:Person {id:$user}) RETURN p.name AS name,p.notifyPrefs AS prefs",
      { user: actor.userId },
      true,
    );
    const links = await this.query<{ author: string; name: string; isMe: boolean }>(
      "MATCH (l:IdentityLink) WHERE l.recipient=$user RETURN l.author AS author,l.name AS name,l.isMe AS isMe",
      { user: actor.userId },
      true,
    );
    let preferences = defaultPreferences;
    try {
      if (person?.prefs) preferences = parsePreferences(JSON.parse(person.prefs));
    } catch {
      // Stored preferences that no longer validate fall back to the defaults.
    }
    return {
      names: ownNames(person?.name ?? actor.name ?? ""),
      links,
      preferences,
    };
  }
  async preferences(actor: Actor): Promise<Preferences> {
    return (await this.reader(actor)).preferences;
  }
  async setPreferences(actor: Actor, raw: unknown) {
    const preferences = parsePreferences(raw);
    await this.query(
      "MERGE (p:Person {id:$user}) SET p.notifyPrefs=$prefs",
      { user: actor.userId, prefs: JSON.stringify(preferences) },
    );
    return preferences;
  }
  /**
   * Records the reader's answer to "is this name you?" for one author's updates.
   * The change must be an update from another member of one of the reader's spaces.
   */
  async confirmIdentity(
    actor: Actor,
    input: { changeId: string; name: string; isMe: boolean },
  ) {
    const name = input.name.normalize("NFKC").trim();
    if (!name || name.length > 120)
      throw new DomainError(400, "Provide the name shown in the update");
    const [change] = await this.query<{ author: string }>(
      `MATCH (:Person {id:$user})-[:MEMBER_OF {active:true}]->(s:Space)
      MATCH (c:Change {id:$change}) WHERE c.spaceId=s.id AND c.actorId<>$user
      RETURN c.actorId AS author LIMIT 1`,
      { user: actor.userId, change: input.changeId },
      true,
    );
    if (!change) throw new DomainError(404, "Update not found");
    await this.query(
      `MERGE (l:IdentityLink {id:$id})
      SET l.recipient=$user,l.author=$author,l.name=$name,l.isMe=$isMe,l.at=$now`,
      {
        id: digest(actor.userId + "|" + change.author + "|" + name.toLowerCase()),
        user: actor.userId,
        author: change.author,
        name,
        isMe: input.isMe,
        now: Date.now(),
      },
    );
    return { recorded: true, name, isMe: input.isMe };
  }
  async inboxCount(actor: Actor) {
    return (await this.inbox(actor, { limit: 1 })).unread;
  }
  /** Unread count plus how many of them mention the reader; used by the tool footer. */
  async inboxSummary(actor: Actor) {
    const box = await this.inbox(actor, { limit: INBOX_WINDOW });
    return {
      unread: box.unread,
      aboutYou: box.items.filter((i) => i.aboutYou).length,
    };
  }
  async markInboxSeen(
    actor: Actor,
    input: { changeIds?: string[]; all?: boolean },
  ) {
    if (!input.all && !input.changeIds?.length)
      throw new DomainError(400, "Provide changeIds or all");
    const now = Date.now();
    if (input.all)
      await this.query(
        `MERGE (p:Person {id:$user}) SET p.inboxSeenAt=$now`,
        { user: actor.userId, now },
      );
    if (input.changeIds?.length)
      // Only changes in the reader's current spaces can be marked.
      await this.query(
        `MATCH (p:Person {id:$user})-[:MEMBER_OF {active:true}]->(s:Space)
        MATCH (c:Change) WHERE c.id IN $ids AND c.spaceId=s.id
        MERGE (p)-[seen:SEEN]->(c) ON CREATE SET seen.at=$now`,
        { user: actor.userId, ids: input.changeIds, now },
      );
    return { unread: await this.inboxCount(actor) };
  }
  async authorizeClient(actor: Actor) {
    const id = digest(actor.userId + "|" + actor.clientId);
    const rows = await this.query<{ enabled: boolean }>(
      `MERGE (c:Connection {id:$id}) ON CREATE SET c.owner=$user,c.clientId=$client,c.enabled=true,c.createdAt=$now SET c.lastSeen=$now RETURN c.enabled AS enabled`,
      { id, user: actor.userId, client: actor.clientId, now: Date.now() },
    );
    return rows[0]?.enabled === true;
  }
  async clientEnabled(userId: string, clientId: string) {
    const rows = await this.query<{ enabled: boolean }>(
      `MATCH (c:Connection {id:$id}) RETURN c.enabled AS enabled`,
      { id: digest(userId + "|" + clientId) },
      true,
    );
    return rows.length === 0 || rows[0].enabled === true;
  }
  async connections(actor: Actor) {
    return (
      await this.query<{ value: Record<string, unknown> }>(
        `MATCH (c:Connection) WHERE c.owner=$user RETURN properties(c) AS value ORDER BY c.lastSeen DESC`,
        { user: actor.userId },
        true,
      )
    ).map((r) => r.value);
  }
  async setConnection(actor: Actor, id: string, enabled: boolean) {
    await this.query(
      `MATCH (c:Connection {id:$id}) WHERE c.owner=$user SET c.enabled=$enabled`,
      { id, user: actor.userId, enabled },
    );
    return { enabled };
  }
  async eraseUser(userId: string) {
    const rows = await this.query<{ id: string }>(
      `MATCH (m:Memory) WHERE m.owner=$user AND m.deletedAt IS NULL RETURN m.id AS id`,
      { user: userId },
      true,
    );
    for (const row of rows)
      await this.forget({ userId, clientId: "account-deletion" }, row.id);
    await this.query(
      `MATCH (p:Person {id:$user}) OPTIONAL MATCH (p)-[member:MEMBER_OF]->(:Space) SET member.active=false`,
      { user: userId },
    );
    await this.query(
      `MATCH (m:Memory) WHERE m.owner=$user SET m.authorName='Deleted member'`,
      { user: userId },
    );
    await this.query(
      `MATCH (c:Change) WHERE c.actorId=$user SET c.actorName='Deleted member'`,
      { user: userId },
    );
    await this.query(
      `MATCH (c:Connection) WHERE c.owner=$user SET c.enabled=false`,
      { user: userId },
    );
  }
  async rules(actor: Actor) {
    return (
      await this.query<{
        value: {
          id: string;
          owner: string;
          spaceId: string;
          kind: string;
          entityName: string;
          active: boolean;
        };
      }>(
        `MATCH (r:SharingRule) WHERE r.owner=$user RETURN properties(r) AS value`,
        { user: actor.userId },
        true,
      )
    ).map((r) => r.value);
  }
  async addRule(
    actor: Actor,
    spaceId: string,
    kind: string,
    entityName: string,
  ) {
    await this.requireSpace(actor, spaceId, true);
    const id = "rule_" + randomUUID();
    await this.query(
      `CREATE (:SharingRule {id:$id,owner:$user,spaceId:$space,kind:$kind,entityName:$entity,active:true,createdAt:$now})`,
      {
        id,
        user: actor.userId,
        space: spaceId,
        kind,
        entity: entityName.trim().toLowerCase(),
        now: Date.now(),
      },
    );
    return { id, enabled: true };
  }
  async disableRule(actor: Actor, id: string) {
    await this.query(
      `MATCH (r:SharingRule {id:$id}) WHERE r.owner=$user SET r.active=false`,
      { id, user: actor.userId },
    );
    return { disabled: true };
  }
  async applyRules(actor: Actor, id: string) {
    const memory = await this.get(actor, id);
    if (memory.owner !== actor.userId) return [];
    const entities = JSON.parse(memory.entities) as { name: string }[];
    const receipts = [];
    for (const rule of await this.rules(actor)) {
      if (
        !rule.active ||
        rule.kind !== memory.kind ||
        (rule.entityName &&
          !entities.some((e) => e.name.toLowerCase() === rule.entityName))
      )
        continue;
      const activeShare = await this.query(
        `MATCH (:Memory {id:$id})-[:SHARED_IN {active:true}]->(:Space {id:$space}) RETURN 1 AS found`,
        { id, space: rule.spaceId },
        true,
      );
      if (activeShare.length) continue;
      try {
        receipts.push(
          await this.share(
            actor,
            id,
            rule.spaceId,
            true,
            rule.id + ":" + memory.revision,
          ),
        );
      } catch (e) {
        if (!(e instanceof DomainError) || e.status !== 403) throw e;
      }
    }
    return receipts;
  }
  async graphView(actor: Actor) {
    return this.query<{
      memoryId: string;
      memoryText: string;
      entityId: string;
      entityName: string;
      entityType: string;
    }>(
      `MATCH (m:Memory)-[:ABOUT]->(e:Entity) ${access(",e")} RETURN m.id AS memoryId,m.text AS memoryText,e.id AS entityId,e.name AS entityName,e.kind AS entityType ORDER BY m.updatedAt DESC LIMIT 300`,
      { user: actor.userId },
      true,
    );
  }
  async close() {
    await this.db.close();
  }
}
export async function connectMemoryStore(env: NodeJS.ProcessEnv = process.env) {
  const db = await FalkorDB.connect({
    socket: {
      host: env.FALKORDB_HOST!,
      port: Number(env.FALKORDB_PORT ?? 6379),
    },
    password: env.FALKORDB_PASSWORD,
  });
  db.on("error", () => console.error("Memory database connection error"));
  const store = new MemoryStore(
    db,
    env.FALKORDB_MEMORY_GRAPH ?? "shared_memory_app",
  );
  try {
    await store.init();
    return store;
  } catch (e) {
    await db.close();
    throw e;
  }
}
