import { join } from 'node:path';
import { DEFAULT_SEED } from '../lib/deterministic.js';
import { generateDataset, resolveConfig } from './generate.js';
import { writeDataset } from './writer.js';

/**
 * Usage:
 *   npm run generate                              full baseline (20k / 1k / 10k / 5k)
 *   npm run generate -- --scale 0.05              starter dataset, same generator, same seed
 *   npm run generate -- --seed 20261022 --out ../data/run-a
 */

interface Args {
  seed: number;
  scale: number;
  out: string;
  quiet: boolean;
}

export function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const seed = Number(get('--seed') ?? DEFAULT_SEED);
  // SEED_SCALE lets a deployment shrink the dataset without a shell-specific default in the command.
  const scale = Number(get('--scale') ?? process.env.SEED_SCALE ?? 1);
  if (!Number.isFinite(seed)) throw new Error('--seed must be a number');
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('--scale must be a positive number');
  return {
    seed,
    scale,
    out: get('--out') ?? join(process.cwd(), '..', 'data'),
    quiet: argv.includes('--quiet'),
  };
}

export function runGenerate(argv: string[]) {
  const args = parseArgs(argv);
  const config = resolveConfig(args.seed, args.scale);
  const started = Date.now();

  const dataset = generateDataset(config);
  const manifest = writeDataset(dataset, config, args.out);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!args.quiet) {
    const stats = dataset.__stats;
    console.log(`\nVeriCred synthetic dataset — seed ${config.seed}, scale ${config.scale}`);
    console.log(`Output: ${args.out}  (${elapsed}s)\n`);
    const table = [
      ['Learner', dataset.learners.length],
      ['Course', dataset.courses.length],
      ['Issuer', dataset.issuers.length],
      ['CredentialRule', dataset.credentialRules.length],
      ['CompletionRecord', dataset.completionRecords.length],
      ['Credential', dataset.credentials.length],
      ['VerificationRequest', dataset.verificationRequests.length],
      ['Revocation', dataset.revocations.length],
      ['AuditEvent', dataset.auditEvents.length],
      ['GroundTruth', dataset.groundTruth.length],
    ] as const;
    for (const [name, count] of table) {
      console.log(`  ${name.padEnd(22)} ${String(count).padStart(8)}`);
    }
    if (stats) {
      console.log(
        `\n  Issuance: ${stats.approvedTotal} approved, ${stats.deniedTotal} denied, ` +
          `${stats.issuanceBacklog} approved-but-not-yet-issued (backlog).`,
      );
    }
    const byType = new Map<string, number>();
    for (const row of dataset.groundTruth) byType.set(row.issue_type, (byType.get(row.issue_type) ?? 0) + 1);
    console.log('\n  Labelled edge cases:');
    for (const [type, count] of [...byType].sort()) console.log(`    ${type.padEnd(40)} ${count}`);
    console.log(`\n  manifest.json lists ${manifest.files.length} files with SHA-256 checksums.\n`);
  }

  return { dataset, manifest, config };
}

runGenerate(process.argv.slice(2));
