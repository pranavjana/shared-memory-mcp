// Permission check: can $user read memory $id?
// Appended to every memory read (src/memory.ts, access()).
// Readable only by the author, or through an active path
// (:Person)-[:MEMBER_OF {active:true}]->(:Space)<-[:SHARED_IN {active:true}]-(:Memory).
MATCH (m:Memory {id:$id})
OPTIONAL MATCH (m)-[:SHARED_IN {active:true}]->(:Space)<-[membership:MEMBER_OF {active:true}]-(:Person {id:$user})
WITH m, count(membership) AS memberships
WHERE m.deletedAt IS NULL AND (m.owner=$user OR memberships>0)
RETURN m.id AS id, m.authorName AS author, m.text AS text
