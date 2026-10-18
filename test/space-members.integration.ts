import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectMemoryStore, type Actor } from "../src/memory.js";
import { KnowledgeStore, memberFor } from "../src/knowledge.js";
import {
  AutomaticOntology,
  type OntologyExtractor,
} from "../src/ontology-extraction.js";
import { memoryTools, runTool } from "../src/tools.js";

const pranav: Actor = {
  userId: "member_pranav",
  name: "Pranav Janakiraman",
  clientId: "dot",
  email: "pranav@example.com",
};
const afshal: Actor = {
  userId: "member_afshal",
  name: "Afshal Gulam",
  clientId: "muse",
  email: "afshal@example.com",
};
const other: Actor = {
  userId: "member_pranav_k",
  name: "Pranav Kumar",
  clientId: "grok",
  email: "pk@example.com",
};
const connect = () =>
  connectMemoryStore({
    FALKORDB_HOST: "127.0.0.1",
    FALKORDB_PORT: "16379",
    FALKORDB_PASSWORD: "local-verification",
    FALKORDB_MEMORY_GRAPH:
      "space_members_verification_" + randomUUID().replaceAll("-", ""),
  });

test("member matching is unambiguous or nothing", () => {
  const members = [
    { id: "a", name: "Pranav Janakiraman" },
    { id: "b", name: "Afshal Gulam" },
  ];
  const by = { authorId: "b", authorName: "Afshal Gulam" };
  const find = (name: string, key = "k", type = "person") =>
    memberFor({ type, key, name }, by, members)?.id;
  assert.equal(find("Pranav"), "a");
  assert.equal(find("pranav  janakiraman"), "a");
  assert.equal(find("Afshal"), "b");
  assert.equal(find("anything", "auto:self"), "b");
  assert.equal(find("Zen"), undefined);
  assert.equal(find("Pranav", "k", "topic"), undefined);
  assert.equal(
    memberFor({ type: "person", key: "k", name: "Pranav" }, by, [
      ...members,
      { id: "c", name: "Pranav Kumar" },
    ]),
    undefined,
  );
});

test("people mentioned in a space resolve to one node per member", async () => {
  const s = await connect();
  const k = new KnowledgeStore(s);
  try {
    const space = await s.createSpace(pranav, "Members test");
    for (const a of [afshal, other])
      await s.accept(
        a,
        (await s.invite(pranav, space.id, a.email!, "contributor")).token,
      );
    await s.revoke(pranav, space.id, other.userId);
    const publish = async (
      actor: Actor,
      key: string,
      text: string,
      entities: any[],
      claim: any,
    ) => {
      const m = (
        await s.remember(actor, {
          text,
          evidence: text,
          basis: "user_statement",
          kind: "fact",
          entities: [],
          idempotencyKey: key,
        })
      ).memory;
      const r = await k.record(actor, {
        sourceMemoryId: m.id,
        sourceRevision: 1,
        idempotencyKey: key + "-claims",
        entities,
        claims: [{ basis: "explicit", evidence: text, ...claim }],
      });
      await k.publish(actor, {
        claimId: r.claimIds[0],
        spaceId: space.id,
        userRequested: true,
        idempotencyKey: key + "-publish",
      });
    };
    // Afshal mentions "Pranav"; Pranav records himself by full name.
    await publish(
      afshal,
      "members-tamil-01",
      "Pranav can't speak Tamil.",
      [
        { key: "p", type: "person", name: "Pranav" },
        { key: "t", type: "topic", name: "Tamil" },
      ],
      { subject: "p", predicate: "HAS_SKILL", object: "t", negated: true },
    );
    await publish(
      pranav,
      "members-joke-01",
      "Pranav Janakiraman joked about Afshal.",
      [
        { key: "me", type: "person", name: "Pranav Janakiraman" },
        { key: "a", type: "person", name: "Afshal" },
      ],
      { subject: "me", predicate: "ABOUT", object: "a" },
    );
    await publish(
      pranav,
      "members-zen-01",
      "Zen sucks at football.",
      [
        { key: "z", type: "person", name: "Zen" },
        { key: "f", type: "topic", name: "football" },
      ],
      { subject: "z", predicate: "HAS_SKILL", object: "f", negated: true },
    );
    const view = async () =>
      (await k.recall(afshal, { spaceId: space.id, limit: 20 })).claims;
    const people = (claims: any[]) =>
      [
        ...new Map(
          claims
            .flatMap((c: any) => [c.subject, c.object])
            .filter((e: any) => e?.type === "person")
            .map((e: any) => [
              e.id,
              `${e.name}${e.memberId ? " (member)" : ""}`,
            ]),
        ).values(),
      ].sort();
    assert.deepEqual(people(await view()), [
      "Afshal Gulam (member)",
      "Pranav Janakiraman (member)",
      "Zen",
    ]);
    // One node: filtering by it returns what both authors said about Pranav.
    const node = (await view()).find(
      (c: any) => c.subject.memberId === pranav.userId,
    )!.subject.id;
    const about = await k.recall(afshal, {
      spaceId: space.id,
      entityId: node,
      limit: 20,
    });
    assert.deepEqual(
      [...new Set(about.claims.map((c: any) => c.authorName))].sort(),
      ["Afshal Gulam", "Pranav Janakiraman"],
    );
    // A second member named Pranav makes Afshal's mention ambiguous; the author's
    // own name still resolves to the author.
    await s.accept(
      other,
      (await s.invite(pranav, space.id, other.email!, "contributor")).token,
    );
    assert.equal((await k.relinkSpace(space.id)).relinked, 1);
    assert.deepEqual(people(await view()), [
      "Afshal Gulam (member)",
      "Pranav",
      "Pranav Janakiraman (member)",
      "Zen",
    ]);
    // Removing them links it again; nothing else about the snapshot changes.
    await s.revoke(pranav, space.id, other.userId);
    await k.relinkSpace(space.id);
    const after = await view();
    assert.deepEqual(people(after), [
      "Afshal Gulam (member)",
      "Pranav Janakiraman (member)",
      "Zen",
    ]);
    const tamil = after.find((c: any) => c.object?.name === "Tamil")!;
    assert.equal(tamil.negated, true);
    assert.equal(tamil.authorName, "Afshal Gulam");
    assert.equal(tamil.evidence, "Pranav can't speak Tamil.");
    assert.deepEqual(tamil.subject.aliases, ["Pranav"]);
    // Private graphs are untouched: Afshal's own claim keeps her own entity.
    const own = await k.recall(afshal, { personalOnly: true, limit: 5 });
    assert.equal(own.claims[0].subject.name, "Pranav");
    assert.equal(own.claims[0].subject.memberId, undefined);
  } finally {
    await s.graph.delete();
    await s.close();
  }
});

test("extraction treats the author's own name as the author", async () => {
  const s = await connect();
  const extractor: OntologyExtractor = {
    async extract(context) {
      return {
        entities: [
          {
            key: "self",
            type: "person",
            name: "I",
            existingKey: null,
            identityEvidence: null,
          },
          {
            key: "me",
            type: "person",
            name: "Pranav Janakiraman",
            existingKey: null,
            identityEvidence: null,
          },
          {
            key: "t",
            type: "topic",
            name: "Hindi",
            existingKey: null,
            identityEvidence: null,
          },
          {
            key: "a",
            type: "person",
            name: "Afshal",
            existingKey: null,
            identityEvidence: null,
          },
        ],
        claims: [
          {
            subject: "me",
            predicate: "HAS_SKILL",
            object: "t",
            value: null,
            evidence: context.source.text,
            validFrom: null,
            validUntil: null,
            negated: false,
          },
          {
            subject: "self",
            predicate: "KNOWS",
            object: "a",
            value: null,
            evidence: context.source.text,
            validFrom: null,
            validUntil: null,
            negated: false,
          },
        ],
      };
    },
  };
  const auto = new AutomaticOntology(s, new KnowledgeStore(s), extractor);
  const tools = memoryTools(s, "", auto);
  try {
    const r: any = await runTool(tools, pranav, "remember", {
      text: "Pranav Janakiraman speaks Hindi and I know Afshal.",
      evidence: "Pranav Janakiraman speaks Hindi and I know Afshal.",
      basis: "user_statement",
      kind: "fact",
      entities: [],
      idempotencyKey: "members-self-01",
    });
    assert.equal(r.ontology.status, "structured");
    const claims = (
      await new KnowledgeStore(s).recall(pranav, {
        personalOnly: true,
        limit: 5,
      })
    ).claims;
    const subjects = new Set(claims.map((c: any) => c.subject.id));
    assert.equal(
      subjects.size,
      1,
      "self and the author's own name are one node",
    );
  } finally {
    await s.graph.delete();
    await s.close();
  }
});
