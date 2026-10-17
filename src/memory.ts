import { createHash, randomUUID } from "node:crypto";
import { FalkorDB, ConstraintType, EntityType } from "falkordb";
type QueryParams = NonNullable<
  NonNullable<
    Parameters<ReturnType<FalkorDB["selectGraph"]>["query"]>[1]
  >["params"]
>;
import { z } from "zod";
import { entityTypes } from "./ontology.js";

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
  constructor(
    public db: FalkorDB,
    public graphName: string,
  ) {}
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
    return {
      shared: enabled,
      memoryId: id,
      spaceId,
      eventId,
    };
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
  /** Whether each of the user's own memories made it into the ontology. */
  async ontologyStatus(actor: Actor, ids: string[]) {
    const rows = await this.query<{ id: string; status: string }>(
      `MATCH (j:OntologyJob)-[:SUPPORTED_BY]->(m:Memory) WHERE m.id IN $ids AND m.owner=$user AND m.deletedAt IS NULL AND j.revision=m.revision RETURN m.id AS id,j.status AS status`,
      { ids, user: actor.userId },
      true,
    );
    return Object.fromEntries(rows.map((r) => [r.id, r.status]));
  }
  /** Queue the current revision for another extraction, e.g. after the ontology gained a relationship. */
  async retryOntology(actor: Actor, id: string) {
    const rows = await this.query<{ status: string }>(
      `MATCH (j:OntologyJob)-[:SUPPORTED_BY]->(m:Memory {id:$id}) WHERE m.owner=$user AND m.deletedAt IS NULL AND j.revision=m.revision AND j.status IN ['failed','no_supported_claims']
       SET j.status='pending',j.attempts=0,j.nextAt=0,j.lease=NULL,j.leaseUntil=NULL,j.plan=NULL RETURN j.status AS status`,
      { id, user: actor.userId },
    );
    if (!rows[0])
      throw new DomainError(409, "This memory is not waiting for a retry");
    return { queued: true, memoryId: id };
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
