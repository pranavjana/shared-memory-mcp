// Names come from the server (client metadata or the app's Clerk registration).
// These fallbacks cover records the server did not resolve.
export type ResolvedAssistant = {
  name: string;
  logo: string | null;
  source: "metadata" | "registration" | "dashboard" | "unknown";
};
const publishedNames: Record<string, string> = {
  "https://chatgpt.com/oauth/client.json": "ChatGPT",
  "https://chatgpt.com/oauth/codex/client.json": "Codex",
};
export function displayAssistant(
  clientId: string,
  resolved?: ResolvedAssistant,
) {
  const url = httpsUrl(clientId);
  const known =
    resolved && resolved.source !== "unknown"
      ? resolved.name
      : clientId === "dashboard"
        ? "Dashboard"
        : (publishedNames[clientId] ?? url?.hostname);
  return {
    name: known ?? "Assistant",
    known: !!known,
    logo: resolved?.logo ?? null,
    // OpenAI clients have no Clerk-hosted logo; the dashboard bundles one.
    openai: url?.hostname === "chatgpt.com",
    title:
      clientId +
      (resolved?.source === "registration"
        ? " · name registered by the app"
        : ""),
  };
}
// sourceClient records the client of the latest revision.
export function sourceLabel(clientId: string, resolved?: ResolvedAssistant) {
  if (clientId === "dashboard") return "Added in dashboard";
  const a = displayAssistant(clientId, resolved);
  return a.known ? a.name : `Assistant (${clientId})`;
}
function httpsUrl(clientId: string) {
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
