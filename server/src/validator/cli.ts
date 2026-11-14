import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, writeJson } from '../lib/io.js';
import { detectAnomalies, loadDataset, profile, runChecks, scoreDetections } from './validate.js';

/**
 * Step 8 validation + Step 7 detection scoring.
 *
 * Exit code 1 if any check records an *unexpected* violation. Violations explained by a labelled edge
 * case are expected by design: the dataset is supposed to contain them, and silently "passing" by
 * omitting them would defeat the exercise.
 *
 * Usage: npm run validate [-- --dir ../data] [--json]
 */

const argv = process.argv.slice(2);
const get = (flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dir = get('--dir') ?? join(process.cwd(), '..', 'data');

const data = loadDataset(dir);
const checks = runChecks(data);
const detections = detectAnomalies(data);
const metrics = scoreDetections(detections, data.groundTruth);
const stats = profile(data);

const totalUnexpected = checks.reduce((sum, c) => sum + c.unexpected, 0);
const totalExpected = checks.reduce((sum, c) => sum + c.violations.filter((v) => v.expected).length, 0);

const summary = {
  dataset_dir: dir,
  validated_at: new Date().toISOString(),
  checks: checks.map((c) => ({
    id: c.id,
    category: c.category,
    description: c.description,
    rows_checked: c.checked,
    violations_total: c.violations.length,
    violations_expected_by_label: c.violations.filter((v) => v.expected).length,
    violations_unexpected: c.unexpected,
    status: c.passed ? 'PASS' : 'FAIL',
    sample: c.violations.filter((v) => !v.expected).slice(0, 5),
  })),
  totals: {
    checks_run: checks.length,
    checks_passed: checks.filter((c) => c.passed).length,
    violations_unexpected: totalUnexpected,
    violations_expected_by_label: totalExpected,
  },
  anomaly_detection: {
    per_issue_type: metrics.perType,
    overall: metrics.overall,
    detections_sample: detections.slice(0, 10),
  },
  profile: stats,
};

writeJson(join(dir, 'validation-summary.json'), summary);

/* A human-readable twin of the JSON, written into docs/ so the repository always carries the
   evidence for the run that produced the current dataset. */
// Documents are committed to the repo and read anywhere, so number formatting is pinned rather than
// taken from the machine's locale.
const n = (value: number) => value.toLocaleString('en-US');
const md: string[] = [
  '# Validation summary (Step 8)',
  '',
  `Generated ${summary.validated_at} from \`${dir}\`. Re-create with \`npm run validate\`.`,
  '',
  `**${checks.filter((c) => c.passed).length}/${checks.length} checks pass. ${totalUnexpected} unexpected violations.**`,
  '',
  'A violation is "expected" when a row in `ground_truth.csv` explains it: the dataset is *supposed* to',
  'contain those four edge cases, so the acceptance bar is zero *unexpected* violations, not zero violations.',
  '',
  '## Checks',
  '',
  '| ID | Category | Rows checked | Unexpected | Expected (labelled) | Status | Description |',
  '|---|---|---:|---:|---:|---|---|',
  ...checks.map(
    (c) =>
      `| ${c.id} | ${c.category} | ${n(c.checked)} | ${c.unexpected} | ${c.violations.filter((v) => v.expected).length} | ${c.passed ? 'PASS' : 'FAIL'} | ${c.description} |`,
  ),
  '',
  '## Anomaly detection against ground truth',
  '',
  'Detectors read only the feature files. `ground_truth.csv` is opened afterwards purely to score them.',
  '',
  '| Issue type | Expected | Detected | TP | FP | FN | Precision | Recall | F1 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...metrics.perType.map(
    (m) =>
      `| ${m.issue_type} | ${m.expected} | ${m.detected} | ${m.true_positives} | ${m.false_positives} | ${m.false_negatives} | ${m.precision.toFixed(3)} | ${m.recall.toFixed(3)} | ${m.f1.toFixed(3)} |`,
  ),
  `| **OVERALL** | ${metrics.overall.expected} | ${metrics.overall.detected} | ${metrics.overall.true_positives} | ${metrics.overall.false_positives} | ${metrics.overall.false_negatives} | ${metrics.overall.precision.toFixed(3)} | ${metrics.overall.recall.toFixed(3)} | ${metrics.overall.f1.toFixed(3)} |`,
  '',
  '## Row counts',
  '',
  '| Table | Rows |',
  '|---|---:|',
  ...Object.entries(stats.row_counts).map(([k, v]) => `| ${k} | ${n(v)} |`),
  '',
  '## Distributions',
  '',
  '```json',
  JSON.stringify(
    {
      completion_status: stats.completion_status,
      credential_status: stats.credential_status,
      verification_result: stats.verification_result,
      identity_match_method: stats.identity_match_method,
      revocation_reason: stats.revocation_reason,
      overall_score_distribution: stats.overall_score_distribution,
      identity_coverage: stats.identity_coverage,
      issuer_changes: stats.issuer_changes,
      incomplete_courses: stats.incomplete_courses,
    },
    null,
    2,
  ),
  '```',
  '',
];
const docsDir = join(process.cwd(), '..', 'docs');
ensureDir(docsDir);
writeFileSync(join(docsDir, 'validation-summary.md'), md.join(String.fromCharCode(10)), 'utf8');

if (argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`\nVeriCred validation — ${dir}\n`);
  console.log('  CHECK   STATUS   CHECKED   UNEXPECTED   EXPECTED(labelled)   DESCRIPTION');
  for (const c of checks) {
    console.log(
      `  ${c.id.padEnd(7)} ${(c.passed ? 'PASS' : 'FAIL').padEnd(8)} ${String(c.checked).padStart(7)}   ` +
        `${String(c.unexpected).padStart(10)}   ${String(c.violations.filter((v) => v.expected).length).padStart(18)}   ${c.description}`,
    );
    if (!c.passed) {
      for (const v of c.violations.filter((x) => !x.expected).slice(0, 3)) {
        console.log(`            ↳ ${v.record_type} ${v.record_id}: ${v.detail}`);
      }
    }
  }

  console.log('\n  Anomaly detection vs ground_truth.csv (ground truth read only for scoring):');
  console.log('    ISSUE TYPE                                EXP  DET   TP  FP  FN   PREC   REC    F1');
  for (const m of metrics.perType) {
    console.log(
      `    ${m.issue_type.padEnd(40)} ${String(m.expected).padStart(3)}  ${String(m.detected).padStart(3)}  ` +
        `${String(m.true_positives).padStart(3)} ${String(m.false_positives).padStart(3)} ${String(m.false_negatives).padStart(3)}  ` +
        `${m.precision.toFixed(3)}  ${m.recall.toFixed(3)}  ${m.f1.toFixed(3)}`,
    );
  }
  const o = metrics.overall;
  console.log(
    `    ${'OVERALL'.padEnd(40)} ${String(o.expected).padStart(3)}  ${String(o.detected).padStart(3)}  ` +
      `${String(o.true_positives).padStart(3)} ${String(o.false_positives).padStart(3)} ${String(o.false_negatives).padStart(3)}  ` +
      `${o.precision.toFixed(3)}  ${o.recall.toFixed(3)}  ${o.f1.toFixed(3)}`,
  );

  console.log(`\n  Checks passed: ${checks.filter((c) => c.passed).length}/${checks.length}`);
  console.log(`  Unexpected violations: ${totalUnexpected}`);
  console.log(`  Violations explained by a labelled edge case: ${totalExpected}`);
  console.log(`  Written: ${join(dir, 'validation-summary.json')}\n`);
}

process.exit(totalUnexpected === 0 ? 0 : 1);
