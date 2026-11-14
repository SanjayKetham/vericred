import { join } from 'node:path';
import { ensureDir, sha256File, writeCsv, writeJson, writeJsonl, writeSqlSeed } from '../lib/io.js';
import type { Dataset } from '../lib/types.js';
import type { GeneratorConfig } from './generate.js';

/** Column order is declared once and reused for CSV and SQL so exports stay byte-stable. */
export const COLUMNS = {
  learners: ['learner_id', 'first_name', 'last_name', 'full_name', 'email', 'date_of_birth', 'national_id_hash', 'country', 'enrollment_date', 'status', 'created_at'],
  courses: ['course_id', 'course_code', 'title', 'subject_area', 'level', 'credit_hours', 'modules_total', 'assessment_count', 'passing_score', 'effective_from', 'effective_to', 'status'],
  issuers: ['issuer_id', 'legal_name', 'accreditation_body', 'key_algorithm', 'public_key', 'effective_from', 'effective_to', 'supersedes_issuer_id', 'status'],
  credential_rules: ['rule_id', 'course_id', 'rule_version', 'min_overall_score', 'min_modules_completed_pct', 'required_assessments_passed', 'min_attendance_pct', 'max_days_to_complete', 'effective_from', 'effective_to', 'status'],
  completion_records: ['completion_id', 'learner_id', 'course_id', 'enrolled_at', 'last_activity_at', 'completed_at', 'modules_total', 'modules_completed', 'modules_completed_pct', 'attendance_pct', 'assessments_taken', 'assessments_passed', 'overall_score', 'days_to_complete', 'status'],
  credentials: ['credential_id', 'learner_id', 'course_id', 'completion_id', 'issuer_id', 'rule_id', 'rule_version', 'issued_at', 'expires_at', 'status', 'payload_json', 'payload_hash', 'hash_algorithm', 'signature', 'signature_algorithm', 'verification_code', 'issuance_decision'],
  verification_requests: ['verification_id', 'credential_id', 'requested_credential_ref', 'verifier_name', 'verifier_type', 'requested_at', 'presented_hash', 'identity_match_method', 'identity_match_score', 'result', 'latency_ms'],
  revocations: ['revocation_id', 'credential_id', 'sequence_no', 'reason_code', 'reason_text', 'revoked_at', 'revoked_by', 'status'],
  audit_events: ['event_id', 'event_seq', 'entity_type', 'entity_id', 'event_type', 'actor_id', 'actor_role', 'occurred_at', 'payload_json', 'prev_hash', 'event_hash'],
  ground_truth: ['record_type', 'record_id', 'issue_type', 'expected_decision', 'detectable_by', 'description'],
} as const;

const TABLES = [
  ['learners', 'Learner'],
  ['courses', 'Course'],
  ['issuers', 'Issuer'],
  ['credential_rules', 'CredentialRule'],
  ['completion_records', 'CompletionRecord'],
  ['credentials', 'Credential'],
  ['verification_requests', 'VerificationRequest'],
  ['revocations', 'Revocation'],
  ['audit_events', 'AuditEvent'],
] as const;

function rowsFor(dataset: Dataset, table: string): Record<string, unknown>[] {
  switch (table) {
    case 'learners': return dataset.learners as unknown as Record<string, unknown>[];
    case 'courses': return dataset.courses as unknown as Record<string, unknown>[];
    case 'issuers': return dataset.issuers as unknown as Record<string, unknown>[];
    case 'credential_rules': return dataset.credentialRules as unknown as Record<string, unknown>[];
    case 'completion_records': return dataset.completionRecords as unknown as Record<string, unknown>[];
    case 'credentials': return dataset.credentials as unknown as Record<string, unknown>[];
    case 'verification_requests': return dataset.verificationRequests as unknown as Record<string, unknown>[];
    case 'revocations': return dataset.revocations as unknown as Record<string, unknown>[];
    case 'audit_events': return dataset.auditEvents as unknown as Record<string, unknown>[];
    default: throw new Error(`unknown table ${table}`);
  }
}

export interface ManifestEntry {
  file: string;
  rows: number;
  sha256: string;
}

export interface Manifest {
  generator: string;
  seed: number;
  scale: number;
  as_of: string;
  generated_with: string;
  command: string;
  provenance: string;
  targets: { learners: number; courses: number; credentials: number; verifications: number };
  files: ManifestEntry[];
}

export function writeDataset(dataset: Dataset, config: GeneratorConfig, outDir: string): Manifest {
  ensureDir(outDir);
  const csvDir = join(outDir, 'csv');
  const jsonDir = join(outDir, 'json');
  const sqlDir = join(outDir, 'sql');
  const files: ManifestEntry[] = [];

  for (const [table, prismaModel] of TABLES) {
    const rows = rowsFor(dataset, table);
    const columns = COLUMNS[table] as unknown as string[];

    const csvFile = join(csvDir, `${table}.csv`);
    writeCsv(csvFile, rows, columns);
    files.push({ file: `csv/${table}.csv`, rows: rows.length, sha256: sha256File(csvFile) });

    const jsonFile = join(jsonDir, `${table}.jsonl`);
    writeJsonl(jsonFile, rows);
    files.push({ file: `json/${table}.jsonl`, rows: rows.length, sha256: sha256File(jsonFile) });

    const sqlFile = join(sqlDir, `${table}.sql`);
    writeSqlSeed(sqlFile, prismaModel, rows, columns);
    files.push({ file: `sql/${table}.sql`, rows: rows.length, sha256: sha256File(sqlFile) });
  }

  // Step 7: ground truth lives apart from every feature file and is never joined into one.
  const gtCsv = join(outDir, 'ground_truth.csv');
  writeCsv(gtCsv, dataset.groundTruth as unknown as Record<string, unknown>[], COLUMNS.ground_truth as unknown as string[]);
  files.push({ file: 'ground_truth.csv', rows: dataset.groundTruth.length, sha256: sha256File(gtCsv) });

  const gtJson = join(outDir, 'ground_truth.json');
  writeJson(gtJson, dataset.groundTruth);
  files.push({ file: 'ground_truth.json', rows: dataset.groundTruth.length, sha256: sha256File(gtJson) });

  const manifest: Manifest = {
    generator: 'vericred-generator',
    seed: config.seed,
    scale: config.scale,
    as_of: config.asOf.toISOString(),
    generated_with: `node ${process.version}`,
    command: `npm run generate -- --seed ${config.seed} --scale ${config.scale}`,
    provenance:
      'Fully synthetic. No external dataset was downloaded, scraped or redistributed; no real personal data is present. Name and institution pools are invented (see src/generator/reference.ts).',
    targets: {
      learners: config.learners,
      courses: config.courses,
      credentials: config.credentials,
      verifications: config.verifications,
    },
    files: files.sort((a, b) => (a.file < b.file ? -1 : 1)),
  };

  writeJson(join(outDir, 'manifest.json'), manifest);
  return manifest;
}
