// Muse registrations in our Clerk instance; opaque IDs carry no app name.
const museClientIds = new Set([
  "Mz1lRFME372kmUIB",
  "AxgqrHF5QB08oV37",
  "nGyKi3rPUIuFKH76",
  "AqmpDhak10k9TtSl",
]);
export type AssistantKind = "codex" | "muse" | "other";
export function assistantName(clientId: string): {
  name: string;
  kind: AssistantKind;
} {
  // Identity published by Codex's OAuth client metadata.
  if (clientId === "https://chatgpt.com/oauth/codex/client.json") {
    return { name: "Codex", kind: "codex" };
  }
  if (museClientIds.has(clientId)) {
    return { name: "Muse", kind: "muse" };
  }
  try {
    const url = new URL(clientId);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return { name: url.hostname, kind: "other" };
    }
  } catch {
    // Opaque OAuth IDs do not provide a verified assistant name.
  }
  return { name: "Assistant", kind: "other" };
}
// sourceClient records the client of the latest revision.
export function sourceLabel(clientId: string) {
  if (clientId === "dashboard") return "Added in dashboard";
  const { name } = assistantName(clientId);
  return name === "Assistant" ? `Assistant (${clientId})` : name;
}
