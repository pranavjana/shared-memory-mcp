import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { invitationRedirect } from "../web/invitation.js";

test("invitation sign-in return URL preserves a token and never follows an external redirect", () => {
  const token = randomUUID() + randomUUID();
  const target = invitationRedirect(
    `?invite=${encodeURIComponent(token)}&redirect=https://example.invalid`,
  );
  const url = new URL(target, "https://memory.example.com");
  assert.equal(url.origin, "https://memory.example.com");
  assert.equal(url.pathname, "/dashboard");
  assert.equal(url.searchParams.get("invite"), token);
  assert.deepEqual([...url.searchParams.keys()], ["invite"]);
  assert.equal(invitationRedirect(""), "/dashboard");
  assert.equal(invitationRedirect("?invite="), "/dashboard");
  assert.equal(invitationRedirect("?invite=" + "a".repeat(201)), "/dashboard");
});
