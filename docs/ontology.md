# Everyday ontology 1.1

The [everyday-memory research and schema](everyday-memory-research.md) describes the general personal-agent model and measured retrieval behavior. The default Ontology view is the saved knowledge graph; Schema opens the type/relationship catalog.

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
