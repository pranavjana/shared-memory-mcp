// Recall, step 3: one hop through a shared Space (src/memory.ts, recall).
// Brings in what teammates shared next to the step-1 results.
MATCH (seed:Memory)-[:SHARED_IN {active:true}]->(s:Space)<-[:SHARED_IN {active:true}]-(m:Memory)
WHERE seed.id IN $ids AND NOT m.id IN $ids
WITH DISTINCT m, s
OPTIONAL MATCH (m)-[:SHARED_IN {active:true}]->(:Space)<-[membership:MEMBER_OF {active:true}]-(:Person {id:$user})
WITH m, s, count(membership) AS memberships
WHERE m.deletedAt IS NULL AND (m.owner=$user OR memberships>0)
RETURN DISTINCT m.id AS id, m.authorName AS author, m.text AS text, s.name AS connectedThrough, m.updatedAt AS updatedAt
ORDER BY updatedAt DESC LIMIT 10
