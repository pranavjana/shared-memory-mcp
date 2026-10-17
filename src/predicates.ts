import { z } from "zod";
import { DomainError, type Actor, type MemoryStore } from "./memory.js";
import {
  coreAssertions,
  entityTypes,
  predicateName,
  type RelationDefinition,
} from "./ontology.js";

export type PredicateStatus =
  "provisional" | "approved" | "rejected" | "merged";
export interface CustomPredicate extends RelationDefinition {
  status: PredicateStatus;
  mergedInto?: string;
  createdAt: number;
}
/** What extraction may propose when no relationship expresses a stated fact. */
export const predicateProposal = z
  .object({
    name: z.string().min(1).max(60),
    description: z.string().min(1).max(200),
    subjectTypes: z.array(z.enum(entityTypes)).min(1).max(6),
    objectTypes: z.array(z.enum(entityTypes)).max(6).nullable(),
    literal: z.boolean(),
  })
  .strict();
export type PredicateProposal = z.infer<typeof predicateProposal>;

const stopwords = new Set([
  "CAN",
  "IS",
  "ARE",
  "DOES",
  "DO",
  "BE",
  "A",
  "AN",
  "THE",
  "TO",
  "OF",
]);
// Names that read like instructions are never schema, whatever the source says.
const blocked =
  /IGNORE|INSTRUCT|PROMPT|SYSTEM|ADMIN|TOKEN|PASSWORD|SECRET|DELETE|EXECUTE|OVERRIDE/;
const perUserDaily = 5;
const provisionalCap = 100;
const day = 86_400_000;

export const normalizePredicate = (raw: string) =>
  raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
/** SPEAKS, CAN_SPEAK and SPEAKS_LANGUAGE share the root SPEAK. */
const roots = (name: string) =>
  name
    .split("_")
    .filter((t) => t && !stopwords.has(t))
    .map((t) =>
      t.length > 3 && t.endsWith("S") && !t.endsWith("SS") ? t.slice(0, -1) : t,
    );
const sameRoots = (a: string, b: string) =>
  roots(a).join("_") === roots(b).join("_");
const related = (a: string, b: string) => {
  const [x, y] = [roots(a), roots(b)].sort((p, q) => p.length - q.length);
  return x.length > 0 && x.every((t, i) => y[i] === t);
};
const sameKind = (r: RelationDefinition, p: PredicateProposal) =>
  !!r.value === p.literal;
const fits = (r: RelationDefinition, p: PredicateProposal) =>
  sameKind(r, p) &&
  p.subjectTypes.every((t) => r.from.includes(t)) &&
  (p.literal || (p.objectTypes ?? []).every((t) => r.to.includes(t)));
const definition = (
  id: string,
  description: string,
  from: string[],
  to: string[],
  literal: boolean,
): RelationDefinition => ({
  id,
  description,
  from,
  to: literal ? [] : to,
  group: "assertion",
  ...(literal
    ? { value: { name: "value", type: "string", description } as const }
    : {}),
});

export class PredicateRegistry {
  constructor(private store: MemoryStore) {}
  async all(): Promise<CustomPredicate[]> {
    const rows = await this.store.query<{
      id: string;
      description: string;
      from: string[];
      to: string[];
      literal: boolean;
      status: PredicateStatus;
      mergedInto: string | null;
      createdAt: number;
    }>(
      "MATCH (p:OntologyPredicate) RETURN p.id AS id,p.description AS description,p.fromTypes AS from,p.toTypes AS to,p.literal AS literal,p.status AS status,p.mergedInto AS mergedInto,p.createdAt AS createdAt ORDER BY p.createdAt",
      {},
      true,
    );
    return rows.map((r) => ({
      ...definition(r.id, r.description, r.from, r.to, r.literal),
      status: r.status,
      ...(r.mergedInto ? { mergedInto: r.mergedInto } : {}),
      createdAt: r.createdAt,
    }));
  }
  /** Relationships extraction and writes may use now. */
  async active(): Promise<RelationDefinition[]> {
    return (await this.all()).filter((p) =>
      ["provisional", "approved"].includes(p.status),
    );
  }
  /** Map each proposal to an existing relationship, or plan a new provisional one.
   *  Nothing is persisted here; call commit() with the plans actually used. */
  async resolve(proposals: PredicateProposal[]) {
    const custom = await this.all();
    const active = [
      ...coreAssertions,
      ...custom.filter((p) => ["provisional", "approved"].includes(p.status)),
    ];
    const mapping = new Map<string, string>();
    const planned: CustomPredicate[] = [];
    const definitions = new Map(active.map((r) => [r.id, r]));
    for (const raw of proposals) {
      const parsed = predicateProposal.safeParse(raw);
      if (!parsed.success) continue;
      const p = parsed.data;
      const name = normalizePredicate(p.name);
      if (!predicateName.safeParse(name).success || blocked.test(name))
        continue;
      if (!p.literal && !p.objectTypes?.length) continue;
      // A rejected or merged meaning stays closed; a merge points at its replacement.
      const closed = custom.find(
        (c) =>
          ["rejected", "merged"].includes(c.status) && sameRoots(c.id, name),
      );
      if (closed?.status === "rejected") continue;
      const all = [...definitions.values()].filter((r) => sameKind(r, p));
      // The same meaning (SPEAKS / CAN_SPEAK) is reused, widening a provisional one if needed.
      // A broader or narrower name (SPEAKS_LANGUAGE) is reused only when its types already fit.
      const match = closed
        ? definitions.get(closed.mergedInto ?? "")
        : (all.find((r) => r.id === name || sameRoots(r.id, name)) ??
          all.find((r) => related(r.id, name) && fits(r, p)));
      if (closed && !match) continue;
      if (match) {
        if (!sameKind(match, p)) continue;
        const provisional = custom.find(
          (c) => c.id === match.id && c.status === "provisional",
        );
        const prior = planned.findIndex((c) => c.id === match.id);
        if (fits(match, p)) {
          mapping.set(p.name, match.id).set(name, match.id);
        } else if (provisional || prior >= 0) {
          const widened = {
            ...match,
            from: [...new Set([...match.from, ...p.subjectTypes])],
            to: p.literal
              ? []
              : [...new Set([...match.to, ...(p.objectTypes ?? [])])],
          };
          definitions.set(match.id, widened);
          const entry = {
            ...(provisional ?? planned[prior]),
            ...widened,
          } as CustomPredicate;
          if (prior >= 0) planned[prior] = entry;
          else planned.push(entry);
          mapping.set(p.name, match.id).set(name, match.id);
        }
        continue;
      }
      const created: CustomPredicate = {
        ...definition(
          name,
          p.description,
          p.subjectTypes,
          p.objectTypes ?? [],
          p.literal,
        ),
        status: "provisional",
        createdAt: Date.now(),
      };
      planned.push(created);
      definitions.set(name, created);
      mapping.set(p.name, name).set(name, name);
    }
    return {
      mapping,
      planned,
      definitions: [...definitions.values()].filter(
        (r) => !coreAssertions.some((c) => c.id === r.id),
      ),
    };
  }
  /** Persist planned relationships that survived validation. Over the limit, they are dropped. */
  async commit(actor: Actor, planned: CustomPredicate[], used: Set<string>) {
    const now = Date.now();
    const kept: string[] = [];
    for (const p of planned.filter((p) => used.has(p.id))) {
      const [counts] = await this.store.query<{
        mine: number;
        total: number;
        exists: boolean;
      }>(
        `OPTIONAL MATCH (e:OntologyPredicate {id:$id}) WITH count(e)>0 AS exists
         OPTIONAL MATCH (m:OntologyPredicate) WHERE m.createdBy=$user AND m.createdAt>$since WITH exists,count(m) AS mine
         OPTIONAL MATCH (t:OntologyPredicate {status:'provisional'}) RETURN exists,mine,count(t) AS total`,
        { id: p.id, user: actor.userId, since: now - day },
        true,
      );
      if (
        !counts.exists &&
        (counts.mine >= perUserDaily || counts.total >= provisionalCap)
      )
        continue;
      await this.store.query(
        `MERGE (p:OntologyPredicate {id:$id}) ON CREATE SET p.description=$description,p.literal=$literal,p.status='provisional',p.createdBy=$user,p.createdAt=$now,p.fromTypes=$from,p.toTypes=$to
         WITH p WHERE p.status='provisional' SET p.fromTypes=$from,p.toTypes=$to`,
        {
          id: p.id,
          description: p.description,
          literal: !!p.value,
          user: actor.userId,
          now,
          from: p.from,
          to: p.to,
        },
      );
      kept.push(p.id);
    }
    return kept;
  }
  /** Reviewer decision. Merging rewrites existing claims; rejecting retires them. */
  async review(decision: {
    id: string;
    action: "approve" | "reject" | "merge";
    into?: string;
  }) {
    const all = await this.all();
    const p = all.find((c) => c.id === decision.id);
    if (!p) throw new DomainError(404, "Relationship not found");
    if (decision.action === "approve") {
      await this.store.query(
        "MATCH (p:OntologyPredicate {id:$id}) SET p.status='approved'",
        { id: p.id },
      );
      return { id: p.id, status: "approved" };
    }
    if (decision.action === "reject") {
      for (const statement of [
        "MATCH (p:OntologyPredicate {id:$id}) SET p.status='rejected'",
        "MATCH (d:KnowledgeSearchDocument)-[:INDEXES]->(:Publication)-[:DERIVED_FROM]->(:KnowledgeClaim {predicate:$id}) DETACH DELETE d",
        "MATCH (d:KnowledgeSearchDocument)-[:INDEXES]->(:KnowledgeClaim {predicate:$id}) DETACH DELETE d",
        "MATCH (pub:Publication)-[:DERIVED_FROM]->(:KnowledgeClaim {predicate:$id}) SET pub.active=false",
        "MATCH (c:KnowledgeClaim {predicate:$id}) WHERE c.status IN ['active','disputed'] SET c.status='retired'",
      ])
        await this.store.query(statement, { id: p.id });
      return { id: p.id, status: "rejected" };
    }
    const target = [
      ...coreAssertions,
      ...all.filter((c) => ["provisional", "approved"].includes(c.status)),
    ].find((r) => r.id === decision.into && r.id !== p.id);
    if (!target)
      throw new DomainError(400, "Choose an active relationship to merge into");
    if (!!target.value !== !!p.value)
      throw new DomainError(
        400,
        "Cannot merge a value relationship with an entity relationship",
      );
    const claims = await this.store.query<{
      id: string;
      payload: string;
      subject: string;
      object: string | null;
    }>(
      "MATCH (c:KnowledgeClaim {predicate:$id})-[:SUBJECT]->(s:KnowledgeEntity) OPTIONAL MATCH (c)-[:OBJECT]->(o:KnowledgeEntity) RETURN c.id AS id,c.payload AS payload,s.kind AS subject,o.kind AS object",
      { id: p.id },
      true,
    );
    const misfit = claims.filter(
      (c) =>
        !target.from.includes(c.subject) ||
        (!target.value && !target.to.includes(c.object ?? "")),
    ).length;
    if (misfit)
      throw new DomainError(
        400,
        `${misfit} existing claims do not fit ${target.id}'s types`,
      );
    const params = {
      id: p.id,
      into: target.id,
      from: `"predicate":"${p.id}"`,
      to: `"predicate":"${target.id}"`,
      claims: claims.map((c) => ({
        id: c.id,
        payload: JSON.stringify({
          ...JSON.parse(c.payload),
          predicate: target.id,
        }),
      })),
    };
    await this.store.query(
      "MATCH (pub:Publication)-[:DERIVED_FROM]->(:KnowledgeClaim {predicate:$id}) WHERE pub.payload CONTAINS $from SET pub.payload=replace(pub.payload,$from,$to)",
      params,
    );
    if (claims.length)
      await this.store.query(
        "UNWIND $claims AS item MATCH (c:KnowledgeClaim {id:item.id}) SET c.predicate=$into,c.payload=item.payload",
        params,
      );
    await this.store.query(
      "MATCH (p:OntologyPredicate {id:$id}) SET p.status='merged',p.mergedInto=$into",
      params,
    );
    return {
      id: p.id,
      status: "merged",
      mergedInto: target.id,
      claims: claims.length,
    };
  }
  /** Use counts for review, without any claim text or evidence. */
  async usage() {
    return this.store.query<{ id: string; claims: number; authors: number }>(
      "MATCH (p:OntologyPredicate) OPTIONAL MATCH (c:KnowledgeClaim {predicate:p.id}) WHERE c.status IN ['active','disputed'] RETURN p.id AS id,count(c) AS claims,count(DISTINCT c.owner) AS authors",
      {},
      true,
    );
  }
}
