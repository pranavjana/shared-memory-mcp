// Recall, step 2: one hop through a shared Entity (src/memory.ts, recall).
// Finds memories about the same person, project or topic as the step-1 results,
// even when they share no words with the query.
MATCH (seed:Memory)-[:ABOUT]->(e:Entity)<-[:ABOUT]-(m:Memory)
WHERE seed.id IN $ids AND NOT m.id IN $ids
WITH DISTINCT m, e
OPTIONAL MATCH (m)-[:SHARED_IN {active:true}]->(:Space)<-[membership:MEMBER_OF {active:true}]-(:Person {id:$user})
WITH m, e, count(membership) AS memberships
WHERE m.deletedAt IS NULL AND (m.owner=$user OR memberships>0)
RETURN DISTINCT m.id AS id, m.text AS text, e.name AS connectedThrough, m.updatedAt AS updatedAt
ORDER BY updatedAt DESC LIMIT 10
