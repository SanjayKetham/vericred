import { useState } from 'react';
import { api, ApiError, type VerifyResponse } from '../lib/api';
import { Banner, Button, Card, Field, fmtDate, StatusPill } from '../components/ui';

const RESULT_COPY: Record<string, { kind: 'good' | 'critical' | 'warning'; headline: string; detail: string }> = {
  VALID: { kind: 'good', headline: 'Credential is valid', detail: 'The issuer signature verifies, the payload is intact, and no revocation is in force.' },
  INVALID_NOT_FOUND: { kind: 'critical', headline: 'No such credential', detail: 'The reference does not match any credential issued by this platform.' },
  INVALID_REVOKED: { kind: 'critical', headline: 'Credential has been revoked', detail: 'This credential was issued but has since been withdrawn by the issuer.' },
  INVALID_EXPIRED: { kind: 'warning', headline: 'Credential has expired', detail: 'The credential was validly issued but is past its expiry date.' },
  INVALID_HASH_MISMATCH: { kind: 'critical', headline: 'Credential does not match its seal', detail: 'The presented record does not hash to the value the issuer signed — treat it as altered.' },
  INVALID_IDENTITY_MISMATCH: { kind: 'critical', headline: 'Identity could not be confirmed', detail: 'The identity evidence supplied is too weak. A name alone is never sufficient.' },
};

/**
 * The public verification page — no account required, which is the point of third-party verification.
 * The full check list is shown either way, so a verifier can see *why* an answer was given.
 */
export function VerifyPage() {
  const [reference, setReference] = useState('');
  const [verifierName, setVerifierName] = useState('');
  const [verifierType, setVerifierType] = useState('EMPLOYER');
  const [presentedHash, setPresentedHash] = useState('');
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await api<VerifyResponse>('/api/verify', {
        method: 'POST',
        body: JSON.stringify({
          reference: reference.trim(),
          verifier_name: verifierName.trim() || 'Anonymous verifier',
          verifier_type: verifierType,
          ...(presentedHash.trim() ? { presented_hash: presentedHash.trim() } : {}),
        }),
      });
      setResult(response);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Verification could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  const copy = result ? RESULT_COPY[result.result] : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 pb-8">
      <header>
        <p className="ink-secondary text-sm">
          Enter a credential ID (<span className="mono">CRD-2026-000001</span>) or the 10-character verification code
          printed on the credential. No account is needed.
        </p>
      </header>

      <Card>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Credential ID or verification code">
            <input
              required
              minLength={3}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="CRD-2026-000001"
              className="mono w-full px-3 py-2 text-sm"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Your organisation" hint="Recorded in the audit trail.">
              <input
                value={verifierName}
                onChange={(e) => setVerifierName(e.target.value)}
                placeholder="Arclight Systems"
                className="w-full px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Verifier type">
              <select value={verifierType} onChange={(e) => setVerifierType(e.target.value)} className="w-full px-3 py-2 text-sm">
                {['EMPLOYER', 'UNIVERSITY', 'GOVERNMENT', 'PLATFORM', 'INDIVIDUAL'].map((t) => (
                  <option key={t} value={t}>
                    {t.toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label="Payload hash you hold (optional)"
            hint="Supply this to check your copy of the credential byte-for-byte against the sealed original."
          >
            <input
              value={presentedHash}
              onChange={(e) => setPresentedHash(e.target.value)}
              placeholder="sha256 hex"
              className="mono w-full px-3 py-2 text-sm"
            />
          </Field>

          <Button type="submit" disabled={busy || reference.trim().length < 3}>
            {busy ? 'Checking…' : 'Verify'}
          </Button>
        </form>
      </Card>

      {error && <Banner kind="critical">{error}</Banner>}

      {result && copy && (
        <>
          <Banner kind={copy.kind}>
            <p className="font-semibold">{copy.headline}</p>
            <p className="ink-secondary mt-0.5">{copy.detail}</p>
          </Banner>

          <Card title="What was checked" subtitle={`Verification ${result.verification_id} · ${result.latency_ms} ms`}>
            <ul className="space-y-1.5 text-sm">
              {result.checks.map((check) => (
                <li key={check.criterion} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-0.5 font-bold" style={{ color: check.passed ? 'var(--status-good)' : 'var(--status-critical)' }}>
                    {check.passed ? '✓' : '✕'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{check.criterion.replace(/_/g, ' ')}</span>
                    {!check.passed && (
                      <span className="ink-muted mono block break-all text-xs">
                        expected {String(check.required)} · found {String(check.actual)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {result.credential && (
            <Card title="Credential">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="ink-muted text-xs">Subject</dt>
                  <dd className="font-medium">{result.credential.subject_name}</dd>
                </div>
                <div>
                  <dt className="ink-muted text-xs">Status</dt>
                  <dd>
                    <StatusPill status={result.credential.status} />
                  </dd>
                </div>
                <div>
                  <dt className="ink-muted text-xs">Credential ID</dt>
                  <dd className="mono">{result.credential.credential_id}</dd>
                </div>
                <div>
                  <dt className="ink-muted text-xs">Issuer</dt>
                  <dd className="mono">{result.credential.issuer_id}</dd>
                </div>
                <div>
                  <dt className="ink-muted text-xs">Issued</dt>
                  <dd>{fmtDate(result.credential.issued_at)}</dd>
                </div>
                <div>
                  <dt className="ink-muted text-xs">Expires</dt>
                  <dd>{fmtDate(result.credential.expires_at)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="ink-muted text-xs">Sealed payload hash (SHA-256)</dt>
                  <dd className="mono break-all text-xs">{result.credential.payload_hash}</dd>
                </div>
              </dl>
              {result.revocation && (
                <div className="mt-3">
                  <Banner kind="critical">
                    Revoked {fmtDate(result.revocation.revoked_at)} — {result.revocation.reason_code.replace(/_/g, ' ').toLowerCase()} (
                    <span className="mono">{result.revocation.revocation_id}</span>)
                  </Banner>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
