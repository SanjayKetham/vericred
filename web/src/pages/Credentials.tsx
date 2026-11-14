import { useEffect, useState } from 'react';
import { api, ApiError, type AuditRow, type Credential, type Criterion } from '../lib/api';
import { Banner, Button, Card, Field, fmtDate, Spinner, StatusPill } from '../components/ui';

interface Detail {
  credential: Credential;
  learner: { learner_id: string; full_name: string; email: string } | null;
  course: { course_id: string; title: string } | null;
  issuer: { issuer_id: string; legal_name: string; status: string; public_key: string } | null;
  completion: { completion_id: string; completed_at: string | null; overall_score: number; status: string } | null;
  revocations: { revocation_id: string; sequence_no: number; reason_code: string; reason_text: string; revoked_at: string; status: string; revoked_by: string }[];
  verifications: { verification_id: string; result: string; requested_at: string; verifier_name: string; identity_match_method: string }[];
  duplicateRowCount: number;
  issuance_decision: { decision: string; rule_id: string; rule_version: number; criteria: Criterion[] };
  derived_status: string;
  current_revocation: { revocation_id: string } | null;
}

interface Review {
  headline: string;
  risk_level: string;
  observations: string[];
  suggested_checks: string[];
  source: string;
}

const REASONS = ['FRAUD', 'ADMIN_ERROR', 'COURSE_RETIRED', 'ISSUER_CHANGE', 'LEARNER_REQUEST', 'DATA_CORRECTION'];

export function CredentialsPage({ canRevoke, search: globalSearch }: { canRevoke: boolean; search: string }) {
  const [rows, setRows] = useState<Credential[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  // The top bar owns one search box for the whole app; a page-level box would be a second source of truth.
  useEffect(() => {
    setSearch(globalSearch);
    setPage(1);
  }, [globalSearch]);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    api<{ rows: Credential[]; total: number }>(`/api/credentials?${params}`)
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [page, search, status]);

  const pages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-4 px-6 pb-8">
      {error && <Banner kind="critical">{error}</Banner>}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="ink-secondary text-sm">
          {total.toLocaleString()} credentials{search.trim() ? ` matching "${search.trim()}"` : ''}.
        </p>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
            className="px-3 py-2 text-sm"
          >
            <option value="">all</option>
            <option value="ACTIVE">active</option>
            <option value="REVOKED">revoked</option>
            <option value="EXPIRED">expired</option>
          </select>
        </Field>
      </div>

      <Card>
        {loading ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="ink-muted border-b text-left text-xs" style={{ borderColor: 'var(--border)' }}>
                  <th className="py-2 font-medium">Credential</th>
                  <th className="py-2 font-medium">Learner</th>
                  <th className="py-2 font-medium">Issued</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.credential_id}-${row.completion_id}`} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                    <td className="mono py-2">{row.credential_id}</td>
                    <td className="mono py-2 text-xs">{row.learner_id}</td>
                    <td className="py-2 text-xs">{fmtDate(row.issued_at)}</td>
                    <td className="py-2">
                      <StatusPill status={row.status} />
                    </td>
                    <td className="py-2 text-right">
                      <Button variant="ghost" onClick={() => setSelected(row.credential_id)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="ink-muted">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      </Card>

      {selected && <CredentialDetail id={selected} canRevoke={canRevoke} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CredentialDetail({ id, canRevoke, onClose }: { id: string; canRevoke: boolean; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'good' | 'critical'; text: string } | null>(null);
  const [reason, setReason] = useState('FRAUD');
  const [reasonText, setReasonText] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api<Detail>(`/api/credentials/${id}`)
      .then(setDetail)
      .catch((caught: Error) => setError(caught.message));
    api<{ rows: AuditRow[] }>(`/api/audit?entityId=${id}&limit=50`)
      .then((r) => setAudit(r.rows))
      .catch(() => setAudit([]));
  };

  useEffect(load, [id]);

  async function revoke() {
    setBusy(true);
    setNotice(null);
    try {
      await api('/api/revocations', {
        method: 'POST',
        body: JSON.stringify({ credential_id: id, reason_code: reason, reason_text: reasonText.trim() || 'Revoked by administrator.' }),
      });
      setNotice({ kind: 'good', text: 'Credential revoked. The revocation is now in force and recorded in the audit trail.' });
      setReasonText('');
      load();
    } catch (caught) {
      setNotice({ kind: 'critical', text: caught instanceof ApiError ? caught.message : 'Revocation failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function runReview() {
    setBusy(true);
    try {
      const response = await api<{ review: Review }>('/api/ai/review-case', { method: 'POST', body: JSON.stringify({ credential_id: id }) });
      setReview(response.review);
    } catch {
      setNotice({ kind: 'critical', text: 'Review could not be produced.' });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Banner kind="critical">{error}</Banner>;
  if (!detail) return <Spinner label="Loading credential" />;

  return (
    <Card
      title={detail.credential.credential_id}
      subtitle={`${detail.course?.title ?? detail.credential.course_id} · ${detail.learner?.full_name ?? detail.credential.learner_id}`}
      actions={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

        {detail.duplicateRowCount > 1 && (
          <Banner kind="critical">
            <p className="font-semibold">Ambiguous credential ID</p>
            <p className="ink-secondary">
              {detail.duplicateRowCount} rows carry this identifier. Verification by ID cannot return a well-defined
              answer until the duplicate is resolved.
            </p>
          </Banner>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="ink-muted text-xs">Stored status</p>
            <StatusPill status={detail.credential.status} />
          </div>
          <div>
            <p className="ink-muted text-xs">Status re-derived now</p>
            <StatusPill status={detail.derived_status} />
          </div>
          <div>
            <p className="ink-muted text-xs">Issued</p>
            <p className="text-sm">{fmtDate(detail.credential.issued_at)}</p>
          </div>
          <div>
            <p className="ink-muted text-xs">Expires</p>
            <p className="text-sm">{fmtDate(detail.credential.expires_at)}</p>
          </div>
        </div>

        <div>
          <p className="ink-muted text-xs">Verification code (share with verifiers)</p>
          <p className="mono text-lg font-semibold tracking-wider">{detail.credential.verification_code}</p>
        </div>

        <div className="grid gap-2 text-xs">
          <div>
            <p className="ink-muted">Payload hash (SHA-256)</p>
            <p className="mono break-all">{detail.credential.payload_hash}</p>
          </div>
          <div>
            <p className="ink-muted">Issuer signature (Ed25519)</p>
            <p className="mono break-all">{detail.credential.signature}</p>
          </div>
          <div>
            <p className="ink-muted">Issuer</p>
            <p>
              {detail.issuer?.legal_name ?? detail.credential.issuer_id}{' '}
              {detail.issuer && detail.issuer.status !== 'ACTIVE' && <StatusPill status={detail.issuer.status} />}
            </p>
          </div>
        </div>

        <details>
          <summary className="cursor-pointer text-sm font-medium">Issuance decision trace</summary>
          <table className="mt-2 w-full text-xs">
            <tbody>
              {detail.issuance_decision.criteria.map((criterion) => (
                <tr key={criterion.criterion} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                  <td className="py-1">{criterion.criterion.replace(/_/g, ' ')}</td>
                  <td className="py-1 tabular-nums">required {String(criterion.required)}</td>
                  <td className="py-1 tabular-nums">actual {String(criterion.actual)}</td>
                  <td className="py-1" style={{ color: criterion.passed ? 'var(--status-good)' : 'var(--status-critical)' }}>
                    {criterion.passed ? '✓' : '✕'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <div>
          <h3 className="mb-2 text-sm font-medium">Revocation history</h3>
          {detail.revocations.length === 0 ? (
            <p className="ink-muted text-sm">No revocation events.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {detail.revocations.map((revocation) => (
                <li key={revocation.revocation_id} className="card p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono">{revocation.revocation_id}</span>
                    <StatusPill status={revocation.status} />
                    <span className="ink-muted">{fmtDate(revocation.revoked_at)}</span>
                  </div>
                  <p className="ink-secondary mt-1">
                    {revocation.reason_code.replace(/_/g, ' ').toLowerCase()} — {revocation.reason_text}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="ink-muted mt-2 text-xs">
            Revocation rows are never edited or deleted. The current state is a replay of this sequence.
          </p>
        </div>

        {canRevoke && !detail.current_revocation && (
          <div className="card p-3">
            <h3 className="mb-2 text-sm font-medium">Revoke this credential</h3>
            <div className="grid gap-2 sm:grid-cols-[200px_1fr_auto] sm:items-end">
              <Field label="Reason">
                <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg px-2 py-1.5 text-sm">
                  {REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r.replace(/_/g, ' ').toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Explanation">
                <input value={reasonText} onChange={(e) => setReasonText(e.target.value)} maxLength={240} className="w-full rounded-lg px-2 py-1.5 text-sm" />
              </Field>
              <Button variant="danger" onClick={revoke} disabled={busy}>
                {busy ? 'Working…' : 'Revoke'}
              </Button>
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Case review</h3>
            <Button variant="ghost" onClick={runReview} disabled={busy}>
              {busy ? 'Working…' : 'Run review'}
            </Button>
          </div>
          {review ? (
            <div className="card p-3 text-sm">
              <p className="font-medium">{review.headline}</p>
              <p className="ink-muted mt-0.5 text-xs">
                Risk {review.risk_level.toLowerCase()} · advisory only, generated by {review.source === 'openai' ? 'OpenAI structured output' : 'the deterministic fallback'}
              </p>
              <ul className="ink-secondary mt-2 list-disc space-y-1 pl-4 text-xs">
                {review.observations.map((observation) => (
                  <li key={observation}>{observation}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="ink-muted text-xs">Summarises this record for a support agent. It never decides validity.</p>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium">Audit trail</h3>
          <ul className="space-y-1 text-xs">
            {audit.map((event) => (
              <li key={event.event_id} className="flex flex-wrap items-center gap-2">
                <span className="mono ink-muted">{event.event_id}</span>
                <span className="font-medium">{event.event_type.replace(/_/g, ' ').toLowerCase()}</span>
                <span className="ink-muted">{fmtDate(event.occurred_at)}</span>
                <span className="ink-muted">by {event.actor_id}</span>
              </li>
            ))}
            {audit.length === 0 && <li className="ink-muted">No events recorded against this credential.</li>}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium">Recent verifications</h3>
          {detail.verifications.length === 0 ? (
            <p className="ink-muted text-xs">No verification requests yet.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {detail.verifications.slice(0, 10).map((verification) => (
                <li key={verification.verification_id} className="flex flex-wrap items-center gap-2">
                  <StatusPill status={verification.result} />
                  <span>{verification.verifier_name}</span>
                  <span className="ink-muted">{fmtDate(verification.requested_at)}</span>
                  <span className="ink-muted">via {verification.identity_match_method.replace(/_/g, ' ').toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
