'use client';

import React, { useState } from 'react';
import { api, fmtDate, fmtDateTime, useAction } from '@/lib/api';
import { Button, ErrorBox, ProofBadge, StateBadge } from '../ui';

/** One chain from a decision to the rule version, the skill state and the evidence behind it. */
export function DecisionTrace({ decisionId }: { decisionId: string }) {
  const act = useAction();
  const [t, setT] = useState<any>(null);
  const [rep, setRep] = useState<any>(null);
  if (!t) return (
    <div><Button kind="ghost" busy={act.busy} onClick={async () => { const r = await act.run(() => api(`/api/v2/student/decisions/${decisionId}/trace`)); if (r) setT(r); }}>Show the proof behind this decision</Button><ErrorBox error={act.error} /></div>
  );
  return (
    <div className="w-full rounded-lg border border-line bg-paper p-3 text-sm">
      <p><span className="font-semibold">Rules:</span> version {t.rules.version}{t.rules.publishedAt ? `, published ${fmtDate(t.rules.publishedAt)}` : ''}{t.rules.rationale ? `. Reason for this version: ${t.rules.rationale}` : ''}</p>
      <p className="mt-1"><span className="font-semibold">Data used:</span> checked {fmtDateTime(t.decision.decidedAt)}, fingerprint <span className="font-mono text-xs">{t.decision.inputHash}</span></p>
      <p className="mt-1 text-xs text-muted">{t.howToReproduce}</p>
      <div className="mt-2"><Button kind="secondary" busy={act.busy} onClick={async () => { const r = await act.run(() => api(`/api/v2/student/decisions/${decisionId}/replay`, { method: 'POST' })); if (r) setRep(r); }}>Replay this decision</Button></div>
      {rep && <p className={`mt-2 rounded border p-2 ${rep.reproduced ? 'border-ink/30' : 'border-red-600 text-red-700'}`}>{rep.reproduced ? 'Matches. ' : ''}{rep.message} (stored: {rep.storedResult}, replayed: {rep.replayedResult}, rules version {rep.ruleVersion})</p>}
      <ul className="mt-2 flex flex-col gap-2">
        {t.checks.filter((c: any) => c.skill).map((c: any) => (
          <li key={c.id} className="rounded border border-line p-2">
            <p className="font-semibold">{c.skill.name} <StateBadge state={c.skill.state} /> <ProofBadge level={c.skill.proofLevel} /></p>
            <p className="text-xs text-muted">{c.message}</p>
            {c.skill.evidence.length === 0 ? <p className="text-xs">No evidence yet.</p> : (
              <ul className="mt-1 list-disc pl-5 text-xs">{c.skill.evidence.map((e: any, i: number) => <li key={i}>{e.description ?? e.kind}{e.path ? ` (${e.path})` : ''} · {e.source ?? 'import'} · {e.status} · fingerprint <span className="font-mono">{e.hash}</span></li>)}</ul>
            )}
            {c.skill.history.length > 0 && <p className="mt-1 text-xs text-muted">Latest change: {c.skill.history[0].from.replace('_', '-')} to {c.skill.history[0].to.replace('_', '-')} on {fmtDate(c.skill.history[0].at)}</p>}
          </li>
        ))}
        {t.checks.every((c: any) => !c.skill) && <li className="text-xs text-muted">This decision does not depend on any skill.</li>}
      </ul>
    </div>
  );
}
