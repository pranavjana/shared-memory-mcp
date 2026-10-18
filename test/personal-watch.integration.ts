import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { connectMemoryStore } from "../src/memory.js";
import { AutomaticOntology } from "../src/ontology-extraction.js";
import { AssistantDirectory } from "../src/assistants.js";

// Bearer tokens are "<userId>:<clientId>" so one user can connect several assistants.
const muse = "user_a:muse-client";
const codex = "user_a:https://chatgpt.com/oauth/codex/client.json";
const friend = "user_b:friend-client";

test("personal watch tick reports the user's own memories written by other assistants only", async () => {
  const store = await connectMemoryStore({
    FALKORDB_HOST: "127.0.0.1",
    FALKORDB_PORT: "16379",
    FALKORDB_PASSWORD: "local-verification",
    FALKORDB_MEMORY_GRAPH: "personal_watch_" + randomUUID().replaceAll("-", ""),
  });
  const origin = "https://memory.example.com";
  const app = createApp(
    {
      publicUrl: origin,
      secretKey: "sk_test_only",
      publishableKey:
        "pk_test_" + Buffer.from("test.clerk.accounts.dev$").toString("base64"),
      accountPortalUrl: "https://test.accounts.dev",
    },
    {
      memory: store,
      automaticOntology: new AutomaticOntology(store, undefined, {
        async extract() {
          return { entities: [], claims: [] };
        },
      }),
      getProfile: async (id) => ({ id, name: id, email: id + "@example.com" }),
      // Stands in for Clerk's dynamic client registrations.
      assistants: new AssistantDirectory(async (id) =>
        id === "muse-client"
          ? {
              name: "Muse",
              clientImageUrl: "https://img.clerk.com/muse",
              clientUri: "https://agent.meta.ai/",
            }
          : null,
      ),
      verifyToken: async (token) => {
        const split = token.indexOf(":");
        const userId = token.slice(0, split);
        return ["user_a", "user_b"].includes(userId)
          ? {
              ok: true as const,
              auth: {
                token,
                clientId: token.slice(split + 1),
                scopes: ["profile", "email"],
                expiresAt: Date.now() / 1000 + 3600,
                resource: new URL(origin + "/mcp"),
                extra: { userId },
              },
            }
          : {
              ok: false as const,
              code: "invalid_token" as const,
              message: "invalid_token",
            };
      },
      dashboardAuthenticate: async (req) =>
        ["user_a", "user_b"].includes(req.get("authorization") ?? "")
          ? {
              userId: req.get("authorization")!,
              clientId: "dashboard",
              name: "Test",
              email: req.get("authorization") + "@example.com",
            }
          : undefined,
    },
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const call = async (
    token: string,
    name: string,
    args: any = {},
    version = "2026-07-28",
  ) => {
    const r = await fetch(base + "/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": version,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    assert.equal(r.status, 200, name);
    const body = await r.json();
    assert.ok(!body.error && !body.result.isError, JSON.stringify(body));
    return body.result.structuredContent;
  };
  const api = async (user: string, action: string, input: any = {}) => {
    const r = await fetch(base + "/api/action", {
      method: "POST",
      headers: { Authorization: user, "Content-Type": "application/json" },
      body: JSON.stringify({ action, input }),
    });
    assert.equal(r.status, 200, action);
    return r.json();
  };
  const memory = (text: string, idempotencyKey: string) => ({
    text,
    kind: "fact",
    basis: "user_statement",
    evidence: text,
    entities: [],
    idempotencyKey,
  });
  // The personal-watch procedure from skills/*/references/tick.md.
  type WatchState = { since?: number; seen: string[] };
  const intervalMinutes = 15;
  const fingerprint = (m: any) => m.id + ":" + m.revision;
  const tick = async (token: string, state: WatchState) => {
    const status = await call(token, "get_connection_status");
    const recalled = await call(token, "recall", { query: "", limit: 50 });
    const owned = recalled.memories.filter(
      (m: any) => m.owner === status.user.id,
    );
    const candidates = owned.filter(
      (m: any) => m.sourceClient !== status.client.id,
    );
    const since = state.since;
    const fresh =
      since === undefined
        ? candidates.filter(
            (m: any) =>
              m.updatedAt >= Date.now() - (intervalMinutes + 2) * 60_000,
          )
        : candidates.filter(
            (m: any) =>
              m.updatedAt > since ||
              (m.updatedAt === since && !state.seen.includes(fingerprint(m))),
          );
    if (owned.length) {
      state.since = Math.max(...owned.map((m: any) => m.updatedAt));
      state.seen = owned
        .filter((m: any) => m.updatedAt === state.since)
        .map(fingerprint);
    }
    return {
      recalled: recalled.memories,
      fresh: fresh.map((m: any) => ({
        text: m.text,
        sourceClient: m.sourceClient,
        revision: m.revision,
      })),
    };
  };
  const texts = (r: { fresh: { text: string }[] }) =>
    r.fresh.map((m) => m.text).sort();

  try {
    // Both MCP protocol paths identify the calling assistant.
    for (const version of ["2026-07-28", "2025-11-25"]) {
      const status = await call(muse, "get_connection_status", {}, version);
      assert.equal(status.user.id, "user_a");
      assert.equal(status.client.id, "muse-client");
    }
    assert.equal(
      (await call(codex, "get_connection_status")).client.id,
      "https://chatgpt.com/oauth/codex/client.json",
    );

    const museSaved = await call(
      muse,
      "remember",
      memory("Muse saved: prefers morning standups.", "personal-watch-muse-1"),
    );
    const codexSaved = await call(
      codex,
      "remember",
      memory("Codex saved: Atlas ships Friday.", "personal-watch-codex-1"),
    );
    await api(
      "user_a",
      "remember",
      memory("Dashboard saved: allergic to peanuts.", "personal-watch-dash-1"),
    );
    await call(
      friend,
      "remember",
      memory("Friend private: planning a surprise.", "personal-watch-friend-1"),
    );
    const friendShared = await call(
      friend,
      "remember",
      memory("Friend shared: demo moved to 3pm.", "personal-watch-friend-2"),
    );
    const space = await api("user_a", "create_space", { name: "Watch test" });
    const invitation = await api("user_a", "invite", {
      spaceId: space.id,
      email: "user_b@example.com",
      role: "contributor",
    });
    await api("user_b", "accept_invitation", { token: invitation.token });
    await call(friend, "share_memory", {
      id: friendShared.memory.id,
      spaceId: space.id,
      enabled: true,
      userRequested: true,
      idempotencyKey: "personal-watch-friend-share",
    });

    // Saved by Codex long before the watch started: baselined, not reported.
    const old = await call(
      codex,
      "remember",
      memory("Codex saved: old trip notes.", "personal-watch-codex-old"),
    );
    await store.query("MATCH (m:Memory {id:$id}) SET m.updatedAt=$t", {
      id: old.memory.id,
      t: Date.now() - 2 * 60 * 60_000,
    });

    const museState: WatchState = { seen: [] };
    const first = await tick(muse, museState);
    assert.ok(
      first.recalled.some((m: any) => m.id === old.memory.id),
      "old memory is a candidate but outside the first-tick window",
    );
    assert.deepEqual(texts(first), [
      "Codex saved: Atlas ships Friday.",
      "Dashboard saved: allergic to peanuts.",
    ]);
    assert.deepEqual(first.fresh.map((m) => m.sourceClient).sort(), [
      "dashboard",
      "https://chatgpt.com/oauth/codex/client.json",
    ]);
    // recall does return the friend's shared memory; only the owner filter keeps it out.
    assert.ok(
      first.recalled.some((m: any) => m.id === friendShared.memory.id),
      "shared-in memory is visible to recall",
    );
    assert.ok(
      !first.recalled.some((m: any) => m.text.startsWith("Friend private")),
      "another user's private memory is never recalled",
    );

    assert.deepEqual(
      (await tick(muse, museState)).fresh,
      [],
      "since cursor holds",
    );

    // Another assistant revising Muse's memory is a new write.
    await call(codex, "revise_memory", {
      id: museSaved.memory.id,
      expectedRevision: 1,
      memory: memory(
        "Muse saved: prefers afternoon standups.",
        "personal-watch-codex-revise",
      ),
    });
    const revised = await tick(muse, museState);
    assert.deepEqual(revised.fresh, [
      {
        text: "Muse saved: prefers afternoon standups.",
        sourceClient: "https://chatgpt.com/oauth/codex/client.json",
        revision: 2,
      },
    ]);

    // Muse's own revision of a memory Codex wrote is not reported back to Muse.
    await call(muse, "revise_memory", {
      id: codexSaved.memory.id,
      expectedRevision: 1,
      memory: memory(
        "Codex saved: Atlas ships Monday.",
        "personal-watch-muse-revise",
      ),
    });
    assert.deepEqual((await tick(muse, museState)).fresh, []);

    // Codex's watch sees Muse's and the dashboard's writes, never its own.
    const codexTick = await tick(codex, { since: 0, seen: [] });
    assert.deepEqual(texts(codexTick), [
      "Codex saved: Atlas ships Monday.",
      "Dashboard saved: allergic to peanuts.",
    ]);
    assert.ok(
      codexTick.fresh.every(
        (m) => m.sourceClient !== "https://chatgpt.com/oauth/codex/client.json",
      ),
    );

    // The friend's watch never includes user_a's memories.
    const friendTick = await tick(friend, { since: 0, seen: [] });
    assert.deepEqual(friendTick.fresh, []);
    assert.ok(friendTick.recalled.every((m: any) => m.owner === "user_b"));

    // A forgotten memory drops out of the next tick's candidates.
    // list_assistants names every connected assistant and what each last saved.
    const listed = await call(muse, "list_assistants");
    assert.deepEqual(listed.current, {
      clientId: "muse-client",
      name: "Muse",
      logo: "https://img.clerk.com/muse",
      source: "registration",
      brand: "muse",
    });
    const byId = Object.fromEntries(
      listed.assistants.map((x: any) => [x.clientId, x]),
    );
    assert.deepEqual(Object.keys(byId).sort(), [
      "https://chatgpt.com/oauth/codex/client.json",
      "muse-client",
    ]);
    assert.equal(byId["muse-client"].current, true);
    assert.equal(byId["muse-client"].memories, 1);
    assert.equal(byId["muse-client"].enabled, true);
    assert.equal(
      byId["https://chatgpt.com/oauth/codex/client.json"].name,
      "Codex",
    );
    assert.equal(
      byId["https://chatgpt.com/oauth/codex/client.json"].memories,
      2,
    );
    assert.equal(
      byId["https://chatgpt.com/oauth/codex/client.json"].current,
      false,
    );
    assert.deepEqual(listed.otherSources, [
      {
        clientId: "dashboard",
        name: "Dashboard",
        logo: null,
        source: "dashboard",
        brand: null,
        memories: 1,
      },
    ]);
    const friendList = await call(friend, "list_assistants");
    assert.deepEqual(
      friendList.assistants.map((x: any) => x.clientId),
      ["friend-client"],
      "another user's assistants are never listed",
    );
    assert.equal(friendList.current.source, "unknown");

    // explain_memory names both the latest and the original saver.
    const explained = await call(muse, "explain_memory", {
      id: museSaved.memory.id,
    });
    assert.equal(
      explained.history.find((h: any) => h.revision === 1).sourceClient,
      "muse-client",
    );
    assert.equal(
      explained.assistants[explained.memory.sourceClient].name,
      "Codex",
    );
    assert.equal(explained.assistants["muse-client"].name, "Muse");

    // The dashboard overview carries the same names.
    const overview = await fetch(base + "/api/overview", {
      headers: { Authorization: "user_a" },
    }).then((r) => r.json());
    assert.equal(overview.assistants["muse-client"].name, "Muse");
    assert.equal(
      overview.assistants["https://chatgpt.com/oauth/codex/client.json"].name,
      "Codex",
    );
    assert.equal(overview.assistants.dashboard.name, "Dashboard");

    await call(codex, "forget_memory", { id: codexSaved.memory.id });
    const afterForget = await tick(muse, { since: 0, seen: [] });
    assert.deepEqual(texts(afterForget), [
      "Codex saved: old trip notes.",
      "Dashboard saved: allergic to peanuts.",
      "Muse saved: prefers afternoon standups.",
    ]);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await store.graph.delete();
    await store.close();
  }
});
