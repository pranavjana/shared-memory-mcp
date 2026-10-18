# Cypher queries and graph algorithms

This page lists the FalkorDB queries Shared Memory depends on, what each one does, and why it needs a graph. Every query is parameterized (`$user`, `$id`, …); user input is never concatenated into Cypher. Line references are to `codex/development` at commit `a346abc`.

The core read queries are also in [`cypher/`](../cypher) as standalone files, and `npm run graph:demo` runs them against a small sample graph and prints each result with its execution plan. See [Run it yourself](#run-it-yourself).

## In one minute

- Every memory, person, space, share, claim and search document is a node or edge in one FalkorDB graph.
- **Permissions are graph paths.** You can read a memory only if you wrote it, or if an active path connects you to it: `You -MEMBER_OF→ Space ←SHARED_IN- Memory`. This check runs on every read.
- **Recall follows edges.** After finding memories by keyword, it hops through shared entities and shared spaces to find related memories, even ones with no matching words.
- **Search runs inside FalkorDB.** Structured claims are found with FalkorDB's full-text index and HNSW vector index, filtered by the same permission paths, then neighbours are pulled in by a one-hop graph expansion.
- **Teammates meet at one node.** Inside a space, every author's mentions of the same member resolve to a single `KnowledgeEntity`, so facts about a person collect in one place.

If FalkorDB is removed, the product cannot decide who may read what, cannot find related context, and cannot search claims.

## Graph model

```mermaid
graph LR
  Person -- AUTHORED --> Memory
  Memory -- HAS_REVISION --> Revision
  Memory -- ABOUT --> Entity
  Person -- "MEMBER_OF {active, role}" --> Space
  Memory -- "SHARED_IN {active}" --> Space
  Invitation -- FOR_SPACE --> Space
  KnowledgeClaim -- SUPPORTED_BY --> Memory
  KnowledgeClaim -- BASED_ON --> Revision
  KnowledgeClaim -- SUBJECT --> KnowledgeEntity
  KnowledgeClaim -- OBJECT --> KnowledgeEntity
  KnowledgeClaim -- SUPERSEDES --> KnowledgeClaim
  KnowledgeBatch -- CONTAINS --> KnowledgeClaim
  Publication -- DERIVED_FROM --> KnowledgeClaim
  Publication -- PUBLISHED_IN --> Space
  Publication -- "SUBJECT, OBJECT" --> KnowledgeEntity
  KnowledgeSearchDocument -- INDEXES --> KnowledgeClaim
  KnowledgeSearchDocument -- INDEXES --> Publication
  OntologyJob -- SUPPORTED_BY --> Memory
  KnowledgeClaim -. "predicate id" .-> OntologyPredicate
```

| Node | What it is |
|---|---|
| `Person` | A signed-in account (Clerk user ID). All of a person's assistants act as this one node. |
| `Memory` | One saved statement or outcome, with kind, text, evidence, owner and current revision number. |
| `Revision` | An immutable earlier version of a memory. Only the author can read history. |
| `Entity` | A person, project, place or topic a memory is about. IDs are hashed with the owner's ID (`src/memory.ts:195`), so two users' "OAuth" are different nodes. |
| `Space` | A shared space. Members join through `Invitation` nodes. |
| `KnowledgeClaim` | A typed fact extracted from a memory, e.g. `task:oauth HAS_STATUS completed`, with the exact evidence quote. |
| `KnowledgeEntity` | The subject or object of a claim. Private entities are scoped to their owner. In a space, a person mention that names one member resolves to that member's single node (§10). |
| `Publication` | A frozen snapshot of a claim shared into a space. |
| `KnowledgeSearchDocument` | Search text and embedding for a claim or publication, in a per-scope index label. |
| `OntologyJob` | A queued background extraction for one memory revision. |
| `OntologyPredicate` | A relationship type proposed by extraction when no core type fits. Starts provisional until an admin approves, rejects or merges it (§11). |
| `Change` | An audit record of a share, retraction, revision or publication in a space. |
| `Connection`, `SharingRule` | A connected assistant (revocable) and an automatic sharing rule. |

Every label above except `OntologyPredicate` has a range index and a unique constraint on `id` (`src/memory.ts:131`, also in [`cypher/schema.cypher`](../cypher/schema.cypher)). Account profiles live in a separate graph (`FALKORDB_GRAPH`, `User {clerkId}`, `src/users.ts`); everything on this page is in the memory graph (`FALKORDB_MEMORY_GRAPH`).

---

## 1. Permission check

`src/memory.ts:92`, appended to every memory read.

```cypher
OPTIONAL MATCH (m)-[:SHARED_IN {active:true}]->(:Space)<-[membership:MEMBER_OF {active:true}]-(:Person {id:$user})
WITH m, count(membership) AS memberships
WHERE m.deletedAt IS NULL AND (m.owner = $user OR memberships > 0)
```

**What it does:** keeps a memory only if it isn't deleted and you either own it or there is at least one active path from you, through a space, to it.

**Why a graph:** access is a path, not a column. Revoking a member or retracting a share flips one edge's `active` flag, and the very next read stops returning the memory. Nothing is copied to other users, so there is nothing to clean up.

## 2. Saving a memory (`remember`)

`src/memory.ts:205`

```cypher
MERGE (p:Person {id:$user}) SET p.name = $name
MERGE (m:Memory {id:$id}) ON CREATE SET m.owner = $user, m.text = $text, m.kind = $kind, …, m.revision = 1, m.requestHash = $hash
WITH p, m WHERE m.deletedAt IS NULL AND m.requestHash = $hash
MERGE (p)-[:AUTHORED]->(m)
MERGE (r:Revision {id:$revisionId}) ON CREATE SET r.text = m.text, …, r.revision = 1
MERGE (m)-[:HAS_REVISION]->(r)
MERGE (job:OntologyJob {id:$revisionId}) ON CREATE SET job.owner = $user, job.status = 'pending', …
MERGE (job)-[:SUPPORTED_BY]->(m)
FOREACH (i IN range(0, size($entityIds)-1) |
  MERGE (e:Entity {id:$entityIds[i]}) ON CREATE SET e.name = $names[i], e.kind = $types[i]
  MERGE (m)-[:ABOUT]->(e))
RETURN properties(m) AS value
```

**What it does:** in one atomic query, creates the memory, its first revision, its `ABOUT` links to entities, and a background extraction job.

**Safe retries:** the memory ID is derived from the user and an idempotency key, so a retried request finds the same node instead of creating a duplicate. If the same key is reused with different content, the `requestHash` check returns no row and the API answers 409.

## 3. Recall and graph expansion (`recall`)

`src/memory.ts:254–269`

**Step 1: find seed memories by keyword**, filtered by the permission check.

```cypher
MATCH (m:Memory) <permission check>
  AND (size($terms) = 0 OR any(t IN $terms WHERE toLower(m.text) CONTAINS t
       OR toLower(m.entities) CONTAINS t OR toLower(m.authorName) CONTAINS t))
RETURN properties(m) AS value ORDER BY m.updatedAt DESC LIMIT $limit
```

**Step 2: hop through shared entities** to memories about the same thing.

```cypher
MATCH (seed:Memory)-[:ABOUT]->(e:Entity)<-[:ABOUT]-(m:Memory)
WHERE seed.id IN $ids AND NOT m.id IN $ids
WITH DISTINCT m, e <permission check>
RETURN DISTINCT properties(m) AS value, e.name AS entity ORDER BY m.updatedAt DESC LIMIT 10
```

**Step 3: hop through shared spaces** to other memories in the same space.

```cypher
MATCH (seed:Memory)-[:SHARED_IN {active:true}]->(s:Space)<-[:SHARED_IN {active:true}]-(m:Memory)
WHERE seed.id IN $ids AND NOT m.id IN $ids
WITH DISTINCT m, s <permission check>
RETURN DISTINCT properties(m) AS value, s.name AS entity ORDER BY m.updatedAt DESC LIMIT 10
```

**Why a graph:** steps 2 and 3 return related memories that share no words with the query. Each result says why it was included ("Connected through OAuth"). Every hop re-applies the permission check, so expansion can never reach a memory you couldn't read directly.

## 4. Correcting a memory (`revise_memory`)

`src/memory.ts:340`

```cypher
MATCH (m:Memory {id:$id}) WHERE m.owner = $user AND m.deletedAt IS NULL AND m.revision = $expected
SET m.text = $text, …, m.revision = $rev
CREATE (r:Revision {id:$rid, …, revision:$rev})
CREATE (m)-[:HAS_REVISION]->(r)
CREATE (job:OntologyJob {id:$rid, …}) CREATE (job)-[:SUPPORTED_BY]->(m)
WITH m OPTIONAL MATCH (m)-[link:ABOUT]->(:Entity) DELETE link
WITH DISTINCT m
FOREACH (i IN range(0, size($entityIds)-1) | MERGE (e:Entity {id:$entityIds[i]}) … MERGE (m)-[:ABOUT]->(e))
WITH m OPTIONAL MATCH (m)-[:SHARED_IN {active:true}]->(s:Space)
FOREACH (space IN CASE WHEN s IS NULL THEN [] ELSE [s] END |
  MERGE (c:Change {id:$rid + ':' + space.id}) ON CREATE SET c.kind = 'revised', …)
RETURN DISTINCT properties(m) AS value
```

**What it does:** a compare-and-swap. The update only applies if the memory is still at the revision the caller last saw (`m.revision = $expected`). Two assistants correcting the same memory at once cannot overwrite each other; the loser gets a 409 and must re-read. The query also rewires `ABOUT` edges, queues re-extraction, and writes a `Change` record into every space the memory is shared in.

## 5. Forgetting a memory (`forget_memory`)

`src/memory.ts:397–421`

```cypher
MATCH (m:Memory {id:$id}) WHERE m.owner = $user
OPTIONAL MATCH (m)-[:HAS_REVISION]->(r:Revision)
SET r.text = NULL, r.evidence = NULL, …, m.text = NULL, m.evidence = NULL, m.deletedAt = $now
WITH DISTINCT m OPTIONAL MATCH (m)-[share:SHARED_IN]->(:Space) SET share.active = false
WITH DISTINCT m OPTIONAL MATCH (m)-[link:ABOUT]->(:Entity) DELETE link
WITH DISTINCT m OPTIONAL MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m)
SET c.payload = NULL, c.status = 'forgotten'
WITH DISTINCT c OPTIONAL MATCH (p:Publication)-[:DERIVED_FROM]->(c)
SET p.payload = NULL, p.active = false
```

Then three follow-up queries: mark the memory's `OntologyJob` as forgotten, `DETACH DELETE` the `KnowledgeSearchDocument` nodes reachable through its claims and publications, and remove entities nothing points to any more:

```cypher
MATCH (e:Entity) OPTIONAL MATCH (m:Memory)-[:ABOUT]->(e)
WITH e, count(m) AS refs WHERE refs = 0 DELETE e
```

**Why a graph:** "forget" has to reach everything derived from the memory: revisions, shares, extracted claims, published snapshots and search documents. The query walks those edges out from the memory, so nothing derived is left behind. Minimal IDs and timestamps remain for audit.

## 6. Spaces and sharing

**Accepting an invitation** (`src/memory.ts:516`)

```cypher
MATCH (i:Invitation {id:$id})-[:FOR_SPACE]->(s:Space)
WHERE i.email = $email AND i.expiresAt > $now AND (i.acceptedBy IS NULL OR i.acceptedBy = $user)
MERGE (p:Person {id:$user}) SET p.name = $personName
MERGE (p)-[member:MEMBER_OF]->(s)
ON CREATE SET member.active = true, member.role = i.role, member.joinedAt = $now
WITH i, s, p, member WHERE i.acceptedBy IS NULL OR member.active = true
FOREACH (_ IN CASE WHEN i.acceptedBy IS NULL AND member.role <> 'owner' THEN [1] ELSE [] END |
  SET member.active = true, member.role = i.role, member.joinedAt = $now)
SET i.acceptedBy = $user RETURN properties(s) AS value
```

The invitation must match your verified email and be unexpired. An already-used invitation link cannot re-activate a member who was revoked; that needs a fresh invitation.

**Sharing a memory** (`src/memory.ts:583`)

```cypher
MATCH (m:Memory {id:$id}), (p:Person {id:$user})-[member:MEMBER_OF {active:true}]->(s:Space {id:$space})
WHERE m.owner = $user AND m.deletedAt IS NULL AND ($enabled = false OR member.role IN ['owner','contributor'])
MERGE (m)-[share:SHARED_IN]->(s)
MERGE (c:Change {id:$event}) ON CREATE SET c.kind = $kind, …
FOREACH (_ IN CASE WHEN c.applied IS NULL THEN [1] ELSE [] END |
  SET share.active = $enabled, share.updatedAt = $now, c.applied = true)
RETURN m.id AS id
```

Only the author can share, only owners and contributors can add to a space, and the `Change` node's `applied` flag makes a retried share or retraction take effect exactly once.

**Reading a space's feed** (`src/memory.ts:462`)

```cypher
MATCH (:Person {id:$user})-[:MEMBER_OF {active:true}]->(s:Space {id:$space})<-[:SHARED_IN {active:true}]-(m:Memory)
WHERE m.deletedAt IS NULL AND ($before IS NULL OR m.updatedAt < $before OR (m.updatedAt = $before AND m.id < $beforeId))
WITH DISTINCT m RETURN properties(m) AS value ORDER BY m.updatedAt DESC, m.id DESC LIMIT $limit
```

The membership path is the query's starting point, so a non-member gets nothing. Pages use a keyset cursor (`updatedAt`, `id`) so results don't shift while new memories arrive.

## 7. The knowledge layer (claims)

### Recording claims (`record_knowledge`)

`src/knowledge.ts:219`

```cypher
MATCH (m:Memory {id:$memory})-[:HAS_REVISION]->(revision:Revision)
WHERE m.owner = $user AND m.deletedAt IS NULL AND m.revision = $revision AND revision.revision = $revision
OPTIONAL MATCH (old:KnowledgeClaim) WHERE old.id IN $supersedes AND old.owner = $user AND old.status IN ['active','disputed']
WITH m, revision, collect(old) AS olds WHERE size(olds) = $oldCount
MERGE (b:KnowledgeBatch {id:$batch}) ON CREATE SET b.requestHash = $hash, b.owner = $user
WITH m, revision, b, olds WHERE b.requestHash = $hash
FOREACH (old IN olds | SET old.status = 'superseded')
MERGE (b)-[:SUPPORTED_BY]->(m)
WITH m, revision, b UNWIND $claims AS item
MERGE (c:KnowledgeClaim {id:item.id}) ON CREATE SET c.owner = $user, c.predicate = item.predicate, …, c.sourceRevision = $revision
MERGE (c)-[:SUPPORTED_BY]->(m) MERGE (c)-[:BASED_ON]->(revision) MERGE (b)-[:CONTAINS]->(c)
MERGE (subject:KnowledgeEntity {id:item.subjectId}) ON CREATE SET subject.owner = $user, subject.kind = item.subjectType
MERGE (c)-[:SUBJECT]->(subject)
FOREACH (_ IN CASE WHEN item.objectId = '' THEN [] ELSE [1] END |
  MERGE (object:KnowledgeEntity {id:item.objectId}) … MERGE (c)-[:OBJECT]->(object))
WITH c, item OPTIONAL MATCH (prior:KnowledgeClaim {id:item.supersedes})
FOREACH (p IN CASE WHEN prior IS NULL THEN [] ELSE [prior] END | MERGE (c)-[:SUPERSEDES]->(p))
RETURN c.id AS id
```

**What it does:** attaches typed claims to the exact memory revision they were extracted from. The whole batch is rejected if the source memory has changed since it was read, or if any claim it says it corrects is no longer current. Corrections form a `SUPERSEDES` chain, so history stays queryable.

### Searching claims (`recall_knowledge`)

`src/knowledge.ts:273–507` and `src/knowledge-search.ts`

1. **Candidates.** Your own current claims (`src/knowledge.ts:283`):

   ```cypher
   MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory)
   WHERE c.owner = $user AND m.deletedAt IS NULL AND ($entity = '' OR c.subjectId = $entity OR c.objectId = $entity)
     AND ($history OR (c.sourceRevision = m.revision AND c.status <> 'superseded'))
   RETURN c.payload AS payload, c.status AS status, c.sourceRevision = m.revision AS current
   ORDER BY c.recordedAt DESC, c.id DESC LIMIT 501
   ```

   And claims published into your spaces, reached only through your membership (`src/knowledge.ts:298`):

   ```cypher
   MATCH (:Person {id:$user})-[:MEMBER_OF {active:true}]->(s:Space)<-[:PUBLISHED_IN]-(p:Publication)
         -[:DERIVED_FROM]->(:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory)
   WHERE p.active = true AND m.deletedAt IS NULL AND ($space = '' OR s.id = $space)
   RETURN DISTINCT p.payload AS payload, 'snapshot' AS status, true AS current
   ORDER BY p.publishedAt DESC, p.id DESC LIMIT 501
   ```

2. **Full-text search** in FalkorDB (`src/knowledge-search.ts:242`):

   ```cypher
   CALL db.idx.fulltext.queryNodes($label, $lexical) YIELD node, score
   MATCH (node)-[:INDEXES]->(c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory)
   WHERE c.owner = $user AND c.sourceRevision = m.revision AND c.status IN ['active','disputed'] AND m.deletedAt IS NULL
   RETURN c.payload AS payload, c.status AS status, score ORDER BY score DESC, c.id LIMIT 201
   ```

3. **Vector search** in FalkorDB (`src/knowledge-search.ts:261`), same permission guard:

   ```cypher
   CALL db.idx.vector.queryNodes($label, 'embedding', 200, vecf32($vector)) YIELD node, score
   <same guard> AND score <= 0.32
   RETURN c.payload AS payload, c.status AS status, score AS distance ORDER BY distance, c.id LIMIT 100
   ```

   FalkorDB's `score` here is cosine *distance* (lower is closer). If fewer than 20 hits survive the guard, an exact scan with `vec.cosineDistance(node.embedding, vecf32($vector))` over the same scope runs as a fallback (`src/knowledge-search.ts:273`), so stale index entries can't crowd out valid results.

   For a shared space, the guard instead walks from the search hit to the reader's membership (`src/knowledge-search.ts:226`):

   ```cypher
   MATCH (node)-[:INDEXES]->(c:Publication)-[:PUBLISHED_IN]->(sp:Space)<-[member:MEMBER_OF]-(person:Person)
   MATCH (c)-[:DERIVED_FROM]->(:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory)
   WHERE sp.id = $space AND person.id = $user AND member.active = true AND c.active = true AND m.deletedAt IS NULL
   ```

   The filters sit in `WHERE` rather than inline property maps because FalkorDB rejects `{id:$space}` in a `MATCH` that follows `CALL db.idx.*.queryNodes` on some plans.

4. **Fusion.** The full-text and vector rankings are merged with reciprocal-rank fusion: each claim scores `Σ 1 / (60 + rank)` over the lists it appears in (`src/knowledge.ts:403`). This runs in TypeScript.

5. **One-hop expansion.** From the top claims' subject and object entities, fetch other current claims about the same entities (`src/knowledge.ts:435`):

   ```cypher
   MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory)
   WHERE c.owner = $user AND m.deletedAt IS NULL AND c.sourceRevision = m.revision
     AND c.status IN ['active','disputed'] AND (c.subjectId IN $ids OR c.objectId IN $ids)
   RETURN c.payload AS payload, c.status AS status, true AS current ORDER BY c.recordedAt DESC, c.id LIMIT 201
   ```

   And the shared-space version through publications (`src/knowledge.ts:447`):

   ```cypher
   MATCH (:Person {id:$user})-[:MEMBER_OF {active:true}]->(s:Space)<-[:PUBLISHED_IN]-(p:Publication)-[:SUBJECT|OBJECT]->(e:KnowledgeEntity),
         (p)-[:DERIVED_FROM]->(:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory)
   WHERE p.active = true AND m.deletedAt IS NULL AND ($space = '' OR s.id = $space) AND e.id IN $ids
   RETURN DISTINCT p.payload AS payload, 'snapshot' AS status, true AS current ORDER BY p.publishedAt DESC, p.id LIMIT 201
   ```

### Search indexes

`src/knowledge-search.ts:61–102`

```cypher
CREATE FULLTEXT INDEX FOR (d:<label>) ON (d.text)
CREATE VECTOR INDEX FOR (d:<label>) ON (d.embedding)
  OPTIONS {dimension: <n>, similarityFunction: 'cosine', M: 16, efConstruction: 200, efRuntime: 100}
```

Each scope (one person's private claims, or one space's publications) gets its own label, `KS_` plus a hash of the scope and embedding model (`src/knowledge-search.ts:58`). Other users' vectors therefore never compete for nearest-neighbour slots, and changing the embedding model starts a fresh index instead of mixing vectors. Documents are written with `MERGE (d:KnowledgeSearchDocument:<label> {id:$doc}) … MERGE (d)-[:INDEXES]->(c)` (`src/knowledge-search.ts:125`), and skipped when the text hash hasn't changed, so unchanged claims are never re-embedded.

### Publishing a claim to a space (`publish_claim`)

`src/knowledge.ts:784`

```cypher
MATCH (c:KnowledgeClaim {id:$claim})-[:SUPPORTED_BY]->(m:Memory),
      (:Person {id:$user})-[member:MEMBER_OF {active:true}]->(s:Space {id:$space})
WHERE c.owner = $user AND c.status IN ['active','disputed'] AND c.sourceRevision = m.revision
  AND m.deletedAt IS NULL AND member.role IN ['owner','contributor']
MERGE (p:Publication {id:$id}) ON CREATE SET p.owner = $user, p.payload = $payload, p.active = true, …
MERGE (p)-[:DERIVED_FROM]->(c) MERGE (p)-[:PUBLISHED_IN]->(s)
FOREACH (_ IN CASE WHEN p.active THEN [1] ELSE [] END | MERGE (event:Change {id:$event}) ON CREATE SET event.kind = 'published', …)
MERGE (subject:KnowledgeEntity {id:$subjectId}) ON CREATE SET subject.kind = $subjectType, subject.spaceId = $space
MERGE (p)-[:SUBJECT]->(subject)
FOREACH (_ IN CASE WHEN $objectId = '' THEN [] ELSE [1] END | MERGE (object:KnowledgeEntity {id:$objectId}) … MERGE (p)-[:OBJECT]->(object))
RETURN p.id AS id, p.active AS active
```

A publication is a frozen copy: later private corrections don't silently change what teammates already received. Retracting sets `p.active = false` and deletes its search document.

## 8. Background extraction queue

`src/ontology-extraction.ts:668` and `:490`

Every saved or revised memory gets an `OntologyJob`. A worker picks up to three due jobs:

```cypher
MATCH (j:OntologyJob)-[:SUPPORTED_BY]->(m:Memory)
WHERE j.status = 'pending' AND j.attempts < $max AND j.nextAt <= $now
  AND (j.leaseUntil IS NULL OR j.leaseUntil < $now) AND m.deletedAt IS NULL AND j.revision = m.revision
RETURN m.id AS id, m.owner AS owner, … ORDER BY j.nextAt LIMIT 3
```

Each job is claimed with a 120-second lease and an attempt counter set in the same query (`:490`), so two workers can't process the same job. After the LLM responds, the lease and the memory's revision are checked again before anything is saved (`:569`), so a memory that was forgotten or revised mid-extraction never gets stale claims. The queue is the graph itself; there is no separate job store.

To help the extractor reuse existing entities instead of creating duplicates, it reads the author's recent claims as candidates (`:288`):

```cypher
MATCH (c:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory)
WHERE c.owner = $user AND m.deletedAt IS NULL AND c.status IN ['active','disputed']
  AND (c.sourceRevision = m.revision OR m.id = $source)
RETURN c.payload AS payload, m.id = $source AS sameSource ORDER BY c.recordedAt DESC LIMIT 300
```

## 9. Sharing a memory shares its claims

`src/knowledge.ts:546` (`syncSharedClaims`), run after a save, revision or share through MCP and again when background extraction finishes.

When a memory is shared into a space, the claims extracted from it are published there too, so teammates' `recall_knowledge` finds the facts and not only the text. The sync starts from the memory's shares and the author's current role in each space:

```cypher
MATCH (m:Memory {id:$id})-[share:SHARED_IN]->(s:Space) WHERE m.owner = $user AND m.deletedAt IS NULL
OPTIONAL MATCH (:Person {id:$user})-[member:MEMBER_OF {active:true}]->(s)
RETURN s.id AS space, share.active AS active, share.updatedAt AS epoch, member.role AS role
```

It then compares the memory's current claims with the publications that already exist for it, publishes the missing ones through the `publish_claim` query in §7 (marked `viaShare`), and retracts publications whose share was withdrawn. A claim the author already published on its own is not published twice, and a former member can neither publish nor retract. Publication IDs include the share's timestamp, so sharing again after a retraction creates fresh snapshots instead of reviving old ones.

## 10. One node per space member

`src/knowledge.ts:48` (`memberFor`), `:71` (`spaceEntity`) and `:644` (`relinkSpace`)

Entities are scoped to their owner, so Pranav's note about "Afshal" and Afshal's own note about "Afshal Gulam" start with different subject nodes. When a claim is published into a space, a person mention that names exactly one active member (full name, a first name no other member shares, or the author referring to themselves) is rewritten to that member's node. Two members with the same first name link to neither. Every other entity gets a space-scoped copy that carries no private aliases or properties.

Members are read from the graph:

```cypher
MATCH (p:Person)-[:MEMBER_OF {active:true}]->(:Space {id:$space}) RETURN p.id AS id, p.name AS name
```

When someone joins or is removed (`accept_invitation`, `revoke_member`), the space's active publications are linked again:

```cypher
MATCH (:Space {id:$space})<-[:PUBLISHED_IN]-(p:Publication)-[:DERIVED_FROM]->(c:KnowledgeClaim)
WHERE p.active = true
RETURN p.id AS id, p.owner AS owner, p.payload AS payload, c.payload AS source
```

and each publication whose subject or object changed is rewired:

```cypher
MATCH (p:Publication {id:$id}) SET p.payload = $payload
WITH p OPTIONAL MATCH (p)-[r:SUBJECT|OBJECT]->() DELETE r
WITH DISTINCT p MERGE (subject:KnowledgeEntity {id:$subjectId}) ON CREATE SET subject.kind = $subjectType, subject.spaceId = $space
MERGE (p)-[:SUBJECT]->(subject)
FOREACH (_ IN CASE WHEN $objectId = '' THEN [] ELSE [1] END |
  MERGE (object:KnowledgeEntity {id:$objectId}) ON CREATE SET object.kind = $objectType, object.spaceId = $space
  MERGE (p)-[:OBJECT]->(object))
```

**Why a graph:** "what does the team know about Afshal?" becomes a one-hop question from a single node, whoever wrote the note and however they spelled the name. [`cypher/queries/06-space-claims.cypher`](../cypher/queries/06-space-claims.cypher) shows two authors' claims meeting at one `KnowledgeEntity`.

## 11. Relationships the ontology doesn't cover yet

`src/predicates.ts:206` (`commit`) and `:244` (`review`)

When extraction finds a relationship that none of the core types describe, it proposes a new type instead of forcing the fact into the wrong one. A proposal is an `OntologyPredicate` node with status `provisional`. The quota check and the existence check are one read:

```cypher
OPTIONAL MATCH (e:OntologyPredicate {id:$id}) WITH count(e) > 0 AS exists
OPTIONAL MATCH (m:OntologyPredicate) WHERE m.createdBy = $user AND m.createdAt > $since WITH exists, count(m) AS mine
OPTIONAL MATCH (t:OntologyPredicate {status:'provisional'}) RETURN exists, mine, count(t) AS total
```

A new type is kept only if each user has proposed fewer than 5 in the last day and fewer than 100 are waiting for review. An admin listed in `ONTOLOGY_ADMIN_EMAILS` then decides:

- **Approve** makes it a normal relationship type.
- **Reject** retires every claim that uses it, deactivates their publications and deletes their search documents, for example `MATCH (pub:Publication)-[:DERIVED_FROM]->(:KnowledgeClaim {predicate:$id}) SET pub.active = false`.
- **Merge** first checks that every existing claim fits the target's subject and object types, then rewrites the claims and their publications:

  ```cypher
  UNWIND $claims AS item MATCH (c:KnowledgeClaim {id:item.id}) SET c.predicate = $into, c.payload = item.payload
  ```

Explicit negations ("Roshan is not on the Apollo team") are stored as claims with `negated: true`, never as the affirmative fact. A memory that yields no claim the ontology can hold is kept, marked "Not in ontology" on the dashboard, and can be queued for extraction again once a fitting type exists (`retryOntology`, `src/memory.ts:765`).

## Run it yourself

[`cypher/`](../cypher) has the schema and six of the read queries above as standalone files. `npm run graph:demo` builds a sample graph through the product's own write path (four people, one space, six memories, two claims), runs each query, and prints the rows, FalkorDB's execution plan, and a version with the values filled in that you can paste into FalkorDB Browser. [`test/graph-demo.integration.ts`](../test/graph-demo.integration.ts) asserts the same results, so the files can't drift from this page. Setup steps are in [`cypher/README.md`](../cypher/README.md).

The sample space "Apollo launch" is owned by Pranav, with Afshal as a contributor and Roshan as a reader. Eve has an account but is not a member.

| Query | Run | Result |
|---|---|---|
| `01-can-read` | Afshal reads Pranav's shared note | 1 row |
| `01-can-read` | Eve reads the same note | no rows |
| `01-can-read` | Afshal reads Pranav's unshared note | no rows |
| `02-recall-keyword` | Pranav searches "launch" | "The Apollo launch moved to November 20." |
| `03-recall-via-entity` | One hop from that note through its `Entity` | "Apollo budget is approved." and "Afshal is leading the Apollo pricing review.", connected through Apollo |
| `04-recall-via-space` | One hop through its `Space` | "Afshal is preparing the Apollo pricing deck." and the pricing review, connected through "Apollo launch" |
| `05-space-feed` | Roshan's feed | 3 shared notes |
| `05-space-feed` | Eve's feed | no rows |
| `06-space-claims` | Claims Roshan can see | `Afshal Gulam WORKS_ON Apollo` from Pranav's note and from Afshal's, both with the same `subjectNode` |

Afshal's deck note does not appear in the `Entity` hop: entities are scoped to their owner, so Afshal's "Apollo" is a different node from Pranav's. It is reached through the shared space instead.

The permission check's plan starts from the `id` index and walks two edges to the reader, so its cost does not depend on how big the graph is:

```
Project
    Filter
        Aggregate
            Apply
                Filter
                    Node By Index Scan | (m:Memory)
                Optional
                    Filter
                        Conditional Traverse | (_anon_1)<-(m:Memory)
                            Filter
                                Conditional Traverse | (_anon_2)-[membership:MEMBER_OF]->(_anon_1:Space)
                                    Argument
```

Recall's keyword step starts with `Node By Label Scan | (m:Memory)` instead; see Known limits.

The sample graph in FalkorDB Browser: people, their memories, the entities those memories are about, and the space three of them are shared into.

![Sample graph in FalkorDB Browser](images/falkordb-graph.png)

Query 05 in the Browser's table view, run as Roshan:

![Space feed query in FalkorDB Browser](images/falkordb-space-feed.png)

---

## Graph algorithms used

| Technique | Where | Runs in |
|---|---|---|
| Path-based authorization (owner or active membership path, re-checked on every read) | §1, §6, §7, §9 guards | FalkorDB |
| One-hop neighbourhood expansion through `Entity`, `Space` and `KnowledgeEntity` | §3, §7 step 5 | FalkorDB |
| Full-text search (`db.idx.fulltext.queryNodes`) | §7 step 2 | FalkorDB |
| Approximate nearest-neighbour vector search (HNSW, `db.idx.vector.queryNodes`) with exact `vec.cosineDistance` fallback | §7 step 3 | FalkorDB |
| Reciprocal-rank fusion of lexical and vector rankings | §7 step 4 | TypeScript |
| Supersession chains and validity-time filtering (`SUPERSEDES`, `validFrom`/`validUntil`) | §7 | FalkorDB + TypeScript |
| Compare-and-swap writes and idempotent `MERGE` with request hashes | §2, §4, §6, §7 | FalkorDB |
| Lease-based work queue | §8 | FalkorDB |
| Entity resolution: person mentions linked to space members by name, re-run when membership changes | §10 | TypeScript + FalkorDB |
| Governed ontology growth: provisional relationship types with quotas, cascading reject and type-checked merge | §11 | FalkorDB |

The product does not currently call FalkorDB's built-in `algo.*` procedures (PageRank, BFS, WCC, betweenness and so on).

## What breaks without FalkorDB

- **Permissions:** there is no `can_read` table. Access exists only as `MEMBER_OF` and `SHARED_IN` edges, so without the graph nobody can be shown any shared memory.
- **Related context:** recall's "connected through X" results come from edge hops, not text similarity.
- **Claim search:** both the full-text and vector indexes are FalkorDB indexes, and their results are filtered by graph paths.
- **Forgetting and correction:** both walk outward from a memory to everything derived from it.
- **Background extraction:** the job queue lives in the graph.

## Known limits

- Recall's first step (`MATCH (m:Memory)`) and the claim queries that filter on `c.owner` start from a label scan, because only `id` is indexed. Starting from `(:Person {id:$user})` would let them grow with what the user can see rather than the total size of the graph.
- `forget` removes orphan entities with a sweep over every `Entity`.
- Graph expansion is one hop. Multi-hop query planning is not implemented.
- The extraction candidate list is capped at the author's 300 most recent claims, so older entities may be missed and recreated.
- Member linking compares names only. A teammate mentioned by a nickname, or two members who share a first name, stay unlinked.
