import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** CSV / JSON / SQL writers with stable field ordering so checksums are comparable across runs. */

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: (keyof T & string)[]): string {
  const out: string[] = [columns.join(',')];
  for (const row of rows) out.push(columns.map((c) => csvCell(row[c])).join(','));
  return out.join('\n') + '\n';
}

export function writeCsv<T extends Record<string, unknown>>(
  file: string,
  rows: T[],
  columns: (keyof T & string)[],
): void {
  ensureDir(dirname(file));
  writeFileSync(file, toCsv(rows, columns), 'utf8');
}

export function writeJson(file: string, value: unknown): void {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** Newline-delimited JSON for the large tables — streams cleanly into other tools. */
export function writeJsonl(file: string, rows: unknown[]): void {
  ensureDir(dirname(file));
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `'${s.replace(/'/g, "''")}'`;
}

/** Batched multi-row INSERTs — a seed file Postgres can ingest directly. */
export function writeSqlSeed<T extends Record<string, unknown>>(
  file: string,
  table: string,
  rows: T[],
  columns: (keyof T & string)[],
  batchSize = 500,
): void {
  ensureDir(dirname(file));
  const parts: string[] = [`-- ${table}: ${rows.length} rows`];
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = batch.map((r) => `(${columns.map((c) => sqlLiteral(r[c])).join(',')})`).join(',\n  ');
    parts.push(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES\n  ${values};`);
  }
  writeFileSync(file, parts.join('\n\n') + '\n', 'utf8');
}

export function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function readCsv(file: string): Record<string, string>[] {
  const text = readFileSync(file, 'utf8');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const header = rows.shift();
  if (!header) return [];
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export const dataPath = (...segments: string[]): string =>
  join(process.cwd(), '..', 'data', ...segments);
