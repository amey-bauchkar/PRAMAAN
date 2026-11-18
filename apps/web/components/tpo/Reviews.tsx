'use client';

import React, { useState } from 'react';
import { api, fmtDate, useAction, useApi } from '@/lib/api';
import { Button, Card, Empty, ErrorBox, Field, inputCls, Loading, Notice, PageHeader } from '../ui';
import { MockReviews } from './MockReviews';

const DIMENSIONS = ['correctness', 'reasoning', 'communication'];

export function Reviews() {
  const { data, error, reload } = useApi('/api/v2/tpo/reviews');
  const act = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({ correctness: 2, reasoning: 2, communication: 2 });
  const [scope, setScope] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const decide = async (id: string, decision: 'attest' | 'accept' | 'reject') => {
    const r = await act.run(() => api(`/api/v2/tpo/reviews/${id}/decide`, { body: { decision, rubricScores: scores, scope, note } }));
    if (r) { setMsg(r.message); setOpen(null); setScope(''); setNote(''); reload(); }
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="ST-02 · Mentor" title="Evidence Reviews">Lab, hardware, certificate and project work submitted by students. If you approve it against the checklist, the skill becomes Verified (Level 3, mentor approved). You cannot approve your own work, and you can only review students from your college.</PageHeader>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      {data.length === 0 ? <Empty>No submissions waiting.</Empty> : data.map((e: any) => (
        <Card key={e.id} title={<span>{e.skill ?? 'Skill'} · {e.full_name}</span>} actions={<span className="text-xs text-muted">{e.enrollment_no} · {fmtDate(e.createdAt)}</span>}>
          <p className="text-sm">{e.description}</p>
          {e.link && <p className="mt-1 text-sm"><a className="text-brand underline" href={e.link} target="_blank" rel="noreferrer noopener">Open submitted link</a></p>}
          {open === e.id ? (
            <div className="mt-3 flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-3">{DIMENSIONS.map(d => (
                <Field key={d} label={`${d[0].toUpperCase() + d.slice(1)} (1–3)`}><select className={inputCls} value={scores[d]} onChange={ev => setScores({ ...scores, [d]: Number(ev.target.value) })}>{[1, 2, 3].map(n => <option key={n} value={n}>{n} · {['Novice', 'Competent', 'Proficient'][n - 1]}</option>)}</select></Field>
              ))}</div>
              <Field label="What you checked (shown on the certificate)"><input className={inputCls} value={scope} onChange={ev => setScope(ev.target.value)} placeholder="e.g. Demonstrated the PLC ladder program for a 4-way junction in lab 3" /></Field>
              <Field label="Note to the student"><input className={inputCls} value={note} onChange={ev => setNote(ev.target.value)} /></Field>
              <div className="flex flex-wrap gap-2">
                <Button busy={act.busy} disabled={scope.length < 10} onClick={() => decide(e.id, 'attest')}>Approve (Level 3)</Button>
                <Button kind="secondary" busy={act.busy} onClick={() => decide(e.id, 'accept')}>Accept as evidence, not as proof</Button>
                <Button kind="danger" busy={act.busy} disabled={note.length < 5} onClick={() => decide(e.id, 'reject')}>Reject with a note</Button>
              </div>
              <p className="text-xs text-muted">The skill becomes Verified only if the average score is at least 2.</p>
            </div>
          ) : <Button className="mt-3" kind="secondary" onClick={() => setOpen(e.id)}>Review</Button>}
        </Card>
      ))}
      <MockReviews />
    </div>
  );
}
