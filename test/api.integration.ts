import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { connectMemoryStore } from "../src/memory.js";
import { AutomaticOntology } from "../src/ontology-extraction.js";
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
      automaticOntology: new AutomaticOntology(store, undefined, {
        async extract(context) {
          if (context.source.text !== "Nadia works at Acme.")
            return { entities: [], claims: [] };
          return {
            entities: [
              {
                key: "nadia",
                type: "person",
                name: "Nadia",
                existingKey: null,
                identityEvidence: null,
              },
              {
                key: "acme",
                type: "organization",
                name: "Acme",
                existingKey: null,
                identityEvidence: null,
              },
            ],
            claims: [
              {
                subject: "nadia",
                predicate: "WORKS_AT",
                object: "acme",
                value: null,
                evidence: context.source.text,
                validFrom: null,
                validUntil: null,
              },
            ],
          };
        },
      }),
      events: new EventService(store, key, origin),
      getProfile: async (id) => ({ id, name: id, email: id + "@example.com" }),
      verifyToken: async (token) =>
        ["user_a", "user_b"].includes(token)
          ? {
              ok: true as const,
              auth: {
                token,
                clientId: "agent-test",
                scopes: ["profile", "email"],
                expiresAt: Date.now() / 1000 + 3600,
                resource: new URL(origin + "/mcp"),
                extra: { userId: token },
              },
            }
          : {
              ok: false as const,
              code: "invalid_token" as const,
              message: "invalid_token",
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
    const eventCatalog = await rpc("user_a", "events/list");
    assert.deepEqual(
      eventCatalog.body.result.events.map((e: any) => e.name),
      ["memory.changed", "knowledge.changed"],
    );
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
    assert.equal((await fetch(base + "/api/ontology")).status, 401);
    const schema = await fetch(base + "/api/ontology", {
      headers: { Authorization: "user_a" },
    }).then((r) => r.json());
    assert.equal(schema.version, "1.1.0");
    const knowledge = {
      sourceMemoryId: id,
      sourceRevision: 1,
      idempotencyKey: "api-ontology-001",
      entities: [{ key: "project:atlas", type: "project", name: "Atlas" }],
      claims: [
        {
          subject: "project:atlas",
          predicate: "HAS_STATUS",
          value: "in_progress",
          basis: "explicit",
          evidence: "Synthetic verified memory",
        },
      ],
    };
    for (const version of ["2026-07-28", "2025-11-25"]) {
      const registry = await rpc(
        "user_a",
        "tools/call",
        { name: "get_ontology", arguments: {} },
        version,
      );
      assert.equal(registry.body.result.structuredContent.version, "1.1.0");
      const structured = await rpc(
        "user_a",
        "tools/call",
        { name: "record_knowledge", arguments: knowledge },
        version,
      );
      assert.equal(structured.body.result.structuredContent.saved, true);
      const retrieved = await rpc(
        "user_a",
        "tools/call",
        { name: "recall_knowledge", arguments: { query: "Atlas" } },
        version,
      );
      assert.equal(
        retrieved.body.result.structuredContent.claims[0].subject.name,
        "Atlas",
      );
      const denied = await rpc(
        "user_b",
        "tools/call",
        { name: "recall_knowledge", arguments: { query: "Atlas" } },
        version,
      );
      assert.equal(denied.body.result.structuredContent.claims.length, 0);
    }
    assert.equal(
      (
        await api("user_a", "record_knowledge", {
          ...knowledge,
          idempotencyKey: "invalid-ontology-property",
          entities: [
            { ...knowledge.entities[0], properties: { unrecognized: "value" } },
          ],
        })
      ).status,
      400,
    );
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
    assert.deepEqual(
      (await api("user_a", "space_memories", { spaceId: space.id })).body
        .memories,
      [],
      "Even the owner's private record is excluded until explicitly shared",
    );
    assert.equal(
      (await api("user_b", "space_memories", { spaceId: space.id })).status,
      403,
    );
    const invitation = await api("user_a", "invite", {
      spaceId: space.id,
      email: "user_b@example.com",
      role: "contributor",
    });
    assert.equal(invitation.status, 200);
    assert.ok(invitation.body.url.includes("/dashboard?invite="));
    assert.equal(
      (
        await api("user_a", "accept_invitation", {
          token: invitation.body.token,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await api("user_b", "accept_invitation", {
          token: invitation.body.token,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await api("user_a", "share_memory", {
          id,
          spaceId: space.id,
          enabled: true,
          userRequested: true,
          idempotencyKey: "explicit-api-share",
        })
      ).status,
      200,
    );
    for (const version of ["2026-07-28", "2025-11-25"]) {
      const packet = await rpc(
        "user_b",
        "tools/call",
        { name: "get_shared_update", arguments: { id, spaceId: space.id } },
        version,
      );
      assert.equal(packet.body.result.structuredContent.update.memory.id, id);
      const setup = await rpc(
        "user_b",
        "tools/call",
        {
          name: "notification_setup",
          arguments: { spaceId: space.id, host: "dot" },
        },
        version,
      );
      assert.equal(setup.body.result.structuredContent.eventsAvailable, true);
      assert.ok(
        setup.body.result.structuredContent.prompt.includes(origin + "/mcp"),
      );
    }
    const bPrivate = (
      await api("user_b", "remember", {
        ...i,
        text: "B private source",
        idempotencyKey: "b-private-source",
      })
    ).body.memory.id;
    const bShared = (
      await api("user_b", "remember", {
        ...i,
        text: "B selected shared update",
        idempotencyKey: "b-shared-source",
      })
    ).body.memory.id;
    assert.equal(
      (
        await api("user_b", "share_memory", {
          id: bShared,
          spaceId: space.id,
          enabled: true,
          userRequested: true,
          idempotencyKey: "b-explicit-share",
        })
      ).status,
      200,
    );
    const combined = await api("user_a", "space_memories", {
      spaceId: space.id,
    });
    assert.deepEqual(
      new Set(combined.body.memories.map((m: any) => m.id)),
      new Set([id, bShared]),
    );
    assert.ok(!combined.body.memories.some((m: any) => m.id === bPrivate));
    const firstPage = await api("user_b", "space_memories", {
      spaceId: space.id,
      limit: 1,
    });
    const nextPage = await api("user_b", "space_memories", {
      spaceId: space.id,
      limit: 1,
      cursor: firstPage.body.nextCursor,
    });
    assert.notEqual(
      firstPage.body.memories[0].id,
      nextPage.body.memories[0].id,
    );
    assert.equal(nextPage.body.nextCursor, null);
    assert.equal(
      (await api("user_a", "space_memories", { spaceId: space.id, limit: 101 }))
        .status,
      400,
    );
    const otherSpace = (
      await api("user_b", "create_space", { name: "Another space" })
    ).body;
    await api("user_b", "share_memory", {
      id: bPrivate,
      spaceId: otherSpace.id,
      enabled: true,
      userRequested: true,
      idempotencyKey: "other-space-share",
    });
    assert.equal(
      (await api("user_a", "space_memories", { spaceId: otherSpace.id }))
        .status,
      403,
    );
    assert.equal(
      (await api("user_b", "space_memories", { spaceId: space.id })).body
        .memories.length,
      2,
      "A member's memory shared elsewhere does not enter this space",
    );
    assert.equal(
      (
        await api("user_b", "revise_memory", {
          id,
          expectedRevision: 1,
          memory: { ...i, idempotencyKey: "foreign-shared-edit" },
        })
      ).status,
      403,
    );
    await api("user_a", "share_memory", {
      id,
      spaceId: space.id,
      enabled: false,
      userRequested: true,
      idempotencyKey: "explicit-retraction",
    });
    assert.deepEqual(
      (
        await api("user_b", "space_memories", { spaceId: space.id })
      ).body.memories.map((m: any) => m.id),
      [bShared],
    );
    await api("user_a", "revoke_member", {
      spaceId: space.id,
      userId: "user_b",
    });
    assert.equal(
      (await api("user_b", "space_memories", { spaceId: space.id })).status,
      403,
    );
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
    // Legacy plain-save clients receive structured claims through both protocols and dashboard.
    for (const version of ["2026-07-28", "2025-11-25"]) {
      const automatic = await rpc(
        "user_a",
        "tools/call",
        {
          name: "remember",
          arguments: {
            ...i,
            text: "Nadia works at Acme.",
            evidence: "Nadia works at Acme.",
            entities: [],
            idempotencyKey: "automatic-protocol-" + version,
          },
        },
        version,
      );
      assert.equal(
        automatic.body.result.structuredContent.ontology.status,
        "structured",
      );
      assert.equal(
        automatic.body.result.structuredContent.ontology.claimIds.length,
        1,
      );
    }
    const automaticDashboard = await api("user_a", "remember", {
      ...i,
      text: "Nadia works at Acme.",
      evidence: "Nadia works at Acme.",
      entities: [],
      idempotencyKey: "automatic-dashboard-01",
    });
    assert.equal(automaticDashboard.body.ontology.status, "structured");
    assert.equal(automaticDashboard.body.ontology.claimIds.length, 1);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await store.graph.delete();
    await store.close();
  }
});
