import React, { useCallback, useEffect, useState } from "react";

type Action = (name: string, input: unknown) => Promise<any>;
interface Doorbell {
  id: string;
  label: string | null;
  host: string;
  createdAt: number;
  lastStatus: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  needsAttention: boolean;
}
type Host = "grok" | "muse" | "dot";
interface PulseLink {
  id: string;
  createdAt: number;
  lastUsedAt: number | null;
}

const hosts: { id: Host; name: string; blurb: string }[] = [
  {
    id: "grok",
    name: "Grok Bot",
    blurb:
      "Instant. Your Bot creates a webhook routine; paste its URL and Authorization header below.",
  },
  {
    id: "muse",
    name: "Muse",
    blurb:
      "About a minute. Muse creates a private check link and a hook that wakes it when something new arrives.",
  },
  {
    id: "dot",
    name: "Dot",
    blurb: "Your Dot checks for updates on a schedule it sets up itself.",
  },
];

const when = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "never";

function statusText(b: Doorbell) {
  if (b.needsAttention)
    return `Grok rejected the key (HTTP ${b.lastStatus}). Copy the Authorization header again.`;
  if (b.lastSuccessAt) return `Last delivered ${when(b.lastSuccessAt)}`;
  if (b.lastAttemptAt) return `Last attempt ${when(b.lastAttemptAt)} failed (HTTP ${b.lastStatus || "no response"})`;
  return "Not used yet. Press Send test.";
}

/** Lets a member make their own assistants notice shared updates. */
export function AssistantsView({
  action,
  doorbellsAvailable,
  onNotice,
  onError,
}: {
  action: Action;
  doorbellsAvailable: boolean;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [doorbells, setDoorbells] = useState<Doorbell[]>([]);
  const [links, setLinks] = useState<PulseLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [authorization, setAuthorization] = useState("");
  const [label, setLabel] = useState("");
  const load = useCallback(async () => {
    const [bells, pulse] = await Promise.all([
      action("doorbells", {}),
      action("pulse_links", {}),
    ]);
    setDoorbells(bells.doorbells ?? []);
    setLinks(pulse.links ?? []);
  }, [action]);
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
  const copyPrompt = (host: Host, name: string) =>
    run(async () => {
      const { prompt } = await action("assistant_setup", { host });
      try {
        await navigator.clipboard.writeText(prompt);
      } catch {
        throw new Error("Copy failed. Allow clipboard access and try again.");
      }
    }, `${name} setup prompt copied`);
  return (
    <div className="assistants-page">
      <p className="assistants-intro">
        Paste a setup prompt into your assistant once. It then tells you when
        someone shares something in your spaces, and every Shared Memory reply
        mentions unread updates.
      </p>
      <div className="assistants-grid">
        {hosts.map((h) => (
          <section className="panel" key={h.id} aria-labelledby={`host-${h.id}`}>
            <h2 id={`host-${h.id}`}>{h.name}</h2>
            <p>{h.blurb}</p>
            <button
              className="button small"
              disabled={busy}
              onClick={() => copyPrompt(h.id, h.name)}
            >
              Copy setup prompt
            </button>
            {h.id === "muse" && links.length > 0 && (
              <div className="doorbell-list" aria-label="Check links">
                {links.map((l) => (
                  <div className="record-row" key={l.id}>
                    <div>
                      <strong>Check link from {when(l.createdAt)}</strong>
                      <small>
                        {l.lastUsedAt
                          ? `Last checked ${when(l.lastUsedAt)}`
                          : "Not checked yet"}
                      </small>
                    </div>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => action("revoke_pulse_link", { id: l.id }),
                          "Check link revoked. Muse can no longer use it.",
                        )
                      }
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
            {h.id === "grok" &&
              (doorbellsAvailable ? (
                <>
                  <form
                    className="doorbell-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await action("add_doorbell", {
                          kind: "grok_webhook",
                          url: url.trim(),
                          authorization,
                          ...(label.trim() ? { label: label.trim() } : {}),
                        });
                        setUrl("");
                        setAuthorization("");
                        setLabel("");
                      }, "Grok Bot doorbell saved. Press Send test.");
                    }}
                  >
                    <label>
                      Webhook URL
                      <input
                        type="url"
                        required
                        inputMode="url"
                        autoComplete="off"
                        placeholder="https://…"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                      />
                    </label>
                    <label>
                      Authorization header
                      <input
                        type="password"
                        required
                        autoComplete="off"
                        placeholder="Bearer …"
                        value={authorization}
                        onChange={(e) => setAuthorization(e.target.value)}
                      />
                    </label>
                    <label>
                      Name (optional)
                      <input
                        maxLength={80}
                        placeholder="My Grok Bot"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                      />
                    </label>
                    <button className="button small" disabled={busy}>
                      Save doorbell
                    </button>
                  </form>
                  {doorbells.length > 0 && (
                    <div className="doorbell-list" aria-label="Saved doorbells">
                      {doorbells.map((b) => (
                        <div className="record-row" key={b.id}>
                          <div>
                            <strong>{b.label ?? b.host}</strong>
                            <small className={b.needsAttention ? "danger" : undefined}>
                              {statusText(b)}
                            </small>
                          </div>
                          <div className="button-row">
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  const r = await action("test_doorbell", { id: b.id });
                                  if (!r.ok)
                                    throw new Error(
                                      `Grok didn't accept the test (HTTP ${r.status || "no response"}). Check the URL and Authorization header.`,
                                    );
                                }, "Test sent. Your Bot should message you shortly.")
                              }
                            >
                              Send test
                            </button>
                            <button
                              className="text-button"
                              disabled={busy}
                              aria-label={`Remove ${b.label ?? b.host}`}
                              onClick={() =>
                                run(
                                  () => action("remove_doorbell", { id: b.id }),
                                  "Doorbell removed",
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="muted">
                  Instant Grok notifications are not enabled on this server.
                  Your Bot can still check on a schedule.
                </p>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
