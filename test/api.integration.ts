import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { connectMemoryStore } from "../src/memory.js";
import { EventService } from "../src/events.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
test("real database API and both MCP protocols enforce identity, revisions and connection revocation", async () => {
  const store = await connectMemoryStore({
    FALKORDB_HOST: "127.0.0.1",
    FALKORDB_PORT: "16379",
    FALKORDB_PASSWORD: "local-verification",
    FALKORDB_MEMORY_GRAPH:
      "api_verification_" + randomUUID().replaceAll("-", ""),
  });
  const origin = "https://memory.example.com";
  const key = randomBytes(32).toString("base64");
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
      events: new EventService(store, key, origin),
      getProfile: async (id) => ({ id, name: id, email: id + "@example.com" }),
      verifyToken: async (token) =>
        ["user_a", "user_b"].includes(token)
          ? {
              token,
              clientId: "agent-test",
              scopes: ["profile", "email"],
              expiresAt: Date.now() / 1000 + 3600,
              resource: new URL(origin + "/mcp"),
              extra: { userId: token },
            }
          : undefined,
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
  const rpc = async (
    user: string,
    method: string,
    params: any = {},
    version = "2026-07-28",
  ) => {
    const r = await fetch(base + "/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + user,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": version,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return { status: r.status, body: await r.json() };
  };
  const api = async (user: string, action: string, input: any = {}) => {
    const r = await fetch(base + "/api/action", {
      method: "POST",
      headers: { Authorization: user, "Content-Type": "application/json" },
      body: JSON.stringify({ action, input }),
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    assert.equal((await fetch(base + "/api/overview")).status, 401);
    const discover = await rpc("user_a", "server/discover");
    assert.deepEqual(discover.body.result.supportedVersions, ["2026-07-28"]);
    assert.ok(discover.body.result.capabilities.events);
    assert.equal((await rpc("invalid", "tools/list")).status, 401);
    const listed = await rpc("user_a", "tools/list");
    assert.ok(listed.body.result.tools.some((t: any) => t.name === "remember"));
    for (const version of ["2026-07-28", "2025-11-25"]) {
      const empty = await rpc(
        "user_a",
        "tools/call",
        { name: "list_spaces", arguments: {} },
        version,
      );
      assert.deepEqual(
        CallToolResultSchema.parse(empty.body.result).structuredContent,
        { spaces: [] },
      );
    }
    const space = await store.createSpace(
      { userId: "user_a", clientId: "agent-test" },
      "Protocol verification",
    );
    for (const version of ["2026-07-28", "2025-11-25"]) {
      const populated = await rpc(
        "user_a",
        "tools/call",
        { name: "list_spaces", arguments: {} },
        version,
      );
      const result = CallToolResultSchema.parse(populated.body.result);
      const spaces = result.structuredContent!.spaces as { id: string }[];
      assert.equal(spaces[0].id, space.id);
      const foreign = await rpc(
        "user_b",
        "tools/call",
        { name: "list_spaces", arguments: {} },
        version,
      );
      assert.deepEqual(
        CallToolResultSchema.parse(foreign.body.result).structuredContent,
        { spaces: [] },
      );
    }
    const i = {
      text: "Synthetic verified memory",
      kind: "fact",
      basis: "user_statement",
      evidence: "Test utterance",
      entities: [{ type: "project", name: "Atlas" }],
      idempotencyKey: "api-memory-key",
    };
    const saved = await rpc("user_a", "tools/call", {
      name: "remember",
      arguments: i,
    });
    const id = saved.body.result.structuredContent.memory.id;
    assert.ok(id);
    const foreign = await rpc("user_b", "tools/call", {
      name: "get_memory",
      arguments: { id },
    });
    assert.ok(foreign.body.error);
    const legacy = await rpc(
      "user_a",
      "tools/call",
      { name: "recall", arguments: { query: "Synthetic" } },
      "2025-11-25",
    );
    assert.equal(legacy.body.result.structuredContent.memories[0].id, id);
    assert.equal(
      (
        await api("user_b", "revise_memory", {
          id,
          expectedRevision: 1,
          memory: { ...i, idempotencyKey: "foreign-key" },
        })
      ).status,
      404,
    );
    const connection = (
      await store.connections({ userId: "user_a", clientId: "dashboard" })
    )[0];
    await api("user_a", "set_connection", {
      id: connection.id,
      enabled: false,
    });
    assert.equal((await rpc("user_a", "tools/list")).status, 403);
    await api("user_b", "set_connection", { id: connection.id, enabled: true });
    assert.equal(
      (await rpc("user_a", "tools/list")).status,
      403,
      "Another user cannot reactivate the client",
    );
    await api("user_a", "set_connection", { id: connection.id, enabled: true });
    assert.equal((await rpc("user_a", "tools/list")).status, 200);
    const res = await api("user_a", "forget_memory", { id });
    assert.equal(res.status, 200);
    assert.ok(
      (
        await rpc("user_a", "tools/call", {
          name: "get_memory",
          arguments: { id },
        })
      ).body.error,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await store.graph.delete();
    await store.close();
  }
});
