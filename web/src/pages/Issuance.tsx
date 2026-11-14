import { useEffect, useState } from 'react';
import { api, ApiError, type IssuanceDecision } from '../lib/api';
import { Banner, Button, Card, fmtDate, Spinner, StatusPill } from '../components/ui';

interface Candidate {
  completion: { completion_id: string; overall_score: number; completed_at: string | null; modules_completed_pct: number; attendance_pct: number; days_to_complete: number | null };
  learner: { learner_id: string; full_name: string; email: string };
  course: { course_id: string; title: string; passing_score: number };
  rule: { rule_id: string; rule_version: number; min_overall_score: number };
  decision: IssuanceDecision;
}

interface AiExplanation {
  summary: string;
  learner_message: string;
  blocking_criteria: { criterion: string; what_is_required: string; what_the_learner_has: string; closest_to_passing: boolean }[];
  recommended_next_step: string;
  source: string;
}

/**
 * The issuance console. Every candidate shows its full rule trace, so an administrator can see which
 * criterion decided the outcome before acting — and the Issue button is only offered where the engine
 * has already approved.
 */
export function IssuancePage({ canIssue, search }: { canIssue: boolean; search: string }) {
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'APPROVED' | 'DENIED'>('ALL');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'good' | 'critical'; text: string } | null>(null);
  const [explanations, setExplanations] = useState<Record<string, AiExplanation>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    api<{ rows: Candidate[] }>('/api/issuance/eligible?limit=60')
      .then((r) => setRows(r.rows))
      .catch((caught: Error) => setError(caught.message));
  };

  useEffect(load, []);

  async function issue(candidate: Candidate) {
    setBusy(candidate.completion.completion_id);
    setNotice(null);
    try {
      const response = await api<{ credential: { credential_id: string } }>('/api/issuance/issue', {
        method: 'POST',
        body: JSON.stringify({ completion_id: candidate.completion.completion_id }),
      });
      setNotice({ kind: 'good', text: `Issued ${response.credential.credential_id} to ${candidate.learner.full_name}.` });
      load();
    } catch (caught) {
      setNotice({
        kind: 'critical',
        text: caught instanceof ApiError ? `Issuance refused: ${caught.message}` : 'Issuance failed.',
      });
    } finally {
      setBusy(null);
    }
  }

  async function explain(candidate: Candidate) {
    setBusy(candidate.completion.completion_id);
    try {
      const response = await api<{ explanation: AiExplanation }>('/api/ai/explain-denial', {
        method: 'POST',
        body: JSON.stringify({ completion_id: candidate.completion.completion_id }),
      });
      setExplanations((prev) => ({ ...prev, [candidate.completion.completion_id]: response.explanation }));
    } catch {
      setNotice({ kind: 'critical', text: 'Could not produce an explanation.' });
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="p-4"><Banner kind="critical">{error}</Banner></div>;
  if (!rows) return <Spinner label="Loading candidates" />;

  const needle = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (filter !== 'ALL' && r.decision.decision !== filter) return false;
    if (!needle) return true;
    return `${r.completion.completion_id} ${r.learner.full_name} ${r.learner.learner_id} ${r.course.title}`
      .toLowerCase()
      .includes(needle);
  });
  const approvedCount = rows.filter((r) => r.decision.decision === 'APPROVED').length;

  return (
    <div className="space-y-4 px-6 pb-8">
      <p className="ink-secondary text-sm">
        Completed courses with no credential yet. {approvedCount} of {rows.length} shown meet their rule.
      </p>

      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      <div className="flex gap-2">
        {(['ALL', 'APPROVED', 'DENIED'] as const).map((option) => (
          <Button key={option} variant={filter === option ? 'primary' : 'ghost'} onClick={() => setFilter(option)}>
            {option.toLowerCase()}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {visible.length === 0 && <p className="ink-muted py-8 text-center text-sm">Nothing in this view.</p>}

        {visible.map((candidate) => {
          const id = candidate.completion.completion_id;
          const open = expanded === id;
          const explanation = explanations[id];
          return (
            <Card key={id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{candidate.learner.full_name}</p>
                  <p className="ink-secondary text-sm">{candidate.course.title}</p>
                  <p className="ink-muted mono mt-1 text-xs break-all">{id}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={candidate.decision.decision} />
                  <Button variant="ghost" onClick={() => setExpanded(open ? null : id)}>
                    {open ? 'Hide rule trace' : 'Rule trace'}
                  </Button>
                  {candidate.decision.decision === 'APPROVED' && canIssue && (
                    <Button onClick={() => issue(candidate)} disabled={busy === id}>
                      {busy === id ? 'Issuing…' : 'Issue credential'}
                    </Button>
                  )}
                  {candidate.decision.decision === 'DENIED' && (
                    <Button variant="ghost" onClick={() => explain(candidate)} disabled={busy === id}>
                      {busy === id ? 'Working…' : 'Explain'}
                    </Button>
                  )}
                </div>
              </div>

              <dl className="ink-secondary mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <div>
                  <dt className="ink-muted">Score</dt>
                  <dd className="tabular-nums">{candidate.completion.overall_score}</dd>
                </div>
                <div>
                  <dt className="ink-muted">Modules</dt>
                  <dd className="tabular-nums">{candidate.completion.modules_completed_pct}%</dd>
                </div>
                <div>
                  <dt className="ink-muted">Attendance</dt>
                  <dd className="tabular-nums">{candidate.completion.attendance_pct}%</dd>
                </div>
                <div>
                  <dt className="ink-muted">Completed</dt>
                  <dd>{fmtDate(candidate.completion.completed_at)}</dd>
                </div>
              </dl>

              {open && (
                <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="ink-muted mb-2 text-xs">
                    Evaluated against <span className="mono">{candidate.decision.rule_id}</span> (version {candidate.decision.rule_version})
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="ink-muted border-b text-left" style={{ borderColor: 'var(--border)' }}>
                        <th className="py-1 font-medium">Criterion</th>
                        <th className="py-1 font-medium">Required</th>
                        <th className="py-1 font-medium">Actual</th>
                        <th className="py-1 font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidate.decision.criteria.map((criterion) => (
                        <tr key={criterion.criterion} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                          <td className="py-1">{criterion.criterion.replace(/_/g, ' ')}</td>
                          <td className="py-1 tabular-nums">{String(criterion.required)}</td>
                          <td className="py-1 tabular-nums">{String(criterion.actual)}</td>
                          <td className="py-1">
                            <span style={{ color: criterion.passed ? 'var(--status-good)' : 'var(--status-critical)' }}>
                              {criterion.passed ? '✓ pass' : '✕ fail'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {explanation && (
                <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="ink-muted mb-1 text-xs">
                    Explanation of the decision already made — advisory only, generated by {explanation.source === 'openai' ? 'OpenAI structured output' : 'the deterministic fallback'}.
                  </p>
                  <p className="text-sm">{explanation.summary}</p>
                  <p className="ink-secondary mt-2 text-sm">
                    <span className="ink-muted text-xs uppercase tracking-wide">Suggested next step: </span>
                    {explanation.recommended_next_step.replace(/_/g, ' ').toLowerCase()}
                  </p>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
