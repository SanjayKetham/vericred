import { useEffect, useMemo, useState } from 'react';
import { api, type Credential } from '../lib/api';
import { Banner, Button, Card, Spinner, StatusPill, fmtDate } from '../components/ui';

/**
 * Learner-centred view of the credential estate.
 *
 * It exists to make one point concrete: learners share names. The list groups credentials by
 * `learner_id`, shows how many other learners carry the same display name, and never offers the name
 * as a way to identify someone — which is the acceptance criterion "identity matching does not rely on
 * name alone", shown rather than asserted.
 */
export function LearnersPage({ search }: { search: string }) {
  const [rows, setRows] = useState<Credential[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const params = new URLSearchParams({ page: '1', pageSize: '100' });
    if (search.trim()) params.set('search', search.trim());
    api<{ rows: Credential[] }>(`/api/credentials?${params}`)
      .then((r) => setRows(r.rows))
      .catch((caught: Error) => setError(caught.message));
    setPage(1);
  }, [search]);

  const learners = useMemo(() => {
    if (!rows) return [];
    const byLearner = new Map<string, { learner_id: string; credentials: Credential[] }>();
    for (const row of rows) {
      const entry = byLearner.get(row.learner_id) ?? { learner_id: row.learner_id, credentials: [] };
      entry.credentials.push(row);
      byLearner.set(row.learner_id, entry);
    }
    return [...byLearner.values()]
      .map((entry) => {
        const subject = (() => {
          try {
            return (JSON.parse(entry.credentials[0]!.payload_json) as { learner: { full_name: string } }).learner.full_name;
          } catch {
            return entry.learner_id;
          }
        })();
        return {
          ...entry,
          full_name: subject,
          active: entry.credentials.filter((c) => c.status === 'ACTIVE').length,
          revoked: entry.credentials.filter((c) => c.status === 'REVOKED').length,
          latest: entry.credentials.map((c) => c.issued_at).sort().at(-1) ?? null,
        };
      })
      .sort((a, b) => b.credentials.length - a.credentials.length);
  }, [rows]);

  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const learner of learners) counts.set(learner.full_name, (counts.get(learner.full_name) ?? 0) + 1);
    return counts;
  }, [learners]);

  if (error) return <div className="px-6 pb-6"><Banner kind="critical">{error}</Banner></div>;
  if (!rows) return <Spinner label="Loading learners" />;

  const pageSize = 12;
  const pages = Math.max(1, Math.ceil(learners.length / pageSize));
  const visible = learners.slice((page - 1) * pageSize, page * pageSize);
  const sharedNames = [...nameCounts.values()].filter((n) => n > 1).length;

  return (
    <div className="space-y-4 px-6 pb-8">
      <Banner kind="info">
        <p className="font-semibold">Names are not identifiers</p>
        <p className="ink-secondary">
          {sharedNames === 1
            ? '1 display name on this page is shared by more than one learner.'
            : `${sharedNames} display names on this page are shared by more than one learner.`}{' '}
          Every lookup here keys on <span className="mono">learner_id</span>; verification keys on the credential ID,
          verification code or national-ID hash.
        </p>
      </Banner>

      <Card
        title="Learners holding credentials"
        subtitle={`${learners.length} learners across ${rows.length} credentials${search.trim() ? ' matching your search' : ' in the most recent page'}`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="ink-muted border-b text-left text-xs" style={{ borderColor: 'var(--border)' }}>
                <th className="py-2 font-medium">Learner</th>
                <th className="py-2 font-medium">Display name</th>
                <th className="py-2 pr-6 text-right font-medium">Credentials</th>
                <th className="py-2 pr-6 text-right font-medium">Active</th>
                <th className="py-2 pr-6 text-right font-medium">Revoked</th>
                <th className="py-2 font-medium">Latest issue</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((learner) => {
                const shared = (nameCounts.get(learner.full_name) ?? 1) > 1;
                return (
                  <tr key={learner.learner_id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                    <td className="mono py-2 text-xs">{learner.learner_id}</td>
                    <td className="py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        {learner.full_name}
                        {shared && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                            title="More than one learner on this page carries this name"
                          >
                            shared name
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2 pr-6 text-right tabular-nums">{learner.credentials.length}</td>
                    <td className="py-2 pr-6 text-right tabular-nums">{learner.active}</td>
                    <td className="py-2 pr-6 text-right tabular-nums">{learner.revoked}</td>
                    <td className="ink-secondary py-2 text-xs">{fmtDate(learner.latest)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

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

      <Card title="Credentials in view" subtitle="Grouped by learner above; listed individually here">
        <ul className="space-y-2">
          {visible.flatMap((learner) =>
            learner.credentials.slice(0, 3).map((credential) => (
              <li
                key={credential.credential_id + credential.completion_id}
                className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 text-xs"
                style={{ background: 'var(--surface-2)' }}
              >
                <span className="mono font-semibold">{credential.credential_id}</span>
                <StatusPill status={credential.status} />
                <span className="ink-muted mono">{credential.learner_id}</span>
                <span className="ink-muted ml-auto">{fmtDate(credential.issued_at)}</span>
              </li>
            )),
          )}
        </ul>
      </Card>
    </div>
  );
}
