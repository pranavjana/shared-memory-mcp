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
        clientUri: "https://agent.meta.ai/",
      };
    if (id === "fake-muse")
      return {
        name: "Muse",
        clientImageUrl: null,
        clientUri: "https://evil.example/",
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
    brand: null,
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
    { name: "agent.example.com", logo: null, source: "metadata", brand: null },
  );
  assert.deepEqual(await directory.identify("we1EZdDXCj0XlknO"), {
    name: "Muse",
    logo: "https://img.clerk.com/muse-logo",
    source: "registration",
    brand: "muse",
  });
  // The Muse mark needs Muse's registered client URI, not just the name.
  assert.equal((await directory.identify("fake-muse")).brand, null);
  assert.equal(
    (await directory.identify("https://chatgpt.com/oauth/client.json")).brand,
    "openai",
  );
  // Only Clerk-hosted logos are allowed by the dashboard CSP.
  assert.equal((await directory.identify("evil-logo")).logo, null);
  assert.deepEqual(await directory.identify("opaque-unknown"), {
    name: "opaque-unknown",
    logo: null,
    source: "unknown",
    brand: null,
  });
  assert.equal((await directory.identify("broken")).source, "unknown");
  // URL and dashboard IDs never reach Clerk; registered names are cached.
  await directory.identify("we1EZdDXCj0XlknO");
  assert.deepEqual(calls, [
    "we1EZdDXCj0XlknO",
    "fake-muse",
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
            {
              clientId: "zzz",
              name: "abc impostor",
              clientImageUrl: null,
              clientUri: null,
            },
            {
              clientId: "abc",
              name: "Muse",
              clientImageUrl: null,
              clientUri: "https://agent.meta.ai/",
            },
          ],
        };
      },
    },
  });
  assert.deepEqual(await lookup("abc"), {
    name: "Muse",
    clientImageUrl: null,
    clientUri: "https://agent.meta.ai/",
  });
  const none = clerkAssistantLookup({
    oauthApplications: {
      async list() {
        return {
          data: [
            {
              clientId: "other",
              name: "abc",
              clientImageUrl: null,
              clientUri: null,
            },
          ],
        };
      },
    },
  });
  assert.equal(await none("abc"), null);
});
