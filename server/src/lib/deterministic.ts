import { createHash, createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';

/**
 * Deterministic primitives for VeriCred.
 *
 * Every random draw is derived from sha256(seed | namespace | index | salt) rather than from a single
 * mutable global stream. That makes generation order-independent: adding an entity type, or reordering
 * two loops, cannot shift the values produced for any other entity. This is what makes Step 10
 * (regenerate twice, compare checksums) hold even as the generator evolves.
 */

export const DEFAULT_SEED = 20261022;

function digest(...parts: (string | number)[]): Buffer {
  return createHash('sha256').update(parts.join('|'), 'utf8').digest();
}

/** A reproducible pseudo-random stream bound to (seed, namespace, index). */
export class Rng {
  private counter = 0;
  constructor(
    private readonly seed: number,
    private readonly namespace: string,
    private readonly index: number | string = 0,
  ) {}

  /** Uniform float in [0, 1). */
  next(): number {
    const buf = digest(this.seed, this.namespace, String(this.index), this.counter++);
    // 53 bits of entropy from the first 7 bytes keeps this exactly representable as a double.
    const hi = buf.readUInt32BE(0);
    const lo = buf.readUInt32BE(4) >>> 11;
    return (hi * 2 ** 21 + lo) / 2 ** 53;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.int: max ${max} < min ${min}`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max) rounded to `decimals`. */
  float(min: number, max: number, decimals = 2): number {
    const raw = min + this.next() * (max - min);
    const f = 10 ** decimals;
    return Math.round(raw * f) / f;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Pick by explicit weights so distributions are documented, not accidental. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return entries[entries.length - 1]![0];
  }

  bool(probabilityTrue: number): boolean {
    return this.next() < probabilityTrue;
  }

  /** Approximately normal via the mean of 3 uniforms; clamped to [min, max]. */
  normal(mean: number, stdDev: number, min: number, max: number): number {
    const u = (this.next() + this.next() + this.next()) / 3;
    const value = mean + (u - 0.5) * 2 * stdDev * 1.732;
    return Math.min(max, Math.max(min, value));
  }

  intNormal(mean: number, stdDev: number, min: number, max: number): number {
    return Math.round(this.normal(mean, stdDev, min, max));
  }

  /** Deterministic Fisher-Yates — returns a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}

export function rngFor(seed: number, namespace: string, index: number | string = 0): Rng {
  return new Rng(seed, namespace, index);
}

/* ------------------------------------------------------------------ IDs */

export const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export const learnerId = (n: number): string => `LRN-${pad(n, 6)}`;
export const courseId = (n: number): string => `CRS-${pad(n, 6)}`;
export const issuerId = (n: number): string => `ISS-${pad(n, 4)}`;
export const ruleId = (courseNum: number, version: number): string => `RUL-${pad(courseNum, 6)}-V${pad(version, 2)}`;
export const completionId = (learner: string, course: string): string => `CMP-${learner}-${course}`;
export const credentialId = (year: number, n: number): string => `CRD-${year}-${pad(n, 6)}`;
export const verificationId = (year: number, n: number): string => `VER-${year}-${pad(n, 6)}`;
export const revocationId = (credential: string, seq: number): string => `REV-${credential}-${pad(seq, 2)}`;
export const auditEventId = (seq: number): string => `EVT-${pad(seq, 9)}`;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — transcription-safe

/** Public verification handle, derived from the credential id so it is stable across runs. */
export function verificationCode(seed: number, credential: string): string {
  const buf = digest(seed, 'verification-code', credential);
  let out = '';
  for (let i = 0; i < 10; i++) out += CODE_ALPHABET[buf[i]! % CODE_ALPHABET.length];
  return out;
}

/* --------------------------------------------------- canonical JSON + hash */

/**
 * RFC 8785-style canonicalisation: object keys sorted, no insignificant whitespace, numbers in their
 * shortest round-trip form. Verification can only be reproducible if the bytes being hashed are
 * reproducible, so every hash in the system goes through this function.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalize: non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`);
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** SHA-256 over the canonical form — the credential payload hash. */
export function payloadHash(payload: unknown): string {
  return sha256Hex(canonicalize(payload));
}

/* ------------------------------------------------------------- Ed25519 */

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface IssuerKeyPair {
  privateKeyHex: string;
  publicKeyHex: string;
}

/** Issuer keys are themselves seed-derived, so the whole dataset — signatures included — reproduces. */
export function deriveKeyPair(seed: number, issuer: string): IssuerKeyPair {
  const secret = digest(seed, 'ed25519-seed', issuer); // 32 bytes
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, secret]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer;
  return {
    privateKeyHex: secret.toString('hex'),
    publicKeyHex: publicDer.subarray(SPKI_ED25519_PREFIX.length).toString('hex'),
  };
}

function privateKeyFromHex(hex: string) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(hex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  });
}

function publicKeyFromHex(hex: string) {
  return createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(hex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

/** Sign the payload hash (not the payload) so signatures stay short and hash-linked. */
export function signHash(privateKeyHex: string, messageHex: string): string {
  return nodeSign(null, Buffer.from(messageHex, 'utf8'), privateKeyFromHex(privateKeyHex)).toString('hex');
}

export function verifySignature(publicKeyHex: string, messageHex: string, signatureHex: string): boolean {
  try {
    return nodeVerify(
      null,
      Buffer.from(messageHex, 'utf8'),
      publicKeyFromHex(publicKeyHex),
      Buffer.from(signatureHex, 'hex'),
    );
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- dates */

export const DAY_MS = 86_400_000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addYears(date: Date, years: number): Date {
  const d = new Date(date.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export const iso = (date: Date): string => date.toISOString();

/** Deterministic timestamp inside a window, snapped to whole seconds for stable CSV round-trips. */
export function dateBetween(rng: Rng, from: Date, to: Date): Date {
  const span = to.getTime() - from.getTime();
  if (span <= 0) return new Date(from.getTime());
  const t = from.getTime() + Math.floor(rng.next() * span);
  return new Date(Math.floor(t / 1000) * 1000);
}
