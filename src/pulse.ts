import { randomBytes, randomUUID } from "node:crypto";
import { digest, type Actor, type MemoryStore } from "./memory.js";

/**
 * A pulse link lets an assistant that can only poll (Muse hooks, scheduled
 * checks) notice new shared updates cheaply. Reading it returns only an unread
 * counter and a version that changes when new updates arrive; the assistant then
 * reads content through its authenticated check_inbox call. Only a SHA-256 hash
 * of the token is stored, so a database read cannot recover a usable link.
 */
const TOKEN = /^smp_[A-Za-z0-9_-]{43}$/;
const MAX_LINKS = 3;

export class PulseService {
  constructor(
    private store: MemoryStore,
    private publicUrl: string,
  ) {}
  async create(actor: Actor) {
    const token = "smp_" + randomBytes(32).toString("base64url");
    const id = "pulse_" + randomUUID();
    const createdAt = Date.now();
    await this.store.query(
      `MERGE (p:Person {id:$owner})
      CREATE (l:PulseLink {id:$id,owner:$owner,tokenHash:$hash,active:true,createdAt:$createdAt})
      CREATE (p)-[:HAS_PULSE]->(l)`,
      { id, owner: actor.userId, hash: digest(token), createdAt },
    );
    // Keep the newest few live; older links stop working.
    await this.store.query(
      `MATCH (l:PulseLink) WHERE l.owner=$owner AND l.active=true
      WITH l ORDER BY l.createdAt DESC SKIP ${MAX_LINKS}
      SET l.active=false,l.revokedAt=$now`,
      { owner: actor.userId, now: Date.now() },
    );
    return { id, url: `${this.publicUrl}/pulse/${token}`, createdAt };
  }
  async list(actor: Actor) {
    return (
      await this.store.query<{
        id: string;
        createdAt: number;
        lastUsedAt: number | null;
      }>(
        `MATCH (l:PulseLink) WHERE l.owner=$owner AND l.active=true
        RETURN l.id AS id,l.createdAt AS createdAt,l.lastUsedAt AS lastUsedAt ORDER BY l.createdAt DESC`,
        { owner: actor.userId },
        true,
      )
    ).map((l) => ({ ...l, lastUsedAt: l.lastUsedAt ?? null }));
  }
  async revoke(actor: Actor, id: string) {
    const rows = await this.store.query<{ id: string }>(
      `MATCH (l:PulseLink {id:$id}) WHERE l.owner=$owner AND l.active=true
      SET l.active=false,l.revokedAt=$now RETURN l.id AS id`,
      { id, owner: actor.userId, now: Date.now() },
    );
    return { revoked: rows.length > 0 };
  }
  /** Returns undefined for malformed, unknown or revoked tokens. */
  async read(token: string) {
    if (!TOKEN.test(token)) return undefined;
    const [link] = await this.store.query<{ id: string; owner: string }>(
      `MATCH (l:PulseLink {tokenHash:$hash}) WHERE l.active=true RETURN l.id AS id,l.owner AS owner`,
      { hash: digest(token) },
      true,
    );
    if (!link) return undefined;
    const inbox = await this.store.inbox(
      { userId: link.owner, clientId: "pulse" },
      { limit: 500 },
    );
    await this.store.query(
      "MATCH (l:PulseLink {id:$id}) SET l.lastUsedAt=$now",
      { id: link.id, now: Date.now() },
    );
    // The version moves only for updates due now, so a hook wakes its assistant
    // for "about you" updates immediately and for the rest at digest time.
    const due = inbox.items.filter((i) => i.dueNow).map((i) => i.changeId);
    return {
      unread: inbox.unread,
      version: due.length ? digest(due.sort().join(",")).slice(0, 16) : "0",
    };
  }
}
