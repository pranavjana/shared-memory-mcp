import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  decrypt,
  doorbellUrl,
  encrypt,
  normalizeAuthorization,
  pinnedLookup,
  publicAddress,
} from "../src/doorbells.js";

test("doorbell secrets round-trip through authenticated encryption", () => {
  const key = randomBytes(32).toString("base64");
  const sealed = encrypt("Bearer crsr_secret_value", key);
  assert.ok(!sealed.includes("crsr_secret_value"));
  assert.equal(decrypt(sealed, key), "Bearer crsr_secret_value");
  const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A");
  assert.throws(() => decrypt(tampered, key));
  assert.throws(() => decrypt(sealed, randomBytes(32).toString("base64")));
});

test("only public unicast addresses are deliverable", () => {
  for (const address of ["8.8.8.8", "2607:f8b0:4004:800::200e"])
    assert.equal(publicAddress(address), true, address);
  for (const address of [
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "not-an-ip",
  ])
    assert.equal(publicAddress(address), false, address);
});

test("doorbell URLs must be plain HTTPS on the default port", () => {
  assert.equal(
    doorbellUrl("https://hooks.example.com/routine/abc?x=1").href,
    "https://hooks.example.com/routine/abc?x=1",
  );
  for (const bad of [
    "http://hooks.example.com/x",
    "https://user:pass@hooks.example.com/x",
    "https://hooks.example.com:8443/x",
    "https://hooks.example.com/x#frag",
    "ftp://hooks.example.com/x",
    "not a url",
  ])
    assert.throws(() => doorbellUrl(bad), /HTTPS/, bad);
});

test("an Authorization value is accepted with or without its header name", () => {
  assert.equal(normalizeAuthorization("Bearer abc12345"), "Bearer abc12345");
  assert.equal(
    normalizeAuthorization("  Authorization:  Bearer abc12345 "),
    "Bearer abc12345",
  );
  assert.throws(() => normalizeAuthorization("Bearer a\r\nX-Evil: 1"), /single line/);
});

test("the pinned lookup answers both single-address and all-addresses requests", () => {
  const lookup = pinnedLookup({ address: "93.184.215.14", family: 4 });
  let single: unknown[] = [];
  lookup("example.com", {}, (...args) => (single = args));
  assert.deepEqual(single, [null, "93.184.215.14", 4]);
  let all: unknown[] = [];
  lookup("example.com", { all: true }, (...args) => (all = args));
  assert.deepEqual(all, [null, [{ address: "93.184.215.14", family: 4 }]]);
});
