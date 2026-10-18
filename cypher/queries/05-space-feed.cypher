// A space's feed for one member (src/memory.ts, spaceMemories).
// Only memories actively shared into a space the reader actively belongs to.
MATCH (:Person {id:$user})-[:MEMBER_OF {active:true}]->(s:Space {id:$space})<-[:SHARED_IN {active:true}]-(m:Memory)
WHERE m.deletedAt IS NULL
RETURN m.id AS id, m.authorName AS author, m.text AS text
ORDER BY m.updatedAt DESC
