// Run inside the API container (private DB network), after npm run build.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {FalkorDB} from 'falkordb';
import {connectUserStore} from '../dist/users.js';
const graphName = `users_verification_${randomUUID().replaceAll('-', '')}`;
const env = {...process.env, FALKORDB_GRAPH: graphName};
const db = await FalkorDB.connect({socket:{host:env.FALKORDB_HOST,port:Number(env.FALKORDB_PORT??6379)},password:env.FALKORDB_PASSWORD});
const graph = db.selectGraph(graphName);
let store;
try {
  store = await connectUserStore(env);
  const profile = {clerkId:'user_verification',email:'synthetic@example.com',firstName:"O'Neil \"quoted\"",lastName:null,imageUrl:null,createdAt:100,updatedAt:200};
  await Promise.all(Array.from({length:12},()=>store.upsert(profile)));
  assert.equal((await graph.roQuery('MATCH (u:User) RETURN count(u) AS count')).data[0].count,1);
  assert.equal((await store.get(profile.clerkId)).firstName,profile.firstName);
  await store.upsert({...profile,firstName:'stale',updatedAt:199});
  assert.equal((await store.get(profile.clerkId)).firstName,profile.firstName);
  await store.upsert({...profile,firstName:'updated',updatedAt:300});
  assert.equal((await store.get(profile.clerkId)).firstName,'updated');
  await store.close();
  store = await connectUserStore(env); // Existing schema must be restart-safe.
  assert.equal((await store.get(profile.clerkId)).firstName,'updated');
  await store.markDeleted(profile.clerkId);
  await store.upsert({...profile,updatedAt:400});
  const deleted = await store.get(profile.clerkId);
  assert.ok(deleted.deletedAt);
  assert.equal(deleted.email,null);
  assert.equal(deleted.firstName,null);
  await store.upsert({...profile,clerkId:'user_other'});
  assert.equal((await store.get('user_other')).email,profile.email);
  await assert.rejects(graph.query('CREATE (:User {clerkId: $id})',{params:{id:'user_other'}}));
  console.log('PASS: concurrent deduplication, parameter safety, stale event protection, restart-safe schema, terminal deletion, separate users, unique constraint');
} finally {
  await store?.close();
  await graph.delete();
  await db.close();
}
