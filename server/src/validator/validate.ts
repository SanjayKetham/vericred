import { join } from 'node:path';
import { verifyAuditChain } from '../lib/audit.js';
import { AS_OF } from '../generator/generate.js';
import {
  currentRevocation,
  deriveCompletionStatus,
  deriveCredentialStatus,
  evaluateIssuance,
  verifyCredential,
} from '../engine/rules.js';
import { canonicalize, daysBetween, payloadHash, verifySignature } from '../lib/deterministic.js';
import { readCsv } from '../lib/io.js';
import type {
  AuditEvent,
  CompletionRecord,
  Course,
  Credential,
  CredentialRule,
  GroundTruthRow,
  IssueType,
  Issuer,
  Learner,
  Revocation,
  VerificationRequest,
} from '../lib/types.js';

/* --------------------------------------------------------------- loading */

const num = (v: string): number => (v === '' ? 0 : Number(v));
const nullable = (v: string): string | null => (v === '' ? null : v);

export interface LoadedData {
  learners: Learner[];
  courses: Course[];
  issuers: Issuer[];
  credentialRules: CredentialRule[];
  completionRecords: CompletionRecord[];
  credentials: Credential[];
  verificationRequests: VerificationRequest[];
  revocations: Revocation[];
  auditEvents: AuditEvent[];
  groundTruth: GroundTruthRow[];
}

export function loadDataset(dir: string): LoadedData {
  const csv = (name: string) => readCsv(join(dir, 'csv', `${name}.csv`));
  return {
    learners: csv('learners') as unknown as Learner[],
    courses: csv('courses').map((r) => ({
      ...r,
      credit_hours: num(r.credit_hours!),
      modules_total: num(r.modules_total!),
      assessment_count: num(r.assessment_count!),
      passing_score: num(r.passing_score!),
      effective_to: nullable(r.effective_to!),
    })) as unknown as Course[],
    issuers: csv('issuers').map((r) => ({
      ...r,
      effective_to: nullable(r.effective_to!),
      supersedes_issuer_id: nullable(r.supersedes_issuer_id!),
    })) as unknown as Issuer[],
    credentialRules: csv('credential_rules').map((r) => ({
      ...r,
      rule_version: num(r.rule_version!),
      min_overall_score: num(r.min_overall_score!),
      min_modules_completed_pct: num(r.min_modules_completed_pct!),
      required_assessments_passed: num(r.required_assessments_passed!),
      min_attendance_pct: num(r.min_attendance_pct!),
      max_days_to_complete: num(r.max_days_to_complete!),
      effective_to: nullable(r.effective_to!),
    })) as unknown as CredentialRule[],
    completionRecords: csv('completion_records').map((r) => ({
      ...r,
      completed_at: nullable(r.completed_at!),
      modules_total: num(r.modules_total!),
      modules_completed: num(r.modules_completed!),
      modules_completed_pct: num(r.modules_completed_pct!),
      attendance_pct: num(r.attendance_pct!),
      assessments_taken: num(r.assessments_taken!),
      assessments_passed: num(r.assessments_passed!),
      overall_score: num(r.overall_score!),
      days_to_complete: r.days_to_complete === '' ? null : num(r.days_to_complete!),
    })) as unknown as CompletionRecord[],
    credentials: csv('credentials').map((r) => ({
      ...r,
      rule_version: num(r.rule_version!),
      expires_at: nullable(r.expires_at!),
    })) as unknown as Credential[],
    verificationRequests: csv('verification_requests').map((r) => ({
      ...r,
      credential_id: nullable(r.credential_id!),
      identity_match_score: num(r.identity_match_score!),
      latency_ms: num(r.latency_ms!),
    })) as unknown as VerificationRequest[],
    revocations: csv('revocations').map((r) => ({
      ...r,
      sequence_no: num(r.sequence_no!),
    })) as unknown as Revocation[],
    auditEvents: csv('audit_events').map((r) => ({
      ...r,
      event_seq: num(r.event_seq!),
    })) as unknown as AuditEvent[],
    groundTruth: readCsv(join(dir, 'ground_truth.csv')) as unknown as GroundTruthRow[],
  };
}

/* ---------------------------------------------------------------- checks */

export interface Violation {
  record_type: string;
  record_id: string;
  detail: string;
  /** True when a labelled edge case explains this violation — expected by design, not data corruption. */
  expected: boolean;
}

export interface CheckResult {
  id: string;
  category: string;
  description: string;
  checked: number;
  violations: Violation[];
  unexpected: number;
  passed: boolean;
}

const ENUMS: Record<string, readonly string[]> = {
  'Learner.status': ['ACTIVE', 'INACTIVE', 'SUSPENDED'],
  'Course.status': ['ACTIVE', 'RETIRED'],
  'Course.level': ['FOUNDATION', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'],
  'Issuer.status': ['ACTIVE', 'SUPERSEDED'],
  'CredentialRule.status': ['ACTIVE', 'SUPERSEDED'],
  'CompletionRecord.status': ['IN_PROGRESS', 'COMPLETED', 'WITHDRAWN', 'FAILED'],
  'Credential.status': ['ACTIVE', 'REVOKED', 'EXPIRED'],
  'Revocation.status': ['ACTIVE', 'RESCINDED'],
  'Revocation.reason_code': ['FRAUD', 'ADMIN_ERROR', 'COURSE_RETIRED', 'ISSUER_CHANGE', 'LEARNER_REQUEST', 'DATA_CORRECTION'],
  'VerificationRequest.result': ['VALID', 'INVALID_NOT_FOUND', 'INVALID_REVOKED', 'INVALID_EXPIRED', 'INVALID_HASH_MISMATCH', 'INVALID_IDENTITY_MISMATCH'],
  'VerificationRequest.identity_match_method': ['CREDENTIAL_ID', 'VERIFICATION_CODE', 'NATIONAL_ID_HASH', 'EMAIL', 'NAME_ONLY'],
  'VerificationRequest.verifier_type': ['EMPLOYER', 'UNIVERSITY', 'GOVERNMENT', 'PLATFORM', 'INDIVIDUAL'],
};

const ID_PATTERNS: [string, RegExp, (d: LoadedData) => { id: string }[]][] = [
  ['Learner.learner_id', /^LRN-\d{6}$/, (d) => d.learners.map((r) => ({ id: r.learner_id }))],
  ['Course.course_id', /^CRS-\d{6}$/, (d) => d.courses.map((r) => ({ id: r.course_id }))],
  ['Issuer.issuer_id', /^ISS-\d{4}$/, (d) => d.issuers.map((r) => ({ id: r.issuer_id }))],
  ['CredentialRule.rule_id', /^RUL-\d{6}-V\d{2}$/, (d) => d.credentialRules.map((r) => ({ id: r.rule_id }))],
  ['CompletionRecord.completion_id', /^CMP-LRN-\d{6}-CRS-\d{6}$/, (d) => d.completionRecords.map((r) => ({ id: r.completion_id }))],
  ['Credential.credential_id', /^CRD-\d{4}-\d{6}$/, (d) => d.credentials.map((r) => ({ id: r.credential_id }))],
  ['VerificationRequest.verification_id', /^VER-\d{4}-\d{6}$/, (d) => d.verificationRequests.map((r) => ({ id: r.verification_id }))],
  ['Revocation.revocation_id', /^REV-CRD-\d{4}-\d{6}-\d{2}$/, (d) => d.revocations.map((r) => ({ id: r.revocation_id }))],
  ['AuditEvent.event_id', /^EVT-\d{9}$/, (d) => d.auditEvents.map((r) => ({ id: r.event_id }))],
];

export function runChecks(data: LoadedData): CheckResult[] {
  const labelled = new Set(data.groundTruth.map((g) => `${g.record_type}|${g.record_id}`));
  const isExpected = (type: string, id: string) => labelled.has(`${type}|${id}`);
  const results: CheckResult[] = [];

  const add = (
    id: string,
    category: string,
    description: string,
    checked: number,
    violations: Violation[],
  ) => {
    const unexpected = violations.filter((v) => !v.expected).length;
    results.push({ id, category, description, checked, violations, unexpected, passed: unexpected === 0 });
  };

  /* 1. Primary-key uniqueness */
  const pkTables: [string, string[]][] = [
    ['Learner', data.learners.map((r) => r.learner_id)],
    ['Course', data.courses.map((r) => r.course_id)],
    ['Issuer', data.issuers.map((r) => r.issuer_id)],
    ['CredentialRule', data.credentialRules.map((r) => r.rule_id)],
    ['CompletionRecord', data.completionRecords.map((r) => r.completion_id)],
    ['Credential', data.credentials.map((r) => r.credential_id)],
    ['VerificationRequest', data.verificationRequests.map((r) => r.verification_id)],
    ['Revocation', data.revocations.map((r) => r.revocation_id)],
    ['AuditEvent', data.auditEvents.map((r) => r.event_id)],
  ];
  const pkViolations: Violation[] = [];
  let pkChecked = 0;
  for (const [table, ids] of pkTables) {
    pkChecked += ids.length;
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        pkViolations.push({ record_type: table, record_id: id, detail: 'duplicate primary key', expected: isExpected(table, id) });
      }
      seen.add(id);
    }
  }
  add('PK-01', 'primary-key uniqueness', 'Every primary key appears exactly once', pkChecked, pkViolations);

  /* 2. Foreign-key integrity */
  const learnerIds = new Set(data.learners.map((r) => r.learner_id));
  const courseIds = new Set(data.courses.map((r) => r.course_id));
  const issuerIds = new Set(data.issuers.map((r) => r.issuer_id));
  const ruleIds = new Set(data.credentialRules.map((r) => r.rule_id));
  const completionIds = new Set(data.completionRecords.map((r) => r.completion_id));
  const credentialIds = new Set(data.credentials.map((r) => r.credential_id));

  const fkViolations: Violation[] = [];
  let fkChecked = 0;
  const fk = (type: string, id: string, field: string, value: string | null, pool: Set<string>, optional = false) => {
    if (value === null || value === '') {
      if (!optional) fkViolations.push({ record_type: type, record_id: id, detail: `${field} is null`, expected: false });
      return;
    }
    fkChecked++;
    if (!pool.has(value)) {
      fkViolations.push({ record_type: type, record_id: id, detail: `${field}=${value} has no parent`, expected: isExpected(type, id) });
    }
  };

  for (const r of data.credentialRules) fk('CredentialRule', r.rule_id, 'course_id', r.course_id, courseIds);
  for (const r of data.issuers) fk('Issuer', r.issuer_id, 'supersedes_issuer_id', r.supersedes_issuer_id, issuerIds, true);
  for (const r of data.completionRecords) {
    fk('CompletionRecord', r.completion_id, 'learner_id', r.learner_id, learnerIds);
    fk('CompletionRecord', r.completion_id, 'course_id', r.course_id, courseIds);
  }
  for (const r of data.credentials) {
    fk('Credential', r.credential_id, 'learner_id', r.learner_id, learnerIds);
    fk('Credential', r.credential_id, 'course_id', r.course_id, courseIds);
    fk('Credential', r.credential_id, 'completion_id', r.completion_id, completionIds);
    fk('Credential', r.credential_id, 'issuer_id', r.issuer_id, issuerIds);
    fk('Credential', r.credential_id, 'rule_id', r.rule_id, ruleIds);
  }
  for (const r of data.verificationRequests) {
    fk('VerificationRequest', r.verification_id, 'credential_id', r.credential_id, credentialIds, true);
  }
  for (const r of data.revocations) fk('Revocation', r.revocation_id, 'credential_id', r.credential_id, credentialIds);
  add('FK-01', 'foreign-key integrity', 'Every foreign key resolves to an existing parent row', fkChecked, fkViolations);

  /* 2b. The completion a credential cites must belong to the same learner and course */
  const completionByIdMap = new Map(data.completionRecords.map((c) => [c.completion_id, c]));
  const joinViolations: Violation[] = [];
  for (const c of data.credentials) {
    const comp = completionByIdMap.get(c.completion_id);
    if (!comp) continue;
    if (comp.learner_id !== c.learner_id || comp.course_id !== c.course_id) {
      joinViolations.push({
        record_type: 'Credential',
        record_id: c.credential_id,
        detail: `credential (${c.learner_id}, ${c.course_id}) does not match completion (${comp.learner_id}, ${comp.course_id})`,
        expected: isExpected('Credential', c.credential_id),
      });
    }
  }
  add('FK-02', 'join validity', 'Credential learner/course agree with the cited completion record', data.credentials.length, joinViolations);

  /* 3. ID format conventions */
  const idViolations: Violation[] = [];
  let idChecked = 0;
  for (const [label, pattern, extract] of ID_PATTERNS) {
    const [type] = label.split('.');
    for (const { id } of extract(data)) {
      idChecked++;
      if (!pattern.test(id)) {
        idViolations.push({ record_type: type!, record_id: id, detail: `${label} does not match ${pattern}`, expected: false });
      }
    }
  }
  add('ID-01', 'naming conventions', 'All identifiers match their documented zero-padded pattern', idChecked, idViolations);

  /* 4. Enum domains */
  const enumViolations: Violation[] = [];
  let enumChecked = 0;
  const checkEnum = (type: string, id: string, field: string, value: string) => {
    const allowed = ENUMS[`${type}.${field}`];
    if (!allowed) return;
    enumChecked++;
    if (!allowed.includes(value)) {
      enumViolations.push({ record_type: type, record_id: id, detail: `${field}='${value}' outside allowed set`, expected: false });
    }
  };
  for (const r of data.learners) checkEnum('Learner', r.learner_id, 'status', r.status);
  for (const r of data.courses) {
    checkEnum('Course', r.course_id, 'status', r.status);
    checkEnum('Course', r.course_id, 'level', r.level);
  }
  for (const r of data.issuers) checkEnum('Issuer', r.issuer_id, 'status', r.status);
  for (const r of data.credentialRules) checkEnum('CredentialRule', r.rule_id, 'status', r.status);
  for (const r of data.completionRecords) checkEnum('CompletionRecord', r.completion_id, 'status', r.status);
  for (const r of data.credentials) checkEnum('Credential', r.credential_id, 'status', r.status);
  for (const r of data.revocations) {
    checkEnum('Revocation', r.revocation_id, 'status', r.status);
    checkEnum('Revocation', r.revocation_id, 'reason_code', r.reason_code);
  }
  for (const r of data.verificationRequests) {
    checkEnum('VerificationRequest', r.verification_id, 'result', r.result);
    checkEnum('VerificationRequest', r.verification_id, 'identity_match_method', r.identity_match_method);
    checkEnum('VerificationRequest', r.verification_id, 'verifier_type', r.verifier_type);
  }
  add('EN-01', 'enum domains', 'Every enum column holds only documented values', enumChecked, enumViolations);

  /* 5. Date ordering */
  const dateViolations: Violation[] = [];
  let dateChecked = 0;
  const credentialByIdMap = new Map(data.credentials.map((c) => [c.credential_id, c]));

  for (const r of data.completionRecords) {
    dateChecked++;
    if (Date.parse(r.last_activity_at) < Date.parse(r.enrolled_at)) {
      dateViolations.push({ record_type: 'CompletionRecord', record_id: r.completion_id, detail: 'last_activity_at < enrolled_at', expected: false });
    }
    if (r.completed_at && Date.parse(r.completed_at) < Date.parse(r.enrolled_at)) {
      dateViolations.push({ record_type: 'CompletionRecord', record_id: r.completion_id, detail: 'completed_at < enrolled_at', expected: false });
    }
  }
  for (const r of data.credentials) {
    dateChecked++;
    const comp = completionByIdMap.get(r.completion_id);
    if (comp?.completed_at && Date.parse(r.issued_at) < Date.parse(comp.completed_at)) {
      dateViolations.push({
        record_type: 'Credential',
        record_id: r.credential_id,
        detail: `issued_at ${r.issued_at} precedes completed_at ${comp.completed_at}`,
        expected: isExpected('Credential', r.credential_id),
      });
    }
    if (r.expires_at && Date.parse(r.expires_at) <= Date.parse(r.issued_at)) {
      dateViolations.push({ record_type: 'Credential', record_id: r.credential_id, detail: 'expires_at <= issued_at', expected: false });
    }
  }
  for (const r of data.revocations) {
    dateChecked++;
    const cred = credentialByIdMap.get(r.credential_id);
    if (cred && Date.parse(r.revoked_at) <= Date.parse(cred.issued_at)) {
      dateViolations.push({
        record_type: 'Revocation',
        record_id: r.revocation_id,
        detail: 'revoked_at <= credential.issued_at',
        expected: isExpected('Credential', r.credential_id),
      });
    }
  }
  for (const r of data.verificationRequests) {
    if (!r.credential_id) continue;
    dateChecked++;
    const cred = credentialByIdMap.get(r.credential_id);
    if (cred && Date.parse(r.requested_at) < Date.parse(cred.issued_at)) {
      dateViolations.push({
        record_type: 'VerificationRequest',
        record_id: r.verification_id,
        detail: 'requested_at precedes credential.issued_at',
        expected: isExpected('Credential', r.credential_id),
      });
    }
  }
  add('DT-01', 'date ordering', 'Event dates follow their documented ordering', dateChecked, dateViolations);

  /* 6. Arithmetic reconciliation */
  const mathViolations: Violation[] = [];
  for (const r of data.completionRecords) {
    const pct = Math.round((100 * r.modules_completed) / r.modules_total);
    if (pct !== r.modules_completed_pct) {
      mathViolations.push({ record_type: 'CompletionRecord', record_id: r.completion_id, detail: `modules_completed_pct ${r.modules_completed_pct} != derived ${pct}`, expected: false });
    }
    if (r.assessments_passed > r.assessments_taken) {
      mathViolations.push({ record_type: 'CompletionRecord', record_id: r.completion_id, detail: 'assessments_passed > assessments_taken', expected: false });
    }
    if (r.modules_completed > r.modules_total) {
      mathViolations.push({ record_type: 'CompletionRecord', record_id: r.completion_id, detail: 'modules_completed > modules_total', expected: false });
    }
    if (r.overall_score < 0 || r.overall_score > 100) {
      mathViolations.push({ record_type: 'CompletionRecord', record_id: r.completion_id, detail: 'overall_score outside 0..100', expected: false });
    }
    if (r.completed_at !== null) {
      const expected = daysBetween(new Date(r.enrolled_at), new Date(r.completed_at));
      if (expected !== r.days_to_complete) {
        mathViolations.push({ record_type: 'CompletionRecord', record_id: r.completion_id, detail: `days_to_complete ${r.days_to_complete} != derived ${expected}`, expected: false });
      }
    } else if (r.days_to_complete !== null) {
      mathViolations.push({ record_type: 'CompletionRecord', record_id: r.completion_id, detail: 'days_to_complete set without completed_at', expected: false });
    }
  }
  add('AR-01', 'arithmetic reconciliation', 'Derived numeric columns recompute from their sources', data.completionRecords.length, mathViolations);

  /* 7. Lifecycle consistency */
  const lifecycleViolations: Violation[] = [];
  // The dataset's "now" is a fixed, documented constant — never Date.now() and never inferred from the
  // data, or the same files would validate differently tomorrow.
  const asOf = AS_OF;
  const revocationsByCred = new Map<string, Revocation[]>();
  for (const r of data.revocations) {
    const list = revocationsByCred.get(r.credential_id) ?? [];
    list.push(r);
    revocationsByCred.set(r.credential_id, list);
  }
  for (const r of data.credentials) {
    const derived = deriveCredentialStatus(r, revocationsByCred.get(r.credential_id) ?? [], asOf);
    if (derived !== r.status) {
      lifecycleViolations.push({
        record_type: 'Credential',
        record_id: r.credential_id,
        detail: `status ${r.status} but revocation/expiry replay derives ${derived}`,
        expected: isExpected('Credential', r.credential_id),
      });
    }
  }
  const courseByIdMap = new Map(data.courses.map((c) => [c.course_id, c]));
  for (const r of data.completionRecords) {
    const course = courseByIdMap.get(r.course_id);
    if (!course) continue;
    const derived = deriveCompletionStatus({
      modules_total: r.modules_total,
      modules_completed: r.modules_completed,
      assessments_taken: r.assessments_taken,
      assessments_passed: r.assessments_passed,
      assessment_count: course.assessment_count,
      enrolled_at: new Date(r.enrolled_at),
      last_activity_at: new Date(r.last_activity_at),
      asOf: AS_OF,
    });
    if (derived !== r.status) {
      lifecycleViolations.push({
        record_type: 'CompletionRecord',
        record_id: r.completion_id,
        detail: `status ${r.status} but the documented rule derives ${derived}`,
        expected: false,
      });
    }
  }
  for (const [credentialId, list] of revocationsByCred) {
    const seqs = list.map((r) => r.sequence_no).sort((a, b) => a - b);
    const expectedSeq = seqs.map((_, i) => i + 1);
    if (JSON.stringify(seqs) !== JSON.stringify(expectedSeq)) {
      lifecycleViolations.push({ record_type: 'Credential', record_id: credentialId, detail: `revocation sequence ${seqs.join(',')} is not 1..n`, expected: false });
    }
  }
  add('LC-01', 'lifecycle transitions', 'Entity states agree with a replay of their event history', data.credentials.length + data.completionRecords.length, lifecycleViolations);

  /* 8. Uniqueness of natural keys (and the deliberate name duplication) */
  const dupViolations: Violation[] = [];
  const uniqueCheck = (type: string, label: string, pairs: [string, string][]) => {
    const seen = new Map<string, string>();
    for (const [id, value] of pairs) {
      if (seen.has(value)) {
        dupViolations.push({ record_type: type, record_id: id, detail: `${label} '${value}' duplicates ${seen.get(value)}`, expected: false });
      } else seen.set(value, id);
    }
  };
  uniqueCheck('Learner', 'email', data.learners.map((r) => [r.learner_id, r.email]));
  uniqueCheck('Learner', 'national_id_hash', data.learners.map((r) => [r.learner_id, r.national_id_hash]));
  uniqueCheck('Course', 'course_code', data.courses.map((r) => [r.course_id, r.course_code]));
  uniqueCheck('Issuer', 'public_key', data.issuers.map((r) => [r.issuer_id, r.public_key]));
  add('UQ-01', 'natural-key uniqueness', 'Unique business keys (email, national_id_hash, course_code, public_key) do not collide', data.learners.length * 2 + data.courses.length + data.issuers.length, dupViolations);

  /* 9. Issuance rule enforcement — re-evaluate every issued credential from source records */
  const ruleById = new Map(data.credentialRules.map((r) => [r.rule_id, r]));
  const issuanceViolations: Violation[] = [];
  for (const c of data.credentials) {
    const comp = completionByIdMap.get(c.completion_id);
    const course = courseByIdMap.get(c.course_id);
    const rule = ruleById.get(c.rule_id);
    if (!comp || !course || !rule) continue;
    const decision = evaluateIssuance(comp, course, rule, new Date(comp.completed_at ?? c.issued_at));
    if (decision.decision !== 'APPROVED') {
      issuanceViolations.push({
        record_type: 'Credential',
        record_id: c.credential_id,
        detail: `re-evaluation denies issuance: ${decision.failed_criteria.join(', ')}`,
        expected: isExpected('Credential', c.credential_id),
      });
    }
  }
  add('IS-01', 'issuance rules enforced', 'Every issued credential still passes its pinned rule version', data.credentials.length, issuanceViolations);

  /* 10. Cryptographic integrity */
  const pubKeyById = new Map(data.issuers.map((i) => [i.issuer_id, i.public_key]));
  const hashViolations: Violation[] = [];
  const sigViolations: Violation[] = [];
  for (const c of data.credentials) {
    let recomputed = '';
    try {
      recomputed = payloadHash(JSON.parse(c.payload_json));
    } catch {
      recomputed = 'UNPARSEABLE';
    }
    if (recomputed !== c.payload_hash) {
      hashViolations.push({
        record_type: 'Credential',
        record_id: c.credential_id,
        detail: 'sha256(canonical(payload_json)) does not equal payload_hash',
        expected: isExpected('Credential', c.credential_id),
      });
    }
    const pk = pubKeyById.get(c.issuer_id);
    if (!pk || !verifySignature(pk, c.payload_hash, c.signature)) {
      sigViolations.push({ record_type: 'Credential', record_id: c.credential_id, detail: 'Ed25519 signature does not verify against the issuer public key', expected: isExpected('Credential', c.credential_id) });
    }
  }
  add('HS-01', 'payload integrity', 'Stored payload hash recomputes from the stored payload', data.credentials.length, hashViolations);
  add('SG-01', 'issuer signatures', 'Every credential signature verifies against its issuer public key', data.credentials.length, sigViolations);

  /* 11. Audit chain */
  const chain = verifyAuditChain(data.auditEvents);
  const seqGaps: Violation[] = [];
  data.auditEvents.forEach((e, i) => {
    if (e.event_seq !== i + 1) seqGaps.push({ record_type: 'AuditEvent', record_id: e.event_id, detail: `event_seq ${e.event_seq} breaks monotonic ordering at row ${i + 1}`, expected: false });
  });
  add('AU-01', 'audit chain integrity', 'Hash chain replays from genesis without a break', data.auditEvents.length,
    chain.valid ? [] : [{ record_type: 'AuditEvent', record_id: chain.brokenAt ?? 'unknown', detail: 'hash chain broken', expected: false }]);
  add('AU-02', 'audit sequence', 'event_seq is monotonic with no gaps', data.auditEvents.length, seqGaps.slice(0, 50));

  const futureEvents: Violation[] = data.auditEvents
    .filter((e) => Date.parse(e.occurred_at) > AS_OF.getTime())
    .slice(0, 50)
    .map((e) => ({ record_type: 'AuditEvent', record_id: e.event_id, detail: `occurred_at ${e.occurred_at} is after the dataset as-of date`, expected: false }));
  add('AU-03', 'audit timing', 'No audit event is dated after the dataset as-of instant', data.auditEvents.length, futureEvents);

  /* 12. Verification reproducibility — recompute every recorded result */
  const reproViolations: Violation[] = [];
  for (const v of data.verificationRequests) {
    const cred = v.credential_id ? credentialByIdMap.get(v.credential_id) ?? null : null;
    const outcome = verifyCredential({
      credential: cred,
      revocations: cred ? revocationsByCred.get(cred.credential_id) ?? [] : [],
      issuerPublicKeyHex: cred ? pubKeyById.get(cred.issuer_id) ?? null : null,
      presentedHash: v.presented_hash,
      identityMatchMethod: v.identity_match_method,
      identityMatchScore: v.identity_match_score,
      asOf: new Date(v.requested_at),
    });
    if (outcome.result !== v.result) {
      reproViolations.push({
        record_type: 'VerificationRequest',
        record_id: v.verification_id,
        detail: `recorded ${v.result} but deterministic re-verification yields ${outcome.result}`,
        expected:
          isExpected('VerificationRequest', v.verification_id) ||
          (v.credential_id !== null && isExpected('Credential', v.credential_id)),
      });
    }
  }
  add('VR-01', 'verification reproducibility', 'Re-running verification reproduces the recorded result', data.verificationRequests.length, reproViolations);

  /* 13. Identity matching must never rest on a name alone */
  const identityViolations: Violation[] = [];
  for (const v of data.verificationRequests) {
    if (v.result === 'VALID' && (v.identity_match_method === 'NAME_ONLY' || v.identity_match_score < 0.9)) {
      identityViolations.push({
        record_type: 'VerificationRequest',
        record_id: v.verification_id,
        detail: `VALID returned on a weak identity match (${v.identity_match_method}, score ${v.identity_match_score})`,
        expected: isExpected('VerificationRequest', v.verification_id),
      });
    }
  }
  add('ID-02', 'identity matching', 'A VALID result never rests on name-only or sub-threshold identity matching', data.verificationRequests.length, identityViolations);

  /* 14. Canonical JSON stability */
  const canonViolations: Violation[] = [];
  for (const c of data.credentials.slice(0, 2000)) {
    try {
      const parsed = JSON.parse(c.payload_json);
      if (payloadHash(parsed) !== payloadHash(JSON.parse(canonicalize(parsed)))) {
        canonViolations.push({ record_type: 'Credential', record_id: c.credential_id, detail: 'canonicalisation is not idempotent', expected: false });
      }
    } catch {
      canonViolations.push({ record_type: 'Credential', record_id: c.credential_id, detail: 'payload_json is not valid JSON', expected: false });
    }
  }
  add('CN-01', 'canonical form stability', 'Canonicalising a payload twice yields the same hash', Math.min(2000, data.credentials.length), canonViolations);

  return results;
}

/* -------------------------------------------- anomaly detection + metrics */

export interface Detection {
  record_type: string;
  record_id: string;
  issue_type: IssueType;
  evidence: string;
}

/**
 * Detectors run against the feature files only. The ground-truth file is opened afterwards, purely to
 * score these findings — it is never consulted while detecting (Step 7: no leakage into features).
 */
export function detectAnomalies(data: LoadedData): Detection[] {
  const detections: Detection[] = [];
  const completionById = new Map(data.completionRecords.map((c) => [c.completion_id, c]));
  const credentialById = new Map<string, Credential>();
  const revocationsByCred = new Map<string, Revocation[]>();
  const pubKeyById = new Map(data.issuers.map((i) => [i.issuer_id, i.public_key]));

  for (const r of data.revocations) {
    const list = revocationsByCred.get(r.credential_id) ?? [];
    list.push(r);
    revocationsByCred.set(r.credential_id, list);
  }

  // EC-02 — duplicate credential id
  const seenCredential = new Set<string>();
  const duplicatedIds = new Set<string>();
  for (const c of data.credentials) {
    if (seenCredential.has(c.credential_id)) {
      duplicatedIds.add(c.credential_id);
      detections.push({
        record_type: 'Credential',
        record_id: c.credential_id,
        issue_type: 'EC02_DUPLICATE_CREDENTIAL_ID',
        evidence: `credential_id ${c.credential_id} appears on more than one row`,
      });
    } else {
      seenCredential.add(c.credential_id);
      credentialById.set(c.credential_id, c);
    }
  }

  for (const c of data.credentials) {
    // EC-01 — issued before the cited completion
    const comp = completionById.get(c.completion_id);
    if (comp?.completed_at && Date.parse(c.issued_at) < Date.parse(comp.completed_at)) {
      detections.push({
        record_type: 'Credential',
        record_id: c.credential_id,
        issue_type: 'EC01_ISSUED_BEFORE_COMPLETION',
        evidence: `issued_at ${c.issued_at} precedes completed_at ${comp.completed_at}`,
      });
    }

    // EC-04 — stored payload no longer hashes to the stored hash
    let recomputed = '';
    try {
      recomputed = payloadHash(JSON.parse(c.payload_json));
    } catch {
      recomputed = 'UNPARSEABLE';
    }
    if (recomputed !== c.payload_hash) {
      detections.push({
        record_type: 'Credential',
        record_id: c.credential_id,
        issue_type: 'EC04_ALTERED_PAYLOAD_HASH_UNDETECTED',
        evidence: `recomputed ${recomputed.slice(0, 16)}… != stored ${c.payload_hash.slice(0, 16)}…`,
      });
    }
  }

  for (const v of data.verificationRequests) {
    if (!v.credential_id) continue;

    // A request against an ambiguous id has no well-defined answer — report it and move on rather than
    // picking one of the colliding rows and pretending the result is meaningful.
    if (duplicatedIds.has(v.credential_id)) {
      detections.push({
        record_type: 'VerificationRequest',
        record_id: v.verification_id,
        issue_type: 'EC02_DUPLICATE_CREDENTIAL_ID',
        evidence: `credential_id ${v.credential_id} resolves to more than one credential row`,
      });
      continue;
    }

    const cred = credentialById.get(v.credential_id);
    if (!cred) continue;
    const outcome = verifyCredential({
      credential: cred,
      revocations: revocationsByCred.get(cred.credential_id) ?? [],
      issuerPublicKeyHex: pubKeyById.get(cred.issuer_id) ?? null,
      presentedHash: v.presented_hash,
      identityMatchMethod: v.identity_match_method,
      identityMatchScore: v.identity_match_score,
      asOf: new Date(v.requested_at),
    });
    if (outcome.result === v.result) continue;

    // EC-03 — recorded VALID while a revocation was in force at request time
    const revocation = currentRevocation(revocationsByCred.get(cred.credential_id) ?? [], new Date(v.requested_at));
    if (v.result === 'VALID' && revocation && Date.parse(revocation.revoked_at) <= Date.parse(v.requested_at)) {
      detections.push({
        record_type: 'VerificationRequest',
        record_id: v.verification_id,
        issue_type: 'EC03_REVOKED_VERIFIES_ACTIVE',
        evidence: `revocation ${revocation.revocation_id} active since ${revocation.revoked_at}, yet result recorded VALID`,
      });
      continue;
    }

    // EC-04 as seen from the verification side
    if (v.result === 'VALID' && outcome.result === 'INVALID_HASH_MISMATCH') {
      detections.push({
        record_type: 'VerificationRequest',
        record_id: v.verification_id,
        issue_type: 'EC04_ALTERED_PAYLOAD_HASH_UNDETECTED',
        evidence: 'recorded VALID although the payload no longer matches its sealed hash',
      });
    }
  }

  return detections;
}

export interface MetricRow {
  issue_type: string;
  expected: number;
  detected: number;
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export function scoreDetections(detections: Detection[], groundTruth: GroundTruthRow[]): {
  perType: MetricRow[];
  overall: MetricRow;
} {
  const key = (t: string, id: string, issue: string) => `${t}|${id}|${issue}`;
  const truth = new Set(groundTruth.map((g) => key(g.record_type, g.record_id, g.issue_type)));
  const found = new Set(detections.map((d) => key(d.record_type, d.record_id, d.issue_type)));

  const types = [...new Set([...groundTruth.map((g) => g.issue_type), ...detections.map((d) => d.issue_type)])].sort();

  const metric = (label: string, truthSet: Set<string>, foundSet: Set<string>): MetricRow => {
    let tp = 0;
    for (const f of foundSet) if (truthSet.has(f)) tp++;
    const fp = foundSet.size - tp;
    const fn = truthSet.size - tp;
    const precision = foundSet.size === 0 ? (truthSet.size === 0 ? 1 : 0) : tp / foundSet.size;
    const recall = truthSet.size === 0 ? 1 : tp / truthSet.size;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return {
      issue_type: label,
      expected: truthSet.size,
      detected: foundSet.size,
      true_positives: tp,
      false_positives: fp,
      false_negatives: fn,
      precision: Math.round(precision * 10000) / 10000,
      recall: Math.round(recall * 10000) / 10000,
      f1: Math.round(f1 * 10000) / 10000,
    };
  };

  const perType = types.map((t) =>
    metric(
      t,
      new Set([...truth].filter((k) => k.endsWith(`|${t}`))),
      new Set([...found].filter((k) => k.endsWith(`|${t}`))),
    ),
  );

  return { perType, overall: metric('OVERALL', truth, found) };
}

/* ------------------------------------------------------------ profiling */

export function profile(data: LoadedData) {
  const tally = <T>(rows: T[], pick: (r: T) => string) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = pick(r);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return Object.fromEntries([...map].sort((a, b) => b[1] - a[1]));
  };

  const nameCounts = new Map<string, number>();
  for (const l of data.learners) nameCounts.set(l.full_name, (nameCounts.get(l.full_name) ?? 0) + 1);
  const duplicateNames = [...nameCounts.values()].filter((n) => n > 1).length;
  const learnersSharingAName = [...nameCounts.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0);

  const scores = data.completionRecords.filter((c) => c.assessments_taken > 0).map((c) => c.overall_score).sort((a, b) => a - b);
  const quantile = (q: number) => (scores.length === 0 ? 0 : scores[Math.min(scores.length - 1, Math.floor(q * scores.length))]!);

  return {
    row_counts: {
      learners: data.learners.length,
      courses: data.courses.length,
      issuers: data.issuers.length,
      credential_rules: data.credentialRules.length,
      completion_records: data.completionRecords.length,
      credentials: data.credentials.length,
      verification_requests: data.verificationRequests.length,
      revocations: data.revocations.length,
      audit_events: data.auditEvents.length,
      ground_truth: data.groundTruth.length,
    },
    completion_status: tally(data.completionRecords, (c) => c.status),
    credential_status: tally(data.credentials, (c) => c.status),
    verification_result: tally(data.verificationRequests, (v) => v.result),
    identity_match_method: tally(data.verificationRequests, (v) => v.identity_match_method),
    verifier_type: tally(data.verificationRequests, (v) => v.verifier_type),
    revocation_reason: tally(data.revocations, (r) => r.reason_code),
    course_level: tally(data.courses, (c) => c.level),
    learner_country: tally(data.learners, (l) => l.country),
    issuer_usage: tally(data.credentials, (c) => c.issuer_id),
    identity_coverage: {
      distinct_full_names: nameCounts.size,
      names_shared_by_more_than_one_learner: duplicateNames,
      learners_sharing_a_name: learnersSharingAName,
      note: 'Name collisions are deliberate: identity resolution must use learner_id, verification_code or national_id_hash.',
    },
    overall_score_distribution: {
      p10: quantile(0.1),
      p25: quantile(0.25),
      median: quantile(0.5),
      p75: quantile(0.75),
      p90: quantile(0.9),
    },
    incomplete_courses: data.completionRecords.filter((c) => c.status !== 'COMPLETED').length,
    issuer_changes: data.issuers.filter((i) => i.supersedes_issuer_id !== null).length,
  };
}
