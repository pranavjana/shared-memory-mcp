import { z } from "zod";

export interface PropertyDefinition {
  name: string;
  type:
    | "string"
    | "datetime"
    | "string[]"
    | "number"
    | "boolean"
    | "decimal"
    | "currency";
  description: string;
  required?: boolean;
  values?: string[];
}
export interface TypeDefinition {
  id: string;
  name: string;
  description: string;
  group: "domain" | "system";
  properties: PropertyDefinition[];
}
export const entityTypes = [
  "person",
  "project",
  "task",
  "goal",
  "event",
  "decision",
  "preference",
  "organization",
  "place",
  "topic",
  "obligation",
  "item",
  "routine",
] as const;
export type EntityTypeName = (typeof entityTypes)[number];
const prop = (
  name: string,
  description: string,
  values?: string[],
): PropertyDefinition => ({
  name,
  type: "string",
  description,
  ...(values ? { values } : {}),
});
const identity: PropertyDefinition[] = [
  {
    ...prop(
      "key",
      "Stable identifier chosen within your personal namespace. Reuse it across writes; names are not identity.",
    ),
    required: true,
  },
  { ...prop("name", "Human-readable name."), required: true },
  {
    name: "aliases",
    type: "string[]",
    description: "Alternative names within this identity's scope.",
  },
];
const domain = (
  id: EntityTypeName,
  description: string,
  properties: PropertyDefinition[] = [],
): TypeDefinition => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  description,
  group: "domain",
  properties: [...identity, ...properties],
});
export const typeDefinitions: TypeDefinition[] = [
  domain(
    "person",
    "A mentioned person. A name alone never links a platform account.",
    [prop("description", "Context that distinguishes this person.")],
  ),
  domain("project", "An ongoing effort containing work, decisions and goals.", [
    prop("description", "The project's purpose."),
  ]),
  domain(
    "task",
    "An attributed work item. Assignment does not imply acceptance or completion.",
    [prop("description", "The intended outcome.")],
  ),
  domain("goal", "A desired outcome supported by projects or tasks.", [
    prop("description", "What success means."),
  ]),
  domain(
    "event",
    "A particular occurrence, distinct from a recurring preference.",
    [prop("description", "What happened or is scheduled.")],
  ),
  domain("decision", "A choice with attribution and supporting reasoning.", [
    prop("description", "The choice being recorded."),
  ]),
  domain(
    "preference",
    "A person's preference, qualified by context rather than assumed universal.",
    [
      prop("context", "Where the preference applies."),
      prop("description", "The preference being described."),
    ],
  ),
  domain("organization", "An organization mentioned in authorized memory.", [
    prop("description", "Context that distinguishes this organization."),
  ]),
  domain("place", "A place relevant to a memory.", [
    prop("description", "Context that distinguishes this place."),
  ]),
  domain("topic", "A subject used to connect otherwise related knowledge.", [
    prop("description", "Meaning of the topic."),
  ]),
  domain(
    "obligation",
    "A distinct reported debt or repayment obligation; never implies acceptance, a transfer or a calculated balance.",
    [
      prop(
        "description",
        "Context distinguishing this obligation from other debts.",
      ),
    ],
  ),
  domain("item", "A particular possession, product, document or service.", [
    prop("description", "What this item is."),
  ]),
  domain("routine", "A recurring activity; separate from any one occurrence.", [
    prop("description", "The recurring activity."),
  ]),
  {
    id: "account",
    name: "Account",
    group: "system",
    description:
      "An authenticated platform identity. Distinct from a person merely mentioned in a memory.",
    properties: [
      prop("id", "Verified account identity."),
      prop("name", "Account display name."),
    ],
  },
  {
    id: "revision",
    name: "Revision",
    group: "system",
    description:
      "An immutable version of an authored source memory. Private history remains author-only.",
    properties: [
      prop("id", "Server-generated version identity."),
      {
        name: "revision",
        type: "number",
        description: "Monotonic source revision number.",
      },
      prop("text", "Source text at this revision."),
      prop("evidence", "Evidence at this revision."),
      {
        name: "createdAt",
        type: "number",
        description: "When this version was saved.",
      },
    ],
  },
  {
    id: "memory",
    name: "Memory",
    group: "system",
    description:
      "The existing private source record. Sharing a memory and publishing selected claims are separate actions.",
    properties: [
      prop("id", "Server-generated identity."),
      prop("text", "Saved source text."),
      prop("evidence", "Submitted supporting excerpt."),
      prop("owner", "Authenticated author."),
      prop("kind", "Source memory classification.", [
        "fact",
        "preference",
        "event",
        "goal",
        "task",
        "decision",
        "relationship",
      ]),
      prop("basis", "Source attribution.", [
        "user_statement",
        "observed_outcome",
      ]),
      prop("authorName", "Author display name."),
      prop("sourceClient", "Authenticated client that saved the source."),
      { name: "createdAt", type: "number", description: "Initial save time." },
      {
        name: "updatedAt",
        type: "number",
        description: "Latest source revision time.",
      },
      {
        name: "eventAt",
        type: "datetime",
        description: "Reported event time, when known.",
      },
      {
        name: "revision",
        type: "number",
        description: "Current source revision.",
      },
    ],
  },
  {
    id: "claim",
    name: "Claim",
    group: "system",
    description:
      "An attributed, time-qualified assertion backed by a specific source revision. Structured writes are validated against this registry.",
    properties: [
      prop("id", "Server-generated identity."),
      prop("predicate", "An allowed relationship or value predicate."),
      prop(
        "subject",
        "Scoped entity key on input; resolved entity snapshot on reads.",
      ),
      prop(
        "object",
        "Scoped target key for relationship predicates; omitted for value predicates.",
      ),
      prop(
        "value",
        "Literal value for value predicates; its type and enum come from the predicate.",
      ),
      prop(
        "authorId",
        "Authenticated asserting account, assigned by the server.",
      ),
      prop("authorName", "Display name of the asserting author."),
      prop(
        "supersedes",
        "Optional prior claim ID for an explicit same-author correction.",
      ),
      prop("evidence", "Exact excerpt from the source text or evidence."),
      prop("basis", "How the assertion was obtained.", [
        "explicit",
        "observed",
        "inferred",
      ]),
      prop(
        "status",
        "Lifecycle; inferred statements are never promoted to explicit facts.",
        ["active", "disputed", "superseded"],
      ),
      {
        name: "validFrom",
        type: "datetime",
        description: "When the claim applies, if known.",
      },
      {
        name: "validUntil",
        type: "datetime",
        description: "Exclusive end of applicability, if known.",
      },
      {
        name: "recordedAt",
        type: "number",
        description: "When the system recorded it, distinct from its validity.",
      },
      prop(
        "sourceMemoryId",
        "Private provenance; omitted from shared publications.",
      ),
      {
        name: "sourceRevision",
        type: "number",
        description: "The precise source revision supporting the claim.",
      },
      prop(
        "sourceClient",
        "Assistant that captured the claim; not an independent authority.",
      ),
    ],
  },
  {
    id: "space",
    name: "Space",
    group: "system",
    description:
      "An authorization boundary. Membership does not share private knowledge.",
    properties: [
      prop("id", "Server-generated space identity."),
      prop("name", "Space display name."),
      prop("owner", "Owner account."),
    ],
  },
  {
    id: "publication",
    name: "Publication",
    group: "system",
    description:
      "An explicitly published snapshot of one claim. Later private edits do not silently change it.",
    properties: [
      prop("id", "Space-specific publication identity."),
      prop("spaceId", "Authorized destination space."),
      {
        name: "active",
        type: "boolean",
        description: "Whether this publication remains available.",
      },
      {
        name: "publishedAt",
        type: "number",
        description: "Snapshot publication time.",
      },
      prop("authorId", "Authenticated publishing account."),
      prop("authorName", "Publisher display name."),
      {
        name: "sourceRevision",
        type: "number",
        description:
          "The source revision at publication, not a promise of current state.",
      },
    ],
  },
];
export interface RelationDefinition {
  id: string;
  description: string;
  from: string[];
  to: string[];
  group: "assertion" | "system";
  value?: PropertyDefinition;
  properties?: PropertyDefinition[];
}
const link = (
  id: string,
  description: string,
  from: string[],
  to: string[],
): RelationDefinition => ({ id, description, from, to, group: "assertion" });
export const relationshipDefinitions: RelationDefinition[] = [
  link(
    "WORKS_AT",
    "Reported employment, not organization membership or a future job wish.",
    ["person"],
    ["organization"],
  ),
  link(
    "STUDIES_AT",
    "Reported study at an institution.",
    ["person"],
    ["organization"],
  ),
  link(
    "MEMBER_OF_ORGANIZATION",
    "Reported organization membership; does not grant application access.",
    ["person"],
    ["organization"],
  ),
  link(
    "KNOWS",
    "Reported acquaintance; directional and never an authorization grant.",
    ["person"],
    ["person"],
  ),
  link(
    "FRIEND_OF",
    "Reported friendship; do not infer mutual claims or sharing consent.",
    ["person"],
    ["person"],
  ),
  link(
    "FAMILY_OF",
    "Reported family connection; use evidence for the exact role.",
    ["person"],
    ["person"],
  ),
  link(
    "PARENT_OF",
    "Reported parent-child relationship; direction matters and does not imply custody or consent.",
    ["person"],
    ["person"],
  ),
  link(
    "SIBLING_OF",
    "Reported sibling relationship; no reverse claim is silently authored.",
    ["person"],
    ["person"],
  ),
  link(
    "PARTNER_OF",
    "Reported personal partnership, qualified by validity and evidence.",
    ["person"],
    ["person"],
  ),
  link(
    "COLLEAGUE_OF",
    "Reported coworker relationship; employment at one organization does not establish this automatically.",
    ["person"],
    ["person"],
  ),
  link(
    "REPORTS_TO",
    "Reported work reporting line, distinct from an application role.",
    ["person"],
    ["person"],
  ),
  link(
    "WORKS_ON",
    "Reported involvement in an ongoing project; does not imply task acceptance.",
    ["person", "organization"],
    ["project"],
  ),
  link(
    "HAS_SKILL",
    "Reported skill, not a measured proficiency or verified qualification.",
    ["person"],
    ["topic"],
  ),
  link(
    "LIVES_IN",
    "Reported residence; visiting a place does not establish residence.",
    ["person"],
    ["place"],
  ),
  link(
    "LOCATED_AT",
    "Place associated with this particular event, organization or item.",
    ["event", "organization", "item"],
    ["place"],
  ),
  link(
    "HAS_PARTICIPANT",
    "Reported participant in a particular event; no attendance confirmation implied.",
    ["event"],
    ["person"],
  ),
  link(
    "ORGANIZED_BY",
    "Reported event organizer.",
    ["event"],
    ["person", "organization"],
  ),
  link(
    "WANTS",
    "A person's desired goal, not a decision, acceptance or completed action.",
    ["person"],
    ["goal"],
  ),
  link(
    "CONCERNED_ABOUT",
    "A reported concern; does not imply a diagnosis.",
    ["person"],
    ["goal", "topic", "event", "project", "task", "obligation"],
  ),
  link(
    "LIKES",
    "Reported liking; preserve context and time.",
    ["person"],
    ["item", "topic", "place", "routine"],
  ),
  link(
    "DISLIKES",
    "Reported dislike; not inferred from a single event.",
    ["person"],
    ["item", "topic", "place", "routine"],
  ),
  link(
    "OWNS",
    "Reported possession, not application ownership or access.",
    ["person", "organization"],
    ["item"],
  ),
  link(
    "USES",
    "Reported use of an item or service.",
    ["person", "organization"],
    ["item"],
  ),
  link("PRACTICES", "Reported recurring activity.", ["person"], ["routine"]),
  link(
    "OWES",
    "Debtor points to a distinct obligation, not directly to a creditor. Use OWED_TO on that obligation. Separate debts need separate keys.",
    ["person"],
    ["obligation"],
  ),
  link(
    "OWED_TO",
    "The reported creditor of this particular obligation.",
    ["obligation"],
    ["person"],
  ),
  link(
    "FOR_CONTEXT",
    "Context of a particular obligation, goal or routine.",
    ["obligation", "goal", "routine"],
    ["organization", "event", "item", "topic", "project"],
  ),
  {
    ...link(
      "HAS_AMOUNT",
      "Reported amount, as an exact nonnegative decimal string. Never infer remaining balance or aggregate currencies.",
      ["obligation"],
      [],
    ),
    value: {
      name: "value",
      type: "decimal",
      description:
        "Exact decimal string, e.g. 15.50. No exponent or currency symbol; up to six fractional places.",
    },
  },
  {
    ...link(
      "HAS_CURRENCY",
      "Explicit ISO 4217 currency code; dollars alone does not establish USD.",
      ["obligation"],
      [],
    ),
    value: {
      name: "value",
      type: "currency",
      description: "Three-letter ISO 4217 code, only when explicitly known.",
    },
  },
  {
    ...link(
      "HAS_PAYMENT_STATUS",
      "Reported state of a particular obligation; no automatic payment or balance inference.",
      ["obligation"],
      [],
    ),
    value: prop("value", "Reported payment state.", [
      "outstanding",
      "partially_paid",
      "settled",
      "disputed",
      "cancelled",
    ]),
  },
  {
    ...link(
      "HAS_ROLE",
      "Reported job or family role in its evidence context; not an application permission.",
      ["person"],
      [],
    ),
    value: prop("value", "The reported role, e.g. analyst."),
  },
  {
    ...link(
      "HAS_FREQUENCY",
      "Reported recurrence in words; not a scheduler or reminder registration.",
      ["routine"],
      [],
    ),
    value: prop("value", "Reported recurrence; retain timezone if stated."),
  },
  {
    ...link(
      "STARTS_AT",
      "Explicit start of a particular event.",
      ["event"],
      [],
    ),
    value: {
      name: "value",
      type: "datetime",
      description: "ISO timestamp with timezone.",
    },
  },
  {
    ...link("ENDS_AT", "Explicit end of a particular event.", ["event"], []),
    value: {
      name: "value",
      type: "datetime",
      description: "ISO timestamp with timezone.",
    },
  },
  link(
    "PART_OF",
    "Work or context belongs to a project.",
    ["task", "event", "decision"],
    ["project"],
  ),
  link(
    "ASSIGNED_TO",
    "Reported assignment; does not imply acceptance.",
    ["task"],
    ["person"],
  ),
  link(
    "ACCEPTED_BY",
    "An explicit acceptance of a task.",
    ["task"],
    ["person"],
  ),
  link(
    "COMPLETED_BY",
    "Who reportedly completed a task.",
    ["task"],
    ["person"],
  ),
  link(
    "DEPENDS_ON",
    "The subject requires the target; direction matters.",
    ["task"],
    ["task"],
  ),
  link(
    "CONTRIBUTES_TO",
    "Work supports a desired outcome.",
    ["task", "project"],
    ["goal"],
  ),
  link("DECIDED_BY", "Who reportedly made a choice.", ["decision"], ["person"]),
  link(
    "PREFERENCE_OF",
    "Whose preference this is.",
    ["preference"],
    ["person"],
  ),
  link(
    "APPLIES_TO",
    "Context limits the meaning of a preference or decision.",
    ["preference", "decision"],
    ["project", "task", "topic", "organization"],
  ),
  link(
    "ABOUT",
    "A deliberately broad topic connection; use a more precise relation when possible.",
    [...entityTypes],
    [...entityTypes],
  ),
  {
    ...link(
      "HAS_STATUS",
      "An attributed state; a new report does not silently override another author.",
      ["task", "project", "goal"],
      [],
    ),
    value: prop("value", "State reported by this claim.", [
      "proposed",
      "accepted",
      "in_progress",
      "blocked",
      "completed",
      "cancelled",
    ]),
  },
  {
    ...link(
      "DUE_AT",
      "A reported deadline with an explicit timezone.",
      ["task", "goal", "obligation"],
      [],
    ),
    value: {
      name: "value",
      type: "datetime",
      description: "Deadline as an ISO timestamp with timezone.",
    },
  },
  {
    ...link(
      "OCCURRED_AT",
      "When an event occurred or is scheduled.",
      ["event"],
      [],
    ),
    value: {
      name: "value",
      type: "datetime",
      description: "Event time as an ISO timestamp with timezone.",
    },
  },
  {
    ...link(
      "HAS_VALUE",
      "The contextual content of a preference or choice.",
      ["preference", "decision"],
      [],
    ),
    value: prop("value", "The stated preference or chosen option."),
  },
  {
    ...link(
      "HAS_REASON",
      "The evidence-backed reason for a choice.",
      ["decision"],
      [],
    ),
    value: prop("value", "The stated rationale, not an invented explanation."),
  },
  {
    id: "SUBJECT",
    from: ["claim", "publication"],
    to: [...entityTypes],
    group: "system",
    description: "Entity the assertion is about.",
  },
  {
    id: "OBJECT",
    from: ["claim", "publication"],
    to: [...entityTypes],
    group: "system",
    description: "Entity at the other end of a relationship claim.",
  },
  {
    id: "SUPPORTED_BY",
    from: ["claim"],
    to: ["memory"],
    group: "system",
    description: "Private provenance tied to an exact memory revision.",
  },
  {
    id: "SUPERSEDES",
    from: ["claim"],
    to: ["claim"],
    group: "system",
    description:
      "Explicit correction of the same author's subject and predicate; previous assertion stays in history.",
  },
  {
    id: "PUBLISHED_IN",
    from: ["publication"],
    to: ["space"],
    group: "system",
    description: "Snapshot visible only to active members of this space.",
  },
  {
    id: "BASED_ON",
    from: ["claim"],
    to: ["revision"],
    group: "system",
    description: "The exact private source revision supporting this assertion.",
  },
  {
    id: "HAS_REVISION",
    from: ["memory"],
    to: ["revision"],
    group: "system",
    description:
      "Source revision history; only the author can retrieve its full contents.",
  },
  {
    id: "AUTHORED",
    from: ["account"],
    to: ["memory"],
    group: "system",
    description:
      "Authenticated ownership, never inferred from a person's name.",
  },
  {
    id: "MEMBER_OF",
    from: ["account"],
    to: ["space"],
    group: "system",
    description:
      "Active membership controls reads; role controls space writes.",
    properties: [
      prop("role", "Space permission level.", [
        "owner",
        "contributor",
        "reader",
      ]),
      {
        name: "active",
        type: "boolean",
        description: "Whether this grant is currently active.",
      },
      {
        name: "joinedAt",
        type: "number",
        description: "When membership began.",
      },
    ],
  },
  {
    id: "SHARED_IN",
    from: ["memory"],
    to: ["space"],
    group: "system",
    description:
      "Existing live whole-memory sharing. Separate from frozen claim publication.",
    properties: [
      {
        name: "active",
        type: "boolean",
        description: "Whether the shared reference is currently available.",
      },
      {
        name: "updatedAt",
        type: "number",
        description: "Last share/retraction time.",
      },
    ],
  },
  {
    id: "DERIVED_FROM",
    from: ["publication"],
    to: ["claim"],
    group: "system",
    description:
      "Internal provenance only. Recipients cannot traverse it to retrieve a private claim or source.",
  },
];
export const ontology = {
  version: "1.1.0",
  representation:
    "Evidence-backed property graph; JSON schema validation, no OWL reasoner",
  types: typeDefinitions,
  relationships: relationshipDefinitions,
  rules: [
    "Private by default; membership is not sharing consent.",
    "Stable keys are scoped to the author; names do not merge people or projects.",
    "Entity properties describe identity. Changing states, deadlines and preferences are claims.",
    "A shared claim is a snapshot; source revisions do not silently republish it.",
    "Evidence is an attributed excerpt, not independent verification.",
    "Forgetting a source removes its claims and publications. Retraction stops future reads.",
  ],
};

const timestamp = z.string().datetime({ offset: true });
export const knowledgeEntity = z
  .object({
    key: z.string().trim().min(1).max(120),
    type: z.enum(entityTypes),
    name: z.string().trim().min(1).max(120),
    aliases: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
    properties: z
      .record(z.string(), z.string().trim().min(1).max(1000))
      .default({}),
  })
  .strict()
  .superRefine((entity, ctx) => {
    const allowed = typeDefinitions
      .find((t) => t.id === entity.type)!
      .properties.filter((p) => !["key", "name", "aliases"].includes(p.name));
    for (const key of Object.keys(entity.properties))
      if (!allowed.some((p) => p.name === key))
        ctx.addIssue({
          code: "custom",
          path: ["properties", key],
          message: `Property ${key} is not allowed on ${entity.type}`,
        });
  });
const predicates = relationshipDefinitions
  .filter((r) => r.group === "assertion")
  .map((r) => r.id) as [string, ...string[]];
export const knowledgeInput = z
  .object({
    sourceMemoryId: z.string().min(1),
    sourceRevision: z.number().int().min(1),
    idempotencyKey: z.string().min(8).max(200),
    entities: z.array(knowledgeEntity).min(1).max(24),
    claims: z
      .array(
        z
          .object({
            subject: z.string().min(1).max(120),
            predicate: z.enum(predicates),
            object: z.string().min(1).max(120).optional(),
            value: z.string().trim().min(1).max(1000).optional(),
            evidence: z.string().trim().min(1).max(2000),
            basis: z.enum(["explicit", "observed", "inferred"]),
            status: z.enum(["active", "disputed"]).default("active"),
            validFrom: timestamp.optional(),
            validUntil: timestamp.optional(),
            supersedes: z.string().min(1).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((input, ctx) => {
    const entities = new Map(input.entities.map((e) => [e.key, e]));
    if (entities.size !== input.entities.length)
      ctx.addIssue({
        code: "custom",
        path: ["entities"],
        message: "Entity keys must be unique",
      });
    const replacements = input.claims.flatMap((c) =>
      c.supersedes ? [c.supersedes] : [],
    );
    if (new Set(replacements).size !== replacements.length)
      ctx.addIssue({
        code: "custom",
        path: ["claims"],
        message: "A claim may be superseded only once per operation",
      });
    input.claims.forEach((c, i) => {
      const r = relationshipDefinitions.find((r) => r.id === c.predicate)!;
      const fail = (message: string) =>
        ctx.addIssue({ code: "custom", path: ["claims", i], message });
      if (!r.from.includes(entities.get(c.subject)?.type ?? ""))
        fail("Subject type is not allowed for this predicate");
      if (r.value) {
        if (c.object !== undefined || !c.value)
          fail("This predicate requires a value and no object");
        if (
          r.value.type === "decimal" &&
          !/^(0|[1-9]\d{0,14})(\.\d{1,6})?$/.test(c.value ?? "")
        )
          fail("Amount must be an exact nonnegative decimal string");
        if (
          r.value.type === "currency" &&
          !Intl.supportedValuesOf("currency").includes(c.value ?? "")
        )
          fail("Currency must be a recognized ISO 4217 code");
        if (r.value.values && !r.value.values.includes(c.value ?? ""))
          fail("Value is outside the allowed enum");
        if (
          r.value.type === "datetime" &&
          !timestamp.safeParse(c.value).success
        )
          fail("Value must be an ISO timestamp with timezone");
      } else if (
        c.value !== undefined ||
        !r.to.includes(entities.get(c.object ?? "")?.type ?? "")
      )
        fail("Object type is not allowed for this predicate");
      if (
        c.validFrom &&
        c.validUntil &&
        Date.parse(c.validUntil) <= Date.parse(c.validFrom)
      )
        fail("validUntil must be after validFrom");
      if (c.predicate === "DEPENDS_ON" && c.subject === c.object)
        fail("A task cannot depend on itself");
    });
  });
export type KnowledgeInput = z.infer<typeof knowledgeInput>;
export const knowledgeQuery = z
  .object({
    query: z.string().max(1000).default(""),
    spaceId: z.string().min(1).optional(),
    personalOnly: z.boolean().default(false),
    entityId: z.string().min(1).optional(),
    predicate: z.enum(predicates).optional(),
    asOf: timestamp.optional(),
    includeHistory: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(20),
  })
  .strict()
  .refine(
    (i) => !(i.personalOnly && i.spaceId),
    "Choose personalOnly or a space, not both",
  );
