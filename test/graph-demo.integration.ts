import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runDemo } from "../scripts/graph-demo.js";

// Keeps cypher/queries honest: the documented queries must return what the docs say.
test("the documented Cypher queries return the documented results on the demo graph", async () => {
  const { results, memories } = await runDemo(
    {
      FALKORDB_HOST: process.env.FALKORDB_TEST_HOST ?? "127.0.0.1",
      FALKORDB_PORT: process.env.FALKORDB_TEST_PORT ?? "16379",
      FALKORDB_PASSWORD: process.env.FALKORDB_TEST_PASSWORD ?? "local-verification",
    },
    { graph: "graph_demo_" + randomUUID().replaceAll("-", "") },
  );
  const ids = (key: string) => results[key].map((r) => r.id);
  assert.deepEqual(ids("01-can-read: Afshal reads Pranav's shared note"), [memories.launch]);
  assert.deepEqual(ids("01-can-read: Eve (not a member) reads the same note"), []);
  assert.deepEqual(ids("01-can-read: Afshal reads Pranav's private note"), []);
  assert.deepEqual(ids("02-recall-keyword: Pranav searches 'launch'"), [memories.launch]);
  assert.deepEqual(
    new Set(ids("03-recall-via-entity: Hop from that result through its Entity")),
    new Set([memories.budget, memories.review]),
  );
  assert.deepEqual(
    new Set(ids("04-recall-via-space: Hop from that result through its Space")),
    new Set([memories.review, memories.deck]),
  );
  assert.equal(results["05-space-feed: Roshan's feed for the space"].length, 3);
  assert.deepEqual(results["05-space-feed: Eve's feed for the space"], []);
  const claims = results["06-space-claims: Claims in the space, seen by Roshan"];
  assert.equal(claims.length, 2);
  assert.equal(claims[0].subjectNode, claims[1].subjectNode, "Both authors' mentions of Afshal meet at one node");
  assert.ok(claims.every((c) => JSON.parse(c.claim as string).subject.memberId === "demo-afshal"));
});
