'use client';

import React, { useState } from 'react';
import { api, useAction } from '@/lib/api';
import { Button, Card, ErrorBox, Field, inputCls, Notice } from '../ui';

/** The interview round result: how it was scored, what was covered, and a way to ask a person to review it. */
export function InterviewResult({ attemptId, result, reviews, reload }: { attemptId: string; result: any; reviews: any[]; reload: () => void }) {
  const act = useAction();
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const pending = reviews.find(r => r.status === 'pending');
  const decided = reviews.filter(r => r.status !== 'pending');
  return (
    <Card title="Interview score">
      <p className="text-sm text-muted">{result.scoring}</p>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {result.answers.map((a: any) => (
          <li key={a.questionId} className="rounded border border-line p-2">
            <p className="font-semibold">{a.question} <span className="font-normal text-muted">· {a.score}/10</span></p>
            {a.covered.length > 0 && <p className="text-xs">Covered: {a.covered.join('; ')}</p>}
            {a.missed.length > 0 && <p className="text-xs text-muted">Not covered: {a.missed.join('; ')}</p>}
            {a.reviewedBy === 'person' && <p className="text-xs text-muted">Score set by a person after review.</p>}
          </li>
        ))}
      </ul>
      {msg && <div className="mt-3"><Notice tone="success">{msg}</Notice></div>}
      {decided.map(r => (
        <div key={r.id} className="mt-3"><Notice tone={r.status === 'revised' ? 'success' : 'info'}>
          Review {r.status === 'revised' ? `changed your score from ${r.previousScore} to ${r.revisedScore}` : 'kept your score'}: {r.note}
        </Notice></div>
      ))}
      {pending ? <div className="mt-3"><Notice>A person is reviewing your answers. You will see their reply here.</Notice></div> : (
        <div className="mt-3 flex flex-col gap-2">
          <Field label="Think the score is wrong? Ask a person to review it" hint="Say what the score missed. At least 10 characters.">
            <textarea className={inputCls} rows={2} value={reason} onChange={e => setReason(e.target.value)} />
          </Field>
          <div><Button kind="secondary" busy={act.busy} disabled={reason.trim().length < 10} onClick={async () => {
            const r = await act.run(() => api(`/api/v2/student/mock/attempts/${attemptId}/review`, { body: { reason } }));
            if (r) { setMsg(r.message); setReason(''); reload(); }
          }}>Ask for a review</Button></div>
          <ErrorBox error={act.error} />
        </div>
      )}
    </Card>
  );
}
