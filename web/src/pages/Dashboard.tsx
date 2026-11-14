import { useEffect, useState } from 'react';
import { api, type AuditRow, type Metrics } from '../lib/api';
import { ActivityHeatmap, AreaTrend, CategoryBars, DataTable, DonutGauge, ShareRows, Sparkline } from '../components/charts';
import { Banner, Card, Spinner, StatusPill } from '../components/ui';

const pretty = (key: string): string => key.replace(/^INVALID_/, '').replace(/_/g, ' ').toLowerCase();

/** "4m", "3h", "6d" — relative to the newest event, which is what the feed is anchored on. */
function since(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const EVENT_TONE: Record<string, string> = {
  CREDENTIAL_ISSUED: 'var(--status-good)',
  ISSUANCE_APPROVED: 'var(--status-good)',
  ISSUANCE_DENIED: 'var(--status-warning)',
  REVOKED: 'var(--status-critical)',
  REVOCATION_RESCINDED: 'var(--status-serious)',
  VERIFICATION_COMPLETED: 'var(--series-1)',
  VERIFICATION_REQUESTED: 'var(--series-1)',
  EXPIRED: 'var(--status-warning)',
};

export function DashboardPage({ range, search }: { range: string; search: string }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [activity, setActivity] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showTables, setShowTables] = useState(false);

  useEffect(() => {
    api<Metrics>('/api/metrics')
      .then(setMetrics)
      .catch((caught: Error) => setError(caught.message));
    api<{ rows: AuditRow[] }>('/api/audit?limit=14')
      .then((r) => setActivity(r.rows))
      .catch(() => setActivity([]));
  }, []);

  if (error) return <div className="px-6 pb-6"><Banner kind="critical">{error}</Banner></div>;
  if (!metrics) return <Spinner label="Loading metrics" />;

  const toRows = (record: Record<string, number>) =>
    Object.entries(record)
      .map(([label, value]) => ({ label: pretty(label), value }))
      .sort((a, b) => b.value - a.value);

  const verificationRows = toRows(metrics.verification_result);
  const revocationRows = toRows(metrics.revocation_reason);
  const identityRows = toRows(metrics.identity_match_method);

  const totalVerifications = Object.values(metrics.verification_result).reduce((a, b) => a + b, 0);
  const validCount = metrics.verification_result.VALID ?? 0;
  const validShare = totalVerifications === 0 ? 0 : (100 * validCount) / totalVerifications;
  const revoked = metrics.credential_status.REVOKED ?? 0;
  const active = metrics.credential_status.ACTIVE ?? 0;
  const credentialTotal = Object.values(metrics.credential_status).reduce((a, b) => a + b, 0);

  // The trailing month in a fixed as-of dataset is partial, so headline deltas compare the two months
  // before it rather than flattering the number with an incomplete one.
  const issuance = metrics.issuance_by_month;
  const lastFull = issuance[issuance.length - 2]?.issued ?? 0;
  const priorFull = issuance[issuance.length - 3]?.issued ?? 0;
  const issuanceDelta = priorFull === 0 ? 0 : ((lastFull - priorFull) / priorFull) * 100;

  const activityNow = activity.length > 0 ? Date.parse(activity[0]!.occurred_at) : Date.now();
  const filteredActivity = search.trim()
    ? activity.filter((e) => `${e.entity_id} ${e.event_type} ${e.actor_id}`.toLowerCase().includes(search.trim().toLowerCase()))
    : activity;

  const rangeWindow = range === 'Daily' ? 12 : range === 'Weekly' ? 24 : issuance.length;
  const trend = issuance.slice(-rangeWindow);
  const verificationTrend = metrics.verification_by_month.slice(-rangeWindow);

  return (
    <div className="space-y-4 px-6 pb-8">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* ---------------------------------------------------- main column */}
        <div className="min-w-0 space-y-4">
          {/* Hero */}
          <section
            className="relative overflow-hidden rounded-2xl p-6"
            style={{ background: 'var(--hero)', color: 'var(--on-accent)' }}
          >
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="min-w-0">
                <p className="text-sm font-medium opacity-90">Credentials issued</p>
                <p className="mt-1 text-[56px] font-semibold leading-none tabular-nums">
                  {(metrics.totals.credentials ?? 0).toLocaleString()}
                </p>
                <p
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                  style={{ background: 'rgba(255,255,255,0.18)' }}
                >
                  <span aria-hidden="true">{issuanceDelta >= 0 ? '↗' : '↘'}</span>
                  {issuanceDelta >= 0 ? '+' : ''}
                  {issuanceDelta.toFixed(1)}% vs previous month
                </p>
                <p className="mt-4 text-sm opacity-90">
                  {active.toLocaleString()} active · {revoked.toLocaleString()} revoked ·{' '}
                  {(metrics.totals.revocations ?? 0).toLocaleString()} revocation events
                </p>
              </div>

              <DonutGauge
                value={validShare}
                label="verify as valid"
                size={176}
                trackColor="rgba(255,255,255,0.22)"
                valueColor="#ffffff"
              />
            </div>
          </section>

          {/* Three stat cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card title="Issuance volume" subtitle={`Credentials per month · last ${trend.length}`}>
              <AreaTrend data={trend as unknown as Record<string, number | string>[]} dataKey="issued" name="Issued" height={170} />
            </Card>

            <Card title="Verification outcomes" subtitle="Share of all requests">
              <div className="flex items-center justify-center py-1">
                <DonutGauge value={validShare} label="returned valid" size={150} />
              </div>
              <div className="ink-secondary mt-2 flex items-center justify-center gap-4 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} aria-hidden="true" />
                  {validCount.toLocaleString()} valid
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: 'var(--series-2)' }} aria-hidden="true" />
                  {(totalVerifications - validCount).toLocaleString()} not valid
                </span>
              </div>
            </Card>

            <Card title="Verification activity" subtitle="Requests per day · last 6 weeks">
              <ActivityHeatmap data={metrics.activity_heatmap} />
            </Card>
          </div>

          {/* Issuer sparkline row */}
          <div className="grid gap-4 md:grid-cols-3">
            {metrics.issuer_trends.map((issuer) => (
              <Card key={issuer.issuer_id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                      aria-hidden="true"
                    >
                      {issuer.legal_name.charAt(0)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{issuer.legal_name.split(' ').slice(0, 2).join(' ')}</p>
                      <p className="ink-muted mono text-[11px]">{issuer.issuer_id}</p>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-[26px] font-semibold leading-none tabular-nums">{issuer.total.toLocaleString()}</p>
                <p
                  className="mt-1 text-xs font-medium"
                  style={{ color: issuer.delta_pct >= 0 ? 'var(--status-good)' : 'var(--status-critical)' }}
                >
                  <span aria-hidden="true">{issuer.delta_pct >= 0 ? '▲' : '▼'}</span> {Math.abs(issuer.delta_pct).toFixed(1)}% month on month
                </p>
                <div className="mt-2">
                  <Sparkline data={issuer.points} tone={issuer.delta_pct >= 0 ? 'primary' : 'critical'} />
                </div>
              </Card>
            ))}
          </div>

          {/* Breakdown row */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Why verifications failed"
              subtitle="Every outcome the engine can return"
              actions={
                <button onClick={() => setShowTables((v) => !v)} className="ink-secondary text-xs underline underline-offset-2">
                  {showTables ? 'Hide table' : 'Table'}
                </button>
              }
            >
              <CategoryBars data={verificationRows} highlight={(label) => label !== 'valid'} height={200} />
              {showTables && (
                <div className="mt-4">
                  <DataTable caption="Verification outcomes" data={verificationRows} />
                </div>
              )}
            </Card>

            <Card title="Revocation reasons" subtitle="Recorded cause for each withdrawal">
              <CategoryBars data={revocationRows} height={200} />
              {showTables && (
                <div className="mt-4">
                  <DataTable caption="Revocation reasons" data={revocationRows} />
                </div>
              )}
            </Card>

            <Card
              title="Identity evidence used"
              subtitle="A name alone never yields a valid result"
            >
              <CategoryBars data={identityRows} highlight={(label) => label === 'name only'} height={185} />
            </Card>

            <Card title="Verification volume" subtitle="Valid against all other outcomes, per month">
              <AreaTrend
                data={verificationTrend as unknown as Record<string, number | string>[]}
                dataKey="valid"
                name="Valid"
                height={185}
              />
            </Card>
          </div>
        </div>

        {/* ------------------------------------------------------ right rail */}
        <div className="space-y-4">
          <Card title="Credential status" subtitle={`${credentialTotal.toLocaleString()} credentials`}>
            <ul className="space-y-2.5">
              {toRows(metrics.credential_status).map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-3">
                  <StatusPill status={row.label.toUpperCase().replace(/ /g, '_')} />
                  <span className="text-sm font-semibold tabular-nums">{row.value.toLocaleString()}</span>
                </li>
              ))}
            </ul>
            <p className="ink-muted mt-3 text-[11px]">
              Status is re-derived by replaying revocations and expiry, never stored as a mutable flag.
            </p>
          </Card>

          <Card
            title="Live activity"
            subtitle="Newest events in the hash-chained audit log"
            actions={<span className="ink-muted whitespace-nowrap text-[11px]">{filteredActivity.length} shown</span>}
          >
            <ul className="max-h-[320px] space-y-3 overflow-y-auto scroll-thin pr-1">
              {filteredActivity.map((event) => (
                <li key={event.event_id} className="flex gap-2.5 text-xs">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: EVENT_TONE[event.event_type] ?? 'var(--text-muted)' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{event.event_type.replace(/_/g, ' ').toLowerCase()}</span>{' '}
                    <span className="ink-secondary mono break-all">{event.entity_id}</span>
                    <span className="ink-muted block">
                      {event.actor_role.replace(/_/g, ' ').toLowerCase()} · {since(event.occurred_at, activityNow)} ago
                    </span>
                  </span>
                </li>
              ))}
              {filteredActivity.length === 0 && <li className="ink-muted text-xs">No events match this search.</li>}
            </ul>
          </Card>

          <Card title="Issuer distribution" subtitle="Share of issued credentials">
            <ShareRows
              data={metrics.issuer_usage
                .map((i) => ({ label: `${i.legal_name.split(' ').slice(0, 2).join(' ')}`, value: i.credentials }))
                .sort((a, b) => b.value - a.value)}
            />
          </Card>

          <Card title="Verification latency" subtitle="Milliseconds to return a decision">
            <div className="grid grid-cols-3 gap-2 text-center">
              {(['p50', 'p90', 'p99'] as const).map((key) => (
                <div key={key} className="rounded-xl py-2.5" style={{ background: 'var(--surface-2)' }}>
                  <p className="ink-muted text-[11px] font-semibold uppercase tracking-wide">{key}</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums">{metrics.latency[key]}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
