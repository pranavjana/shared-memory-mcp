// Recall, step 1: memories $user may read that match a search term
// (src/memory.ts, recall). The permission path from 01 filters every row.
MATCH (m:Memory)
OPTIONAL MATCH (m)-[:SHARED_IN {active:true}]->(:Space)<-[membership:MEMBER_OF {active:true}]-(:Person {id:$user})
WITH m, count(membership) AS memberships
WHERE m.deletedAt IS NULL AND (m.owner=$user OR memberships>0)
  AND (size($terms)=0 OR any(t IN $terms WHERE toLower(m.text) CONTAINS t OR toLower(m.entities) CONTAINS t OR toLower(m.authorName) CONTAINS t))
RETURN m.id AS id, m.authorName AS author, m.text AS text
ORDER BY m.updatedAt DESC LIMIT 20
