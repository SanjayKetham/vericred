import { useEffect, useState } from 'react';
import { api, ApiError, type VerifyResponse } from '../lib/api';
import { Icon } from '../components/shell';

/**
 * Public landing page.
 *
 * The single most useful thing a stranger can do here is check a credential, so verification is on
 * the page itself rather than behind a link — no account, no navigation. Everything else explains how
 * the guarantee is produced.
 */

interface PublicStats {
  credentials_issued: number;
  verifications_performed: number;
  learners: number;
  courses: number;
  issuers: number;
  validity_rate: number;
  median_response_ms: number;
  as_of: string;
}

export function LandingPage({
  onSignIn,
  onRegister,
  theme,
  onTheme,
}: {
  onSignIn: () => void;
  onRegister: () => void;
  theme: 'light' | 'dark';
  onTheme: () => void;
}) {
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    api<PublicStats>('/api/public/stats').then(setStats).catch(() => setStats(null));
  }, []);

  return (
    <div className="min-h-screen">
      <SiteHeader onSignIn={onSignIn} onRegister={onRegister} theme={theme} onTheme={onTheme} />

      <main>
        <Hero stats={stats} onRegister={onRegister} />
        <HowItWorks />
        <Trust />
        <Roles />
        <CallToAction onSignIn={onSignIn} onRegister={onRegister} />
      </main>

      <SiteFooter stats={stats} />
    </div>
  );
}

/* --------------------------------------------------------------- header */

function SiteHeader({
  onSignIn,
  onRegister,
  theme,
  onTheme,
}: {
  onSignIn: () => void;
  onRegister: () => void;
  theme: 'light' | 'dark';
  onTheme: () => void;
}) {
  const links = [
    ['verify', 'Verify'],
    ['how', 'How it works'],
    ['trust', 'Security'],
    ['roles', 'Who uses it'],
  ] as const;

  return (
    <header
      className="sticky top-0 z-20 border-b backdrop-blur"
      style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--plane) 88%, transparent)' }}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3.5">
        <a href="#top" className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          >
            <Icon name="logo" className="h-5 w-5" />
          </span>
          <span className="text-[17px] font-semibold tracking-tight">VeriCred</span>
        </a>

        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Sections">
          {links.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="ink-secondary rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-80"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="ink-secondary flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="h-4 w-4" />
          </button>
          <button
            onClick={onSignIn}
            className="ink-secondary rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ border: '1px solid var(--border-strong)' }}
          >
            Sign in
          </button>
          <button
            onClick={onRegister}
            className="rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          >
            Create account
          </button>
        </div>
      </div>
    </header>
  );
}

/* ----------------------------------------------------------------- hero */

function Hero({ stats, onRegister }: { stats: PublicStats | null; onRegister: () => void }) {
  return (
    <section id="top" className="mx-auto max-w-6xl px-5 pb-12 pt-14">
      <div className="grid gap-10 lg:grid-cols-[1.05fr_minmax(0,1fr)] lg:items-start">
        <div>
          <span
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <span aria-hidden="true">●</span> Issuance · Verification · Revocation
          </span>

          <h1 className="mt-4 text-[40px] font-semibold leading-[1.1] tracking-tight sm:text-[46px]">
            Credentials that can be <span style={{ color: 'var(--accent)' }}>checked</span>, not just claimed.
          </h1>

          <p className="ink-secondary mt-4 max-w-xl text-base leading-relaxed">
            VeriCred issues a certificate only after every completion requirement passes, seals it with a SHA-256 hash
            and an Ed25519 signature, and keeps an append-only record of everything that happens to it afterwards.
            Anyone can verify one in a second — without an account.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="#verify"
              className="rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            >
              Verify a credential
            </a>
            <button
              onClick={onRegister}
              className="ink-secondary rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ border: '1px solid var(--border-strong)', background: 'var(--surface-1)' }}
            >
              Create a learner account
            </button>
          </div>

          {stats && (
            <dl className="mt-9 grid max-w-lg grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
              {[
                ['Credentials issued', stats.credentials_issued.toLocaleString()],
                ['Verifications', stats.verifications_performed.toLocaleString()],
                ['Issuing bodies', String(stats.issuers)],
                ['Median check', `${stats.median_response_ms} ms`],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  {/* Reserve two lines so a label that wraps does not push its value out of line. */}
                  <dt className="ink-muted min-h-[2.4em] text-[11px] font-semibold uppercase leading-[1.2] tracking-wide">
                    {label}
                  </dt>
                  <dd className="mt-auto text-xl font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <QuickVerify />
      </div>
    </section>
  );
}

/* --------------------------------------------------------- verify panel */

const RESULT_COPY: Record<string, { tone: 'good' | 'critical' | 'warning'; headline: string; detail: string }> = {
  VALID: { tone: 'good', headline: 'Valid credential', detail: 'The issuer signature verifies, the record is intact, and no revocation is in force.' },
  INVALID_NOT_FOUND: { tone: 'critical', headline: 'No such credential', detail: 'That reference does not match anything this platform has issued.' },
  INVALID_REVOKED: { tone: 'critical', headline: 'Revoked', detail: 'This credential was issued but has since been withdrawn by its issuer.' },
  INVALID_EXPIRED: { tone: 'warning', headline: 'Expired', detail: 'Validly issued, but past its expiry date.' },
  INVALID_HASH_MISMATCH: { tone: 'critical', headline: 'Does not match its seal', detail: 'The record presented is not the one the issuer signed. Treat it as altered.' },
  INVALID_IDENTITY_MISMATCH: { tone: 'critical', headline: 'Identity not confirmed', detail: 'The identity evidence is too weak. A name alone is never sufficient.' },
};

function QuickVerify() {
  const [reference, setReference] = useState('');
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A code arriving in a shared link pre-fills the box.
  useEffect(() => {
    const shared = new URLSearchParams(window.location.search).get('verify');
    if (shared) setReference(shared);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await api<VerifyResponse>('/api/verify', {
          method: 'POST',
          body: JSON.stringify({ reference: reference.trim(), verifier_name: 'Website visitor', verifier_type: 'INDIVIDUAL' }),
        }),
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reach the verification service.');
    } finally {
      setBusy(false);
    }
  }

  const copy = result ? RESULT_COPY[result.result] : null;
  const toneColor =
    copy?.tone === 'good' ? 'var(--status-good)' : copy?.tone === 'warning' ? 'var(--status-warning)' : 'var(--status-critical)';

  return (
    <div id="verify" className="card scroll-mt-20 p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <Icon name="verify" className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Check a credential</h2>
          <p className="ink-muted text-xs">No account needed</p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-4 space-y-3">
        <label className="block">
          <span className="ink-secondary mb-1.5 block text-xs font-semibold">Credential ID or verification code</span>
          <input
            required
            minLength={3}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="CRD-2026-000001"
            className="mono w-full px-3 py-2.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy || reference.trim().length < 3}
          className="w-full rounded-lg px-3 py-2.5 text-sm font-semibold disabled:opacity-60"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          {busy ? 'Checking…' : 'Verify'}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-lg px-3 py-2 text-xs font-medium" style={{ background: 'var(--surface-2)', color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}

      {result && copy && (
        <div className="mt-4 rounded-xl p-4" style={{ background: 'var(--surface-2)', border: `1px solid ${toneColor}` }}>
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: toneColor }}>
            <span aria-hidden="true">{copy.tone === 'good' ? '✓' : copy.tone === 'warning' ? '!' : '✕'}</span>
            {copy.headline}
          </p>
          <p className="ink-secondary mt-1 text-xs">{copy.detail}</p>

          {result.credential && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="ink-muted">Awarded to</dt>
                <dd className="font-medium">{result.credential.subject_name}</dd>
              </div>
              <div>
                <dt className="ink-muted">Issued</dt>
                <dd>{result.credential.issued_at.slice(0, 10)}</dd>
              </div>
            </dl>
          )}

          <ul className="mt-3 space-y-1">
            {result.checks.map((check) => (
              <li key={check.criterion} className="flex items-center gap-2 text-[11px]">
                <span aria-hidden="true" style={{ color: check.passed ? 'var(--status-good)' : 'var(--status-critical)' }}>
                  {check.passed ? '✓' : '✕'}
                </span>
                <span className="ink-secondary">{check.criterion.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
          <p className="ink-muted mt-2 text-[11px]">Checked in {result.latency_ms} ms</p>
        </div>
      )}

      {!result && !error && (
        <p className="ink-muted mt-3 text-xs">
          Every check that produced the answer is shown, so you can see <em>why</em> a credential is or is not valid.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------- how it works */

const STEPS: { icon: 'records' | 'eligibility' | 'key' | 'verify'; title: string; detail: string }[] = [
  { icon: 'records', title: 'Complete the course', detail: 'Attendance, modules and assessments are recorded as the learner progresses. Status is derived from those facts, never set by hand.' },
  { icon: 'eligibility', title: 'Rules are evaluated', detail: 'Every criterion in the course rule is checked and the result kept — including which one failed. No credential is minted on a failed requirement.' },
  { icon: 'key', title: 'The record is sealed', detail: 'The credential is hashed with SHA-256 over a canonical form and signed with the issuer’s Ed25519 key, so any later edit is detectable.' },
  { icon: 'verify', title: 'Anyone can verify', detail: 'A third party presents the ID or code. The hash is recomputed, the signature checked and revocations replayed as of that moment.' },
];

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-16 border-t py-16" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeading
          eyebrow="How it works"
          title="From coursework to a credential a stranger can trust"
          lead="Four steps, each leaving a record. Nothing in the chain depends on taking someone's word for it."
        />

        <ol className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative rounded-2xl p-5" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
                >
                  <Icon name={step.icon} className="h-5 w-5" />
                </span>
                <span className="ink-muted text-xs font-bold tabular-nums">STEP {index + 1}</span>
              </div>
              <h3 className="mt-3 text-sm font-semibold">{step.title}</h3>
              <p className="ink-secondary mt-1.5 text-xs leading-relaxed">{step.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- trust */

const GUARANTEES: { icon: 'key' | 'revoke' | 'shield' | 'audit'; title: string; detail: string }[] = [
  {
    icon: 'key',
    title: 'Tamper-evident by construction',
    detail: 'The stored record is re-hashed on every verification and compared to what the issuer signed. An altered payload fails the check even if its stored hash was left untouched.',
  },
  {
    icon: 'revoke',
    title: 'Revocation that is always current',
    detail: 'Status is replayed from an append-only sequence of events rather than cached in a flag — and a revocation filed today never retroactively invalidates a check made last year.',
  },
  {
    icon: 'shield',
    title: 'A name is never an identity',
    detail: 'Thousands of learners share a display name. Verification keys on the credential ID, its verification code or a one-way national-ID hash; a name-only match can never return valid.',
  },
  {
    icon: 'audit',
    title: 'History is never rewritten',
    detail: 'Every state change is a new event, hash-chained to the one before it. Correcting a mistake adds a record; it does not erase one.',
  },
];

function Trust() {
  return (
    <section id="trust" className="scroll-mt-16 py-16">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeading
          eyebrow="Security"
          title="Why the answer can be relied on"
          lead="Each guarantee is enforced in code on every request, not asserted in a policy document."
        />

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {GUARANTEES.map((item) => (
            <article key={item.title} className="card p-5">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-3 text-sm font-semibold">{item.title}</h3>
              <p className="ink-secondary mt-1.5 text-sm leading-relaxed">{item.detail}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- roles */

const ROLE_CARDS: { icon: 'profile' | 'assessment' | 'issue' | 'support' | 'settings'; title: string; detail: string }[] = [
  { icon: 'profile', title: 'Learners', detail: 'See course progress against each requirement, download certificates and share a public verification link or QR code.' },
  { icon: 'assessment', title: 'Instructors', detail: 'Track attendance, assessments and completion records, and preview exactly which learners satisfy their credential rule.' },
  { icon: 'issue', title: 'Academic administrators', detail: 'Configure rules, issue and revoke credentials, manage issuers and export the registry.' },
  { icon: 'support', title: 'Support staff', detail: 'Look learners up by identifier, investigate failed verifications and explain revocations.' },
  { icon: 'settings', title: 'Platform administrators', detail: 'Manage accounts and roles, rotate signing keys, and watch security and anomaly signals.' },
];

function Roles() {
  return (
    <section id="roles" className="scroll-mt-16 border-t py-16" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeading
          eyebrow="Who uses it"
          title="One record, five jobs"
          lead="Each role gets only what its work needs. The boundaries are enforced by the API, not by hiding menus."
        />

        <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {ROLE_CARDS.map((role) => (
            <article key={role.title} className="rounded-2xl p-5" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <Icon name={role.icon} className="h-[18px] w-[18px]" />
                </span>
                <h3 className="text-sm font-semibold">{role.title}</h3>
              </div>
              <p className="ink-secondary mt-2.5 text-sm leading-relaxed">{role.detail}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ CTA */

function CallToAction({ onSignIn, onRegister }: { onSignIn: () => void; onRegister: () => void }) {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="rounded-3xl px-6 py-12 text-center" style={{ background: 'var(--hero)', color: 'var(--on-accent)' }}>
        <h2 className="text-2xl font-semibold tracking-tight">Try it with a demo account</h2>
        <p className="mx-auto mt-2.5 max-w-xl text-sm opacity-90">
          Five roles are ready to sign in to, each with its own dashboard. Or create a learner account and link it to an
          existing record.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            onClick={onSignIn}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold"
            style={{ background: 'var(--on-accent)', color: 'var(--hero)' }}
          >
            Sign in
          </button>
          <button
            onClick={onRegister}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold"
            style={{ border: '1px solid rgba(255,255,255,0.45)', color: 'var(--on-accent)' }}
          >
            Create account
          </button>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- footer */

function SiteFooter({ stats }: { stats: PublicStats | null }) {
  return (
    <footer className="border-t py-10" style={{ borderColor: 'var(--border)' }}>
      <div className="mx-auto max-w-6xl px-5">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
              >
                <Icon name="logo" className="h-4 w-4" />
              </span>
              <span className="font-semibold tracking-tight">VeriCred</span>
            </div>
            <p className="ink-muted mt-3 text-xs leading-relaxed">
              A demonstration platform for credential issuance, verification and revocation. Every learner, course and
              certificate here is synthetic — no external dataset was used and no real personal information is present.
            </p>
          </div>

          {stats && (
            <dl className="grid grid-cols-2 gap-x-10 gap-y-3 text-xs sm:grid-cols-3">
              {[
                ['Learners', stats.learners.toLocaleString()],
                ['Courses', stats.courses.toLocaleString()],
                ['Credentials', stats.credentials_issued.toLocaleString()],
                ['Verifications', stats.verifications_performed.toLocaleString()],
                ['Verify as valid', `${stats.validity_rate}%`],
                ['Data as of', stats.as_of.slice(0, 10)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="ink-muted">{label}</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <p className="ink-muted mt-8 border-t pt-5 text-[11px]" style={{ borderColor: 'var(--border)' }}>
          Built for the AI Forward Deployed Engineer hackathon. Deterministic synthetic data, fixed seed 20261022.
        </p>
      </div>
    </footer>
  );
}

function SectionHeading({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
        {eyebrow}
      </p>
      <h2 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight">{title}</h2>
      <p className="ink-secondary mt-2.5 text-sm leading-relaxed">{lead}</p>
    </div>
  );
}
