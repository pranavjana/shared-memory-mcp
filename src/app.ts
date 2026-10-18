import express from "express";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { MemoryStore, DomainError, type Actor } from "./memory.js";
import { memoryTools, operatingInstructions, runTool } from "./tools.js";
import { dashboardApi } from "./api.js";
import {
  agentHosts,
  hostSkillInstructions,
  mcpInstallPrompt,
  type AgentHost,
} from "./onboarding.js";
import { ontology } from "./ontology.js";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createClerkClient } from "@clerk/express";
import { verifyWebhook } from "@clerk/express/webhooks";
import {
  fetchClerkAuthorizationServerMetadata,
  generateClerkProtectedResourceMetadata,
} from "@clerk/mcp-tools/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  audienceMismatchMessage,
  createClerkVerifier,
  mcpResourceFromPublicUrl,
  requiredScopes,
  type TokenVerifier,
} from "./auth.js";
import { fromClerkUser, fromClerkWebhook } from "./clerk-users.js";
import type { UserStore } from "./users.js";
import type { AutomaticOntology } from "./ontology-extraction.js";

export interface Config {
  publicUrl: string;
  publishableKey: string;
  secretKey: string;
  accountPortalUrl: string;
  webhookSigningSecret?: string;
}
export interface Profile {
  id: string;
  name: string | null;
  email: string | null;
}
interface Dependencies {
  verifyToken?: TokenVerifier;
  getProfile?: (userId: string) => Promise<Profile>;
  users?: UserStore;
  memory?: MemoryStore;
  automaticOntology?: AutomaticOntology;
  dashboardAuthenticate?: (req: express.Request) => Promise<Actor | undefined>;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function createApp(config: Config, dependencies: Dependencies = {}) {
  const app = express();
  const origin = new URL(config.publicUrl).origin;
  const resource = mcpResourceFromPublicUrl(config.publicUrl);
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource/mcp`;
  const clerk = createClerkClient({
    secretKey: config.secretKey,
    publishableKey: config.publishableKey,
  });
  const verifyToken =
    dependencies.verifyToken ??
    createClerkVerifier(config.secretKey, config.publishableKey, resource);
  const getProfile =
    dependencies.getProfile ??
    (async (userId: string) => {
      const user = await clerk.users.getUser(userId);
      await dependencies.users?.upsert(fromClerkUser(user));
      return {
        id: user.id,
        name: user.fullName,
        email: user.primaryEmailAddress?.emailAddress ?? null,
      };
    });

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          scriptSrc: [
            "'self'",
            "https://*.clerk.accounts.dev",
            "https://*.clerk.com",
          ],
          connectSrc: [
            "'self'",
            "https://*.clerk.accounts.dev",
            "https://*.clerk.com",
            "https://clerk-telemetry.com",
          ],
          frameSrc: [
            "'self'",
            "https://*.clerk.accounts.dev",
            "https://*.accounts.dev",
            "https://*.clerk.com",
          ],
          imgSrc: ["'self'", "data:", "https://img.clerk.com"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );
  app.use(
    cors({ exposedHeaders: ["WWW-Authenticate", "MCP-Protocol-Version"] }),
  );
  app.get("/health", async (_req, res) => {
    try {
      await dependencies.users?.health();
      await dependencies.memory?.query("RETURN 1 AS ok", {}, true);
      res.json({
        status: "ok",
        service: "shared-memory-mcp",
        version: "0.2.0",
        memory: Boolean(dependencies.memory),
        ontologyVersion: dependencies.memory ? ontology.version : null,
        database: dependencies.users ? "connected" : "not_configured",
      });
    } catch {
      res.status(503).json({ status: "unavailable", database: "unavailable" });
    }
  });
  app.post(
    "/webhooks/clerk",
    express.raw({ type: "application/json", limit: "256kb" }),
    async (req, res) => {
      if (!config.webhookSigningSecret || !dependencies.users) {
        res.status(503).json({ error: "sync_not_configured" });
        return;
      }
      let event;
      try {
        event = await verifyWebhook(req, {
          signingSecret: config.webhookSigningSecret,
        });
      } catch {
        res.status(400).json({ error: "invalid_webhook_signature" });
        return;
      }
      try {
        if (event.type === "user.created" || event.type === "user.updated") {
          await dependencies.users.upsert(fromClerkWebhook(event.data));
        } else if (event.type === "user.deleted") {
          if (!event.data.id) {
            res.status(400).json({ error: "missing_user_id" });
            return;
          }
          await dependencies.users.markDeleted(event.data.id);
          await dependencies.memory?.eraseUser(event.data.id);
        }
        res.json({ received: true });
      } catch {
        res.status(503).json({ error: "user_sync_failed" });
      }
    },
  );
  const skillPath = resolve("skills/shared-memory/SKILL.md");
  const skill = existsSync(skillPath)
    ? readFileSync(skillPath, "utf8")
    : operatingInstructions;
  const tools = dependencies.memory
    ? memoryTools(dependencies.memory, skill, dependencies.automaticOntology)
    : [];
  app.get("/api/config", (_req, res) =>
    res.json({
      publishableKey: config.publishableKey,
      mcpUrl: resource,
      accountPortalUrl: config.accountPortalUrl,
    }),
  );
  app.get("/skill", (_req, res) => res.type("text/plain").send(skill));
  app.get("/setup/prompt", (_req, res) =>
    res.type("text/plain").send(mcpInstallPrompt(resource)),
  );
  app.get("/skill/SKILL.md", (_req, res) =>
    res.attachment("SKILL.md").type("text/plain").send(skill),
  );
  app.get("/skill/:host", (req, res) => {
    const host = req.params.host as AgentHost;
    if (!agentHosts.includes(host)) {
      res.status(404).type("text/plain").send("Unknown agent");
      return;
    }
    const text = hostSkillInstructions(host);
    if (!text) {
      res.status(404).type("text/plain").send("Skill not found");
      return;
    }
    res.type("text/plain").send(text);
  });
  if (dependencies.memory)
    app.use(
      "/api",
      rateLimit({
        windowMs: 60000,
        limit: 120,
        standardHeaders: "draft-8",
        legacyHeaders: false,
      }),
      dashboardApi(
        config,
        dependencies.memory,
        tools,
        dependencies.dashboardAuthenticate,
      ),
    );
  app.get("/privacy", (_req, res) =>
    res
      .type("text")
      .send(
        "Clerk manages authentication. Shared Memory stores your basic profile and memories you or connected assistants submit, including source excerpts, typed entities, revisions and times. Private memories are accessible only to their owner and authorized connected clients. Selected memories may be shared in explicitly authorized spaces. Revocation stops future reads, but cannot recall content already received by another assistant. Forgetting removes memory text, evidence and revision content; minimal IDs and sharing metadata remain. Hosting providers may retain operational metadata. Configured model providers process submitted source excerpts and limited matching entity context to structure memories, and generate retrieval embeddings. The service does not automatically receive entire chats. Agent-supplied observations are not independently verified.",
      ),
  );
  app.use(express.static(resolve("public")));
  for (const path of ["/", "/dashboard", "/sign-in", "/sign-up"])
    app.get(path, (_req, res) => {
      const file = resolve("public/index.html");
      if (existsSync(file)) res.sendFile(file);
      else
        res
          .type("html")
          .send(
            "<h1>Shared Memory</h1><p>Dashboard build pending. MCP endpoint: /mcp</p>",
          );
    });

  const metadata = generateClerkProtectedResourceMetadata({
    publishableKey: config.publishableKey,
    resourceUrl: resource,
    properties: {
      scopes_supported: ["openid", ...requiredScopes, "offline_access"],
      resource_name: "Shared Memory MCP",
      bearer_methods_supported: ["header"],
    },
  });
  // Publish only the discovery fields used by this resource (no guessed endpoints).
  for (const path of [
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource",
  ]) {
    app.get(path, (_req, res) =>
      res.json({
        resource,
        authorization_servers: metadata.authorization_servers,
        scopes_supported: metadata.scopes_supported,
        resource_name: "Shared Memory MCP",
        bearer_methods_supported: ["header"],
      }),
    );
  }
  app.get(
    "/.well-known/oauth-authorization-server",
    async (_req, res, next) => {
      try {
        res.json(
          await fetchClerkAuthorizationServerMetadata({
            publishableKey: config.publishableKey,
          }),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  app.use(
    "/mcp",
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use("/mcp", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const match = /^Bearer ([^\s]+)$/i.exec(req.get("authorization") ?? "");
    const quoteParam = (value: string) =>
      `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const unauthorized = (opts?: {
      error?: string;
      description?: string;
      message?: string;
    }) => {
      const error = opts?.error;
      const description = opts?.description;
      let www = `Bearer resource_metadata=${quoteParam(metadataUrl)}, scope=${quoteParam(requiredScopes.join(" "))}`;
      if (error) www += `, error=${quoteParam(error)}`;
      if (description) www += `, error_description=${quoteParam(description)}`;
      res.status(401).set("WWW-Authenticate", www).json({
        error: error ?? "unauthorized",
        message:
          opts?.message ??
          description ??
          "Connect your account using OAuth.",
        ...(description ? { detail: description } : {}),
      });
    };
    if (!match) {
      unauthorized();
      return;
    }
    try {
      const result = await verifyToken(match[1]);
      if (!result.ok) {
        if (result.code === "audience_mismatch") {
          unauthorized({
            error: "invalid_token",
            description: result.message,
            message: result.message,
          });
          return;
        }
        unauthorized({ error: "invalid_token" });
        return;
      }
      const auth = result.auth;
      if (auth.resource?.href !== resource) {
        const detail = audienceMismatchMessage(resource);
        unauthorized({
          error: "invalid_token",
          description: detail,
          message: detail,
        });
        return;
      }
      if (
        !auth.extra?.userId ||
        !requiredScopes.every((scope) => auth.scopes.includes(scope)) ||
        !auth.expiresAt ||
        auth.expiresAt <= Date.now() / 1000
      ) {
        unauthorized({ error: "invalid_token" });
        return;
      }
      res.locals.authInfo = auth;
      next();
    } catch {
      unauthorized({ error: "invalid_token" });
    }
  });
  app.post("/mcp", express.json({ limit: "64kb" }), async (req, res, next) => {
    const auth = res.locals.authInfo as AuthInfo;
    const actor: Actor = {
      userId: auth.extra!.userId as string,
      clientId: auth.clientId,
      token: auth.token,
      expiresAt: auth.expiresAt,
    };
    if (
      dependencies.memory &&
      !(await dependencies.memory.authorizeClient(actor))
    ) {
      res.status(403).json({
        error:
          "This agent connection was revoked. Re-enable it in your dashboard.",
      });
      return;
    }
    if (
      req.body?.method === "server/discover" ||
      req.get("MCP-Protocol-Version") === "2026-07-28"
    ) {
      const { id, method, params = {} } = req.body ?? {};
      if (
        req.body?.jsonrpc !== "2.0" ||
        !["string", "number"].includes(typeof id)
      ) {
        res.status(400).json({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid request" },
        });
        return;
      }
      try {
        let result: unknown;
        if (method === "server/discover")
          result = {
            resultType: "complete",
            supportedVersions: ["2026-07-28"],
            serverInfo: { name: "shared-memory-mcp", version: "0.2.0" },
            instructions: operatingInstructions,
            capabilities: { tools: {} },
            ttlMs: 0,
            cacheScope: "private",
          };
        else if (method === "tools/list")
          result = {
            resultType: "complete",
            tools: [
              {
                name: "get_connection_status",
                description:
                  "Verify authorized identity, this assistant's client ID (the sourceClient it writes), and current memory capabilities",
                inputSchema: { type: "object", properties: {} },
              },
              ...tools.map((t) => ({
                name: t.name,
                title: t.title,
                description: t.description,
                inputSchema: z.toJSONSchema(t.schema),
                annotations: {
                  readOnlyHint: t.readOnly,
                  destructiveHint: !!t.destructive,
                },
              })),
            ],
            ttlMs: 0,
            cacheScope: "private",
          };
        else if (method === "tools/call") {
          const profile = await getProfile(actor.userId);
          actor.name = profile.name;
          const data =
            params.name === "get_connection_status"
              ? {
                  connected: true,
                  user: profile,
                  client: { id: actor.clientId },
                  capabilities: {
                    authentication: true,
                    userManagement: !!dependencies.users,
                    memory: !!dependencies.memory,
                  },
                }
              : await runTool(tools, actor, params.name, params.arguments);
          result = {
            resultType: "complete",
            content: [{ type: "text", text: JSON.stringify(data) }],
            structuredContent: data,
          };
        } else {
          res.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: "Method not found" },
          });
          return;
        }
        res.json({ jsonrpc: "2.0", id, result });
      } catch (error) {
        res.json({
          jsonrpc: "2.0",
          id,
          error: {
            code:
              error instanceof DomainError && error.status === 422
                ? -32015
                : error instanceof z.ZodError
                  ? -32602
                  : -32000,
            message:
              error instanceof DomainError
                ? error.message
                : error instanceof z.ZodError
                  ? "Invalid parameters"
                  : "Operation failed",
          },
        });
      }
      return;
    }
    // Each HTTP request gets its own server and transport, with no shared user state.
    const server = new McpServer(
      { name: "shared-memory-mcp", version: "0.2.0" },
      { instructions: operatingInstructions },
    );
    server.registerTool(
      "get_connection_status",
      {
        title: "Check Shared Memory connection",
        description:
          "Verify the Shared Memory MCP connection and return the profile of the user who authorized it, plus this assistant's client ID (the sourceClient it writes). Personal memory is available when configured.",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: {
          securitySchemes: [{ type: "oauth2", scopes: requiredScopes }],
        },
      },
      async () => {
        const user = await getProfile(auth.extra!.userId as string);
        const result = {
          connected: true,
          user,
          client: { id: auth.clientId },
          capabilities: {
            authentication: true,
            userManagement: Boolean(dependencies.users),
            memory: Boolean(dependencies.memory),
          },
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      },
    );
    for (const tool of tools)
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.schema.shape,
          annotations: {
            readOnlyHint: tool.readOnly,
            destructiveHint: !!tool.destructive,
            idempotentHint: !tool.destructive,
            openWorldHint: tool.name === "share_memory",
          },
          _meta: {
            securitySchemes: [{ type: "oauth2", scopes: requiredScopes }],
          },
        },
        async (input: Record<string, unknown>) => {
          try {
            const profile = await getProfile(actor.userId);
            actor.name = profile.name;
            const data = await runTool(tools, actor, tool.name, input);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(data) }],
              structuredContent: data as Record<string, unknown>,
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text:
                    error instanceof DomainError
                      ? error.message
                      : error instanceof z.ZodError
                        ? "Invalid memory parameters"
                        : "Memory operation failed",
                },
              ],
            };
          }
        },
      );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      next(error);
    }
  });
  app.all("/mcp", (_req, res) =>
    res
      .status(405)
      .set("Allow", "POST, OPTIONS")
      .json({ error: "method_not_allowed" }),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) return;
      if (error instanceof DomainError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid input",
          details: error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        });
        return;
      }
      const status =
        typeof error === "object" &&
        error &&
        "status" in error &&
        typeof error.status === "number"
          ? error.status
          : 500;
      res
        .status(status)
        .json({ error: status === 500 ? "internal_error" : "invalid_request" });
    },
  );
  return app;
}
