# Everyday personal memory: schema and retrieval

This design serves everyday personal assistants across hosts such as Dot, Muse and other bots. The illustrative notes and benchmark fixtures are tests, not the source of the schema. No host can save, retrieve or notify beyond its actual authorized MCP capabilities.

## Research and decision

The recurring pattern is hybrid retrieval: semantic relevance plus exact words plus graph context. Graphiti documents this combination and lets applications validate custom entity and edge schemas. Mem0's open-source Graph Memory pairs vector retrieval with relationship context. Their implementations differ; these are useful design precedents, not a universal standard or evidence that all systems implement the same pipeline.

- [Graphiti project](https://github.com/getzep/graphiti): hybrid retrieval and temporal graph memory.
- [Graphiti custom types](https://help.getzep.com/graphiti/core-concepts/custom-entity-and-edge-types): validation of domain-specific entities, relationships and their endpoints.
- [Mem0 open-source Graph Memory](https://docs.mem0.ai/open-source/features/graph-memory): entity/relationship extraction, embeddings and graph context.
- [Schema.org Person](https://schema.org/Person) and [Event](https://schema.org/Event): useful reference vocabulary for employment, social links, places and participants. We do not import their full vocabularies or claim conformance.
- [W3C n-ary relation design note](https://www.w3.org/TR/swbp-n-aryRelations/): an instance representing a relationship can keep its participants and attributes together. This informs distinct obligation instances, avoiding one undifferentiated debt edge between two people.

### Why no OWL?

This is an evidence-backed property graph in FalkorDB, with a versioned JSON/Zod contract. It is not RDF, OWL, an OWL reasoner, or SHACL. [OWL 2](https://www.w3.org/TR/owl2-overview/) provides formal classes/properties and logical semantics. Such reasoning does not replace natural-language semantic retrieval. Explicitly scoped claims, provenance and privacy are more immediately useful here; a future RDF/OWL export would need a real mapping and tested semantics. No automatic symmetric relations, transitive access, inferred commitments or conflict resolution are implied.

## Implemented schema 1.1.0

Thirteen domain types:

| Family | Types | What to represent |
|---|---|---|
| Identity and context | person, organization, place, topic | Who/where/what; names are not identity or access rights |
| Intent and work | project, task, goal, decision | An ongoing effort, accountable work item, desired outcome, or attributed choice |
| Experiences and habits | event, routine, preference | Particular occurrences, recurring activities, and contextual preferences |
| Possessions and obligations | item, obligation | Products/documents/services and distinct reported debts |

All domain entities accept `key`, `name`, optional `aliases`, and optional `properties.description`. Preferences also accept `properties.context`. Keys are author-scoped and names do not silently merge identities. Descriptions are identity context, not a place to hide changing states.

The server registry at `src/ontology.ts` and live `get_ontology` are authoritative for exact allowed endpoints and values. The dashboard's Schema drawer reads that same registry.

| Family | Relations and literal predicates |
|---|---|
| Social and family | KNOWS, FRIEND_OF, FAMILY_OF, PARENT_OF, SIBLING_OF, PARTNER_OF, COLLEAGUE_OF, REPORTS_TO |
| Work and learning | WORKS_AT, STUDIES_AT, MEMBER_OF_ORGANIZATION, WORKS_ON, HAS_SKILL, HAS_ROLE |
| Places and plans | LIVES_IN, LOCATED_AT, HAS_PARTICIPANT, ORGANIZED_BY, STARTS_AT, ENDS_AT, OCCURRED_AT |
| Desires and concerns | WANTS, CONCERNED_ABOUT, CONTRIBUTES_TO |
| Accountable work | PART_OF, ASSIGNED_TO, ACCEPTED_BY, COMPLETED_BY, DEPENDS_ON, HAS_STATUS, DUE_AT |
| Preferences and habits | PREFERENCE_OF, APPLIES_TO, HAS_VALUE, LIKES, DISLIKES, PRACTICES, HAS_FREQUENCY |
| Choices | DECIDED_BY, HAS_REASON |
| Possessions/services | OWNS, USES |
| Money | OWES, OWED_TO, FOR_CONTEXT, HAS_AMOUNT, HAS_CURRENCY, HAS_PAYMENT_STATUS |
| Fallback | ABOUT only when no precise supported relation fits |

Examples independent of any real user's facts:

- Person → WORKS_AT → Organization; Person → WANTS → Goal. A desired career move never establishes new employment.
- Event → HAS_PARTICIPANT → Person and Event → LOCATED_AT → Place. Visiting never implies residence; participation does not prove attendance.
- Task → ASSIGNED_TO → Person is different from ACCEPTED_BY and COMPLETED_BY.
- Preference → PREFERENCE_OF → Person; APPLIES_TO → Topic; HAS_VALUE → literal. A contextual preference is not automatically universal.
- Person → PRACTICES → Routine; Routine → HAS_FREQUENCY → reported recurrence. This does not register a reminder.
- Debtor → OWES → Obligation → OWED_TO → Creditor. HAS_AMOUNT is an exact decimal string; HAS_CURRENCY is an explicitly known ISO currency. FOR_CONTEXT links purchase/activity context. Separate debts have separate keys. Repayments need new evidence; this is not a transaction ledger or an inferred balance.

System types remain Account, Memory, Revision, Claim, Space and Publication. A claim has subject, predicate, object OR literal value, evidence, basis, author, exact source revision, status, capture time and optional validity bounds. Claims remain individually attributed assertions, not automatically established truth. Shared publications are selected, frozen projections with separate IDs and scope.

Unsupported negatives, hypotheticals and ambiguity remain in source text; agents must not convert them to affirmative claims. There is no automatic source re-interpretation, entity resolution across authors, age inference, clinical diagnosis, or acceptance of obligations.

## Storage and retrieval

Every durable search artifact stays in the existing FalkorDB memory graph. Gemini generates vectors through OpenRouter or the direct Gemini API; it is not a second memory/vector database. Text submitted for embedding is processed by the configured provider. New KnowledgeSearchDocument nodes link via INDEXES to either a private claim or a frozen publication. Each document contains only its permitted text projection, model/format signature, content hash and vector.

[Gemini Embedding 2](https://ai.google.dev/gemini-api/docs/embeddings) supports reduced dimensions. We use 768 and normalize vectors. Retrieval documents and queries use the model's documented asymmetric text prefixes; Embedding 2 does not use Embedding 001's taskType field. The OpenRouter model is `google/gemini-embedding-2` via its [embeddings endpoint](https://openrouter.ai/docs/api/api-reference/embeddings/create-embeddings). There is one input per request, avoiding accidental aggregation of separate facts.

1. Validate and save evidence-backed claims. Independently create search documents; a provider failure leaves the source saved and reports pending indexing.
2. Author/space-scoped labels give each authorized namespace its own full-text and vector index. Labels are server-generated hashes, never user-injected Cypher. The signature includes provider/model/dimensions/prompt format, so incompatible spaces are not mixed.
3. Recall checks current authorization and fetches scoped full-text and vector candidates. Every returned hit is checked against current membership, active publication, source deletion and revision/state.
4. Fuse lexical and semantic rankings using reciprocal-rank fusion (k=60), then retrieve bounded one-hop neighbors through scoped entity IDs. Predicates and known validity bounds still filter the output.
5. Return provenance, retrieval reason, semantic availability and truncation. Similarity is a relevance signal, never a truth confidence.

### Implemented optimizations and costs

- **768 float32 dimensions:** approximately 3 KiB raw vector data per claim/projection, versus 12 KiB at 3072; index, text and graph overhead are additional. Quality must be measured on our queries.
- **Native HNSW:** M=16, efConstruction=200, efRuntime=100. These are initial balanced settings, not load-tested optima. [FalkorDB vector docs](https://docs.falkordb.com/cypher/indexing/vector-index).
- **Distance direction tested:** this pinned FalkorDB returns cosine distance in the procedure's `score` column; lower is better. Semantic cutoff is distance ≤0.32 (cosine similarity ≥0.68), an initial heuristic, not a universally calibrated threshold.
- **Native full-text search:** indexed exact words and stemming alongside semantic candidates. Full-text is TF-IDF-style relevance, not a claim that the implementation is BM25. [FalkorDB full-text docs](https://docs.falkordb.com/cypher/indexing/fulltext-index).
- **Scoped ANN namespaces:** other users' nearest vectors do not crowd an owner's results. Per-scope indexes increase administrative/memory overhead; benchmark this before many thousands of scopes.
- **Guarded exact-vector fallback:** when too few current ANN hits survive, FalkorDB evaluates eligible scoped vectors exactly, preventing stale revisions from starving valid hits. This fallback is linear in scope size; measure its frequency before scaling.
- **Content hashes and stable retries:** unchanged documents are not re-embedded. Capture is durable even when indexing fails. Batches run at most three provider calls concurrently.
- **Blank and explicit entity requests:** no query embedding is requested. Graph view avoids paying for embeddings just to open it.
- **Bounded retrieval:** recent listing window 500 private/500 shared; indexed candidates can find older indexed claims outside it. Full-text cap 201 per scope, ANN cap 200/100 surviving results, one-hop expansion 201 per path, output at most 200. Truncation is exposed. This is not exhaustive multi-hop reasoning or automatic whole-graph search.
- **No semantic-embedding cache of user query text:** no added cross-user cache or stale permission-bearing cached result. Scoped identity and permission checks remain in each graph query.
- **Deletion/retraction:** forgetting deletes related search text/vectors; retraction removes publication search documents. Reads independently deny deleted, retracted, revoked and revised records. In-flight writes recheck source and permission graph-side.
- **Lazy frontend graph chunk:** graph rendering code loads when its tab is opened. React Flow provides pan, zoom, dragging, keyboard selection and labeled directed edges; Dagre provides deterministic initial layout.

## Evaluation and limitations

`node scripts/benchmark-knowledge.mjs` (after a server build, with privately configured embedding credentials) creates synthetic data in a unique LOCAL graph, compares the existing text-memory recall with hybrid claim retrieval and deletes its graph. It rejects non-loopback database hosts. Do not point tests/benchmarks at hosted databases.

Initial ten-question test: 10/10 expected sources among the top five hybrid seeds versus 3/10 for existing text search. Nine expected sources ranked first, one second. Query HTTP+retrieval latencies were roughly 0.63–1.09 seconds locally with a remote embedding provider. Different storage units and graph structure make this an end-to-end regression comparison, not an isolated embedding-quality experiment. Small hand-authored fixtures do not establish production accuracy, recall or scale. The agent still needs to interpret the returned evidence; a paraphrase hit does not prove identity, current employment, payment or consent.

Automated graph tests separately check vectors and full-text in real FalkorDB, scope isolation, shared snapshot projection, revoked access, old source revisions, retraction, idempotence and forgetting. Synthetic deterministic vectors verify database behavior; they do not measure real model semantics. Provider errors are sanitized, and missing credentials preserve keyword retrieval.

Future optimizations that are NOT implemented: learned reranking, calibrated per-query thresholds, paginated whole-graph browsing, vector-first graph partitioning at large scale, multihop query planning, transactional outbox workers for embeddings, proactive compaction/conflict resolution and RDF/OWL export. Add them only with measured failures and regression fixtures.
