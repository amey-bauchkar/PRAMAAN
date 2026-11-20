'use client';

import React from 'react';
import { api, lpa, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Loading, PageHeader, ProofBadge, ResultBadge, StateBadge } from '../ui';

export function Targets() {
  const { data, error, reload } = useApi('/api/v2/student/targets');
  const act = useAction();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="ST-04" title="Companies & Skill Gaps">Roles hiring at your college, ranked by how many of the required skills you have Verified.</PageHeader>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.map((r: any) => (
          <Card key={r.roleId} title={<span>{r.title} <span className="font-normal text-muted">· {r.company}</span></span>}
            actions={<span className="font-display text-2xl font-semibold tabular-nums">{r.fitPercent}%<span className="ml-1 text-xs font-normal text-muted">match</span></span>}>
            <p className="text-sm text-muted">{lpa(r.ctc)}</p>
            <div className="mt-1"><Button kind={r.saved ? 'secondary' : 'ghost'} busy={act.busy} onClick={async () => { if (await act.run(() => api(`/api/v2/student/targets/${r.roleId}/toggle`, { method: 'POST' }))) reload(); }}>{r.saved ? 'Saved: working towards this' : 'Save as a target'}</Button></div>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {r.required.map((s: any) => (
                <li key={s.name} className="flex flex-wrap items-center justify-between gap-2">
                  <span><span className={s.met ? 'font-semibold' : ''}>{s.name}</span>{s.requiredLevel > 1 && <span className="text-muted"> (level {s.requiredLevel})</span>}</span>
                  <span className="flex gap-1.5"><StateBadge state={s.state} /><ProofBadge level={s.proofLevel} /></span>
                </li>
              ))}
            </ul>
            {r.gaps.length > 0 && <p className="mt-3 text-sm"><span className="font-semibold">Skills you still need:</span> {r.gaps.join('; ')}</p>}
            {r.eligibilityPreview && (
              <div className="mt-3 border-t border-line pt-3 text-sm">
                <span className="mr-2">Are you eligible today?</span><ResultBadge result={r.eligibilityPreview.status} />
                {r.eligibilityPreview.failing.length > 0 && <ul className="mt-1 list-disc pl-5 text-muted">{r.eligibilityPreview.failing.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
