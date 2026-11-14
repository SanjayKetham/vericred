/**
 * Global, immutable run configuration.
 * NOTHING in src/generator may read the clock or unseeded entropy.
 */
export const SEED = 20261022;

/** Frozen "now" for the whole dataset. Never use Date.now() in generation. */
export const RUN_DATE = '2026-10-22T00:00:00.000Z';

/** Issuance year segment used by CRD-<year>-###### and VER-<year>-######. */
export const ISSUE_YEAR = 2026;

export type Scale = 'starter' | 'full';

export interface Volumes {
  learners: number;
  courses: number;
  issuers: number;
  credentials: number;
  verifications: number;
}

export const VOLUMES: Record<Scale, Volumes> = {
  starter: { learners: 500, courses: 50, issuers: 4, credentials: 250, verifications: 125 },
  full:    { learners: 20000, courses: 1000, issuers: 12, credentials: 10000, verifications: 5000 },
};

/** Dataset-wide calendar window. */
export const WINDOW = {
  enrolStart: '2025-01-06T00:00:00.000Z',
  enrolEnd:   '2026-08-31T00:00:00.000Z',
  issueEnd:   '2026-10-01T00:00:00.000Z',
};
