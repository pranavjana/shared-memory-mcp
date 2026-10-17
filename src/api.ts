import express from "express";
import { createClerkClient } from "@clerk/express";
import { verifyToken } from "@clerk/backend";
import { z } from "zod";
import { DomainError, MemoryStore, type Actor } from "./memory.js";
import { runTool, type Tool } from "./tools.js";
import type { DoorbellService } from "./doorbells.js";
import type { PulseService } from "./pulse.js";
import { ontology } from "./ontology.js";
export function dashboardApi(
  config: { secretKey: string; publishableKey: string; publicUrl: string },
  store: MemoryStore,
  tools: Tool[],
  authenticate?: (req: express.Request) => Promise<Actor | undefined>,
  doorbells?: DoorbellService,
  pulse?: PulseService,
) {
  const requireDoorbells = () => {
    if (!doorbells)
      throw new DomainError(503, "Doorbells are not configured on this server");
    return doorbells;
  };
  const api = express.Router();
  const clerk = createClerkClient({
    secretKey: config.secretKey,
    publishableKey: config.publishableKey,
  });
  api.use(async (req, res, next) => {
    try {
      let actor: Actor | undefined;
      if (authenticate) actor = await authenticate(req);
      else {
        const token = /^Bearer (\S+)$/i.exec(
          req.get("authorization") ?? "",
        )?.[1];
        if (!token) {
          res.status(401).json({ error: "Sign in to continue" });
          return;
        }
        const payload = await verifyToken(token, {
          secretKey: config.secretKey,
          authorizedParties: [new URL(config.publicUrl).origin],
        });
        if (!payload.sub || !payload.sid) throw new Error("Session required");
        const [session, user] = await Promise.all([
          clerk.sessions.getSession(String(payload.sid)),
          clerk.users.getUser(payload.sub),
        ]);
        if (session.status !== "active" || session.userId !== payload.sub)
          throw new Error("Session revoked");
        actor = {
          userId: user.id,
          clientId: "dashboard",
          name: user.fullName,
          email:
            user.primaryEmailAddress?.verification?.status === "verified"
              ? user.primaryEmailAddress.emailAddress
              : null,
        };
      }
      if (!actor) {
        res.status(401).json({ error: "Sign in to continue" });
        return;
      }
      res.locals.actor = actor;
      res.set("Cache-Control", "no-store");
      next();
    } catch {
      res.status(401).json({ error: "Session expired. Sign in again." });
    }
  });
  api.get("/ontology", (_req, res) => res.json(ontology));
  api.get("/overview", async (_req, res) => {
    const actor = res.locals.actor as Actor;
    const [memories, spaces, graph, connections, rules] = await Promise.all([
      store.recall(actor, "", 50),
      store.spaces(actor),
      store.graphView(actor),
      store.connections(actor),
      store.rules(actor),
    ]);
    res.json({
      actor: { id: actor.userId, name: actor.name },
      ...memories,
      spaces,
      graph,
      connections,
      rules,
    });
  });
  api.post("/action", express.json({ limit: "64kb" }), async (req, res) => {
    const actor = res.locals.actor as Actor;
    const { action, input = {} } = z
      .object({ action: z.string(), input: z.unknown().optional() })
      .parse(req.body);
    let result: unknown;
    switch (action) {
      case "create_space": {
        const i = z
          .object({ name: z.string().trim().min(1).max(100) })
          .parse(input);
        result = await store.createSpace(actor, i.name);
        break;
      }
      case "invite": {
        const i = z
          .object({
            spaceId: z.string(),
            email: z.string().email(),
            role: z.enum(["reader", "contributor"]),
          })
          .parse(input);
        const r = await store.invite(actor, i.spaceId, i.email, i.role);
        result = {
          ...r,
          url:
            config.publicUrl +
            "/dashboard?invite=" +
            encodeURIComponent(r.token),
        };
        break;
      }
      case "accept_invitation": {
        const i = z.object({ token: z.string().max(200) }).parse(input);
        result = await store.accept(actor, i.token);
        break;
      }
      case "members": {
        const i = z.object({ spaceId: z.string() }).parse(input);
        result = await store.members(actor, i.spaceId);
        break;
      }
      case "space_memories": {
        const i = z
          .object({
            spaceId: z.string().min(1),
            limit: z.number().int().min(1).max(100).default(30),
            cursor: z
              .object({
                updatedAt: z.number().int().nonnegative(),
                id: z.string().min(1),
              })
              .optional(),
          })
          .parse(input);
        result = await store.spaceMemories(actor, i.spaceId, i.limit, i.cursor);
        break;
      }
      case "revoke_member": {
        const i = z
          .object({ spaceId: z.string(), userId: z.string() })
          .parse(input);
        result = await store.revoke(actor, i.spaceId, i.userId);
        break;
      }
      case "add_sharing_rule": {
        const i = z
          .object({
            spaceId: z.string(),
            kind: z.enum([
              "fact",
              "preference",
              "event",
              "goal",
              "task",
              "decision",
              "relationship",
            ]),
            entityName: z.string().max(120).default(""),
          })
          .parse(input);
        result = await store.addRule(actor, i.spaceId, i.kind, i.entityName);
        break;
      }
      case "disable_sharing_rule": {
        const i = z.object({ id: z.string() }).parse(input);
        result = await store.disableRule(actor, i.id);
        break;
      }
      case "doorbells": {
        result = { doorbells: doorbells ? await doorbells.list(actor) : [] };
        break;
      }
      case "add_doorbell": {
        result = await requireDoorbells().add(actor, input);
        break;
      }
      case "remove_doorbell": {
        const i = z.object({ id: z.string().min(1).max(100) }).parse(input);
        result = await requireDoorbells().remove(actor, i.id);
        break;
      }
      case "test_doorbell": {
        const i = z.object({ id: z.string().min(1).max(100) }).parse(input);
        result = await requireDoorbells().test(actor, i.id);
        break;
      }
      case "pulse_links": {
        result = { links: pulse ? await pulse.list(actor) : [] };
        break;
      }
      case "revoke_pulse_link": {
        const i = z.object({ id: z.string().min(1).max(100) }).parse(input);
        if (!pulse) throw new DomainError(503, "Pulse links are unavailable");
        result = await pulse.revoke(actor, i.id);
        break;
      }
      case "set_connection": {
        const i = z
          .object({ id: z.string(), enabled: z.boolean() })
          .parse(input);
        result = await store.setConnection(actor, i.id, i.enabled);
        break;
      }
      default:
        result = await runTool(tools, actor, action, input);
    }
    res.json(result);
  });
  return api;
}
