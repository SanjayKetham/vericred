/**
 * Canonical JSON serialisation (RFC 8785-style, narrowed to our value domain).
 *
 * This is the single most safety-critical function in the project: every hash
 * and every signature is computed over its output. If two runs serialise the
 * same logical payload differently, reproducibility (Step 10) and tamper
 * detection both break.
 *
 * Rules:
 *   - Object keys sorted lexicographically (UTF-16 code-unit order).
 *   - No insignificant whitespace.
 *   - Only: string | integer number | boolean | null | array | plain object.
 *   - FLOATS ARE REJECTED. Non-integer numbers have no single canonical text
 *     form across platforms; all our scores are integer basis points.
 *   - undefined is rejected (silently dropping keys changes the hash).
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [k: string]: CanonicalValue };

export function canonicalize(value: CanonicalValue, path = '$'): string {
  if (value === null) return 'null';

  const t = typeof value;

  if (t === 'string') return JSON.stringify(value);

  if (t === 'boolean') return value ? 'true' : 'false';

  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) throw new Error(`canonicalize: non-finite number at ${path}`);
    if (!Number.isInteger(n)) {
      throw new Error(
        `canonicalize: non-integer number ${n} at ${path}. ` +
        `Use integer basis points (x100) — floats have no stable canonical form.`,
      );
    }
    if (!Number.isSafeInteger(n)) throw new Error(`canonicalize: unsafe integer at ${path}`);
    return String(n);
  }

  if (Array.isArray(value)) {
    return '[' + value.map((v, i) => canonicalize(v, `${path}[${i}]`)).join(',') + ']';
  }

  if (t === 'object') {
    const obj = value as Record<string, CanonicalValue>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) {
        throw new Error(`canonicalize: undefined value at ${path}.${k} — omit the key explicitly or use null`);
      }
      parts.push(JSON.stringify(k) + ':' + canonicalize(v, `${path}.${k}`));
    }
    return '{' + parts.join(',') + '}';
  }

  throw new Error(`canonicalize: unsupported type ${t} at ${path}`);
}
