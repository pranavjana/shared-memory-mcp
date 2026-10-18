// Schema that Shared Memory creates on startup in the memory graph
// (FALKORDB_MEMORY_GRAPH, src/memory.ts MemoryStore.init).
// FalkorDB range index on id for every node label, plus a unique constraint on id.
// Unique constraints are created with the GRAPH.CONSTRAINT command, for example:
//   GRAPH.CONSTRAINT CREATE <graph> UNIQUE NODE Memory PROPERTIES 1 id
CREATE INDEX FOR (n:Person) ON (n.id);
CREATE INDEX FOR (n:Memory) ON (n.id);
CREATE INDEX FOR (n:Revision) ON (n.id);
CREATE INDEX FOR (n:Entity) ON (n.id);
CREATE INDEX FOR (n:Space) ON (n.id);
CREATE INDEX FOR (n:Invitation) ON (n.id);
CREATE INDEX FOR (n:Change) ON (n.id);
CREATE INDEX FOR (n:Connection) ON (n.id);
CREATE INDEX FOR (n:SharingRule) ON (n.id);
CREATE INDEX FOR (n:KnowledgeClaim) ON (n.id);
CREATE INDEX FOR (n:KnowledgeEntity) ON (n.id);
CREATE INDEX FOR (n:KnowledgeBatch) ON (n.id);
CREATE INDEX FOR (n:KnowledgeSearchDocument) ON (n.id);
CREATE INDEX FOR (n:OntologyJob) ON (n.id);
CREATE INDEX FOR (n:Publication) ON (n.id);

// Claim search (src/knowledge-search.ts) creates a full-text index and a vector index
// per permission scope, on a server-generated label KS_<hash> of the scope:
//   CREATE FULLTEXT INDEX FOR (d:KS_<hash>) ON (d.text)
//   CREATE VECTOR INDEX FOR (d:KS_<hash>) ON (d.embedding)
//     OPTIONS {dimension:768, similarityFunction:'cosine', M:16, efConstruction:200, efRuntime:100}

// Accounts live in a separate graph (FALKORDB_GRAPH, src/users.ts):
//   CREATE INDEX FOR (u:User) ON (u.clerkId)  plus a unique constraint on clerkId
