/**
 * Deterministic ID minting + validation.
 *
 * Canonical formats (decided and frozen — see docs/DATA_DICTIONARY.md):
 *   Learner             LRN-000001            6-digit, global counter
 *   Course              CRS-000001            6-digit, global counter
 *   Issuer              ISS-0001              4-digit, global counter
 *   CredentialRule      RUL-000001            6-digit, global counter
 *   CompletionRecord    CMP-LRN-000001-CRS-000001
 *                       (FULL parent IDs embedded — unambiguous, greppable)
 *   Assessment          ASM-<completionId>-01 2-digit attempt, 1-based
 *   Credential          CRD-2026-000001       per-ISSUE-YEAR counter
 *   VerificationRequest VER-2026-000001       per-REQUEST-YEAR counter
 *   Revocation          REV-<credentialId>-01 2-digit sequence, 1-based
 *   AuditEvent          AUD-2026-000000001    9-digit, per-year counter
 *   InternalRecordKey   REC-0000001           surrogate PK (see note below)
 *
 * NOTE on REC-: `credentialId` is deliberately NOT the database primary key.
 * The spec requires a "duplicate credential ID" edge case, which a UNIQUE
 * constraint would make unrepresentable. Credentials are keyed on a surrogate
 * `recordKey`; credentialId carries a non-unique index and uniqueness is
 * enforced as a *validated business rule* instead. This is the behaviour under
 * test, so it must live in the validator, not in the DDL.
 */

import { ISSUE_YEAR } from './config.js';

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export const learnerId = (n: number): string => `LRN-${pad(n, 6)}`;
export const courseId = (n: number): string => `CRS-${pad(n, 6)}`;
export const issuerId = (n: number): string => `ISS-${pad(n, 4)}`;
export const ruleId = (n: number): string => `RUL-${pad(n, 6)}`;
export const completionId = (lrn: string, crs: string): string => `CMP-${lrn}-${crs}`;
export const assessmentId = (cmp: string, attempt: number): string => `ASM-${cmp}-${pad(attempt, 2)}`;
export const credentialId = (n: number, year: number = ISSUE_YEAR): string => `CRD-${year}-${pad(n, 6)}`;
export const verificationId = (n: number, year: number = ISSUE_YEAR): string => `VER-${year}-${pad(n, 6)}`;
export const revocationId = (crd: string, seq: number): string => `REV-${crd}-${pad(seq, 2)}`;
export const auditId = (n: number, year: number = ISSUE_YEAR): string => `AUD-${year}-${pad(n, 9)}`;
export const recordKey = (n: number): string => `REC-${pad(n, 7)}`;
export const issuerAssignmentId = (crd: string, seq: number): string => `IAS-${crd}-${pad(seq, 2)}`;

/** Regexes used by the validator to prove format compliance on every row. */
export const ID_PATTERNS = {
  learnerId: /^LRN-\d{6}$/,
  courseId: /^CRS-\d{6}$/,
  issuerId: /^ISS-\d{4}$/,
  ruleId: /^RUL-\d{6}$/,
  completionId: /^CMP-LRN-\d{6}-CRS-\d{6}$/,
  assessmentId: /^ASM-CMP-LRN-\d{6}-CRS-\d{6}-\d{2}$/,
  credentialId: /^CRD-\d{4}-\d{6}$/,
  verificationId: /^VER-\d{4}-\d{6}$/,
  revocationId: /^REV-CRD-\d{4}-\d{6}-\d{2}$/,
  auditId: /^AUD-\d{4}-\d{9}$/,
  recordKey: /^REC-\d{7}$/,
  issuerAssignmentId: /^IAS-CRD-\d{4}-\d{6}-\d{2}$/,
} as const;

/** A monotonic, deterministic counter. Never reset mid-run. */
export class Counter {
  private n: number;
  constructor(start = 0) { this.n = start; }
  next(): number { return ++this.n; }
  get value(): number { return this.n; }
}

/** Parse the learner + course out of a completion ID. */
export function parseCompletionId(id: string): { learnerId: string; courseId: string } | null {
  const m = /^CMP-(LRN-\d{6})-(CRS-\d{6})$/.exec(id);
  return m ? { learnerId: m[1]!, courseId: m[2]! } : null;
}
