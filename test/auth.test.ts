import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import {
  audienceMismatchMessage,
  mcpResourceFromPublicUrl,
  tokenAudienceMatches,
  type TokenVerifyResult,
} from "../src/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

test("mcp resource URL is origin-stable and trailing-slash safe", () => {
  assert.equal(
    mcpResourceFromPublicUrl("https://memory.example.com"),
    "https://memory.example.com/mcp",
  );
  assert.equal(
    mcpResourceFromPublicUrl("https://memory.example.com/"),
    "https://memory.example.com/mcp",
  );
  assert.equal(
    mcpResourceFromPublicUrl("https://memory.example.com/dashboard"),
    "https://memory.example.com/mcp",
  );
});

test("token audience must include the MCP resource", () => {
  const resource = "https://memory.example.com/mcp";
  assert.equal(tokenAudienceMatches([resource], resource), true);
  assert.equal(
    tokenAudienceMatches(["https://other.example/mcp"], resource),
    false,
  );
  assert.equal(tokenAudienceMatches([], resource), false);
  assert.equal(tokenAudienceMatches(undefined, resource), false);
});

const origin = "https://memory.example.com";
const mcpResource = `${origin}/mcp`;
const config = {
  publicUrl: origin,
  publishableKey: `pk_test_${Buffer.from("test.clerk.accounts.dev$").toString("base64")}`,
  secretKey: "sk_test_unit_test_only",
  accountPortalUrl: "https://test.accounts.dev",
};
const identity = (id: string): AuthInfo => ({
  token: `token-${id}`,
  clientId: "chatgpt-test",
  scopes: ["profile", "email"],
  expiresAt: Math.floor(Date.now() / 1000) + 300,
  resource: new URL(mcpResource),
  extra: { userId: id },
});

const ok = (auth: AuthInfo): TokenVerifyResult => ({ ok: true, auth });
const audienceDetail = audienceMismatchMessage(mcpResource);

test("OAuth discovery, access checks, and concurrent users stay isolated", async () => {
  const app = createApp(config, {
    verifyToken: async (token) => {
      if (token === "valid-a") return ok(identity("user_a"));
      if (token === "valid-b") return ok(identity("user_b"));
      if (token === "wrong-audience")
        return {
          ok: false,
          code: "audience_mismatch",
          message: audienceDetail,
        };
      if (token === "wrong-audience-authinfo")
        return ok({
          ...identity("user_a"),
          resource: new URL("https://other.example/mcp"),
        });
      if (token === "missing-scopes")
        return { ok: false, code: "invalid_token", message: "invalid_token" };
      if (token === "expired")
        return { ok: false, code: "invalid_token", message: "invalid_token" };
      return { ok: false, code: "invalid_token", message: "invalid_token" };
    },
    getProfile: async (id) => ({
      id,
      name: `Name ${id}`,
      email: `${id}@example.com`,
    }),
  });
  const http = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  try {
    const metadata = await fetch(
      `${base}/.well-known/oauth-protected-resource/mcp`,
      { headers: { Host: "attacker.example" } },
    );
    const body = await metadata.json();
    assert.equal(body.resource, mcpResource);
    assert.deepEqual(body.authorization_servers, [
      "https://test.clerk.accounts.dev",
    ]);
    assert.deepEqual(body.scopes_supported, [
      "openid",
      "profile",
      "email",
      "offline_access",
    ]);
    assert.deepEqual(body.bearer_methods_supported, ["header"]);
    assert.equal(body.resource_name, "Shared Memory MCP");
    assert.equal(metadata.headers.get("access-control-allow-origin"), "*");
    const prompt = await fetch(`${base}/setup/prompt`, {
      headers: { Host: "attacker.example" },
    });
    assert.equal(prompt.status, 200);
    const instructions = await prompt.text();
    assert.ok(instructions.includes(`resource=${mcpResource}`));
    assert.ok(instructions.includes("registration_endpoint"));
    assert.ok(instructions.includes("/oauth/register"));
    assert.ok(!instructions.includes("attacker.example"));
    assert.ok(!instructions.startsWith("---"));
    assert.ok(instructions.includes("get_connection_status"));
    assert.ok(instructions.includes("Do not install skills"));
    assert.ok(!instructions.includes("# Shared Memory operating guide"));

    for (const auth of [
      undefined,
      "Basic valid-a",
      "Bearer invalid",
      "Bearer missing-scopes",
      "Bearer expired",
    ]) {
      const response = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: auth ? { Authorization: auth } : {},
      });
      assert.equal(response.status, 401, `expected rejection for ${auth}`);
      assert.match(
        response.headers.get("www-authenticate")!,
        /https:\/\/memory.example.com\/\.well-known\/oauth-protected-resource\/mcp/,
      );
      assert.equal(response.headers.get("cache-control"), "no-store");
    }

    for (const token of ["wrong-audience", "wrong-audience-authinfo"]) {
      const response = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 401, `expected audience 401 for ${token}`);
      const www = response.headers.get("www-authenticate")!;
      assert.match(www, /error="invalid_token"/);
      assert.match(www, /error_description=/);
      assert.match(www, /audience mismatch/);
      assert.match(www, /resource=https:\/\/memory\.example\.com\/mcp/);
      const payload = await response.json();
      assert.equal(payload.error, "invalid_token");
      assert.equal(payload.message, audienceDetail);
      assert.equal(payload.detail, audienceDetail);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }

    async function rpc(
      token: string,
      method: string,
      params: unknown,
      id: number,
    ) {
      const response = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-11-25",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      assert.equal(response.status, 200);
      return response.json();
    }
    const initialized = await rpc(
      "valid-a",
      "initialize",
      {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
      1,
    );
    assert.equal(initialized.result.serverInfo.name, "shared-memory-mcp");
    const listed = await rpc("valid-a", "tools/list", {}, 2);
    assert.equal(listed.result.tools[0].name, "get_connection_status");
    assert.equal(listed.result.tools[0].annotations.readOnlyHint, true);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        rpc(
          i % 2 ? "valid-a" : "valid-b",
          "tools/call",
          { name: "get_connection_status", arguments: {} },
          i + 3,
        ),
      ),
    );
    for (const [i, result] of results.entries()) {
      assert.equal(
        result.result.structuredContent.user.id,
        i % 2 ? "user_a" : "user_b",
      );
      assert.equal(result.result.structuredContent.capabilities.memory, false);
    }
    const getResponse = await fetch(`${base}/mcp`, {
      headers: { Authorization: "Bearer valid-a" },
    });
    assert.equal(getResponse.status, 405);
  } finally {
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
