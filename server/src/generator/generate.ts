import { AuditChain } from '../lib/audit.js';
import {
  activeRuleAt,
  buildPayload,
  deriveCompletionStatus,
  deriveCredentialStatus,
  evaluateIssuance,
  IDENTITY_METHOD_SCORE,
  sealPayload,
  verifyCredential,
} from '../engine/rules.js';
import {
  addDays,
  addYears,
  completionId,
  courseId,
  credentialId,
  dateBetween,
  daysBetween,
  deriveKeyPair,
  issuerId,
  learnerId,
  pad,
  payloadHash,
  revocationId,
  rngFor,
  ruleId,
  sha256Hex,
  verificationCode,
  verificationId,
} from '../lib/deterministic.js';
import type {
  CompletionRecord,
  Course,
  Credential,
  CredentialRule,
  Dataset,
  GroundTruthRow,
  IdentityMatchMethod,
  Issuer,
  Learner,
  Revocation,
  VerificationRequest,
  VerifierType,
} from '../lib/types.js';
import {
  ACCREDITATION_BODIES,
  ADMIN_ACTORS,
  COUNTRY_WEIGHTS,
  FIRST_NAMES,
  IDENTITY_METHOD_WEIGHTS,
  INSTRUCTOR_ACTORS,
  ISSUER_NAMES,
  LAST_NAMES,
  LEVEL_WEIGHTS,
  REVOCATION_REASON_TEXT,
  REVOCATION_REASON_WEIGHTS,
  SUBJECT_AREAS,
  SUBJECT_TOPICS,
  VERIFIER_ORGS,
  VERIFIER_TYPE_WEIGHTS,
} from './reference.js';

export interface GeneratorConfig {
  seed: number;
  scale: number;
  learners: number;
  courses: number;
  credentials: number;
  verifications: number;
  asOf: Date;
}

export const BASELINE = {
  learners: 20_000,
  courses: 1_000,
  credentials: 10_000,
  verifications: 5_000,
};

/** Dataset "now". Fixed, not Date.now(), or the output would not be reproducible. */
export const AS_OF = new Date('2026-10-22T00:00:00.000Z');

export function resolveConfig(seed: number, scale: number): GeneratorConfig {
  const at = (n: number) => Math.max(1, Math.round(n * scale));
  return {
    seed,
    scale,
    learners: at(BASELINE.learners),
    courses: at(BASELINE.courses),
    credentials: at(BASELINE.credentials),
    verifications: at(BASELINE.verifications),
    asOf: AS_OF,
  };
}

/** Edge-case volumes scale with the dataset but never drop below one of each. */
function edgeCaseCounts(scale: number) {
  const at = (n: number) => Math.max(1, Math.round(n * Math.max(scale, 0.05)));
  return {
    issuedBeforeCompletion: at(14),
    duplicateCredentialId: at(6),
    revokedVerifiesActive: at(18),
    alteredPayloadHash: at(11),
  };
}

const COURSE_START = new Date('2022-01-01T00:00:00.000Z');
const COURSE_LATEST_START = new Date('2025-06-30T00:00:00.000Z');
const ENROLL_START = new Date('2023-01-01T00:00:00.000Z');
const ENROLL_END = new Date('2026-06-30T00:00:00.000Z');

export function generateDataset(config: GeneratorConfig): Dataset {
  const { seed, asOf } = config;
  const audit = new AuditChain();
  const groundTruth: GroundTruthRow[] = [];

  /* ------------------------------------------------------- Step 2a: Issuers */

  const issuers: Issuer[] = [];
  const issuerKeys = new Map<string, string>();

  // Four original issuers, then two successors — this is the "issuer change" coverage the brief asks for.
  const ISSUER_PLAN = [
    { index: 1, supersedes: null as string | null, from: '2021-06-01', to: null as string | null },
    { index: 2, supersedes: null, from: '2021-06-01', to: '2024-09-30' },
    { index: 3, supersedes: null, from: '2021-06-01', to: '2025-03-31' },
    { index: 4, supersedes: null, from: '2022-01-15', to: null },
    { index: 5, supersedes: issuerId(2), from: '2024-09-30', to: null },
    { index: 6, supersedes: issuerId(3), from: '2025-03-31', to: null },
  ];

  for (const plan of ISSUER_PLAN) {
    const id = issuerId(plan.index);
    const rng = rngFor(seed, 'issuer', id);
    const keys = deriveKeyPair(seed, id);
    issuerKeys.set(id, keys.privateKeyHex);
    const issuer: Issuer = {
      issuer_id: id,
      legal_name: ISSUER_NAMES[plan.index - 1] ?? `Issuer ${plan.index}`,
      accreditation_body: rng.pick(ACCREDITATION_BODIES),
      key_algorithm: 'Ed25519',
      public_key: keys.publicKeyHex,
      effective_from: new Date(`${plan.from}T00:00:00.000Z`).toISOString(),
      effective_to: plan.to ? new Date(`${plan.to}T00:00:00.000Z`).toISOString() : null,
      supersedes_issuer_id: plan.supersedes,
      status: plan.to ? 'SUPERSEDED' : 'ACTIVE',
    };
    issuers.push(issuer);
    audit.append({
      entity_type: 'ISSUER',
      entity_id: id,
      event_type: 'CREATED',
      actor_id: 'SYS',
      actor_role: 'SYSTEM',
      occurred_at: new Date(issuer.effective_from),
      payload: { legal_name: issuer.legal_name, supersedes: plan.supersedes },
    });
    if (plan.to) {
      audit.append({
        entity_type: 'ISSUER',
        entity_id: id,
        event_type: 'ISSUER_SUPERSEDED',
        actor_id: 'ADM-001',
        actor_role: 'PLATFORM_ADMIN',
        occurred_at: new Date(issuer.effective_to!),
        payload: { from: 'ACTIVE', to: 'SUPERSEDED' },
      });
    }
  }

  const issuerActiveAt = (at: Date): Issuer => {
    const t = at.getTime();
    const candidates = issuers.filter((i) => {
      const from = Date.parse(i.effective_from);
      const to = i.effective_to === null ? Number.POSITIVE_INFINITY : Date.parse(i.effective_to);
      return from <= t && t < to;
    });
    return candidates.length > 0 ? candidates[Math.floor(t / 86_400_000) % candidates.length]! : issuers[0]!;
  };

  /* ------------------------------------------------------- Step 2b: Courses */

  const courses: Course[] = [];
  const subjectCounters = new Map<string, number>();

  for (let i = 1; i <= config.courses; i++) {
    const id = courseId(i);
    const rng = rngFor(seed, 'course', id);
    const subject = rng.pick(SUBJECT_AREAS);
    const nextCode = (subjectCounters.get(subject) ?? 0) + 1;
    subjectCounters.set(subject, nextCode);
    const level = rng.weighted(LEVEL_WEIGHTS);
    const topic = rng.pick(SUBJECT_TOPICS[subject]!);
    const effectiveFrom = dateBetween(rng, COURSE_START, COURSE_LATEST_START);
    // ~8% of courses are retired — they still carry historical credentials.
    const retired = rng.bool(0.08);
    const effectiveTo = retired ? addDays(effectiveFrom, rng.int(400, 1200)) : null;
    const modulesTotal = rng.intNormal(12, 4, 4, 24);

    courses.push({
      course_id: id,
      course_code: `${subject}-${pad(nextCode, 3)}`,
      title: `${topic} (${level.charAt(0) + level.slice(1).toLowerCase()})`,
      subject_area: subject,
      level,
      credit_hours: rng.intNormal(45, 22, 10, 120),
      modules_total: modulesTotal,
      assessment_count: Math.min(modulesTotal, rng.intNormal(3, 1.3, 1, 6)),
      passing_score: rng.int(50, 75),
      effective_from: effectiveFrom.toISOString(),
      effective_to: effectiveTo ? effectiveTo.toISOString() : null,
      status: retired ? 'RETIRED' : 'ACTIVE',
    });
  }

  const courseById = new Map(courses.map((c) => [c.course_id, c]));

  /* -------------------------------------------- Step 2c: CredentialRules */

  const credentialRules: CredentialRule[] = [];
  const rulesByCourse = new Map<string, CredentialRule[]>();

  for (let i = 1; i <= config.courses; i++) {
    const course = courses[i - 1]!;
    const rng = rngFor(seed, 'rule', course.course_id);
    const versions = rng.weighted([
      [1, 62],
      [2, 28],
      [3, 10],
    ]);
    const courseFrom = new Date(course.effective_from);
    const list: CredentialRule[] = [];

    // Versions are spaced evenly between the course's start and the dataset's fixed "now", so no rule
    // (and therefore no audit event) is ever dated in the future.
    const windowDays = Math.max(versions, daysBetween(courseFrom, asOf));
    const spacing = Math.floor(windowDays / versions);

    for (let v = 1; v <= versions; v++) {
      const vrng = rngFor(seed, 'rule-version', `${course.course_id}|${v}`);
      const from = v === 1 ? courseFrom : addDays(courseFrom, (v - 1) * spacing);
      const isLast = v === versions;
      const to = isLast ? null : addDays(courseFrom, v * spacing);
      const rule: CredentialRule = {
        rule_id: ruleId(i, v),
        course_id: course.course_id,
        rule_version: v,
        // Rules never sit below the course's own passing score.
        min_overall_score: Math.max(course.passing_score, vrng.int(50, 80)),
        min_modules_completed_pct: vrng.weighted([
          [100, 58],
          [95, 22],
          [90, 14],
          [80, 6],
        ]),
        required_assessments_passed: Math.max(1, Math.min(course.assessment_count, vrng.intNormal(2, 1, 1, 6))),
        min_attendance_pct: vrng.weighted([
          [0, 34],
          [60, 22],
          [70, 24],
          [80, 14],
          [85, 6],
        ]),
        max_days_to_complete: vrng.weighted([
          [540, 30],
          [365, 32],
          [240, 20],
          [120, 12],
          [60, 6],
        ]),
        effective_from: from.toISOString(),
        effective_to: to ? to.toISOString() : null,
        status: isLast ? 'ACTIVE' : 'SUPERSEDED',
      };
      list.push(rule);
      credentialRules.push(rule);
      audit.append({
        entity_type: 'RULE',
        entity_id: rule.rule_id,
        event_type: 'CREATED',
        actor_id: INSTRUCTOR_ACTORS[i % INSTRUCTOR_ACTORS.length]!,
        actor_role: 'INSTRUCTOR',
        occurred_at: from,
        payload: { course_id: course.course_id, rule_version: v, min_overall_score: rule.min_overall_score },
      });
    }
    rulesByCourse.set(course.course_id, list);
  }

  /* ------------------------------------------------------ Step 2d: Learners */

  const learners: Learner[] = [];
  for (let i = 1; i <= config.learners; i++) {
    const id = learnerId(i);
    const rng = rngFor(seed, 'learner', id);
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    const dob = dateBetween(rng, new Date('1960-01-01T00:00:00.000Z'), new Date('2008-12-31T00:00:00.000Z'));
    const earliestEnroll = new Date(Math.max(ENROLL_START.getTime(), addYears(dob, 16).getTime()));
    const enrollment = dateBetween(rng, earliestEnroll, ENROLL_END);

    learners.push({
      learner_id: id,
      first_name: first,
      last_name: last,
      full_name: `${first} ${last}`,
      // The numeric suffix is what makes the email unique where the name is not.
      email: `${first.toLowerCase()}.${last.toLowerCase()}.${pad(i, 6)}@learners.vericred.example`,
      date_of_birth: dob.toISOString().slice(0, 10),
      national_id_hash: sha256Hex(`${seed}|national-id|${id}`),
      country: rng.weighted(COUNTRY_WEIGHTS),
      enrollment_date: enrollment.toISOString(),
      status: rng.weighted([
        ['ACTIVE', 86],
        ['INACTIVE', 11],
        ['SUSPENDED', 3],
      ]),
      created_at: enrollment.toISOString(),
    });
  }

  /* ------------------------- Step 2e: CompletionRecords (all values derived) */

  const completionRecords: CompletionRecord[] = [];

  for (const learner of learners) {
    const rng = rngFor(seed, 'enrollments', learner.learner_id);
    const enrollCount = rng.weighted([
      [1, 34],
      [2, 30],
      [3, 20],
      [4, 11],
      [5, 5],
    ]);
    const learnerEnrolled = new Date(learner.enrollment_date);
    const chosen = new Set<string>();

    for (let k = 0; k < enrollCount; k++) {
      const pickRng = rngFor(seed, 'enroll-pick', `${learner.learner_id}|${k}`);
      const course = courses[pickRng.int(0, courses.length - 1)]!;
      if (chosen.has(course.course_id)) continue; // a learner enrols in a course at most once
      chosen.add(course.course_id);

      const cid = completionId(learner.learner_id, course.course_id);
      const crng = rngFor(seed, 'completion', cid);

      const courseFrom = new Date(course.effective_from);
      const enrollFloor = new Date(Math.max(learnerEnrolled.getTime(), courseFrom.getTime()));
      if (enrollFloor.getTime() >= asOf.getTime()) continue; // course not yet available to this learner

      // Raw facts first; status and scores are then derived from them (Step 6).
      const path = crng.weighted([
        ['FULL', 46],
        ['PARTIAL', 30],
        ['STALE', 14],
        ['FAIL', 10],
      ]);

      const modulesTotal = course.modules_total;
      let modulesCompleted: number;
      let assessmentsTaken: number;
      let assessmentScores: number[] = [];

      if (path === 'FULL') {
        modulesCompleted = modulesTotal;
        assessmentsTaken = course.assessment_count;
      } else if (path === 'FAIL') {
        modulesCompleted = modulesTotal;
        assessmentsTaken = course.assessment_count;
      } else {
        modulesCompleted = crng.int(0, Math.max(0, modulesTotal - 1));
        assessmentsTaken = Math.min(
          course.assessment_count,
          Math.floor((modulesCompleted / modulesTotal) * course.assessment_count),
        );
      }

      for (let a = 0; a < assessmentsTaken; a++) {
        const argn = rngFor(seed, 'assessment', `${cid}|${a}`);
        // Failing learners sit the assessments but score below the course threshold by construction.
        const score =
          path === 'FAIL'
            ? argn.intNormal(course.passing_score - 14, 7, 0, course.passing_score - 1)
            : argn.intNormal(74, 13, 0, 100);
        assessmentScores.push(score);
      }

      const assessmentsPassed = assessmentScores.filter((s) => s >= course.passing_score).length;
      const overallScore =
        assessmentScores.length === 0
          ? 0
          : Math.round(assessmentScores.reduce((a, b) => a + b, 0) / assessmentScores.length);

      // Activity duration is drawn first and the enrolment window is then narrowed to fit before the
      // as-of date. Clamping last_activity_at to as-of instead would pile every long-running course
      // onto a single day and put a false spike at the end of every time series.
      let activeDays = path === 'STALE' ? crng.int(10, 120) : crng.intNormal(120, 80, 7, 700);
      // One extra day of headroom: enrolled_at carries a time of day, so adding whole days back could
      // otherwise land just past the as-of midnight and date an audit event in the future.
      const latestEnrol = addDays(asOf, -(activeDays + 1));
      if (latestEnrol.getTime() <= enrollFloor.getTime()) {
        const room = daysBetween(enrollFloor, asOf) - 1;
        if (room < 7) continue; // no room for a meaningful enrolment on this course
        activeDays = crng.int(1, room);
      }
      const enrolledAt = dateBetween(crng, enrollFloor, addDays(asOf, -(activeDays + 1)));
      const lastActivity = addDays(enrolledAt, activeDays);

      const status = deriveCompletionStatus({
        modules_total: modulesTotal,
        modules_completed: modulesCompleted,
        assessments_taken: assessmentsTaken,
        assessments_passed: assessmentsPassed,
        assessment_count: course.assessment_count,
        enrolled_at: enrolledAt,
        last_activity_at: lastActivity,
        asOf,
      });

      const completedAt = status === 'COMPLETED' ? lastActivity : null;

      completionRecords.push({
        completion_id: cid,
        learner_id: learner.learner_id,
        course_id: course.course_id,
        enrolled_at: enrolledAt.toISOString(),
        last_activity_at: lastActivity.toISOString(),
        completed_at: completedAt ? completedAt.toISOString() : null,
        modules_total: modulesTotal,
        modules_completed: modulesCompleted,
        modules_completed_pct: Math.round((100 * modulesCompleted) / modulesTotal),
        attendance_pct: crng.intNormal(82, 15, 0, 100),
        assessments_taken: assessmentsTaken,
        assessments_passed: assessmentsPassed,
        overall_score: overallScore,
        days_to_complete: completedAt ? daysBetween(enrolledAt, completedAt) : null,
        status,
      });
    }
  }

  const completionById = new Map(completionRecords.map((c) => [c.completion_id, c]));
  const learnerById = new Map(learners.map((l) => [l.learner_id, l]));

  /* ------------- Step 2f: Issuance — credentials only where the rules pass */

  interface Candidate {
    completion: CompletionRecord;
    course: Course;
    rule: CredentialRule;
    decision: ReturnType<typeof evaluateIssuance>;
    evaluatedAt: Date;
  }

  const approved: Candidate[] = [];
  const denied: Candidate[] = [];

  for (const completion of completionRecords) {
    if (completion.completed_at === null) continue; // nothing to evaluate yet
    const course = courseById.get(completion.course_id)!;
    const evaluatedAt = new Date(completion.completed_at);
    const rule = activeRuleAt(rulesByCourse.get(completion.course_id) ?? [], evaluatedAt)
      ?? rulesByCourse.get(completion.course_id)!.at(-1)!;
    const decision = evaluateIssuance(completion, course, rule, evaluatedAt);
    (decision.decision === 'APPROVED' ? approved : denied).push({ completion, course, rule, decision, evaluatedAt });
  }

  /*
   * More candidates pass their rule than the target credential count, so some sit in a backlog. Which
   * ones is decided by a stable per-candidate score derived from the seed, not by taking the oldest N:
   * an oldest-first cut would push the entire backlog into the most recent months and leave a cliff at
   * the end of every time series. Sampling across the whole period spreads the backlog the way a real
   * issuance queue does, and stays deterministic because the score depends only on the completion id.
   */
  const issuanceScore = (completionId: string) =>
    parseInt(sha256Hex(`${seed}|issuance-selection|${completionId}`).slice(0, 13), 16);

  const toIssue = [...approved]
    .sort((a, b) => {
      const d = issuanceScore(a.completion.completion_id) - issuanceScore(b.completion.completion_id);
      return d !== 0 ? d : a.completion.completion_id < b.completion.completion_id ? -1 : 1;
    })
    .slice(0, config.credentials)
    // Issue in chronological order so credential numbers run forward in time.
    .sort((a, b) => {
      const t = a.evaluatedAt.getTime() - b.evaluatedAt.getTime();
      return t !== 0 ? t : a.completion.completion_id < b.completion.completion_id ? -1 : 1;
    });

  const backlog = approved.length - toIssue.length; // eligible but not yet issued — a real queue, not an error

  const credentials: Credential[] = [];
  const credentialById = new Map<string, Credential>();

  toIssue.forEach((candidate, index) => {
    const { completion, course, rule, decision } = candidate;
    const learner = learnerById.get(completion.learner_id)!;
    const crng = rngFor(seed, 'credential', completion.completion_id);
    const completedAt = new Date(completion.completed_at!);
    let issuedAt = addDays(completedAt, crng.int(1, 14));
    if (issuedAt.getTime() > asOf.getTime()) issuedAt = completedAt;

    const id = credentialId(issuedAt.getUTCFullYear(), index + 1);
    const issuer = issuerActiveAt(issuedAt);
    const payload = buildPayload({
      credentialId: id,
      learner,
      course,
      completion,
      rule,
      issuerId: issuer.issuer_id,
      issuedAt,
    });
    const sealed = sealPayload(payload, issuerKeys.get(issuer.issuer_id)!);
    const perpetual = crng.bool(0.3);

    const credential: Credential = {
      credential_id: id,
      learner_id: learner.learner_id,
      course_id: course.course_id,
      completion_id: completion.completion_id,
      issuer_id: issuer.issuer_id,
      rule_id: rule.rule_id,
      rule_version: rule.rule_version,
      issued_at: issuedAt.toISOString(),
      expires_at: perpetual ? null : addYears(issuedAt, 3).toISOString(),
      status: 'ACTIVE', // recomputed below once revocations exist
      payload_json: sealed.payload_json,
      payload_hash: sealed.payload_hash,
      hash_algorithm: 'SHA-256',
      signature: sealed.signature,
      signature_algorithm: 'Ed25519',
      verification_code: verificationCode(seed, id),
      issuance_decision: JSON.stringify(decision),
    };

    credentials.push(credential);
    credentialById.set(id, credential);

    audit.append({
      entity_type: 'CREDENTIAL',
      entity_id: id,
      event_type: 'ISSUANCE_APPROVED',
      actor_id: 'SYS',
      actor_role: 'SYSTEM',
      occurred_at: candidate.evaluatedAt,
      payload: { completion_id: completion.completion_id, rule_id: rule.rule_id, failed_criteria: [] },
    });
    audit.append({
      entity_type: 'CREDENTIAL',
      entity_id: id,
      event_type: 'CREDENTIAL_ISSUED',
      actor_id: issuer.issuer_id,
      actor_role: 'PLATFORM_ADMIN',
      occurred_at: issuedAt,
      payload: { issuer_id: issuer.issuer_id, payload_hash: sealed.payload_hash, expires_at: credential.expires_at },
    });
  });

  // Denials are recorded too: a completed course that failed the rules is a decision worth auditing.
  // Capped so the audit log stays proportionate to the credential lifecycle it documents.
  const deniedSample = denied.slice(0, Math.min(denied.length, config.credentials));
  for (const candidate of deniedSample) {
    audit.append({
      entity_type: 'COMPLETION',
      entity_id: candidate.completion.completion_id,
      event_type: 'ISSUANCE_DENIED',
      actor_id: 'SYS',
      actor_role: 'SYSTEM',
      occurred_at: candidate.evaluatedAt,
      payload: {
        rule_id: candidate.rule.rule_id,
        failed_criteria: candidate.decision.failed_criteria,
      },
    });
  }

  /* ------------------------------------------- Step 2g: Revocations (events) */

  const revocations: Revocation[] = [];
  const revocationsByCredential = new Map<string, Revocation[]>();

  for (const credential of credentials) {
    const rng = rngFor(seed, 'revocation', credential.credential_id);
    if (!rng.bool(0.07)) continue;

    const issuedAt = new Date(credential.issued_at);
    const maxDays = Math.max(2, daysBetween(issuedAt, asOf));
    const revokedAt = addDays(issuedAt, rng.int(1, maxDays));
    if (revokedAt.getTime() > asOf.getTime()) continue;

    const reason = rng.weighted(REVOCATION_REASON_WEIGHTS) as Revocation['reason_code'];
    const list: Revocation[] = [];

    // ~18% of revocations are later rescinded and then re-issued as a new sequence row. The original
    // row is never edited — the current state is the replay of the sequence.
    const rescinded = rng.bool(0.18);
    list.push({
      revocation_id: revocationId(credential.credential_id, 1),
      credential_id: credential.credential_id,
      sequence_no: 1,
      reason_code: reason,
      reason_text: REVOCATION_REASON_TEXT[reason]!,
      revoked_at: revokedAt.toISOString(),
      revoked_by: rng.pick(ADMIN_ACTORS),
      status: rescinded ? 'RESCINDED' : 'ACTIVE',
    });

    if (rescinded) {
      const laterDays = Math.max(1, daysBetween(revokedAt, asOf));
      const secondAt = addDays(revokedAt, rng.int(1, laterDays));
      if (secondAt.getTime() <= asOf.getTime() && rng.bool(0.45)) {
        const reason2 = rng.weighted(REVOCATION_REASON_WEIGHTS) as Revocation['reason_code'];
        list.push({
          revocation_id: revocationId(credential.credential_id, 2),
          credential_id: credential.credential_id,
          sequence_no: 2,
          reason_code: reason2,
          reason_text: REVOCATION_REASON_TEXT[reason2]!,
          revoked_at: secondAt.toISOString(),
          revoked_by: rng.pick(ADMIN_ACTORS),
          status: 'ACTIVE',
        });
      }
    }

    for (const row of list) {
      revocations.push(row);
      audit.append({
        entity_type: 'REVOCATION',
        entity_id: row.revocation_id,
        event_type: row.status === 'RESCINDED' ? 'REVOCATION_RESCINDED' : 'REVOKED',
        actor_id: row.revoked_by,
        actor_role: 'ADMIN',
        occurred_at: new Date(row.revoked_at),
        payload: { credential_id: row.credential_id, reason_code: row.reason_code, sequence_no: row.sequence_no },
      });
    }
    revocationsByCredential.set(credential.credential_id, list);
  }

  // Credential status is derived from the revocation replay plus expiry — never assigned independently.
  for (const credential of credentials) {
    const previous = credential.status;
    credential.status = deriveCredentialStatus(
      credential,
      revocationsByCredential.get(credential.credential_id) ?? [],
      asOf,
    );
    if (credential.status === 'EXPIRED' && previous !== 'EXPIRED') {
      audit.append({
        entity_type: 'CREDENTIAL',
        entity_id: credential.credential_id,
        event_type: 'EXPIRED',
        actor_id: 'SYS',
        actor_role: 'SYSTEM',
        occurred_at: new Date(credential.expires_at!),
        payload: { from: 'ACTIVE', to: 'EXPIRED' },
      });
    }
  }

  /* --------------------------------------- Step 2h: Verification requests */

  const publicKeyById = new Map(issuers.map((i) => [i.issuer_id, i.public_key]));
  const verificationRequests: VerificationRequest[] = [];

  /*
   * Credentials in issue order, so a request can be matched to a credential that had already been
   * issued long enough ago for its delay to fit. Picking the credential first and then clamping the
   * delay would push every recently-issued credential's request onto the final day.
   */
  const byIssued = [...credentials].sort((a, b) => Date.parse(a.issued_at) - Date.parse(b.issued_at));
  const issuedTimes = byIssued.map((c) => Date.parse(c.issued_at));
  /** Number of credentials issued at or before `cutoff` (binary search over the sorted times). */
  const issuedOnOrBefore = (cutoff: number): number => {
    let lo = 0;
    let hi = issuedTimes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (issuedTimes[mid]! <= cutoff) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  for (let i = 1; i <= config.verifications; i++) {
    const vid = verificationId(2026, i);
    const rng = rngFor(seed, 'verification', vid);

    // ~4% of requests present a reference that resolves to nothing at all.
    const unknownRef = rng.bool(0.04);

    /*
     * Verifications cluster shortly after issuance — a credential is checked when it is presented,
     * during hiring or admissions — with a long tail of later re-checks. The delay is drawn first and
     * the credential is then chosen from those old enough to accommodate it, so a credential issued
     * last week is simply not verified yet rather than being forced to the end of the window.
     */
    const delayDays = rng.bool(0.72) ? rng.intNormal(45, 40, 0, 180) : rng.int(0, 900);
    const cutoff = addDays(asOf, -delayDays).getTime();
    const eligible = issuedOnOrBefore(cutoff);
    const target = unknownRef || eligible === 0 ? null : byIssued[rng.int(0, eligible - 1)]!;

    /*
     * Verifications cluster shortly after issuance — a credential is usually checked when it is
     * presented, during hiring or admissions — with a long tail of later re-checks. Drawing the date
     * uniformly across the whole window instead would make recent months absorb requests from every
     * credential ever issued and bend the volume curve into a hockey stick.
     */
    const requestedAt = (() => {
      if (!target) return dateBetween(rng, new Date('2025-01-01T00:00:00.000Z'), asOf);
      const issued = new Date(target.issued_at);
      // The credential was chosen to be old enough for this delay, so the date needs no clamping;
      // the one-day spread just gives it a time of day.
      const from = addDays(issued, delayDays);
      const to = new Date(Math.min(addDays(issued, delayDays + 1).getTime(), asOf.getTime()));
      return dateBetween(rng, from, to);
    })();

    const method = rng.weighted(IDENTITY_METHOD_WEIGHTS) as IdentityMatchMethod;
    const baseScore = IDENTITY_METHOD_SCORE[method];
    const identityScore = Math.round(Math.min(1, Math.max(0, baseScore - rng.float(0, 0.04, 3))) * 100) / 100;

    // ~5% of verifiers present a hash that does not match what the issuer sealed.
    const wrongHash = rng.bool(0.05);
    const presentedHash = target
      ? wrongHash
        ? sha256Hex(`${seed}|tampered|${vid}`)
        : target.payload_hash
      : sha256Hex(`${seed}|unknown|${vid}`);

    const outcome = verifyCredential({
      credential: target,
      revocations: target ? revocationsByCredential.get(target.credential_id) ?? [] : [],
      issuerPublicKeyHex: target ? publicKeyById.get(target.issuer_id) ?? null : null,
      presentedHash,
      identityMatchMethod: method,
      identityMatchScore: identityScore,
      asOf: requestedAt,
    });

    verificationRequests.push({
      verification_id: vid,
      credential_id: target ? target.credential_id : null,
      requested_credential_ref: target
        ? method === 'VERIFICATION_CODE'
          ? target.verification_code
          : target.credential_id
        : `CRD-2026-${pad(900_000 + i, 6)}`,
      verifier_name: rng.pick(VERIFIER_ORGS),
      verifier_type: rng.weighted(VERIFIER_TYPE_WEIGHTS) as VerifierType,
      requested_at: requestedAt.toISOString(),
      presented_hash: presentedHash,
      identity_match_method: method,
      identity_match_score: identityScore,
      result: outcome.result,
      latency_ms: rng.intNormal(90, 55, 5, 400),
    });
  }

  /* ---------------------------- Step 5: labelled edge-case injection */

  const counts = edgeCaseCounts(config.scale);
  const pickRng = rngFor(seed, 'edge-case-selection', 'v1');
  const shuffledCredentialIdx = pickRng.shuffle(credentials.map((_, i) => i));
  let cursor = 0;
  const take = (n: number) => shuffledCredentialIdx.slice(cursor, (cursor += n));

  const resealedHashes = new Map<string, { from: string; to: string }>();

  // EC-01 — credential issued before the completion that supposedly earned it.
  for (const idx of take(counts.issuedBeforeCompletion)) {
    const credential = credentials[idx]!;
    const completion = completionById.get(credential.completion_id)!;
    const erng = rngFor(seed, 'ec01', credential.credential_id);
    const backdated = addDays(new Date(completion.completed_at!), -erng.int(1, 20));
    credential.issued_at = backdated.toISOString();
    if (credential.expires_at) credential.expires_at = addYears(backdated, 3).toISOString();

    // The payload is re-sealed so the signature stays valid: the defect is the date ordering alone,
    // not a broken signature. A validator must catch it by comparing issued_at to completed_at.
    const learner = learnerById.get(credential.learner_id)!;
    const course = courseById.get(credential.course_id)!;
    const rule = credentialRules.find((r) => r.rule_id === credential.rule_id)!;
    const payload = buildPayload({
      credentialId: credential.credential_id,
      learner,
      course,
      completion,
      rule,
      issuerId: credential.issuer_id,
      issuedAt: backdated,
    });
    const sealed = sealPayload(payload, issuerKeys.get(credential.issuer_id)!);
    resealedHashes.set(credential.credential_id, { from: credential.payload_hash, to: sealed.payload_hash });
    credential.payload_json = sealed.payload_json;
    credential.payload_hash = sealed.payload_hash;
    credential.signature = sealed.signature;

    groundTruth.push({
      record_type: 'Credential',
      record_id: credential.credential_id,
      issue_type: 'EC01_ISSUED_BEFORE_COMPLETION',
      expected_decision: 'REJECT_ISSUANCE',
      detectable_by: 'issued_at < completion.completed_at',
      description: `Credential issued ${daysBetween(backdated, new Date(completion.completed_at!))} day(s) before the completion it cites.`,
    });
  }

  // Re-sealing in EC-01 changed those credentials' payload hashes. Verification requests generated
  // earlier presented the pre-reseal hash; they are refreshed and re-derived so the only defect EC-01
  // introduces is the date ordering, not a crop of unrelated hash mismatches.
  if (resealedHashes.size > 0) {
    for (const v of verificationRequests) {
      if (!v.credential_id) continue;
      const change = resealedHashes.get(v.credential_id);
      if (!change || v.presented_hash !== change.from) continue;
      v.presented_hash = change.to;
      const target = credentialById.get(v.credential_id)!;
      v.result = verifyCredential({
        credential: target,
        revocations: revocationsByCredential.get(target.credential_id) ?? [],
        issuerPublicKeyHex: publicKeyById.get(target.issuer_id) ?? null,
        presentedHash: v.presented_hash,
        identityMatchMethod: v.identity_match_method,
        identityMatchScore: v.identity_match_score,
        asOf: new Date(v.requested_at),
      }).result;
    }
  }

  const duplicatedCredentialIds = new Set<string>();

  // EC-02 — duplicate credential id. The duplicate is an additional row reusing an existing primary
  // key, so a uniqueness check (and the database's own constraint) is what surfaces it.
  for (const idx of take(counts.duplicateCredentialId)) {
    const original = credentials[idx]!;
    const donorIdx = shuffledCredentialIdx[(cursor + idx) % shuffledCredentialIdx.length]!;
    const donor = credentials[donorIdx]!;
    if (donor.credential_id === original.credential_id) continue;

    const duplicate: Credential = { ...donor, credential_id: original.credential_id };
    credentials.push(duplicate);

    groundTruth.push({
      record_type: 'Credential',
      record_id: original.credential_id,
      issue_type: 'EC02_DUPLICATE_CREDENTIAL_ID',
      expected_decision: 'REJECT_DUPLICATE',
      detectable_by: 'primary-key uniqueness on credential_id',
      description: `credential_id ${original.credential_id} appears on more than one row (second row carries completion ${duplicate.completion_id}).`,
    });
    duplicatedCredentialIds.add(original.credential_id);
  }

  // A duplicated id makes lookup by credential_id ambiguous, so every request that cites one has an
  // undefined answer. That is a consequence of EC-02, not a separate defect, and it is labelled as such.
  for (const v of verificationRequests) {
    if (!v.credential_id || !duplicatedCredentialIds.has(v.credential_id)) continue;
    groundTruth.push({
      record_type: 'VerificationRequest',
      record_id: v.verification_id,
      issue_type: 'EC02_DUPLICATE_CREDENTIAL_ID',
      expected_decision: 'AMBIGUOUS_REFERENCE',
      detectable_by: 'credential_id resolves to more than one credential row',
      description: `Request cites ${v.credential_id}, which is carried by more than one credential row; the result is not well defined.`,
    });
  }

  // EC-04 — payload altered after sealing, stored hash left stale, and the verification still returned
  // VALID. Recomputing the hash from the stored payload is what exposes it.
  const alteredCredentialIds: string[] = [];
  for (const idx of take(counts.alteredPayloadHash)) {
    const credential = credentials[idx]!;
    if (alteredCredentialIds.includes(credential.credential_id)) continue;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(credential.payload_json);
    } catch {
      continue;
    }
    const result = payload.result as Record<string, unknown>;
    const inflated = Math.min(100, Number(result.overall_score) + 9);
    result.overall_score = inflated;
    credential.payload_json = JSON.stringify(payload);
    // payload_hash and signature are deliberately NOT recomputed — that is the tamper.
    alteredCredentialIds.push(credential.credential_id);

    groundTruth.push({
      record_type: 'Credential',
      record_id: credential.credential_id,
      issue_type: 'EC04_ALTERED_PAYLOAD_HASH_UNDETECTED',
      expected_decision: 'INVALID_HASH_MISMATCH',
      detectable_by: 'sha256(canonical(payload_json)) != payload_hash',
      description: `Payload overall_score inflated to ${inflated} after sealing; payload_hash and signature left stale.`,
    });
  }

  // Baseline requests already recorded against a now-altered credential are relabelled: they verified
  // a payload that no longer matches its sealed hash, which is exactly what EC-04 describes.
  for (const v of verificationRequests) {
    if (!v.credential_id || v.result !== 'VALID') continue;
    if (!alteredCredentialIds.includes(v.credential_id)) continue;
    groundTruth.push({
      record_type: 'VerificationRequest',
      record_id: v.verification_id,
      issue_type: 'EC04_ALTERED_PAYLOAD_HASH_UNDETECTED',
      expected_decision: 'INVALID_HASH_MISMATCH',
      detectable_by: 'recompute payload hash at verification time',
      description: `Verification of tampered credential ${v.credential_id} returned VALID; the altered payload was not detected.`,
    });
  }

  // Each altered credential also gets a fresh verification that wrongly reported VALID.
  alteredCredentialIds.forEach((credId, n) => {
    const credential = credentialById.get(credId);
    if (!credential) return;
    const vid = verificationId(2026, config.verifications + n + 1);
    const rng = rngFor(seed, 'ec04-verification', vid);
    verificationRequests.push({
      verification_id: vid,
      credential_id: credId,
      requested_credential_ref: credId,
      verifier_name: rng.pick(VERIFIER_ORGS),
      verifier_type: rng.weighted(VERIFIER_TYPE_WEIGHTS) as VerifierType,
      requested_at: dateBetween(rng, new Date(credential.issued_at), asOf).toISOString(),
      presented_hash: credential.payload_hash,
      identity_match_method: 'CREDENTIAL_ID',
      identity_match_score: 1,
      result: 'VALID',
      latency_ms: rng.intNormal(90, 55, 5, 400),
    });
    groundTruth.push({
      record_type: 'VerificationRequest',
      record_id: vid,
      issue_type: 'EC04_ALTERED_PAYLOAD_HASH_UNDETECTED',
      expected_decision: 'INVALID_HASH_MISMATCH',
      detectable_by: 'recompute payload hash at verification time',
      description: `Verification of tampered credential ${credId} returned VALID; the altered payload was not detected.`,
    });
  });

  // EC-03 — a revoked credential that verified as active. Chosen from requests whose credential had an
  // active revocation at the time of the request, with the recorded result forced to VALID.
  const alteredSet = new Set(alteredCredentialIds);
  const revokedAtRequestTime = verificationRequests.filter((v) => {
    if (!v.credential_id || v.result !== 'INVALID_REVOKED') return false;
    // Keep EC-03 and EC-04 disjoint so each labelled row has exactly one explanation.
    return !alteredSet.has(v.credential_id);
  });
  const ec03Rng = rngFor(seed, 'ec03-selection', 'v1');
  for (const v of ec03Rng.shuffle(revokedAtRequestTime).slice(0, counts.revokedVerifiesActive)) {
    v.result = 'VALID';
    groundTruth.push({
      record_type: 'VerificationRequest',
      record_id: v.verification_id,
      issue_type: 'EC03_REVOKED_VERIFIES_ACTIVE',
      expected_decision: 'INVALID_REVOKED',
      detectable_by: 'replay revocations as of requested_at and compare to the recorded result',
      description: `Credential ${v.credential_id} had an active revocation at ${v.requested_at} but the request recorded VALID.`,
    });
  }

  /* ------------------------------------------- audit for verification events */

  for (const v of verificationRequests) {
    const at = new Date(v.requested_at);
    audit.append({
      entity_type: 'VERIFICATION',
      entity_id: v.verification_id,
      event_type: 'VERIFICATION_REQUESTED',
      actor_id: v.verifier_name,
      actor_role: 'VERIFIER',
      occurred_at: at,
      payload: { credential_ref: v.requested_credential_ref, method: v.identity_match_method },
    });
    audit.append({
      entity_type: 'VERIFICATION',
      entity_id: v.verification_id,
      event_type: 'VERIFICATION_COMPLETED',
      actor_id: 'SYS',
      actor_role: 'SYSTEM',
      occurred_at: at,
      payload: { result: v.result, latency_ms: v.latency_ms },
    });
  }

  const auditEvents = audit.finalize();

  // Sorted output: stable row order is what makes two runs byte-identical.
  verificationRequests.sort((a, b) => (a.verification_id < b.verification_id ? -1 : 1));
  completionRecords.sort((a, b) => (a.completion_id < b.completion_id ? -1 : 1));
  revocations.sort((a, b) => (a.revocation_id < b.revocation_id ? -1 : 1));
  groundTruth.sort((a, b) =>
    a.issue_type === b.issue_type
      ? a.record_id < b.record_id
        ? -1
        : 1
      : a.issue_type < b.issue_type
        ? -1
        : 1,
  );

  return {
    learners,
    courses,
    issuers,
    credentialRules,
    completionRecords,
    credentials,
    verificationRequests,
    revocations,
    auditEvents,
    groundTruth,
    __stats: { approvedTotal: approved.length, deniedTotal: denied.length, issuanceBacklog: backlog },
  };
}
