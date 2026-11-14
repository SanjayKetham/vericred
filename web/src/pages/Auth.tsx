import { useState } from 'react';
import { api, ApiError, setSession, type AuthUser } from '../lib/api';

/**
 * Sign in and registration.
 *
 * Registration creates a LEARNER account only — the role is decided by the server, never by the form,
 * because letting a visitor pick their own role would hand out issuance and revocation rights to
 * anyone who can reach the page. Staff accounts are created by a platform administrator.
 */

const DEMO_ACCOUNTS: { email: string; role: string; blurb: string }[] = [
  { email: 'learner@vericred.example', role: 'Learner', blurb: 'Courses, progress and their own certificates' },
  { email: 'instructor@vericred.example', role: 'Instructor', blurb: 'Assigned courses, grades, eligibility' },
  { email: 'registrar@vericred.example', role: 'Academic admin', blurb: 'Issue, revoke, registry, reports' },
  { email: 'support@vericred.example', role: 'Support', blurb: 'Tickets, lookups, failed verifications' },
  { email: 'admin@vericred.example', role: 'Platform admin', blurb: 'Users, keys, anomalies, system health' },
];

const DEMO_PASSWORD = 'vericred2026';

export function AuthPage({
  mode,
  onMode,
  onSignedIn,
  onVerify,
  onBack,
}: {
  mode: 'signin' | 'register';
  onMode: (mode: 'signin' | 'register') => void;
  onSignedIn: (user: AuthUser) => void;
  onVerify: () => void;
  onBack: () => void;
}) {

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <aside className="relative hidden flex-col justify-between p-10 lg:flex" style={{ background: 'var(--sidebar)' }}>
        <button onClick={onBack} className="flex items-center gap-2.5">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl text-base font-bold"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            aria-hidden="true"
          >
            V
          </span>
          <span className="text-lg font-semibold tracking-tight" style={{ color: 'var(--sidebar-ink-strong)' }}>
            VeriCred
          </span>
        </button>

        <div className="max-w-md">
          <h2 className="text-[28px] font-semibold leading-tight" style={{ color: 'var(--sidebar-ink-strong)' }}>
            Credentials that can be checked, not just claimed.
          </h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--sidebar-ink)' }}>
            Every certificate is issued only after its completion rules pass, sealed with a SHA-256 hash and an
            Ed25519 signature, and recorded in an append-only audit trail. Anyone can verify one without an account.
          </p>

          <ul className="mt-8 space-y-3">
            {[
              ['Rule-gated issuance', 'A credential is never minted on a failed requirement.'],
              ['Revocation that stays current', 'Status is replayed from events, never a mutable flag.'],
              ['Public verification', 'Third parties check a credential without signing in.'],
            ].map(([title, detail]) => (
              <li key={title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                  style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
                >
                  ✓
                </span>
                <span className="text-sm" style={{ color: 'var(--sidebar-ink)' }}>
                  <span className="font-semibold" style={{ color: 'var(--sidebar-ink-strong)' }}>
                    {title}.
                  </span>{' '}
                  {detail}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs" style={{ color: 'var(--sidebar-ink)' }}>
          Fully synthetic data. No real personal information.
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[420px]">
          <button onClick={onBack} className="ink-secondary mb-5 text-xs font-semibold">
            &larr; Back to home
          </button>

          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
              aria-hidden="true"
            >
              V
            </span>
            <span className="text-lg font-semibold tracking-tight">VeriCred</span>
          </div>

          <div className="mb-6 flex rounded-xl p-1" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            {(['signin', 'register'] as const).map((option) => (
              <button
                key={option}
                onClick={() => onMode(option)}
                aria-pressed={mode === option}
                className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
                style={
                  mode === option
                    ? { background: 'var(--surface-1)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-card)' }
                    : { background: 'transparent', color: 'var(--text-secondary)' }
                }
              >
                {option === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          {mode === 'signin' ? <SignInForm onSignedIn={onSignedIn} /> : <RegisterForm onSignedIn={onSignedIn} />}

          <p className="ink-muted mt-6 text-center text-xs">
            Checking someone else's certificate?{' '}
            <button onClick={onVerify} className="font-semibold underline underline-offset-2" style={{ color: 'var(--accent)' }}>
              Verify without an account
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------- sign in */

function SignInForm({ onSignedIn }: { onSignedIn: (user: AuthUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await api<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      setSession(response.token, response.user);
      onSignedIn(response.user);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  function useDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <>
      <h1 className="text-[22px] font-semibold tracking-tight">Sign in</h1>
      <p className="ink-secondary mt-1 text-sm">Use a demo account below, or your own learner account.</p>

      <form onSubmit={submit} className="mt-5 space-y-3.5">
        <label className="block">
          <span className="ink-secondary mb-1.5 block text-xs font-semibold">Email</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-3 py-2.5 text-sm"
          />
        </label>

        <label className="block">
          <span className="ink-secondary mb-1.5 block text-xs font-semibold">Password</span>
          <span className="relative block">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className="w-full px-3 py-2.5 pr-16 text-sm"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="ink-secondary absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-lg px-3 py-2 text-xs font-medium"
            style={{ background: 'var(--surface-2)', color: 'var(--status-critical)', border: '1px solid var(--status-critical)' }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg px-3 py-2.5 text-sm font-semibold disabled:opacity-60"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="mt-7">
        <p className="ink-muted mb-2 text-xs font-semibold uppercase tracking-wider">Demo accounts</p>
        <p className="ink-muted mb-3 text-xs">
          Password for all of them is <span className="mono font-semibold">{DEMO_PASSWORD}</span>. Pick one to fill the
          form, then press Sign in.
        </p>
        <ul className="space-y-1.5">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email}>
              <button
                onClick={() => useDemo(account.email)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              >
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  {account.role.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold">{account.role}</span>
                  <span className="ink-muted mono block truncate text-[11px]">{account.email}</span>
                </span>
                <span className="ink-muted hidden shrink-0 text-[11px] sm:block">{account.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ register */

function RegisterForm({ onSignedIn }: { onSignedIn: (user: AuthUser) => void }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [learnerId, setLearnerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordTooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mismatch || passwordTooShort) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api<{ token: string; user: AuthUser }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          display_name: displayName.trim(),
          email: email.trim(),
          password,
          ...(learnerId.trim() ? { learner_id: learnerId.trim().toUpperCase() } : {}),
        }),
      });
      setSession(response.token, response.user);
      onSignedIn(response.user);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-[22px] font-semibold tracking-tight">Create a learner account</h1>
      <p className="ink-secondary mt-1 text-sm">
        New accounts are learner accounts. Instructor, administrator and support access is granted by a platform
        administrator.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-3.5">
        <label className="block">
          <span className="ink-secondary mb-1.5 block text-xs font-semibold">Full name</span>
          <input
            required
            minLength={2}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Ananya Sharma"
            className="w-full px-3 py-2.5 text-sm"
          />
        </label>

        <label className="block">
          <span className="ink-secondary mb-1.5 block text-xs font-semibold">Email</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-3 py-2.5 text-sm"
          />
        </label>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <label className="block">
            <span className="ink-secondary mb-1.5 block text-xs font-semibold">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 text-sm"
            />
            <span className="ink-muted mt-1 block text-[11px]" style={passwordTooShort ? { color: 'var(--status-critical)' } : undefined}>
              At least 8 characters
            </span>
          </label>

          <label className="block">
            <span className="ink-secondary mb-1.5 block text-xs font-semibold">Confirm password</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3 py-2.5 text-sm"
              style={mismatch ? { borderColor: 'var(--status-critical)' } : undefined}
            />
            {mismatch && (
              <span className="mt-1 block text-[11px]" style={{ color: 'var(--status-critical)' }}>
                Passwords do not match
              </span>
            )}
          </label>
        </div>

        <label className="block">
          <span className="ink-secondary mb-1.5 block text-xs font-semibold">
            Learner ID <span className="ink-muted font-normal">(optional)</span>
          </span>
          <input
            value={learnerId}
            onChange={(e) => setLearnerId(e.target.value)}
            placeholder="LRN-000001"
            className="mono w-full px-3 py-2.5 text-sm"
          />
          <span className="ink-muted mt-1 block text-[11px]">
            Link an existing learner record to see its courses and certificates. Leave blank to start empty.
          </span>
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-lg px-3 py-2 text-xs font-medium"
            style={{ background: 'var(--surface-2)', color: 'var(--status-critical)', border: '1px solid var(--status-critical)' }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || mismatch || passwordTooShort}
          className="w-full rounded-lg px-3 py-2.5 text-sm font-semibold disabled:opacity-60"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </>
  );
}
