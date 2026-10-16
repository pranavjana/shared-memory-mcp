import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createClerkClient } from "@clerk/express";

export function assertSandbox(env) {
  if (
    env.APP_ENV !== "sandbox" ||
    env.RAILWAY_ENVIRONMENT_NAME !== "sandbox" ||
    env.RAILWAY_ENVIRONMENT_ID !== "2ef88b92-bf75-4b31-ac2b-0c5b61627732" ||
    env.RAILWAY_PROJECT_ID !== "e13f89d3-e41a-4e89-96b8-dbdc0b1f87cd" ||
    env.FALKORDB_GRAPH !== "sandbox_profiles" ||
    env.FALKORDB_MEMORY_GRAPH !== "sandbox_memory" ||
    env.SANDBOX_CLERK_APP_ID !== "app_3Kkji888RWnY1TIAjHITY6ZaF92" ||
    env.SANDBOX_CLERK_INSTANCE_ID !== "ins_3KkjiF7zViWlDNsHyTasXpqvaCC" ||
    !env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
    !env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") ||
    Buffer.from(env.CLERK_PUBLISHABLE_KEY.slice(8), "base64").toString() !==
      "up-burro-4657.clerk.accounts.dev$"
  ) {
    throw new Error(
      "Seed refused: the dedicated Railway sandbox and Clerk instance are required.",
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply"))
    throw new Error(
      "Only --apply is supported; this script never resets data.",
    );
  assertSandbox(process.env);
  const fixtures = [
    { name: "Alice", email: "alice+clerk_test@example.com", role: "owner" },
    { name: "Bob", email: "bob+clerk_test@example.com", role: "contributor" },
    { name: "Eve", email: "eve+clerk_test@example.com", role: "outsider" },
  ];
  const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  });
  const instance = await clerk.instance.get();
  if (
    instance.id !== process.env.SANDBOX_CLERK_INSTANCE_ID ||
    instance.environmentType !== "development"
  ) {
    throw new Error("Seed refused: Clerk returned a different instance.");
  }
  if (!args.includes("--apply")) {
    console.log(
      JSON.stringify({
        dryRun: true,
        fixtures,
        graphs: ["sandbox_profiles", "sandbox_memory"],
      }),
    );
    return;
  }
  const { connectMemoryStore } = await import("../dist/memory.js");
  const { connectUserStore } = await import("../dist/users.js");
  const { fromClerkUser } = await import("../dist/clerk-users.js");
  const memory = await connectMemoryStore();
  let profiles;
  try {
    profiles = await connectUserStore();
    const actors = [];
    for (const fixture of fixtures) {
      const existing = await clerk.users.getUserList({
        emailAddress: [fixture.email],
        limit: 10,
      });
      const user =
        existing.data[0] ??
        (await clerk.users.createUser({
          emailAddress: [fixture.email],
          firstName: fixture.name,
          lastName: "Sandbox",
          skipPasswordRequirement: true,
        }));
      await profiles.upsert(fromClerkUser(user));
      actors.push({
        userId: user.id,
        name: `${fixture.name} Sandbox`,
        email: fixture.email,
        clientId: "sandbox-fixtures",
      });
    }
    const [alice, bob, eve] = actors;
    const space =
      (await memory.spaces(alice)).find(
        (item) =>
          item.owner === alice.userId && item.name === "Shared Spaces Sandbox",
      ) ?? (await memory.createSpace(alice, "Shared Spaces Sandbox"));
    if (!(await memory.spaces(bob)).some((item) => item.id === space.id)) {
      const invitation = await memory.invite(
        alice,
        space.id,
        bob.email,
        "contributor",
      );
      await memory.accept(bob, invitation.token);
    }
    const input = (key, text) => ({
      text,
      kind: "fact",
      basis: "user_statement",
      evidence: "Synthetic sandbox fixture; no real personal information.",
      entities: [{ type: "project", name: "Sandbox Demo" }],
      idempotencyKey: `sandbox-fixture-v1-${key}`,
    });
    const privateAlice = await memory.remember(
      alice,
      input(
        "alice-private",
        "Synthetic fixture: Alice's private project note.",
      ),
    );
    const privateBob = await memory.remember(
      bob,
      input("bob-private", "Synthetic fixture: Bob's private project note."),
    );
    const shared = await memory.remember(
      alice,
      input(
        "shared-update",
        "Synthetic fixture: Alice completed the demo setup.",
      ),
    );
    await memory.share(
      alice,
      shared.memory.id,
      space.id,
      true,
      "sandbox-fixture-v1",
    );
    assert.equal(
      (await memory.get(bob, shared.memory.id)).id,
      shared.memory.id,
    );
    const denied = (error) => error?.status === 403 || error?.status === 404;
    await assert.rejects(memory.get(bob, privateAlice.memory.id), denied);
    await assert.rejects(memory.get(alice, privateBob.memory.id), denied);
    await assert.rejects(memory.get(eve, shared.memory.id), denied);
    console.log(
      JSON.stringify({
        seeded: true,
        fixtures,
        space: { id: space.id, name: space.name },
        privacyChecks: "passed",
      }),
    );
  } finally {
    await Promise.all([profiles?.close(), memory.close()]);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      "Sandbox seed failed. No credentials printed. Check sandbox targeting, provider access, and fixture permissions.",
    );
    process.exitCode = 1;
  });
}
