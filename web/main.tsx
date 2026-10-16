import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, useAuth, SignInButton, UserButton } from "@clerk/react";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import codexLogo from "./assets/codex.png";
import museLogo from "./assets/muse.svg";
import { SpaceView } from "./SpaceView";
import { invitationRedirect } from "./invitation";
const OntologyView = React.lazy(() =>
  import("./OntologyView").then((m) => ({ default: m.OntologyView })),
);
import "./style.css";
import "./ontology.css";
type Config = {
  publishableKey: string;
  mcpUrl: string;
  accountPortalUrl: string;
};
type Memory = {
  id: string;
  owner: string;
  authorName: string;
  kind: string;
  text: string;
  basis: string;
  evidence: string;
  sourceClient: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  eventAt: string | null;
  entities: { type: string; name: string }[];
};
type Space = { id: string; name: string; role: string; owner: string };
type Connection = {
  id: string;
  clientId: string;
  enabled: boolean;
  lastSeen: number;
};
type Overview = {
  actor: { id: string; name: string };
  memories: Memory[];
  related: Memory[];
  spaces: Space[];
  graph: {
    memoryId: string;
    memoryText: string;
    entityId: string;
    entityName: string;
    entityType: string;
  }[];
  deliveries: any[];
  subscriptions: any[];
  connections?: Connection[];
  rules?: any[];
};
const kinds = [
  "fact",
  "preference",
  "event",
  "goal",
  "task",
  "decision",
  "relationship",
];
const date = (n: number) =>
  new Date(n).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// Muse registrations in our Clerk instance; opaque IDs carry no app name.
const museClientIds = new Set([
  "Mz1lRFME372kmUIB",
  "AxgqrHF5QB08oV37",
  "nGyKi3rPUIuFKH76",
  "AqmpDhak10k9TtSl",
]);
function assistantIdentity(clientId: string) {
  // Identity and logo published by Codex's OAuth client metadata.
  if (clientId === "https://chatgpt.com/oauth/codex/client.json") {
    return { name: "Codex", logo: codexLogo };
  }
  if (museClientIds.has(clientId)) {
    return { name: "Muse", logo: museLogo };
  }
  try {
    const url = new URL(clientId);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return { name: url.hostname, logo: undefined };
    }
  } catch {
    // Opaque OAuth IDs do not provide a verified assistant name.
  }
  return { name: "Assistant", logo: undefined };
}
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    memory: (
      <>
        <circle cx="7" cy="7" r="3" />
        <circle cx="17" cy="6" r="2" />
        <circle cx="16" cy="17" r="4" />
        <path d="m9 9 4 5M10 7l5-1" />
      </>
    ),
    graph: (
      <>
        <circle cx="12" cy="12" r="3" />
        <circle cx="4" cy="5" r="2" />
        <circle cx="20" cy="5" r="2" />
        <circle cx="5" cy="20" r="2" />
        <circle cx="21" cy="19" r="2" />
        <path d="m6 7 4 3m4 0 4-3M7 18l3-4m5 0 4 4" />
      </>
    ),
    share: (
      <>
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="5" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m9 11 6-4m-6 6 6 4" />
      </>
    ),
    activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: (
      <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-2l3 4M4 15l3 4a7 7 0 0 0 11-2" />
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.memory}
    </svg>
  );
}
function Brand() {
  return <div className="brand">shared memory.</div>;
}
function Landing() {
  return (
    <main className="landing">
      <h1 className="landing-title">shared memory.</h1>
      <SignInButton mode="modal">
        <button className="button">Log in</button>
      </SignInButton>
    </main>
  );
}
function Graph({
  edges,
  onSelect,
}: {
  edges: Overview["graph"];
  onSelect: (id: string) => void;
}) {
  const entities = [
    ...new Map(edges.map((e) => [e.entityId, e])).values(),
  ].slice(0, 12);
  const memories = [
    ...new Map(edges.map((e) => [e.memoryId, e])).values(),
  ].slice(0, 24);
  const positions = new Map<string, { x: number; y: number }>();
  entities.forEach((e, i) => {
    const t = (i / Math.max(1, entities.length)) * Math.PI * 2;
    positions.set(e.entityId, {
      x: 360 + Math.cos(t) * 150,
      y: 235 + Math.sin(t) * 140,
    });
  });
  memories.forEach((m, i) => {
    const t = (i / Math.max(1, memories.length)) * Math.PI * 2 + 0.2;
    positions.set(m.memoryId, {
      x: 360 + Math.cos(t) * 275,
      y: 235 + Math.sin(t) * 200,
    });
  });
  return (
    <div
      className="graph-wrap"
      role="region"
      aria-label="Scrollable memory relationship graph"
      tabIndex={0}
    >
      <svg
        viewBox="0 0 720 475"
        role="group"
        aria-label="Your memories connected through people, projects and topics"
      >
        {edges.map((e, i) => {
          const a = positions.get(e.entityId),
            b = positions.get(e.memoryId);
          return a && b ? (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#d4d4d4"
            />
          ) : null;
        })}
        {entities.map((e) => {
          const p = positions.get(e.entityId)!;
          return (
            <g key={e.entityId}>
              <circle
                cx={p.x}
                cy={p.y}
                r="25"
                fill="#f5f5f5"
                stroke="#d4d4d4"
              />
              <text
                x={p.x}
                y={p.y + 44}
                textAnchor="middle"
                className="entity-label"
              >
                {e.entityName.slice(0, 25)}
              </text>
              <text
                x={p.x}
                y={p.y + 5}
                textAnchor="middle"
                fontSize="11"
                fill="#171717"
              >
                {e.entityType.slice(0, 1).toUpperCase()}
              </text>
            </g>
          );
        })}
        {memories.map((m) => {
          const p = positions.get(m.memoryId)!;
          return (
            <g
              key={m.memoryId}
              tabIndex={0}
              role="button"
              aria-label={m.memoryText}
              onClick={() => onSelect(m.memoryId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(m.memoryId);
                }
              }}
              className="graph-memory"
            >
              <title>{m.memoryText}</title>
              <circle cx={p.x} cy={p.y} r="25" fill="transparent" />
              <circle
                className="graph-node"
                cx={p.x}
                cy={p.y}
                r="7"
                fill="#171717"
              />
              <text
                x={p.x}
                y={p.y + 23}
                textAnchor="middle"
                className="memory-label"
              >
                {m.memoryText.slice(0, 24)}
                {m.memoryText.length > 24 ? "…" : ""}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="graph-legend">
        <span>
          <i className="legend-entity" />
          Entities
        </span>
        <span>
          <i />
          Memories
        </span>
        <span>Scroll to explore. Select a memory to inspect its source.</span>
      </div>
    </div>
  );
}
function Dashboard({ config }: { config: Config }) {
  const { getToken } = useAuth();
  const [data, setData] = useState<Overview | null>(null),
    [section, setSection] = useState("memories"),
    [view, setView] = useState("list"),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<Memory[] | null>(null),
    [detail, setDetail] = useState<any>(null),
    [editing, setEditing] = useState<Memory | null | undefined>(undefined),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [setupPromptText, setSetupPromptText] = useState(""),
    [spaceName, setSpaceName] = useState(""),
    [selectedSpace, setSelectedSpace] = useState<Space | null>(null),
    [invite, setInvite] = useState(""),
    [memberList, setMemberList] = useState<{
      space: Space;
      members: any[];
    } | null>(null);
  const request = useCallback(
    async (path: string, body?: unknown) => {
      const token = await getToken();
      if (!token) throw new Error("Sign in to continue");
      const r = await fetch("/api/" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + token,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error ?? "Something went wrong");
      return result;
    },
    [getToken],
  );
  const reload = useCallback(async () => {
    setData(await request("overview"));
  }, [request]);
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, [reload]);
  const loadSetupPrompt = useCallback(async () => {
    const response = await fetch("/setup/prompt");
    if (!response.ok)
      throw new Error("Could not load the MCP install prompt. Try again.");
    return response.text();
  }, []);
  useEffect(() => {
    if (section !== "connections" || setupPromptText) return;
    let current = true;
    loadSetupPrompt()
      .then((text) => {
        if (current) setSetupPromptText(text);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [section, setupPromptText, loadSetupPrompt]);
  const action = useCallback(
    async (name: string, input: unknown) =>
      request("action", { action: name, input }),
    [request],
  );
  const perform = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      if (message) setNotice(message);
      await reload();
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const token = new URLSearchParams(location.search).get("invite");
    if (!token || !data) return;
    setInvite(token);
  }, [!!data]);
  async function select(id: string) {
    await perform(async () => {
      setDetail(await action("explain_memory", { id }));
    });
  }
  async function search(e: React.FormEvent) {
    e.preventDefault();
    await perform(async () => {
      if (!query.trim()) {
        setResults(null);
        return;
      }
      const r = await action("recall", { query, limit: 30 });
      setResults([...r.memories, ...r.related]);
    });
  }
  const memories = (results ?? data?.memories ?? []).filter(
    (m) => filter === "all" || m.kind === filter,
  );
  useEffect(() => {
    if (!detail && editing === undefined && !memberList) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialogs = document.querySelectorAll<HTMLElement>("[data-dialog]");
    const dialog = dialogs[dialogs.length - 1];
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
        ) ?? [],
      );
    if (!dialog?.contains(document.activeElement))
      (
        dialog?.querySelector<HTMLTextAreaElement>("textarea") ?? focusable()[0]
      )?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (editing !== undefined) setEditing(undefined);
        else if (memberList) setMemberList(null);
        else setDetail(null);
      }
      if (event.key === "Tab") {
        const nodes = focusable(),
          first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, [detail, editing, memberList]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <nav aria-label="Workspace navigation">
          {[
            ["memories", "memory", "Memories"],
            ["connections", "graph", "Connections"],
            ["spaces", "share", "Shared spaces"],
            ["ontology", "graph", "Ontology"],
            ["activity", "activity", "Activity"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              className={section === id ? "nav-item active" : "nav-item"}
              aria-current={section === id ? "page" : undefined}
              aria-label={label}
              title={label}
              onClick={() => {
                setSection(id);
                setDetail(null);
              }}
            >
              <Icon name={icon} />
              <span className="nav-label">{label}</span>
              {id === "memories" && data ? (
                <span className="nav-count">{data.memories.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="account">
            <UserButton />
            <button
              className="icon-button"
              onClick={() => perform(reload, "Memory refreshed")}
              aria-label="Refresh"
              title="Refresh"
              disabled={busy}
            >
              <Icon name="refresh" size={18} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="page-content" id="workspace-content">
          <h1 className="sr-only">
            {title(section === "spaces" ? "shared spaces" : section)}
          </h1>
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="toast">
              <Icon name="check" size={17} />
              {notice}
            </div>
          )}
          {invite && (
            <div className="invite-banner">
              <div>
                <strong>You have a shared space invitation.</strong>
                <p>
                  Accept with the verified email the invitation was addressed
                  to.
                </p>
              </div>
              <button
                className="button small"
                disabled={busy}
                onClick={() =>
                  perform(async () => {
                    const joined = await action("accept_invitation", {
                      token: invite,
                    });
                    const page = await action("space_memories", {
                      spaceId: joined.id,
                    });
                    setSelectedSpace(page.space);
                    setSection("spaces");
                    setInvite("");
                    history.replaceState({}, "", "/dashboard");
                  }, "Joined shared space")
                }
              >
                Accept invitation
              </button>
            </div>
          )}
          {section === "memories" && (
            <>
              <div className="memory-toolbar">
                <form className="search-box" onSubmit={search}>
                  <Icon name="search" size={18} />
                  <input
                    aria-label="Search memories"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a memory, person, or project…"
                  />
                  <button type="submit" className="text-button">
                    Search
                  </button>
                </form>
                <div className="memory-actions">
                  <div className="view-toggle">
                    <button
                      aria-label="List view"
                      aria-pressed={view === "list"}
                      className={view === "list" ? "selected" : ""}
                      onClick={() => setView("list")}
                    >
                      List
                    </button>
                    <button
                      aria-label="Graph view"
                      aria-pressed={view === "graph"}
                      className={view === "graph" ? "selected" : ""}
                      onClick={() => setView("graph")}
                    >
                      <Icon name="graph" size={16} />
                      Graph
                    </button>
                  </div>
                  <button className="button" onClick={() => setEditing(null)}>
                    <Icon name="plus" size={17} />
                    Add memory
                  </button>
                </div>
              </div>
              <div className="filters">
                {["all", ...kinds].map((k) => (
                  <button
                    key={k}
                    className={filter === k ? "chip selected" : "chip"}
                    aria-pressed={filter === k}
                    onClick={() => setFilter(k)}
                  >
                    {title(k)}
                  </button>
                ))}
                {results && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setResults(null);
                      setQuery("");
                    }}
                  >
                    Clear search
                  </button>
                )}
              </div>
              {!data ? (
                <div className="empty-state">Loading…</div>
              ) : data.memories.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <Icon name="memory" size={32} />
                  </div>
                  <h2>No memories yet</h2>
                  <p>Add a memory or connect an assistant.</p>
                  <button
                    className="button"
                    onClick={() => setSection("connections")}
                  >
                    Connect your assistant <Icon name="arrow" size={16} />
                  </button>
                </div>
              ) : view === "graph" ? (
                <Graph edges={data.graph} onSelect={select} />
              ) : (
                <div className="memory-list">
                  {memories.map((m) => (
                    <button
                      key={m.id}
                      className="memory-card"
                      onClick={() => select(m.id)}
                    >
                      <div className="memory-card-top">
                        <span className={"kind-badge " + m.kind}>
                          {title(m.kind)}
                        </span>
                        <span className="subtle">{date(m.updatedAt)}</span>
                      </div>
                      <p>{m.text}</p>
                      <div className="memory-card-bottom">
                        <div className="entity-tags">
                          {m.entities.slice(0, 3).map((e, i) => (
                            <span key={i}>
                              {e.type === "person" ? "@" : "#"} {e.name}
                            </span>
                          ))}
                        </div>
                        <span className="source-label">
                          {m.owner === data.actor.id ? (
                            <>
                              <Icon name="lock" size={12} />
                              Yours
                            </>
                          ) : (
                            <>From {m.authorName}</>
                          )}
                          <Icon name="arrow" size={15} />
                        </span>
                      </div>
                    </button>
                  ))}
                  {memories.length === 0 && (
                    <div className="empty-state">
                      <h2>No memories found.</h2>
                      <p>Try a different search or memory type.</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {section === "connections" && (
            <div className="connections-page">
              <section
                aria-label="Connected assistants"
                className="connection-list"
              >
                {data?.connections?.length ? (
                  data.connections.map((c) => {
                    const assistant = assistantIdentity(c.clientId);
                    return (
                      <div className="connection-row" key={c.id}>
                        <div className="connection-identity" title={c.clientId}>
                          <span className="assistant-logo" aria-hidden="true">
                            {assistant.logo ? (
                              <img
                                src={assistant.logo}
                                alt=""
                                width="24"
                                height="24"
                              />
                            ) : (
                              <Icon name="memory" size={22} />
                            )}
                          </span>
                          <strong>{assistant.name}</strong>
                          <span
                            className={
                              "connection-state " + (c.enabled ? "active" : "")
                            }
                            title={`${c.enabled ? "Connected" : "Revoked"} · Last used ${date(c.lastSeen)}`}
                          >
                            <span className="sr-only">
                              {c.enabled ? "Connected" : "Revoked"}. Last used{" "}
                              {date(c.lastSeen)}
                            </span>
                          </span>
                          {!c.enabled && <small>Revoked</small>}
                        </div>
                        <button
                          className="text-button connection-action"
                          disabled={busy}
                          aria-label={`${c.enabled ? "Revoke" : "Enable"} ${assistant.name}`}
                          title={
                            c.enabled
                              ? "Stop memory access and event subscriptions"
                              : "Allow memory access"
                          }
                          onClick={() =>
                            perform(
                              () =>
                                action("set_connection", {
                                  id: c.id,
                                  enabled: !c.enabled,
                                }),
                              c.enabled
                                ? "Agent access revoked"
                                : "Agent connection enabled",
                            )
                          }
                        >
                          {c.enabled ? "Revoke" : "Enable"}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <p className="connections-empty">
                    No assistants connected yet.
                  </p>
                )}
              </section>

              <ol className="setup-steps" aria-label="Assistant setup">
                <li>
                  <span className="setup-node" aria-hidden="true">
                    1
                  </span>
                  <div className="setup-content">
                    <h2>Connect your assistant</h2>
                    <p>
                      Give your agent this prompt to install and verify the MCP
                      connection.
                    </p>
                    <div className="button-row">
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={() =>
                          perform(async () => {
                            const text =
                              setupPromptText || (await loadSetupPrompt());
                            setSetupPromptText(text);
                            await navigator.clipboard.writeText(text);
                          }, "MCP install prompt copied")
                        }
                      >
                        <Icon name="copy" size={15} />
                        Copy MCP install prompt
                      </button>
                    </div>
                    <details className="setup-help setup-prompt">
                      <summary>View install prompt</summary>
                      {setupPromptText ? (
                        <pre tabIndex={0} aria-label="MCP install prompt">
                          {setupPromptText}
                        </pre>
                      ) : (
                        <p>
                          Use Copy MCP install prompt to load it and try again.
                        </p>
                      )}
                    </details>
                    <div className="code-copy">
                      <code>{config.mcpUrl}</code>
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label="Copy MCP URL"
                        onClick={() =>
                          perform(async () => {
                            await navigator.clipboard.writeText(config.mcpUrl);
                          }, "MCP URL copied")
                        }
                      >
                        <Icon name="copy" size={17} />
                      </button>
                    </div>
                    <p className="setup-note">
                      Working recipe: DCR via Clerk{" "}
                      <code>…/oauth/register</code> (from
                      oauth-authorization-server metadata, not OIDC alone);
                      public client + PKCE; send this MCP URL as{" "}
                      <code>resource</code> on authorize and token; scopes{" "}
                      <code>openid profile email offline_access</code>. On
                      401/403, fix those before blaming workspace policy.
                    </p>
                    <details className="setup-help chatgpt-setup">
                      <summary>Using ChatGPT?</summary>
                      <ol>
                        <li>
                          Open{" "}
                          <a
                            href="https://chatgpt.com/plugins"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            ChatGPT Plugins <Icon name="arrow" size={13} />
                          </a>
                          , select +, then Add custom MCP server.
                        </li>
                        <li>
                          Name it Shared Memory, paste the URL above, and choose
                          OAuth. Use DCR / leave credentials blank when offered.
                          The host must pass the MCP URL as{" "}
                          <code>resource</code> on authorize and token (RFC
                          8707); a 401 audience mismatch means that step was
                          skipped, not a workspace policy block.
                        </li>
                        <li>
                          Create and install the plugin, then sign in with your
                          Shared Memory account. Select it with @ in your chat.
                          Install the memory skill separately in step 2.
                        </li>
                      </ol>
                      <p className="setup-note">
                        A bundled plugin includes the guide. Our current bundle
                        is private; public installation requires directory
                        review.
                      </p>
                      <a
                        className="text-button"
                        href="https://developers.openai.com/api/docs/guides/custom-mcp-server#how-to-use"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        ChatGPT setup docs <Icon name="arrow" size={13} />
                      </a>
                    </details>
                  </div>
                </li>
                <li>
                  <span className="setup-node" aria-hidden="true">
                    2
                  </span>
                  <div className="setup-content">
                    <h2>Install the memory skill</h2>
                    <p>
                      Add the skill separately to teach your assistant when to
                      save, recall, correct, and share memories.
                    </p>
                    <div className="button-row">
                      <a className="button small" href="/skill/SKILL.md">
                        Download skill
                      </a>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          perform(async () => {
                            const response = await fetch("/skill");
                            if (!response.ok)
                              throw new Error(
                                "Could not load the memory skill. Try again.",
                              );
                            await navigator.clipboard.writeText(
                              await response.text(),
                            );
                          }, "Memory skill instructions copied")
                        }
                      >
                        Copy skill instructions
                      </button>
                    </div>
                    <p className="setup-note">
                      Install it through your assistant’s skill support, or save
                      the guide in persistent instructions. A chat paste applies
                      to that chat only.
                    </p>
                    <details className="setup-help">
                      <summary>Try a memory</summary>
                      <blockquote>
                        Remember that I prefer concise project updates. Use
                        Shared Memory to save this preference.
                      </blockquote>
                      <p>Ask another connected assistant to recall it.</p>
                    </details>
                  </div>
                </li>
              </ol>

              <details className="connection-help">
                <summary>Shared-space notifications</summary>
                <p>
                  After joining a shared space, ask your dot to monitor{" "}
                  <code>memory.changed</code> for that space ID and notify you
                  about shared updates.
                </p>
                <p>
                  A connection alone does not start monitoring. Activity shows
                  webhook receipt; it does not confirm that your dot sent a
                  message.
                </p>
              </details>
              {!!data?.subscriptions.length && (
                <section className="panel spaced">
                  <h2>Active event subscriptions</h2>
                  {data.subscriptions.map((s) => (
                    <div className="record-row" key={s.id}>
                      <div>
                        <strong>
                          {data.spaces.find((p) => p.id === s.spaceId)?.name ??
                            s.spaceId}
                        </strong>
                        <small>Expires {date(s.expiresAt)}</small>
                      </div>
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() =>
                          perform(
                            () => action("unsubscribe", { id: s.id }),
                            "Subscription stopped",
                          )
                        }
                      >
                        Stop
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}
          {section === "spaces" && (
            <>
              {selectedSpace && data ? (
                <SpaceView
                  key={selectedSpace.id}
                  space={selectedSpace}
                  actorId={data.actor.id}
                  action={action}
                  refreshKey={data}
                  onBack={() => setSelectedSpace(null)}
                  onChanged={reload}
                  onSelect={(id) => void select(id)}
                  onAdd={() => setEditing(null)}
                />
              ) : (
                <>
                  <section className="panel create-space">
                    <h2>Create a shared space</h2>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        perform(async () => {
                          const created = await action("create_space", {
                            name: spaceName,
                          });
                          setSpaceName("");
                          setSelectedSpace(created);
                        }, "Shared space created");
                      }}
                    >
                      <input
                        required
                        maxLength={100}
                        value={spaceName}
                        onChange={(e) => setSpaceName(e.target.value)}
                        placeholder="A project, a plan, a shared interest…"
                        aria-label="Space name"
                      />
                      <button className="button small" disabled={busy}>
                        Create space
                      </button>
                    </form>
                  </section>
                  <div className="setup-grid">
                    {data?.spaces.map((s) => (
                      <section className="panel" key={s.id}>
                        <div className="panel-title">
                          <Icon name="share" />
                          <span className="chip">{s.role}</span>
                        </div>
                        <h2>
                          <button
                            className="space-card-name"
                            onClick={() => setSelectedSpace(s)}
                          >
                            {s.name} <Icon name="arrow" size={16} />
                          </button>
                        </h2>
                        <button
                          className="text-button"
                          onClick={() =>
                            perform(async () =>
                              setMemberList({
                                space: s,
                                members: await action("members", {
                                  spaceId: s.id,
                                }),
                              }),
                            )
                          }
                        >
                          View members <Icon name="arrow" size={14} />
                        </button>
                        {s.role === "owner" && (
                          <form
                            className="invite-form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              perform(async () => {
                                const r = await action("invite", {
                                  spaceId: s.id,
                                  email: f.get("email"),
                                  role: f.get("role"),
                                });
                                await navigator.clipboard.writeText(r.url);
                              }, "Invitation link copied. Share it with the invited person.");
                            }}
                          >
                            <label>
                              Invite by verified account email
                              <input
                                type="email"
                                name="email"
                                required
                                placeholder="friend@example.com"
                              />
                            </label>
                            <div className="form-inline">
                              <select name="role" aria-label="Invitation role">
                                <option value="reader">Can read</option>
                                <option value="contributor">
                                  Can read and share
                                </option>
                              </select>
                              <button className="button small" disabled={busy}>
                                Create invite link
                              </button>
                            </div>
                          </form>
                        )}
                      </section>
                    ))}
                  </div>
                  <details className="panel spaced">
                    <summary>Advanced sharing rules</summary>
                    <p>
                      Explicitly enable a rule to share future matching memories
                      into a space. Existing memories are not backfilled.
                      Stopping a rule stops future automatic shares; retract
                      existing references separately.
                    </p>
                    <form
                      className="invite-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        perform(
                          () =>
                            action("add_sharing_rule", {
                              spaceId: f.get("spaceId"),
                              kind: f.get("kind"),
                              entityName: f.get("entityName"),
                            }),
                          "Automatic sharing rule enabled",
                        );
                      }}
                    >
                      <div className="form-inline">
                        <select
                          name="spaceId"
                          required
                          aria-label="Rule shared space"
                        >
                          {data?.spaces
                            .filter((s) => s.role !== "reader")
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                        </select>
                        <select name="kind" aria-label="Rule memory type">
                          {kinds.map((k) => (
                            <option key={k} value={k}>
                              {title(k)}
                            </option>
                          ))}
                        </select>
                        <input
                          name="entityName"
                          placeholder="Entity name filter (optional)"
                          maxLength={120}
                          aria-label="Rule entity name filter"
                        />
                        <button
                          className="button small"
                          disabled={
                            busy ||
                            !data?.spaces.some((s) => s.role !== "reader")
                          }
                        >
                          Enable rule
                        </button>
                      </div>
                    </form>
                    {data?.rules
                      ?.filter((r) => r.active)
                      .map((r) => (
                        <div className="record-row" key={r.id}>
                          <div>
                            <strong>
                              {title(r.kind)} →{" "}
                              {data.spaces.find((s) => s.id === r.spaceId)
                                ?.name ?? r.spaceId}
                            </strong>
                            <small>
                              {r.entityName
                                ? "Connected to " + r.entityName
                                : "All future memories of this type"}
                            </small>
                          </div>
                          <button
                            className="text-button danger"
                            onClick={() =>
                              perform(
                                () =>
                                  action("disable_sharing_rule", { id: r.id }),
                                "Sharing rule stopped",
                              )
                            }
                          >
                            Stop rule
                          </button>
                        </div>
                      ))}
                  </details>
                  {data?.spaces.length === 0 && (
                    <div className="empty-state">
                      <Icon name="share" size={32} />
                      <h2>No shared spaces</h2>
                      <p>Create a space to invite someone.</p>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {section === "ontology" && (
            <React.Suspense fallback={<p className="empty">Loading graph…</p>}>
              <OntologyView
                request={request}
                action={action}
                spaces={data?.spaces ?? []}
                userId={data?.actor.id ?? ""}
              />
            </React.Suspense>
          )}
          {section === "activity" && (
            <>
              <section className="panel">
                <h2>Delivery activity</h2>
                {data?.deliveries.length ? (
                  <div className="activity-list">
                    {data.deliveries.map((d) => (
                      <div className="record-row" key={d.id}>
                        <span className={"status-dot " + d.status} />
                        <div>
                          <strong>
                            {d.status === "accepted"
                              ? "Webhook received"
                              : title(d.status)}
                          </strong>
                          <small>
                            {d.memoryId} · {d.attempts} attempt
                            {d.attempts === 1 ? "" : "s"} · HTTP{" "}
                            {d.httpStatus ?? "—"}
                          </small>
                        </div>
                        <span className="subtle">
                          {date(d.updatedAt ?? d.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state compact">
                    <Icon name="activity" size={28} />
                    <h2>No deliveries yet.</h2>
                    <p>
                      When someone shares a memory in a subscribed space,
                      <br />
                      its delivery trace appears here.
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
      {detail && (
        <div className="drawer-overlay" onClick={() => setDetail(null)}>
          <aside
            className="detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="memory-detail-title"
            data-dialog
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-top">
              <span className={"kind-badge " + detail.memory.kind}>
                {title(detail.memory.kind)}
              </span>
              <button
                className="icon-button"
                aria-label="Close memory details"
                onClick={() => setDetail(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            <h2 id="memory-detail-title">{detail.memory.text}</h2>
            <div className="entity-tags">
              {detail.memory.entities.map((e: any, i: number) => (
                <span key={i}>
                  {e.type} · {e.name}
                </span>
              ))}
            </div>
            <dl>
              <dt>Recorded by</dt>
              <dd>{detail.memory.authorName}</dd>
              <dt>Source</dt>
              <dd>
                {detail.memory.sourceClient === "dashboard"
                  ? "Added in dashboard"
                  : detail.memory.sourceClient}
              </dd>
              <dt>Basis</dt>
              <dd>
                {detail.memory.basis === "user_statement"
                  ? "User statement"
                  : "Agent-reported observation"}
              </dd>
              <dt>Recorded</dt>
              <dd>{date(detail.memory.createdAt)}</dd>
              <dt>Current revision</dt>
              <dd>{detail.memory.revision}</dd>
              {detail.memory.eventAt && (
                <>
                  <dt>Event time</dt>
                  <dd>{new Date(detail.memory.eventAt).toLocaleString()}</dd>
                </>
              )}
            </dl>
            <h3>Source evidence</h3>
            <blockquote>{detail.memory.evidence}</blockquote>
            {detail.memory.owner === data?.actor.id && (
              <>
                <div className="button-row">
                  <button
                    className="button small"
                    onClick={() => setEditing(detail.memory)}
                  >
                    Correct memory
                  </button>
                  <button
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          "Forget this memory, its evidence, and revision content? Shared references will be withdrawn.",
                        )
                      )
                        perform(async () => {
                          await action("forget_memory", {
                            id: detail.memory.id,
                          });
                          setDetail(null);
                        }, "Memory forgotten");
                    }}
                  >
                    Forget
                  </button>
                </div>
                <h3>Share a reference</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    perform(
                      () =>
                        action("share_memory", {
                          id: detail.memory.id,
                          spaceId: f.get("spaceId"),
                          enabled: f.get("mode") === "share",
                          userRequested: true,
                          idempotencyKey: crypto.randomUUID(),
                        }),
                      "Sharing updated",
                    );
                  }}
                >
                  <div className="form-inline">
                    <select name="spaceId" required aria-label="Shared space">
                      {data?.spaces
                        .filter((s) => s.role !== "reader")
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                    <select name="mode" aria-label="Sharing action">
                      <option value="share">Share</option>
                      <option value="retract">Retract</option>
                    </select>
                    <button
                      className="button small"
                      disabled={
                        busy || !data?.spaces.some((s) => s.role !== "reader")
                      }
                    >
                      Apply
                    </button>
                  </div>
                </form>
                <h3>Revision history</h3>
                {detail.history.map((r: any) => (
                  <div className="history-entry" key={r.id}>
                    <small>
                      Revision {r.revision} · {date(r.createdAt)}
                    </small>
                    <p>{r.text}</p>
                  </div>
                ))}
              </>
            )}
          </aside>
        </div>
      )}
      {editing !== undefined && (
        <MemoryEditor
          memory={editing}
          close={() => setEditing(undefined)}
          busy={busy}
          save={async (input) => {
            await perform(
              async () => {
                const r = await action(
                  editing ? "revise_memory" : "remember",
                  editing
                    ? {
                        id: editing.id,
                        expectedRevision: editing.revision,
                        memory: input,
                      }
                    : input,
                );
                setEditing(undefined);
                if (detail)
                  setDetail(
                    await action("explain_memory", { id: r.memory.id }),
                  );
              },
              editing ? "Memory corrected" : "Memory saved",
            );
          }}
        />
      )}
      {memberList && (
        <div className="modal-backdrop" onClick={() => setMemberList(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="space-members-title"
            data-dialog
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-top">
              <h2 id="space-members-title">{memberList.space.name}</h2>
              <button
                className="icon-button"
                aria-label="Close members"
                onClick={() => setMemberList(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            {memberList.members.map((m) => (
              <div className="record-row" key={m.id}>
                <div>
                  <strong>
                    {m.id === data?.actor.id ? "You" : (m.name ?? "Member")}
                  </strong>
                  <small>{m.role}</small>
                </div>
                {memberList.space.role === "owner" && m.role !== "owner" && (
                  <button
                    className="text-button danger"
                    onClick={() =>
                      perform(async () => {
                        await action("revoke_member", {
                          spaceId: memberList.space.id,
                          userId: m.id,
                        });
                        setMemberList(null);
                      }, "Access revoked")
                    }
                  >
                    Revoke access
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function MemoryEditor({
  memory,
  close,
  save,
  busy,
}: {
  memory: Memory | null;
  close: () => void;
  save: (i: any) => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-editor-title"
        data-dialog
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-top">
          <div>
            <h2 id="memory-editor-title">
              {memory ? "Correct a memory" : "Add a memory"}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close editor"
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const text = String(f.get("text"));
            await save({
              text,
              kind: f.get("kind"),
              basis: "user_statement",
              entities: [
                ...(memory?.entities.filter((e) => e.type !== "project") ?? []),
                ...String(f.get("entities"))
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((name) => ({ type: "project", name })),
              ],
              ...(memory?.eventAt ? { eventAt: memory.eventAt } : {}),
              evidence: String(f.get("evidence") || text),
              idempotencyKey: crypto.randomUUID(),
            });
          }}
        >
          <label>
            Memory
            <textarea
              name="text"
              required
              maxLength={6000}
              defaultValue={memory?.text}
              rows={4}
              placeholder="What would you like your assistants to remember?"
            />
          </label>
          <label>
            Type
            <select name="kind" defaultValue={memory?.kind ?? "fact"}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {title(k)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Connected projects{" "}
            <span className="muted">optional, separated by commas</span>
            <input
              name="entities"
              defaultValue={memory?.entities
                .filter((e) => e.type === "project")
                .map((e) => e.name)
                .join(", ")}
              placeholder="Atlas, Weekend plans"
            />
          </label>
          <label>
            Source evidence{" "}
            <span className="muted">optional; defaults to your statement</span>
            <textarea
              name="evidence"
              rows={2}
              maxLength={6000}
              defaultValue={memory?.evidence}
            />
          </label>
          <p className="muted">
            Private by default. You can share a reference after saving.
          </p>
          <div className="modal-actions">
            <button type="button" className="text-button" onClick={close}>
              Cancel
            </button>
            <button className="button" disabled={busy}>
              {busy ? "Saving…" : memory ? "Save correction" : "Save memory"}
              <Icon name="arrow" size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function App({ config }: { config: Config }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded)
    return (
      <div className="loading">
        <Brand />
        <p>Loading…</p>
      </div>
    );
  return isSignedIn ? <Dashboard config={config} /> : <Landing />;
}
const root = createRoot(document.getElementById("root")!);
fetch("/api/config")
  .then(async (r) => {
    if (!r.ok) throw new Error();
    const config: Config = await r.json();
    root.render(
      <React.StrictMode>
        <ClerkProvider
          publishableKey={config.publishableKey}
          appearance={{
            variables: {
              colorPrimary: "#171717",
              colorForeground: "#171717",
              colorBackground: "#ffffff",
              colorMutedForeground: "#666666",
              colorRing: "#0072f5",
              borderRadius: "6px",
              fontFamily: '"Geist Variable", sans-serif',
              fontFamilyMono: '"Geist Mono Variable", monospace',
              fontWeight: {
                normal: 400,
                medium: 500,
                semibold: 600,
                bold: 600,
              },
            },
          }}
          signInFallbackRedirectUrl={invitationRedirect(location.search)}
          signUpFallbackRedirectUrl={invitationRedirect(location.search)}
        >
          <App config={config} />
        </ClerkProvider>
      </React.StrictMode>,
    );
  })
  .catch(() =>
    root.render(
      <div className="loading">
        <Brand />
        <p>We couldn’t connect. Please refresh to try again.</p>
      </div>,
    ),
  );
