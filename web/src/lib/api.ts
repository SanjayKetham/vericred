/** Thin API client. The token lives in memory and in sessionStorage so a refresh keeps the session. */

export interface AuthUser {
  user_id: string;
  email: string;
  role: string;
  display_name: string;
  learner_id: string | null;
}

const TOKEN_KEY = 'vericred.token';
const USER_KEY = 'vericred.user';

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage can be unavailable; the in-memory session still works for this page view */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.message === 'string' ? body.message : `Request failed (${status})`);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

export interface Metrics {
  totals: Record<string, number>;
  credential_status: Record<string, number>;
  verification_result: Record<string, number>;
  revocation_reason: Record<string, number>;
  identity_match_method: Record<string, number>;
  issuance_by_month: { month: string; issued: number; revoked: number }[];
  verification_by_month: { month: string; valid: number; invalid: number }[];
  top_courses: { course_id: string; title: string; credentials: number }[];
  issuer_usage: { issuer_id: string; legal_name: string; credentials: number }[];
  latency: { p50: number; p90: number; p99: number };
  activity_heatmap: { date: string; count: number }[];
  issuer_trends: {
    issuer_id: string;
    legal_name: string;
    total: number;
    delta_pct: number;
    points: { month: string; count: number }[];
  }[];
}

export interface Credential {
  credential_id: string;
  learner_id: string;
  course_id: string;
  completion_id: string;
  issuer_id: string;
  rule_id: string;
  rule_version: number;
  issued_at: string;
  expires_at: string | null;
  status: string;
  payload_json: string;
  payload_hash: string;
  signature: string;
  verification_code: string;
  issuance_decision: string;
}

export interface Criterion {
  criterion: string;
  required: string | number;
  actual: string | number;
  passed: boolean;
}

export interface IssuanceDecision {
  decision: 'APPROVED' | 'DENIED';
  rule_id: string;
  rule_version: number;
  evaluated_at: string;
  criteria: Criterion[];
  failed_criteria: string[];
}

export interface VerifyResponse {
  verification_id: string;
  result: string;
  valid: boolean;
  checked_at: string;
  latency_ms: number;
  checks: Criterion[];
  signature_valid: boolean;
  revocation: { revoked_at: string; reason_code: string; revocation_id: string } | null;
  credential: {
    credential_id: string;
    course_id: string;
    issuer_id: string;
    issued_at: string;
    expires_at: string | null;
    status: string;
    payload_hash: string;
    subject_name: string;
  } | null;
}

export interface AuditRow {
  event_id: string;
  event_seq: number;
  entity_type: string;
  entity_id: string;
  event_type: string;
  actor_id: string;
  actor_role: string;
  occurred_at: string;
  payload_json: string;
  prev_hash: string;
  event_hash: string;
}
