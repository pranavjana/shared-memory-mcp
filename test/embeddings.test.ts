import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configuredEmbedder,
  embeddingText,
  normalizeVector,
} from "../src/embeddings.js";
test("Embedding 2 uses retrieval prefixes, fixed dimensions, normalization and safe provider errors", async () => {
  let sent: any, headers: any;
  const request = (async (_url: any, init: any) => {
    sent = JSON.parse(init.body);
    headers = init.headers;
    return Response.json({
      data: [
        { embedding: Array.from({ length: 768 }, (_, i) => (i === 0 ? 2 : 0)) },
      ],
    });
  }) as typeof fetch;
  const e = configuredEmbedder(
    {
      EMBEDDING_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "synthetic-fixture",
    },
    request,
  )!;
  assert.equal((await e.embed("switching jobs", "query"))[0], 1);
  assert.equal(sent.model, "google/gemini-embedding-2");
  assert.equal(sent.dimensions, 768);
  assert.deepEqual(sent.input, ["task: search result | query: switching jobs"]);
  assert.equal(headers.Authorization, "Bearer synthetic-fixture");
  assert.ok(!("taskType" in sent));
  assert.equal(
    embeddingText("career change", "document"),
    "title: personal memory | text: career change",
  );
  assert.throws(() => normalizeVector([0, 0], 2));
  assert.throws(() => normalizeVector([1, NaN], 2));
  assert.throws(() => normalizeVector([1], 2));
  const bad = configuredEmbedder(
    {
      EMBEDDING_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "synthetic-fixture",
    },
    (async () =>
      Response.json(
        { error: { message: "PRIVATE INPUT synthetic-fixture" } },
        { status: 403 },
      )) as typeof fetch,
  )!;
  await assert.rejects(
    bad.embed("private text", "query"),
    /^Error: Embedding provider unavailable \(403\)$/,
  );
  assert.equal(configuredEmbedder({}), undefined);
  assert.notEqual(
    e.signature,
    configuredEmbedder(
      { EMBEDDING_PROVIDER: "gemini", GEMINI_API_KEY: "synthetic-fixture" },
      request,
    )!.signature,
  );
});
