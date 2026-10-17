import { createApp } from "./app.js";
import { createClerkClient } from "@clerk/express";
import { connectUserStore } from "./users.js";
import { connectMemoryStore } from "./memory.js";
import { backfillUsers } from "./clerk-users.js";
import { AutomaticOntology } from "./ontology-extraction.js";
import { DoorbellService } from "./doorbells.js";

for (const key of [
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_ACCOUNT_PORTAL_URL",
]) {
  if (!process.env[key])
    throw new Error(`Missing required environment variable: ${key}`);
}
const publicUrl =
  process.env.PUBLIC_URL ??
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : "http://localhost:3000");
if (process.env.NODE_ENV === "production" && !publicUrl.startsWith("https://"))
  throw new Error("PUBLIC_URL must use HTTPS in production");
const port = Number(process.env.PORT ?? 3000);
const users = await connectUserStore();
const memory = await connectMemoryStore();
const automaticOntology = new AutomaticOntology(memory);
const ontologyWorker = setInterval(() => {
  void automaticOntology
    .tick()
    .catch(() => console.error("Ontology processing tick failed"));
}, 5000);
ontologyWorker.unref();
// Doorbells are optional: without a key, members can still read their inbox on demand.
const doorbells = process.env.DOORBELL_ENCRYPTION_KEY
  ? new DoorbellService(memory, process.env.DOORBELL_ENCRYPTION_KEY, publicUrl)
  : undefined;
const ringDoorbells = () => {
  void doorbells?.ring().catch(() => console.error("Doorbell delivery failed"));
};
// Ring as soon as a share commits; the interval retries failed deliveries.
memory.onChange(ringDoorbells);
const doorbellWorker = setInterval(ringDoorbells, 15000);
doorbellWorker.unref();
const server = createApp(
  {
    publicUrl,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY!,
    secretKey: process.env.CLERK_SECRET_KEY!,
    accountPortalUrl: process.env.CLERK_ACCOUNT_PORTAL_URL!,
    webhookSigningSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
  },
  { users, memory, automaticOntology, doorbells },
).listen(port, "0.0.0.0", () =>
  console.log(`Shared Memory MCP listening on port ${port}`),
);
void backfillUsers(
  users,
  createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY!,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY!,
  }),
)
  .then((count) => console.log(`Synced ${count} Clerk user profiles`))
  .catch(() =>
    console.error(
      "Clerk user backfill failed; retry by restarting the service",
    ),
  );
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    clearInterval(ontologyWorker);
    clearInterval(doorbellWorker);
    server.close(() => {
      void Promise.all([users.close(), memory.close()]).finally(() =>
        process.exit(0),
      );
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
