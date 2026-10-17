import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultPreferences,
  isDue,
  isQuiet,
  lastDigestAt,
  nextDigestAt,
  parsePreferences,
} from "../src/preferences.js";

const at = (iso: string) => new Date(iso).getTime();

test("digest boundaries follow the member's timezone, including daylight saving", () => {
  const sg = { ...defaultPreferences, timezone: "Asia/Singapore", digestHour: 18 };
  // 18:00 in Singapore is 10:00 UTC.
  assert.equal(lastDigestAt(sg, at("2026-10-17T12:00:00Z")), at("2026-10-17T10:00:00Z"));
  assert.equal(lastDigestAt(sg, at("2026-10-17T09:59:00Z")), at("2026-10-16T10:00:00Z"));
  assert.equal(nextDigestAt(sg, at("2026-10-17T09:59:00Z")), at("2026-10-17T10:00:00Z"));
  const la = { ...defaultPreferences, timezone: "America/Los_Angeles", digestHour: 18 };
  // PDT (UTC-7) before 1 November 2026, PST (UTC-8) after.
  assert.equal(lastDigestAt(la, at("2026-10-31T02:00:00Z")), at("2026-10-31T01:00:00Z"));
  assert.equal(lastDigestAt(la, at("2026-11-03T03:00:00Z")), at("2026-11-03T02:00:00Z"));
});

test("quiet hours wrap past midnight and hold even urgent updates", () => {
  const p = { ...defaultPreferences, timezone: "UTC", quietStart: 22, quietEnd: 7 };
  assert.equal(isQuiet(p, at("2026-10-17T23:30:00Z")), true);
  assert.equal(isQuiet(p, at("2026-10-17T06:59:00Z")), true);
  assert.equal(isQuiet(p, at("2026-10-17T07:00:00Z")), false);
  assert.equal(isQuiet({ ...p, quietStart: null, quietEnd: null }, at("2026-10-17T23:30:00Z")), false);
  assert.equal(isDue(p, { createdAt: at("2026-10-17T23:00:00Z"), urgent: true }, at("2026-10-17T23:30:00Z")), false);
  assert.equal(isDue(p, { createdAt: at("2026-10-17T23:00:00Z"), urgent: true }, at("2026-10-18T07:01:00Z")), true);
});

test("urgent updates are due now; others wait for the next digest", () => {
  const p = { ...defaultPreferences, timezone: "UTC", digestHour: 18 };
  const morning = at("2026-10-17T09:00:00Z");
  assert.equal(isDue(p, { createdAt: morning, urgent: true }, morning + 1000), true);
  assert.equal(isDue(p, { createdAt: morning, urgent: false }, at("2026-10-17T17:59:00Z")), false);
  assert.equal(isDue(p, { createdAt: morning, urgent: false }, at("2026-10-17T18:00:00Z")), true);
  assert.equal(
    isDue({ ...p, mode: "all" }, { createdAt: morning, urgent: false }, morning + 1000),
    true,
    "In 'all' mode everything is instant",
  );
});

test("preferences are validated", () => {
  assert.deepEqual(parsePreferences({}), defaultPreferences);
  const p = parsePreferences({ mode: "all", digestHour: 9, timezone: "Asia/Singapore", quietStart: 23, quietEnd: 6 });
  assert.equal(p.timezone, "Asia/Singapore");
  assert.throws(() => parsePreferences({ timezone: "Mars/Olympus" }), /timezone/i);
  assert.throws(() => parsePreferences({ digestHour: 24 }));
  assert.throws(() => parsePreferences({ quietStart: 22 }), /both/);
});
