import express from "express";
import { createClerkClient } from "@clerk/express";
import { verifyToken } from "@clerk/backend";
import { z } from "zod";
import { DomainError, MemoryStore, type Actor } from "./memory.js";
import { runTool, type Tool } from "./tools.js";
import { ontology } from "./ontology.js";
import { PredicateRegistry } from "./predicates.js";
import { KnowledgeStore } from "./knowledge.js";
export function dashboardApi(
  config: { secretKey: string; publishableKey: string; publicUrl: string },
  store: MemoryStore,
  tools: Tool[],
  authenticate?: (req: express.Request) => Promise<Actor | undefined>,
) {
  const api = express.Router();
  const predicates = new PredicateRegistry(store);
  const knowledge = new KnowledgeStore(store);
  // Relationship review changes the shared ontology, so it is limited to configured reviewers.
  const reviewers = new Set(
    (process.env.ONTOLOGY_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  const canReview = (actor: Actor) =>
    !!actor.email && reviewers.has(actor.email.toLowerCase());
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
  api.get("/ontology", async (_req, res) => {
    const actor = res.locals.actor as Actor;
    const [custom, usage] = await Promise.all([
      predicates.all(),
      predicates.usage(),
    ]);
    res.json({
      ...ontology,
      custom: custom.map((p) => ({
        ...p,
        claims: usage.find((u) => u.id === p.id)?.claims ?? 0,
        authors: usage.find((u) => u.id === p.id)?.authors ?? 0,
      })),
      canReview: canReview(actor),
    });
  });
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
      ontologyStatus: await store.ontologyStatus(
        actor,
        memories.memories.map((m) => m.id),
      ),
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
        // A new member's name may now resolve existing mentions in this space.
        await knowledge
          .relinkSpace((result as { id: string }).id)
          .catch(() => undefined);
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
        await knowledge.relinkSpace(i.spaceId).catch(() => undefined);
        break;
      }
      case "retry_ontology": {
        const i = z.object({ id: z.string().min(1) }).parse(input);
        result = await store.retryOntology(actor, i.id);
        break;
      }
      case "review_predicate": {
        if (!canReview(actor))
          throw new DomainError(403, "Only ontology reviewers can do this");
        const i = z
          .object({
            id: z.string().min(1),
            action: z.enum(["approve", "reject", "merge"]),
            into: z.string().min(1).optional(),
          })
          .parse(input);
        result = await predicates.review(i);
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
