/**
 * Date helpers. All dataset timestamps are UTC ISO-8601 with millisecond
 * precision and a trailing `Z` — one canonical string form, so hashing is
 * stable and lexical sort equals chronological sort.
 */

export const DAY_MS = 86_400_000;

export function iso(d: Date | number): string {
  return new Date(d).toISOString();
}

export function parse(s: string): number {
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`Invalid ISO date: ${s}`);
  return t;
}

export function addDays(s: string, days: number): string {
  return iso(parse(s) + days * DAY_MS);
}

export function addHours(s: string, hours: number): string {
  return iso(parse(s) + hours * 3_600_000);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b) - parse(a)) / DAY_MS);
}

export function isBefore(a: string, b: string): boolean {
  return parse(a) < parse(b);
}

export function isAfter(a: string, b: string): boolean {
  return parse(a) > parse(b);
}

/** Clamp an ISO timestamp into [min,max]. */
export function clampDate(s: string, min: string, max: string): string {
  const t = parse(s);
  return iso(Math.max(parse(min), Math.min(parse(max), t)));
}

/** YYYY-MM-DD */
export function dateOnly(s: string): string {
  return s.slice(0, 10);
}

/** Calendar year as a number. */
export function yearOf(s: string): number {
  return Number(s.slice(0, 4));
}
