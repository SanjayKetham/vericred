import type { ReactNode } from 'react';

/** Shared presentational pieces. Status is always colour + glyph + word, never colour alone. */

export function Card({
  title,
  subtitle,
  children,
  actions,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card min-w-0 p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {subtitle && <p className="ink-muted mt-0.5 text-xs">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

const STATUS_STYLE: Record<string, { color: string; glyph: string }> = {
  VALID: { color: 'var(--status-good)', glyph: '✓' },
  ACTIVE: { color: 'var(--status-good)', glyph: '✓' },
  APPROVED: { color: 'var(--status-good)', glyph: '✓' },
  COMPLETED: { color: 'var(--status-good)', glyph: '✓' },
  PASS: { color: 'var(--status-good)', glyph: '✓' },
  EXPIRED: { color: 'var(--status-warning)', glyph: '◷' },
  IN_PROGRESS: { color: 'var(--status-warning)', glyph: '◷' },
  PENDING: { color: 'var(--status-warning)', glyph: '◷' },
  WITHDRAWN: { color: 'var(--status-serious)', glyph: '⊘' },
  SUPERSEDED: { color: 'var(--status-serious)', glyph: '⊘' },
  RESCINDED: { color: 'var(--status-serious)', glyph: '⊘' },
  REVOKED: { color: 'var(--status-critical)', glyph: '✕' },
  DENIED: { color: 'var(--status-critical)', glyph: '✕' },
  FAILED: { color: 'var(--status-critical)', glyph: '✕' },
  FAIL: { color: 'var(--status-critical)', glyph: '✕' },
};

export function StatusPill({ status }: { status: string }) {
  const key = status.startsWith('INVALID') ? 'REVOKED' : status;
  const style = STATUS_STYLE[key] ?? { color: 'var(--text-secondary)', glyph: '•' };
  return (
    <span className="pill" style={{ color: style.color }}>
      <span aria-hidden="true">{style.glyph}</span>
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

/** A hero number: when the job is one headline figure, a stat tile beats a chart. */
export function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="ink-muted text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      {hint && <p className="ink-muted mt-1 text-xs">{hint}</p>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="ink-secondary mb-1 block text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="ink-muted mt-1 block text-xs">{hint}</span>}
    </label>
  );
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: { children: ReactNode; variant?: 'primary' | 'ghost' | 'danger' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles =
    variant === 'primary'
      ? { background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'transparent' }
      : variant === 'danger'
        ? { background: 'var(--status-critical)', color: '#ffffff', borderColor: 'transparent' }
        : { background: 'var(--surface-1)', color: 'var(--text-secondary)', borderColor: 'var(--border-strong)' };
  return (
    <button
      {...props}
      style={styles}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function Banner({ kind, children }: { kind: 'good' | 'critical' | 'warning' | 'info'; children: ReactNode }) {
  const color =
    kind === 'good'
      ? 'var(--status-good)'
      : kind === 'critical'
        ? 'var(--status-critical)'
        : kind === 'warning'
          ? 'var(--status-warning)'
          : 'var(--accent)';
  const glyph = kind === 'good' ? '✓' : kind === 'critical' ? '✕' : kind === 'warning' ? '!' : 'i';
  return (
    <div className="card flex items-start gap-3 p-3 text-sm" style={{ borderColor: color }}>
      <span aria-hidden="true" className="mt-0.5 font-bold" style={{ color }}>
        {glyph}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <p role="status" className="ink-muted py-10 text-center text-sm">
      {label}…
    </p>
  );
}

export const fmtDate = (iso: string | null): string =>
  iso === null ? '—' : new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + 'Z';

export const short = (value: string, head = 10): string => (value.length <= head + 2 ? value : `${value.slice(0, head)}…`);
