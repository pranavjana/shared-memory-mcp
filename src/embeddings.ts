import { createHash } from "node:crypto";

export interface Embedder {
  signature: string;
  dimensions: number;
  embed(text: string, kind: "query" | "document"): Promise<number[]>;
}
export function normalizeVector(raw: unknown, dimensions: number): number[] {
  if (
    !Array.isArray(raw) ||
    raw.length !== dimensions ||
    raw.some((x) => typeof x !== "number" || !Number.isFinite(x))
  )
    throw new Error("Invalid embedding dimensions or values");
  const norm = Math.hypot(...raw);
  if (!norm) throw new Error("Empty embedding");
  return raw.map((x) => x / norm);
}
// Embedding 2 uses text instructions, not Embedding 001's taskType field.
export const embeddingText = (text: string, kind: "query" | "document") =>
  kind === "query"
    ? `task: search result | query: ${text}`
    : `title: personal memory | text: ${text}`;
export function configuredEmbedder(
  env = process.env,
  request: typeof fetch = fetch,
): Embedder | undefined {
  const provider =
    env.EMBEDDING_PROVIDER ??
    (env.OPENROUTER_API_KEY ? "openrouter" : "disabled");
  if (provider === "disabled") return;
  if (provider !== "openrouter" && provider !== "gemini")
    throw new Error("Unsupported EMBEDDING_PROVIDER");
  const key =
    provider === "openrouter" ? env.OPENROUTER_API_KEY : env.GEMINI_API_KEY;
  if (!key) return;
  const model =
    provider === "openrouter"
      ? "google/gemini-embedding-2"
      : "gemini-embedding-2";
  const dimensions = 768;
  const signature = createHash("sha256")
    .update(`${provider}:${model}:${dimensions}:retrieval-prefix-v1`)
    .digest("hex")
    .slice(0, 16);
  return {
    signature,
    dimensions,
    async embed(text, kind) {
      const input = embeddingText(text, kind);
      const response = await request(
        provider === "openrouter"
          ? "https://openrouter.ai/api/v1/embeddings"
          : "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent",
        {
          method: "POST",
          signal: AbortSignal.timeout(8000),
          headers: {
            "Content-Type": "application/json",
            ...(provider === "openrouter"
              ? { Authorization: `Bearer ${key}` }
              : { "x-goog-api-key": key }),
          },
          body: JSON.stringify(
            provider === "openrouter"
              ? {
                  model,
                  input: [input],
                  dimensions,
                  encoding_format: "float",
                  provider: {
                    require_parameters: true,
                    ...(env.EMBEDDING_OPENROUTER_IGNORE
                      ? {
                          ignore: env.EMBEDDING_OPENROUTER_IGNORE.split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }
                      : {}),
                  },
                }
              : {
                  content: { parts: [{ text: input }] },
                  outputDimensionality: dimensions,
                },
          ),
        },
      );
      // Provider error bodies can contain submitted text or credentials. Never echo them.
      if (!response.ok)
        throw new Error(`Embedding provider unavailable (${response.status})`);
      const result = (await response.json()) as any;
      return normalizeVector(
        provider === "openrouter"
          ? result.data?.[0]?.embedding
          : result.embedding?.values,
        dimensions,
      );
    },
  };
}
