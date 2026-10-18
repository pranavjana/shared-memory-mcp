// Structured claims shared in a space, with the people they mention
// (src/knowledge.ts, space-scoped recall_knowledge). A person mention that names
// exactly one member resolves to that member's node, so mentions by different
// authors meet at one KnowledgeEntity.
MATCH (:Person {id:$user})-[:MEMBER_OF {active:true}]->(s:Space {id:$space})<-[:PUBLISHED_IN]-(p:Publication)-[:DERIVED_FROM]->(:KnowledgeClaim)-[:SUPPORTED_BY]->(m:Memory)
WHERE p.active=true AND m.deletedAt IS NULL
MATCH (p)-[:SUBJECT]->(subject:KnowledgeEntity)
OPTIONAL MATCH (p)-[:OBJECT]->(object:KnowledgeEntity)
RETURN p.id AS publication, subject.id AS subjectNode, object.id AS objectNode, p.payload AS claim
ORDER BY p.publishedAt
