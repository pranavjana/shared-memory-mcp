import { test } from "node:test";
import assert from "node:assert/strict";
import { inlineParams, loadQuery, withParams } from "../scripts/graph-demo.js";

test("query files load without their comment lines", () => {
  const query = loadQuery("01-can-read");
  assert.ok(query.startsWith("MATCH (m:Memory {id:$id})"));
  assert.ok(!query.includes("//"));
});

test("parameters become a CYPHER prefix for GRAPH.EXPLAIN", () => {
  assert.equal(
    withParams("MATCH (m:Memory {id:$id}) RETURN m", { id: "mem_1", ids: ["a", "b"] }),
    'CYPHER id="mem_1" ids=["a","b"] MATCH (m:Memory {id:$id}) RETURN m',
  );
});

test("Browser copies have values written in and leave unknown names alone", () => {
  assert.equal(
    inlineParams("MATCH (p:Person {id:$user}) WHERE p.id IN $ids AND $other RETURN p", {
      user: 'demo "quoted"',
      ids: ["a"],
    }),
    'MATCH (p:Person {id:"demo \\"quoted\\""}) WHERE p.id IN ["a"] AND $other RETURN p',
  );
});
