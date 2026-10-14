import type { User, UserJSON } from '@clerk/express';
import type { UserRecord, UserStore } from './users.js';

export function fromClerkUser(user: User): UserRecord {
  return {
    clerkId: user.id, email: user.primaryEmailAddress?.emailAddress ?? null,
    firstName: user.firstName, lastName: user.lastName, imageUrl: user.imageUrl,
    createdAt: user.createdAt, updatedAt: user.updatedAt,
  };
}
export function fromClerkWebhook(user: UserJSON): UserRecord {
  return {
    clerkId: user.id,
    email: user.email_addresses.find(e => e.id === user.primary_email_address_id)?.email_address ?? null,
    firstName: user.first_name, lastName: user.last_name, imageUrl: user.image_url,
    createdAt: user.created_at, updatedAt: user.updated_at,
  };
}

export async function backfillUsers(store: UserStore, clerk: { users: { getUserList: (params: {limit: number; offset: number; orderBy: '+created_at'}) => Promise<{data: User[]; totalCount: number}> } }) {
  let count = 0;
  for (let offset = 0; ; offset += 100) {
    const page = await clerk.users.getUserList({ limit: 100, offset, orderBy: '+created_at' });
    for (const user of page.data) { await store.upsert(fromClerkUser(user)); count++; }
    if (page.data.length < 100 || offset + page.data.length >= page.totalCount) break;
  }
  return count;
}
