'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useState } from 'react';
import { api, fmtInr, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, Table, Td } from '../ui';

const NEXT: Record<string, string[]> = { applied: ['shortlisted', 'rejected'], assessment: ['shortlisted', 'rejected'], shortlisted: ['interview_scheduled', 'offered', 'rejected'], interview_scheduled: ['offered', 'rejected'] };

export function Applications() {
  const router = useRouter();
  const driveId = useSearchParams().get('drive');
  const drives = useApi('/api/v2/tpo/drives');
  const apps = useApi(driveId ? `/api/v2/tpo/applications?driveId=${driveId}` : null);
  const act = useAction();
  const [ctc, setCtc] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const move = async (id: string, stage: string) => {
    const r = await act.run(() => api(`/api/v2/tpo/applications/${id}/stage`, { body: { stage, ctcInr: stage === 'offered' ? Number(ctc[id]) : undefined } }));
    if (r) { setMsg(`Moved to ${stage.replace('_', ' ')}.`); apps.reload(); }
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="BR-19" title="Shortlists & Offers">Every change of stage is recorded and cannot be edited later. When a recruiter asks for a shortlist, it appears in Proposals for you to approve.</PageHeader>
      <Field label="Drive">
        <select className={inputCls} value={driveId ?? ''} onChange={e => router.push(`/tpo/applications?drive=${e.target.value}`)}>
          <option value="">Choose a drive</option>{drives.data?.drives.map((d: any) => <option key={d.id} value={d.id}>{d.title} · {d.applications} applications</option>)}
        </select>
      </Field>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error ?? apps.error} />
      {driveId && (!apps.data ? <Loading /> : (
        <Card title={`${apps.data.length} applications`}>
          <Table head={['Student', 'Branch', 'Stage', 'Offer', 'Move to']}>
            {apps.data.map((a: any) => (
              <tr key={a.id}>
                <Td>{a.name}<span className="block text-xs text-muted">{a.enrollmentNo}</span></Td><Td>{a.branch}</Td><Td>{a.stage.replace(/_/g, ' ')}</Td>
                <Td>{a.offer ? `${fmtInr(a.offer.ctc)} · ${a.offer.status}` : '—'}</Td>
                <Td>
                  <span className="flex flex-wrap items-center gap-1">
                    {(NEXT[a.stage] ?? []).includes('offered') && <input aria-label="CTC in INR" className={`${inputCls} w-28 py-1 text-sm`} placeholder="CTC ₹" value={ctc[a.id] ?? ''} onChange={e => setCtc({ ...ctc, [a.id]: e.target.value })} />}
                    {(NEXT[a.stage] ?? []).map(s => <Button key={s} kind={s === 'rejected' ? 'danger' : 'secondary'} className="px-2 py-1" busy={act.busy} disabled={s === 'offered' && !(Number(ctc[a.id]) > 0)} onClick={() => move(a.id, s)}>{s.replace('_', ' ')}</Button>)}
                  </span>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      ))}
    </div>
  );
}
