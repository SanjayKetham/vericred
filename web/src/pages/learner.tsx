import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { api, type AuditRow, type AuthUser, type Credential } from '../lib/api';
import type { Learner, LearnerCourseRow } from '../lib/domain';
import { Banner, Card, Spinner, StatusPill, fmtDate } from '../components/ui';
import { CopyButton, KpiRow, RecordTable, type Column } from '../components/table';

/**
 * Learner modules.
 *
 * A learner only ever sees their own record: the API refuses a learner_id that is not theirs, so these
 * screens read from the authenticated user's own learner link rather than from a chooser.
 */

function useLearnerData(user: AuthUser) {
  const [courses, setCourses] = useState<LearnerCourseRow[] | null>(null);
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user.learner_id) {
      setCourses([]);
      setCredentials([]);
      return;
    }
    api<{ rows: LearnerCourseRow[] }>(`/api/learners/${user.learner_id}/courses`)
      .then((r) => setCourses(r.rows))
      .catch((caught: Error) => setError(caught.message));
    api<{ rows: Credential[] }>(`/api/credentials?pageSize=100`)
      .then((r) => setCredentials(r.rows))
      .catch((caught: Error) => setError(caught.message));
  }, [user.learner_id]);

  return { courses, credentials, error };
}

function NoLearnerLink() {
  return (
    <Banner kind="info">
      <p className="font-semibold">This account is not linked to a learner record</p>
      <p className="ink-secondary">
        Sign in as <span className="mono">learner@vericred.example</span>, or register again supplying a learner ID such
        as <span className="mono">LRN-000001</span>, to see real courses and certificates here.
      </p>
    </Banner>
  );
}

/* ----------------------------------------------------------- dashboard */

export function LearnerDashboard({ user }: { user: AuthUser }) {
  const { courses, credentials, error } = useLearnerData(user);

  if (error) return <Banner kind="critical">{error}</Banner>;
  if (!user.learner_id) return <NoLearnerLink />;
  if (!courses || !credentials) return <Spinner label="Loading your record" />;

  const completed = courses.filter((c) => c.completion.status === 'COMPLETED').length;
  const inProgress = courses.filter((c) => c.completion.status === 'IN_PROGRESS').length;
  const eligible = courses.filter((c) => c.decision?.decision === 'APPROVED').length;

  // A handful of certificates spread over two years is a timeline, not a trend: a line chart of four
  // points all equal to one says nothing, so the dates themselves are the information.
  const timeline = [...credentials]
    .sort((a, b) => Date.parse(b.issued_at) - Date.parse(a.issued_at))
    .slice(0, 6);

  const averageScore =
    courses.length === 0 ? 0 : Math.round(courses.reduce((sum, c) => sum + c.completion.overall_score, 0) / courses.length);

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          { label: 'Enrolled courses', value: courses.length, icon: 'courses', hint: 'Across all time' },
          { label: 'Completed', value: completed, icon: 'progress', tone: 'good', hint: `${inProgress} still in progress` },
          { label: 'Pending', value: courses.length - completed, icon: 'records', tone: 'warning', hint: 'Not yet completed' },
          { label: 'Certificates earned', value: credentials.length, icon: 'certificate', hint: `${eligible} courses meet their rule` },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Your certificates" subtitle="Newest first">
          {timeline.length === 0 ? (
            <p className="ink-muted py-10 text-center text-sm">No certificates issued yet.</p>
          ) : (
            <ol className="relative space-y-4 pl-5">
              <span aria-hidden="true" className="absolute left-[5px] top-2 bottom-2 w-px" style={{ background: 'var(--border-strong)' }} />
              {timeline.map((credential) => (
                <li key={credential.credential_id} className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full"
                    style={{
                      background: credential.status === 'ACTIVE' ? 'var(--status-good)' : 'var(--status-critical)',
                      outline: '2px solid var(--surface-1)',
                    }}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="mono text-sm font-semibold">{credential.credential_id}</span>
                    <StatusPill status={credential.status} />
                  </div>
                  <p className="ink-muted text-xs">
                    issued {fmtDate(credential.issued_at)} · expires {fmtDate(credential.expires_at)}
                  </p>
                  <p className="ink-secondary mono text-xs">code {credential.verification_code}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="At a glance" subtitle="Your academic record">
          <dl className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="ink-secondary">Average score</dt>
              <dd className="text-lg font-semibold tabular-nums">{averageScore}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="ink-secondary">Courses meeting their rule</dt>
              <dd className="text-lg font-semibold tabular-nums">{eligible}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="ink-secondary">Active certificates</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {credentials.filter((c) => c.status === 'ACTIVE').length}
              </dd>
            </div>
          </dl>
          <p className="ink-muted mt-4 text-xs">
            A certificate is issued only once every requirement in its course rule passes. Course Progress shows which
            requirement is still outstanding.
          </p>
        </Card>
      </div>

      <Card title="Recent courses" subtitle="Newest enrolments first">
        <RecordTable
          rows={[...courses].sort((a, b) => Date.parse(b.completion.enrolled_at) - Date.parse(a.completion.enrolled_at)).slice(0, 8)}
          getKey={(row) => row.completion.completion_id}
          pageSize={8}
          columns={[
            { key: 'course', label: 'Course', render: (r) => <span className="font-medium">{r.course.title}</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.completion.status} /> },
            { key: 'modules', label: 'Modules', align: 'right', render: (r) => `${r.completion.modules_completed_pct}%` },
            { key: 'score', label: 'Score', align: 'right', render: (r) => r.completion.overall_score },
          ]}
        />
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- profile */

export function LearnerProfile({ user }: { user: AuthUser }) {
  const [learner, setLearner] = useState<Learner | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user.learner_id) return;
    api<{ learner: Learner }>(`/api/learners/${user.learner_id}`)
      .then((r) => setLearner(r.learner))
      .catch((caught: Error) => setError(caught.message));
  }, [user.learner_id]);

  if (!user.learner_id) return <NoLearnerLink />;
  if (error) return <Banner kind="critical">{error}</Banner>;
  if (!learner) return <Spinner label="Loading profile" />;

  const fields: [string, string][] = [
    ['Learner ID', learner.learner_id],
    ['Full name', learner.full_name],
    ['Email', learner.email],
    ['Date of birth', learner.date_of_birth],
    ['Country', learner.country],
    ['Enrolled since', fmtDate(learner.enrollment_date)],
    ['Account status', learner.status],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Personal details" subtitle="Held on your learner record">
        <dl className="space-y-3">
          {fields.map(([label, value]) => (
            <div key={label} className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 last:border-0" style={{ borderColor: 'var(--border)' }}>
              <dt className="ink-muted text-xs font-medium uppercase tracking-wide">{label}</dt>
              <dd className="mono text-sm">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="ink-muted mt-4 text-xs">
          Details are read-only here. Corrections are made by an academic administrator, and are recorded as new events
          rather than overwriting what was there before.
        </p>
      </Card>

      <Card title="Why your name is not your identity" subtitle="How verifiers identify you">
        <p className="ink-secondary text-sm">
          Thousands of learners on this platform share a display name. A verifier therefore never identifies you by
          name: they use your credential ID, its verification code, or a hash of your national identifier.
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {[
            ['Credential ID', 'The identifier printed on the certificate itself'],
            ['Verification code', 'A 10-character code you can share publicly'],
            ['National ID hash', 'A one-way digest — the raw number is never stored'],
          ].map(([label, detail]) => (
            <li key={label} className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
              <p className="text-xs font-semibold">{label}</p>
              <p className="ink-muted text-xs">{detail}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- courses */

export function LearnerCourses({ user, search, detailed }: { user: AuthUser; search: string; detailed: boolean }) {
  const { courses, error } = useLearnerData(user);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!user.learner_id) return <NoLearnerLink />;
  if (error) return <Banner kind="critical">{error}</Banner>;
  if (!courses) return <Spinner label="Loading your courses" />;

  const needle = search.trim().toLowerCase();
  const rows = needle
    ? courses.filter((r) => `${r.course.title} ${r.course.course_code} ${r.completion.status}`.toLowerCase().includes(needle))
    : courses;

  if (!detailed) {
    const columns: Column<LearnerCourseRow>[] = [
      { key: 'code', label: 'Code', render: (r) => <span className="mono text-xs">{r.course.course_code}</span> },
      { key: 'title', label: 'Course', render: (r) => <span className="font-medium">{r.course.title}</span> },
      { key: 'level', label: 'Level', render: (r) => <span className="ink-secondary text-xs">{r.course.level.toLowerCase()}</span> },
      { key: 'enrolled', label: 'Enrolled', render: (r) => <span className="text-xs">{fmtDate(r.completion.enrolled_at)}</span> },
      { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.completion.status} /> },
      { key: 'score', label: 'Score', align: 'right', render: (r) => <span className="tabular-nums">{r.completion.overall_score}</span> },
    ];
    return (
      <Card title="Enrolled courses" subtitle={`${rows.length} of ${courses.length} shown`}>
        <RecordTable rows={rows} columns={columns} getKey={(r) => r.completion.completion_id} empty="No courses match." />
      </Card>
    );
  }

  // Course Progress: the same enrolments, opened up to show each requirement and what is outstanding.
  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="ink-muted py-10 text-center text-sm">No courses match.</p>}
      {rows.map((row) => {
        const open = expanded === row.completion.completion_id;
        const bars: [string, number, number][] = [
          ['Modules completed', row.completion.modules_completed_pct, row.rule?.min_modules_completed_pct ?? 100],
          ['Attendance', row.completion.attendance_pct, row.rule?.min_attendance_pct ?? 0],
          ['Overall score', row.completion.overall_score, row.rule?.min_overall_score ?? row.course.passing_score],
        ];
        return (
          <Card key={row.completion.completion_id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{row.course.title}</p>
                <p className="ink-muted mono text-xs">{row.course.course_code}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill status={row.completion.status} />
                {row.decision && <StatusPill status={row.decision.decision} />}
                <button
                  onClick={() => setExpanded(open ? null : row.completion.completion_id)}
                  className="rounded-lg border px-2.5 py-1 text-xs font-semibold"
                  style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
                >
                  {open ? 'Hide requirements' : 'Requirements'}
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {bars.map(([label, actual, required]) => {
                const met = actual >= required;
                return (
                  <div key={label}>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="ink-secondary">{label}</span>
                      <span className="font-semibold tabular-nums">
                        {actual}
                        <span className="ink-muted font-normal"> / {required}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-[6px] w-full overflow-hidden rounded-full" style={{ background: 'var(--grid)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (actual / Math.max(1, required)) * 100)}%`,
                          background: met ? 'var(--status-good)' : 'var(--status-warning)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {open && row.decision && (
              <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                <p className="ink-muted mb-2 text-xs">
                  Evaluated against <span className="mono">{row.decision.rule_id}</span> (version {row.decision.rule_version})
                </p>
                <ul className="space-y-1.5 text-xs">
                  {row.decision.criteria.map((criterion) => (
                    <li key={criterion.criterion} className="flex items-start gap-2">
                      <span aria-hidden="true" className="font-bold" style={{ color: criterion.passed ? 'var(--status-good)' : 'var(--status-critical)' }}>
                        {criterion.passed ? '✓' : '✕'}
                      </span>
                      <span className="ink-secondary">
                        {criterion.criterion.replace(/_/g, ' ')} — needs {String(criterion.required)}, you have{' '}
                        {String(criterion.actual)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------- credentials */

type CredentialMode = 'list' | 'download' | 'share';

export function LearnerCredentials({ user, mode, search }: { user: AuthUser; mode: CredentialMode; search: string }) {
  const { credentials, error } = useLearnerData(user);
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!credentials) return [];
    const needle = search.trim().toLowerCase();
    return needle
      ? credentials.filter((c) => `${c.credential_id} ${c.verification_code} ${c.course_id}`.toLowerCase().includes(needle))
      : credentials;
  }, [credentials, search]);

  if (!user.learner_id) return <NoLearnerLink />;
  if (error) return <Banner kind="critical">{error}</Banner>;
  if (!credentials) return <Spinner label="Loading your certificates" />;
  if (credentials.length === 0) {
    return (
      <Banner kind="info">
        <p className="font-semibold">No certificates yet</p>
        <p className="ink-secondary">A certificate appears here once a course completion passes every rule.</p>
      </Banner>
    );
  }

  const active = rows.find((c) => c.credential_id === selected) ?? rows[0];

  if (mode === 'list') {
    return (
      <Card title="Your certificates" subtitle={`${rows.length} issued to you`}>
        <RecordTable
          rows={rows}
          getKey={(r) => r.credential_id}
          columns={[
            { key: 'id', label: 'Credential', render: (r) => <span className="mono text-xs font-semibold">{r.credential_id}</span> },
            { key: 'course', label: 'Course', render: (r) => <span className="mono text-xs">{r.course_id}</span> },
            { key: 'issued', label: 'Issued', render: (r) => <span className="text-xs">{fmtDate(r.issued_at)}</span> },
            { key: 'expires', label: 'Expires', render: (r) => <span className="text-xs">{fmtDate(r.expires_at)}</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
            { key: 'code', label: 'Code', render: (r) => <span className="mono text-xs">{r.verification_code}</span> },
          ]}
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card title="Choose a certificate" subtitle={`${rows.length} available`}>
        <ul className="space-y-1.5">
          {rows.map((credential) => {
            const chosen = active?.credential_id === credential.credential_id;
            return (
              <li key={credential.credential_id}>
                <button
                  onClick={() => setSelected(credential.credential_id)}
                  className="w-full rounded-xl px-3 py-2 text-left"
                  style={{
                    background: chosen ? 'var(--accent-soft)' : 'var(--surface-2)',
                    border: `1px solid ${chosen ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  <span className="mono block text-xs font-semibold">{credential.credential_id}</span>
                  <span className="ink-muted block text-[11px]">{fmtDate(credential.issued_at)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {active && (mode === 'download' ? <CertificateSheet credential={active} /> : <ShareCard credential={active} />)}
    </div>
  );
}

/** A printable certificate. Printing to PDF is the browser's job — no PDF library needed. */
function CertificateSheet({ credential }: { credential: Credential }) {
  const payload = useMemo(() => {
    try {
      return JSON.parse(credential.payload_json) as {
        learner: { full_name: string; learner_id: string };
        course: { title: string; level: string; credit_hours: number; course_code: string };
        result: { overall_score: number; completed_at: string | null };
        issuer_id: string;
      };
    } catch {
      return null;
    }
  }, [credential.payload_json]);

  if (!payload) return <Card title="Certificate">Could not read this certificate.</Card>;

  return (
    <Card
      title="Certificate"
      subtitle="Print to PDF from your browser, or copy the signed record"
      actions={
        <div className="flex gap-2">
          <CopyButton value={credential.payload_json} label="Copy signed record" />
          <button
            onClick={() => window.print()}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          >
            Print / Save PDF
          </button>
        </div>
      }
    >
      <div className="rounded-2xl p-8 text-center" style={{ border: '2px solid var(--accent)', background: 'var(--surface-2)' }}>
        <p className="ink-muted text-xs font-semibold uppercase tracking-[0.2em]">Certificate of completion</p>
        <p className="mt-5 text-2xl font-semibold">{payload.learner.full_name}</p>
        <p className="ink-secondary mt-1 text-sm">has successfully completed</p>
        <p className="mt-3 text-lg font-semibold">{payload.course.title}</p>
        <p className="ink-secondary mt-1 text-sm">
          {payload.course.level.toLowerCase()} · {payload.course.credit_hours} credit hours · score{' '}
          {payload.result.overall_score}
        </p>

        <div className="mx-auto mt-6 grid max-w-md grid-cols-2 gap-x-6 gap-y-2 text-left text-xs">
          {[
            ['Credential ID', credential.credential_id],
            ['Issued', fmtDate(credential.issued_at)],
            ['Issuer', payload.issuer_id],
            ['Verification code', credential.verification_code],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="ink-muted">{label}</p>
              <p className="mono font-semibold">{value}</p>
            </div>
          ))}
        </div>

        <p className="ink-muted mono mt-6 break-all text-[10px]">SHA-256 {credential.payload_hash}</p>
        <p className="ink-muted mt-1 text-[10px]">
          Sealed with an Ed25519 signature. Verify at any time using the credential ID or verification code.
        </p>
      </div>
    </Card>
  );
}

/** Public share link plus a QR code drawn from scratch — no QR dependency. */
function ShareCard({ credential }: { credential: Credential }) {
  const url = `${window.location.origin}/?verify=${credential.verification_code}`;
  return (
    <Card title="Share this credential" subtitle="Anyone with the link can verify it without an account">
      <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
        <QrCode text={url} />
        <div className="min-w-0 space-y-3">
          <div>
            <p className="ink-muted text-xs font-semibold uppercase tracking-wide">Verification code</p>
            <p className="mono text-xl font-semibold tracking-wider">{credential.verification_code}</p>
          </div>
          <div>
            <p className="ink-muted text-xs font-semibold uppercase tracking-wide">Public link</p>
            <p className="mono break-all text-xs">{url}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={url} label="Copy link" />
            <CopyButton value={credential.verification_code} label="Copy code" />
          </div>
          <p className="ink-muted text-xs">
            Sharing this does not expose your email or identity hash — a verifier sees the course, the issuer, the dates
            and the validity result, and nothing else.
          </p>
        </div>
      </div>
    </Card>
  );
}

/**
 * QR code for the public verification link.
 *
 * The matrix comes from the `qrcode` package rather than a hand-rolled encoder: a QR that renders but
 * does not decode looks completely correct on screen, and an earlier hand-written version did exactly
 * that. Only the drawing is ours, so the code still matches the surrounding theme.
 */
function QrCode({ text, size = 168 }: { text: string; size?: number }) {
  const matrix = useMemo(() => {
    try {
      const code = QRCode.create(text, { errorCorrectionLevel: 'M' });
      const n = code.modules.size;
      const bits = code.modules.data;
      return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => bits[y * n + x] === 1));
    } catch {
      return null;
    }
  }, [text]);

  if (!matrix) {
    return (
      <div
        className="ink-muted flex items-center justify-center rounded-xl p-4 text-center text-xs"
        style={{ width: size, height: size, background: 'var(--surface-2)' }}
      >
        Link too long for a QR code — use the copy button.
      </div>
    );
  }

  const n = matrix.length;
  const quiet = 2;
  const cell = size / (n + quiet * 2);

  return (
    <svg
      width={size}
      height={size}
      role="img"
      aria-label="QR code for the public verification link"
      style={{ background: '#ffffff', borderRadius: 12 }}
      shapeRendering="crispEdges"
    >
      {matrix.flatMap((row, y) =>
        row.map((on, x) =>
          on ? (
            <rect
              key={`${x}-${y}`}
              x={(quiet + x) * cell}
              y={(quiet + y) * cell}
              width={cell}
              height={cell}
              fill="#000000"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

/* -------------------------------------------------------- notifications */

export function LearnerNotifications({ user }: { user: AuthUser }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user.learner_id) {
      setRows([]);
      return;
    }
    api<{ rows: Credential[] }>('/api/credentials?pageSize=50')
      .then(async (credentials) => {
        const lists = await Promise.all(
          credentials.rows.slice(0, 10).map((credential) =>
            api<{ rows: AuditRow[] }>(`/api/audit?entityId=${credential.credential_id}&limit=10`)
              .then((r) => r.rows)
              .catch(() => []),
          ),
        );
        setRows(lists.flat().sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)));
      })
      .catch((caught: Error) => setError(caught.message));
  }, [user.learner_id]);

  if (!user.learner_id) return <NoLearnerLink />;
  if (error) return <Banner kind="critical">{error}</Banner>;
  if (!rows) return <Spinner label="Loading notifications" />;

  return (
    <Card title="Notifications" subtitle="Events recorded against your certificates">
      {rows.length === 0 ? (
        <p className="ink-muted py-10 text-center text-sm">Nothing to report yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((event) => (
            <li key={event.event_id} className="flex gap-3 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
              <span
                aria-hidden="true"
                className="mt-1 h-2 w-2 shrink-0 rounded-full"
                style={{
                  background:
                    event.event_type === 'REVOKED'
                      ? 'var(--status-critical)'
                      : event.event_type === 'CREDENTIAL_ISSUED'
                        ? 'var(--status-good)'
                        : 'var(--accent)',
                }}
              />
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{event.event_type.replace(/_/g, ' ').toLowerCase()}</span>{' '}
                <span className="mono ink-secondary break-all text-xs">{event.entity_id}</span>
                <span className="ink-muted block text-xs">{fmtDate(event.occurred_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
