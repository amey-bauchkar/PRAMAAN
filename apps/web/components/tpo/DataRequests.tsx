'use client';

import React, { useState } from 'react';
import { api, fmtDate, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice } from '../ui';

const LABEL: Record<string, string> = { access: 'Copy of data', correction: 'Correction', erasure: 'Deletion', grievance: 'Complaint' };

/** Requests students made about their own data. Each must be answered by its due date (30 days). */
export function DataRequests() {
  const { data, error, reload } = useApi('/api/v2/tpo/data-requests');
  const act = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const open = data.filter((r: any) => r.status === 'pending' || r.status === 'processing');
  return (
    <Card title={`Student data requests (${open.length} open)`}>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      <div className="mb-3"><Button kind="secondary" busy={act.busy} onClick={async () => { const r = await act.run(() => api('/api/v2/tpo/retention/run', { method: 'POST' })); if (r) setMsg(r.message); }}>Delete imported code past its retention period</Button></div>
      {data.length === 0 ? <p className="text-sm text-muted">No requests.</p> : (
        <ul className="flex flex-col gap-3">
          {data.map((r: any) => (
            <li key={r.id} className="rounded-lg border border-line p-3 text-sm">
              <p className="font-semibold">{LABEL[r.type] ?? r.type} · {r.student} ({r.enrollmentNo}) <span className="font-normal text-muted">· due {fmtDate(r.dueAt)}{r.overdue ? ' · overdue' : ''}</span></p>
              {r.status === 'pending' || r.status === 'processing' ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Field label="What you did (the student will see this)"><input className={inputCls} value={notes[r.id] ?? ''} onChange={e => setNotes({ ...notes, [r.id]: e.target.value })} /></Field>
                  <Button busy={act.busy} disabled={(notes[r.id] ?? '').length < 5} onClick={async () => {
                    if (r.type === 'erasure' && !window.confirm('Delete this student’s personal data? This cannot be undone.')) return;
                    const res = await act.run(() => api(`/api/v2/tpo/data-requests/${r.id}/decide`, { body: { action: 'complete', note: notes[r.id] } }));
                    if (res) { setMsg(r.type === 'erasure' ? 'Personal data deleted.' : 'Request completed.'); reload(); }
                  }}>{r.type === 'erasure' ? 'Delete their data' : 'Mark done'}</Button>
                  <Button kind="secondary" busy={act.busy} disabled={(notes[r.id] ?? '').length < 5} onClick={async () => {
                    if (await act.run(() => api(`/api/v2/tpo/data-requests/${r.id}/decide`, { body: { action: 'reject', note: notes[r.id] } }))) reload();
                  }}>Decline with reason</Button>
                </div>
              ) : <p className="mt-1 text-muted">{r.status === 'completed' ? 'Completed' : 'Declined'} on {fmtDate(r.completedAt)}{r.note ? `: ${r.note}` : ''}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
