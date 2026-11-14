import { useEffect, useMemo, useState } from 'react';
import { api, type AuditRow, type Metrics } from '../lib/api';
import type { Course, IssuanceDecision, CompletionRecord, CredentialRule, VerificationRequest } from '../lib/domain';
import { ActivityHeatmap, AreaTrend, CategoryBars, DonutGauge, ShareRows } from '../components/charts';
import { Banner, Card, Spinner, StatusPill, fmtDate } from '../components/ui';
import { KpiRow, RecordTable, Select, Toolbar, type Column } from '../components/table';

/** Role dashboards. Each answers the question its role actually has, rather than showing the same tiles. */

interface EligibleRow {
  completion: CompletionRecord;
  learner: { learner_id: string; full_name: string; email: string };
  course: { course_id: string; title: string; passing_score: number };
  rule: CredentialRule;
  decision: IssuanceDecision;
}

function useMetrics() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Metrics>('/api/metrics')
      .then(setMetrics)
      .catch((caught: Error) => setError(caught.message));
  }, []);
  return { metrics, error };
}

/* ------------------------------------------------------------ instructor */

export function InstructorDashboard() {
  const { metrics, error } = useMetrics();
  const [eligible, setEligible] = useState<EligibleRow[] | null>(null);
  const [courses, setCourses] = useState<Course[] | null>(null);

  useEffect(() => {
    api<{ rows: EligibleRow[] }>('/api/issuance/eligible?limit=120')
      .then((r) => setEligible(r.rows))
      .catch(() => setEligible([]));
    api<{ rows: Course[] }>('/api/courses?limit=200')
      .then((r) => setCourses(r.rows))
      .catch(() => setCourses([]));
  }, []);

  if (error) return <Banner kind="critical">{error}</Banner>;
  if (!metrics || !eligible || !courses) return <Spinner label="Loading your teaching overview" />;

  const approved = eligible.filter((r) => r.decision.decision === 'APPROVED');
  const denied = eligible.filter((r) => r.decision.decision === 'DENIED');
  const learners = new Set(eligible.map((r) => r.learner.learner_id)).size;

  const blockers = new Map<string, number>();
  for (const row of denied) for (const criterion of row.decision.failed_criteria) blockers.set(criterion, (blockers.get(criterion) ?? 0) + 1);
  const blockerRows = [...blockers.entries()]
    .map(([label, value]) => ({ label: label.replace(/_/g, ' '), value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          {
            label: 'Courses in catalogue',
            value: metrics.totals.courses ?? courses.length,
            icon: 'courses',
            // There is no instructor-to-course assignment table yet, so claiming "assigned to you"
            // would be a number the data cannot support.
            hint: 'Per-instructor assignment is not modelled yet',
          },
          { label: 'Learners in view', value: learners, icon: 'learners' },
          { label: 'Assessments pending', value: denied.filter((r) => r.decision.failed_criteria.some((c) => c.includes('assessment') || c.includes('score'))).length, icon: 'assessment', tone: 'warning' },
          { label: 'Eligible learners', value: approved.length, icon: 'eligibility', tone: 'good', hint: 'Meet every requirement' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="What is blocking the rest" subtitle="Failed criteria across completions awaiting a credential">
          {blockerRows.length === 0 ? (
            <p className="ink-muted py-10 text-center text-sm">Nothing is blocked in this view.</p>
          ) : (
            <CategoryBars data={blockerRows} highlight={() => true} height={210} />
          )}
          <p className="ink-muted mt-3 text-xs">
            Each bar is a specific rule criterion, so the queue tells you what to teach or re-assess, not merely that a
            learner failed.
          </p>
        </Card>

        <Card title="Completion mix" subtitle="Every enrolment on the platform">
          <ShareRows
            data={Object.entries(metrics.credential_status).map(([label, value]) => ({
              label: label.toLowerCase(),
              value,
            }))}
          />
          <p className="ink-muted mt-3 text-xs">
            Status is derived from attendance, modules and assessments — never set by hand.
          </p>
        </Card>
      </div>

      <Card title="Learners closest to a credential" subtitle="Denied, but failing only one criterion">
        <RecordTable
          rows={denied.filter((r) => r.decision.failed_criteria.length === 1).slice(0, 30)}
          getKey={(r) => r.completion.completion_id}
          pageSize={8}
          empty="No learner is a single criterion away right now."
          columns={[
            { key: 'learner', label: 'Learner', render: (r) => <span className="font-medium">{r.learner.full_name}</span> },
            { key: 'id', label: 'ID', render: (r) => <span className="mono text-xs">{r.learner.learner_id}</span> },
            { key: 'course', label: 'Course', render: (r) => <span className="text-xs">{r.course.title}</span> },
            {
              key: 'blocker',
              label: 'Outstanding',
              render: (r) => (
                <span className="text-xs font-semibold" style={{ color: 'var(--status-warning)' }}>
                  {r.decision.failed_criteria[0]?.replace(/_/g, ' ')}
                </span>
              ),
            },
            { key: 'score', label: 'Score', align: 'right', render: (r) => r.completion.overall_score },
          ]}
        />
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- support */

export function SupportDashboard() {
  const { metrics, error } = useMetrics();
  const [failed, setFailed] = useState<VerificationRequest[] | null>(null);

  useEffect(() => {
    api<{ rows: VerificationRequest[] }>('/api/verifications?limit=400&result=FAILED')
      .then((r) => setFailed(r.rows))
      .catch(() => setFailed([]));
  }, []);

  if (error) return <Banner kind="critical">{error}</Banner>;
  if (!metrics || !failed) return <Spinner label="Loading support overview" />;

  const byReason = new Map<string, number>();
  for (const row of failed) byReason.set(row.result, (byReason.get(row.result) ?? 0) + 1);
  const reasons = [...byReason.entries()]
    .map(([label, value]) => ({ label: label.replace(/^INVALID_/, '').replace(/_/g, ' ').toLowerCase(), value }))
    .sort((a, b) => b.value - a.value);

  const revoked = failed.filter((v) => v.result === 'INVALID_REVOKED').length;
  const tampered = failed.filter((v) => v.result === 'INVALID_HASH_MISMATCH').length;
  const unknown = failed.filter((v) => v.result === 'INVALID_NOT_FOUND').length;
  const identity = failed.filter((v) => v.result === 'INVALID_IDENTITY_MISMATCH').length;

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          { label: 'Open investigations', value: failed.length, icon: 'magnifier' as never, tone: 'warning', hint: 'Verifications that did not return valid' },
          { label: 'Revoked credential presented', value: revoked, icon: 'revoke', tone: 'critical' },
          { label: 'Record did not match its seal', value: tampered, icon: 'key', tone: 'critical' },
          { label: 'Unknown reference', value: unknown, icon: 'history', tone: 'warning' },
          { label: 'Identity too weak', value: identity, icon: 'shield', tone: 'warning' },
          { label: 'Median response', value: `${metrics.latency.p50} ms`, icon: 'history', tone: 'good' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Why verifications failed" subtitle="The queue, grouped by cause">
          <CategoryBars data={reasons} highlight={() => true} height={210} />
        </Card>

        <Card title="How to handle each cause" subtitle="What support can and cannot change">
          <ul className="space-y-2">
            {[
              ['Revoked credential', 'Explain the revocation reason. Support cannot reinstate it — an administrator must rescind.'],
              ['Hash mismatch', 'The presented copy differs from the sealed record. Ask the holder to re-share from their account.'],
              ['Unknown reference', 'Usually a typo. Confirm the credential ID or the 10-character verification code.'],
              ['Identity too weak', 'The verifier matched on a name. Ask them to use the credential ID or verification code.'],
            ].map(([cause, action]) => (
              <li key={cause} className="rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
                <p className="text-sm font-semibold">{cause}</p>
                <p className="ink-muted text-xs">{action}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Most recent failures" subtitle="Newest first">
        <RecordTable
          rows={failed.slice(0, 40)}
          getKey={(r) => r.verification_id}
          pageSize={8}
          columns={[
            { key: 'id', label: 'Request', render: (r) => <span className="mono text-xs font-semibold">{r.verification_id}</span> },
            { key: 'ref', label: 'Presented', render: (r) => <span className="mono text-xs">{r.requested_credential_ref}</span> },
            { key: 'verifier', label: 'Verifier', render: (r) => <span className="text-xs">{r.verifier_name}</span> },
            { key: 'result', label: 'Result', render: (r) => <StatusPill status={r.result} /> },
            { key: 'at', label: 'When', render: (r) => <span className="text-xs">{fmtDate(r.requested_at)}</span> },
          ]}
        />
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------- platform */

export function PlatformDashboard({ health }: { health: { data_source: string; seed: number; ai: string } | null }) {
  const { metrics, error } = useMetrics();
  const [users, setUsers] = useState<{ role: string }[] | null>(null);
  const [validation, setValidation] = useState<{ totals: { checks_run: number; checks_passed: number; violations_unexpected: number }; anomaly_detection: { overall: { expected: number; detected: number; f1: number } } } | null>(null);
  const [activity, setActivity] = useState<AuditRow[]>([]);

  useEffect(() => {
    api<{ rows: { role: string }[] }>('/api/users').then((r) => setUsers(r.rows)).catch(() => setUsers([]));
    api<typeof validation>('/api/platform/validation').then(setValidation).catch(() => setValidation(null));
    api<{ rows: AuditRow[] }>('/api/audit?limit=12').then((r) => setActivity(r.rows)).catch(() => setActivity([]));
  }, []);

  if (error) return <Banner kind="critical">{error}</Banner>;
  if (!metrics || !users) return <Spinner label="Loading system overview" />;

  const totalRequests = (metrics.totals.verifications ?? 0) + (metrics.totals.credentials ?? 0);
  const incidents = (metrics.verification_result.INVALID_HASH_MISMATCH ?? 0) + (metrics.verification_result.INVALID_IDENTITY_MISMATCH ?? 0);
  const checksPassing = validation ? `${validation.totals.checks_passed}/${validation.totals.checks_run}` : '—';

  return (
    <div className="space-y-4">
      <KpiRow
        items={[
          { label: 'Registered users', value: users.length, icon: 'users' },
          { label: 'Active institutions', value: metrics.issuer_usage.length, icon: 'institution' },
          { label: 'Requests recorded', value: totalRequests, icon: 'api', hint: 'Verifications and issuances' },
          { label: 'Security incidents', value: incidents, icon: 'shield', tone: incidents > 0 ? 'warning' : 'good', hint: 'Tamper and identity failures' },
          { label: 'Validation checks', value: checksPassing, icon: 'data', tone: validation && validation.totals.violations_unexpected === 0 ? 'good' : 'critical' },
          { label: 'Detected anomalies', value: validation?.anomaly_detection.overall.detected ?? '—', icon: 'anomaly', hint: validation ? `F1 ${validation.anomaly_detection.overall.f1.toFixed(3)}` : undefined },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Platform load" subtitle="Credentials issued per month">
              <AreaTrend
                data={metrics.issuance_by_month.slice(-24) as unknown as Record<string, number | string>[]}
                dataKey="issued"
                name="Issued"
                height={190}
              />
            </Card>
            <Card title="Verification activity" subtitle="Requests per day, last 6 weeks">
              <ActivityHeatmap data={metrics.activity_heatmap} />
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Identity evidence" subtitle="How verifiers identify a subject">
              <CategoryBars
                data={Object.entries(metrics.identity_match_method)
                  .map(([label, value]) => ({ label: label.replace(/_/g, ' ').toLowerCase(), value }))
                  .sort((a, b) => b.value - a.value)}
                highlight={(label) => label === 'name only'}
                height={190}
              />
            </Card>
            <Card title="System availability" subtitle="What this session is talking to">
              <div className="flex items-center justify-center py-2">
                <DonutGauge value={health ? 100 : 0} label={health ? 'API reachable' : 'API down'} size={150} />
              </div>
              <dl className="ink-secondary mt-2 space-y-1.5 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="ink-muted">Store</dt>
                  <dd className="mono">{health?.data_source ?? 'unreachable'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="ink-muted">AI assistance</dt>
                  <dd className="mono">{health?.ai ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="ink-muted">Generator seed</dt>
                  <dd className="mono">{health?.seed ?? '—'}</dd>
                </div>
              </dl>
            </Card>
          </div>
        </div>

        <div className="space-y-4">
          <Card title="Accounts by role" subtitle={`${users.length} able to sign in`}>
            <ShareRows
              data={[...new Set(users.map((u) => u.role))].map((role) => ({
                label: role.replace(/_/g, ' ').toLowerCase(),
                value: users.filter((u) => u.role === role).length,
              }))}
            />
          </Card>

          <Card title="System activity" subtitle="Newest audit events">
            <ul className="max-h-[300px] space-y-2.5 overflow-y-auto scroll-thin pr-1">
              {activity.map((event) => (
                <li key={event.event_id} className="text-xs">
                  <span className="font-semibold">{event.event_type.replace(/_/g, ' ').toLowerCase()}</span>{' '}
                  <span className="mono ink-secondary break-all">{event.entity_id}</span>
                  <span className="ink-muted block">
                    {event.actor_role.replace(/_/g, ' ').toLowerCase()} · {fmtDate(event.occurred_at)}
                  </span>
                </li>
              ))}
              {activity.length === 0 && <li className="ink-muted text-xs">No events.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------- completion records module */

export function CompletionsModule({ search, focus }: { search: string; focus: 'records' | 'attendance' | 'assessments' }) {
  const [rows, setRows] = useState<EligibleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('ALL');

  useEffect(() => {
    api<{ rows: EligibleRow[] }>('/api/issuance/eligible?limit=200')
      .then((r) => setRows(r.rows))
      .catch((caught: Error) => setError(caught.message));
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== 'ALL' && row.decision.decision !== status) return false;
      if (!needle) return true;
      return `${row.completion.completion_id} ${row.learner.full_name} ${row.learner.learner_id} ${row.course.title}`
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, search, status]);

  if (error) return <Banner kind="critical">{error}</Banner>;
  if (!rows) return <Spinner label="Loading completion records" />;

  const base: Column<EligibleRow>[] = [
    { key: 'learner', label: 'Learner', render: (r) => <span className="font-medium">{r.learner.full_name}</span>, value: (r) => r.learner.full_name },
    { key: 'id', label: 'Learner ID', render: (r) => <span className="mono text-xs">{r.learner.learner_id}</span>, value: (r) => r.learner.learner_id },
    { key: 'course', label: 'Course', render: (r) => <span className="text-xs">{r.course.title}</span>, value: (r) => r.course.title },
  ];

  const focusColumns: Record<typeof focus, Column<EligibleRow>[]> = {
    records: [
      { key: 'modules', label: 'Modules', align: 'right', render: (r) => `${r.completion.modules_completed_pct}%`, value: (r) => r.completion.modules_completed_pct },
      { key: 'score', label: 'Score', align: 'right', render: (r) => r.completion.overall_score, value: (r) => r.completion.overall_score },
      { key: 'completed', label: 'Completed', render: (r) => <span className="text-xs">{fmtDate(r.completion.completed_at)}</span>, value: (r) => r.completion.completed_at ?? '' },
      { key: 'decision', label: 'Decision', render: (r) => <StatusPill status={r.decision.decision} />, value: (r) => r.decision.decision },
    ],
    attendance: [
      { key: 'attendance', label: 'Attendance', align: 'right', render: (r) => `${r.completion.attendance_pct}%`, value: (r) => r.completion.attendance_pct },
      { key: 'required', label: 'Required', align: 'right', render: (r) => `${r.rule.min_attendance_pct}%`, value: (r) => r.rule.min_attendance_pct },
      {
        key: 'met',
        label: 'Meets rule',
        render: (r) => <StatusPill status={r.completion.attendance_pct >= r.rule.min_attendance_pct ? 'PASS' : 'FAIL'} />,
        value: (r) => (r.completion.attendance_pct >= r.rule.min_attendance_pct ? 'PASS' : 'FAIL'),
      },
      { key: 'activity', label: 'Last activity', render: (r) => <span className="text-xs">{fmtDate(r.completion.last_activity_at)}</span>, value: (r) => r.completion.last_activity_at },
    ],
    assessments: [
      { key: 'taken', label: 'Taken', align: 'right', render: (r) => r.completion.assessments_taken, value: (r) => r.completion.assessments_taken },
      { key: 'passed', label: 'Passed', align: 'right', render: (r) => r.completion.assessments_passed, value: (r) => r.completion.assessments_passed },
      { key: 'required', label: 'Required', align: 'right', render: (r) => r.rule.required_assessments_passed, value: (r) => r.rule.required_assessments_passed },
      { key: 'score', label: 'Score', align: 'right', render: (r) => r.completion.overall_score, value: (r) => r.completion.overall_score },
      { key: 'pass', label: 'Pass mark', align: 'right', render: (r) => r.course.passing_score, value: (r) => r.course.passing_score },
    ],
  };

  const title =
    focus === 'attendance' ? 'Attendance register' : focus === 'assessments' ? 'Assessment results' : 'Completion records';

  return (
    <div className="space-y-4">
      {focus !== 'records' && (
        <Banner kind="info">
          <p className="font-semibold">Read-only in this version</p>
          <p className="ink-secondary">
            {focus === 'attendance'
              ? 'Attendance is shown against the minimum each course rule requires. Recording new attendance is part of Grade Management, which is not built yet.'
              : 'Assessment results are shown against the rule in force. Submitting new scores is part of Grade Management, which is not built yet.'}
          </p>
        </Banner>
      )}

      <Card
        title={title}
        subtitle={`${filtered.length} of ${rows.length} completions awaiting a credential`}
        actions={
          <Toolbar>
            <Select
              label="Decision"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'ALL', label: 'all' },
                { value: 'APPROVED', label: 'meets rule' },
                { value: 'DENIED', label: 'blocked' },
              ]}
            />
          </Toolbar>
        }
      >
        <RecordTable
          rows={filtered}
          columns={[...base, ...focusColumns[focus]]}
          getKey={(r) => r.completion.completion_id}
          empty="No completion records match."
        />
      </Card>
    </div>
  );
}
