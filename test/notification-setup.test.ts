import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationPrompt } from "../src/onboarding.js";
test("notification setup binds the endpoint and space, requires real callbacks and separates both event scopes", () => {
  for (const host of ["muse", "dot"] as const) {
    const prompt = notificationPrompt(
      "https://sandbox.example.com/mcp",
      "space_test",
      host,
    );
    assert.ok(prompt.includes("https://sandbox.example.com/mcp"));
    assert.ok(prompt.includes("space_id=space_test"));
    assert.ok(prompt.includes("memory.changed and knowledge.changed"));
    assert.ok(prompt.includes("get_shared_update"));
    assert.ok(prompt.includes("Do not message the sender"));
    assert.ok(prompt.includes("refresh before expiry"));
    assert.ok(!prompt.includes("up.railway.app"));
  }
  assert.ok(
    notificationPrompt(undefined, "space_test", "muse").includes(
      "report that exact missing capability",
    ),
  );
});
