import React, { useEffect, useRef, useState } from "react";

type Space = { id: string; name: string; role: string; owner: string };
type Memory = {
  id: string;
  owner: string;
  authorName: string;
  kind: string;
  text: string;
  updatedAt: number;
};
type Cursor = { updatedAt: number; id: string };
type Feed = { space: Space; memories: Memory[]; nextCursor: Cursor | null };
type Action = (name: string, input: unknown) => Promise<any>;
const date = (n: number) =>
  new Date(n).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function SharePicker({
  action,
  space,
  actorId,
  onClose,
  onShared,
  onAdd,
}: {
  action: Action;
  space: Space;
  actorId: string;
  onClose: () => void;
  onShared: () => Promise<void>;
  onAdd: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Memory[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const operation = useRef({ id: "", key: "" });
  const searchVersion = useRef(0);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  async function search(text: string) {
    const version = ++searchVersion.current;
    setItems(null);
    setError("");
    setSelected("");
    try {
      const r = await action("recall", { query: text, limit: 50 });
      if (version === searchVersion.current)
        setItems(r.memories.filter((m: Memory) => m.owner === actorId));
    } catch (e) {
      if (version === searchVersion.current)
        setError(
          e instanceof Error ? e.message : "Could not load your memories",
        );
    }
  }
  useEffect(() => {
    let current = true;
    const version = ++searchVersion.current;
    action("recall", { query: "", limit: 50 })
      .then((r) => {
        if (current && version === searchVersion.current)
          setItems(r.memories.filter((m: Memory) => m.owner === actorId));
      })
      .catch((e) => {
        if (current && version === searchVersion.current) setError(e.message);
      });
    return () => {
      current = false;
      ++searchVersion.current;
    };
  }, [action, actorId]);
  return (
    <dialog
      ref={dialog}
      className="space-picker"
      aria-labelledby="share-picker-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="drawer-top">
        <h2 id="share-picker-title">Share a memory</h2>
        <button
          className="icon-button"
          aria-label="Close memory picker"
          onClick={onClose}
          disabled={busy}
        >
          ×
        </button>
      </div>
      <p className="subtle">
        Choose one of your memories to share in {space.name}.
      </p>
      <form
        className="form-inline"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your memories"
          aria-label="Search your memories"
        />
        <button className="button small" disabled={busy}>
          Search
        </button>
      </form>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <div
        className="space-picker-list"
        role="radiogroup"
        aria-label="Your memories"
      >
        {!items && !error && (
          <p className="subtle" role="status">
            Loading…
          </p>
        )}
        {items?.map((m) => (
          <label className="space-picker-option" key={m.id}>
            <input
              type="radio"
              name="memory"
              value={m.id}
              checked={selected === m.id}
              onChange={() => setSelected(m.id)}
              disabled={busy}
            />
            <span>
              <small>{m.kind}</small>
              <span>{m.text}</span>
            </span>
          </label>
        ))}
        {items?.length === 0 && (
          <p className="subtle">
            No matching memories. Add a memory first, or try a different search.
          </p>
        )}
      </div>
      <div className="button-row">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            onClose();
            onAdd();
          }}
        >
          Add a new memory
        </button>
        <button
          className="button"
          disabled={!selected || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            if (operation.current.id !== selected)
              operation.current = { id: selected, key: crypto.randomUUID() };
            try {
              await action("share_memory", {
                id: selected,
                spaceId: space.id,
                enabled: true,
                userRequested: true,
                idempotencyKey: operation.current.key,
              });
              await onShared();
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Sharing failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Sharing…" : "Share selected memory"}
        </button>
      </div>
    </dialog>
  );
}

export function SpaceView({
  space,
  actorId,
  action,
  refreshKey,
  onBack,
  onChanged,
  onSelect,
  onAdd,
}: {
  space: Space;
  actorId: string;
  action: Action;
  refreshKey: unknown;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const [feed, setFeed] = useState<Feed | null>(null),
    [members, setMembers] = useState<
      { id: string; name: string; role: string }[]
    >([]);
  const [tick, setTick] = useState(0),
    [busy, setBusy] = useState(false),
    [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [picker, setPicker] = useState(false);
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("contributor"),
    [inviteUrl, setInviteUrl] = useState("");
  const current = useRef(0);
  useEffect(() => {
    const version = ++current.current;
    let active = true;
    setFeed(null);
    setError("");
    Promise.all([
      action("space_memories", { spaceId: space.id }),
      action("members", { spaceId: space.id }),
    ])
      .then(([f, m]) => {
        if (active && current.current === version) {
          setFeed(f);
          setMembers(m);
        }
      })
      .catch((e) => {
        if (active) {
          setFeed(null);
          setMembers([]);
          setPicker(false);
          setError(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, [space.id, refreshKey, tick, action]);
  const canShare = feed && ["owner", "contributor"].includes(feed.space.role);
  async function mutate(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
      await onChanged();
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-page">
      <div className="space-heading">
        <div>
          <button className="text-button" onClick={onBack}>
            ← All spaces
          </button>
          <h2>{space.name}</h2>
        </div>
        <div className="button-row">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setTick((t) => t + 1)}
          >
            Refresh
          </button>
          {canShare && (
            <button className="button small" onClick={() => setPicker(true)}>
              Share a memory
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="space-notice">
          {notice}
        </p>
      )}
      <div className="space-layout">
        <section aria-label="Memories shared in this space">
          {!feed && !error && (
            <div className="empty-state" role="status">
              Loading shared memories…
            </div>
          )}
          {feed?.memories.length === 0 && (
            <div className="empty-state">
              <h3>Nothing shared yet</h3>
              <p>
                Memories appear here only when a member chooses to share them in
                this space.
              </p>
              {canShare && (
                <button
                  className="button small"
                  onClick={() => setPicker(true)}
                >
                  Share a memory
                </button>
              )}
            </div>
          )}
          <div className="space-feed">
            {feed?.memories.map((m) => (
              <article className="memory-card" key={m.id}>
                <button
                  className="space-memory-open"
                  onClick={() => onSelect(m.id)}
                >
                  <div className="memory-card-top">
                    <span className={"kind-badge " + m.kind}>{m.kind}</span>
                    <span className="subtle">{date(m.updatedAt)}</span>
                  </div>
                  <p>{m.text}</p>
                </button>
                <div className="memory-card-bottom">
                  <span className="source-label">
                    {m.owner === actorId ? "You" : m.authorName || "Member"}
                  </span>
                  {m.owner === actorId && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () =>
                            action("share_memory", {
                              id: m.id,
                              spaceId: space.id,
                              enabled: false,
                              userRequested: true,
                              idempotencyKey: crypto.randomUUID(),
                            }),
                          "Removed from this space. The source memory is kept.",
                        )
                      }
                    >
                      Remove from space
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {feed?.nextCursor && (
            <button
              className="button small space-load-more"
              disabled={loadingMore}
              onClick={async () => {
                const cursor = feed.nextCursor;
                const version = current.current;
                setLoadingMore(true);
                try {
                  const next = await action("space_memories", {
                    spaceId: space.id,
                    cursor,
                  });
                  if (current.current === version)
                    setFeed((f) =>
                      f
                        ? {
                            ...next,
                            memories: [
                              ...f.memories,
                              ...next.memories.filter(
                                (m: Memory) =>
                                  !f.memories.some((old) => old.id === m.id),
                              ),
                            ],
                          }
                        : null,
                    );
                } catch (e) {
                  if (current.current === version) {
                    setFeed(null);
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not load more memories",
                    );
                  }
                } finally {
                  setLoadingMore(false);
                }
              }}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </section>
        <aside className="space-people panel" aria-label="Space members">
          <h3>Members</h3>
          {members.map((m) => (
            <div className="record-row" key={m.id}>
              <div>
                <strong>{m.id === actorId ? "You" : m.name || "Member"}</strong>
                <small>{m.role}</small>
              </div>
              {feed?.space.role === "owner" && m.id !== actorId && (
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      () =>
                        action("revoke_member", {
                          spaceId: space.id,
                          userId: m.id,
                        }),
                      "Member access revoked",
                    )
                  }
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
          {feed?.space.role === "owner" && (
            <form
              className="invite-form"
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(async () => {
                  const r = await action("invite", {
                    spaceId: space.id,
                    email,
                    role,
                  });
                  setInviteUrl(r.url);
                  setEmail("");
                }, "Invite link ready. Send it to your friend to accept.");
              }}
            >
              <h3>Invite a friend</h3>
              <label>
                Email
                <input
                  aria-label="Friend's email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label>
                Permission
                <select
                  aria-label="Friend's permission"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="contributor">Can read and share</option>
                  <option value="reader">Can read</option>
                </select>
              </label>
              <button className="button small" disabled={busy}>
                Create invite link
              </button>
            </form>
          )}
          {inviteUrl && (
            <div className="space-invite-result">
              <label>
                Invitation link
                <input
                  aria-label="Invitation link"
                  value={inviteUrl}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inviteUrl);
                    setNotice("Invitation link copied");
                  } catch {
                    setNotice("Select and copy the invitation link above.");
                  }
                }}
              >
                Copy link
              </button>
              <p className="subtle">
                Only the invited email can accept. No email has been sent.
              </p>
            </div>
          )}
        </aside>
      </div>
      {picker && feed && (
        <SharePicker
          action={action}
          space={feed.space}
          actorId={actorId}
          onClose={() => setPicker(false)}
          onShared={async () => {
            setNotice("Memory shared in this space");
            await onChanged();
            setTick((t) => t + 1);
          }}
          onAdd={onAdd}
        />
      )}
    </div>
  );
}
