import { z } from "zod";

/**
 * When a member's assistant should interrupt them about shared updates.
 * "about_me" rings instantly only for updates that mention the member and
 * holds the rest for a daily digest; "all" rings for everything. Quiet hours
 * hold every interruption until they end. Hours are in the member's timezone.
 */
export interface Preferences {
  mode: "about_me" | "all";
  digestHour: number;
  timezone: string;
  quietStart: number | null;
  quietEnd: number | null;
}
export const defaultPreferences: Preferences = {
  mode: "about_me",
  digestHour: 18,
  timezone: "UTC",
  quietStart: null,
  quietEnd: null,
};

function knownTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
const hour = z.number().int().min(0).max(23);
export const preferencesInput = z
  .object({
    mode: z.enum(["about_me", "all"]).default(defaultPreferences.mode),
    digestHour: hour.default(defaultPreferences.digestHour),
    timezone: z
      .string()
      .max(64)
      .default(defaultPreferences.timezone)
      .refine(knownTimezone, "Unknown timezone"),
    quietStart: hour.nullable().default(null),
    quietEnd: hour.nullable().default(null),
  })
  .strict()
  .refine(
    (p) => (p.quietStart === null) === (p.quietEnd === null),
    "Set both quiet-hour bounds or neither",
  );
export function parsePreferences(raw: unknown): Preferences {
  return preferencesInput.parse(raw ?? {});
}

function localParts(timezone: string, ms: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    min: Number(parts.minute),
    s: Number(parts.second),
  };
}
function offset(timezone: string, ms: number) {
  const p = localParts(timezone, ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000;
}
/** The UTC instant of a local wall-clock hour; the second pass settles DST transitions. */
function zonedTime(timezone: string, y: number, m: number, d: number, h: number) {
  const guess = Date.UTC(y, m - 1, d, h);
  const first = guess - offset(timezone, guess);
  return guess - offset(timezone, first);
}
function digestOn(p: Preferences, y: number, m: number, d: number, dayShift: number) {
  // Calendar arithmetic in UTC is independent of the member's timezone.
  const day = new Date(Date.UTC(y, m - 1, d + dayShift));
  return zonedTime(
    p.timezone,
    day.getUTCFullYear(),
    day.getUTCMonth() + 1,
    day.getUTCDate(),
    p.digestHour,
  );
}
export function lastDigestAt(p: Preferences, now: number) {
  const l = localParts(p.timezone, now);
  const today = digestOn(p, l.y, l.m, l.d, 0);
  return today <= now ? today : digestOn(p, l.y, l.m, l.d, -1);
}
export function nextDigestAt(p: Preferences, now: number) {
  const l = localParts(p.timezone, now);
  const today = digestOn(p, l.y, l.m, l.d, 0);
  return today > now ? today : digestOn(p, l.y, l.m, l.d, 1);
}
export function isQuiet(p: Preferences, now: number) {
  if (p.quietStart === null || p.quietEnd === null || p.quietStart === p.quietEnd)
    return false;
  const h = localParts(p.timezone, now).h;
  return p.quietStart < p.quietEnd
    ? h >= p.quietStart && h < p.quietEnd
    : h >= p.quietStart || h < p.quietEnd;
}
/** Whether an unread update should interrupt the member now. */
export function isDue(
  p: Preferences,
  item: { createdAt: number; urgent: boolean },
  now: number,
) {
  if (isQuiet(p, now)) return false;
  if (item.urgent || p.mode === "all") return true;
  return lastDigestAt(p, now) >= item.createdAt;
}
