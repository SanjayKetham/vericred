import { Card } from '../components/ui';

interface Health {
  data_source: string;
  ai: string;
  seed: number;
  as_of: string;
  audit_tail: { event_id: string; event_hash: string } | null;
}

/**
 * Platform settings — deliberately read-only.
 *
 * Everything shown here (seed, as-of instant, data source, algorithms) is a property of how the
 * dataset was generated. Making any of it editable at runtime would break the guarantee the rest of
 * the system rests on: that the same inputs always produce the same credential, hash and decision.
 */
export function SettingsPage({ health }: { health: Health | null }) {
  const rows: { label: string; value: string; note: string }[] = [
    {
      label: 'Generator seed',
      value: health ? String(health.seed) : '—',
      note: 'Fixed. Changing it would produce a different dataset and different issuer keys.',
    },
    {
      label: 'Dataset as-of',
      value: health ? health.as_of : '—',
      note: 'A frozen instant, never the wall clock, so the same bytes validate the same way tomorrow.',
    },
    {
      label: 'Data source',
      value: health ? health.data_source : 'unreachable',
      note: 'PostgreSQL via Prisma when DATABASE_URL is reachable, otherwise the generated files.',
    },
    {
      label: 'Hash algorithm',
      value: 'SHA-256 over canonical JSON',
      note: 'Sorted keys, no insignificant whitespace, UTC timestamps — this is what makes verification reproducible.',
    },
    { label: 'Signature algorithm', value: 'Ed25519', note: 'Issuer keys are derived from the seed, so signatures reproduce too.' },
    {
      label: 'AI assistance',
      value: health ? (health.ai === 'openai' ? 'OpenAI structured outputs' : 'deterministic fallback') : '—',
      note: 'Advisory only. The model never participates in an issuance, verification or revocation decision.',
    },
  ];

  return (
    <div className="space-y-4 px-6 pb-8">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Platform configuration" subtitle="Read-only — these values define reproducibility">
          <dl className="space-y-3.5">
            {rows.map((row) => (
              <div key={row.label}>
                <dt className="ink-muted text-xs font-medium uppercase tracking-wide">{row.label}</dt>
                <dd className="mono mt-0.5 break-all text-sm font-semibold">{row.value}</dd>
                <dd className="ink-secondary mt-0.5 text-xs">{row.note}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <div className="space-y-4">
          <Card title="Audit chain head" subtitle="The newest link in the append-only log">
            {health?.audit_tail ? (
              <>
                <p className="ink-muted text-xs">Latest event</p>
                <p className="mono text-sm font-semibold">{health.audit_tail.event_id}</p>
                <p className="ink-muted mt-3 text-xs">Chain hash</p>
                <p className="mono break-all text-xs">{health.audit_tail.event_hash}</p>
                <p className="ink-secondary mt-3 text-xs">
                  Every event hashes the one before it. Altering or removing any historical event breaks every link
                  that follows, which is what makes the trail tamper-evident rather than merely append-ordered.
                </p>
              </>
            ) : (
              <p className="ink-muted text-sm">No audit events available.</p>
            )}
          </Card>

          <Card title="Roles and capabilities" subtitle="Enforced server-side, not just in this UI">
            <table className="w-full text-xs">
              <thead>
                <tr className="ink-muted border-b text-left" style={{ borderColor: 'var(--border)' }}>
                  <th className="py-1.5 font-medium">Role</th>
                  <th className="py-1.5 font-medium">May do</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Platform admin', 'Issue, revoke, rescind, view everything'],
                  ['Academic admin', 'Issue, revoke, view everything'],
                  ['Instructor', 'View credentials, rules and audit'],
                  ['Support', 'View credentials and audit, run case reviews'],
                  ['Learner', 'View only their own credentials'],
                  ['Anyone', 'Verify a credential — no account needed'],
                ].map(([role, may]) => (
                  <tr key={role} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-1.5 font-medium">{role}</td>
                    <td className="ink-secondary py-1.5">{may}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Provenance" subtitle="Lawful use">
            <p className="ink-secondary text-xs">
              Every learner, course, issuer and identifier in this platform is synthetic. No external dataset was
              downloaded, scraped or redistributed, and no real personal information is present. National identifiers
              are synthetic SHA-256 digests, never raw values.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
