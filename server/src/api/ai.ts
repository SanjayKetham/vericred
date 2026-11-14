import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type { CredentialDetail } from './repo.js';
import type { IssuanceDecision } from '../lib/types.js';

/**
 * AI assistance — strictly advisory.
 *
 * Nothing here participates in an issuance, verification or revocation decision. Those are made by the
 * deterministic rule engine, because a credential platform has to give the same answer every time and
 * be able to show its working. The model's only job is to put an already-made decision into plain
 * language for support staff, and to suggest where a reviewer should look. Every response is a
 * structured output validated against a schema, and when no API key is configured the endpoints fall
 * back to a deterministic template rather than failing.
 */

const DenialExplanation = z.object({
  summary: z.string().describe('Two sentences, plain English, addressed to a support agent.'),
  learner_message: z.string().describe('A short message that could be sent to the learner.'),
  blocking_criteria: z.array(
    z.object({
      criterion: z.string(),
      what_is_required: z.string(),
      what_the_learner_has: z.string(),
      closest_to_passing: z.boolean(),
    }),
  ),
  recommended_next_step: z.enum(['RETAKE_ASSESSMENT', 'COMPLETE_MODULES', 'IMPROVE_ATTENDANCE', 'REQUEST_DEADLINE_REVIEW', 'ESCALATE_TO_ADMIN']),
});

const CaseReview = z.object({
  headline: z.string(),
  risk_level: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  observations: z.array(z.string()).describe('Factual observations drawn only from the supplied record.'),
  suggested_checks: z.array(z.string()),
});

export type DenialExplanationResult = z.infer<typeof DenialExplanation> & { source: 'openai' | 'deterministic' };
export type CaseReviewResult = z.infer<typeof CaseReview> & { source: 'openai' | 'deterministic' };

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

function client(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.length === 0) return null;
  return new OpenAI({ apiKey: key });
}

export function aiAvailable(): boolean {
  return client() !== null;
}

/* ------------------------------------------------- deterministic fallbacks */

const CRITERION_LABELS: Record<string, string> = {
  completion_status: 'the course is not recorded as completed',
  completed_at_present: 'no completion date is recorded',
  min_overall_score: 'the overall score is below the rule threshold',
  course_passing_score: 'the overall score is below the course pass mark',
  min_modules_completed_pct: 'not enough modules are finished',
  required_assessments_passed: 'too few assessments were passed',
  min_attendance_pct: 'attendance is below the required level',
  max_days_to_complete: 'the course took longer than the rule allows',
};

function fallbackDenial(decision: IssuanceDecision): DenialExplanationResult {
  const failed = decision.criteria.filter((c) => !c.passed);
  const blocking = failed.map((c) => ({
    criterion: c.criterion,
    what_is_required: String(c.required),
    what_the_learner_has: String(c.actual),
    closest_to_passing:
      typeof c.required === 'number' && typeof c.actual === 'number' && c.required - c.actual <= 5,
  }));
  const next = failed.some((c) => c.criterion === 'required_assessments_passed' || c.criterion.includes('score'))
    ? 'RETAKE_ASSESSMENT'
    : failed.some((c) => c.criterion === 'min_modules_completed_pct')
      ? 'COMPLETE_MODULES'
      : failed.some((c) => c.criterion === 'min_attendance_pct')
        ? 'IMPROVE_ATTENDANCE'
        : failed.some((c) => c.criterion === 'max_days_to_complete')
          ? 'REQUEST_DEADLINE_REVIEW'
          : 'ESCALATE_TO_ADMIN';

  return {
    summary: `Issuance was denied under rule ${decision.rule_id} (version ${decision.rule_version}) because ${failed
      .map((c) => CRITERION_LABELS[c.criterion] ?? c.criterion)
      .join(', ')}.`,
    learner_message: `Your credential for this course cannot be issued yet: ${failed
      .map((c) => CRITERION_LABELS[c.criterion] ?? c.criterion)
      .join('; ')}.`,
    blocking_criteria: blocking,
    recommended_next_step: next as DenialExplanationResult['recommended_next_step'],
    source: 'deterministic',
  };
}

function fallbackReview(detail: CredentialDetail): CaseReviewResult {
  const observations: string[] = [];
  let risk: CaseReviewResult['risk_level'] = 'LOW';

  if (detail.duplicateRowCount > 1) {
    observations.push(`${detail.duplicateRowCount} rows share credential id ${detail.credential.credential_id}.`);
    risk = 'HIGH';
  }
  if (detail.revocations.length > 0) {
    observations.push(`${detail.revocations.length} revocation event(s) recorded; current status is ${detail.credential.status}.`);
    if (risk === 'LOW') risk = 'MEDIUM';
  }
  if (detail.completion?.completed_at && Date.parse(detail.credential.issued_at) < Date.parse(detail.completion.completed_at)) {
    observations.push('The credential was issued before the completion it cites.');
    risk = 'HIGH';
  }
  const invalid = detail.verifications.filter((v) => v.result !== 'VALID').length;
  if (invalid > 0) observations.push(`${invalid} of the last ${detail.verifications.length} verifications did not return VALID.`);
  if (observations.length === 0) observations.push('No anomalies found in this record.');

  return {
    headline: `${detail.credential.credential_id} — ${detail.credential.status.toLowerCase()} credential, ${risk.toLowerCase()} risk`,
    risk_level: risk,
    observations,
    suggested_checks: [
      'Recompute the payload hash and confirm it matches the stored value.',
      'Replay the revocation sequence as of today to confirm the current status.',
      'Confirm the issuer was active on the issue date.',
    ],
    source: 'deterministic',
  };
}

/* ------------------------------------------------------ structured outputs */

export async function explainDenial(input: {
  decision: IssuanceDecision;
  courseTitle: string;
  learnerName: string;
}): Promise<DenialExplanationResult> {
  const openai = client();
  if (!openai) return fallbackDenial(input.decision);

  try {
    const completion = await openai.beta.chat.completions.parse({
      model: MODEL,
      temperature: 0,
      response_format: zodResponseFormat(DenialExplanation, 'denial_explanation'),
      messages: [
        {
          role: 'system',
          content:
            'You explain an issuance decision that has already been made by a deterministic rule engine. ' +
            'Never re-decide, never suggest the decision was wrong, and never invent a criterion that is not ' +
            'in the supplied trace. Use only the figures given.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            course: input.courseTitle,
            learner: input.learnerName,
            decision: input.decision,
          }),
        },
      ],
    });
    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) return fallbackDenial(input.decision);
    return { ...parsed, source: 'openai' };
  } catch {
    // An AI outage must never take the platform down: fall back to the deterministic explanation.
    return fallbackDenial(input.decision);
  }
}

export async function reviewCase(detail: CredentialDetail): Promise<CaseReviewResult> {
  const openai = client();
  if (!openai) return fallbackReview(detail);

  try {
    const completion = await openai.beta.chat.completions.parse({
      model: MODEL,
      temperature: 0,
      response_format: zodResponseFormat(CaseReview, 'case_review'),
      messages: [
        {
          role: 'system',
          content:
            'You are assisting an academic administrator reviewing one credential record. State only what the ' +
            'supplied record supports. Do not assert that a credential is valid or invalid — that is decided by ' +
            'the verification engine, not by you.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            credential: {
              credential_id: detail.credential.credential_id,
              status: detail.credential.status,
              issued_at: detail.credential.issued_at,
              expires_at: detail.credential.expires_at,
              duplicate_row_count: detail.duplicateRowCount,
            },
            completion: detail.completion
              ? { completed_at: detail.completion.completed_at, overall_score: detail.completion.overall_score, status: detail.completion.status }
              : null,
            revocations: detail.revocations,
            recent_verifications: detail.verifications.map((v) => ({ result: v.result, requested_at: v.requested_at, method: v.identity_match_method })),
          }),
        },
      ],
    });
    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) return fallbackReview(detail);
    return { ...parsed, source: 'openai' };
  } catch {
    return fallbackReview(detail);
  }
}
