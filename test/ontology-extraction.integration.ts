import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectMemoryStore, type Actor } from "../src/memory.js";
import { KnowledgeStore } from "../src/knowledge.js";
import {
  AutomaticOntology,
  type OntologyExtractor,
} from "../src/ontology-extraction.js";
import { memoryTools, runTool } from "../src/tools.js";

const owner: Actor = {
  userId: "extraction_owner",
  clientId: "muse",
  name: "Owner",
};
const other: Actor = {
  userId: "extraction_other",
  clientId: "dot",
  name: "Other",
};
const input = (idempotencyKey: string, text = "Nadia works at Acme.") => ({
  text,
  evidence: text,
  basis: "user_statement",
  kind: "fact",
  entities: [],
  idempotencyKey,
});
const output = (evidence = "Nadia works at Acme.", company = "Acme") => ({
  entities: [
    {
      key: "nadia",
      type: "person",
      name: "Nadia",
      existingKey: null,
      identityEvidence: null,
    },
    {
      key: "company",
      type: "organization",
      name: company,
      existingKey: null,
      identityEvidence: null,
    },
  ],
  claims: [
    {
      subject: "nadia",
      predicate: "WORKS_AT",
      object: "company",
      value: null,
      evidence,
      validFrom: null,
      validUntil: null,
    },
  ],
});
const connect = () =>
  connectMemoryStore({
    FALKORDB_HOST: "127.0.0.1",
    FALKORDB_PORT: "16379",
    FALKORDB_PASSWORD: "local-verification",
    FALKORDB_MEMORY_GRAPH:
      "extraction_verification_" + randomUUID().replaceAll("-", ""),
  });

test("plain saves and revisions structure automatically, retries deduplicate, context stays author scoped", async () => {
  const s = await connect();
  const k = new KnowledgeStore(s);
  let calls = 0,
    contexts: any[] = [];
  const extractor: OntologyExtractor = {
    async extract(context) {
      calls++;
      contexts.push(context);
      return output(
        context.source.text,
        context.source.text.includes("Beta") ? "Beta" : "Acme",
      );
    },
  };
  const auto = new AutomaticOntology(s, k, extractor);
  const tools = memoryTools(s, "", auto);
  try {
    const result: any = await runTool(
      tools,
      owner,
      "remember",
      input("automatic-save-01"),
    );
    assert.equal(result.ontology.status, "structured");
    assert.equal(result.ontology.claimIds.length, 1);
    assert.equal(
      (await k.recall(owner, { personalOnly: true })).claims[0].predicate,
      "WORKS_AT",
    );
    const repeated: any = await runTool(
      tools,
      owner,
      "remember",
      input("automatic-save-01"),
    );
    assert.deepEqual(repeated.ontology.claimIds, result.ontology.claimIds);
    assert.equal(calls, 1);
    await assert.rejects(
      auto.process(other, result.memory.id),
      /Only the source author|not found/i,
    );
    await runTool(
      tools,
      other,
      "remember",
      input("other-save-01", "Nadia works at Secret Co."),
    );
    const revised: any = await runTool(tools, owner, "revise_memory", {
      id: result.memory.id,
      expectedRevision: 1,
      memory: input("automatic-revise-01", "Nadia works at Beta."),
    });
    assert.equal(revised.ontology.status, "structured");
    const claims = (await k.recall(owner, { personalOnly: true })).claims;
    assert.equal(claims.length, 1);
    assert.equal(claims[0].object?.name, "Beta");
    assert.equal(claims[0].sourceRevision, 2);
    assert.ok(!JSON.stringify(contexts.at(-1)).includes("Secret Co"));
    assert.deepEqual((await k.recall(other, { query: "Beta" })).claims, []);
    // A source save is never implicit publication into an existing space.
    assert.deepEqual(result.automaticShares, []);
    assert.equal(
      (await s.query<any>("MATCH (p:Publication) RETURN p.id AS id", {}, true))
        .length,
      0,
    );
    const queued = await s.remember(owner, input("queued-direct-save"));
    const restarted = new AutomaticOntology(s, k, extractor);
    await restarted.tick();
    assert.equal(
      (await restarted.process(owner, queued.memory.id)).status,
      "structured",
    );
    await s.forget(owner, result.memory.id);
    const [job] = await s.query<any>(
      "MATCH (j:OntologyJob {id:$id}) RETURN j.status AS status,j.plan AS plan",
      { id: result.memory.id + ":2" },
      true,
    );
    assert.equal(job.status, "forgotten");
    assert.equal(job.plan, null);
  } finally {
    await s.graph.delete();
    await s.close();
  }
});

test("failed extraction preserves source, retries after restart, rejects ungrounded evidence and stale writes", async () => {
  const s = await connect();
  const k = new KnowledgeStore(s);
  let mode = "fail",
    calls = 0;
  let release: (() => void) | undefined;
  const extractor: OntologyExtractor = {
    async extract(context) {
      calls++;
      if (mode === "fail") throw new Error("private provider response");
      if (mode === "wait")
        await new Promise<void>((r) => {
          release = r;
        });
      return mode === "bad"
        ? output("invented excerpt")
        : mode === "empty"
          ? { entities: [], claims: [] }
          : output(context.source.text);
    },
  };
  const auto = new AutomaticOntology(s, k, extractor);
  const tools = memoryTools(s, "", auto);
  try {
    const r: any = await runTool(
      tools,
      owner,
      "remember",
      input("failure-save-01"),
    );
    assert.equal(r.saved, true);
    assert.equal(r.ontology.status, "pending");
    assert.ok(!JSON.stringify(r).includes("private provider"));
    assert.equal(
      (await s.get(owner, r.memory.id)).text,
      "Nadia works at Acme.",
    );
    mode = "okay";
    await s.query("MATCH (j:OntologyJob) SET j.nextAt=0");
    await new AutomaticOntology(s, k, extractor).tick();
    assert.equal((await auto.process(owner, r.memory.id)).status, "structured");
    assert.equal(calls, 2);
    mode = "bad";
    const bad: any = await runTool(
      tools,
      owner,
      "remember",
      input("bad-evidence-save"),
    );
    assert.equal(bad.ontology.status, "pending");
    assert.equal(
      (
        await s.query<any>(
          "MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory {id:$id}) RETURN c.id AS id",
          { id: bad.memory.id },
          true,
        )
      ).length,
      0,
    );
    mode = "empty";
    const empty: any = await runTool(
      tools,
      owner,
      "remember",
      input("empty-extraction-save", "Nadia does not work at Acme."),
    );
    assert.equal(empty.ontology.status, "no_supported_claims");
    mode = "wait";
    const source = (await s.remember(owner, input("concurrent-save-01")))
      .memory;
    const work = auto.process(owner, source.id);
    while (!release) await new Promise((r) => setTimeout(r, 5));
    assert.equal((await auto.process(owner, source.id)).status, "pending");
    await s.forget(owner, source.id);
    release();
    assert.equal((await work).status, "superseded");
    assert.equal(
      (
        await s.query<any>(
          "MATCH (j:OntologyJob {id:$id}) RETURN j.plan AS plan",
          { id: source.id + ":1" },
          true,
        )
      )[0].plan,
      null,
    );
  } finally {
    await s.graph.delete();
    await s.close();
  }
});

test("identity reuse requires grounded author context and revised sources reject in-flight old extractions", async () => {
  const s = await connect();
  const k = new KnowledgeStore(s);
  let requestExisting: any;
  let release: (() => void) | undefined;
  let waiting = false;
  const auto = new AutomaticOntology(s, k, {
    async extract(context) {
      if (waiting)
        await new Promise<void>((r) => {
          release = r;
        });
      const result = output(
        context.source.text,
        context.source.text.includes("Beta") ? "Beta" : "Acme",
      );
      if (requestExisting) Object.assign(result.entities[0], requestExisting);
      return result;
    },
  });
  try {
    const first = (await s.remember(owner, input("identity-first-01"))).memory;
    await auto.process(owner, first.id);
    const person = (await k.recall(owner, { personalOnly: true })).claims[0]
      .subject;
    requestExisting = { existingKey: person.key, identityEvidence: "Nadia" };
    const ambiguous = (
      await s.remember(
        owner,
        input("identity-ambiguous", "Nadia works at Beta."),
      )
    ).memory;
    await auto.process(owner, ambiguous.id);
    const ambiguousClaim = (
      await s.query<any>(
        "MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory {id:$id}) RETURN c.payload AS payload",
        { id: ambiguous.id },
        true,
      )
    )[0];
    assert.notEqual(JSON.parse(ambiguousClaim.payload).subject.key, person.key);
    requestExisting = {
      existingKey: person.key,
      identityEvidence: "Nadia works at Acme.",
    };
    const clear = (await s.remember(owner, input("identity-with-context")))
      .memory;
    await auto.process(owner, clear.id);
    const clearClaim = (
      await s.query<any>(
        "MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory {id:$id}) RETURN c.payload AS payload",
        { id: clear.id },
        true,
      )
    )[0];
    assert.equal(JSON.parse(clearClaim.payload).subject.key, person.key);
    requestExisting = undefined;
    const secondPerson = (
      await s.remember(owner, input("same-name-second-person"))
    ).memory;
    await auto.process(owner, secondPerson.id);
    requestExisting = {
      existingKey: person.key,
      identityEvidence: "Nadia works at Acme.",
    };
    const uncertain = (await s.remember(owner, input("two-matching-contexts")))
      .memory;
    await auto.process(owner, uncertain.id);
    const uncertainClaim = (
      await s.query<any>(
        "MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory {id:$id}) RETURN c.payload AS payload",
        { id: uncertain.id },
        true,
      )
    )[0];
    assert.notEqual(JSON.parse(uncertainClaim.payload).subject.key, person.key);
    waiting = true;
    const pending = (await s.remember(owner, input("revision-race-01"))).memory;
    const work = auto.process(owner, pending.id);
    while (!release) await new Promise((r) => setTimeout(r, 5));
    await s.revise(
      owner,
      pending.id,
      1,
      input("revision-race-02", "Nadia no longer works at Acme."),
    );
    release();
    assert.equal((await work).status, "superseded");
    assert.equal(
      (
        await s.query<any>(
          "MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory {id:$id}) RETURN c.id AS id",
          { id: pending.id },
          true,
        )
      ).length,
      0,
    );
  } finally {
    await s.graph.delete();
    await s.close();
  }
});

test("bad literals are omitted without losing supported facts, and exhausted jobs stop retrying", async () => {
  const s = await connect();
  let calls = 0;
  const auto = new AutomaticOntology(s, new KnowledgeStore(s), {
    async extract(context) {
      calls++;
      return {
        entities: [
          {
            key: "debt",
            type: "obligation",
            name: "Lunch debt",
            existingKey: null,
            identityEvidence: null,
          },
        ],
        claims: [
          {
            subject: "debt",
            predicate: "HAS_AMOUNT",
            object: null,
            value: "15.50",
            evidence: context.source.text,
            validFrom: null,
            validUntil: null,
          },
          {
            subject: "debt",
            predicate: "HAS_CURRENCY",
            object: null,
            value: "USD",
            evidence: context.source.text,
            validFrom: null,
            validUntil: null,
          },
        ],
      };
    },
  });
  try {
    const unknown = (
      await s.remember(
        owner,
        input("currency-unknown-01", "Lee owes me 15.50 dollars for lunch."),
      )
    ).memory;
    const r = await auto.process(owner, unknown.id);
    assert.equal(r.status, "structured");
    assert.equal(r.omittedClaims, 1);
    const known = (
      await s.remember(
        owner,
        input("currency-known-01", "Lee owes me USD 15.50 for lunch."),
      )
    ).memory;
    const k = await auto.process(owner, known.id);
    assert.equal(k.status, "structured");
    assert.equal(k.omittedClaims, 0);
    assert.equal((k.claimIds as string[]).length, 2);
    const exhausted = (await s.remember(owner, input("exhausted-source-01")))
      .memory;
    await s.query("MATCH (j:OntologyJob {id:$id}) SET j.attempts=5", {
      id: exhausted.id + ":1",
    });
    await auto.tick();
    assert.equal(calls, 2);
    assert.equal(
      (await auto.process(owner, exhausted.id)).retryScheduled,
      false,
    );
  } finally {
    await s.graph.delete();
    await s.close();
  }
});

test("a lost response after committing claims resumes the persisted plan without another model call", async () => {
  const s = await connect();
  const k = new KnowledgeStore(s);
  const record = k.record.bind(k);
  let writes = 0,
    modelCalls = 0;
  k.record = async (...args) => {
    const result = await record(...args);
    if (writes++ === 0) throw new Error("Lost response after commit");
    return result;
  };
  const auto = new AutomaticOntology(s, k, {
    async extract(context) {
      modelCalls++;
      return output(context.source.text);
    },
  });
  try {
    const source = (
      await s.remember(owner, {
        ...input("lost-response-01"),
        basis: "observed_outcome",
      })
    ).memory;
    assert.equal((await auto.process(owner, source.id)).status, "pending");
    await s.query("MATCH (j:OntologyJob {id:$id}) SET j.nextAt=0", {
      id: source.id + ":1",
    });
    assert.equal((await auto.process(owner, source.id)).status, "structured");
    assert.equal(modelCalls, 1);
    const claims = (await k.recall(owner, { personalOnly: true })).claims;
    assert.equal(claims.length, 1);
    assert.equal(claims[0].basis, "observed");
  } finally {
    await s.graph.delete();
    await s.close();
  }
});
