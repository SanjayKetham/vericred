import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { loadDataset } from '../validator/validate.js';

/**
 * Loads the generated dataset into PostgreSQL.
 *
 * Rows are inserted parent-first so every foreign key resolves at insert time. The duplicated
 * credential_id from edge case EC-02 is expected to be *rejected* by the primary-key constraint — the
 * seeder counts those rejections and prints them, because a silent overwrite would destroy the very
 * anomaly the dataset is meant to carry.
 *
 * Usage: npm run db:seed [-- --dir ../data]
 */

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const get = (flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dir = get('--dir') ?? join(process.cwd(), '..', 'data');

const d = (v: string) => new Date(v);
const dn = (v: string | null) => (v === null || v === '' ? null : new Date(v));

async function chunked<T>(label: string, rows: T[], insert: (batch: T[]) => Promise<unknown>, size = 1000) {
  for (let i = 0; i < rows.length; i += size) {
    await insert(rows.slice(i, i + size));
  }
  console.log(`  ${label.padEnd(22)} ${String(rows.length).padStart(7)} rows`);
}

/**
 * Fail with an explanation rather than a driver stack trace. A missing .env and an unreachable
 * database are the two ordinary ways this command goes wrong, and neither is obvious from the
 * Prisma error that would otherwise surface.
 */
async function preflight(client: PrismaClient): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('\n  DATABASE_URL is not set.\n');
    console.error('  This command writes the generated dataset into PostgreSQL, so it needs a connection string.');
    console.error('  Create server/.env from the template and put your database URL in it:\n');
    console.error('      cd server');
    console.error('      cp .env.example .env        # PowerShell: Copy-Item .env.example .env\n');
    console.error('  The API itself does not need this: without a database it serves the generated files,');
    console.error('  and GET /api/health reports which driver is live.\n');
    process.exit(1);
  }

  try {
    await client.$queryRaw`SELECT 1`;
  } catch (error) {
    const detail = error instanceof Error ? firstLine(error.message) : 'unknown error';
    console.error('\n  Could not reach the database.\n');
    console.error(`  DATABASE_URL points at: ${redactUrl(process.env.DATABASE_URL)}`);
    console.error(`  Driver said: ${detail}\n`);
    console.error('  Check that a PostgreSQL server is running and that the database exists, then run:\n');
    console.error('      npx prisma db push      # create the tables');
    console.error('      npm run db:seed         # load the dataset\n');
    console.error('  Or skip PostgreSQL entirely — `npm run dev` serves the generated files.\n');
    process.exit(1);
  }
}

/**
 * Prisma wraps the useful sentence inside a block whose first lines are blank and then a generic
 * "Invalid `prisma.x()` invocation". Prefer the line that actually names the cause.
 */
function firstLine(message: string): string {
  const lines = message
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const telling = lines.find((line) =>
    /can't reach|cannot reach|econnrefused|authentication|does not exist|timed out|environment variable|password/i.test(
      line,
    ),
  );
  return telling ?? lines.find((line) => !/^invalid `/i.test(line)) ?? lines[0] ?? 'no further detail';
}

/** Keeps the password out of the console while still showing which host was tried. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '(unparseable connection string)';
  }
}

async function main() {
  await preflight(prisma);

  const data = loadDataset(dir);
  console.log(`\nSeeding PostgreSQL from ${dir}\n`);

  // Children first on delete, parents first on insert.
  await prisma.auditEvent.deleteMany();
  await prisma.verificationRequest.deleteMany();
  await prisma.revocation.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.completionRecord.deleteMany();
  await prisma.credentialRule.deleteMany();
  await prisma.course.deleteMany();
  await prisma.learner.deleteMany();
  await prisma.issuer.deleteMany();
  await prisma.user.deleteMany();

  await chunked('Learner', data.learners, (b) =>
    prisma.learner.createMany({
      data: b.map((r) => ({ ...r, enrollment_date: d(r.enrollment_date), created_at: d(r.created_at) })) as never,
    }),
  );

  await chunked('Course', data.courses, (b) =>
    prisma.course.createMany({
      data: b.map((r) => ({ ...r, effective_from: d(r.effective_from), effective_to: dn(r.effective_to) })) as never,
    }),
  );

  // Issuers carry a self-referencing foreign key, so originals must land before their successors.
  const issuersOrdered = [
    ...data.issuers.filter((i) => i.supersedes_issuer_id === null),
    ...data.issuers.filter((i) => i.supersedes_issuer_id !== null),
  ];
  for (const r of issuersOrdered) {
    await prisma.issuer.create({
      data: { ...r, effective_from: d(r.effective_from), effective_to: dn(r.effective_to) } as never,
    });
  }
  console.log(`  ${'Issuer'.padEnd(22)} ${String(issuersOrdered.length).padStart(7)} rows`);

  await chunked('CredentialRule', data.credentialRules, (b) =>
    prisma.credentialRule.createMany({
      data: b.map((r) => ({ ...r, effective_from: d(r.effective_from), effective_to: dn(r.effective_to) })) as never,
    }),
  );

  await chunked('CompletionRecord', data.completionRecords, (b) =>
    prisma.completionRecord.createMany({
      data: b.map((r) => ({
        ...r,
        enrolled_at: d(r.enrolled_at),
        last_activity_at: d(r.last_activity_at),
        completed_at: dn(r.completed_at),
      })) as never,
    }),
  );

  // Credentials go in one at a time so a rejected duplicate does not take a whole batch with it.
  let credentialsInserted = 0;
  const rejected: { credential_id: string; reason: string }[] = [];
  for (const r of data.credentials) {
    try {
      await prisma.credential.create({
        data: { ...r, issued_at: d(r.issued_at), expires_at: dn(r.expires_at) } as never,
      });
      credentialsInserted++;
    } catch (error) {
      rejected.push({
        credential_id: r.credential_id,
        reason: error instanceof Error ? error.message.split('\n').at(-1)?.trim() ?? 'constraint violation' : 'unknown',
      });
    }
  }
  console.log(`  ${'Credential'.padEnd(22)} ${String(credentialsInserted).padStart(7)} rows`);

  const storedCredentialIds = new Set(
    (await prisma.credential.findMany({ select: { credential_id: true } })).map((c) => c.credential_id),
  );

  await chunked('Revocation', data.revocations.filter((r) => storedCredentialIds.has(r.credential_id)), (b) =>
    prisma.revocation.createMany({ data: b.map((r) => ({ ...r, revoked_at: d(r.revoked_at) })) as never }),
  );

  await chunked('VerificationRequest', data.verificationRequests, (b) =>
    prisma.verificationRequest.createMany({
      data: b.map((r) => ({
        ...r,
        credential_id: r.credential_id && storedCredentialIds.has(r.credential_id) ? r.credential_id : null,
        requested_at: d(r.requested_at),
      })) as never,
    }),
  );

  await chunked('AuditEvent', data.auditEvents, (b) =>
    prisma.auditEvent.createMany({ data: b.map((r) => ({ ...r, occurred_at: d(r.occurred_at) })) as never }),
  );

  /* Demo users, one per role, for the JWT + RBAC layer. */
  const password = await bcrypt.hash('vericred2026', 10);
  // A learner with several courses and certificates makes the learner dashboard worth looking at.
  const demoLearner = data.learners.find((l) => l.learner_id === 'LRN-003528')?.learner_id ?? data.learners[0]!.learner_id;
  await prisma.user.createMany({
    data: [
      { user_id: 'USR-001', email: 'admin@vericred.example', password_hash: password, role: 'PLATFORM_ADMIN', display_name: 'Platform Administrator', learner_id: null },
      { user_id: 'USR-002', email: 'registrar@vericred.example', password_hash: password, role: 'ADMIN', display_name: 'Academic Administrator', learner_id: null },
      { user_id: 'USR-003', email: 'instructor@vericred.example', password_hash: password, role: 'INSTRUCTOR', display_name: 'Course Instructor', learner_id: null },
      { user_id: 'USR-004', email: 'support@vericred.example', password_hash: password, role: 'SUPPORT', display_name: 'Support Agent', learner_id: null },
      { user_id: 'USR-005', email: 'learner@vericred.example', password_hash: password, role: 'LEARNER', display_name: 'Demo Learner', learner_id: demoLearner },
    ] as never,
  });
  console.log(`  ${'User'.padEnd(22)} ${String(5).padStart(7)} rows`);

  if (rejected.length > 0) {
    console.log(`\n  ${rejected.length} credential row(s) rejected by the primary-key constraint — this is the`);
    console.log('  EC-02 duplicate-credential-id edge case being caught by the database, not an error:');
    for (const r of rejected.slice(0, 10)) console.log(`    ${r.credential_id}: ${r.reason}`);
  }
  console.log('\n  Demo logins: <role>@vericred.example / vericred2026\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
