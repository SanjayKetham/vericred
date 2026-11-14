/**
 * PCG32 — a small, fast, fully deterministic PRNG.
 * Hand-rolled on purpose: no dependency, identical output on every platform
 * and Node version, and auditable in 40 lines.
 *
 * Math.random() cannot be seeded and is banned project-wide in src/generator.
 */

const MASK64 = (1n << 64n) - 1n;
const MULT = 6364136223846793005n;

export class Rng {
  private state = 0n;
  private readonly inc: bigint;

  constructor(seed: number | bigint, stream = 1) {
    this.inc = ((BigInt(stream) << 1n) | 1n) & MASK64;
    this.step();
    this.state = (this.state + BigInt(seed)) & MASK64;
    this.step();
  }

  private step(): void {
    this.state = (this.state * MULT + this.inc) & MASK64;
  }

  /** Next uint32. */
  next(): number {
    const old = this.state;
    this.step();
    const xorshifted = Number(((old >> 18n) ^ old) >> 27n & 0xffffffffn) >>> 0;
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0;
  }

  /** Float in [0, 1). */
  float(): number {
    return this.next() / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.int: max<min (${min},${max})`);
    return min + (this.next() % (max - min + 1));
  }

  /** True with probability p. */
  bool(p: number): boolean {
    return this.float() < p;
  }

  /** Uniform pick. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.next() % items.length]!;
  }

  /** Weighted pick. weights must align with items and be positive. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.float() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  /** In-place Fisher-Yates. Deterministic given seed. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }

  /** Pick n distinct items. */
  sample<T>(items: readonly T[], n: number): T[] {
    return this.shuffle([...items]).slice(0, Math.min(n, items.length));
  }

  /**
   * Approximate normal via Irwin-Hall (sum of 12 uniforms).
   * Avoids Box-Muller's Math.log/cos float drift across platforms.
   */
  normal(mean: number, sd: number): number {
    let s = 0;
    for (let i = 0; i < 12; i++) s += this.float();
    return mean + (s - 6) * sd;
  }

  /** Normal clamped to [min,max] and rounded to an integer. */
  normalInt(mean: number, sd: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(this.normal(mean, sd))));
  }
}

/**
 * Named substreams. Each generation phase gets its own stream so that
 * adding a draw in one phase cannot shift the output of another.
 */
export const STREAM = {
  learner: 11,
  course: 12,
  issuer: 13,
  rule: 14,
  enrolment: 21,
  assessment: 22,
  issuance: 31,
  revocation: 32,
  verification: 33,
  anomaly: 41,
  shuffle: 51,
} as const;

export function rngFor(stream: number, seed: number): Rng {
  return new Rng(seed, stream);
}
