import { useEffect, useState } from 'react';
import { api, type AuthUser, type Credential } from '../lib/api';
import type {
  Course,
  CredentialRule,
  Issuer,
  Learner,
  PlatformUser,
  Revocation,
  VerificationRequest,
} from '../lib/domain';
import { Banner, Card, Spinner, StatusPill, fmtDate } from '../components/ui';
import { CategoryBars } from '../components/charts';
import { CopyButton, KpiRow, RecordTable, Select, Toolbar, downloadCsv, type Column } from '../components/table';

/** Generic record modules shared by the instructor, administrator, support and platform roles. */

function useRows<T>(path: string, deps: unknown[] = []) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    api<{ rows: T[] }>(path)
      .then((r) => {
        if (!cancelled) setRows(r.rows);
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { rows, error };
}

function Loading({ error, label }: { error: string | null; label: string }) {
  if (error) return <Banner kind="critical">{error}</Banner>;
  return <Spinner label={label} />;
}

/* ---------------------------------------------------------------- courses */

export function CoursesModule({ search }: { search: string }) {
  const { rows, error } = useRows<Course>('/api/courses?limit=500');
  if (!rows) return <Loading error={error} label="Loading courses" />;

  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((c) => `${c.course_id} ${c.course_code} ${c.title} ${c.subject_area} ${c.level}`.toLowerCase().includes(needle))
    : rows;

  const columns: Column<Course>[] = [
    { key: 'code', label: 'Code', render: (r) => <span className="mono text-xs font-semibold">{r.course_code}</span>, value: (r) => r.course_code },
    { key: 'title', label: 'Title', render: (r) => <span className="font-medium">{r.title}</span>, value: (r) => r.title },
    { key: 'level', label: 'Level', render: (r) => <span className="ink-secondary text-xs">{r.level.toLowerCase()}</span>, value: (r) => r.level },
    { key: 'modules', label: 'Modules', align: 'right', render: (r) => r.modules_total, value: (r) => r.modules_total },
    { key: 'assessments', label: 'Assessments', align: 'right', render: (r) => r.assessment_count, value: (r) => r.assessment_count },
    { key: 'pass', label: 'Pass mark', align: 'right', render: (r) => r.passing_score, value: (r) => r.passing_score },
    { key: 'from', label: 'Effective from', render: (r) => <span className="text-xs">{fmtDate(r.effective_from)}</span>, value: (r) => r.effective_from },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} />, value: (r) => r.status },
  ];

  const retired = rows.filter((c) => c.status === 'RETIRED').length;

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          { label: 'Courses', value: rows.length, icon: 'courses' },
          { label: 'Active', value: rows.length - retired, icon: 'progress', tone: 'good' },
          { label: 'Retired', value: retired, icon: 'records', tone: 'warning', hint: 'Still carry historical credentials' },
        ]}
      />
      <Card
        title="Course catalogue"
        subtitle={`${filtered.length} of ${rows.length} shown`}
        actions={<ExportButton rows={filtered} columns={columns} filename="courses.csv" />}
      >
        <RecordTable rows={filtered} columns={columns} getKey={(r) => r.course_id} empty="No courses match." />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ rules */

export function RulesModule({ search }: { search: string }) {
  const { rows, error } = useRows<CredentialRule>('/api/rules');
  const [onlyActive, setOnlyActive] = useState('ALL');
  if (!rows) return <Loading error={error} label="Loading credential rules" />;

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (onlyActive !== 'ALL' && r.status !== onlyActive) return false;
    return needle ? `${r.rule_id} ${r.course_id}`.toLowerCase().includes(needle) : true;
  });

  const columns: Column<CredentialRule>[] = [
    { key: 'rule', label: 'Rule', render: (r) => <span className="mono text-xs font-semibold">{r.rule_id}</span>, value: (r) => r.rule_id },
    { key: 'course', label: 'Course', render: (r) => <span className="mono text-xs">{r.course_id}</span>, value: (r) => r.course_id },
    { key: 'version', label: 'Ver.', align: 'right', render: (r) => r.rule_version, value: (r) => r.rule_version },
    { key: 'score', label: 'Min score', align: 'right', render: (r) => r.min_overall_score, value: (r) => r.min_overall_score },
    { key: 'modules', label: 'Min modules', align: 'right', render: (r) => `${r.min_modules_completed_pct}%`, value: (r) => r.min_modules_completed_pct },
    { key: 'assessments', label: 'Assessments', align: 'right', render: (r) => r.required_assessments_passed, value: (r) => r.required_assessments_passed },
    { key: 'attendance', label: 'Min attendance', align: 'right', render: (r) => `${r.min_attendance_pct}%`, value: (r) => r.min_attendance_pct },
    { key: 'days', label: 'Max days', align: 'right', render: (r) => r.max_days_to_complete, value: (r) => r.max_days_to_complete },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} />, value: (r) => r.status },
  ];

  return (
    <div className="space-y-4">
      <Banner kind="info">
        <p className="font-semibold">Rules are versioned, not edited</p>
        <p className="ink-secondary">
          Changing a requirement creates a new version with its own effective dates. Issuance pins the version it
          evaluated, so an old credential is still judged by the rule that was actually in force.
        </p>
      </Banner>

      <Card
        title="Credential rules"
        subtitle={`${filtered.length} of ${rows.length} shown`}
        actions={
          <Toolbar>
            <Select
              label="Status"
              value={onlyActive}
              onChange={setOnlyActive}
              options={[
                { value: 'ALL', label: 'all versions' },
                { value: 'ACTIVE', label: 'active only' },
                { value: 'SUPERSEDED', label: 'superseded' },
              ]}
            />
            <ExportButton rows={filtered} columns={columns} filename="credential-rules.csv" />
          </Toolbar>
        }
      >
        <RecordTable rows={filtered} columns={columns} getKey={(r) => r.rule_id} empty="No rules match." />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------- verification log */

export function VerificationsModule({ search, failedOnly }: { search: string; failedOnly: boolean }) {
  const [filter, setFilter] = useState(failedOnly ? 'FAILED' : 'ALL');
  const query = filter === 'ALL' ? '' : `&result=${filter}`;
  const { rows, error } = useRows<VerificationRequest>(`/api/verifications?limit=400${query}`, [filter]);
  if (!rows) return <Loading error={error} label="Loading verification history" />;

  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((v) => `${v.verification_id} ${v.credential_id ?? ''} ${v.verifier_name} ${v.result}`.toLowerCase().includes(needle))
    : rows;

  const columns: Column<VerificationRequest>[] = [
    { key: 'id', label: 'Request', render: (r) => <span className="mono text-xs font-semibold">{r.verification_id}</span>, value: (r) => r.verification_id },
    { key: 'credential', label: 'Credential', render: (r) => <span className="mono text-xs">{r.credential_id ?? '—'}</span>, value: (r) => r.credential_id ?? '' },
    { key: 'verifier', label: 'Verifier', render: (r) => <span className="text-xs">{r.verifier_name}</span>, value: (r) => r.verifier_name },
    { key: 'method', label: 'Identity', render: (r) => <span className="ink-secondary text-xs">{r.identity_match_method.replace(/_/g, ' ').toLowerCase()}</span>, value: (r) => r.identity_match_method },
    { key: 'result', label: 'Result', render: (r) => <StatusPill status={r.result} />, value: (r) => r.result },
    { key: 'at', label: 'Requested', render: (r) => <span className="text-xs">{fmtDate(r.requested_at)}</span>, value: (r) => r.requested_at },
    { key: 'latency', label: 'ms', align: 'right', render: (r) => r.latency_ms, value: (r) => r.latency_ms },
  ];

  const byResult = new Map<string, number>();
  for (const row of rows) byResult.set(row.result, (byResult.get(row.result) ?? 0) + 1);
  const breakdown = [...byResult.entries()]
    .map(([label, value]) => ({ label: label.replace(/^INVALID_/, '').replace(/_/g, ' ').toLowerCase(), value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card
          title={failedOnly ? 'Verification issues' : 'Verification history'}
          subtitle={`${filtered.length} of ${rows.length} requests`}
          actions={
            <Toolbar>
              <Select
                label="Result"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'ALL', label: 'all results' },
                  { value: 'FAILED', label: 'not valid' },
                  { value: 'VALID', label: 'valid' },
                  { value: 'INVALID_REVOKED', label: 'revoked' },
                  { value: 'INVALID_HASH_MISMATCH', label: 'hash mismatch' },
                  { value: 'INVALID_NOT_FOUND', label: 'not found' },
                  { value: 'INVALID_IDENTITY_MISMATCH', label: 'identity mismatch' },
                ]}
              />
              <ExportButton rows={filtered} columns={columns} filename="verification-history.csv" />
            </Toolbar>
          }
        >
          <RecordTable rows={filtered} columns={columns} getKey={(r) => r.verification_id} empty="No requests match." />
        </Card>

        <Card title="Outcome mix" subtitle="Across the loaded window">
          <CategoryBars data={breakdown} highlight={(label) => label !== 'valid'} height={200} />
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- revocations */

export function RevocationsModule({ search }: { search: string }) {
  const { rows, error } = useRows<Revocation>('/api/revocations?limit=400');
  if (!rows) return <Loading error={error} label="Loading revocations" />;

  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((r) => `${r.revocation_id} ${r.credential_id} ${r.reason_code}`.toLowerCase().includes(needle))
    : rows;

  const columns: Column<Revocation>[] = [
    { key: 'id', label: 'Revocation', render: (r) => <span className="mono text-xs font-semibold">{r.revocation_id}</span>, value: (r) => r.revocation_id },
    { key: 'credential', label: 'Credential', render: (r) => <span className="mono text-xs">{r.credential_id}</span>, value: (r) => r.credential_id },
    { key: 'seq', label: 'Seq', align: 'right', render: (r) => r.sequence_no, value: (r) => r.sequence_no },
    { key: 'reason', label: 'Reason', render: (r) => <span className="text-xs font-medium">{r.reason_code.replace(/_/g, ' ').toLowerCase()}</span>, value: (r) => r.reason_code },
    { key: 'text', label: 'Explanation', render: (r) => <span className="ink-secondary text-xs">{r.reason_text}</span>, value: (r) => r.reason_text },
    { key: 'at', label: 'Revoked', render: (r) => <span className="text-xs">{fmtDate(r.revoked_at)}</span>, value: (r) => r.revoked_at },
    { key: 'by', label: 'By', render: (r) => <span className="mono text-xs">{r.revoked_by}</span>, value: (r) => r.revoked_by },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} />, value: (r) => r.status },
  ];

  const rescinded = rows.filter((r) => r.status === 'RESCINDED').length;
  const reasons = new Map<string, number>();
  for (const row of rows) reasons.set(row.reason_code, (reasons.get(row.reason_code) ?? 0) + 1);

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          { label: 'Revocation events', value: rows.length, icon: 'revoke', tone: 'critical' },
          { label: 'Currently in force', value: rows.length - rescinded, icon: 'shield', tone: 'critical' },
          { label: 'Rescinded', value: rescinded, icon: 'history', tone: 'warning', hint: 'Superseded, never deleted' },
        ]}
      />
      <Card
        title="Revocation register"
        subtitle={`${filtered.length} of ${rows.length} events`}
        actions={<ExportButton rows={filtered} columns={columns} filename="revocations.csv" />}
      >
        <RecordTable rows={filtered} columns={columns} getKey={(r) => r.revocation_id} empty="No revocations match." />
        <p className="ink-muted mt-3 text-xs">
          Rows are append-only. Rescinding a revocation adds a further row; the original is kept so the history of a
          correction is visible rather than erased.
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ issuers */

export function IssuersModule({ asInstitutions = false }: { asInstitutions?: boolean }) {
  const { rows, error } = useRows<Issuer>('/api/issuers');
  if (!rows) return <Loading error={error} label="Loading issuers" />;

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          { label: asInstitutions ? 'Institutions' : 'Issuers', value: rows.length, icon: 'institution' },
          { label: 'Currently active', value: rows.filter((i) => i.status === 'ACTIVE').length, icon: 'shield', tone: 'good' },
          { label: 'Superseded', value: rows.filter((i) => i.status !== 'ACTIVE').length, icon: 'history', tone: 'warning', hint: 'Replaced by a successor' },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((issuer) => (
          <Card key={issuer.issuer_id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{issuer.legal_name}</p>
                <p className="ink-muted mono text-xs">{issuer.issuer_id}</p>
              </div>
              <StatusPill status={issuer.status} />
            </div>
            <dl className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="ink-muted">Accreditation</dt>
                <dd className="font-medium">{issuer.accreditation_body}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="ink-muted">Effective from</dt>
                <dd>{fmtDate(issuer.effective_from)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="ink-muted">Effective to</dt>
                <dd>{fmtDate(issuer.effective_to)}</dd>
              </div>
              {issuer.supersedes_issuer_id && (
                <div className="flex justify-between gap-3">
                  <dt className="ink-muted">Supersedes</dt>
                  <dd className="mono">{issuer.supersedes_issuer_id}</dd>
                </div>
              )}
            </dl>
            <div className="mt-3 rounded-lg p-2" style={{ background: 'var(--surface-2)' }}>
              <p className="ink-muted text-[10px] font-semibold uppercase tracking-wide">{issuer.key_algorithm} public key</p>
              <p className="mono mt-0.5 break-all text-[10px]">{issuer.public_key}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ learner lookup */

export function LearnerLookupModule({ search }: { search: string }) {
  const [query, setQuery] = useState(search);
  const [rows, setRows] = useState<Learner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setQuery(search), [search]);

  async function run(event?: React.FormEvent) {
    event?.preventDefault();
    if (query.trim().length < 3) {
      setError('Enter at least 3 characters of an identifier.');
      setRows(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api<{ rows: Learner[] }>(`/api/learners?search=${encodeURIComponent(query.trim())}&limit=50`);
      setRows(response.rows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Lookup failed.');
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Banner kind="info">
        <p className="font-semibold">Lookup is by identifier, not by browsing</p>
        <p className="ink-secondary">
          Support searches on a learner ID, email or credential reference the person has supplied. Names are not
          identifiers here — thousands of learners share one — and the national-ID hash is never returned to the browser.
        </p>
      </Banner>

      <Card title="Find a learner">
        <form onSubmit={run} className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[260px] flex-1">
            <span className="ink-secondary mb-1 block text-xs font-medium">Learner ID, email or name</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="LRN-000001" className="mono w-full px-3 py-2 text-sm" />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          >
            {busy ? 'Searching…' : 'Search'}
          </button>
        </form>
        {error && (
          <p className="mt-3 text-xs font-medium" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}
      </Card>

      {rows && (
        <Card title="Matches" subtitle={`${rows.length} learner${rows.length === 1 ? '' : 's'}`}>
          <RecordTable
            rows={rows}
            getKey={(r) => r.learner_id}
            empty="No learner matches that identifier."
            columns={[
              { key: 'id', label: 'Learner', render: (r) => <span className="mono text-xs font-semibold">{r.learner_id}</span> },
              { key: 'name', label: 'Name', render: (r) => r.full_name },
              { key: 'email', label: 'Email', render: (r) => <span className="mono text-xs">{r.email}</span> },
              { key: 'country', label: 'Country', render: (r) => <span className="text-xs">{r.country}</span> },
              { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
              { key: 'copy', label: '', align: 'right', render: (r) => <CopyButton value={r.learner_id} label="Copy ID" /> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- reports */

export function ReportsModule() {
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [verifications, setVerifications] = useState<VerificationRequest[] | null>(null);
  const [revocations, setRevocations] = useState<Revocation[] | null>(null);

  useEffect(() => {
    api<{ rows: Credential[] }>('/api/credentials?pageSize=100').then((r) => setCredentials(r.rows)).catch(() => setCredentials([]));
    api<{ rows: VerificationRequest[] }>('/api/verifications?limit=400').then((r) => setVerifications(r.rows)).catch(() => setVerifications([]));
    api<{ rows: Revocation[] }>('/api/revocations?limit=400').then((r) => setRevocations(r.rows)).catch(() => setRevocations([]));
  }, []);

  const reports = [
    {
      title: 'Credential register',
      detail: 'Issued credentials with issuer, rule version, status and hash.',
      rows: credentials,
      filename: 'credential-register.csv',
      columns: [
        { key: 'id', label: 'credential_id', render: () => null, value: (r: Credential) => r.credential_id },
        { key: 'learner', label: 'learner_id', render: () => null, value: (r: Credential) => r.learner_id },
        { key: 'course', label: 'course_id', render: () => null, value: (r: Credential) => r.course_id },
        { key: 'issuer', label: 'issuer_id', render: () => null, value: (r: Credential) => r.issuer_id },
        { key: 'rule', label: 'rule_id', render: () => null, value: (r: Credential) => r.rule_id },
        { key: 'issued', label: 'issued_at', render: () => null, value: (r: Credential) => r.issued_at },
        { key: 'status', label: 'status', render: () => null, value: (r: Credential) => r.status },
        { key: 'hash', label: 'payload_hash', render: () => null, value: (r: Credential) => r.payload_hash },
      ] as Column<Credential>[],
    },
    {
      title: 'Verification log',
      detail: 'Third-party requests with the identity method and the result returned.',
      rows: verifications,
      filename: 'verification-log.csv',
      columns: [
        { key: 'id', label: 'verification_id', render: () => null, value: (r: VerificationRequest) => r.verification_id },
        { key: 'credential', label: 'credential_id', render: () => null, value: (r: VerificationRequest) => r.credential_id ?? '' },
        { key: 'verifier', label: 'verifier_name', render: () => null, value: (r: VerificationRequest) => r.verifier_name },
        { key: 'method', label: 'identity_match_method', render: () => null, value: (r: VerificationRequest) => r.identity_match_method },
        { key: 'result', label: 'result', render: () => null, value: (r: VerificationRequest) => r.result },
        { key: 'at', label: 'requested_at', render: () => null, value: (r: VerificationRequest) => r.requested_at },
      ] as Column<VerificationRequest>[],
    },
    {
      title: 'Revocation register',
      detail: 'Every revocation event, including those later rescinded.',
      rows: revocations,
      filename: 'revocation-register.csv',
      columns: [
        { key: 'id', label: 'revocation_id', render: () => null, value: (r: Revocation) => r.revocation_id },
        { key: 'credential', label: 'credential_id', render: () => null, value: (r: Revocation) => r.credential_id },
        { key: 'reason', label: 'reason_code', render: () => null, value: (r: Revocation) => r.reason_code },
        { key: 'at', label: 'revoked_at', render: () => null, value: (r: Revocation) => r.revoked_at },
        { key: 'by', label: 'revoked_by', render: () => null, value: (r: Revocation) => r.revoked_by },
        { key: 'status', label: 'status', render: () => null, value: (r: Revocation) => r.status },
      ] as Column<Revocation>[],
    },
  ];

  return (
    <div className="space-y-4">
      <Banner kind="info">
        <p className="font-semibold">Exports match what is on screen</p>
        <p className="ink-secondary">
          Each report is built from the same rows the modules display, so a CSV never disagrees with the register it
          came from. The full dataset is also exported as CSV, JSONL and SQL by the generator.
        </p>
      </Banner>

      <div className="grid gap-4 md:grid-cols-3">
        {reports.map((report) => (
          <Card key={report.title} title={report.title} subtitle={report.detail}>
            <p className="text-2xl font-semibold tabular-nums">{report.rows ? report.rows.length.toLocaleString() : '…'}</p>
            <p className="ink-muted text-xs">rows available</p>
            <button
              disabled={!report.rows || report.rows.length === 0}
              onClick={() => downloadCsv(report.filename, report.rows as never[], report.columns as never)}
              className="mt-3 w-full rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            >
              Download CSV
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ExportButton<T>({ rows, columns, filename }: { rows: T[]; columns: Column<T>[]; filename: string }) {
  return (
    <button
      onClick={() => downloadCsv(filename, rows, columns)}
      disabled={rows.length === 0}
      className="rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
      style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
    >
      Export CSV
    </button>
  );
}

/* ------------------------------------------------------------ user admin */

export function UsersModule({ user }: { user: AuthUser }) {
  const { rows, error } = useRows<PlatformUser>('/api/users');
  if (!rows) return <Loading error={error} label="Loading accounts" />;

  const byRole = new Map<string, number>();
  for (const row of rows) byRole.set(row.role, (byRole.get(row.role) ?? 0) + 1);

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          { label: 'Accounts', value: rows.length, icon: 'users' },
          { label: 'Staff accounts', value: rows.filter((r) => r.role !== 'LEARNER').length, icon: 'roles' },
          { label: 'Learner accounts', value: byRole.get('LEARNER') ?? 0, icon: 'profile' },
        ]}
      />

      <Banner kind="info">
        <p className="font-semibold">Self-registration creates learner accounts only</p>
        <p className="ink-secondary">
          Staff roles are granted here rather than chosen on the sign-up form, so nobody can award themselves issuance
          or revocation rights. You are signed in as <span className="mono">{user.email}</span>.
        </p>
      </Banner>

      <Card title="Accounts" subtitle={`${rows.length} able to sign in`}>
        <RecordTable
          rows={rows}
          getKey={(r) => r.user_id}
          columns={[
            { key: 'id', label: 'User', render: (r) => <span className="mono text-xs font-semibold">{r.user_id}</span> },
            { key: 'name', label: 'Name', render: (r) => r.display_name },
            { key: 'email', label: 'Email', render: (r) => <span className="mono text-xs">{r.email}</span> },
            { key: 'role', label: 'Role', render: (r) => <span className="text-xs font-medium">{r.role.replace(/_/g, ' ').toLowerCase()}</span> },
            { key: 'learner', label: 'Linked learner', render: (r) => <span className="mono text-xs">{r.learner_id ?? '—'}</span> },
          ]}
        />
      </Card>
    </div>
  );
}

export function RolesModule() {
  const matrix: [string, string[]][] = [
    ['Platform administrator', ['Manage users and roles', 'Manage issuers and keys', 'View all records and audit', 'Rescind a revocation']],
    ['Academic administrator', ['Issue credentials', 'Revoke credentials', 'Manage courses and rules', 'Export reports']],
    ['Instructor', ['View assigned courses and learners', 'View completion records', 'Preview eligibility']],
    ['Support', ['Look up learners and credentials', 'Investigate failed verifications', 'View audit history']],
    ['Learner', ['View own courses and certificates', 'Download and share own certificates']],
    ['Anyone (no account)', ['Verify a credential']],
  ];

  return (
    <div className="space-y-4">
      <Banner kind="info">
        <p className="font-semibold">Roles are enforced on the server</p>
        <p className="ink-secondary">
          Hiding a menu is a convenience. Every endpoint re-checks the caller's role, and a learner's request for
          another learner's record is refused regardless of what the browser sends.
        </p>
      </Banner>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {matrix.map(([role, capabilities]) => (
          <Card key={role} title={role}>
            <ul className="space-y-1.5">
              {capabilities.map((capability) => (
                <li key={capability} className="flex items-start gap-2 text-sm">
                  <span aria-hidden="true" className="mt-0.5 font-bold" style={{ color: 'var(--status-good)' }}>
                    ✓
                  </span>
                  <span className="ink-secondary">{capability}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- key management */

export function KeysModule() {
  const { rows, error } = useRows<Issuer>('/api/issuers');
  if (!rows) return <Loading error={error} label="Loading signing keys" />;

  const rotations = rows.filter((i) => i.supersedes_issuer_id !== null);

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          { label: 'Signing keys', value: rows.length, icon: 'key' },
          { label: 'Active keys', value: rows.filter((i) => i.status === 'ACTIVE').length, icon: 'shield', tone: 'good' },
          { label: 'Rotations', value: rotations.length, icon: 'history', hint: 'Successor issuers' },
        ]}
      />

      <Banner kind="info">
        <p className="font-semibold">Rotation does not invalidate old credentials</p>
        <p className="ink-secondary">
          A credential records the issuer that signed it. When an issuer is superseded, its key stays in the registry so
          historical signatures still verify — which is why keys are retired, never deleted.
        </p>
      </Banner>

      <Card title="Key registry" subtitle="Ed25519 public keys and their effective windows">
        <RecordTable
          rows={rows}
          getKey={(r) => r.issuer_id}
          pageSize={10}
          columns={[
            { key: 'issuer', label: 'Issuer', render: (r) => <span className="mono text-xs font-semibold">{r.issuer_id}</span> },
            { key: 'name', label: 'Legal name', render: (r) => r.legal_name },
            { key: 'alg', label: 'Algorithm', render: (r) => <span className="mono text-xs">{r.key_algorithm}</span> },
            { key: 'from', label: 'From', render: (r) => <span className="text-xs">{fmtDate(r.effective_from)}</span> },
            { key: 'to', label: 'Until', render: (r) => <span className="text-xs">{fmtDate(r.effective_to)}</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
            { key: 'key', label: 'Public key', render: (r) => <span className="mono text-[10px]">{r.public_key.slice(0, 16)}…</span> },
            { key: 'copy', label: '', align: 'right', render: (r) => <CopyButton value={r.public_key} label="Copy key" /> },
          ]}
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------ security monitoring */

export function SecurityModule() {
  const { rows, error } = useRows<VerificationRequest>('/api/verifications?limit=400');
  if (!rows) return <Loading error={error} label="Loading security signals" />;

  const nameOnly = rows.filter((v) => v.identity_match_method === 'NAME_ONLY');
  const weak = rows.filter((v) => v.identity_match_score < 0.9);
  const hashMismatch = rows.filter((v) => v.result === 'INVALID_HASH_MISMATCH');
  const notFound = rows.filter((v) => v.result === 'INVALID_NOT_FOUND');
  const validOnWeak = rows.filter((v) => v.result === 'VALID' && (v.identity_match_method === 'NAME_ONLY' || v.identity_match_score < 0.9));

  const byVerifier = new Map<string, number>();
  for (const row of rows.filter((v) => v.result !== 'VALID')) {
    byVerifier.set(row.verifier_name, (byVerifier.get(row.verifier_name) ?? 0) + 1);
  }
  const noisiest = [...byVerifier.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          { label: 'Name-only attempts', value: nameOnly.length, icon: 'shield', tone: 'warning', hint: 'Can never return valid' },
          { label: 'Sub-threshold identity', value: weak.length, icon: 'anomaly', tone: 'warning' },
          { label: 'Hash mismatches', value: hashMismatch.length, icon: 'key', tone: 'critical', hint: 'Presented record did not match its seal' },
          { label: 'Unknown references', value: notFound.length, icon: 'magnifier' as never, tone: 'warning' },
          { label: 'Valid on weak identity', value: validOnWeak.length, icon: 'shield', tone: validOnWeak.length === 0 ? 'good' : 'critical', hint: 'Must always be zero' },
          { label: 'Requests reviewed', value: rows.length, icon: 'history' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Verifiers with the most failures" subtitle="A concentration here is worth a conversation">
          <CategoryBars data={noisiest} height={220} />
        </Card>

        <Card title="Standing controls" subtitle="Invariants the platform enforces on every request">
          <ul className="space-y-2.5">
            {[
              ['A name alone never verifies', 'NAME_ONLY scores 0.42 against a 0.90 threshold.', validOnWeak.length === 0],
              ['Payload integrity is recomputed', 'The stored payload is re-hashed on every verification.', true],
              ['Revocation is replayed, not cached', 'Status is derived from the event sequence as of the request.', true],
              ['Ambiguous references are refused', 'A duplicated credential ID returns 409 rather than a guess.', true],
            ].map(([title, detail, ok]) => (
              <li key={title as string} className="flex items-start gap-3 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                <span aria-hidden="true" className="mt-0.5 font-bold" style={{ color: ok ? 'var(--status-good)' : 'var(--status-critical)' }}>
                  {ok ? '✓' : '✕'}
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title as string}</span>
                  <span className="ink-muted block text-xs">{detail as string}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ data quality */

interface ValidationSummary {
  validated_at: string;
  checks: {
    id: string;
    category: string;
    description: string;
    rows_checked: number;
    violations_unexpected: number;
    violations_expected_by_label: number;
    status: string;
  }[];
  totals: { checks_run: number; checks_passed: number; violations_unexpected: number; violations_expected_by_label: number };
  anomaly_detection: {
    per_issue_type: { issue_type: string; expected: number; detected: number; true_positives: number; false_positives: number; false_negatives: number; precision: number; recall: number; f1: number }[];
    overall: { expected: number; detected: number; precision: number; recall: number; f1: number };
  };
  profile: { row_counts: Record<string, number> };
}

export function AnomalyModule({ mode }: { mode: 'anomalies' | 'data' }) {
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ValidationSummary>('/api/platform/validation')
      .then(setSummary)
      .catch((caught: Error) => setError(caught.message));
  }, []);

  if (error) {
    return (
      <Banner kind="warning">
        <p className="font-semibold">No validation report available</p>
        <p className="ink-secondary">
          Run <span className="mono">npm run validate</span> in the server directory to produce one. ({error})
        </p>
      </Banner>
    );
  }
  if (!summary) return <Spinner label="Loading validation report" />;

  const detection = summary.anomaly_detection;

  if (mode === 'anomalies') {
    return (
      <div className="space-y-4">
        <KpiRow
          items={[
            { label: 'Anomalies expected', value: detection.overall.expected, icon: 'anomaly' },
            { label: 'Detected', value: detection.overall.detected, icon: 'magnifier' as never, tone: 'good' },
            { label: 'Precision', value: detection.overall.precision.toFixed(3), icon: 'shield', tone: 'good' },
            { label: 'Recall', value: detection.overall.recall.toFixed(3), icon: 'shield', tone: 'good' },
            { label: 'F1', value: detection.overall.f1.toFixed(3), icon: 'grade', tone: 'good' },
            { label: 'Last validated', value: summary.validated_at.slice(0, 10), icon: 'history' },
          ]}
        />

        <Banner kind="info">
          <p className="font-semibold">Ground truth is used to score, never to detect</p>
          <p className="ink-secondary">
            Detectors read only the feature files. The labelled answers are opened afterwards purely to score the
            findings, so the metrics below measure detection rather than lookup.
          </p>
        </Banner>

        <Card title="Detector performance by issue type" subtitle="Scored against the labelled edge cases">
          <RecordTable
            rows={detection.per_issue_type}
            getKey={(r) => r.issue_type}
            pageSize={10}
            columns={[
              { key: 'type', label: 'Issue type', render: (r) => <span className="mono text-xs font-semibold">{r.issue_type}</span> },
              { key: 'expected', label: 'Expected', align: 'right', render: (r) => r.expected },
              { key: 'detected', label: 'Detected', align: 'right', render: (r) => r.detected },
              { key: 'tp', label: 'TP', align: 'right', render: (r) => r.true_positives },
              { key: 'fp', label: 'FP', align: 'right', render: (r) => r.false_positives },
              { key: 'fn', label: 'FN', align: 'right', render: (r) => r.false_negatives },
              { key: 'precision', label: 'Precision', align: 'right', render: (r) => r.precision.toFixed(3) },
              { key: 'recall', label: 'Recall', align: 'right', render: (r) => r.recall.toFixed(3) },
              { key: 'f1', label: 'F1', align: 'right', render: (r) => r.f1.toFixed(3) },
            ]}
          />
        </Card>
      </div>
    );
  }

  const counts = Object.entries(summary.profile.row_counts).map(([label, value]) => ({ label: label.replace(/_/g, ' '), value }));

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          { label: 'Checks run', value: summary.totals.checks_run, icon: 'data' },
          { label: 'Checks passed', value: summary.totals.checks_passed, icon: 'shield', tone: 'good' },
          {
            label: 'Unexpected violations',
            value: summary.totals.violations_unexpected,
            icon: 'anomaly',
            tone: summary.totals.violations_unexpected === 0 ? 'good' : 'critical',
          },
          { label: 'Explained by a label', value: summary.totals.violations_expected_by_label, icon: 'records', hint: 'Injected edge cases' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Validation checks" subtitle={`Last run ${fmtDate(summary.validated_at)}`}>
          <RecordTable
            rows={summary.checks}
            getKey={(r) => r.id}
            pageSize={20}
            columns={[
              { key: 'id', label: 'Check', render: (r) => <span className="mono text-xs font-semibold">{r.id}</span> },
              { key: 'desc', label: 'Description', render: (r) => <span className="text-xs">{r.description}</span> },
              { key: 'rows', label: 'Rows', align: 'right', render: (r) => r.rows_checked.toLocaleString() },
              { key: 'unexpected', label: 'Unexpected', align: 'right', render: (r) => r.violations_unexpected },
              { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status === 'PASS' ? 'PASS' : 'FAIL'} /> },
            ]}
          />
        </Card>

        <Card title="Row counts" subtitle="What the generator produced">
          <RecordTable
            rows={counts}
            getKey={(r) => r.label}
            pageSize={12}
            columns={[
              { key: 'table', label: 'Table', render: (r) => <span className="text-xs">{r.label}</span> },
              { key: 'rows', label: 'Rows', align: 'right', render: (r) => <span className="tabular-nums">{r.value.toLocaleString()}</span> },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- database / API */

export function DatabaseModule({ health }: { health: { data_source: string; seed: number; as_of: string; audit_tail: { event_id: string; event_hash: string } | null } | null }) {
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  useEffect(() => {
    api<ValidationSummary>('/api/platform/validation').then(setSummary).catch(() => setSummary(null));
  }, []);

  const counts = summary ? Object.entries(summary.profile.row_counts) : [];
  const total = counts.reduce((sum, [, value]) => sum + value, 0);

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          { label: 'Store', value: health?.data_source ?? 'unknown', icon: 'database', tone: health ? 'good' : 'critical' },
          { label: 'Rows loaded', value: total, icon: 'data' },
          { label: 'Tables', value: counts.length, icon: 'records' },
          { label: 'Audit head', value: health?.audit_tail?.event_id ?? '—', icon: 'audit' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Store health" subtitle="Which driver is serving this session">
          <dl className="space-y-2.5 text-sm">
            {[
              ['Driver', health?.data_source ?? 'unreachable'],
              ['Dataset as-of', health?.as_of ?? '—'],
              ['Generator seed', String(health?.seed ?? '—')],
              ['Chain head', health?.audit_tail?.event_hash ?? '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 last:border-0" style={{ borderColor: 'var(--border)' }}>
                <dt className="ink-muted text-xs font-medium uppercase tracking-wide">{label}</dt>
                <dd className="mono break-all text-xs">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="ink-muted mt-3 text-xs">
            The API probes PostgreSQL at startup and falls back to the generated files when it is unreachable, so the
            service runs with or without a database provisioned.
          </p>
        </Card>

        <Card title="Table sizes" subtitle="Rows per table in the active store">
          {counts.length === 0 ? (
            <p className="ink-muted py-8 text-center text-sm">No validation report available.</p>
          ) : (
            <CategoryBars data={counts.map(([label, value]) => ({ label: label.replace(/_/g, ' '), value })).sort((a, b) => b.value - a.value)} height={260} />
          )}
        </Card>
      </div>
    </div>
  );
}

const ENDPOINTS: [string, string, string, string][] = [
  ['POST', '/api/auth/login', 'public', '10 / min'],
  ['POST', '/api/auth/register', 'public', '5 / min'],
  ['POST', '/api/verify', 'public', '60 / min'],
  ['GET', '/api/credentials', 'staff, own', '—'],
  ['GET', '/api/issuance/eligible', 'admin, instructor', '—'],
  ['POST', '/api/issuance/issue', 'admin', '—'],
  ['POST', '/api/revocations', 'admin', '—'],
  ['POST', '/api/revocations/:id/rescind', 'platform admin', '—'],
  ['GET', '/api/audit', 'staff', '—'],
  ['GET', '/api/metrics', 'staff', '—'],
  ['GET', '/api/users', 'platform admin', '—'],
  ['POST', '/api/ai/explain-denial', 'staff', '20 / min'],
];

export function ApiModule() {
  return (
    <div className="space-y-4">
      <Banner kind="info">
        <p className="font-semibold">Verification is deliberately public</p>
        <p className="ink-secondary">
          A third party must be able to check a credential without holding an account, so that endpoint is open and rate
          limited rather than authenticated. Everything that changes state requires a role.
        </p>
      </Banner>

      <Card title="Endpoints" subtitle="Role requirement and rate limit per route">
        <RecordTable
          rows={ENDPOINTS.map(([method, path, role, limit]) => ({ method, path, role, limit }))}
          getKey={(r) => `${r.method} ${r.path}`}
          pageSize={20}
          columns={[
            {
              key: 'method',
              label: 'Method',
              render: (r) => (
                <span
                  className="mono rounded px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  {r.method}
                </span>
              ),
            },
            { key: 'path', label: 'Path', render: (r) => <span className="mono text-xs">{r.path}</span> },
            { key: 'role', label: 'Required role', render: (r) => <span className="text-xs">{r.role}</span> },
            { key: 'limit', label: 'Rate limit', render: (r) => <span className="ink-secondary text-xs">{r.limit}</span> },
          ]}
        />
      </Card>
    </div>
  );
}

export { useRows };
export type { ValidationSummary };
