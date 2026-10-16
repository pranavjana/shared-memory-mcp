import { test } from "node:test";
import assert from "node:assert/strict";
import { knowledgeInput, ontology } from "../src/ontology.js";
const input = () => ({
  sourceMemoryId: "mem_source",
  sourceRevision: 1,
  idempotencyKey: "ontology-write-001",
  entities: [
    { key: "task:auth", type: "task", name: "OAuth setup" },
    { key: "person:roshan", type: "person", name: "Roshan" },
  ],
  claims: [
    {
      subject: "task:auth",
      predicate: "ASSIGNED_TO",
      object: "person:roshan",
      basis: "explicit",
      evidence: "Roshan will handle OAuth",
    },
  ],
});
test("ontology registry validates endpoint types, values, properties and bounded identities", () => {
  assert.ok(knowledgeInput.safeParse(input()).success);
  const wrongSubject = input();
  wrongSubject.entities[0].type = "person";
  assert.equal(knowledgeInput.safeParse(wrongSubject).success, false);
  const wrongTarget = input();
  wrongTarget.entities[1].type = "project";
  assert.equal(knowledgeInput.safeParse(wrongTarget).success, false);
  assert.equal(
    knowledgeInput.safeParse({
      ...input(),
      entities: [
        { ...input().entities[0], properties: { secret: "not in schema" } },
        input().entities[1],
      ],
    }).success,
    false,
  );
  assert.equal(
    knowledgeInput.safeParse({
      ...input(),
      claims: [
        {
          subject: "task:auth",
          predicate: "HAS_STATUS",
          value: "done-ish",
          basis: "explicit",
          evidence: "done",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    knowledgeInput.safeParse({
      ...input(),
      claims: [
        {
          subject: "task:auth",
          predicate: "DUE_AT",
          value: "tomorrow",
          basis: "explicit",
          evidence: "tomorrow",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    knowledgeInput.safeParse({
      ...input(),
      claims: [
        {
          ...input().claims[0],
          validFrom: "2026-10-15T12:00:00Z",
          validUntil: "2026-10-14T12:00:00Z",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    knowledgeInput.safeParse({
      ...input(),
      entities: [...input().entities, input().entities[0]],
    }).success,
    false,
  );
  assert.equal(
    knowledgeInput.safeParse({
      ...input(),
      claims: [
        {
          subject: "task:auth",
          predicate: "DEPENDS_ON",
          object: "task:auth",
          basis: "explicit",
          evidence: "depends",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    knowledgeInput.safeParse({
      ...input(),
      claims: [{ ...input().claims[0], predicate: "INVENTED_EDGE" }],
    }).success,
    false,
  );
  const ids = new Set(ontology.types.map((t) => t.id));
  for (const r of ontology.relationships)
    for (const endpoint of [...r.from, ...r.to])
      assert.ok(
        ids.has(endpoint),
        `${r.id} references missing type ${endpoint}`,
      );
});
