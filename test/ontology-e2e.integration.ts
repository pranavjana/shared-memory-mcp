import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { connectMemoryStore } from "../src/memory.js";
import { AutomaticOntology } from "../src/ontology-extraction.js";

// Exercises the ontology features end to end over HTTP: MCP tool calls from two
// agents, the dashboard API, reviewer permissions and the background worker.
const entity = (key: string, type: string, name: string) => ({
  key,
  type,
  name,
  existingKey: null,
  identityEvidence: null,
});
const claim = (
  subject: string,
  predicate: string,
  object: string | null,
  evidence: string,
  negated = false,
) => ({
  subject,
  predicate,
  object,
  value: null,
  evidence,
  validFrom: null,
  validUntil: null,
  negated,
});
const speaks = {
  name: "SPEAKS",
  description: "A person can communicate in a language.",
  subjectTypes: ["person"],
  objectTypes: ["topic"],
  literal: false,
};
let jokeFits = false;
const model: Record<string, () => unknown> = {
  "Pranav can't speak Tamil.": () => ({
    entities: [
      entity("self", "person", "Pranav"),
      entity("t", "topic", "Tamil"),
    ],
    claims: [claim("self", "SPEAKS", "t", "Pranav can't speak Tamil.", true)],
    newPredicates: [speaks],
  }),
  "Roshan can speak French.": () => ({
    entities: [
      entity("self", "person", "Roshan"),
      entity("f", "topic", "French"),
    ],
    claims: [claim("self", "CAN_SPEAK", "f", "Roshan can speak French.")],
    newPredicates: [{ ...speaks, name: "can_speak" }],
  }),
  "Roshan is allergic to peanuts.": () => ({
    entities: [
      entity("self", "person", "Roshan"),
      entity("p", "item", "peanuts"),
    ],
    claims: [
      claim("self", "ALLERGIC_TO", "p", "Roshan is allergic to peanuts."),
    ],
    newPredicates: [
      {
        name: "ALLERGIC_TO",
        description: "A person has an allergy to an item.",
        subjectTypes: ["person"],
        objectTypes: ["item"],
        literal: false,
      },
    ],
  }),
  "Roshan hates olives.": () => ({
    entities: [
      entity("self", "person", "Roshan"),
      entity("o", "item", "olives"),
    ],
    claims: [claim("self", "HATES", "o", "Roshan hates olives.")],
    newPredicates: [
      {
        name: "HATES",
        description: "A strong dislike.",
        subjectTypes: ["person"],
        objectTypes: ["item"],
        literal: false,
      },
    ],
  }),
  "Pranav jokingly said Afshal is at the bottom of the food chain.": () =>
    jokeFits
      ? {
          entities: [
            entity("self", "person", "Pranav"),
            entity("a", "person", "Afshal"),
          ],
          claims: [
            claim(
              "self",
              "KNOWS",
              "a",
              "Pranav jokingly said Afshal is at the bottom of the food chain.",
            ),
          ],
        }
      : { entities: [], claims: [] },
};

test("provisional relationships, negation, review and ontology gaps work end to end over MCP and the dashboard", async () => {
  process.env.ONTOLOGY_ADMIN_EMAILS = "USER_A@example.com";
  const store = await connectMemoryStore({
    FALKORDB_HOST: "127.0.0.1",
    FALKORDB_PORT: "16379",
    FALKORDB_PASSWORD: "local-verification",
    FALKORDB_MEMORY_GRAPH: "ontology_e2e_" + randomUUID().replaceAll("-", ""),
  });
  const origin = "https://memory.example.com";
  const automaticOntology = new AutomaticOntology(store, undefined, {
    async extract(context) {
      return model[context.source.text]?.() ?? { entities: [], claims: [] };
    },
  });
  const users = ["user_a", "user_b"];
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
      automaticOntology,
      getProfile: async (id) => ({ id, name: id, email: id + "@example.com" }),
      verifyToken: async (token) =>
        users.includes(token)
          ? {
              ok: true as const,
              auth: {
                token,
                clientId: token === "user_a" ? "dot" : "muse",
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
      dashboardAuthenticate: async (req) => {
        const user = req.get("authorization") ?? "";
        return users.includes(user)
          ? {
              userId: user,
              clientId: "dashboard",
              name: user,
              email: user + "@example.com",
            }
          : undefined;
      },
    },
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const call = async (user: string, name: string, args: any = {}) => {
    const r = await fetch(base + "/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + user,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const body = await r.json();
    if (body.error) return { error: String(body.error.message), rpc: true };
    if (body.result?.isError)
      return { error: body.result.content[0].text as string };
    return body.result.structuredContent;
  };
  const dashboard = async (user: string, path: string, body?: unknown) => {
    const r = await fetch(base + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: user,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };
  const act = (user: string, action: string, input: unknown) =>
    dashboard(user, "action", { action, input });
  const save = (user: string, text: string, key: string) =>
    call(user, "remember", {
      text,
      evidence: text,
      basis: "user_statement",
      kind: "fact",
      entities: [],
      idempotencyKey: key,
    });
  const facts = (claims: any[]) =>
    claims
      .map(
        (c) =>
          (c.negated ? "not " : "") +
          c.subject.name +
          " " +
          c.predicate +
          " " +
          (c.object?.name ?? c.value),
      )
      .sort();
  try {
    // 1. An agent saves a negative fact no core relationship expresses.
    const tamil = await save(
      "user_a",
      "Pranav can't speak Tamil.",
      "e2e-tamil-0001",
    );
    assert.equal(tamil.ontology.status, "structured");
    const mine = await call("user_a", "recall_knowledge", { query: "Tamil" });
    assert.deepEqual(facts(mine.claims), ["not Pranav SPEAKS Tamil"]);
    assert.equal(mine.claims[0].negated, true);

    // 2. Another agent's proposal with the same meaning reuses it.
    const french = await save(
      "user_b",
      "Roshan can speak French.",
      "e2e-french-0001",
    );
    assert.equal(french.ontology.status, "structured");
    const ontology = await call("user_b", "get_ontology");
    assert.deepEqual(
      ontology.provisional.map((p: any) => p.id),
      ["SPEAKS"],
    );
    assert.deepEqual(
      facts(
        (await call("user_b", "recall_knowledge", { query: "French" })).claims,
      ),
      ["Roshan SPEAKS French"],
    );

    // 3. Agents can write a provisional relationship directly; unknown ones are refused.
    const allergy = await save(
      "user_b",
      "Roshan is allergic to peanuts.",
      "e2e-allergy-0001",
    );
    const direct = await call("user_b", "record_knowledge", {
      sourceMemoryId: allergy.memory.id,
      sourceRevision: 1,
      idempotencyKey: "e2e-direct-0001",
      entities: [
        { key: "me", type: "person", name: "Roshan" },
        { key: "lang", type: "topic", name: "Malay" },
      ],
      claims: [
        {
          subject: "me",
          predicate: "SPEAKS",
          object: "lang",
          basis: "explicit",
          evidence: "Roshan is allergic to peanuts.",
        },
      ],
    });
    assert.equal(direct.saved, true);
    const unknown = await call("user_b", "record_knowledge", {
      sourceMemoryId: allergy.memory.id,
      sourceRevision: 1,
      idempotencyKey: "e2e-direct-0002",
      entities: [
        { key: "me", type: "person", name: "Roshan" },
        { key: "x", type: "topic", name: "Mars" },
      ],
      claims: [
        {
          subject: "me",
          predicate: "FLIES_TO",
          object: "x",
          basis: "explicit",
          evidence: "Roshan is allergic to peanuts.",
        },
      ],
    });
    // The live registry refuses it as a schema violation, not a server failure.
    assert.deepEqual(unknown, { error: "Invalid parameters", rpc: true });

    // 4. Dashboard: everyone sees proposals with counts, only reviewers can decide.
    const roshanView = await dashboard("user_b", "ontology");
    assert.equal(roshanView.body.canReview, false);
    const row = roshanView.body.custom.find((p: any) => p.id === "SPEAKS");
    assert.deepEqual(
      [row.status, row.claims, row.authors],
      ["provisional", 3, 2],
    );
    assert.equal(
      (
        await act("user_b", "review_predicate", {
          id: "SPEAKS",
          action: "approve",
        })
      ).status,
      403,
    );
    assert.equal((await dashboard("user_a", "ontology")).body.canReview, true);
    assert.equal(
      (
        await act("user_a", "review_predicate", {
          id: "SPEAKS",
          action: "approve",
        })
      ).body.status,
      "approved",
    );

    // 5. Sharing a memory shows its claims to the space, negation included.
    const space = (await act("user_a", "create_space", { name: "E2E space" }))
      .body;
    const invite = await act("user_a", "invite", {
      spaceId: space.id,
      email: "user_b@example.com",
      role: "contributor",
    });
    assert.equal(
      (await act("user_b", "accept_invitation", { token: invite.body.token }))
        .status,
      200,
    );
    const shared = await call("user_a", "share_memory", {
      id: tamil.memory.id,
      spaceId: space.id,
      userRequested: true,
      idempotencyKey: "e2e-share-0001",
    });
    assert.deepEqual(shared.sharedClaims, { published: 1, retracted: 0 });
    const seen = await call("user_b", "recall_knowledge", {
      spaceId: space.id,
    });
    // In the space, the author's "self" is shown as that member (named user_a here).
    assert.deepEqual(facts(seen.claims), ["not user_a SPEAKS Tamil"]);
    assert.equal(seen.claims[0].subject.memberId, "user_a");

    // 6. A memory with no claims is flagged, and only its owner can retry it.
    const joke = await save(
      "user_a",
      "Pranav jokingly said Afshal is at the bottom of the food chain.",
      "e2e-joke-0001",
    );
    assert.equal(joke.ontology.status, "no_supported_claims");
    const overview = await dashboard("user_a", "overview");
    assert.equal(
      overview.body.ontologyStatus[joke.memory.id],
      "no_supported_claims",
    );
    assert.equal(overview.body.ontologyStatus[tamil.memory.id], "structured");
    assert.equal(
      (await act("user_b", "retry_ontology", { id: joke.memory.id })).status,
      409,
    );
    jokeFits = true;
    assert.equal(
      (await act("user_a", "retry_ontology", { id: joke.memory.id })).body
        .queued,
      true,
    );
    await automaticOntology.tick();
    assert.equal(
      (await dashboard("user_a", "overview")).body.ontologyStatus[
        joke.memory.id
      ],
      "structured",
    );

    // 7. Merge rewrites a provisional relationship into an existing one.
    await save("user_b", "Roshan hates olives.", "e2e-olives-0001");
    const merge = await act("user_a", "review_predicate", {
      id: "HATES",
      action: "merge",
      into: "DISLIKES",
    });
    assert.equal(merge.body.mergedInto, "DISLIKES");
    // Search also expands through the same Roshan node, so his other facts come along.
    const olives = facts(
      (await call("user_b", "recall_knowledge", { query: "olives" })).claims,
    );
    assert.ok(olives.includes("Roshan DISLIKES olives"));
    assert.ok(!olives.some((f) => f.includes("HATES")));

    // 8. Reject retires claims, and the same meaning cannot come back.
    await act("user_a", "review_predicate", {
      id: "ALLERGIC_TO",
      action: "reject",
    });
    assert.ok(
      !facts(
        (await call("user_b", "recall_knowledge", { query: "peanuts" })).claims,
      ).some((f) => f.includes("ALLERGIC_TO")),
    );
    const again = await save(
      "user_b",
      "Roshan is allergic to peanuts.",
      "e2e-allergy-0002",
    );
    assert.notEqual(again.ontology.status, "structured");
    const final = (await dashboard("user_b", "ontology")).body.custom;
    assert.deepEqual(
      final.map((p: any) => [p.id, p.status, p.mergedInto ?? null]),
      [
        ["SPEAKS", "approved", null],
        ["ALLERGIC_TO", "rejected", null],
        ["HATES", "merged", "DISLIKES"],
      ],
    );

    // 9. Retracting the share withdraws the claim from the space.
    await call("user_a", "share_memory", {
      id: tamil.memory.id,
      spaceId: space.id,
      enabled: false,
      userRequested: true,
      idempotencyKey: "e2e-share-0002",
    });
    assert.deepEqual(
      (await call("user_b", "recall_knowledge", { spaceId: space.id })).claims,
      [],
    );
  } finally {
    delete process.env.ONTOLOGY_ADMIN_EMAILS;
    server.close();
    await store.graph.delete();
    await store.close();
  }
});
