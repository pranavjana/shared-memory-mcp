import { test } from "node:test";
import assert from "node:assert/strict";
// The deployed operator script is JavaScript and deliberately has no production fallback.
// @ts-ignore JavaScript operator entrypoint.
import { assertSandbox } from "../scripts/sandbox-seed.mjs";

test("sandbox operator refuses production and mixed environment targets before connecting", () => {
  const sandbox = {
    APP_ENV: "sandbox",
    RAILWAY_ENVIRONMENT_NAME: "sandbox",
    FALKORDB_GRAPH: "sandbox_profiles",
    FALKORDB_MEMORY_GRAPH: "sandbox_memory",
    SANDBOX_CLERK_APP_ID: "app_3Kkji888RWnY1TIAjHITY6ZaF92",
    SANDBOX_CLERK_INSTANCE_ID: "ins_3KkjiF7zViWlDNsHyTasXpqvaCC",
    CLERK_SECRET_KEY: "sk_test_synthetic",
    CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("up-burro-4657.clerk.accounts.dev$").toString("base64")}`,
  };
  assert.doesNotThrow(() => assertSandbox(sandbox));
  for (const overrides of [
    { RAILWAY_ENVIRONMENT_NAME: "production" },
    { APP_ENV: "production" },
    { FALKORDB_GRAPH: "shared_memory" },
    { FALKORDB_MEMORY_GRAPH: "production_memory" },
    { SANDBOX_CLERK_INSTANCE_ID: "ins_production" },
    { SANDBOX_CLERK_APP_ID: "app_other" },
    { CLERK_SECRET_KEY: "sk_live_synthetic" },
    {
      CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("other.clerk.accounts.dev$").toString("base64")}`,
    },
  ])
    assert.throws(
      () => assertSandbox({ ...sandbox, ...overrides }),
      /Seed refused/,
    );
  assert.throws(() => assertSandbox({}), /Seed refused/);
});
