// Polished demo memories with hand-written ontology claims for one sandbox account.
// Dry run by default; --apply writes. Reruns reuse the same retry keys and add nothing.
import { pathToFileURL } from "node:url";
import { createClerkClient } from "@clerk/express";
import { assertSandbox, FixtureStateError } from "./sandbox-seed.mjs";

const KEY = "demo-ontology-v1";
const CHATGPT = "https://chatgpt.com/oauth/client.json";
const CODEX = "https://chatgpt.com/oauth/codex/client.json";

/** Entities reused across memories so the graph connects. */
export function demoEntities(ownerName) {
  const e = (key, type, name, properties = {}) => ({
    key,
    type,
    name,
    aliases: [],
    properties,
  });
  return {
    self: e("auto:self", "person", ownerName),
    maya: e("demo:maya", "person", "Maya Chen"),
    daniel: e("demo:daniel", "person", "Daniel Okafor"),
    aisha: e("demo:aisha", "person", "Aisha Rahman"),
    kai: e("demo:kai", "person", "Kai Tan"),
    memspace: e("demo:memspace", "project", "Memspace", {
      description: "Memory layer shared across assistants",
    }),
    mobile: e("demo:mobile", "project", "Memspace mobile app"),
    lumen: e("demo:lumen", "organization", "Lumen Labs"),
    northwind: e("demo:northwind", "organization", "Northwind Ventures"),
    demoday: e("demo:demoday", "event", "Northwind demo day"),
    review: e("demo:review", "event", "Dashboard design review"),
    lunch: e("demo:lunch", "event", "Team lunch at Tiong Bahru Bakery"),
    hike: e("demo:hike", "event", "MacRitchie hike"),
    deck: e("demo:deck", "task", "Review the Memspace pitch deck"),
    watch: e("demo:watch", "task", "Ship the personal memory watch"),
    identity: e("demo:identity", "task", "Assistant identity work"),
    labels: e("demo:labels", "task", "Clearer graph view labels"),
    rename: e("demo:rename", "decision", "Rename Shared Memory to Memspace"),
    concise: e("demo:concise", "preference", "Concise status updates"),
    asyncFeedback: e(
      "demo:async-feedback",
      "preference",
      "Async feedback in Figma comments",
    ),
    run: e("demo:run", "routine", "Morning river run"),
    river: e("demo:river", "place", "Singapore River"),
    bakery: e("demo:bakery", "place", "Tiong Bahru Bakery"),
    macritchie: e("demo:macritchie", "place", "MacRitchie Reservoir"),
    lunchDebt: e("demo:lunch-debt", "obligation", "Lunch repayment to Aisha"),
    goal: e("demo:goal-50", "goal", "50 daily Memspace users"),
    falkordb: e("demo:falkordb", "topic", "FalkorDB"),
    keyboards: e("demo:keyboards", "topic", "Mechanical keyboards"),
    kinesis: e("demo:kinesis", "item", "Kinesis Advantage keyboard"),
    figma: e("demo:figma", "item", "Figma"),
    muse: e("demo:muse-integration", "topic", "Muse integration"),
  };
}

/** Each memory: source text, the assistant that saved it, and claims whose evidence is an exact excerpt. */
export function demoMemories() {
  const c = (subject, predicate, target, evidence, extra = {}) => ({
    subject,
    predicate,
    ...(target?.value !== undefined
      ? { value: target.value }
      : { object: target }),
    evidence,
    basis: "explicit",
    ...extra,
  });
  const v = (value) => ({ value });
  const inferred = { basis: "inferred" };
  return [
    {
      id: "building",
      client: "codex",
      kind: "fact",
      text: "I'm building Memspace, a memory layer that lets my assistants share context across ChatGPT, Codex and Muse.",
      claims: [
        c("self", "WORKS_ON", "memspace", "I'm building Memspace"),
        c("memspace", "HAS_STATUS", v("in_progress"), "I'm building Memspace"),
      ],
    },
    {
      id: "maya",
      client: "chatgpt",
      kind: "fact",
      text: "Maya Chen from Lumen Labs is designing the Memspace dashboard. She prefers async feedback through Figma comments.",
      claims: [
        c("maya", "WORKS_AT", "lumen", "Maya Chen from Lumen Labs"),
        c(
          "maya",
          "WORKS_ON",
          "memspace",
          "is designing the Memspace dashboard",
        ),
        c(
          "maya",
          "HAS_ROLE",
          v("Dashboard designer"),
          "is designing the Memspace dashboard",
        ),
        c(
          "asyncFeedback",
          "PREFERENCE_OF",
          "maya",
          "She prefers async feedback through Figma comments",
        ),
        c(
          "maya",
          "USES",
          "figma",
          "She prefers async feedback through Figma comments",
          inferred,
        ),
      ],
    },
    {
      id: "maya-mobile",
      client: "chatgpt",
      kind: "fact",
      text: "Maya is not working on the mobile app; she is only designing the web dashboard for now.",
      claims: [
        c(
          "maya",
          "WORKS_ON",
          "mobile",
          "Maya is not working on the mobile app",
          {
            negated: true,
          },
        ),
      ],
    },
    {
      id: "daniel-deck",
      client: "muse",
      kind: "task",
      text: "Daniel Okafor, a partner at Northwind Ventures, offered to review the Memspace pitch deck before demo day on November 14 at 10am.",
      claims: [
        c("daniel", "WORKS_AT", "northwind", "a partner at Northwind Ventures"),
        c(
          "daniel",
          "HAS_ROLE",
          v("Partner"),
          "a partner at Northwind Ventures",
        ),
        c(
          "deck",
          "ASSIGNED_TO",
          "daniel",
          "offered to review the Memspace pitch deck",
        ),
        c("deck", "PART_OF", "memspace", "review the Memspace pitch deck"),
        c(
          "deck",
          "DUE_AT",
          v("2026-11-14T10:00:00+08:00"),
          "before demo day on November 14 at 10am",
        ),
        c(
          "demoday",
          "STARTS_AT",
          v("2026-11-14T10:00:00+08:00"),
          "demo day on November 14 at 10am",
        ),
      ],
    },
    {
      id: "daniel-intro",
      client: "chatgpt",
      kind: "relationship",
      text: "Daniel Okafor introduced me to Maya Chen last spring.",
      claims: [
        c(
          "self",
          "KNOWS",
          "daniel",
          "Daniel Okafor introduced me to Maya Chen",
        ),
        c("self", "KNOWS", "maya", "Daniel Okafor introduced me to Maya Chen"),
        c(
          "daniel",
          "KNOWS",
          "maya",
          "Daniel Okafor introduced me to Maya Chen",
          inferred,
        ),
      ],
    },
    {
      id: "watch",
      client: "codex",
      kind: "task",
      text: "The personal memory watch has to ship before demo day, and it depends on finishing the assistant identity work.",
      claims: [
        c(
          "watch",
          "DEPENDS_ON",
          "identity",
          "it depends on finishing the assistant identity work",
        ),
        c(
          "watch",
          "PART_OF",
          "memspace",
          "The personal memory watch",
          inferred,
        ),
        c(
          "watch",
          "DUE_AT",
          v("2026-11-14T10:00:00+08:00"),
          "has to ship before demo day",
          inferred,
        ),
      ],
    },
    {
      id: "identity-done",
      client: "codex",
      kind: "event",
      basis: "observed_outcome",
      text: "Finished the assistant identity work today: the dashboard now shows ChatGPT, Codex and Muse by name.",
      eventAt: "2026-10-18T14:00:00+08:00",
      claims: [
        c(
          "identity",
          "HAS_STATUS",
          v("completed"),
          "Finished the assistant identity work today",
          { basis: "observed" },
        ),
        c(
          "identity",
          "COMPLETED_BY",
          "self",
          "Finished the assistant identity work today",
          { basis: "observed" },
        ),
        c(
          "identity",
          "PART_OF",
          "memspace",
          "the dashboard now shows ChatGPT, Codex and Muse by name",
          inferred,
        ),
      ],
    },
    {
      id: "rename",
      client: "chatgpt",
      kind: "decision",
      text: "We decided to rename the product from Shared Memory to Memspace because it is shorter and easier to say.",
      claims: [
        c("rename", "DECIDED_BY", "self", "We decided to rename the product"),
        c(
          "rename",
          "APPLIES_TO",
          "memspace",
          "rename the product from Shared Memory to Memspace",
        ),
        c(
          "rename",
          "HAS_VALUE",
          v("Memspace"),
          "from Shared Memory to Memspace",
        ),
        c(
          "rename",
          "HAS_REASON",
          v("Shorter and easier to say"),
          "because it is shorter and easier to say",
        ),
      ],
    },
    {
      id: "concise",
      client: "muse",
      kind: "preference",
      text: "I prefer concise status updates with bullet points instead of long paragraphs.",
      claims: [
        c(
          "concise",
          "PREFERENCE_OF",
          "self",
          "I prefer concise status updates",
        ),
        c(
          "concise",
          "HAS_VALUE",
          v("Bullet points, not long paragraphs"),
          "with bullet points instead of long paragraphs",
        ),
      ],
    },
    {
      id: "run",
      client: "muse",
      kind: "fact",
      text: "I run along the Singapore River every Tuesday and Thursday morning.",
      claims: [
        c("self", "PRACTICES", "run", "I run along the Singapore River"),
        c(
          "run",
          "HAS_FREQUENCY",
          v("Tuesday and Thursday mornings"),
          "every Tuesday and Thursday morning",
        ),
        c("run", "ABOUT", "river", "along the Singapore River"),
      ],
    },
    {
      id: "aisha",
      client: "chatgpt",
      kind: "fact",
      text: "Aisha Rahman is the backend engineer on Memspace and knows FalkorDB inside out.",
      claims: [
        c("aisha", "WORKS_ON", "memspace", "the backend engineer on Memspace"),
        c(
          "aisha",
          "HAS_ROLE",
          v("Backend engineer"),
          "the backend engineer on Memspace",
        ),
        c("aisha", "HAS_SKILL", "falkordb", "knows FalkorDB inside out"),
        c(
          "self",
          "COLLEAGUE_OF",
          "aisha",
          "Aisha Rahman is the backend engineer on Memspace",
          inferred,
        ),
      ],
    },
    {
      id: "lunch-debt",
      client: "chatgpt",
      kind: "fact",
      text: "I owe Aisha SGD 48 for my share of the team lunch at Tiong Bahru Bakery on Friday.",
      claims: [
        c("self", "OWES", "lunchDebt", "I owe Aisha SGD 48"),
        c("lunchDebt", "OWED_TO", "aisha", "I owe Aisha"),
        c("lunchDebt", "HAS_AMOUNT", v("48"), "SGD 48"),
        c("lunchDebt", "HAS_CURRENCY", v("SGD"), "SGD 48"),
        c(
          "lunchDebt",
          "HAS_PAYMENT_STATUS",
          v("outstanding"),
          "I owe Aisha SGD 48",
        ),
        c(
          "lunchDebt",
          "FOR_CONTEXT",
          "lunch",
          "for my share of the team lunch",
        ),
        c(
          "lunch",
          "LOCATED_AT",
          "bakery",
          "the team lunch at Tiong Bahru Bakery",
        ),
        c(
          "lunch",
          "HAS_PARTICIPANT",
          "aisha",
          "I owe Aisha SGD 48 for my share of the team lunch",
          inferred,
        ),
      ],
    },
    {
      id: "goal",
      client: "codex",
      kind: "goal",
      text: "My goal is to have 50 people using Memspace every day by December 31.",
      claims: [
        c(
          "self",
          "WANTS",
          "goal",
          "My goal is to have 50 people using Memspace every day",
        ),
        c("goal", "DUE_AT", v("2026-12-31T23:59:00+08:00"), "by December 31"),
        c(
          "memspace",
          "CONTRIBUTES_TO",
          "goal",
          "50 people using Memspace every day",
        ),
      ],
    },
    {
      id: "design-review",
      client: "chatgpt",
      kind: "event",
      text: "Had a dashboard design review with Maya on October 16 at 3pm; we agreed the graph view needs clearer labels.",
      eventAt: "2026-10-16T15:00:00+08:00",
      claims: [
        c(
          "review",
          "HAS_PARTICIPANT",
          "maya",
          "a dashboard design review with Maya",
        ),
        c(
          "review",
          "HAS_PARTICIPANT",
          "self",
          "Had a dashboard design review with Maya",
        ),
        c(
          "review",
          "OCCURRED_AT",
          v("2026-10-16T15:00:00+08:00"),
          "on October 16 at 3pm",
        ),
        c("review", "PART_OF", "memspace", "dashboard design review", inferred),
        c(
          "labels",
          "HAS_STATUS",
          v("accepted"),
          "we agreed the graph view needs clearer labels",
        ),
        c(
          "labels",
          "PART_OF",
          "memspace",
          "the graph view needs clearer labels",
          inferred,
        ),
      ],
    },
    {
      id: "keyboard",
      client: "muse",
      kind: "preference",
      text: "I type on a Kinesis Advantage keyboard and I love mechanical keyboards.",
      claims: [
        c("self", "USES", "kinesis", "I type on a Kinesis Advantage keyboard"),
        c("self", "LIKES", "keyboards", "I love mechanical keyboards"),
      ],
    },
    {
      id: "muse-risk",
      client: "codex",
      kind: "fact",
      text: "I'm worried the Muse integration could break if Meta changes its OAuth client registration again.",
      claims: [
        c(
          "self",
          "CONCERNED_ABOUT",
          "muse",
          "I'm worried the Muse integration could break",
        ),
        c("muse", "ABOUT", "memspace", "the Muse integration", inferred),
      ],
    },
    {
      id: "hike",
      client: "muse",
      kind: "event",
      text: "Kai Tan, my closest friend from university, is going hiking with me at MacRitchie Reservoir on Saturday at 7am.",
      claims: [
        c(
          "self",
          "FRIEND_OF",
          "kai",
          "Kai Tan, my closest friend from university",
        ),
        c("hike", "HAS_PARTICIPANT", "kai", "is going hiking with me"),
        c("hike", "HAS_PARTICIPANT", "self", "is going hiking with me"),
        c(
          "hike",
          "LOCATED_AT",
          "macritchie",
          "hiking with me at MacRitchie Reservoir",
        ),
        c(
          "hike",
          "STARTS_AT",
          v("2026-10-24T07:00:00+08:00"),
          "on Saturday at 7am",
        ),
      ],
    },
  ];
}

/** Writes the demo set for owner through the normal remember/record paths. */
export async function seedDemoOntology(
  memory,
  knowledge,
  owner,
  clients,
  { apply = false } = {},
) {
  const catalog = demoEntities(owner.name ?? "Me");
  const plan = demoMemories().map((m) => {
    const keys = [...new Set(m.claims.flatMap((c) => [c.subject, c.object]))]
      .filter(Boolean)
      .map((k) => {
        if (!catalog[k]) throw new FixtureStateError(`Unknown entity ${k}`);
        return k;
      });
    for (const claim of m.claims)
      if (!m.text.includes(claim.evidence))
        throw new FixtureStateError(
          `Evidence not in ${m.id}: ${claim.evidence}`,
        );
    return {
      ...m,
      clientId: clients[m.client] ?? "dashboard",
      memory: {
        text: m.text,
        kind: m.kind,
        basis: m.basis ?? "user_statement",
        evidence: m.text,
        entities: keys
          .filter((k) => k !== "self")
          .map((k) => ({ type: catalog[k].type, name: catalog[k].name })),
        ...(m.eventAt ? { eventAt: m.eventAt } : {}),
        idempotencyKey: `${KEY}:${m.id}`,
      },
      knowledge: {
        entities: keys.map((k) => catalog[k]),
        claims: m.claims.map(({ subject, object, ...c }) => ({
          ...c,
          subject: catalog[subject].key,
          ...(object ? { object: catalog[object].key } : {}),
        })),
      },
    };
  });
  if (!apply)
    return {
      applied: false,
      memories: plan.length,
      claims: plan.reduce((n, p) => n + p.claims.length, 0),
      byAssistant: Object.fromEntries(
        Object.entries(
          plan.reduce(
            (acc, p) => ({ ...acc, [p.clientId]: (acc[p.clientId] ?? 0) + 1 }),
            {},
          ),
        ),
      ),
    };
  const results = [];
  for (const p of plan) {
    const actor = { ...owner, clientId: p.clientId };
    const saved = await memory.remember(actor, p.memory);
    const id = saved.memory.id;
    const revision = saved.memory.revision;
    // These claims are hand-written; keep the worker from extracting duplicates.
    await memory.query(
      `MATCH (j:OntologyJob)-[:SUPPORTED_BY]->(m:Memory {id:$id}) WHERE j.owner=$user AND j.revision=$revision AND m.revision=$revision AND j.status='pending'
       SET j.status='structured',j.plan=NULL,j.lease=NULL,j.leaseUntil=NULL`,
      { id, user: owner.userId, revision },
    );
    const recorded = await knowledge.record(actor, {
      sourceMemoryId: id,
      sourceRevision: revision,
      idempotencyKey: `${KEY}:${p.id}:claims`,
      ...p.knowledge,
    });
    await memory.query(
      `MATCH (j:OntologyJob)-[:SUPPORTED_BY]->(m:Memory {id:$id}) WHERE j.owner=$user AND j.revision=$revision SET j.claimIds=$claims`,
      { id, user: owner.userId, revision, claims: recorded.claimIds },
    );
    results.push({ id, claims: recorded.claimIds.length });
  }
  return {
    applied: true,
    memories: results.length,
    claims: results.reduce((n, r) => n + r.claims, 0),
  };
}

async function main() {
  assertSandbox(process.env);
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const emailArg = args.indexOf("--owner-email");
  const ownerEmail = (
    emailArg >= 0 ? args[emailArg + 1] : "pranavjana2003@gmail.com"
  )
    ?.trim()
    .toLowerCase();
  if (
    !ownerEmail ||
    args.some(
      (a) => a.startsWith("--") && !["--apply", "--owner-email"].includes(a),
    )
  )
    throw new FixtureStateError("Usage: [--owner-email EMAIL] [--apply]");
  const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  });
  const found = await clerk.users.getUserList({
    emailAddress: [ownerEmail],
    limit: 2,
  });
  const user = found.data[0];
  if (
    found.data.length !== 1 ||
    user.primaryEmailAddress?.emailAddress !== ownerEmail ||
    user.primaryEmailAddress?.verification?.status !== "verified"
  )
    throw new FixtureStateError(
      "Owner must be one existing verified sandbox account.",
    );
  const { connectMemoryStore } = await import("../dist/memory.js");
  const { KnowledgeStore } = await import("../dist/knowledge.js");
  const memory = await connectMemoryStore();
  try {
    const owner = {
      userId: user.id,
      name: user.fullName,
      email: ownerEmail,
    };
    // Attribute each memory to an assistant this account has actually connected.
    const connected = (await memory.connections(owner)).map((c) => c.clientId);
    const muse = [];
    for (const id of connected.filter((id) => !id.startsWith("https://"))) {
      const apps = await clerk.oauthApplications.list({
        nameQuery: id,
        limit: 10,
      });
      if (apps.data.some((a) => a.clientId === id && a.name === "Muse"))
        muse.push(id);
    }
    const clients = {
      chatgpt: connected.includes(CHATGPT) ? CHATGPT : undefined,
      codex: connected.includes(CODEX) ? CODEX : undefined,
      muse: muse[0],
    };
    const result = await seedDemoOntology(
      memory,
      new KnowledgeStore(memory),
      owner,
      clients,
      { apply },
    );
    console.log(JSON.stringify({ ownerEmail, ...result }));
  } finally {
    await memory.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      error instanceof FixtureStateError
        ? error.message
        : "Demo ontology seed failed. No credentials printed.",
    );
    process.exitCode = 1;
  });
}
