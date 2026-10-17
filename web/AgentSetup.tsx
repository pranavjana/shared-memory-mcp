import React, { useEffect, useRef, useState } from "react";
import dotLogo from "./assets/dot.png";
import museLogo from "./assets/muse.svg";
import grokBotLogo from "./assets/grok-bot.png";

type AgentId = "dot" | "muse" | "grok-bot";
type Perform = (
  fn: () => Promise<unknown>,
  message?: string,
) => Promise<unknown>;
type Agent = {
  id: AgentId;
  name: string;
  maker: string;
  surface: string;
  logo: string;
  tile: "dark" | "light";
  connect: (mcpUrl: string) => React.ReactNode[];
  link?: { label: string; href: string };
  recall: string;
  manage: string;
};

// Proactive recall differs per agent because each host has its own scheduler.
const agents: Agent[] = [
  {
    id: "dot",
    name: "Dot",
    maker: "OpenAI",
    surface: "Runs in ChatGPT",
    logo: dotLogo,
    tile: "dark",
    connect: () => [
      <>
        In ChatGPT, open Plugins, select <strong>+</strong>, then{" "}
        <strong>Add custom MCP server</strong>.
      </>,
      <>
        Name it Shared Memory, paste the MCP URL, and choose OAuth. Leave the
        client ID and secret blank.
      </>,
      <>
        Create the plugin, sign in with your Shared Memory account, then give
        your dot the install prompt to verify the connection.
      </>,
    ],
    link: {
      label: "Open ChatGPT Plugins",
      href: "https://chatgpt.com/plugins",
    },
    recall:
      "Your dot keeps working between conversations. This gives it a standing responsibility to check your shared spaces and message you when a teammate shares something.",
    manage: "Ask your dot to show, change, or stop the check at any time.",
  },
  {
    id: "muse",
    name: "Muse",
    maker: "Meta",
    surface: "Muse app and WhatsApp",
    logo: museLogo,
    tile: "light",
    connect: () => [
      <>
        Paste the install prompt into a Muse chat. Muse registers a custom
        connector with OAuth.
      </>,
      <>
        Sign in with your Shared Memory account when Muse asks, and confirm the
        account it reports back.
      </>,
      <>
        Connectors live in Muse <strong>Settings → Connectors</strong>.
      </>,
    ],
    recall:
      "Muse runs recurring tasks even when the app is closed. This sets up a custom-interval check that messages you in your Muse conversation.",
    manage: "Find or cancel the check in Muse’s Upcoming tab.",
  },
  {
    id: "grok-bot",
    name: "Grok Bot",
    maker: "xAI",
    surface: "Desktop and iOS",
    logo: grokBotLogo,
    tile: "dark",
    connect: (mcpUrl) => [
      <>
        Message your bot:{" "}
        <q>Add a custom MCP server called Shared Memory at {mcpUrl}</q>, then
        select <strong>Add it</strong>.
      </>,
      <>
        Select <strong>Authorize</strong> on the connect card and sign in with
        your Shared Memory account.
      </>,
      <>
        Paste the install prompt so the bot verifies the connection. Added
        servers are in <strong>Settings → Plugins → Yours</strong>.
      </>,
    ],
    recall:
      "Grok Bot routines run in the cloud, even when your devices are off. This creates a routine that checks your shared spaces on a schedule.",
    manage: "Review, edit, or stop the routine from any device with Grok Bot.",
  },
];
const storageKey = "shared-memory.agent";
const initialAgent = (): AgentId => {
  const saved = localStorage.getItem(storageKey);
  return agents.some((a) => a.id === saved) ? (saved as AgentId) : "dot";
};

function AgentLogo({ agent, size }: { agent: Agent; size: "sm" | "lg" }) {
  return (
    <span className={`agent-logo ${agent.tile} ${size}`} aria-hidden="true">
      <img src={agent.logo} alt="" />
    </span>
  );
}

function CopyIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </svg>
  );
}

async function fetchText(path: string, label: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load the ${label}. Try again.`);
  return response.text();
}

export function AgentSetup({
  mcpUrl,
  busy,
  perform,
}: {
  mcpUrl: string;
  busy: boolean;
  perform: Perform;
}) {
  const [selected, setSelected] = useState<AgentId>(initialAgent);
  const [installPrompt, setInstallPrompt] = useState("");
  const [recallPrompts, setRecallPrompts] = useState<
    Partial<Record<AgentId, string>>
  >({});
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const agent = agents.find((a) => a.id === selected)!;
  useEffect(() => {
    localStorage.setItem(storageKey, selected);
  }, [selected]);
  useEffect(() => {
    let current = true;
    fetchText("/setup/prompt", "MCP install prompt")
      .then((text) => current && setInstallPrompt(text))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (recallPrompts[selected]) return;
    let current = true;
    fetchText(`/setup/recall-prompt/${selected}`, "proactive recall prompt")
      .then(
        (text) =>
          current && setRecallPrompts((p) => ({ ...p, [selected]: text })),
      )
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [selected, recallPrompts]);
  const select = (index: number) => {
    const next = agents[(index + agents.length) % agents.length];
    setSelected(next.id);
    tabs.current[next.id]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const index = agents.findIndex((a) => a.id === selected);
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: agents.length - 1,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    select(moves[e.key]);
  };
  const copy = (load: () => Promise<string>, message: string) =>
    perform(async () => {
      await navigator.clipboard.writeText(await load());
    }, message);
  const recallPrompt = recallPrompts[selected];

  return (
    <section className="agent-setup" aria-labelledby="agent-setup-title">
      <header className="agent-setup-header">
        <h2 id="agent-setup-title">Set up your agent</h2>
        <p>
          Every agent connects the same way. Proactive recall uses each agent’s
          own scheduler, so pick the one you use.
        </p>
      </header>
      <div
        role="tablist"
        aria-label="Agent"
        className="agent-tabs"
        onKeyDown={onKeyDown}
      >
        {agents.map((a) => (
          <button
            key={a.id}
            ref={(el) => {
              tabs.current[a.id] = el;
            }}
            role="tab"
            id={`agent-tab-${a.id}`}
            aria-controls="agent-panel"
            aria-selected={a.id === selected}
            tabIndex={a.id === selected ? 0 : -1}
            className="agent-tab"
            onClick={() => setSelected(a.id)}
          >
            <AgentLogo agent={a} size="sm" />
            <span className="agent-tab-label">
              <strong>{a.name}</strong>
              <small>{a.maker}</small>
            </span>
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="agent-panel"
        aria-labelledby={`agent-tab-${agent.id}`}
        className="agent-panel"
      >
        <div className="agent-panel-heading">
          <AgentLogo agent={agent} size="lg" />
          <div>
            <h3>{agent.name}</h3>
            <p>
              {agent.maker} · {agent.surface}
            </p>
          </div>
        </div>

        <ol className="setup-steps" aria-label={`${agent.name} setup`}>
          <li>
            <span className="setup-node" aria-hidden="true">
              1
            </span>
            <div className="setup-content">
              <h2>Connect Shared Memory</h2>
              <ol className="agent-steps">
                {agent.connect(mcpUrl).map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              <div className="button-row">
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() =>
                    copy(async () => {
                      const text =
                        installPrompt ||
                        (await fetchText(
                          "/setup/prompt",
                          "MCP install prompt",
                        ));
                      setInstallPrompt(text);
                      return text;
                    }, "MCP install prompt copied")
                  }
                >
                  <CopyIcon />
                  Copy install prompt
                </button>
                {agent.link && (
                  <a
                    className="text-button"
                    href={agent.link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {agent.link.label}
                  </a>
                )}
              </div>
              <div className="code-copy">
                <code>{mcpUrl}</code>
                <button
                  className="icon-button"
                  disabled={busy}
                  aria-label="Copy MCP URL"
                  onClick={() => copy(async () => mcpUrl, "MCP URL copied")}
                >
                  <CopyIcon />
                </button>
              </div>
            </div>
          </li>
          <li>
            <span className="setup-node" aria-hidden="true">
              2
            </span>
            <div className="setup-content">
              <h2>Install the memory skill</h2>
              <p>
                Teach {agent.name} when to save, recall, correct, and share
                memories. Add it through skill support or persistent
                instructions; a chat paste applies to that chat only.
              </p>
              <div className="button-row">
                <a className="button small" href="/skill/SKILL.md">
                  Download skill
                </a>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    copy(
                      () => fetchText("/skill", "memory skill"),
                      "Memory skill instructions copied",
                    )
                  }
                >
                  Copy skill instructions
                </button>
              </div>
            </div>
          </li>
          <li>
            <span className="setup-node" aria-hidden="true">
              3
            </span>
            <div className="setup-content">
              <h2>Turn on proactive recall</h2>
              <p>{agent.recall}</p>
              <div className="button-row">
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() =>
                    copy(async () => {
                      const text =
                        recallPrompt ||
                        (await fetchText(
                          `/setup/recall-prompt/${agent.id}`,
                          "proactive recall prompt",
                        ));
                      setRecallPrompts((p) => ({ ...p, [agent.id]: text }));
                      return text;
                    }, `${agent.name} recall prompt copied`)
                  }
                >
                  <CopyIcon />
                  Copy {agent.name} recall prompt
                </button>
              </div>
              <p className="setup-note">
                Checks every 30 minutes and stays silent when nothing is new.
                Each check uses your agent’s own usage. {agent.manage}
              </p>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}
