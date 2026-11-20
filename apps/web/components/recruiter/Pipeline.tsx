'use client';

import React, { useEffect, useState } from 'react';
import { api, useAction, useApi } from '@/lib/api';
import { IssueOffer } from './IssueOffer';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, Table, Td } from '../ui';

export function Pipeline() {
  const drives = useApi('/api/v2/recruiter/drives');
  const [driveId, setDriveId] = useState('');
  const pipe = useApi(driveId ? `/api/v2/recruiter/pipeline?driveId=${driveId}` : null);
  const act = useAction();
  const [fb, setFb] = useState<{ appId: string; roundKind: string; rating: number; strengths: string; concerns: string; recommendation: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (drives.data && !driveId && drives.data.drives[0]) setDriveId(drives.data.drives[0].id); }, [drives.data, driveId]);
  if (drives.error) return <ErrorBox error={drives.error} />;
  if (!drives.data) return <Loading />;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="BR-19" title="Hiring Stages & Feedback">The placement office moves candidates between stages. Your feedback goes to them and is saved with the application.</PageHeader>
      <Field label="Drive"><select className={inputCls} value={driveId} onChange={e => setDriveId(e.target.value)}>{drives.data.drives.map((d: any) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></Field>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error ?? pipe.error} />
      {pipe.data && (
        <Card title={`${pipe.data.length} candidates`}>
          <Table head={['Candidate', 'Branch', 'Stage', 'Feedback', '']}>
            {pipe.data.map((a: any) => (
              <tr key={a.applicationId}><Td>{a.name}</Td><Td>{a.branch}</Td><Td>{a.stage.replace(/_/g, ' ')}</Td>
                <Td>{a.feedback.map((f: any, i: number) => <span key={i} className="block text-xs">{f.round}: {f.rating}/5 · {f.recommendation}</span>)}</Td>
                <Td><Button kind="ghost" onClick={() => setFb({ appId: a.applicationId, roundKind: 'interview', rating: 3, strengths: '', concerns: '', recommendation: 'advance' })}>Add feedback</Button></Td></tr>
            ))}
          </Table>
        </Card>
      )}
      {driveId && <IssueOffer driveId={driveId} />}
      {fb && (
        <Card title="Feedback">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Round"><select className={inputCls} value={fb.roundKind} onChange={e => setFb({ ...fb, roundKind: e.target.value })}>{['technical_test', 'interview', 'hr'].map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select></Field>
            <Field label="Rating (1–5)"><input className={inputCls} type="number" min={1} max={5} value={fb.rating} onChange={e => setFb({ ...fb, rating: Number(e.target.value) })} /></Field>
            <Field label="Recommendation"><select className={inputCls} value={fb.recommendation} onChange={e => setFb({ ...fb, recommendation: e.target.value })}>{['advance', 'hold', 'reject'].map(r => <option key={r}>{r}</option>)}</select></Field>
            <Field label="Strengths"><input className={inputCls} value={fb.strengths} onChange={e => setFb({ ...fb, strengths: e.target.value })} /></Field>
            <Field label="Concerns"><input className={inputCls} value={fb.concerns} onChange={e => setFb({ ...fb, concerns: e.target.value })} /></Field>
            <div className="flex items-end"><Button busy={act.busy} onClick={async () => { if (await act.run(() => api('/api/v2/recruiter/feedback', { body: { applicationId: fb.appId, ...fb } }))) { setMsg('Feedback saved.'); setFb(null); pipe.reload(); } }}>Save</Button></div>
          </div>
        </Card>
      )}
    </div>
  );
}
