# Everyday ontology 1.1

The [everyday-memory research and schema](everyday-memory-research.md) describes the general personal-agent model and measured retrieval behavior. The default Ontology view is the saved knowledge graph; Schema opens the type/relationship catalog. Entity cards use class-style compartments: the type and instance name form the header, while literal values (including preferences, amounts, statuses and dates) appear as selectable attributes inside the card. Arrows connect entities only. Selecting an attribute shows its original claim evidence and attribution; it does not turn a claim into a mutable entity property. Multiple claims remain separate rows.

The authenticated dashboard's Ontology tab and MCP `get_ontology` tool expose the registry in `src/ontology.ts`. Domain types, allowed entity properties, predicate endpoints and literal enums are validated by `record_knowledge`. The catalog describes the semantic memory model, not the internal delivery, OAuth or profile-store schemas. System properties are assigned by their owning server operations, not arbitrary agent updates.

## Save and retrieve

1. Save a useful source through `remember`, preserving its evidence and returned revision. Existing unstructured memories remain valid.
2. Read `get_ontology`. Resolve entities against `recall_knowledge`; reuse their author-scoped keys rather than matching by name alone.
3. Use `record_knowledge` with `sourceMemoryId`, `sourceRevision`, a stable `idempotencyKey`, typed `entities` and `claims`. The evidence of every claim must be an exact excerpt of that source's text or evidence. A quote's presence does not prove it entails the claim; extraction remains the agent's responsibility. The server validates structure and provenance, not real-world truth.
4. Retrieve through `recall_knowledge` with optional query, predicate, entity ID, space ID and validity-time filters. Standard `recall` also includes a `knowledge` packet, alongside its existing memory results.

Example input to `record_knowledge` after saving the user statement “OAuth setup is complete. Connector tests depend on OAuth setup.”:

```json
{
  "sourceMemoryId": "RETURNED_MEMORY_ID",
  "sourceRevision": 1,
  "idempotencyKey": "ontology-example-001",
  "entities": [
    {"key":"task:oauth","type":"task","name":"OAuth setup","aliases":["login setup"]},
    {"key":"task:connector-tests","type":"task","name":"Connector tests"}
  ],
  "claims": [
    {"subject":"task:oauth","predicate":"HAS_STATUS","value":"completed","basis":"explicit","evidence":"OAuth setup is complete."},
    {"subject":"task:connector-tests","predicate":"DEPENDS_ON","object":"task:oauth","basis":"explicit","evidence":"Connector tests depend on OAuth setup."}
  ]
}
```

Do not record this example as a real user fact. Agent-generated illustrative tasks are not user commitments. Assignment, acceptance and completion are separate predicates. Observed evidence cannot be relabeled as an explicit user statement. Inferences remain labeled and cannot supersede explicit/observed assertions.

## Identity, time and correction

- Entities use explicit author-scoped keys. Two people using the same key or name do not merge their entities. Aliases aid authorized retrieval but never authenticate a mentioned person. Mentioned people are separate from account membership.
- Entity identity descriptions are snapshots on assertions. Status, deadlines and changing preferences are claims, not mutable global properties. A claim has links to subject/object entities and its source memory, with predicate and payload stored on `KnowledgeClaim`.
- `recordedAt` is capture time. Optional `validFrom`/`validUntil` are applicability bounds; `validUntil` is exclusive. `DUE_AT` and `OCCURRED_AT` require timezone-qualified timestamps. Missing validity remains unknown. `asOf` filters known bounds; `includeHistory` exposes earlier assertions, not a reconstructed historical truth.
- A correction explicitly identifies `supersedes`. Only the same author can supersede a claim about the same scoped subject and predicate. Other authors' differing reports remain attributed statements. Concurrent replacement attempts use a graph-side status check.
- Revising a source excludes its older claims from default private retrieval until the agent structures the new revision. History remains available to the author. A revised source does not automatically reinterpret or migrate its old claims.

## Sharing

Use `publish_claim` with a selected authored claim ID, authorized space ID, `userRequested: true` and stable operation key. A publication is immutable: it contains only that assertion, its exact excerpt, attribution and entity type/name. Private aliases, entity descriptions, source memory IDs, adjacent text and supersession IDs are omitted. Space-specific entity IDs let publications from one author's same entity connect, without implicitly merging different people's entities.

Read it through `recall_knowledge({"spaceId":"SPACE_ID"})` or Ontology → the selected space. Active membership is required on every read. Publishing a claim does not grant access to its private source memory. It currently has no event/webhook notification; receipts explicitly report `on_demand_only`.

Set `enabled:false` to retract by the original claim ID or returned publication ID. Retries cannot reactivate withdrawn snapshots. To publish a new version, record and select a new claim. Source edits or supersession do not silently change existing snapshots, which are labeled with their publication time and source revision. Forgetting the source scrubs all its claim/publication payloads and withdraws publications. Account deletion uses the same cleanup. Content already received by another host cannot be recalled.

The existing `share_memory` path still shares a live **whole-memory reference**, with its existing revision notifications and sharing rules. Do not use it when the user selected only one claim. It is a separate permission and lifecycle from ontology publications.

## First-version limits

Extraction is performed by the connected agent, with server-side validation; there is no background extraction worker or automatic reinterpretation of old ABOUT claims. Retrieval combines FalkorDB full-text and Gemini semantic vectors with bounded one-hop expansion. Embeddings require a configured private provider key; failures and missing configuration are reported as semanticSearch states. `index_knowledge` builds missing search documents for bounded batches of current authored claims without changing their meaning. See the research guide for exact retrieval windows, evaluation and scale limits. No cross-author reconciliation, automatic balance calculation or formal OWL inference is implied.

Storage changes are additive indexes and new labels (`KnowledgeEntity`, `KnowledgeClaim`, `KnowledgeBatch`, `Publication`, `KnowledgeSearchDocument`); existing graph records are preserved. The existing source `forget_memory` operation additionally scrubs its derived payloads. No hosted backfill or data migration is needed for this version. Develop and verify in sandbox before any authorized production release.

## Automatic structuring on save

`remember` and `revise_memory` now run ontology extraction on the server; Muse, Dot and other clients do not need a separate `record_knowledge` call. A durable `OntologyJob` is created atomically with each source revision in FalkorDB. The model receives the source, live domain schema and a bounded set of matching entities/context from that author's private current claims (or that same source's prior revision). It receives no other author's private graph or space publications. It has no tools or write permissions. OpenRouter generates the structured proposal outside FalkorDB; all persistent jobs, source revisions, claims and indexes remain in FalkorDB.

The proposal is validated locally for allowed entity types, relationship endpoints, literal values, exact source evidence and the current source revision. Invalid individual claims are omitted and counted in `omittedClaims`; if all proposed claims fail validation the job stays pending for a retry. Currency claims additionally require the explicit ISO code in the source; ambiguous "dollars" stays unknown. Automatic claims use the source's explicit/observed basis, never inferred facts. Negations, hypotheticals and unsupported details stay in the source text. These are model-generated assertions, not independently verified truth; schema validity and an exact supporting excerpt cannot prove the model interpreted the sentence correctly.

Save receipts include `ontology.status`: `structured` with claim IDs, `no_supported_claims`, `pending` with `retryScheduled`, `not_configured`, or `superseded` if the source changed during processing. A pending extraction does not undo a source save. The persistent worker checks every 5 seconds and retries with exponential backoff, capped at 5 attempts per revision; an exhausted job remains pending with `retryScheduled:false` for operator inspection. Restarting resumes eligible jobs. A 120-second lease prevents concurrent workers/retries from duplicating model work. Validated plans are retained during a failed write so retries use the same batch input and stable key. Successful and empty results do not call the model again. Source corrections create a new job; stale source jobs cannot write current claims. Forgetting scrubs all job plans, source content and derived claims/publications.

New identities receive author-scoped, source-specific keys; first-person references use a stable author-scoped `auto:self` key. Existing identity reuse requires a same-source revision or a distinguishing existing relationship context in an exact new-source excerpt. Names alone are insufficient; uncertain matches stay separate rather than silently joining two people. Matching is bounded to the most recent 300 current/same-source claims and 40 candidate entities, so older identities or sparse context can produce separate nodes that need deliberate reconciliation. Extraction is capped at 24 entities and 20 claims per source. Manual `record_knowledge` remains available for additions/corrections; agents should not duplicate successful automatic results. Existing manually structured old sources are not reinterpreted in bulk.

This process does not publish claims, enable sharing rules, or send messages. Existing user-enabled whole-memory sharing rules still apply separately, and their receipts remain under `automaticShares`.
