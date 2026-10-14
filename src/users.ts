import { FalkorDB, ConstraintType, EntityType } from 'falkordb';

export interface UserRecord {
  clerkId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface StoredUser extends UserRecord { syncedAt: number; deletedAt: number | null }
export interface UserStore {
  upsert(user: UserRecord): Promise<void>;
  markDeleted(clerkId: string): Promise<void>;
  get(clerkId: string): Promise<StoredUser | undefined>;
  health(): Promise<void>;
  close(): Promise<void>;
}

export async function connectUserStore(env: NodeJS.ProcessEnv = process.env): Promise<UserStore> {
  if (!env.FALKORDB_HOST || !env.FALKORDB_PASSWORD) throw new Error('FALKORDB_HOST and FALKORDB_PASSWORD are required');
  const db = await FalkorDB.connect({
    socket: { host: env.FALKORDB_HOST, port: Number(env.FALKORDB_PORT ?? 6379), connectTimeout: 10_000 },
    password: env.FALKORDB_PASSWORD,
  });
  db.on('error', () => console.error('FalkorDB connection error'));
  const graph = db.selectGraph(env.FALKORDB_GRAPH ?? 'shared_memory');
  try {
    try { await graph.createNodeRangeIndex('User', 'clerkId'); }
    catch (error) { if (!(error instanceof Error) || !/already indexed/i.test(error.message)) throw error; }
    const constraints = await graph.roQuery<{ type: string; label: string; properties: string[]; status: string }>('CALL db.constraints()');
    if (!constraints.data?.some(c => c.type === 'UNIQUE' && c.label === 'User' && c.properties.length === 1 && c.properties[0] === 'clerkId')) {
      try { await graph.constraintCreate(ConstraintType.UNIQUE, EntityType.NODE, 'User', 'clerkId'); }
      catch (error) { if (!(error instanceof Error) || !/already exists/i.test(error.message)) throw error; }
    }
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const current = await graph.roQuery<{ type: string; label: string; properties: string[]; status: string }>('CALL db.constraints()');
      const constraint = current.data?.find(c => c.type === 'UNIQUE' && c.label === 'User' && c.properties[0] === 'clerkId');
      if (constraint?.status === 'OPERATIONAL') { ready = true; break; }
      if (constraint?.status === 'FAILED') throw new Error('User uniqueness constraint failed');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('User uniqueness constraint is not ready');
  } catch (error) { await db.close(); throw error; }

  return {
    async upsert(user) {
      if (!user.clerkId.startsWith('user_')) throw new Error('A Clerk user ID is required');
      // MERGE plus a unique constraint deduplicates concurrent/replayed writes.
      // Provider timestamps reject delayed updates; deletion is terminal for a Clerk ID.
      await graph.query(`MERGE (u:User {clerkId: $clerkId})
        ON CREATE SET u.createdAt = $createdAt, u.updatedAt = -1
        WITH u WHERE u.deletedAt IS NULL AND u.updatedAt <= $updatedAt
        SET u.email = $email, u.firstName = $firstName, u.lastName = $lastName,
            u.imageUrl = $imageUrl, u.updatedAt = $updatedAt, u.syncedAt = $now`,
      { params: { ...user, now: Date.now() } });
    },
    async markDeleted(clerkId) {
      if (!clerkId.startsWith('user_')) throw new Error('A Clerk user ID is required');
      // Keep only an ID tombstone so a delayed create/update cannot restore deleted PII.
      await graph.query(`MERGE (u:User {clerkId: $clerkId})
        ON CREATE SET u.createdAt = $now, u.updatedAt = $now
        SET u.email = NULL, u.firstName = NULL, u.lastName = NULL, u.imageUrl = NULL,
            u.deletedAt = coalesce(u.deletedAt, $now), u.syncedAt = $now`,
      { params: { clerkId, now: Date.now() } });
    },
    async get(clerkId) {
      const result = await graph.roQuery<StoredUser>(`MATCH (u:User {clerkId: $clerkId})
        RETURN u.clerkId AS clerkId, u.email AS email, u.firstName AS firstName,
          u.lastName AS lastName, u.imageUrl AS imageUrl, u.createdAt AS createdAt,
          u.updatedAt AS updatedAt, u.syncedAt AS syncedAt, u.deletedAt AS deletedAt`,
      { params: { clerkId } });
      return result.data?.[0];
    },
    async health() { await graph.roQuery('RETURN 1 AS ok'); },
    async close() { await db.close(); },
  };
}
