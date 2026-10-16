import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import type { Claim } from "../src/knowledge";
import type { ontology } from "../src/ontology";

type Space = { id: string; name: string; role: string };
type Props = {
  request: (path: string) => Promise<any>;
  action: (name: string, input: unknown) => Promise<any>;
  spaces: Space[];
  userId: string;
};
const colors: Record<string, string> = {
  person: "#8b6cb7",
  organization: "#5d83ae",
  event: "#b1804e",
  place: "#618b7b",
  goal: "#60899b",
  obligation: "#bd796c",
  task: "#779660",
  preference: "#aa9160",
  topic: "#999",
  item: "#7479a5",
  routine: "#759a9b",
  decision: "#8c83a4",
};
const label = (s: string) => s.replaceAll("_", " ").toLowerCase();
function layout(claims: Claim[], narrow: boolean) {
  const entities = new Map<string, { name: string; type: string }>();
  const graph = new dagre.graphlib.Graph({ multigraph: true })
    .setGraph({
      rankdir: narrow ? "TB" : "LR",
      nodesep: 45,
      ranksep: 95,
      marginx: 60,
      marginy: 60,
    })
    .setDefaultEdgeLabel(() => ({}));
  for (const c of claims) {
    entities.set(c.subject.id, c.subject);
    const target = c.object?.id ?? "value:" + c.id;
    entities.set(target, c.object ?? { name: c.value ?? "", type: "value" });
    graph.setEdge(c.subject.id, target, {}, c.id);
  }
  for (const [id] of entities) graph.setNode(id, { width: 180, height: 62 });
  dagre.layout(graph);
  const nodes: Node[] = [...entities].map(([id, e]) => ({
    id,
    position: { x: graph.node(id).x - 90, y: graph.node(id).y - 31 },
    sourcePosition: narrow ? Position.Bottom : Position.Right,
    targetPosition: narrow ? Position.Top : Position.Left,
    data: {
      label: (
        <>
          <span className="kg-node-type">
            <i style={{ background: colors[e.type] ?? "#999" }} />
            {e.type}
          </span>
          <strong>{e.name}</strong>
        </>
      ),
    },
    className: "kg-node",
  }));
  const edges: Edge[] = claims.map((c) => ({
    id: c.id,
    source: c.subject.id,
    target: c.object?.id ?? "value:" + c.id,
    label: label(c.predicate),
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: "#a8a8a8",
    },
    style: {
      stroke: c.basis === "inferred" ? "#b194c3" : "#bcbcbc",
      strokeWidth: 1,
      ...(c.basis === "inferred" ? { strokeDasharray: "4 4" } : {}),
    },
    labelStyle: { fontSize: 11, fill: "#696969" },
    labelBgStyle: { fill: "#fafafa" },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 3,
  }));
  return { nodes, edges };
}
export function OntologyView({ request, action, spaces, userId }: Props) {
  const [narrow, setNarrow] = useState(window.innerWidth < 760);
  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth < 760);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSchemaOpen(false);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  const [scope, setScope] = useState("personal"),
    [query, setQuery] = useState(""),
    [type, setType] = useState("all"),
    [claims, setClaims] = useState<Claim[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [schema, setSchema] = useState<typeof ontology | null>(null),
    [schemaOpen, setSchemaOpen] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [truncated, setTruncated] = useState(false),
    [semantic, setSemantic] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]),
    [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  useEffect(() => {
    let alive = true;
    request("ontology")
      .then((s) => {
        if (alive) setSchema(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [request]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setSelected(null);
    setClaims([]);
    const timer = setTimeout(() => {
      action("recall_knowledge", {
        query,
        limit: 200,
        ...(scope === "personal"
          ? { personalOnly: true }
          : scope !== "all"
            ? { spaceId: scope }
            : {}),
      })
        .then((r) => {
          if (alive) {
            setClaims(r.claims);
            setTruncated(r.truncated);
            setSemantic(r.semanticSearch);
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [scope, query, action, revision]);
  const visible = useMemo(
    () =>
      claims.filter(
        (c) =>
          type === "all" || c.subject.type === type || c.object?.type === type,
      ),
    [claims, type],
  );
  const drawn = useMemo(() => layout(visible, narrow), [visible, narrow]);
  useEffect(() => {
    setNodes(drawn.nodes);
    setEdges(drawn.edges);
  }, [drawn, setNodes, setEdges]);
  const chosen = visible.find((c) => c.id === selected);
  const chosenNode = nodes.find((n) => n.id === selected);
  const chosenName =
    visible
      .flatMap((c) => [c.subject, ...(c.object ? [c.object] : [])])
      .find((e) => e.id === selected)?.name ?? "Value";
  const neighbors = chosenNode
    ? visible.filter(
        (c) => c.subject.id === chosenNode.id || c.object?.id === chosenNode.id,
      )
    : [];
  const inspect = useCallback((id: string) => {
    setSelected(id);
    setNotice("");
  }, []);
  const publish = async (c: Claim, spaceId: string, enabled = true) => {
    setError("");
    try {
      const r = await action("publish_claim", {
        claimId: c.id,
        spaceId,
        enabled,
        userRequested: true,
        idempotencyKey: crypto.randomUUID(),
      });
      setNotice(
        r.published
          ? "Selected relationship shared as a snapshot."
          : "Snapshot retracted.",
      );
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update sharing");
    }
  };
  return (
    <div className="knowledge-graph-page">
      <div className="kg-toolbar">
        <label className="kg-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search knowledge"
            placeholder="Search your knowledge…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")}>
              ×
            </button>
          )}
        </label>
        <select
          aria-label="Graph scope"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="personal">Personal</option>
          <option value="all">All authorized</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter node type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="all">All types</option>
          {schema?.types
            .filter((t) => t.group === "domain")
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
        <button
          className="kg-schema-button"
          onClick={() => setSchemaOpen(true)}
        >
          Schema <span aria-hidden="true">↗</span>
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="kg-message" role="status">
          {notice}
        </p>
      )}
      <div className="kg-workspace">
        <div className="kg-canvas" aria-label="Personal knowledge graph">
          <ReactFlow
            key={scope + ":" + query + ":" + type + ":" + revision}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, n) => inspect(n.id)}
            onEdgeClick={(_, e) => inspect(e.id)}
            onPaneClick={() => setSelected(null)}
            nodesConnectable={false}
            edgesReconnectable={false}
            nodesDraggable
            fitView
            fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
            minZoom={0.15}
            maxZoom={1.8}
            deleteKeyCode={null}
          >
            <Background color="#ddd" gap={22} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
          <div className="kg-count">
            {loading
              ? "Loading…"
              : `${nodes.length} nodes · ${edges.length} relationships`}
          </div>
          {!loading && !visible.length && (
            <div className="kg-empty">
              <span>◇</span>
              <strong>
                {query
                  ? "No matching knowledge"
                  : "Your knowledge graph starts here"}
              </strong>
              <p>
                {query
                  ? "Try a name, subject, or different phrasing."
                  : "Ask your connected agent to structure a memory."}
              </p>
            </div>
          )}
        </div>
        {(chosen || chosenNode) && (
          <aside className="kg-inspector" aria-label="Knowledge details">
            <button
              className="kg-close"
              aria-label="Close details"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            {chosen ? (
              <>
                <span className="kg-eyebrow">Relationship</span>
                <h2>{chosen.subject.name}</h2>
                <div className="kg-assertion">
                  <code>{chosen.predicate}</code>
                  <span>→</span>
                  <strong>{chosen.object?.name ?? chosen.value}</strong>
                </div>
                <blockquote>{chosen.evidence}</blockquote>
                <dl>
                  <dt>Reported by</dt>
                  <dd>{chosen.authorName}</dd>
                  <dt>Basis</dt>
                  <dd>{chosen.basis}</dd>
                  <dt>Visibility</dt>
                  <dd>
                    {chosen.scope === "personal"
                      ? "Private"
                      : "Shared snapshot"}
                  </dd>
                  <dt>Source revision</dt>
                  <dd>{chosen.sourceRevision}</dd>
                  <dt>State</dt>
                  <dd>{chosen.status}</dd>
                  {chosen.validFrom && (
                    <>
                      <dt>Valid from</dt>
                      <dd>{chosen.validFrom}</dd>
                    </>
                  )}
                  {chosen.validUntil && (
                    <>
                      <dt>Valid until</dt>
                      <dd>{chosen.validUntil}</dd>
                    </>
                  )}
                </dl>
                {chosen.authorId === userId &&
                  chosen.scope === "personal" &&
                  spaces.some((s) => s.role !== "reader") && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        publish(
                          chosen,
                          String(new FormData(e.currentTarget).get("spaceId")),
                        );
                      }}
                    >
                      <select name="spaceId" aria-label="Share destination">
                        {spaces
                          .filter((s) => s.role !== "reader")
                          .map((s) => (
                            <option value={s.id} key={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                      <button className="button small">
                        Share this relationship
                      </button>
                    </form>
                  )}
                {chosen.authorId === userId && chosen.spaceId && (
                  <button
                    className="button small"
                    onClick={() => publish(chosen, chosen.spaceId!, false)}
                  >
                    Retract snapshot
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="kg-eyebrow">Connected knowledge</span>
                <h2>{chosenName}</h2>
                {neighbors.map((c) => (
                  <button
                    className="kg-neighbor"
                    key={c.id}
                    onClick={() => inspect(c.id)}
                  >
                    <strong>{c.subject.name}</strong>
                    <span>
                      {label(c.predicate)} → {c.object?.name ?? c.value}
                    </span>
                  </button>
                ))}
              </>
            )}
          </aside>
        )}
      </div>
      <div className="kg-footer">
        <span>Drag to explore · select a relationship for evidence</span>
        <span>
          {truncated
            ? "Showing a bounded view. Search to narrow it."
            : query && semantic === "not_configured"
              ? "Semantic search needs an embedding key."
              : query && semantic === "unavailable"
                ? "Embedding provider unavailable; keyword results shown."
                : ""}
        </span>
      </div>
      {schemaOpen && (
        <div className="kg-modal-backdrop" onClick={() => setSchemaOpen(false)}>
          <section
            className="kg-schema-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Ontology schema"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="kg-modal-heading">
              <div>
                <h2>Schema {schema?.version}</h2>
                <p>Evidence-backed property graph · no OWL reasoner</p>
              </div>
              <button
                aria-label="Close schema"
                onClick={() => setSchemaOpen(false)}
              >
                ×
              </button>
            </div>
            <h3>Node types</h3>
            {schema?.types
              .filter((t) => t.group === "domain")
              .map((t) => (
                <details key={t.id}>
                  <summary>
                    <i style={{ background: colors[t.id] }} />
                    {t.name}
                  </summary>
                  <p>{t.description}</p>
                  <dl>
                    {t.properties.map((p) => (
                      <React.Fragment key={p.name}>
                        <dt>
                          {p.name}
                          {p.required ? " *" : ""}
                        </dt>
                        <dd>
                          {p.type} · {p.description}
                        </dd>
                      </React.Fragment>
                    ))}
                  </dl>
                </details>
              ))}
            <h3>Relationships</h3>
            {schema?.relationships
              .filter((r) => r.group === "assertion")
              .map((r) => (
                <details key={r.id}>
                  <summary>{r.id}</summary>
                  <p>{r.description}</p>
                  <code>
                    {r.from.join(" / ")} → {r.value?.type ?? r.to.join(" / ")}
                  </code>
                  {r.value?.values && <p>{r.value.values.join(" · ")}</p>}
                </details>
              ))}
            <h3>Rules</h3>
            {schema?.rules.map((r) => (
              <p key={r}>{r}</p>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
