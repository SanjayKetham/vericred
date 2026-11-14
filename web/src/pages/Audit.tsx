import { useEffect, useState } from 'react';
import { api, type AuditRow } from '../lib/api';
import { Banner, Card, Field, fmtDate, Spinner } from '../components/ui';

const ENTITY_TYPES = ['', 'CREDENTIAL', 'VERIFICATION', 'REVOCATION', 'COMPLETION', 'ISSUER', 'RULE'];

/**
 * The audit log is append-only and hash-chained: each row carries the hash of the one before it, so
 * removing or editing any historical event would break every link that follows. Showing both hashes
 * makes that property inspectable rather than merely claimed.
 */
export function AuditPage({ search }: { search: string }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');

  // The top bar's search doubles as the entity-id filter here.
  useEffect(() => setEntityId(search), [search]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ limit: '150' });
    if (entityType) params.set('entityType', entityType);
    if (entityId.trim()) params.set('entityId', entityId.trim());
    api<{ rows: AuditRow[] }>(`/api/audit?${params}`)
      .then((r) => setRows(r.rows))
      .catch((caught: Error) => setError(caught.message));
  }, [entityType, entityId]);

  return (
    <div className="space-y-4 px-6 pb-8">
      <p className="ink-secondary text-sm">
        Every state change, in order, each row hash-chained to the one before it. Nothing is ever edited in place.
      </p>

      {error && <Banner kind="critical">{error}</Banner>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Entity type">
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="w-full px-3 py-2 text-sm">
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === '' ? 'all' : t.toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Entity ID">
          <input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="CRD-2026-000001" className="mono w-full px-3 py-2 text-sm" />
        </Field>
      </div>

      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p className="ink-muted py-8 text-center text-sm">No events match this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="ink-muted border-b text-left" style={{ borderColor: 'var(--border)' }}>
                  <th className="py-2 font-medium">Seq</th>
                  <th className="py-2 font-medium">Event</th>
                  <th className="py-2 font-medium">Entity</th>
                  <th className="py-2 font-medium">Actor</th>
                  <th className="py-2 font-medium">When</th>
                  <th className="py-2 font-medium">prev → hash</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.event_id} className="border-b last:border-0 align-top" style={{ borderColor: 'var(--border)' }}>
                    <td className="mono py-1.5 tabular-nums">{row.event_seq}</td>
                    <td className="py-1.5 font-medium">{row.event_type.replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="mono py-1.5">
                      {row.entity_id}
                      <span className="ink-muted block">{row.entity_type.toLowerCase()}</span>
                    </td>
                    <td className="py-1.5">
                      {row.actor_id}
                      <span className="ink-muted block">{row.actor_role.toLowerCase()}</span>
                    </td>
                    <td className="py-1.5">{fmtDate(row.occurred_at)}</td>
                    <td className="mono ink-muted py-1.5">
                      {row.prev_hash.slice(0, 8)} → {row.event_hash.slice(0, 8)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
