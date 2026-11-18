'use client';

import React, { useState } from 'react';
import { api, fmtDateTime, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice } from '../ui';

/** Interview score reviews asked for by students. A person sets the score for each question and writes a reply. */
export function MockReviews() {
  const { data, error, reload } = useApi('/api/v2/tpo/mock-reviews');
  const act = useAction();
  const [scores, setScores] = useState<Record<string, Record<string, string>>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const pending = data.filter((r: any) => r.status === 'pending');
  return (
    <Card title={`Interview score reviews (${pending.length} waiting)`}>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      {data.length === 0 ? <p className="text-sm text-muted">No student has asked for a review.</p> : (
        <ul className="flex flex-col gap-4">
          {data.map((r: any) => (
            <li key={r.id} className="rounded-lg border border-line p-3 text-sm">
              <p className="font-semibold">{r.student} ({r.enrollmentNo}) · {r.role} <span className="font-normal text-muted">· {fmtDateTime(r.createdAt)} · scored by {r.scorer === 'rules' ? 'keyword rubric' : 'AI model'}</span></p>
              <p className="mt-1">“{r.reason}”</p>
              {r.status === 'pending' ? (
                <div className="mt-2 flex flex-col gap-2">
                  {r.answers.map((a: any) => (
                    <div key={a.questionId} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                      <span>{a.question}<span className="block text-xs text-muted">Covered: {a.covered.join('; ') || 'none'}. Not covered: {a.missed.join('; ') || 'none'}.</span></span>
                      <input aria-label="Score out of 10" className={`${inputCls} w-24`} type="number" min={0} max={10} step={0.5}
                        value={scores[r.id]?.[a.questionId] ?? String(a.score)} onChange={e => setScores({ ...scores, [r.id]: { ...scores[r.id], [a.questionId]: e.target.value } })} />
                    </div>
                  ))}
                  <Field label="Reply to the student (they will see this)"><input className={inputCls} value={notes[r.id] ?? ''} onChange={e => setNotes({ ...notes, [r.id]: e.target.value })} /></Field>
                  <div><Button busy={act.busy} disabled={(notes[r.id] ?? '').length < 5} onClick={async () => {
                    const res = await act.run(() => api(`/api/v2/tpo/mock-reviews/${r.id}/decide`, { body: { scores: scores[r.id], note: notes[r.id] } }));
                    if (res) { setMsg(res.status === 'revised' ? `Score changed to ${res.score}.` : 'Score kept. Your reply was saved.'); reload(); }
                  }}>Save decision</Button></div>
                </div>
              ) : <p className="mt-1 text-muted">{r.status === 'revised' ? `Changed from ${r.previousScore} to ${r.revisedScore}` : 'Kept'}: {r.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
