import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from './shell';
import type { IconName } from '../nav';

/** Presentational kit shared by the role modules: KPI cards, record tables, empty and planned states. */

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  width?: string;
  render: (row: T) => ReactNode;
  /** Text used when exporting or searching; defaults to nothing. */
  value?: (row: T) => string | number;
}

export function RecordTable<T>({
  rows,
  columns,
  getKey,
  empty = 'Nothing to show.',
  pageSize = 15,
  onRowClick,
}: {
  rows: T[];
  columns: Column<T>[];
  getKey: (row: T, index: number) => string;
  empty?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
}) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  const visible = rows.slice((current - 1) * pageSize, current * pageSize);

  if (rows.length === 0) return <p className="ink-muted py-10 text-center text-sm">{empty}</p>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="ink-muted border-b text-left text-xs" style={{ borderColor: 'var(--border)' }}>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`py-2 pr-5 font-medium ${column.align === 'right' ? 'text-right' : ''}`}
                  style={column.width ? { width: column.width } : undefined}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr
                key={getKey(row, index)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b last:border-0 ${onRowClick ? 'cursor-pointer' : ''}`}
                style={{ borderColor: 'var(--border)' }}
              >
                {columns.map((column) => (
                  <td key={column.key} className={`py-2 pr-5 align-top ${column.align === 'right' ? 'text-right' : ''}`}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="ink-muted">
            {rows.length.toLocaleString()} rows · page {current} of {pages}
          </span>
          <div className="flex gap-2">
            <PagerButton disabled={current <= 1} onClick={() => setPage(current - 1)}>
              Previous
            </PagerButton>
            <PagerButton disabled={current >= pages} onClick={() => setPage(current + 1)}>
              Next
            </PagerButton>
          </div>
        </div>
      )}
    </div>
  );
}

function PagerButton({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border px-2.5 py-1 font-medium disabled:opacity-40"
      style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)', background: 'var(--surface-1)' }}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------- KPI cards */

export interface Kpi {
  label: string;
  value: string | number;
  hint?: string;
  icon?: IconName;
  tone?: 'default' | 'good' | 'warning' | 'critical';
}

const TONE: Record<NonNullable<Kpi['tone']>, string> = {
  default: 'var(--accent)',
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
};

export function KpiRow({ items }: { items: Kpi[] }) {
  // auto-fit rather than a fixed column count: four tiles fill one row, six wrap evenly, and no
  // layout leaves a single orphan card on a line of its own.
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
      {items.map((item) => (
        <div key={item.label} className="card p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="ink-muted text-[11px] font-semibold uppercase tracking-wide">{item.label}</p>
            {item.icon && (
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ background: 'var(--accent-soft)', color: TONE[item.tone ?? 'default'] }}
              >
                <Icon name={item.icon} className="h-4 w-4" />
              </span>
            )}
          </div>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums" style={{ color: TONE[item.tone ?? 'default'] }}>
            {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
          </p>
          {item.hint && <p className="ink-muted mt-1 text-xs">{item.hint}</p>}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- filtering */

/** Client-side filter over already-loaded rows. */
export function useFilter<T>(rows: T[], needle: string, text: (row: T) => string): T[] {
  return useMemo(() => {
    const query = needle.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => text(row).toLowerCase().includes(query));
  }, [rows, needle, text]);
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3">{children}</div>;
}

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="ink-secondary mb-1 block text-xs font-medium">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="px-3 py-2 text-sm">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Copy-to-clipboard for an identifier or a link. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
      className="rounded-lg border px-2.5 py-1 text-xs font-semibold"
      style={{ borderColor: 'var(--border-strong)', color: copied ? 'var(--status-good)' : 'var(--text-secondary)' }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/** Builds a CSV from the table's own columns so an export always matches what is on screen. */
export function downloadCsv<T>(filename: string, rows: T[], columns: Column<T>[]): void {
  const usable = columns.filter((c) => c.value);
  const header = usable.map((c) => c.label).join(',');
  const escape = (raw: string | number) => {
    const text = String(raw ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = rows.map((row) => usable.map((c) => escape(c.value!(row))).join(',')).join('\n');
  const blob = new Blob([`${header}\n${body}\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
