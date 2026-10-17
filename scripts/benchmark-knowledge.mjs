// Run after npm run build:server. This benchmark only creates temporary LOCAL graphs.
import { randomUUID } from "node:crypto";
import { connectMemoryStore } from "../dist/memory.js";
import { KnowledgeStore } from "../dist/knowledge.js";
import { configuredEmbedder } from "../dist/embeddings.js";
const embedder = configuredEmbedder();
if (!embedder)
  throw new Error(
    "Configure EMBEDDING_PROVIDER and its key privately before benchmarking",
  );
const host = process.env.FALKORDB_TEST_HOST ?? "127.0.0.1";
if (!["127.0.0.1", "localhost", "::1"].includes(host))
  throw new Error("Benchmark requires an isolated loopback database");
const s = await connectMemoryStore({
  FALKORDB_HOST: host,
  FALKORDB_PORT: process.env.FALKORDB_TEST_PORT ?? "16379",
  FALKORDB_PASSWORD: process.env.FALKORDB_TEST_PASSWORD ?? "local-verification",
  FALKORDB_MEMORY_GRAPH: "benchmark_" + randomUUID().replaceAll("-", ""),
});
const a = {
  userId: "synthetic_benchmark",
  clientId: "local-benchmark",
  name: "Synthetic owner",
};
const k = new KnowledgeStore(s, embedder);
const entity = (key, type, name) => ({ key, type, name });
const fixtures = [
  {
    id: "career",
    text: "Jordan wants to change companies and is worried about the transition.",
    entities: [
      entity("j", "person", "Jordan"),
      entity("g", "goal", "Changing companies"),
    ],
    claims: [
      { subject: "j", predicate: "WANTS", object: "g" },
      { subject: "j", predicate: "CONCERNED_ABOUT", object: "g" },
    ],
  },
  {
    id: "employment",
    text: "Jordan works at Example Ventures.",
    entities: [
      entity("j", "person", "Jordan"),
      entity("o", "organization", "Example Ventures"),
    ],
    claims: [{ subject: "j", predicate: "WORKS_AT", object: "o" }],
  },
  {
    id: "trip",
    text: "Taylor and Jordan are planning a holiday in Las Vegas.",
    entities: [
      entity("j", "person", "Jordan"),
      entity("t", "person", "Taylor"),
      entity("trip", "event", "Las Vegas holiday"),
      entity("v", "place", "Las Vegas"),
    ],
    claims: [
      { subject: "trip", predicate: "HAS_PARTICIPANT", object: "j" },
      { subject: "trip", predicate: "HAS_PARTICIPANT", object: "t" },
      { subject: "trip", predicate: "LOCATED_AT", object: "v" },
    ],
  },
  {
    id: "debt",
    text: "Jordan owes Taylor 15.50 dollars for lunch at Sandwich Shop.",
    entities: [
      entity("j", "person", "Jordan"),
      entity("t", "person", "Taylor"),
      entity("d", "obligation", "Lunch reimbursement"),
      entity("shop", "organization", "Sandwich Shop"),
    ],
    claims: [
      { subject: "j", predicate: "OWES", object: "d" },
      { subject: "d", predicate: "OWED_TO", object: "t" },
      { subject: "d", predicate: "HAS_AMOUNT", value: "15.50" },
      { subject: "d", predicate: "FOR_CONTEXT", object: "shop" },
    ],
  },
  {
    id: "preference",
    text: "Taylor likes vegetarian food.",
    entities: [
      entity("t", "person", "Taylor"),
      entity("food", "topic", "Vegetarian food"),
    ],
    claims: [{ subject: "t", predicate: "LIKES", object: "food" }],
  },
  {
    id: "routine",
    text: "Taylor runs every morning.",
    entities: [
      entity("t", "person", "Taylor"),
      entity("run", "routine", "Morning running"),
    ],
    claims: [
      { subject: "t", predicate: "PRACTICES", object: "run" },
      { subject: "run", predicate: "HAS_FREQUENCY", value: "Every morning" },
    ],
  },
];
const questions = [
  ["switching jobs", "career"],
  ["career move", "career"],
  ["looking for another employer", "career"],
  ["where is Jordan employed", "employment"],
  ["who is joining the vacation", "trip"],
  ["travel destination", "trip"],
  ["money to pay back", "debt"],
  ["lunch reimbursement", "debt"],
  ["dietary preferences", "preference"],
  ["exercise habit", "routine"],
];
try {
  const sources = new Map();
  for (const f of fixtures) {
    const source = (
      await s.remember(a, {
        text: f.text,
        evidence: f.text,
        kind: "fact",
        basis: "user_statement",
        idempotencyKey: "benchmark-source-" + f.id,
      })
    ).memory;
    sources.set(f.id, source.id);
    const r = await k.record(a, {
      sourceMemoryId: source.id,
      sourceRevision: 1,
      idempotencyKey: "benchmark-claims-" + f.id,
      entities: f.entities,
      claims: f.claims.map((c) => ({
        ...c,
        evidence: f.text,
        basis: "explicit",
      })),
    });
    if (r.searchIndex.pending)
      throw new Error("Provider/index failures; benchmark incomplete");
  }
  const rows = [];
  for (const [query, expected] of questions) {
    const baseline = await s.recall(a, query, 5);
    const start = performance.now();
    const result = await k.recall(a, { query, personalOnly: true, limit: 5 });
    const ranked = [
      ...new Set(
        result.claims
          .filter((c) => /match/.test(c.reason))
          .map((c) => c.sourceMemoryId),
      ),
    ];
    rows.push({
      query,
      expected,
      lexicalHit: baseline.memories.some((m) => m.id === sources.get(expected)),
      hybridHit: ranked.includes(sources.get(expected)),
      rank: ranked.indexOf(sources.get(expected)) + 1 || null,
      milliseconds: Math.round(performance.now() - start),
      semantic: result.semanticSearch,
    });
  }
  console.log(
    JSON.stringify(
      {
        synthetic: true,
        model: "google/gemini-embedding-2",
        dimensions: 768,
        queries: rows.length,
        lexicalHits: rows.filter((r) => r.lexicalHit).length,
        hybridHits: rows.filter((r) => r.hybridHit).length,
        rows,
      },
      null,
      2,
    ),
  );
} finally {
  await s.graph.delete();
  await s.close();
}
