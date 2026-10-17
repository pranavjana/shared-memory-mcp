import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
  Handle,
  type NodeProps,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import type { Claim } from "../src/knowledge";
import type { ontology } from "../src/ontology";
import type { CustomPredicate } from "../src/predicates";

type Space = { id: string; name: string; role: string };
type CustomRow = CustomPredicate & { claims: number; authors: number };
type Schema = typeof ontology & { custom?: CustomRow[]; canReview?: boolean };
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
const attributeName = (predicate: string) =>
  label(predicate.replace(/^HAS_/, ""));
const not = (c: Claim) => (c.negated ? "not " : "");
const maxVisibleAttributes = 5;
const quantity = (n: number, singular: string, plural = singular + "s") =>
  `${n} ${n === 1 ? singular : plural}`;
type EntityCardData = {
  name: string;
  entityType: string;
  attributes: Claim[];
  attributeTypes: Record<string, string>;
  provisional: Set<string>;
  inspect: (id: string) => void;
};
type EntityClassNode = Node<EntityCardData, "entityClass">;
function EntityClassCard({
  id,
  data,
  sourcePosition,
  targetPosition,
}: NodeProps<EntityClassNode>) {
  return (
    <>
      <Handle type="target" position={targetPosition ?? Position.Left} />
      <div className="kg-class-heading">
        <span className="kg-node-type">
          <i style={{ background: colors[data.entityType] ?? "#999" }} />
          {`«${data.entityType}»`}
        </span>
        <strong title={data.name}>{data.name}</strong>
      </div>
      {data.attributes.length > 0 && (
        <div
          className="kg-class-attributes"
          aria-label={`${data.name} attributes`}
        >
          {data.attributes.slice(0, maxVisibleAttributes).map((c) => (
            <button
              key={c.id}
              className={`kg-class-attribute nodrag nopan${c.basis === "inferred" ? " inferred" : ""}`}
              aria-label={`Inspect ${not(c)}${attributeName(c.predicate)}: ${c.value}`}
              title={`${c.authorName} · ${c.basis} · ${c.status}`}
              onClick={(e) => {
                e.stopPropagation();
                data.inspect(c.id);
              }}
            >
              <span className="kg-attribute-key">
                <code>
                  {not(c)}
                  {attributeName(c.predicate)}
                </code>
                <small>
                  {data.attributeTypes[c.predicate] ?? "string"}
                  {data.provisional.has(c.predicate) ? " · provisional" : ""}
                  {c.basis === "inferred"
                    ? " · inferred"
                    : c.status === "disputed"
                      ? " · disputed"
                      : ""}
                </small>
              </span>
              <span className="kg-attribute-value">{c.value}</span>
            </button>
          ))}
          {data.attributes.length > maxVisibleAttributes && (
            <button
              className="kg-more-attributes nodrag nopan"
              onClick={(e) => {
                e.stopPropagation();
                data.inspect(id);
              }}
            >
              + {data.attributes.length - maxVisibleAttributes} more attributes
            </button>
          )}
        </div>
      )}
      <Handle type="source" position={sourcePosition ?? Position.Right} />
    </>
  );
}
const nodeTypes = { entityClass: EntityClassCard };
function layout(
  claims: Claim[],
  narrow: boolean,
  inspect: (id: string) => void,
  attributeTypes: Record<string, string>,
  provisional: Set<string>,
) {
  const entities = new Map<
    string,
    { name: string; type: string; attributes: Claim[] }
  >();
  const graph = new dagre.graphlib.Graph({ multigraph: true })
    .setGraph({
      rankdir: narrow ? "TB" : "LR",
      nodesep: 45,
      ranksep: 110,
      marginx: 60,
      marginy: 60,
    })
    .setDefaultEdgeLabel(() => ({}));
  const addEntity = (e: Claim["subject"]) => {
    if (!entities.has(e.id))
      entities.set(e.id, { name: e.name, type: e.type, attributes: [] });
    return entities.get(e.id)!;
  };
  for (const c of claims) {
    const subject = addEntity(c.subject);
    if (c.object) {
      addEntity(c.object);
      graph.setEdge(c.subject.id, c.object.id, {}, c.id);
    } else if (c.value !== undefined) subject.attributes.push(c);
  }
  for (const [id, e] of entities) {
    const heading = 56 + Math.min(3, Math.ceil(e.name.length / 26)) * 18;
    graph.setNode(id, {
      width: 248,
      height:
        heading +
        Math.min(e.attributes.length, maxVisibleAttributes) * 72 +
        (e.attributes.length > maxVisibleAttributes ? 30 : 0),
    });
  }
  dagre.layout(graph);
  const nodes: Node[] = [...entities].map(([id, e]) => ({
    id,
    type: "entityClass",
    position: {
      x: graph.node(id).x - 124,
      y: graph.node(id).y - graph.node(id).height / 2,
    },
    sourcePosition: narrow ? Position.Bottom : Position.Right,
    targetPosition: narrow ? Position.Top : Position.Left,
    data: {
      name: e.name,
      entityType: e.type,
      attributes: e.attributes,
      attributeTypes,
      provisional,
      inspect,
    },
    className: "kg-node kg-class-node",
  }));
  const edges: Edge[] = claims
    .filter((c) => c.object)
    .map((c) => ({
      id: c.id,
      source: c.subject.id,
      target: c.object!.id,
      label:
        not(c) +
        label(c.predicate) +
        (provisional.has(c.predicate) ? " · provisional" : ""),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: "#a8a8a8",
      },
      style: {
        stroke: c.negated
          ? "#c08a8a"
          : c.basis === "inferred"
            ? "#b194c3"
            : "#bcbcbc",
        strokeWidth: 1,
        ...(c.basis === "inferred" || provisional.has(c.predicate)
          ? { strokeDasharray: "4 4" }
          : {}),
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
    [schema, setSchema] = useState<Schema | null>(null),
    [schemaRevision, setSchemaRevision] = useState(0),
    [mergeInto, setMergeInto] = useState<Record<string, string>>({}),
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
  }, [request, schemaRevision]);
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
  const inspect = useCallback((id: string) => {
    setSelected(id);
    setNotice("");
  }, []);
  const attributeTypes = useMemo(
    () =>
      Object.fromEntries(
        (schema?.relationships ?? [])
          .filter((r) => r.value)
          .map((r) => [r.id, r.value!.type]),
      ),
    [schema],
  );
  const provisional = useMemo(
    () =>
      new Set(
        (schema?.custom ?? [])
          .filter((p) => p.status === "provisional")
          .map((p) => p.id),
      ),
    [schema],
  );
  const drawn = useMemo(
    () => layout(visible, narrow, inspect, attributeTypes, provisional),
    [visible, narrow, inspect, attributeTypes, provisional],
  );
  const review = async (id: string, decision: string, into?: string) => {
    try {
      await action("review_predicate", { id, action: decision, into });
      setNotice(
        decision === "merge"
          ? `${id} merged into ${into}`
          : `${id} ${decision === "approve" ? "approved" : "rejected"}`,
      );
      setSchemaRevision((r) => r + 1);
      setRevision((r) => r + 1);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Review failed");
    }
  };
  const attributeCount = visible.filter(
    (c) => !c.object && c.value !== undefined,
  ).length;
  useEffect(() => {
    setNodes(drawn.nodes);
    setEdges(drawn.edges);
  }, [drawn, setNodes, setEdges]);
  const chosen = visible.find((c) => c.id === selected);
  const chosenNode = nodes.find((n) => n.id === selected);
  const chosenName =
    visible
      .flatMap((c) => [c.subject, ...(c.object ? [c.object] : [])])
      .find((e) => e.id === selected)?.name ?? "Entity";
  const neighbors = chosenNode
    ? visible.filter(
        (c) => c.subject.id === chosenNode.id || c.object?.id === chosenNode.id,
      )
    : [];
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
          ? `Selected ${c.object ? "relationship" : "attribute"} shared as a snapshot.`
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
            nodeTypes={nodeTypes}
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
              : `${quantity(nodes.length, "entity", "entities")} · ${quantity(edges.length, "relationship")} · ${quantity(attributeCount, "attribute")}`}
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
                <span className="kg-eyebrow">
                  {chosen.object ? "Relationship" : "Attribute"}
                </span>
                <h2>{chosen.subject.name}</h2>
                <div className="kg-assertion">
                  <code>
                    {not(chosen)}
                    {chosen.object
                      ? chosen.predicate
                      : attributeName(chosen.predicate)}
                    {provisional.has(chosen.predicate) ? " · provisional" : ""}
                  </code>
                  <span>{chosen.object ? "→" : "="}</span>
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
                        Share this{" "}
                        {chosen.object ? "relationship" : "attribute"}
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
                      {not(c)}
                      {c.object
                        ? label(c.predicate)
                        : attributeName(c.predicate)}{" "}
                      {c.object ? "→" : "="} {c.object?.name ?? c.value}
                    </span>
                  </button>
                ))}
              </>
            )}
          </aside>
        )}
      </div>
      <div className="kg-footer">
        <span>
          Attributes inside cards · arrows connect entities · select either for
          evidence
        </span>
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
            {!!schema?.custom?.length && (
              <>
                <h3>Proposed relationships</h3>
                <p className="kg-schema-note">
                  Added by extraction when no relationship fit. Provisional ones
                  are usable now and reused by later saves.
                  {schema.canReview
                    ? " Approve, merge or reject them."
                    : " An ontology reviewer approves, merges or rejects them."}
                </p>
                {schema.custom
                  .filter((p) => p.status !== "rejected")
                  .map((p) => (
                    <details key={p.id} open={p.status === "provisional"}>
                      <summary>
                        {p.id}{" "}
                        <small className={`kg-status ${p.status}`}>
                          {p.status === "merged"
                            ? `merged into ${p.mergedInto}`
                            : p.status}
                        </small>
                      </summary>
                      <p>{p.description}</p>
                      <code>
                        {p.from.join(" / ")} →{" "}
                        {p.value ? "value" : p.to.join(" / ")}
                      </code>
                      <p>
                        {quantity(p.claims, "claim")} ·{" "}
                        {quantity(p.authors, "author")}
                      </p>
                      {schema.canReview && p.status === "provisional" && (
                        <div className="kg-review">
                          <button onClick={() => review(p.id, "approve")}>
                            Approve
                          </button>
                          <select
                            aria-label={`Merge ${p.id} into`}
                            value={mergeInto[p.id] ?? ""}
                            onChange={(e) =>
                              setMergeInto((m) => ({
                                ...m,
                                [p.id]: e.target.value,
                              }))
                            }
                          >
                            <option value="">Merge into…</option>
                            {[
                              ...schema.relationships.filter(
                                (r) => r.group === "assertion",
                              ),
                              ...(schema.custom ?? []).filter(
                                (c) =>
                                  c.id !== p.id &&
                                  ["provisional", "approved"].includes(
                                    c.status,
                                  ),
                              ),
                            ]
                              .filter((r) => !!r.value === !!p.value)
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.id}
                                </option>
                              ))}
                          </select>
                          <button
                            disabled={!mergeInto[p.id]}
                            onClick={() =>
                              review(p.id, "merge", mergeInto[p.id])
                            }
                          >
                            Merge
                          </button>
                          <button
                            className="danger"
                            onClick={() => {
                              if (
                                confirm(
                                  `Reject ${p.id}? Its ${quantity(p.claims, "claim")} will be retired and withdrawn from spaces.`,
                                )
                              )
                                review(p.id, "reject");
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </details>
                  ))}
              </>
            )}
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
