import { PrismaClient } from '@prisma/client';
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
import {
  buildMetrics,
  type AppUser,
  type CredentialDetail,
  type CredentialQuery,
  type EligibleCandidate,
  type Metrics,
  type Repo,
} from './repo.js';

/** PostgreSQL driver. Dates come back as Date objects, so every row is normalised to the ISO strings
 *  the rule engine and the API contract use — one row shape regardless of which driver served it. */

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());
const isoReq = (d: Date): string => d.toISOString();

const toCredential = (r: Record<string, unknown>): Credential => ({
  ...(r as unknown as Credential),
  issued_at: isoReq(r.issued_at as Date),
  expires_at: iso(r.expires_at as Date | null),
});

const toRevocation = (r: Record<string, unknown>): Revocation => ({
  ...(r as unknown as Revocation),
  revoked_at: isoReq(r.revoked_at as Date),
});

const toVerification = (r: Record<string, unknown>): VerificationRequest => ({
  ...(r as unknown as VerificationRequest),
  requested_at: isoReq(r.requested_at as Date),
});

const toCompletion = (r: Record<string, unknown>): CompletionRecord => ({
  ...(r as unknown as CompletionRecord),
  enrolled_at: isoReq(r.enrolled_at as Date),
  last_activity_at: isoReq(r.last_activity_at as Date),
  completed_at: iso(r.completed_at as Date | null),
});

const toCourse = (r: Record<string, unknown>): Course => ({
  ...(r as unknown as Course),
  effective_from: isoReq(r.effective_from as Date),
  effective_to: iso(r.effective_to as Date | null),
});

const toRule = (r: Record<string, unknown>): CredentialRule => ({
  ...(r as unknown as CredentialRule),
  effective_from: isoReq(r.effective_from as Date),
  effective_to: iso(r.effective_to as Date | null),
});

const toIssuer = (r: Record<string, unknown>): Issuer => ({
  ...(r as unknown as Issuer),
  effective_from: isoReq(r.effective_from as Date),
  effective_to: iso(r.effective_to as Date | null),
});

const toLearner = (r: Record<string, unknown>): Learner => ({
  ...(r as unknown as Learner),
  enrollment_date: isoReq(r.enrollment_date as Date),
  created_at: isoReq(r.created_at as Date),
});

const toAudit = (r: Record<string, unknown>): AuditEvent => ({
  ...(r as unknown as AuditEvent),
  occurred_at: isoReq(r.occurred_at as Date),
});

export class PrismaRepo implements Repo {
  readonly driver = 'prisma' as const;
  private constructor(private readonly prisma: PrismaClient) {}

  static async connect(): Promise<PrismaRepo> {
    const prisma = new PrismaClient();
    // A cheap query proves both that the server is reachable and that the schema has been pushed.
    await prisma.$queryRaw`SELECT 1`;
    await prisma.credential.count();
    return new PrismaRepo(prisma);
  }

  async listCredentials(q: CredentialQuery) {
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.learnerId) where.learner_id = q.learnerId;
    if (q.search) {
      where.OR = [
        { credential_id: { contains: q.search, mode: 'insensitive' } },
        { verification_code: { contains: q.search, mode: 'insensitive' } },
        { learner_id: { contains: q.search, mode: 'insensitive' } },
        { course_id: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.credential.findMany({
        where: where as never,
        orderBy: { issued_at: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.credential.count({ where: where as never }),
    ]);
    return { rows: rows.map((r) => toCredential(r as never)), total };
  }

  async getCredential(id: string): Promise<CredentialDetail | null> {
    const row = await this.prisma.credential.findUnique({
      where: { credential_id: id },
      include: {
        learner: true,
        course: true,
        issuer: true,
        rule: true,
        completion: true,
        revocations: { orderBy: { sequence_no: 'asc' } },
        verifications: { orderBy: { requested_at: 'desc' }, take: 25 },
      },
    });
    if (!row) return null;
    const { learner, course, issuer, rule, completion, revocations, verifications, ...credential } = row as never as Record<string, unknown> & {
      learner: Record<string, unknown>;
      course: Record<string, unknown>;
      issuer: Record<string, unknown>;
      rule: Record<string, unknown>;
      completion: Record<string, unknown>;
      revocations: Record<string, unknown>[];
      verifications: Record<string, unknown>[];
    };
    return {
      credential: toCredential(credential),
      learner: learner ? toLearner(learner) : null,
      course: course ? toCourse(course) : null,
      issuer: issuer ? toIssuer(issuer) : null,
      rule: rule ? toRule(rule) : null,
      completion: completion ? toCompletion(completion) : null,
      revocations: revocations.map(toRevocation),
      verifications: verifications.map(toVerification),
      // The database enforces the primary key, so a duplicate can never be stored here — unlike the raw
      // files, where EC-02 lives. One row is always the honest answer from this driver.
      duplicateRowCount: 1,
    };
  }

  async findCredentialByRef(ref: string) {
    const trimmed = ref.trim().toUpperCase();
    const rows = await this.prisma.credential.findMany({
      where: { OR: [{ credential_id: trimmed }, { verification_code: trimmed }] },
      take: 5,
    });
    return { matches: rows.map((r) => toCredential(r as never)) };
  }

  async listIssuers() {
    const rows = await this.prisma.issuer.findMany({ orderBy: { issuer_id: 'asc' } });
    return rows.map((r) => toIssuer(r as never));
  }

  async getIssuer(id: string) {
    const row = await this.prisma.issuer.findUnique({ where: { issuer_id: id } });
    return row ? toIssuer(row as never) : null;
  }

  async listEligible(limit: number): Promise<EligibleCandidate[]> {
    const rows = await this.prisma.completionRecord.findMany({
      where: { status: 'COMPLETED', credential: { is: null } },
      include: { course: { include: { rules: true } }, learner: true },
      take: limit,
      orderBy: { completed_at: 'desc' },
    });
    const out: EligibleCandidate[] = [];
    for (const row of rows as never as (Record<string, unknown> & {
      course: Record<string, unknown> & { rules: Record<string, unknown>[] };
      learner: Record<string, unknown>;
    })[]) {
      const rules = row.course.rules.map(toRule);
      const rule = rules.find((r) => r.status === 'ACTIVE') ?? rules.at(-1);
      if (!rule) continue;
      out.push({
        completion: toCompletion(row),
        course: toCourse(row.course),
        learner: toLearner(row.learner),
        rule,
      });
    }
    return out;
  }

  async getCompletion(id: string) {
    const row = await this.prisma.completionRecord.findUnique({
      where: { completion_id: id },
      include: { course: true, learner: true },
    });
    if (!row) return null;
    const typed = row as never as Record<string, unknown> & { course: Record<string, unknown>; learner: Record<string, unknown> };
    return { completion: toCompletion(typed), course: toCourse(typed.course), learner: toLearner(typed.learner) };
  }

  async rulesForCourse(courseId: string) {
    const rows = await this.prisma.credentialRule.findMany({
      where: { course_id: courseId },
      orderBy: { rule_version: 'asc' },
    });
    return rows.map((r) => toRule(r as never));
  }

  async revocationsFor(credentialId: string) {
    const rows = await this.prisma.revocation.findMany({
      where: { credential_id: credentialId },
      orderBy: { sequence_no: 'asc' },
    });
    return rows.map((r) => toRevocation(r as never));
  }

  async insertCredential(row: Credential) {
    await this.prisma.credential.create({
      data: { ...row, issued_at: new Date(row.issued_at), expires_at: row.expires_at ? new Date(row.expires_at) : null } as never,
    });
  }

  async insertRevocation(row: Revocation) {
    // The revocation row and the credential's derived status move together or not at all.
    await this.prisma.$transaction([
      this.prisma.revocation.create({ data: { ...row, revoked_at: new Date(row.revoked_at) } as never }),
      this.prisma.credential.update({
        where: { credential_id: row.credential_id },
        data: { status: row.status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE' },
      }),
    ]);
  }

  async insertVerification(row: VerificationRequest) {
    await this.prisma.verificationRequest.create({
      data: { ...row, requested_at: new Date(row.requested_at) } as never,
    });
  }

  async insertAudit(row: AuditEvent) {
    await this.prisma.auditEvent.create({ data: { ...row, occurred_at: new Date(row.occurred_at) } as never });
  }

  async lastAuditEvent() {
    const row = await this.prisma.auditEvent.findFirst({ orderBy: { event_seq: 'desc' } });
    return row ? toAudit(row as never) : null;
  }

  async listAudit(q: { entityId?: string; entityType?: string; limit: number }) {
    const where: Record<string, unknown> = {};
    if (q.entityId) where.entity_id = q.entityId;
    if (q.entityType) where.entity_type = q.entityType;
    const rows = await this.prisma.auditEvent.findMany({
      where: where as never,
      orderBy: { event_seq: 'desc' },
      take: q.limit,
    });
    return rows.map((r) => toAudit(r as never));
  }

  async groundTruth(): Promise<GroundTruthRow[]> {
    // Ground truth is deliberately not loaded into the operational database — it is evaluation data,
    // and keeping it out of the serving store is what stops it leaking into anything the system decides.
    return [];
  }

  async findUser(email: string): Promise<AppUser | null> {
    const row = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    return row ? { ...row, role: String(row.role), created_at: row.created_at.toISOString() } : null;
  }

  async createUser(user: AppUser) {
    await this.prisma.user.create({
      data: {
        user_id: user.user_id,
        email: user.email.toLowerCase(),
        password_hash: user.password_hash,
        role: user.role,
        display_name: user.display_name,
        learner_id: user.learner_id,
      } as never,
    });
  }

  async listUsers() {
    const rows = await this.prisma.user.findMany({ orderBy: { created_at: 'desc' }, take: 500 });
    return rows.map((r) => ({
      user_id: r.user_id,
      email: r.email,
      role: String(r.role),
      display_name: r.display_name,
      learner_id: r.learner_id,
      created_at: r.created_at.toISOString(),
    }));
  }

  async getLearner(learnerId: string) {
    const row = await this.prisma.learner.findUnique({ where: { learner_id: learnerId } });
    return row ? toLearner(row as never) : null;
  }

  async learnerCourses(learnerId: string) {
    const rows = await this.prisma.completionRecord.findMany({
      where: { learner_id: learnerId },
      include: { course: true },
      orderBy: { enrolled_at: 'desc' },
    });
    return (rows as never as (Record<string, unknown> & { course: Record<string, unknown> })[]).map((row) => ({
      completion: toCompletion(row),
      course: toCourse(row.course),
    }));
  }

  async listCourses(limit: number, search?: string) {
    const where = search?.trim()
      ? {
          OR: [
            { course_id: { contains: search.trim(), mode: 'insensitive' } },
            { course_code: { contains: search.trim(), mode: 'insensitive' } },
            { title: { contains: search.trim(), mode: 'insensitive' } },
            { subject_area: { contains: search.trim(), mode: 'insensitive' } },
          ],
        }
      : {};
    const rows = await this.prisma.course.findMany({ where: where as never, take: limit, orderBy: { course_id: 'asc' } });
    return rows.map((r) => toCourse(r as never));
  }

  async listRules(courseId?: string) {
    const rows = await this.prisma.credentialRule.findMany({
      where: courseId ? { course_id: courseId } : {},
      take: 500,
      orderBy: [{ course_id: 'asc' }, { rule_version: 'asc' }],
    });
    return rows.map((r) => toRule(r as never));
  }

  async listVerifications(limit: number, resultFilter?: string) {
    const where =
      resultFilter === 'FAILED' ? { NOT: { result: 'VALID' } } : resultFilter ? { result: resultFilter } : {};
    const rows = await this.prisma.verificationRequest.findMany({
      where: where as never,
      take: limit,
      orderBy: { requested_at: 'desc' },
    });
    return rows.map((r) => toVerification(r as never));
  }

  async listRevocations(limit: number) {
    const rows = await this.prisma.revocation.findMany({ take: limit, orderBy: { revoked_at: 'desc' } });
    return rows.map((r) => toRevocation(r as never));
  }

  async searchLearners(query: string, limit: number) {
    const needle = query.trim();
    const where = needle
      ? {
          OR: [
            { learner_id: { contains: needle, mode: 'insensitive' } },
            { email: { contains: needle, mode: 'insensitive' } },
            { national_id_hash: { contains: needle, mode: 'insensitive' } },
            { full_name: { contains: needle, mode: 'insensitive' } },
          ],
        }
      : {};
    const rows = await this.prisma.learner.findMany({ where: where as never, take: limit });
    return rows.map((r) => toLearner(r as never));
  }

  async metrics(): Promise<Metrics> {
    const [credentials, verifications, revocations, courses, issuers, learners, completions, auditEvents] =
      await Promise.all([
        this.prisma.credential.findMany(),
        this.prisma.verificationRequest.findMany(),
        this.prisma.revocation.findMany(),
        this.prisma.course.findMany(),
        this.prisma.issuer.findMany(),
        this.prisma.learner.count(),
        this.prisma.completionRecord.count(),
        this.prisma.auditEvent.count(),
      ]);
    return buildMetrics({
      credentials: credentials.map((r) => toCredential(r as never)),
      verifications: verifications.map((r) => toVerification(r as never)),
      revocations: revocations.map((r) => toRevocation(r as never)),
      courses: courses.map((r) => toCourse(r as never)),
      issuers: issuers.map((r) => toIssuer(r as never)),
      learners,
      completions,
      auditEvents,
    });
  }
}
