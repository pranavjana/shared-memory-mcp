import React, { useCallback, useEffect, useState } from "react";

type Action = (name: string, input: unknown) => Promise<any>;
interface InboxItem {
  changeId: string;
  kind: string;
  spaceName: string;
  actorName: string;
  createdAt: number;
  aboutYou: { status: "possible" | "confirmed"; name: string } | null;
  dueNow: boolean;
  update:
    | { type: "memory"; memory: { text: string } }
    | {
        type: "publication";
        claim: {
          subject?: { name?: string };
          predicate?: string;
          object?: { name?: string };
          value?: string;
        };
      };
}

const verbs: Record<string, string> = {
  shared: "shared",
  revised: "updated",
  published: "shared a fact",
};
const when = (ms: number) =>
  new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

function preview(item: InboxItem) {
  if (item.update.type === "memory") return item.update.memory.text;
  const c = item.update.claim;
  const predicate = (c.predicate ?? "").toLowerCase().replaceAll("_", " ");
  return [c.subject?.name, predicate, c.object?.name ?? c.value?.replaceAll("_", " ")]
    .filter(Boolean)
    .join(" ");
}

/** Unread updates other members shared, with "is this you?" answers. */
export function InboxView({
  action,
  onNotice,
  onError,
  onCount,
}: {
  action: Action;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onCount: (unread: number) => void;
}) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [nextDigest, setNextDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const box = await action("check_inbox", { limit: 50 });
    setItems(box.items ?? []);
    setNextDigest(box.nextDigestAt ?? null);
    onCount(box.unread ?? 0);
  }, [action, onCount]);
  useEffect(() => {
    load().catch((e) => onError(e.message));
  }, [load, onError]);
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      onNotice(message);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  if (!items) return <p className="empty">Loading updates…</p>;
  return (
    <div className="inbox-page">
      <div className="inbox-header">
        <p className="muted">
          {items.length
            ? `${items.length} unread update${items.length === 1 ? "" : "s"}.`
            : "You're all caught up."}
          {nextDigest &&
            ` Next digest ${new Date(nextDigest).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.`}
        </p>
        {items.length > 0 && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              run(() => action("mark_inbox_seen", { all: true }), "All marked as seen")
            }
          >
            Mark all seen
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="empty">
          When someone shares something in your spaces, it shows up here and
          your connected assistants mention it.
        </p>
      ) : (
        <ul className="inbox-list">
          {items.map((item) => (
            <li className="panel inbox-item" key={item.changeId}>
              <div className="inbox-meta">
                <strong>
                  {item.actorName} {verbs[item.kind] ?? item.kind}
                </strong>
                <span className="muted">
                  {item.spaceName} · {when(item.createdAt)}
                </span>
                {item.aboutYou?.status === "confirmed" && (
                  <span className="inbox-badge">About you</span>
                )}
              </div>
              <p className="inbox-text">{preview(item)}</p>
              {item.aboutYou?.status === "possible" && (
                <div className="inbox-question">
                  <span>
                    Mentions “{item.aboutYou.name}”. Is that you?
                  </span>
                  <div className="button-row">
                    {[true, false].map((isMe) => (
                      <button
                        key={String(isMe)}
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              action("confirm_identity", {
                                changeId: item.changeId,
                                name: item.aboutYou!.name,
                                isMe,
                              }),
                            isMe
                              ? `Got it. ${item.actorName}'s updates naming “${item.aboutYou!.name}” are about you.`
                              : `Got it. That “${item.aboutYou!.name}” isn't you.`,
                          )
                        }
                      >
                        {isMe ? "Yes, that's me" : "No"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button
                className="text-button inbox-seen"
                disabled={busy}
                onClick={() =>
                  run(
                    () => action("mark_inbox_seen", { changeIds: [item.changeId] }),
                    "Marked as seen",
                  )
                }
              >
                Mark seen
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
