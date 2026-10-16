import React, { useEffect, useState } from "react";
type Setup = {
  prompt: string;
  eventsAvailable: boolean;
  subscriptions: {
    id: string;
    eventName: string;
    clientId: string;
    expiresAt: number;
  }[];
};
export function NotificationSetup({
  spaceId,
  action,
}: {
  spaceId: string;
  action: (name: string, input: unknown) => Promise<any>;
}) {
  const [host, setHost] = useState<"muse" | "dot">("dot");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState(""),
    [copied, setCopied] = useState(false),
    [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setSetup(null);
    setError("");
    setCopied(false);
    action("notification_setup", { spaceId, host })
      .then((r) => {
        if (active) setSetup(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [spaceId, host, action, refresh]);
  return (
    <section
      className="panel notification-setup"
      aria-label="Agent notifications"
    >
      <div className="drawer-top">
        <h3>Agent notifications</h3>
        <div className="button-row">
          {(["dot", "muse"] as const).map((h) => (
            <button
              key={h}
              className="text-button"
              aria-pressed={h === host}
              onClick={() => setHost(h)}
            >
              {h === "dot" ? "Dot" : "Muse"}
            </button>
          ))}
        </div>
      </div>
      <p className="subtle">
        {host === "dot"
          ? "Paste the setup prompt in your Dot or a Cloud Work chat."
          : "Paste the setup prompt in Muse. It will check whether it can receive webhook events."}
      </p>
      <div className="button-row">
        <button
          className="button small"
          disabled={!setup?.eventsAvailable}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(setup!.prompt);
              setCopied(true);
            } catch {
              setError("Could not copy. Select the prompt below.");
            }
          }}
        >
          {copied ? "Copied" : "Copy setup prompt"}
        </button>
        <button
          className="text-button"
          onClick={() => setRefresh((r) => r + 1)}
        >
          Refresh status
        </button>
      </div>
      {setup && !setup.eventsAvailable && (
        <p role="status">Webhook events are unavailable on this deployment.</p>
      )}
      {setup && (
        <details>
          <summary>Setup prompt</summary>
          <pre className="notification-prompt">{setup.prompt}</pre>
        </details>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {!setup && !error && (
        <p role="status" className="subtle">
          Checking subscriptions…
        </p>
      )}
      {setup && (
        <div className="notification-subscriptions">
          <h4>Your subscriptions in this space</h4>
          {setup.subscriptions.length === 0 && (
            <p className="subtle">
              No active subscriptions. Copying the prompt does not start
              monitoring.
            </p>
          )}
          {setup.subscriptions.map((s) => (
            <div className="record-row" key={s.id}>
              <div>
                <strong>
                  {s.eventName === "knowledge.changed"
                    ? "Selected claims"
                    : "Shared memories"}
                </strong>
                <small>Expires {new Date(s.expiresAt).toLocaleString()}</small>
              </div>
              <button
                className="text-button danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await action("unsubscribe", { id: s.id });
                    setRefresh((r) => r + 1);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not stop monitoring",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Stop
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="setup-note">
        Subscribe to both shared memories and selected claims. Webhook receipt
        appears in Activity; verify the agent’s message in its own chat.
      </p>
    </section>
  );
}
