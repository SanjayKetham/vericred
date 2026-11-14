import { join } from 'node:path';
import type {
  AuditEvent,
  CompletionRecord,
  Course,
  Credential,
  CredentialRule,
  GroundTruthRow,
  Issuer,
  Learner,
  Revocation,
  VerificationRequest,
} from '../lib/types.js';
import { loadDataset } from '../validator/validate.js';

/**
 * Read model for the API.
 *
 * Two drivers implement the same interface. `prisma` is the configured production path against
 * PostgreSQL; `file` reads the generated dataset straight from data/csv so the service — and the demo —
 * still runs where no database is provisioned. The driver is chosen at startup by probing the database
 * once, and /api/health reports which one is live, so nobody has to guess which store they are seeing.
 */

export interface CredentialDetail {
  credential: Credential;
  learner: Learner | null;
  course: Course | null;
  issuer: Issuer | null;
  rule: CredentialRule | null;
  completion: CompletionRecord | null;
  revocations: Revocation[];
  verifications: VerificationRequest[];
  duplicateRowCount: number;
}

export interface CredentialQuery {
  status?: string;
  search?: string;
  learnerId?: string;
  page: number;
  pageSize: number;
}

export interface EligibleCandidate {
  completion: CompletionRecord;
  course: Course;
  learner: Learner;
  rule: CredentialRule;
}

export interface AppUser {
  user_id: string;
  email: string;
  password_hash: string;
  role: string;
  display_name: string;
  learner_id: string | null;
  created_at?: string;
}

export interface Repo {
  readonly driver: 'prisma' | 'file';
  listCredentials(q: CredentialQuery): Promise<{ rows: Credential[]; total: number }>;
  getCredential(id: string): Promise<CredentialDetail | null>;
  findCredentialByRef(ref: string): Promise<{ matches: Credential[] }>;
  listIssuers(): Promise<Issuer[]>;
  getIssuer(id: string): Promise<Issuer | null>;
  listEligible(limit: number): Promise<EligibleCandidate[]>;
  getCompletion(id: string): Promise<{ completion: CompletionRecord; course: Course; learner: Learner } | null>;
  rulesForCourse(courseId: string): Promise<CredentialRule[]>;
  revocationsFor(credentialId: string): Promise<Revocation[]>;
  insertCredential(row: Credential): Promise<void>;
  insertRevocation(row: Revocation): Promise<void>;
  insertVerification(row: VerificationRequest): Promise<void>;
  insertAudit(row: AuditEvent): Promise<void>;
  lastAuditEvent(): Promise<AuditEvent | null>;
  listAudit(q: { entityId?: string; entityType?: string; limit: number }): Promise<AuditEvent[]>;
  metrics(): Promise<Metrics>;
  groundTruth(): Promise<GroundTruthRow[]>;
  findUser(email: string): Promise<AppUser | null>;
  createUser(user: AppUser): Promise<void>;
  listUsers(): Promise<Omit<AppUser, 'password_hash'>[]>;
  getLearner(learnerId: string): Promise<Learner | null>;
  /** Courses a learner has a completion record for, with that record attached. */
  learnerCourses(learnerId: string): Promise<{ completion: CompletionRecord; course: Course }[]>;
  listCourses(limit: number, search?: string): Promise<Course[]>;
  listRules(courseId?: string): Promise<CredentialRule[]>;
  listVerifications(limit: number, resultFilter?: string): Promise<VerificationRequest[]>;
  listRevocations(limit: number): Promise<Revocation[]>;
  searchLearners(query: string, limit: number): Promise<Learner[]>;
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
  /** Verification volume per day for the trailing 6 weeks, ending on the latest request in the data. */
  activity_heatmap: { date: string; count: number }[];
  /** Monthly issuance for the busiest issuers — the sparkline series on the dashboard. */
  issuer_trends: { issuer_id: string; legal_name: string; total: number; delta_pct: number; points: { month: string; count: number }[] }[];
}

const tally = <T>(rows: T[], pick: (r: T) => string): Record<string, number> => {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = pick(r);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Object.fromEntries([...map].sort((a, b) => b[1] - a[1]));
};

const month = (iso: string): string => iso.slice(0, 7);

/* ------------------------------------------------------------ file driver */

export class FileRepo implements Repo {
  readonly driver = 'file' as const;
  private readonly data: ReturnType<typeof loadDataset>;
  private readonly credentialIndex = new Map<string, Credential[]>();
  private readonly codeIndex = new Map<string, Credential[]>();
  private readonly revocationIndex = new Map<string, Revocation[]>();
  private readonly verificationIndex = new Map<string, VerificationRequest[]>();
  private readonly credentialsNewestFirst: Credential[];
  private readonly verificationIds = new Set<string>();
  /** Accounts registered at runtime join the demo set; the Prisma driver persists them instead. */
  private readonly users: AppUser[] = DEMO_USERS.map((u) => ({ ...u }));

  constructor(dir: string) {
    this.data = loadDataset(dir);
    this.credentialsNewestFirst = [...this.data.credentials].sort(
      (a, b) => Date.parse(b.issued_at) - Date.parse(a.issued_at),
    );
    for (const c of this.data.credentials) {
      const list = this.credentialIndex.get(c.credential_id) ?? [];
      list.push(c);
      this.credentialIndex.set(c.credential_id, list);
      const byCode = this.codeIndex.get(c.verification_code) ?? [];
      byCode.push(c);
      this.codeIndex.set(c.verification_code, byCode);
    }
    for (const r of this.data.revocations) {
      const list = this.revocationIndex.get(r.credential_id) ?? [];
      list.push(r);
      this.revocationIndex.set(r.credential_id, list);
    }
    for (const v of this.data.verificationRequests) {
      this.verificationIds.add(v.verification_id);
      if (!v.credential_id) continue;
      const list = this.verificationIndex.get(v.credential_id) ?? [];
      list.push(v);
      this.verificationIndex.set(v.credential_id, list);
    }
  }

  async listCredentials(q: CredentialQuery) {
    // Newest first, matching the Prisma driver — the two drivers must answer the same contract.
    let rows = this.credentialsNewestFirst;
    if (q.status) rows = rows.filter((c) => c.status === q.status);
    if (q.learnerId) rows = rows.filter((c) => c.learner_id === q.learnerId);
    if (q.search) {
      const needle = q.search.toLowerCase();
      rows = rows.filter(
        (c) =>
          c.credential_id.toLowerCase().includes(needle) ||
          c.verification_code.toLowerCase().includes(needle) ||
          c.learner_id.toLowerCase().includes(needle) ||
          c.course_id.toLowerCase().includes(needle),
      );
    }
    const total = rows.length;
    const start = (q.page - 1) * q.pageSize;
    return { rows: rows.slice(start, start + q.pageSize), total };
  }

  async getCredential(id: string): Promise<CredentialDetail | null> {
    const matches = this.credentialIndex.get(id);
    if (!matches || matches.length === 0) return null;
    const credential = matches[0]!;
    return {
      credential,
      learner: this.data.learners.find((l) => l.learner_id === credential.learner_id) ?? null,
      course: this.data.courses.find((c) => c.course_id === credential.course_id) ?? null,
      issuer: this.data.issuers.find((i) => i.issuer_id === credential.issuer_id) ?? null,
      rule: this.data.credentialRules.find((r) => r.rule_id === credential.rule_id) ?? null,
      completion: this.data.completionRecords.find((c) => c.completion_id === credential.completion_id) ?? null,
      revocations: this.revocationIndex.get(id) ?? [],
      verifications: (this.verificationIndex.get(id) ?? []).slice(-25),
      duplicateRowCount: matches.length,
    };
  }

  async findCredentialByRef(ref: string) {
    const trimmed = ref.trim();
    const byId = this.credentialIndex.get(trimmed.toUpperCase());
    if (byId && byId.length > 0) return { matches: byId };
    const byCode = this.codeIndex.get(trimmed.toUpperCase());
    return { matches: byCode ?? [] };
  }

  async listIssuers() {
    return this.data.issuers;
  }

  async getIssuer(id: string) {
    return this.data.issuers.find((i) => i.issuer_id === id) ?? null;
  }

  async listEligible(limit: number) {
    const issued = new Set(this.data.credentials.map((c) => c.completion_id));
    const out: EligibleCandidate[] = [];
    for (const completion of this.data.completionRecords) {
      if (completion.status !== 'COMPLETED' || issued.has(completion.completion_id)) continue;
      const course = this.data.courses.find((c) => c.course_id === completion.course_id);
      const learner = this.data.learners.find((l) => l.learner_id === completion.learner_id);
      const rules = this.data.credentialRules.filter((r) => r.course_id === completion.course_id);
      const rule = rules.find((r) => r.status === 'ACTIVE') ?? rules.at(-1);
      if (!course || !learner || !rule) continue;
      out.push({ completion, course, learner, rule });
      if (out.length >= limit) break;
    }
    return out;
  }

  async getCompletion(id: string) {
    const completion = this.data.completionRecords.find((c) => c.completion_id === id);
    if (!completion) return null;
    const course = this.data.courses.find((c) => c.course_id === completion.course_id);
    const learner = this.data.learners.find((l) => l.learner_id === completion.learner_id);
    if (!course || !learner) return null;
    return { completion, course, learner };
  }

  async rulesForCourse(courseId: string) {
    return this.data.credentialRules.filter((r) => r.course_id === courseId);
  }

  async revocationsFor(credentialId: string) {
    return this.revocationIndex.get(credentialId) ?? [];
  }

  async insertCredential(row: Credential) {
    if (this.credentialIndex.has(row.credential_id)) {
      throw Object.assign(new Error(`credential_id ${row.credential_id} already exists`), { code: 'DUPLICATE' });
    }
    this.data.credentials.push(row);
    this.credentialsNewestFirst.unshift(row);
    this.credentialIndex.set(row.credential_id, [row]);
    this.codeIndex.set(row.verification_code, [row]);
  }

  async insertRevocation(row: Revocation) {
    this.data.revocations.push(row);
    const list = this.revocationIndex.get(row.credential_id) ?? [];
    list.push(row);
    this.revocationIndex.set(row.credential_id, list);
    const credentials = this.credentialIndex.get(row.credential_id) ?? [];
    for (const c of credentials) if (row.status === 'ACTIVE') c.status = 'REVOKED';
  }

  async insertVerification(row: VerificationRequest) {
    // Mirror the database's unique index: a store that quietly accepts a duplicate hides the bug
    // rather than surfacing it, and the two drivers must answer the same contract.
    if (this.verificationIds.has(row.verification_id)) {
      throw Object.assign(new Error(`verification_id ${row.verification_id} already exists`), { code: 'DUPLICATE' });
    }
    this.verificationIds.add(row.verification_id);
    this.data.verificationRequests.push(row);
    if (row.credential_id) {
      const list = this.verificationIndex.get(row.credential_id) ?? [];
      list.push(row);
      this.verificationIndex.set(row.credential_id, list);
    }
  }

  async insertAudit(row: AuditEvent) {
    this.data.auditEvents.push(row);
  }

  async lastAuditEvent() {
    return this.data.auditEvents.at(-1) ?? null;
  }

  async listAudit(q: { entityId?: string; entityType?: string; limit: number }) {
    let rows = this.data.auditEvents;
    if (q.entityId) rows = rows.filter((e) => e.entity_id === q.entityId);
    if (q.entityType) rows = rows.filter((e) => e.entity_type === q.entityType);
    return rows.slice(-q.limit).reverse();
  }

  async groundTruth() {
    return this.data.groundTruth;
  }

  async findUser(email: string) {
    return this.users.find((u) => u.email === email.toLowerCase()) ?? null;
  }

  async createUser(user: AppUser) {
    if (this.users.some((u) => u.email === user.email.toLowerCase())) {
      throw Object.assign(new Error('email already registered'), { code: 'DUPLICATE' });
    }
    this.users.push({ ...user, email: user.email.toLowerCase() });
  }

  async listUsers() {
    return this.users.map(({ password_hash: _omitted, ...rest }) => rest);
  }

  async getLearner(learnerId: string) {
    return this.data.learners.find((l) => l.learner_id === learnerId) ?? null;
  }

  async learnerCourses(learnerId: string) {
    const out: { completion: CompletionRecord; course: Course }[] = [];
    for (const completion of this.data.completionRecords) {
      if (completion.learner_id !== learnerId) continue;
      const course = this.data.courses.find((c) => c.course_id === completion.course_id);
      if (course) out.push({ completion, course });
    }
    return out;
  }

  async listCourses(limit: number, search?: string) {
    const needle = search?.trim().toLowerCase();
    const rows = needle
      ? this.data.courses.filter((c) =>
          `${c.course_id} ${c.course_code} ${c.title} ${c.subject_area}`.toLowerCase().includes(needle),
        )
      : this.data.courses;
    return rows.slice(0, limit);
  }

  async listRules(courseId?: string) {
    const rows = courseId ? this.data.credentialRules.filter((r) => r.course_id === courseId) : this.data.credentialRules;
    return rows.slice(0, 500);
  }

  async listVerifications(limit: number, resultFilter?: string) {
    const rows = resultFilter
      ? this.data.verificationRequests.filter((v) => (resultFilter === 'FAILED' ? v.result !== 'VALID' : v.result === resultFilter))
      : this.data.verificationRequests;
    return [...rows].sort((a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at)).slice(0, limit);
  }

  async listRevocations(limit: number) {
    return [...this.data.revocations].sort((a, b) => Date.parse(b.revoked_at) - Date.parse(a.revoked_at)).slice(0, limit);
  }

  async searchLearners(query: string, limit: number) {
    const needle = query.trim().toLowerCase();
    if (!needle) return this.data.learners.slice(0, limit);
    return this.data.learners
      .filter((l) =>
        `${l.learner_id} ${l.email} ${l.national_id_hash} ${l.full_name}`.toLowerCase().includes(needle),
      )
      .slice(0, limit);
  }

  async metrics(): Promise<Metrics> {
    return buildMetrics({
      credentials: this.data.credentials,
      verifications: this.data.verificationRequests,
      revocations: this.data.revocations,
      courses: this.data.courses,
      issuers: this.data.issuers,
      learners: this.data.learners.length,
      completions: this.data.completionRecords.length,
      auditEvents: this.data.auditEvents.length,
    });
  }
}

/**
 * Demo logins for the file driver. bcrypt hash of "vericred2026" — a fixed development credential for a
 * synthetic dataset, never a secret. The Prisma driver reads real users from the User table instead.
 */
const DEMO_PASSWORD_HASH = '$2a$10$y7.0F.hIFNelSAX0STWm.eGzK04W4Ugwuz87BmgyOc8GA4EZsOttW';
export const DEMO_USERS = [
  { user_id: 'USR-001', email: 'admin@vericred.example', password_hash: DEMO_PASSWORD_HASH, role: 'PLATFORM_ADMIN', display_name: 'Platform Administrator', learner_id: null },
  { user_id: 'USR-002', email: 'registrar@vericred.example', password_hash: DEMO_PASSWORD_HASH, role: 'ADMIN', display_name: 'Academic Administrator', learner_id: null },
  { user_id: 'USR-003', email: 'instructor@vericred.example', password_hash: DEMO_PASSWORD_HASH, role: 'INSTRUCTOR', display_name: 'Course Instructor', learner_id: null },
  { user_id: 'USR-004', email: 'support@vericred.example', password_hash: DEMO_PASSWORD_HASH, role: 'SUPPORT', display_name: 'Support Agent', learner_id: null },
  { user_id: 'USR-005', email: 'learner@vericred.example', password_hash: DEMO_PASSWORD_HASH, role: 'LEARNER', display_name: 'Demo Learner', learner_id: 'LRN-003528' },
] as const;

function buildMetrics(input: {
  credentials: Credential[];
  verifications: VerificationRequest[];
  revocations: Revocation[];
  courses: Course[];
  issuers: Issuer[];
  learners: number;
  completions: number;
  auditEvents: number;
}): Metrics {
  const issuedByMonth = new Map<string, number>();
  for (const c of input.credentials) issuedByMonth.set(month(c.issued_at), (issuedByMonth.get(month(c.issued_at)) ?? 0) + 1);
  const revokedByMonth = new Map<string, number>();
  for (const r of input.revocations) {
    if (r.status !== 'ACTIVE') continue;
    revokedByMonth.set(month(r.revoked_at), (revokedByMonth.get(month(r.revoked_at)) ?? 0) + 1);
  }
  const issuance_by_month = [...new Set([...issuedByMonth.keys(), ...revokedByMonth.keys()])]
    .sort()
    .map((m) => ({ month: m, issued: issuedByMonth.get(m) ?? 0, revoked: revokedByMonth.get(m) ?? 0 }));

  const verifyByMonth = new Map<string, { valid: number; invalid: number }>();
  for (const v of input.verifications) {
    const m = month(v.requested_at);
    const entry = verifyByMonth.get(m) ?? { valid: 0, invalid: 0 };
    if (v.result === 'VALID') entry.valid++;
    else entry.invalid++;
    verifyByMonth.set(m, entry);
  }
  const verification_by_month = [...verifyByMonth.entries()].sort().map(([m, v]) => ({ month: m, ...v }));

  const perCourse = new Map<string, number>();
  for (const c of input.credentials) perCourse.set(c.course_id, (perCourse.get(c.course_id) ?? 0) + 1);
  const top_courses = [...perCourse.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([course_id, credentials]) => ({
      course_id,
      title: input.courses.find((c) => c.course_id === course_id)?.title ?? course_id,
      credentials,
    }));

  const perIssuer = new Map<string, number>();
  for (const c of input.credentials) perIssuer.set(c.issuer_id, (perIssuer.get(c.issuer_id) ?? 0) + 1);
  const issuer_usage = input.issuers.map((i) => ({
    issuer_id: i.issuer_id,
    legal_name: i.legal_name,
    credentials: perIssuer.get(i.issuer_id) ?? 0,
  }));

  /* Daily verification volume for the trailing 6 weeks. The window ends at the latest request in the
     data rather than at today's date, so the heatmap stays meaningful for a fixed-as-of dataset. */
  const dayCounts = new Map<string, number>();
  let latestRequest = 0;
  for (const v of input.verifications) {
    const day = v.requested_at.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    latestRequest = Math.max(latestRequest, Date.parse(v.requested_at));
  }
  const activity_heatmap: { date: string; count: number }[] = [];
  if (latestRequest > 0) {
    // Wind back to the Saturday that ends the latest full week so columns line up under S..F.
    const end = new Date(latestRequest);
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
    for (let i = 41; i >= 0; i--) {
      const day = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      activity_heatmap.push({ date: day, count: dayCounts.get(day) ?? 0 });
    }
  }

  /* Per-issuer monthly issuance, for the three busiest issuers. */
  const perIssuerMonth = new Map<string, Map<string, number>>();
  for (const c of input.credentials) {
    const byMonth = perIssuerMonth.get(c.issuer_id) ?? new Map<string, number>();
    const m = month(c.issued_at);
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
    perIssuerMonth.set(c.issuer_id, byMonth);
  }
  const issuer_trends = [...perIssuer.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([issuer_id, total]) => {
      const points = [...(perIssuerMonth.get(issuer_id) ?? new Map())]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .slice(-14)
        .map(([m, count]) => ({ month: m as string, count: count as number }));
      // Compare the last complete month with the one before it; the trailing month is usually partial.
      const prior = points.at(-3)?.count ?? 0;
      const recent = points.at(-2)?.count ?? 0;
      return {
        issuer_id,
        legal_name: input.issuers.find((i) => i.issuer_id === issuer_id)?.legal_name ?? issuer_id,
        total,
        delta_pct: prior === 0 ? 0 : Math.round(((recent - prior) / prior) * 1000) / 10,
        points,
      };
    });

  const latencies = input.verifications.map((v) => v.latency_ms).sort((a, b) => a - b);
  const q = (p: number) => (latencies.length === 0 ? 0 : latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))]!);

  return {
    totals: {
      learners: input.learners,
      courses: input.courses.length,
      completions: input.completions,
      credentials: input.credentials.length,
      verifications: input.verifications.length,
      revocations: input.revocations.length,
      audit_events: input.auditEvents,
    },
    credential_status: tally(input.credentials, (c) => c.status),
    verification_result: tally(input.verifications, (v) => v.result),
    revocation_reason: tally(input.revocations, (r) => r.reason_code),
    identity_match_method: tally(input.verifications, (v) => v.identity_match_method),
    issuance_by_month,
    verification_by_month,
    top_courses,
    issuer_usage,
    latency: { p50: q(0.5), p90: q(0.9), p99: q(0.99) },
    activity_heatmap,
    issuer_trends,
  };
}

export { buildMetrics };

/* ---------------------------------------------------------- driver choice */

/** The line of a driver error that actually names the cause, not Prisma's generic wrapper line. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const lines = error.message
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const telling = lines.find((line) =>
    /can't reach|cannot reach|econnrefused|authentication|does not exist|timed out|environment variable/i.test(line),
  );
  return telling ?? lines.find((line) => !/^invalid `/i.test(line)) ?? lines[0] ?? 'no further detail';
}

export async function createRepo(
  dataDir = process.env.DATA_DIR ?? join(process.cwd(), '..', 'data'),
): Promise<Repo> {
  if (process.env.DATA_SOURCE !== 'file' && process.env.DATABASE_URL) {
    try {
      const { PrismaRepo } = await import('./prismaRepo.js');
      const repo = await PrismaRepo.connect();
      console.log('  data source: PostgreSQL via Prisma');
      return repo;
    } catch (error) {
      console.warn(
        `  PostgreSQL unavailable (${describeError(error)}); falling back to the file driver.`,
      );
    }
  }
  console.log(`  data source: generated files at ${dataDir}`);
  return new FileRepo(dataDir);
}
