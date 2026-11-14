import cors from 'cors';
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireRole, ROLE_CAPABILITIES, signToken, verifyPassword, type AuthUser, type Role } from '../auth/auth.js';
import {
  activeRuleAt,
  buildPayload,
  currentRevocation,
  deriveCredentialStatus,
  evaluateIssuance,
  IDENTITY_METHOD_SCORE,
  sealPayload,
  verifyCredential,
} from '../engine/rules.js';
import { AS_OF } from '../generator/generate.js';
import { GENESIS_HASH } from '../lib/audit.js';
import {
  auditEventId,
  canonicalize,
  credentialId as makeCredentialId,
  deriveKeyPair,
  DEFAULT_SEED,
  revocationId as makeRevocationId,
  sha256Hex,
  verificationCode,
  verificationId as makeVerificationId,
} from '../lib/deterministic.js';
import type { AuditEvent, Credential, IdentityMatchMethod, Revocation, VerificationRequest } from '../lib/types.js';
import bcrypt from 'bcryptjs';
import { aiAvailable, explainDenial, reviewCase } from './ai.js';
import { createRepo, type Repo } from './repo.js';

/**
 * VeriCred REST API.
 *
 * Every decision this service makes — issue, verify, revoke — runs through the same rule engine the
 * generator used, so an answer given here reproduces an answer recorded in the dataset. Each decision
 * also appends to the hash-chained audit log before the response is returned.
 */

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(authenticate);

if (!process.env.JWT_SECRET) {
  // Fail loudly in production rather than signing tokens with a guessable default.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production.');
  }
  process.env.JWT_SECRET = 'dev-only-change-me';
  console.warn('  JWT_SECRET not set — using the development default. Do not do this in production.');
}

const SEED = Number(process.env.SEED ?? DEFAULT_SEED);
let repo: Repo;

/* ------------------------------------------------------------- utilities */

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };

/** Appends to the audit chain, linking to the current tail so the chain stays verifiable. */
async function audit(input: {
  entity_type: AuditEvent['entity_type'];
  entity_id: string;
  event_type: AuditEvent['event_type'];
  actor_id: string;
  actor_role: AuditEvent['actor_role'];
  payload: Record<string, unknown>;
}): Promise<AuditEvent> {
  const tail = await repo.lastAuditEvent();
  const seq = (tail?.event_seq ?? 0) + 1;
  const body = {
    event_id: auditEventId(seq),
    event_seq: seq,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    event_type: input.event_type,
    actor_id: input.actor_id,
    actor_role: input.actor_role,
    occurred_at: new Date().toISOString(),
    payload_json: canonicalize(input.payload),
  };
  const prev = tail?.event_hash ?? GENESIS_HASH;
  const event: AuditEvent = { ...body, prev_hash: prev, event_hash: sha256Hex(prev + canonicalize(body)) };
  await repo.insertAudit(event);
  return event;
}

/* ------------------------------------------------------------------ auth */

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

app.post(
  '/api/auth/login',
  rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }),
  asyncRoute(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });

    const record = await repo.findUser(parsed.data.email);
    // Same response for an unknown account and a wrong password — no account enumeration.
    const failed = { error: 'invalid_credentials', message: 'Email or password is incorrect.' };
    if (!record) return res.status(401).json(failed);
    if (!(await verifyPassword(parsed.data.password, record.password_hash))) return res.status(401).json(failed);

    const user: AuthUser = {
      user_id: record.user_id,
      email: record.email,
      role: record.role as Role,
      display_name: record.display_name,
      learner_id: record.learner_id,
    };
    return res.json({ token: signToken(user), user, capabilities: ROLE_CAPABILITIES[user.role] });
  }),
);

/**
 * Self-registration creates a LEARNER account and nothing else. Letting a visitor choose their own
 * role would hand out issuance and revocation rights to anyone who can reach the form; staff accounts
 * are created by a platform administrator in User Management instead.
 */
const registerSchema = z.object({
  display_name: z.string().min(2).max(80),
  email: z.string().email().max(160),
  password: z.string().min(8).max(200),
  /** Optional: claim an existing learner record so the new account sees its own courses. */
  learner_id: z
    .string()
    .regex(/^LRN-\d{6}$/, 'Learner ID must look like LRN-000001.')
    .optional(),
});

app.post(
  '/api/auth/register',
  rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false }),
  asyncRoute(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Check the details you entered.',
        issues: parsed.error.issues,
      });
    }
    const input = parsed.data;
    const email = input.email.toLowerCase();

    if (await repo.findUser(email)) {
      return res.status(409).json({ error: 'email_taken', message: 'An account with that email already exists.' });
    }

    if (input.learner_id) {
      const learner = await repo.getLearner(input.learner_id);
      if (!learner) {
        return res.status(404).json({ error: 'learner_not_found', message: 'No learner record matches that ID.' });
      }
    }

    const user: AuthUser = {
      user_id: `USR-${Date.now().toString(36).toUpperCase()}`,
      email,
      role: 'LEARNER',
      display_name: input.display_name.trim(),
      learner_id: input.learner_id ?? null,
    };

    try {
      await repo.createUser({ ...user, password_hash: await bcrypt.hash(input.password, 10) });
    } catch (error) {
      if ((error as { code?: string }).code === 'DUPLICATE') {
        return res.status(409).json({ error: 'email_taken', message: 'An account with that email already exists.' });
      }
      throw error;
    }

    await audit({
      entity_type: 'USER',
      entity_id: user.user_id,
      event_type: 'USER_REGISTERED',
      actor_id: user.user_id,
      actor_role: 'LEARNER',
      payload: { email, learner_id: user.learner_id },
    });

    return res.status(201).json({ token: signToken(user), user, capabilities: ROLE_CAPABILITIES[user.role] });
  }),
);

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'authentication_required' });
  return res.json({ user: req.user, capabilities: ROLE_CAPABILITIES[req.user.role] });
});

/* ---------------------------------------------------------------- health */

app.get(
  '/api/health',
  asyncRoute(async (_req, res) => {
    const tail = await repo.lastAuditEvent();
    return res.json({
      status: 'ok',
      data_source: repo.driver,
      seed: SEED,
      as_of: AS_OF.toISOString(),
      ai: aiAvailable() ? 'openai' : 'deterministic-fallback',
      audit_tail: tail ? { event_id: tail.event_id, event_hash: tail.event_hash } : null,
    });
  }),
);

/* ----------------------------------------------------------- credentials */

app.get(
  '/api/credentials',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'SUPPORT', 'INSTRUCTOR', 'LEARNER'),
  asyncRoute(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25)));
    // A learner may only ever list their own credentials, whatever they put in the query string.
    const learnerId = req.user!.role === 'LEARNER' ? req.user!.learner_id ?? '__none__' : (req.query.learnerId as string | undefined);
    const { rows, total } = await repo.listCredentials({
      page,
      pageSize,
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      learnerId,
    });
    return res.json({ rows, total, page, pageSize });
  }),
);

app.get(
  '/api/credentials/:id',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'SUPPORT', 'INSTRUCTOR', 'LEARNER'),
  asyncRoute(async (req, res) => {
    const detail = await repo.getCredential(String(req.params.id));
    if (!detail) return res.status(404).json({ error: 'not_found' });
    if (req.user!.role === 'LEARNER' && detail.credential.learner_id !== req.user!.learner_id) {
      return res.status(403).json({ error: 'forbidden', message: 'You may only view your own credentials.' });
    }
    const revocation = currentRevocation(detail.revocations, new Date());
    return res.json({
      ...detail,
      issuance_decision: JSON.parse(detail.credential.issuance_decision),
      derived_status: deriveCredentialStatus(detail.credential, detail.revocations, new Date()),
      current_revocation: revocation,
    });
  }),
);

/* ------------------------------------------------------ issuance workflow */

app.get(
  '/api/issuance/eligible',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'INSTRUCTOR'),
  asyncRoute(async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const candidates = await repo.listEligible(limit);
    const now = new Date();
    return res.json({
      rows: candidates.map((c) => ({
        completion: c.completion,
        learner: { learner_id: c.learner.learner_id, full_name: c.learner.full_name, email: c.learner.email },
        course: { course_id: c.course.course_id, title: c.course.title, passing_score: c.course.passing_score },
        rule: c.rule,
        decision: evaluateIssuance(c.completion, c.course, c.rule, now),
      })),
    });
  }),
);

/** Dry run: evaluate a completion against its rule without issuing anything. */
app.post(
  '/api/issuance/evaluate',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'INSTRUCTOR', 'SUPPORT'),
  asyncRoute(async (req, res) => {
    const parsed = z.object({ completion_id: z.string() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });

    const found = await repo.getCompletion(parsed.data.completion_id);
    if (!found) return res.status(404).json({ error: 'not_found', message: 'No such completion record.' });

    const rules = await repo.rulesForCourse(found.course.course_id);
    const at = found.completion.completed_at ? new Date(found.completion.completed_at) : new Date();
    const rule = activeRuleAt(rules, at) ?? rules.at(-1);
    if (!rule) return res.status(409).json({ error: 'no_rule', message: 'The course has no credential rule.' });

    return res.json({ decision: evaluateIssuance(found.completion, found.course, rule, at), rule });
  }),
);

app.post(
  '/api/issuance/issue',
  requireRole('ADMIN', 'PLATFORM_ADMIN'),
  asyncRoute(async (req, res) => {
    const parsed = z.object({ completion_id: z.string() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });

    const found = await repo.getCompletion(parsed.data.completion_id);
    if (!found) return res.status(404).json({ error: 'not_found' });

    const rules = await repo.rulesForCourse(found.course.course_id);
    const issuedAt = new Date();
    const rule = activeRuleAt(rules, issuedAt) ?? rules.at(-1);
    if (!rule) return res.status(409).json({ error: 'no_rule' });

    const decision = evaluateIssuance(found.completion, found.course, rule, issuedAt);

    // The gate: a credential is never minted on a denied decision, and the denial is audited either way.
    if (decision.decision !== 'APPROVED') {
      await audit({
        entity_type: 'COMPLETION',
        entity_id: found.completion.completion_id,
        event_type: 'ISSUANCE_DENIED',
        actor_id: req.user!.user_id,
        actor_role: req.user!.role,
        payload: { failed_criteria: decision.failed_criteria, rule_id: rule.rule_id },
      });
      return res.status(422).json({
        error: 'issuance_denied',
        message: 'Completion requirements are not met.',
        decision,
      });
    }

    const issuers = await repo.listIssuers();
    const issuer = issuers.find((i) => i.status === 'ACTIVE');
    if (!issuer) return res.status(409).json({ error: 'no_active_issuer' });

    // A fresh sequence number keeps new ids out of the generated range.
    const { total } = await repo.listCredentials({ page: 1, pageSize: 1 });
    const id = makeCredentialId(issuedAt.getUTCFullYear(), total + 1);

    const payload = buildPayload({
      credentialId: id,
      learner: found.learner,
      course: found.course,
      completion: found.completion,
      rule,
      issuerId: issuer.issuer_id,
      issuedAt,
    });
    const sealed = sealPayload(payload, deriveKeyPair(SEED, issuer.issuer_id).privateKeyHex);

    const credential: Credential = {
      credential_id: id,
      learner_id: found.learner.learner_id,
      course_id: found.course.course_id,
      completion_id: found.completion.completion_id,
      issuer_id: issuer.issuer_id,
      rule_id: rule.rule_id,
      rule_version: rule.rule_version,
      issued_at: issuedAt.toISOString(),
      expires_at: new Date(Date.UTC(issuedAt.getUTCFullYear() + 3, issuedAt.getUTCMonth(), issuedAt.getUTCDate())).toISOString(),
      status: 'ACTIVE',
      payload_json: sealed.payload_json,
      payload_hash: sealed.payload_hash,
      hash_algorithm: 'SHA-256',
      signature: sealed.signature,
      signature_algorithm: 'Ed25519',
      verification_code: verificationCode(SEED, id),
      issuance_decision: JSON.stringify(decision),
    };

    try {
      await repo.insertCredential(credential);
    } catch (error) {
      if ((error as { code?: string }).code === 'DUPLICATE') {
        return res.status(409).json({ error: 'duplicate_credential_id', message: 'That credential id already exists.' });
      }
      throw error;
    }

    await audit({
      entity_type: 'CREDENTIAL',
      entity_id: id,
      event_type: 'ISSUANCE_APPROVED',
      actor_id: req.user!.user_id,
      actor_role: req.user!.role,
      payload: { completion_id: found.completion.completion_id, rule_id: rule.rule_id },
    });
    const event = await audit({
      entity_type: 'CREDENTIAL',
      entity_id: id,
      event_type: 'CREDENTIAL_ISSUED',
      actor_id: req.user!.user_id,
      actor_role: req.user!.role,
      payload: { issuer_id: issuer.issuer_id, payload_hash: sealed.payload_hash },
    });

    return res.status(201).json({ credential, decision, audit_event: event });
  }),
);

/* ------------------------------------------------- verification (public) */

const verifySchema = z.object({
  reference: z.string().min(3).max(64),
  presented_hash: z.string().optional(),
  verifier_name: z.string().min(1).max(120).default('Anonymous verifier'),
  verifier_type: z.enum(['EMPLOYER', 'UNIVERSITY', 'GOVERNMENT', 'PLATFORM', 'INDIVIDUAL']).default('EMPLOYER'),
  identity_match_method: z.enum(['CREDENTIAL_ID', 'VERIFICATION_CODE', 'NATIONAL_ID_HASH', 'EMAIL', 'NAME_ONLY']).optional(),
});

/**
 * Public by design: a third party must be able to verify without an account. Rate-limited, and the
 * response exposes only what a verifier legitimately needs — never the learner's email or identity hash.
 */
app.post(
  '/api/verify',
  rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }),
  asyncRoute(async (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
    const input = parsed.data;
    const startedAt = Date.now();
    const requestedAt = new Date();

    const { matches } = await repo.findCredentialByRef(input.reference);

    // An ambiguous reference has no well-defined answer; saying so is more honest than picking a row.
    if (matches.length > 1) {
      return res.status(409).json({
        error: 'ambiguous_reference',
        message: `${matches.length} credentials share that reference. Verification cannot proceed.`,
        result: 'INVALID_NOT_FOUND',
      });
    }

    const credential = matches[0] ?? null;
    const looksLikeCode = /^[A-Z0-9]{10}$/.test(input.reference.trim().toUpperCase());
    const method: IdentityMatchMethod =
      input.identity_match_method ?? (looksLikeCode ? 'VERIFICATION_CODE' : 'CREDENTIAL_ID');
    const identityScore = IDENTITY_METHOD_SCORE[method];

    const revocations = credential ? await repo.revocationsFor(credential.credential_id) : [];
    const issuer = credential ? await repo.getIssuer(credential.issuer_id) : null;

    const outcome = verifyCredential({
      credential,
      revocations,
      issuerPublicKeyHex: issuer?.public_key ?? null,
      // A verifier who presents no hash is taken to be presenting the stored one: they are asking
      // "is this credential valid", not "does my copy match".
      presentedHash: input.presented_hash ?? credential?.payload_hash ?? '',
      identityMatchMethod: method,
      identityMatchScore: identityScore,
      asOf: requestedAt,
    });

    const latency = Math.max(1, Date.now() - startedAt);
    const record: VerificationRequest = {
      verification_id: makeVerificationId(requestedAt.getUTCFullYear(), Math.floor(requestedAt.getTime() / 1000) % 1_000_000),
      credential_id: credential?.credential_id ?? null,
      requested_credential_ref: input.reference,
      verifier_name: input.verifier_name,
      verifier_type: input.verifier_type,
      requested_at: requestedAt.toISOString(),
      presented_hash: input.presented_hash ?? credential?.payload_hash ?? '',
      identity_match_method: method,
      identity_match_score: identityScore,
      result: outcome.result,
      latency_ms: latency,
    };
    await repo.insertVerification(record);
    await audit({
      entity_type: 'VERIFICATION',
      entity_id: record.verification_id,
      event_type: 'VERIFICATION_COMPLETED',
      actor_id: input.verifier_name,
      actor_role: 'VERIFIER',
      payload: { reference: input.reference, result: outcome.result },
    });

    const revocation = currentRevocation(revocations, requestedAt);

    return res.json({
      verification_id: record.verification_id,
      result: outcome.result,
      valid: outcome.result === 'VALID',
      checked_at: record.requested_at,
      latency_ms: latency,
      checks: outcome.checks,
      signature_valid: outcome.signature_valid,
      revocation: revocation
        ? { revoked_at: revocation.revoked_at, reason_code: revocation.reason_code, revocation_id: revocation.revocation_id }
        : null,
      credential: credential
        ? {
            credential_id: credential.credential_id,
            course_id: credential.course_id,
            issuer_id: credential.issuer_id,
            issued_at: credential.issued_at,
            expires_at: credential.expires_at,
            status: credential.status,
            payload_hash: credential.payload_hash,
            // The learner's name is in the signed payload a verifier already holds; identifiers that
            // would let someone enumerate learners are not returned.
            subject_name: (JSON.parse(credential.payload_json) as { learner: { full_name: string } }).learner.full_name,
          }
        : null,
    });
  }),
);

/* ------------------------------------------------------------ revocation */

const revokeSchema = z.object({
  credential_id: z.string(),
  reason_code: z.enum(['FRAUD', 'ADMIN_ERROR', 'COURSE_RETIRED', 'ISSUER_CHANGE', 'LEARNER_REQUEST', 'DATA_CORRECTION']),
  reason_text: z.string().min(1).max(240),
});

app.post(
  '/api/revocations',
  requireRole('ADMIN', 'PLATFORM_ADMIN'),
  asyncRoute(async (req, res) => {
    const parsed = revokeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });

    const detail = await repo.getCredential(parsed.data.credential_id);
    if (!detail) return res.status(404).json({ error: 'not_found' });

    const now = new Date();
    if (currentRevocation(detail.revocations, now)) {
      return res.status(409).json({ error: 'already_revoked', message: 'This credential already has an active revocation.' });
    }

    const sequence = detail.revocations.length + 1;
    const row: Revocation = {
      revocation_id: makeRevocationId(detail.credential.credential_id, sequence),
      credential_id: detail.credential.credential_id,
      sequence_no: sequence,
      reason_code: parsed.data.reason_code,
      reason_text: parsed.data.reason_text,
      revoked_at: now.toISOString(),
      revoked_by: req.user!.user_id,
      status: 'ACTIVE',
    };
    await repo.insertRevocation(row);
    const event = await audit({
      entity_type: 'REVOCATION',
      entity_id: row.revocation_id,
      event_type: 'REVOKED',
      actor_id: req.user!.user_id,
      actor_role: req.user!.role,
      payload: { credential_id: row.credential_id, reason_code: row.reason_code, sequence_no: sequence },
    });

    return res.status(201).json({ revocation: row, audit_event: event, credential_status: 'REVOKED' });
  }),
);

/** Rescinding adds a new row; the original revocation is kept, because history is not rewritten. */
app.post(
  '/api/revocations/:id/rescind',
  requireRole('PLATFORM_ADMIN'),
  asyncRoute(async (req, res) => {
    const parsed = z.object({ credential_id: z.string(), reason_text: z.string().min(1).max(240) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });

    const detail = await repo.getCredential(parsed.data.credential_id);
    if (!detail) return res.status(404).json({ error: 'not_found' });

    const active = currentRevocation(detail.revocations, new Date());
    if (!active || active.revocation_id !== req.params.id) {
      return res.status(409).json({ error: 'not_active_revocation', message: 'That revocation is not currently in force.' });
    }

    const sequence = detail.revocations.length + 1;
    const row: Revocation = {
      revocation_id: makeRevocationId(detail.credential.credential_id, sequence),
      credential_id: detail.credential.credential_id,
      sequence_no: sequence,
      reason_code: 'DATA_CORRECTION',
      reason_text: parsed.data.reason_text,
      revoked_at: new Date().toISOString(),
      revoked_by: req.user!.user_id,
      status: 'RESCINDED',
    };
    await repo.insertRevocation(row);
    const event = await audit({
      entity_type: 'REVOCATION',
      entity_id: row.revocation_id,
      event_type: 'REVOCATION_RESCINDED',
      actor_id: req.user!.user_id,
      actor_role: req.user!.role,
      payload: { credential_id: row.credential_id, rescinds: active.revocation_id },
    });

    return res.status(201).json({ revocation: row, audit_event: event });
  }),
);

/* ----------------------------------------------------------------- audit */

app.get(
  '/api/audit',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'SUPPORT', 'INSTRUCTOR'),
  asyncRoute(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
    const rows = await repo.listAudit({
      entityId: req.query.entityId as string | undefined,
      entityType: req.query.entityType as string | undefined,
      limit,
    });
    return res.json({ rows });
  }),
);

/* ------------------------------------------------------- public summary */

/**
 * Aggregate counts for the public landing page. Deliberately coarse: totals and a validity rate, no
 * per-learner or per-credential detail, so nothing here can be used to enumerate people or
 * credentials. Cached for a minute because it scans the whole credential set.
 */
let statsCache: { at: number; body: Record<string, unknown> } | null = null;

app.get(
  '/api/public/stats',
  rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }),
  asyncRoute(async (_req, res) => {
    if (statsCache && Date.now() - statsCache.at < 60_000) return res.json(statsCache.body);

    const metrics = await repo.metrics();
    const verifications = Object.values(metrics.verification_result).reduce((sum, n) => sum + n, 0);
    const valid = metrics.verification_result.VALID ?? 0;

    const body = {
      credentials_issued: metrics.totals.credentials ?? 0,
      verifications_performed: verifications,
      learners: metrics.totals.learners ?? 0,
      courses: metrics.totals.courses ?? 0,
      issuers: metrics.issuer_usage.length,
      validity_rate: verifications === 0 ? 0 : Math.round((1000 * valid) / verifications) / 10,
      median_response_ms: metrics.latency.p50,
      as_of: AS_OF.toISOString(),
    };
    statsCache = { at: Date.now(), body };
    return res.json(body);
  }),
);

/* ------------------------------------------------- learner-scoped reads */

/** A learner may read their own record; staff may read anyone's. */
app.get(
  '/api/learners/:id',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'SUPPORT', 'INSTRUCTOR', 'LEARNER'),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    if (req.user!.role === 'LEARNER' && req.user!.learner_id !== id) {
      return res.status(403).json({ error: 'forbidden', message: 'You may only view your own record.' });
    }
    const learner = await repo.getLearner(id);
    if (!learner) return res.status(404).json({ error: 'not_found' });
    // national_id_hash is identity-matching evidence, not profile data, so it never leaves the server.
    const { national_id_hash: _withheld, ...profile } = learner;
    return res.json({ learner: profile });
  }),
);

app.get(
  '/api/learners/:id/courses',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'SUPPORT', 'INSTRUCTOR', 'LEARNER'),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    if (req.user!.role === 'LEARNER' && req.user!.learner_id !== id) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const rows = await repo.learnerCourses(id);
    const now = new Date();
    const enriched = [];
    for (const { completion, course } of rows) {
      const rules = await repo.rulesForCourse(course.course_id);
      const at = completion.completed_at ? new Date(completion.completed_at) : now;
      const rule = activeRuleAt(rules, at) ?? rules.at(-1) ?? null;
      enriched.push({
        completion,
        course,
        rule,
        decision: rule ? evaluateIssuance(completion, course, rule, at) : null,
      });
    }
    return res.json({ rows: enriched });
  }),
);

/* ----------------------------------------------- shared reference reads */

app.get(
  '/api/courses',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'SUPPORT', 'INSTRUCTOR', 'LEARNER'),
  asyncRoute(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
    return res.json({ rows: await repo.listCourses(limit, req.query.search as string | undefined) });
  }),
);

app.get(
  '/api/rules',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'INSTRUCTOR', 'SUPPORT'),
  asyncRoute(async (req, res) => res.json({ rows: await repo.listRules(req.query.courseId as string | undefined) })),
);

app.get(
  '/api/issuers',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'SUPPORT', 'INSTRUCTOR'),
  asyncRoute(async (_req, res) => res.json({ rows: await repo.listIssuers() })),
);

app.get(
  '/api/verifications',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'SUPPORT'),
  asyncRoute(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
    return res.json({ rows: await repo.listVerifications(limit, req.query.result as string | undefined) });
  }),
);

app.get(
  '/api/revocations',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'SUPPORT'),
  asyncRoute(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
    return res.json({ rows: await repo.listRevocations(limit) });
  }),
);

/**
 * Learner lookup for support staff. A blank query is refused for that role: support looks a person up
 * by an identifier they were given, rather than browsing the whole learner table.
 */
app.get(
  '/api/learners',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'SUPPORT', 'INSTRUCTOR'),
  asyncRoute(async (req, res) => {
    const query = String(req.query.search ?? '').trim();
    if (query.length < 3 && req.user!.role === 'SUPPORT') {
      return res.status(400).json({ error: 'query_too_short', message: 'Enter at least 3 characters of an identifier.' });
    }
    const rows = await repo.searchLearners(query, Math.min(100, Math.max(1, Number(req.query.limit ?? 25))));
    return res.json({ rows: rows.map(({ national_id_hash: _withheld, ...rest }) => rest) });
  }),
);

/* ---------------------------------------------- data quality / validation */

/**
 * The validator's own report, served to platform administrators. It is read from disk rather than
 * recomputed per request: the report describes a specific generated dataset, and recomputing it on
 * demand would let the answer drift from the files the dataset actually shipped with.
 */
app.get(
  '/api/platform/validation',
  requireRole('PLATFORM_ADMIN', 'ADMIN'),
  asyncRoute(async (_req, res) => {
    const file = join(process.cwd(), '..', 'data', 'validation-summary.json');
    if (!existsSync(file)) {
      return res.status(404).json({
        error: 'no_validation_report',
        message: 'Run `npm run validate` to produce data/validation-summary.json.',
      });
    }
    return res.json(JSON.parse(readFileSync(file, 'utf8')));
  }),
);

/* ---------------------------------------------- platform administration */

app.get(
  '/api/users',
  requireRole('PLATFORM_ADMIN'),
  asyncRoute(async (_req, res) => res.json({ rows: await repo.listUsers() })),
);

/* --------------------------------------------------------------- metrics */

app.get(
  '/api/metrics',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'SUPPORT', 'INSTRUCTOR'),
  asyncRoute(async (_req, res) => res.json(await repo.metrics())),
);

/* -------------------------------------------------------------------- AI */

app.post(
  '/api/ai/explain-denial',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'SUPPORT', 'INSTRUCTOR'),
  rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }),
  asyncRoute(async (req, res) => {
    const parsed = z.object({ completion_id: z.string() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });

    const found = await repo.getCompletion(parsed.data.completion_id);
    if (!found) return res.status(404).json({ error: 'not_found' });

    const rules = await repo.rulesForCourse(found.course.course_id);
    const at = found.completion.completed_at ? new Date(found.completion.completed_at) : new Date();
    const rule = activeRuleAt(rules, at) ?? rules.at(-1);
    if (!rule) return res.status(409).json({ error: 'no_rule' });

    const decision = evaluateIssuance(found.completion, found.course, rule, at);
    const explanation = await explainDenial({
      decision,
      courseTitle: found.course.title,
      learnerName: found.learner.full_name,
    });
    return res.json({ decision, explanation });
  }),
);

app.post(
  '/api/ai/review-case',
  requireRole('ADMIN', 'PLATFORM_ADMIN', 'SUPPORT'),
  rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }),
  asyncRoute(async (req, res) => {
    const parsed = z.object({ credential_id: z.string() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });

    const detail = await repo.getCredential(parsed.data.credential_id);
    if (!detail) return res.status(404).json({ error: 'not_found' });
    return res.json({ review: await reviewCase(detail) });
  }),
);

/* ------------------------------------------------------------- handlers */

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  // Internals never reach the client; the log keeps the detail.
  res.status(500).json({ error: 'internal_error' });
});

const PORT = Number(process.env.PORT ?? 4000);

createRepo()
  .then((instance) => {
    repo = instance;
    app.listen(PORT, () => {
      console.log(`\n  VeriCred API listening on http://localhost:${PORT}`);
      console.log(`  AI: ${aiAvailable() ? 'OpenAI structured outputs' : 'deterministic fallback (no OPENAI_API_KEY)'}\n`);
    });
  })
  .catch((error) => {
    console.error('Failed to start:', error);
    process.exit(1);
  });

export { app };
