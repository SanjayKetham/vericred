import { canonicalize, daysBetween, payloadHash, signHash, verifySignature } from '../lib/deterministic.js';
import type {
  CompletionRecord,
  Course,
  Credential,
  CredentialRule,
  CredentialStatus,
  CriterionResult,
  IdentityMatchMethod,
  IssuanceDecision,
  Learner,
  Revocation,
  VerificationResult,
} from '../lib/types.js';

/**
 * The single source of truth for issuance and verification.
 *
 * The generator calls these functions to derive its outcome columns (Step 6: derived values come from
 * source records, never from an independent random draw) and the API calls the very same functions at
 * request time. One implementation means a verification run today reproduces a verification run at
 * generation time, bit for bit — which is the "verification result is reproducible" acceptance criterion.
 */

/* ------------------------------------------------------- completion status */

export const WITHDRAWAL_INACTIVITY_DAYS = 180;

export function deriveCompletionStatus(input: {
  modules_total: number;
  modules_completed: number;
  assessments_taken: number;
  assessments_passed: number;
  assessment_count: number;
  enrolled_at: Date;
  last_activity_at: Date;
  asOf: Date;
}): CompletionRecord['status'] {
  const pct = Math.round((100 * input.modules_completed) / input.modules_total);
  const inactiveDays = daysBetween(input.last_activity_at, input.asOf);

  if (inactiveDays > WITHDRAWAL_INACTIVITY_DAYS && pct < 100) return 'WITHDRAWN';
  if (input.modules_completed === input.modules_total && input.assessments_passed >= 1) return 'COMPLETED';
  if (input.assessments_taken === input.assessment_count && input.assessments_passed === 0) return 'FAILED';
  return 'IN_PROGRESS';
}

/* ---------------------------------------------------------- issuance rules */

/**
 * Evaluates every criterion (no short-circuit) so the decision trace shows which specific requirement
 * failed. Exposing the decision, not just the outcome, is the whole point of the trace.
 */
export function evaluateIssuance(
  completion: CompletionRecord,
  course: Course,
  rule: CredentialRule,
  evaluatedAt: Date,
): IssuanceDecision {
  const criteria: CriterionResult[] = [];

  criteria.push({
    criterion: 'completion_status',
    required: 'COMPLETED',
    actual: completion.status,
    passed: completion.status === 'COMPLETED',
  });

  criteria.push({
    criterion: 'completed_at_present',
    required: 'not null',
    actual: completion.completed_at ?? 'null',
    passed: completion.completed_at !== null,
  });

  criteria.push({
    criterion: 'min_overall_score',
    required: rule.min_overall_score,
    actual: completion.overall_score,
    passed: completion.overall_score >= rule.min_overall_score,
  });

  criteria.push({
    criterion: 'course_passing_score',
    required: course.passing_score,
    actual: completion.overall_score,
    passed: completion.overall_score >= course.passing_score,
  });

  criteria.push({
    criterion: 'min_modules_completed_pct',
    required: rule.min_modules_completed_pct,
    actual: completion.modules_completed_pct,
    passed: completion.modules_completed_pct >= rule.min_modules_completed_pct,
  });

  criteria.push({
    criterion: 'required_assessments_passed',
    required: rule.required_assessments_passed,
    actual: completion.assessments_passed,
    passed: completion.assessments_passed >= rule.required_assessments_passed,
  });

  criteria.push({
    criterion: 'min_attendance_pct',
    required: rule.min_attendance_pct,
    actual: completion.attendance_pct,
    passed: completion.attendance_pct >= rule.min_attendance_pct,
  });

  criteria.push({
    criterion: 'max_days_to_complete',
    required: rule.max_days_to_complete,
    actual: completion.days_to_complete ?? 'null',
    passed: completion.days_to_complete !== null && completion.days_to_complete <= rule.max_days_to_complete,
  });

  const failed = criteria.filter((c) => !c.passed).map((c) => c.criterion);

  return {
    decision: failed.length === 0 ? 'APPROVED' : 'DENIED',
    rule_id: rule.rule_id,
    rule_version: rule.rule_version,
    evaluated_at: evaluatedAt.toISOString(),
    criteria,
    failed_criteria: failed,
  };
}

/** The rule version in force at a given instant — issuance always pins the version it evaluated. */
export function activeRuleAt(rules: CredentialRule[], at: Date): CredentialRule | undefined {
  const t = at.getTime();
  const applicable = rules.filter((r) => {
    const from = Date.parse(r.effective_from);
    const to = r.effective_to === null ? Number.POSITIVE_INFINITY : Date.parse(r.effective_to);
    return from <= t && t < to;
  });
  if (applicable.length === 0) return undefined;
  return applicable.sort((a, b) => b.rule_version - a.rule_version)[0];
}

/* ------------------------------------------------------- credential payload */

export interface CredentialPayload {
  credential_id: string;
  course: { course_id: string; course_code: string; title: string; level: string; credit_hours: number };
  issued_at: string;
  issuer_id: string;
  learner: { learner_id: string; full_name: string; national_id_hash: string };
  result: { modules_completed_pct: number; overall_score: number; completed_at: string | null };
  rule: { rule_id: string; rule_version: number };
}

export function buildPayload(args: {
  credentialId: string;
  learner: Learner;
  course: Course;
  completion: CompletionRecord;
  rule: CredentialRule;
  issuerId: string;
  issuedAt: Date;
}): CredentialPayload {
  return {
    credential_id: args.credentialId,
    course: {
      course_id: args.course.course_id,
      course_code: args.course.course_code,
      title: args.course.title,
      level: args.course.level,
      credit_hours: args.course.credit_hours,
    },
    issued_at: args.issuedAt.toISOString(),
    issuer_id: args.issuerId,
    learner: {
      learner_id: args.learner.learner_id,
      full_name: args.learner.full_name,
      national_id_hash: args.learner.national_id_hash,
    },
    result: {
      modules_completed_pct: args.completion.modules_completed_pct,
      overall_score: args.completion.overall_score,
      completed_at: args.completion.completed_at,
    },
    rule: { rule_id: args.rule.rule_id, rule_version: args.rule.rule_version },
  };
}

export function sealPayload(payload: CredentialPayload, issuerPrivateKeyHex: string) {
  const canonical = canonicalize(payload);
  const hash = payloadHash(payload);
  return { payload_json: canonical, payload_hash: hash, signature: signHash(issuerPrivateKeyHex, hash) };
}

/* -------------------------------------------------------------- revocation */

/**
 * Current revocation state, computed by replaying the append-only revocation rows in sequence order.
 * History is never overwritten: a rescinded revocation stays in the table and is simply superseded,
 * so "revocation status is current" is answered by a replay, not by a mutable flag.
 */
export function currentRevocation(revocations: Revocation[], asOf: Date): Revocation | null {
  const t = asOf.getTime();
  const active = revocations
    // A revocation recorded after the moment being asked about was not in force at that moment.
    .filter((r) => r.status === 'ACTIVE' && Date.parse(r.revoked_at) <= t)
    .sort((a, b) => b.sequence_no - a.sequence_no);
  return active[0] ?? null;
}

export function deriveCredentialStatus(
  credential: Pick<Credential, 'expires_at'>,
  revocations: Revocation[],
  asOf: Date,
): CredentialStatus {
  if (currentRevocation(revocations, asOf)) return 'REVOKED';
  if (credential.expires_at !== null && Date.parse(credential.expires_at) <= asOf.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

/* ------------------------------------------------------------ verification */

/** Identity confidence by match method. NAME_ONLY is deliberately below the 0.90 acceptance threshold. */
export const IDENTITY_METHOD_SCORE: Record<IdentityMatchMethod, number> = {
  CREDENTIAL_ID: 1.0,
  VERIFICATION_CODE: 0.99,
  NATIONAL_ID_HASH: 0.97,
  EMAIL: 0.93,
  NAME_ONLY: 0.42,
};

export const IDENTITY_MATCH_THRESHOLD = 0.9;

export interface VerificationInput {
  credential: Credential | null;
  revocations: Revocation[];
  issuerPublicKeyHex: string | null;
  presentedHash: string;
  identityMatchMethod: IdentityMatchMethod;
  identityMatchScore: number;
  asOf: Date;
}

export interface VerificationOutcome {
  result: VerificationResult;
  checks: CriterionResult[];
  signature_valid: boolean;
}

/**
 * Deterministic verification. The check order matters and is fixed: a missing credential cannot be
 * identity-matched, and a weak identity match must never be overridden by a valid hash — which is why
 * identity is evaluated before the credential's own state. Name-only matching can never reach VALID.
 */
export function verifyCredential(input: VerificationInput): VerificationOutcome {
  const checks: CriterionResult[] = [];

  if (!input.credential) {
    checks.push({ criterion: 'credential_exists', required: 'found', actual: 'not found', passed: false });
    return { result: 'INVALID_NOT_FOUND', checks, signature_valid: false };
  }
  checks.push({ criterion: 'credential_exists', required: 'found', actual: 'found', passed: true });

  const identityPassed =
    input.identityMatchScore >= IDENTITY_MATCH_THRESHOLD && input.identityMatchMethod !== 'NAME_ONLY';
  checks.push({
    criterion: 'identity_match',
    required: `>= ${IDENTITY_MATCH_THRESHOLD} and method != NAME_ONLY`,
    actual: `${input.identityMatchScore} via ${input.identityMatchMethod}`,
    passed: identityPassed,
  });

  const signatureValid =
    input.issuerPublicKeyHex !== null &&
    verifySignature(input.issuerPublicKeyHex, input.credential.payload_hash, input.credential.signature);
  checks.push({
    criterion: 'issuer_signature',
    required: 'valid Ed25519 signature',
    actual: signatureValid ? 'valid' : 'invalid',
    passed: signatureValid,
  });

  // Recompute the hash from the stored payload: this is what catches a tampered payload whose stored
  // hash was left stale (edge case EC-04).
  const recomputed = (() => {
    try {
      return payloadHash(JSON.parse(input.credential.payload_json));
    } catch {
      return '';
    }
  })();
  const hashIntact = recomputed === input.credential.payload_hash;
  checks.push({
    criterion: 'payload_integrity',
    required: input.credential.payload_hash,
    actual: recomputed,
    passed: hashIntact,
  });

  const hashMatches = input.presentedHash === input.credential.payload_hash;
  checks.push({
    criterion: 'presented_hash_match',
    required: input.credential.payload_hash,
    actual: input.presentedHash,
    passed: hashMatches,
  });

  const revocation = currentRevocation(input.revocations, input.asOf);
  checks.push({
    criterion: 'not_revoked',
    required: 'no active revocation',
    actual: revocation ? `${revocation.revocation_id} (${revocation.reason_code})` : 'none',
    passed: revocation === null,
  });

  const expired =
    input.credential.expires_at !== null && Date.parse(input.credential.expires_at) <= input.asOf.getTime();
  checks.push({
    criterion: 'not_expired',
    required: 'expires_at in the future or null',
    actual: input.credential.expires_at ?? 'null',
    passed: !expired,
  });

  let result: VerificationResult;
  if (!identityPassed) result = 'INVALID_IDENTITY_MISMATCH';
  else if (revocation) result = 'INVALID_REVOKED';
  else if (expired) result = 'INVALID_EXPIRED';
  else if (!hashIntact || !hashMatches || !signatureValid) result = 'INVALID_HASH_MISMATCH';
  else result = 'VALID';

  return { result, checks, signature_valid: signatureValid };
}
