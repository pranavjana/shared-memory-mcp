import React, { useEffect, useMemo, useState } from "react";
import type {
  TypeDefinition,
  RelationDefinition,
  PropertyDefinition,
} from "../src/ontology";
import type { Claim } from "../src/knowledge";

type Schema = {
  version: string;
  types: TypeDefinition[];
  relationships: RelationDefinition[];
  rules: string[];
};
type Space = { id: string; name: string; role: string };
function NodeMark({ type }: { type: string }) {
  return (
    <span className={`ontology-mark ontology-mark-${type}`} aria-hidden="true">
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      >
        <path
          d={
            type === "person"
              ? "M6 15c0-5 8-5 8 0M13 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0"
              : type === "task"
                ? "m6 10 3 3 5-6M3 3h14v14H3z"
                : type === "project"
                  ? "M3 5h6l2 2h6v9H3z"
                  : type === "claim"
                    ? "M4 4h12v9H9l-4 3v-3H4z"
                    : type === "space"
                      ? "M4 7h12v9H4zM7 7V4h6v3"
                      : "M10 2 17 6v8l-7 4-7-4V6zM3 6l7 4 7-4M10 10v8"
          }
        />
      </svg>
    </span>
  );
}
function Properties({ properties }: { properties: PropertyDefinition[] }) {
  return (
    <div className="ontology-table-scroll">
      <table className="ontology-table">
        <thead>
          <tr>
            <th>Property</th>
            <th>Type</th>
            <th>Definition</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((p) => (
            <tr key={p.name}>
              <td>
                <code>{p.name}</code>
                {p.required && (
                  <span className="ontology-required" title="Required">
                    *
                  </span>
                )}
              </td>
              <td>
                <span className="ontology-property-type">{p.type}</span>
              </td>
              <td>
                {p.description}
                {p.values && (
                  <div className="ontology-enums">
                    {p.values.map((v) => (
                      <code key={v}>{v}</code>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function TypeMap({
  selected,
  schema,
  onSelect,
}: {
  selected: TypeDefinition;
  schema: Schema;
  onSelect: (id: string) => void;
}) {
  const relations = schema.relationships.filter((r) =>
    r.from.includes(selected.id),
  );
  const specific = relations.filter((r) => r.id !== "ABOUT");
  const mapped = specific.length ? specific : relations;
  const targets = [...new Set(mapped.flatMap((r) => r.to))].slice(0, 6);
  const scalar = relations.filter((r) => r.value);
  return (
    <div
      className="ontology-map"
      aria-label={`Allowed outgoing relationships for ${selected.name}`}
    >
      <div className="ontology-map-source">
        <NodeMark type={selected.id} />
        <strong>{selected.name}</strong>
        <span>{relations.length} outgoing</span>
      </div>
      <div className="ontology-map-targets">
        {targets.map((id) => {
          const type = schema.types.find((t) => t.id === id)!;
          const labels = mapped
            .filter((r) => r.to.includes(id))
            .map((r) => r.id);
          return (
            <div className="ontology-map-path" key={id}>
              <div className="ontology-path-label">
                <span>
                  {labels.slice(0, 2).join(" · ")}
                  {labels.length > 2 ? ` +${labels.length - 2}` : ""}
                </span>
                <i aria-hidden="true" />
              </div>
              <button onClick={() => onSelect(id)}>
                <NodeMark type={id} />
                <span>{type.name}</span>
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          );
        })}
        {scalar.length > 0 && (
          <div className="ontology-map-path">
            <div className="ontology-path-label">
              <span>Value predicates</span>
              <i aria-hidden="true" />
            </div>
            <div className="ontology-value-node">
              {scalar.map((r) => (
                <code key={r.id}>{r.id}</code>
              ))}
            </div>
          </div>
        )}
        {targets.length === 0 && scalar.length === 0 && (
          <p className="ontology-no-links">No outgoing relationships.</p>
        )}
        {(new Set(mapped.flatMap((r) => r.to)).size > 6 ||
          specific.length !== relations.length) && (
          <p className="ontology-map-caption">
            Selected destinations · full list below
          </p>
        )}
      </div>
    </div>
  );
}
export function OntologyView({
  request,
  action,
  spaces,
  userId,
}: {
  request: (path: string) => Promise<any>;
  action: (name: string, input: unknown) => Promise<any>;
  spaces: Space[];
  userId: string;
}) {
  const [schema, setSchema] = useState<Schema | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("types"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState("task"),
    [scope, setScope] = useState(""),
    [claims, setClaims] = useState<Claim[]>([]),
    [loading, setLoading] = useState(false),
    [truncated, setTruncated] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    request("ontology")
      .then((s) => {
        if (active) setSchema(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [request]);
  useEffect(() => {
    if (tab !== "knowledge") return;
    let active = true;
    setLoading(true);
    setError("");
    setClaims([]);
    setTruncated(false);
    action("recall_knowledge", {
      query: search,
      ...(scope ? { spaceId: scope } : {}),
      limit: 50,
    })
      .then((r) => {
        if (active) {
          setClaims(r.claims);
          setTruncated(r.truncated);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, scope, search, action]);
  const visible = useMemo(
    () =>
      schema?.types.filter((t) =>
        [t.name, t.description, ...t.properties.map((p) => p.name)]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
      ) ?? [],
    [schema, search],
  );
  if (!schema)
    return (
      <div className="ontology-loading" role="status">
        {error || "Loading ontology…"}
      </div>
    );
  const type = schema.types.find((t) => t.id === selected)!;
  const related = schema.relationships.filter(
    (r) => r.from.includes(type.id) || r.to.includes(type.id),
  );
  const openType = (id: string) => {
    setSelected(id);
    setSearch("");
    setTab("types");
  };
  const publish = async (c: Claim, spaceId: string, enabled = true) => {
    setError("");
    setNotice("");
    setLoading(true);
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
          ? "Selected claim published as a snapshot."
          : "Publication is retracted.",
      );
      const read = await action("recall_knowledge", {
        query: search,
        ...(scope ? { spaceId: scope } : {}),
        limit: 50,
      });
      setClaims(read.claims);
      setTruncated(read.truncated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update publication");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="ontology-page">
      <div className="ontology-toolbar">
        <div className="ontology-tabs" role="group" aria-label="Ontology view">
          {[
            ["types", "Node types"],
            ["relations", "Relationships"],
            ["knowledge", "Knowledge"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={tab === id}
              className={tab === id ? "selected" : ""}
              onClick={() => {
                setTab(id);
                setSearch("");
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ontology-version">
          <span />
          Schema {schema.version}
        </span>
      </div>
      <div className="ontology-search-row">
        <label className="ontology-search">
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
          >
            <circle cx="8" cy="8" r="5.5" />
            <path d="m12 12 5 5" />
          </svg>
          <input
            aria-label="Search ontology"
            placeholder={
              tab === "knowledge"
                ? "Search saved claims…"
                : "Search types, properties, relationships…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              aria-label="Clear ontology search"
              onClick={() => setSearch("")}
            >
              ×
            </button>
          )}
        </label>
        <span className="ontology-count">
          {tab === "types"
            ? `${schema.types.length} types`
            : tab === "relations"
              ? `${schema.relationships.length} relationships`
              : "Authorized claims"}
        </span>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="ontology-notice">
          {notice}
        </p>
      )}
      {tab === "types" && (
        <div className="ontology-browser">
          <aside className="ontology-type-list" aria-label="Node types">
            {["domain", "system"].map((group) => (
              <div key={group}>
                <div className="ontology-group-label">
                  {group === "domain" ? "Entities" : "Memory & access"}
                </div>
                {visible
                  .filter((t) => t.group === group)
                  .map((t) => (
                    <button
                      key={t.id}
                      className={selected === t.id ? "selected" : ""}
                      aria-pressed={selected === t.id}
                      onClick={() => setSelected(t.id)}
                    >
                      <NodeMark type={t.id} />
                      <span>{t.name}</span>
                      <small>{t.properties.length}</small>
                    </button>
                  ))}
              </div>
            ))}
            {!visible.length && (
              <p className="ontology-no-links">No matching types.</p>
            )}
          </aside>
          <section
            className="ontology-inspector"
            aria-label={`${type.name} schema`}
          >
            <div className="ontology-type-heading">
              <NodeMark type={type.id} />
              <div>
                <h2>{type.name}</h2>
                <p>{type.description}</p>
              </div>
              <span className="ontology-badge">
                {type.group === "domain" ? "Entity" : "System"}
              </span>
            </div>
            <TypeMap selected={type} schema={schema} onSelect={openType} />
            <div className="ontology-section-label">
              Allowed properties <span>{type.properties.length}</span>
            </div>
            <Properties properties={type.properties} />
            <div className="ontology-section-label">
              Relationships <span>{related.length}</span>
            </div>
            <div className="ontology-relation-list">
              {related.map((r) => (
                <RelationRow
                  key={r.id}
                  relation={r}
                  schema={schema}
                  onSelect={openType}
                  selected={type.id}
                />
              ))}
            </div>
          </section>
        </div>
      )}
      {tab === "relations" && (
        <div className="ontology-all-relations">
          {schema.relationships
            .filter((r) =>
              [r.id, r.description, ...r.from, ...r.to]
                .join(" ")
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((r) => (
              <RelationRow
                key={r.id}
                relation={r}
                schema={schema}
                onSelect={openType}
              />
            ))}
          {!schema.relationships.some((r) =>
            [r.id, r.description, ...r.from, ...r.to]
              .join(" ")
              .toLowerCase()
              .includes(search.toLowerCase()),
          ) && <p className="ontology-no-links">No matching relationships.</p>}
        </div>
      )}
      {tab === "knowledge" && (
        <section className="ontology-knowledge">
          <div className="ontology-knowledge-toolbar">
            <select
              aria-label="Knowledge scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="">Personal & authorized spaces</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <span className="ontology-count">
              {loading ? "Loading…" : `${claims.length} claims`}
            </span>
          </div>
          {!loading && !claims.length && (
            <div className="ontology-empty">
              <NodeMark type="claim" />
              <h2>No structured claims yet</h2>
              <p>
                Ask your connected agent to read the ontology, then structure a
                saved memory. Existing memories stay available in Memories.
              </p>
              <code>get_ontology → record_knowledge → recall_knowledge</code>
            </div>
          )}
          {claims.map((c) => (
            <details key={c.id} className="ontology-claim">
              <summary>
                <span className="ontology-claim-line">
                  <strong>{c.subject.name}</strong>
                  <code>{c.predicate}</code>
                  <span>{c.object?.name ?? c.value}</span>
                </span>
                <span className="ontology-claim-meta">
                  {c.authorName} ·{" "}
                  {c.scope === "space" ? "Shared snapshot" : "Private"} ·{" "}
                  {c.basis}
                  {c.status !== "active" ? ` · ${c.status}` : ""}
                </span>
              </summary>
              <blockquote>{c.evidence}</blockquote>
              <dl>
                <dt>Source revision</dt>
                <dd>{c.sourceRevision}</dd>
                <dt>Captured by</dt>
                <dd>{c.sourceClient}</dd>
                <dt>Recorded</dt>
                <dd>{new Date(c.recordedAt).toLocaleString()}</dd>
                {c.validFrom && (
                  <>
                    <dt>Valid from</dt>
                    <dd>{new Date(c.validFrom).toLocaleString()}</dd>
                  </>
                )}
                {c.validUntil && (
                  <>
                    <dt>Valid until</dt>
                    <dd>{new Date(c.validUntil).toLocaleString()}</dd>
                  </>
                )}
              </dl>
              {c.authorId === userId &&
                c.scope === "personal" &&
                spaces.some((s) => s.role !== "reader") && (
                  <form
                    className="ontology-publish"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      publish(c, String(f.get("spaceId")));
                    }}
                  >
                    <select
                      name="spaceId"
                      aria-label={`Destination for ${c.subject.name}`}
                    >
                      {spaces
                        .filter((s) => s.role !== "reader")
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                    <button className="button small" disabled={loading}>
                      Publish selected claim
                    </button>
                    <p>
                      Publishes this assertion, its excerpt and entity names.
                      Private source text and other claims stay private.
                    </p>
                  </form>
                )}
              {c.authorId === userId && c.scope === "space" && (
                <button
                  className="text-button"
                  disabled={loading}
                  onClick={() => publish(c, c.spaceId!, false)}
                >
                  Retract snapshot
                </button>
              )}
            </details>
          ))}
          {truncated && (
            <p className="ontology-notice">
              Results are limited. Narrow the search or select a space.
            </p>
          )}
        </section>
      )}
      <details className="ontology-rules">
        <summary>Scope & lifecycle rules</summary>
        <ul>
          {schema.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
function RelationRow({
  relation: r,
  schema,
  onSelect,
  selected,
}: {
  relation: RelationDefinition;
  schema: Schema;
  onSelect: (id: string) => void;
  selected?: string;
}) {
  const names = (ids: string[]) =>
    ids.map((id) => (
      <button
        key={id}
        onClick={() => onSelect(id)}
        className={selected === id ? "current" : ""}
      >
        {schema.types.find((t) => t.id === id)?.name ?? id}
      </button>
    ));
  return (
    <div className="ontology-relation-row">
      <div className="ontology-relation-name">
        <code>{r.id}</code>
        <span className="ontology-relation-kind">
          {r.group === "assertion" ? "Claim predicate" : "System link"}
        </span>
      </div>
      <div className="ontology-relation-endpoints">
        <div>{names(r.from)}</div>
        <span aria-hidden="true">→</span>
        <div>
          {r.value ? (
            <span className="ontology-property-type">{r.value.type}</span>
          ) : (
            names(r.to)
          )}
        </div>
      </div>
      <p>{r.description}</p>
      {r.value?.values && (
        <div className="ontology-enums">
          {r.value.values.map((v) => (
            <code key={v}>{v}</code>
          ))}
        </div>
      )}
      {r.properties && <Properties properties={r.properties} />}
    </div>
  );
}
