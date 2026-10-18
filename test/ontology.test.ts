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

test("everyday relationships preserve debtor direction, exact money, desire vs employment and event participants", () => {
  const base = {
    sourceMemoryId: "mem_source",
    sourceRevision: 1,
    idempotencyKey: "everyday-schema-001",
    entities: [
      { key: "a", type: "person", name: "Test Person" },
      { key: "b", type: "person", name: "Other Person" },
      { key: "org", type: "organization", name: "Example Org" },
      { key: "debt", type: "obligation", name: "Lunch reimbursement" },
      { key: "goal", type: "goal", name: "Changing companies" },
      { key: "trip", type: "event", name: "Vegas trip" },
      { key: "place", type: "place", name: "Vegas" },
    ],
    claims: [] as any[],
  };
  const claim = (
    subject: string,
    predicate: string,
    object?: string,
    value?: string,
  ) => ({
    subject,
    predicate,
    ...(object ? { object } : {}),
    ...(value !== undefined ? { value } : {}),
    basis: "explicit",
    evidence: "synthetic utterance",
  });
  const check = (c: any) =>
    knowledgeInput.safeParse({ ...base, claims: [c] }).success;
  assert.ok(check(claim("a", "WORKS_AT", "org")));
  assert.ok(check(claim("a", "WANTS", "goal")));
  assert.ok(check(claim("trip", "HAS_PARTICIPANT", "a")));
  assert.ok(check(claim("trip", "LOCATED_AT", "place")));
  assert.ok(check(claim("a", "OWES", "debt")));
  assert.ok(check(claim("debt", "OWED_TO", "b")));
  assert.equal(
    check(claim("a", "OWES", "b")),
    false,
    "Separate obligations cannot collapse into a person-person edge",
  );
  assert.equal(check(claim("a", "WORKS_AT", "goal")), false);
  assert.ok(check(claim("debt", "HAS_AMOUNT", undefined, "15.50")));
  for (const invalid of [
    "-15.50",
    "$15.50",
    "1e3",
    "NaN",
    "15.5 dollars",
    "0.1234567",
  ])
    assert.equal(check(claim("debt", "HAS_AMOUNT", undefined, invalid)), false);
  assert.ok(check(claim("debt", "HAS_CURRENCY", undefined, "USD")));
  assert.equal(
    check(claim("debt", "HAS_CURRENCY", undefined, "dollars")),
    false,
  );
  assert.equal(check(claim("debt", "HAS_CURRENCY", undefined, "ZZZ")), false);
});
