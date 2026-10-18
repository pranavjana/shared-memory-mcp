import { test } from "node:test";
import assert from "node:assert/strict";
import { AssistantDirectory, clerkAssistantLookup } from "../src/assistants.js";

test("assistant names come from client metadata, Clerk registration, or the raw ID", async () => {
  const calls: string[] = [];
  const directory = new AssistantDirectory(async (id) => {
    calls.push(id);
    if (id === "we1EZdDXCj0XlknO")
      return {
        name: "Muse",
        clientImageUrl: "https://img.clerk.com/muse-logo",
      };
    if (id === "evil-logo")
      return { name: "Evil", clientImageUrl: "https://evil.example/x.png" };
    if (id === "broken") throw new Error("Clerk down");
    return null;
  });
  assert.deepEqual(await directory.identify("dashboard"), {
    name: "Dashboard",
    logo: null,
    source: "dashboard",
  });
  assert.equal(
    (await directory.identify("https://chatgpt.com/oauth/client.json")).name,
    "ChatGPT",
  );
  assert.equal(
    (await directory.identify("https://chatgpt.com/oauth/codex/client.json"))
      .name,
    "Codex",
  );
  assert.deepEqual(
    await directory.identify("https://agent.example.com/client.json"),
    { name: "agent.example.com", logo: null, source: "metadata" },
  );
  assert.deepEqual(await directory.identify("we1EZdDXCj0XlknO"), {
    name: "Muse",
    logo: "https://img.clerk.com/muse-logo",
    source: "registration",
  });
  // Only Clerk-hosted logos are allowed by the dashboard CSP.
  assert.equal((await directory.identify("evil-logo")).logo, null);
  assert.deepEqual(await directory.identify("opaque-unknown"), {
    name: "opaque-unknown",
    logo: null,
    source: "unknown",
  });
  assert.equal((await directory.identify("broken")).source, "unknown");
  // URL and dashboard IDs never reach Clerk; registered names are cached.
  await directory.identify("we1EZdDXCj0XlknO");
  assert.deepEqual(calls, [
    "we1EZdDXCj0XlknO",
    "evil-logo",
    "opaque-unknown",
    "broken",
  ]);
  const all = await directory.identifyAll(["dashboard", "dashboard", "x"]);
  assert.deepEqual(Object.keys(all), ["dashboard", "x"]);
});

test("Clerk lookup keeps only the exact client ID match", async () => {
  const lookup = clerkAssistantLookup({
    oauthApplications: {
      async list({ nameQuery }) {
        assert.equal(nameQuery, "abc");
        // nameQuery also matches names containing the text.
        return {
          data: [
            { clientId: "zzz", name: "abc impostor", clientImageUrl: null },
            { clientId: "abc", name: "Muse", clientImageUrl: null },
          ],
        };
      },
    },
  });
  assert.deepEqual(await lookup("abc"), { name: "Muse", clientImageUrl: null });
  const none = clerkAssistantLookup({
    oauthApplications: {
      async list() {
        return {
          data: [{ clientId: "other", name: "abc", clientImageUrl: null }],
        };
      },
    },
  });
  assert.equal(await none("abc"), null);
});
