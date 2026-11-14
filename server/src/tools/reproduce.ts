import { join } from 'node:path';
import { generateDataset, resolveConfig } from '../generator/generate.js';
import { writeDataset, type Manifest } from '../generator/writer.js';
import { DEFAULT_SEED } from '../lib/deterministic.js';
import { writeJson } from '../lib/io.js';

/**
 * Step 10 — regenerate twice with the same seed and compare row counts and SHA-256 checksums.
 *
 * Both runs write to separate directories (data/run-a, data/run-b) so the comparison is over real files
 * on disk, not over in-memory objects. Usage: npm run reproduce [-- --scale 0.05]
 */

const argv = process.argv.slice(2);
const get = (flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const seed = Number(get('--seed') ?? DEFAULT_SEED);
const scale = Number(get('--scale') ?? 1);
const baseDir = get('--dir') ?? join(process.cwd(), '..', 'data');

function runOnce(label: string): { manifest: Manifest; dir: string; elapsedMs: number } {
  const dir = join(baseDir, label);
  const started = Date.now();
  const config = resolveConfig(seed, scale);
  const dataset = generateDataset(config);
  const manifest = writeDataset(dataset, config, dir);
  return { manifest, dir, elapsedMs: Date.now() - started };
}

console.log(`\nReproducibility proof — seed ${seed}, scale ${scale}`);
const runA = runOnce('run-a');
console.log(`  run-a written to ${runA.dir} (${(runA.elapsedMs / 1000).toFixed(1)}s)`);
const runB = runOnce('run-b');
console.log(`  run-b written to ${runB.dir} (${(runB.elapsedMs / 1000).toFixed(1)}s)`);

const byFileA = new Map(runA.manifest.files.map((f) => [f.file, f]));
const byFileB = new Map(runB.manifest.files.map((f) => [f.file, f]));
const allFiles = [...new Set([...byFileA.keys(), ...byFileB.keys()])].sort();

interface Comparison {
  file: string;
  rows_a: number | null;
  rows_b: number | null;
  sha256_a: string | null;
  sha256_b: string | null;
  identical: boolean;
}

const comparisons: Comparison[] = allFiles.map((file) => {
  const a = byFileA.get(file) ?? null;
  const b = byFileB.get(file) ?? null;
  return {
    file,
    rows_a: a?.rows ?? null,
    rows_b: b?.rows ?? null,
    sha256_a: a?.sha256 ?? null,
    sha256_b: b?.sha256 ?? null,
    identical: a !== null && b !== null && a.rows === b.rows && a.sha256 === b.sha256,
  };
});

const mismatches = comparisons.filter((c) => !c.identical);

console.log('\n  FILE                                   ROWS A    ROWS B   CHECKSUM');
for (const c of comparisons) {
  console.log(
    `  ${c.file.padEnd(36)} ${String(c.rows_a ?? '-').padStart(8)}  ${String(c.rows_b ?? '-').padStart(8)}   ` +
      `${c.identical ? 'identical ' + (c.sha256_a ?? '').slice(0, 12) + '…' : 'DIFFERS'}`,
  );
}

const report = {
  seed,
  scale,
  generated_with: `node ${process.version}`,
  compared_at: new Date().toISOString(),
  files_compared: comparisons.length,
  files_identical: comparisons.length - mismatches.length,
  reproducible: mismatches.length === 0,
  mismatches,
  comparisons,
};

writeJson(join(baseDir, 'reproducibility-report.json'), report);

console.log(
  `\n  ${comparisons.length - mismatches.length}/${comparisons.length} files byte-identical across runs.`,
);
console.log(`  Report: ${join(baseDir, 'reproducibility-report.json')}\n`);

process.exit(mismatches.length === 0 ? 0 : 1);
