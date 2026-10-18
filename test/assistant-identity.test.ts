import { test } from "node:test";
import assert from "node:assert/strict";
import { displayAssistant, sourceLabel } from "../web/assistant-identity.js";

test("memory source shows the server-resolved name and never hides an opaque client ID", () => {
  const muse = {
    name: "Muse",
    logo: "https://img.clerk.com/muse",
    source: "registration" as const,
  };
  assert.equal(sourceLabel("we1EZdDXCj0XlknO", muse), "Muse");
  assert.equal(
    displayAssistant("we1EZdDXCj0XlknO", muse).title,
    "we1EZdDXCj0XlknO · name registered by the app",
  );
  assert.equal(sourceLabel("https://chatgpt.com/oauth/client.json"), "ChatGPT");
  assert.equal(
    sourceLabel("https://chatgpt.com/oauth/codex/client.json"),
    "Codex",
  );
  assert.equal(
    displayAssistant("https://chatgpt.com/oauth/client.json").brand,
    "openai",
  );
  assert.equal(
    displayAssistant("we1EZdDXCj0XlknO", { ...muse, brand: "muse" }).brand,
    "muse",
  );
  assert.equal(displayAssistant("we1EZdDXCj0XlknO", muse).brand, null);
  assert.equal(sourceLabel("dashboard"), "Added in dashboard");
  assert.equal(
    sourceLabel("https://agent.example.com/client.json"),
    "agent.example.com",
  );
  assert.equal(
    sourceLabel("opaque_client_123", {
      name: "opaque_client_123",
      logo: null,
      source: "unknown",
    }),
    "Assistant (opaque_client_123)",
  );
  assert.equal(
    sourceLabel("javascript:alert(1)"),
    "Assistant (javascript:alert(1))",
  );
  assert.equal(displayAssistant("opaque").name, "Assistant");
});
