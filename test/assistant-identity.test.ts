import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantName, sourceLabel } from "../web/assistant-identity.js";

test("memory source shows a known assistant name and never hides an opaque client ID", () => {
  assert.equal(
    sourceLabel("https://chatgpt.com/oauth/codex/client.json"),
    "Codex",
  );
  assert.equal(sourceLabel("Mz1lRFME372kmUIB"), "Muse");
  assert.equal(sourceLabel("dashboard"), "Added in dashboard");
  assert.equal(
    sourceLabel("https://agent.example.com/client.json"),
    "agent.example.com",
  );
  assert.equal(
    sourceLabel("opaque_client_123"),
    "Assistant (opaque_client_123)",
  );
  assert.equal(
    sourceLabel("javascript:alert(1)"),
    "Assistant (javascript:alert(1))",
  );
  assert.deepEqual(assistantName("Mz1lRFME372kmUIB"), {
    name: "Muse",
    kind: "muse",
  });
});
