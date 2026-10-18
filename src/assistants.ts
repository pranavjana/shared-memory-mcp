export interface AssistantIdentity {
  name: string;
  /** Clerk-hosted logo for a registered app; the dashboard supplies bundled logos for known clients. */
  logo: string | null;
  /**
   * metadata: name published at the client ID URL (domain-verified).
   * registration: name the app supplied when it registered with Clerk (self-reported).
   * dashboard: written in the Shared Memory dashboard.
   * unknown: no name available; show the client ID.
   */
  source: "metadata" | "registration" | "dashboard" | "unknown";
}
export type RegisteredApp = {
  name: string;
  clientImageUrl: string | null;
} | null;

// client_name values published in these client ID metadata documents.
const publishedNames: Record<string, string> = {
  "https://chatgpt.com/oauth/client.json": "ChatGPT",
  "https://chatgpt.com/oauth/codex/client.json": "Codex",
};
const ttl = 10 * 60_000;
const missTtl = 60_000;

export class AssistantDirectory {
  private cache = new Map<
    string,
    { value: AssistantIdentity; expires: number }
  >();
  constructor(
    /** Looks up an opaque (dynamically registered) client ID. */
    private lookup: (clientId: string) => Promise<RegisteredApp>,
  ) {}

  async identify(clientId: string): Promise<AssistantIdentity> {
    if (clientId === "dashboard")
      return { name: "Dashboard", logo: null, source: "dashboard" };
    if (publishedNames[clientId])
      return { name: publishedNames[clientId], logo: null, source: "metadata" };
    const url = urlClientId(clientId);
    if (url) return { name: url.hostname, logo: null, source: "metadata" };
    const cached = this.cache.get(clientId);
    if (cached && cached.expires > Date.now()) return cached.value;
    let app: RegisteredApp = null;
    try {
      // A slow lookup must not hold up the dashboard or a tool call.
      app = await Promise.race([
        this.lookup(clientId),
        new Promise<RegisteredApp>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 2000).unref(),
        ),
      ]);
    } catch {
      // Clerk unavailable: show the raw ID now and retry soon.
    }
    const value: AssistantIdentity = app?.name
      ? {
          name: app.name.slice(0, 80),
          logo: clerkImage(app.clientImageUrl),
          source: "registration",
        }
      : { name: clientId, logo: null, source: "unknown" };
    this.cache.set(clientId, {
      value,
      expires: Date.now() + (app?.name ? ttl : missTtl),
    });
    return value;
  }

  async identifyAll(clientIds: Iterable<string>) {
    const ids = [...new Set(clientIds)];
    const values = await Promise.all(ids.map((id) => this.identify(id)));
    return Object.fromEntries(ids.map((id, i) => [id, values[i]]));
  }
}

function urlClientId(clientId: string) {
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
// The dashboard CSP only allows Clerk-hosted images.
function clerkImage(url: string | null) {
  return url?.startsWith("https://img.clerk.com/") ? url : null;
}

/** Resolve opaque client IDs through the Clerk instance that registered them. */
export function clerkAssistantLookup(clerk: {
  oauthApplications: {
    list(params: { nameQuery: string; limit: number }): Promise<{
      data: { clientId: string; name: string; clientImageUrl: string | null }[];
    }>;
  };
}) {
  return async (clientId: string): Promise<RegisteredApp> => {
    // nameQuery matches an exact client ID or a name substring; keep only the exact ID.
    const { data } = await clerk.oauthApplications.list({
      nameQuery: clientId,
      limit: 10,
    });
    const app = data.find((a) => a.clientId === clientId);
    return app ? { name: app.name, clientImageUrl: app.clientImageUrl } : null;
  };
}
