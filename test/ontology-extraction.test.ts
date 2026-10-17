import { test } from "node:test";
import assert from "node:assert/strict";
import { configuredOntologyExtractor } from "../src/ontology-extraction.js";

test("automatic ontology uses bounded structured output and sanitized provider failures", async () => {
  const context = {
    source: {
      text: "A fact",
      evidence: "A fact",
      basis: "user_statement",
      kind: "fact",
      eventAt: null,
    },
    authorName: "Owner",
    candidates: [],
    provisionalRelationships: [],
  };
  assert.equal(
    configuredOntologyExtractor({ OPENROUTER_API_KEY: "synthetic" }),
    undefined,
  );
  let body: any;
  const extractor = configuredOntologyExtractor(
    { ONTOLOGY_PROVIDER: "openrouter", OPENROUTER_API_KEY: "synthetic" },
    (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify({ entities: [], claims: [] }) },
          },
        ],
      });
    }) as typeof fetch,
  )!;
  assert.deepEqual(await extractor.extract(context), {
    entities: [],
    claims: [],
    newPredicates: [],
  });
  assert.equal(body.response_format.json_schema.strict, true);
  // Strict providers require every field, including defaulted ones.
  const schema = body.response_format.json_schema.schema;
  assert.ok(schema.required.includes("newPredicates"));
  assert.ok(
    schema.properties.claims.items.required.includes("negated"),
  );
  assert.equal(body.provider.require_parameters, true);
  assert.ok(body.messages[0].content.includes("UNTRUSTED DATA"));
  assert.deepEqual(JSON.parse(body.messages[1].content), context);
  for (const response of [
    Response.json({ secret: "private synthetic" }, { status: 403 }),
    Response.json({
      choices: [{ finish_reason: "length", message: { content: "{}" } }],
    }),
  ]) {
    const bad = configuredOntologyExtractor(
      { ONTOLOGY_PROVIDER: "openrouter", OPENROUTER_API_KEY: "synthetic" },
      (async () => response) as typeof fetch,
    )!;
    await assert.rejects(
      bad.extract(context),
      (e) => e instanceof Error && !/private|synthetic/.test(e.message),
    );
  }
});
