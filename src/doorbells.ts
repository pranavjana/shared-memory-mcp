import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request } from "node:https";
import ipaddr from "ipaddr.js";
import { z } from "zod";
import {
  DomainError,
  digest,
  type Actor,
  type Change,
  type MemoryStore,
} from "./memory.js";

/**
 * Doorbells wake a member's assistant when someone shares into their spaces.
 * A ring carries only who shared where and an ID; the assistant then reads the
 * content through its own authenticated check_inbox call. Grok Bot routines
 * ("When a webhook fires") are the first supported kind.
 */

export type PostResult = { status: number; body: string };
export type Poster = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<PostResult>;

export function encrypt(value: string, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}
export function decrypt(value: string, key: string) {
  const [iv, tag, data] = value.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "base64"),
    iv,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** True only for globally routable unicast addresses (no private, loopback, metadata or mapped ranges). */
export function publicAddress(value: string) {
  try {
    return ipaddr.process(value).range() === "unicast";
  } catch {
    return false;
  }
}

export function doorbellUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DomainError(400, "Doorbell must be an HTTPS URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    url.href.length > 2048
  )
    throw new DomainError(
      400,
      "Doorbell must be an HTTPS URL on the default port, without credentials or fragments",
    );
  return url;
}

/** Accepts the value as shown by the host, with or without a leading "Authorization:". */
export function normalizeAuthorization(raw: string) {
  const value = raw.trim().replace(/^authorization\s*:\s*/i, "");
  if (/[\r\n]/.test(value))
    throw new DomainError(400, "Authorization must be a single line");
  if (value.length < 8 || value.length > 4096)
    throw new DomainError(400, "Authorization value looks incomplete");
  return value;
}

/**
 * A DNS lookup that always answers with the address already checked. Node calls
 * it either for one address or, with family autoselection (the default since
 * Node 20), with { all: true } expecting an array; both shapes must be served.
 */
export function pinnedLookup(address: LookupAddress) {
  return (
    _hostname: string,
    options: { all?: boolean },
    callback: (...args: any[]) => void,
  ) => {
    if (options?.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
}

/**
 * POSTs JSON to a public HTTPS endpoint. DNS is resolved once, every address
 * must be public, and the connection is pinned to the checked address so a
 * second lookup cannot redirect it to an internal host. Redirects are not followed.
 */
export const postJson: Poster = async (target, body, headers) => {
  const url = doorbellUrl(target);
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), {
    all: true,
  });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new DomainError(400, "Doorbell must resolve only to public addresses");
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
        agent: false,
        lookup: pinnedLookup(address) as any,
        timeout: 10000,
      },
      (res) => {
        let response = "";
        res.on("data", (chunk) => {
          response += chunk;
          if (Buffer.byteLength(response) > 65536)
            req.destroy(new Error("Doorbell response too large"));
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: response }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Doorbell timeout")));
    req.on("error", reject);
    req.end(body);
  });
};

export const doorbellInput = z
  .object({
    kind: z.literal("grok_webhook"),
    url: z.string().max(2048),
    authorization: z.string().max(4200),
    label: z.string().trim().max(80).optional(),
  })
  .strict();

interface DoorbellRecord {
  id: string;
  owner: string;
  kind: string;
  label?: string | null;
  url: string;
  authorization: string;
  active: boolean;
  createdAt: number;
  lastStatus?: number | null;
  lastAttemptAt?: number | null;
  lastSuccessAt?: number | null;
  needsAttention?: boolean | null;
}
const MAX_DOORBELLS = 5;
const MAX_ATTEMPTS = 6;
const BATCH_LIMIT = 20;

function view(b: DoorbellRecord) {
  return {
    id: b.id,
    kind: b.kind,
    label: b.label ?? null,
    host: new URL(b.url).hostname,
    createdAt: b.createdAt,
    lastStatus: b.lastStatus ?? null,
    lastAttemptAt: b.lastAttemptAt ?? null,
    lastSuccessAt: b.lastSuccessAt ?? null,
    needsAttention: b.needsAttention === true,
  };
}

function summarize(updates: { actorName: string; spaceName: string }[]) {
  const people = [...new Set(updates.map((u) => u.actorName))];
  const spaces = [...new Set(updates.map((u) => u.spaceName))];
  const who =
    people.length <= 2 ? people.join(" and ") : `${people[0]} and ${people.length - 1} others`;
  const where = spaces.length === 1 ? ` in ${spaces[0]}` : "";
  return updates.length === 1
    ? `${who} shared an update${where}.`
    : `${who} shared ${updates.length} updates${where}.`;
}

export class DoorbellService {
  private active?: Promise<void>;
  private again = false;
  constructor(
    private store: MemoryStore,
    private key: string,
    private publicUrl: string,
    private post: Poster = postJson,
  ) {
    if (Buffer.from(key, "base64").length !== 32)
      throw new Error("A 32-byte DOORBELL_ENCRYPTION_KEY is required");
  }
  async add(actor: Actor, raw: unknown) {
    const input = doorbellInput.parse(raw);
    const url = doorbellUrl(input.url);
    const authorization = normalizeAuthorization(input.authorization);
    const [{ count }] = await this.store.query<{ count: number }>(
      "MATCH (b:Doorbell) WHERE b.owner=$owner AND b.active=true RETURN count(b) AS count",
      { owner: actor.userId },
      true,
    );
    if (count >= MAX_DOORBELLS)
      throw new DomainError(400, "Remove a doorbell before adding another");
    const record: DoorbellRecord = {
      id: "bell_" + randomUUID(),
      owner: actor.userId,
      kind: input.kind,
      label: input.label ?? null,
      url: url.href,
      authorization: encrypt(authorization, this.key),
      active: true,
      createdAt: Date.now(),
    };
    await this.store.query(
      `MERGE (p:Person {id:$owner})
      CREATE (b:Doorbell {id:$id,owner:$owner,kind:$kind,label:$label,url:$url,authorization:$authorization,active:true,createdAt:$createdAt})
      CREATE (p)-[:HAS_DOORBELL]->(b)`,
      { ...record },
    );
    return view(record);
  }
  async list(actor: Actor) {
    return (await this.records(actor.userId)).map(view);
  }
  async remove(actor: Actor, id: string) {
    const rows = await this.store.query<{ id: string }>(
      `MATCH (b:Doorbell {id:$id}) WHERE b.owner=$owner AND b.active=true
      SET b.active=false,b.authorization=NULL,b.removedAt=$now RETURN b.id AS id`,
      { id, owner: actor.userId, now: Date.now() },
    );
    return { removed: rows.length > 0 };
  }
  async test(actor: Actor, id: string) {
    const bell = (await this.records(actor.userId)).find((b) => b.id === id);
    if (!bell) throw new DomainError(404, "Doorbell not found");
    const payload = {
      type: "shared_memory.test",
      id: "test_" + randomUUID(),
      sentAt: new Date().toISOString(),
      summary: "Test from Shared Memory: this doorbell works.",
      readWith: "check_inbox",
      dashboard: this.publicUrl + "/dashboard",
    };
    const status = await this.send(bell, payload);
    await this.record(bell.id, status);
    return { ok: status >= 200 && status < 300, status };
  }
  /**
   * Rings every doorbell with pending updates. Runs right after each committed
   * change and on an interval for retries. A call during a pass schedules one
   * more pass so a change committed mid-pass is not left waiting.
   */
  ring(): Promise<void> {
    if (this.active) {
      this.again = true;
      return this.active;
    }
    this.active = (async () => {
      try {
        do {
          this.again = false;
          await this.ringPending();
        } while (this.again);
      } finally {
        this.active = undefined;
      }
    })();
    return this.active;
  }
  private async records(owner?: string) {
    return (
      await this.store.query<{ value: DoorbellRecord }>(
        `MATCH (b:Doorbell) WHERE b.active=true ${owner ? "AND b.owner=$owner" : ""} RETURN properties(b) AS value ORDER BY b.createdAt`,
        { owner: owner ?? "" },
        true,
      )
    ).map((r) => r.value);
  }
  private async send(bell: DoorbellRecord, payload: { id: string }) {
    try {
      const result = await this.post(bell.url, JSON.stringify(payload), {
        "Content-Type": "application/json",
        Authorization: decrypt(bell.authorization, this.key),
        "User-Agent": "SharedMemory-Doorbell/1",
        "Idempotency-Key": payload.id,
      });
      return result.status;
    } catch {
      // Network errors, timeouts and blocked addresses count as transient (status 0).
      return 0;
    }
  }
  private async record(id: string, status: number) {
    const ok = status >= 200 && status < 300;
    const rejected = [401, 403, 404].includes(status);
    await this.store.query(
      `MATCH (b:Doorbell {id:$id})
      SET b.lastStatus=$status,b.lastAttemptAt=$now,b.lastSuccessAt=CASE WHEN $ok THEN $now ELSE b.lastSuccessAt END,
      b.needsAttention=CASE WHEN $ok THEN false WHEN $rejected THEN true ELSE b.needsAttention END
      FOREACH (_ IN CASE WHEN $status=410 THEN [1] ELSE [] END | SET b.active=false,b.authorization=NULL)`,
      { id, status, now: Date.now(), ok, rejected },
    );
  }
  private async ringPending() {
    for (const bell of await this.records()) {
      const now = Date.now();
      const pending = await this.store.query<{ change: Change; spaceName: string }>(
        `MATCH (p:Person {id:$owner})-[member:MEMBER_OF {active:true}]->(s:Space)
        MATCH (c:Change) WHERE c.spaceId=s.id AND c.actorId<>$owner AND c.kind<>'retracted'
          AND c.createdAt>=$since AND c.createdAt>=coalesce(member.joinedAt,0)
        OPTIONAL MATCH (r:DoorbellRing) WHERE r.id=$bell+':'+c.id
        WITH c,s,r WHERE r IS NULL OR (r.status IN ['pending','retry'] AND r.nextAt<=$now AND (r.leaseUntil IS NULL OR r.leaseUntil<$now))
        RETURN properties(c) AS change,s.name AS spaceName ORDER BY c.createdAt ASC LIMIT ${BATCH_LIMIT}`,
        { owner: bell.owner, since: bell.createdAt, bell: bell.id, now },
        true,
      );
      if (!pending.length) continue;
      // The owner's inbox decides: an update that was retracted, forgotten, already
      // seen or replaced by a newer revision is skipped; one that is unread but not
      // yet due under the owner's preferences (digest or quiet hours) waits.
      const unread = new Map(
        (
          await this.store.inbox(
            { userId: bell.owner, clientId: "doorbell" },
            { limit: 500 },
          )
        ).items.map((i) => [i.changeId, i]),
      );
      const readable: typeof pending = [];
      for (const p of pending) {
        const item = unread.get(p.change.id);
        if (!item) await this.settle(bell, [p.change.id], "skipped", 0, 0);
        else if (item.dueNow) readable.push(p);
      }
      if (!readable.length) continue;
      const claimed = await this.store.query<{ changeId: string; attempts: number }>(
        `UNWIND $rings AS ring
        MERGE (r:DoorbellRing {id:ring.id}) ON CREATE SET r.bellId=$bell,r.owner=$owner,r.changeId=ring.changeId,r.status='pending',r.attempts=0,r.nextAt=0,r.createdAt=$now
        WITH r WHERE r.status IN ['pending','retry'] AND r.nextAt<=$now AND (r.leaseUntil IS NULL OR r.leaseUntil<$now)
        SET r.leaseUntil=$lease,r.attempts=r.attempts+1
        RETURN r.changeId AS changeId,r.attempts AS attempts`,
        {
          rings: readable.map((p) => ({ id: bell.id + ":" + p.change.id, changeId: p.change.id })),
          bell: bell.id,
          owner: bell.owner,
          now,
          lease: now + 30000,
        },
      );
      if (!claimed.length) continue;
      const ids = new Set(claimed.map((c) => c.changeId));
      const updates = readable
        .filter((p) => ids.has(p.change.id))
        .map((p) => ({
          changeId: p.change.id,
          kind: p.change.kind,
          spaceId: p.change.spaceId,
          spaceName: p.spaceName,
          actorName: p.change.actorName,
          aboutYou: unread.get(p.change.id)!.aboutYou !== null,
          at: new Date(p.change.createdAt).toISOString(),
        }));
      const payload = {
        type: "shared_memory.updates",
        // Stable across retries of the same batch so the receiver can deduplicate.
        id: "ring_" + digest(bell.id + "|" + [...ids].sort().join(",")),
        sentAt: new Date().toISOString(),
        summary: summarize(updates),
        updates,
        readWith: "check_inbox",
        dashboard: this.publicUrl + "/dashboard",
      };
      const status = await this.send(bell, payload);
      const attempts = Math.max(...claimed.map((c) => c.attempts));
      const ok = status >= 200 && status < 300;
      const terminal =
        status === 410 ||
        (status >= 400 && status < 500 && ![408, 429].includes(status)) ||
        attempts >= MAX_ATTEMPTS;
      await this.settle(
        bell,
        [...ids],
        ok ? "delivered" : terminal ? "failed" : "retry",
        status,
        attempts,
      );
      await this.record(bell.id, status);
    }
  }
  private async settle(
    bell: DoorbellRecord,
    changeIds: string[],
    status: string,
    code: number,
    attempts: number,
  ) {
    const now = Date.now();
    await this.store.query(
      `UNWIND $ids AS id
      MERGE (r:DoorbellRing {id:id}) ON CREATE SET r.bellId=$bell,r.owner=$owner,r.attempts=0,r.createdAt=$now
      SET r.status=$status,r.httpStatus=$code,r.leaseUntil=NULL,r.nextAt=$next,r.updatedAt=$now`,
      {
        ids: changeIds.map((id) => bell.id + ":" + id),
        bell: bell.id,
        owner: bell.owner,
        status,
        code,
        now,
        next: now + Math.min(900000, 5000 * 2 ** attempts),
      },
    );
  }
}
