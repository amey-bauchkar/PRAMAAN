'use client';

import React, { useEffect, useState } from 'react';
import { api, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, Table, Td } from '../ui';

const DIMS = ['gender', 'category', 'branch', 'college_tier'];

export function Fairness() {
  const drives = useApi('/api/v2/tpo/drives');
  const [driveId, setDriveId] = useState('');
  const [dim, setDim] = useState('gender');
  const report = useApi(driveId ? `/api/v2/tpo/fairness?driveId=${driveId}&dimension=${dim}` : null);
  const act = useAction();
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (drives.data && !driveId) setDriveId(drives.data.drives.find((d: any) => d.status === 'completed')?.id ?? drives.data.drives[0]?.id ?? ''); }, [drives.data, driveId]);

  const r = report.data?.report;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="AD-10" title="Fairness Check">Shows what share of each group is selected at each stage, compared with the group with the highest rate. A flag appears when a group’s rate is below 80% of the highest (the “four-fifths rule”). A flag means a person should take a closer look. It does not prove bias.</PageHeader>
      <div className="flex flex-wrap gap-3">
        <Field label="Drive"><select className={inputCls} value={driveId} onChange={e => setDriveId(e.target.value)}>{drives.data?.drives.map((d: any) => <option key={d.id} value={d.id}>{d.title} ({d.status})</option>)}</select></Field>
        <Field label="Compare by"><select className={inputCls} value={dim} onChange={e => setDim(e.target.value)}>{DIMS.map(d => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}</select></Field>
      </div>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={report.error ?? act.error} />
      {driveId && !r && <Loading />}
      {r && (
        <>
          {report.data.suppressedGroups.length > 0 && <Notice>Groups with fewer than 5 students are hidden to protect privacy: {report.data.suppressedGroups.join(', ')}.</Notice>}
          <div className="grid gap-4 xl:grid-cols-3">
            {(['eligibility', 'shortlist', 'offer'] as const).map(stage => {
              const s = r[stage];
              return (
                <Card key={stage} title={<span className="capitalize">{stage === 'eligibility' ? 'Eligible' : stage === 'shortlist' ? 'Shortlisted (out of eligible)' : 'Offered (out of shortlisted)'}</span>}
                  actions={s.adverseImpactDetected ? <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-[#14162E]">Flag: below 80% of top group</span> : <span className="text-xs text-muted">No flag</span>}>
                  <Table head={['Group', 'Selected', 'Compared with top group', 'p-value']}>
                    {Object.values(s.groups).filter((g: any) => !g.isSuppressed).map((g: any) => (
                      <tr key={g.groupName}><Td>{g.groupName}{g.excludedFromComparison ? ' *' : ''}</Td><Td className="tabular-nums">{g.eligibleCandidates}/{g.totalCandidates} ({Math.round(g.selectionRate * 100)}%)</Td>
                        <Td className={`tabular-nums ${g.impactRatio !== null && g.impactRatio < 0.8 ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}`}>{g.impactRatio ?? '—'}</Td><Td className="tabular-nums">{g.fisherPValue ?? '—'}</Td></tr>
                    ))}
                  </Table>
                  {s.notes.map((n: string, i: number) => <p key={i} className="mt-2 text-xs text-muted">{n}</p>)}
                </Card>
              );
            })}
          </div>
          <p className="text-xs text-muted">Compared with top group = this group’s rate divided by the highest group’s rate. p-value shows how likely the difference is to be chance (small groups give unreliable results). * means students chose not to say. They are shown but never compared.</p>
          <Card title="Record your review">
            <Field label="Notes"><input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="What you checked and what you decided" /></Field>
            <div className="mt-2 flex gap-2">
              {(['flagged_for_hearing', 'cleared'] as const).map(st => (
                <Button key={st} kind={st === 'cleared' ? 'secondary' : 'primary'} busy={act.busy} disabled={note.length < 5} onClick={async () => {
                  const stage = (['offer', 'shortlist', 'eligibility'] as const).find(x => r[x].adverseImpactDetected) ?? 'eligibility';
                  if (await act.run(() => api('/api/v2/tpo/fairness/flag', { body: { driveId, dimension: dim, stage, status: st, notes: note, highestSelectionRate: r[stage].highestSelectionRate, groups: r[stage].groups } }))) { setMsg('Review saved in the activity log.'); setNote(''); }
                }}>{st === 'cleared' ? 'Reviewed, no action needed' : 'Flag for a hearing'}</Button>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
