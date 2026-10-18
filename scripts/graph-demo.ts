/**
 * Builds a small synthetic Memspace graph through the product's own code,
 * then runs the Cypher queries in cypher/queries against it and prints each
 * result with FalkorDB's execution plan.
 *
 *   npm run graph:demo            # build, run, delete the demo graph
 *   npm run graph:demo -- --keep  # keep it to explore in FalkorDB Browser
 *
 * Uses FALKORDB_HOST / FALKORDB_PORT / FALKORDB_PASSWORD (default 127.0.0.1:6379)
 * and only connects to a loopback host, so it can never touch a hosted database.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectMemoryStore, type Actor } from "../src/memory.js";
import { KnowledgeStore } from "../src/knowledge.js";

const root = resolve(fileURLToPath(import.meta.url), "../..");
type Params = Record<string, string | string[]>;

/** Reads a query file, dropping its comment lines. */
export function loadQuery(name: string) {
  return readFileSync(resolve(root, "cypher/queries", name + ".cypher"), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .trim();
}
/** FalkorDB's parameter prefix, which GRAPH.EXPLAIN needs because it takes no separate params. */
export function withParams(query: string, params: Params) {
  const values = Object.entries(params)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");
  return `CYPHER ${values} ${query}`;
}
/** The query with values written in, for FalkorDB Browser, which rejects the CYPHER prefix.
 *  Demo values only; the product always sends parameters separately. */
export function inlineParams(query: string, params: Params) {
  return query.replace(/\$(\w+)/g, (match, name: string) =>
    name in params ? JSON.stringify(params[name]) : match,
  );
}

const people = {
  pranav: { userId: "demo-pranav", name: "Pranav Janakiraman", clientId: "dot", email: "pranav@demo.invalid" },
  afshal: { userId: "demo-afshal", name: "Afshal Gulam", clientId: "muse", email: "afshal@demo.invalid" },
  roshan: { userId: "demo-roshan", name: "Roshan Premil", clientId: "grok-bot", email: "roshan@demo.invalid" },
  eve: { userId: "demo-eve", name: "Eve Outsider", clientId: "codex", email: "eve@demo.invalid" },
} satisfies Record<string, Actor>;
const apollo = [{ type: "project" as const, name: "Apollo" }];

/** Shows a published claim as "subject PREDICATE object" instead of its JSON payload. */
function readable(row: Record<string, unknown>) {
  if (typeof row.claim !== "string") return row;
  const c = JSON.parse(row.claim);
  return {
    claim: `${c.subject.name} ${c.predicate} ${c.object?.name ?? c.value}`,
    subjectNode: row.subjectNode,
    memberId: c.subject.memberId ?? null,
    author: c.authorName,
    evidence: c.evidence,
  };
}
export async function runDemo(
  env: NodeJS.ProcessEnv = process.env,
  options: { graph?: string; keep?: boolean; print?: boolean } = {},
) {
  const host = env.FALKORDB_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host))
    throw new Error("The demo only runs against a local FalkorDB (127.0.0.1)");
  const graph = options.graph ?? "shared_memory_demo";
  const store = await connectMemoryStore({
    FALKORDB_HOST: host,
    FALKORDB_PORT: env.FALKORDB_PORT ?? "6379",
    FALKORDB_PASSWORD: env.FALKORDB_PASSWORD,
    FALKORDB_MEMORY_GRAPH: graph,
  });
  const log = (...args: unknown[]) => options.print && console.log(...args);
  try {
    // Start from an empty demo graph so reruns give the same picture.
    await store.query("MATCH (n) DETACH DELETE n");
    const knowledge = new KnowledgeStore(store);
    const save = async (actor: Actor, text: string, key: string, entities = apollo) =>
      (
        await store.remember(actor, {
          text,
          evidence: text,
          kind: "fact",
          basis: "user_statement",
          entities,
          idempotencyKey: "graph-demo-" + key,
        })
      ).memory.id;

    // Pranav owns a space; Afshal can share into it, Roshan can only read. Eve is outside.
    const space = await store.createSpace(people.pranav, "Apollo launch");
    for (const [member, role] of [
      [people.afshal, "contributor"],
      [people.roshan, "reader"],
    ] as const)
      await store.accept(member, (await store.invite(people.pranav, space.id, member.email, role)).token);

    const launch = await save(people.pranav, "The Apollo launch moved to November 20.", "launch");
    const budget = await save(people.pranav, "Apollo budget is approved.", "budget");
    const salary = await save(people.pranav, "Pranav's salary review is on Friday.", "salary", []);
    const review = await save(people.pranav, "Afshal is leading the Apollo pricing review.", "review");
    const deck = await save(people.afshal, "Afshal is preparing the Apollo pricing deck.", "deck");
    await save(people.roshan, "Roshan prefers short updates.", "short", []);

    // Structured claims. Pranav's note says "Afshal"; Afshal's own note uses the full name.
    const claim = async (actor: Actor, memory: string, key: string, person: string, evidence: string) =>
      knowledge.record(actor, {
        sourceMemoryId: memory,
        sourceRevision: 1,
        idempotencyKey: "graph-demo-claims-" + key,
        entities: [
          { key: "person", type: "person", name: person },
          { key: "apollo", type: "project", name: "Apollo" },
        ],
        claims: [{ subject: "person", predicate: "WORKS_ON", object: "apollo", basis: "explicit", evidence }],
      });
    await claim(people.pranav, review, "review", "Afshal", "Afshal is leading the Apollo pricing review.");
    await claim(people.afshal, deck, "deck", "Afshal Gulam", "Afshal is preparing the Apollo pricing deck.");

    // Share three memories; sharing also publishes their claims into the space.
    for (const [actor, memory] of [
      [people.pranav, launch],
      [people.pranav, review],
      [people.afshal, deck],
    ] as const) {
      await store.share(actor, memory, space.id, true, "graph-demo-share-" + memory);
      await knowledge.syncSharedClaims(actor, memory);
    }

    const runs: { file: string; label: string; params: Params }[] = [
      { file: "01-can-read", label: "Afshal reads Pranav's shared note", params: { user: people.afshal.userId, id: launch } },
      { file: "01-can-read", label: "Eve (not a member) reads the same note", params: { user: people.eve.userId, id: launch } },
      { file: "01-can-read", label: "Afshal reads Pranav's private note", params: { user: people.afshal.userId, id: salary } },
      { file: "02-recall-keyword", label: "Pranav searches 'launch'", params: { user: people.pranav.userId, terms: ["launch"] } },
      { file: "03-recall-via-entity", label: "Hop from that result through its Entity", params: { user: people.pranav.userId, ids: [launch] } },
      { file: "04-recall-via-space", label: "Hop from that result through its Space", params: { user: people.pranav.userId, ids: [launch] } },
      { file: "05-space-feed", label: "Roshan's feed for the space", params: { user: people.roshan.userId, space: space.id } },
      { file: "05-space-feed", label: "Eve's feed for the space", params: { user: people.eve.userId, space: space.id } },
      { file: "06-space-claims", label: "Claims in the space, seen by Roshan", params: { user: people.roshan.userId, space: space.id } },
    ];
    const results: Record<string, Record<string, unknown>[]> = {};
    log(`\nDemo graph "${graph}": 4 people, 1 space, 6 memories, 2 claims.`);
    log(`Space id: ${space.id}\n`);
    for (const run of runs) {
      const query = loadQuery(run.file);
      const rows = await store.query<Record<string, unknown>>(query, run.params as never, true);
      results[`${run.file}: ${run.label}`] = rows;
      log(`── ${run.file} · ${run.label}`);
      log(rows.length ? rows.map(readable) : "   (no rows)");
      if (options.print) {
        const plan = await store.graph.explain(withParams(query, run.params));
        log("   plan:\n" + (plan as string[]).map((l) => "     " + l).join("\n"));
        log("   paste into FalkorDB Browser:\n     " + inlineParams(query, run.params).replace(/\s+/g, " ") + "\n");
      }
    }
    return { space: space.id, memories: { launch, budget, salary, review, deck }, results };
  } finally {
    if (!options.keep) await store.graph.delete().catch(() => undefined);
    await store.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runDemo(process.env, { keep: process.argv.includes("--keep"), print: true })
    .then(() => {
      if (process.argv.includes("--keep"))
        console.log('Kept graph "shared_memory_demo". Open FalkorDB Browser and run: MATCH (n)-[r]->(m) RETURN n, r, m');
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
