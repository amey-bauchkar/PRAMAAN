'use client';

import React, { useState } from 'react';
import { api, fmtDateTime, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, Table, Td } from '../ui';

const KIND: Record<string, string> = {
  slot_allocation: 'Schedule', gap_alert: 'Skill-gap alert', support_candidate: 'Mentoring', interview_questions: 'Interview questions', shortlist: 'Recruiter shortlist',
};

export function Proposals() {
  const { data, error, reload } = useApi('/api/v2/tpo/proposals');
  const act = useAction();
  const [note, setNote] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const pending = data.proposals.filter((p: any) => p.status === 'pending');
  const decide = async (id: string, decision: 'approve' | 'reject') => {
    const r = await act.run(() => api(`/api/v2/tpo/proposals/${id}/decide`, { body: { decision, note: note[id] } }));
    if (r) { setMsg(r.effect); reload(); }
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Suggested, then approved by you" title={`Proposals (${pending.length} waiting)`}>
        Automated helpers read data and draft suggestions. Most follow fixed rules; only the interview and email drafting can use a language model, and only when one is configured; each suggestion names the helper that made it. Nothing that affects a student’s chances changes until you approve it here, and every helper action is logged.
      </PageHeader>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      {pending.length === 0 && <Notice>Nothing is waiting for approval. Suggestions appear here after you scan job descriptions, check readiness or read a company email.</Notice>}
      <div className="flex flex-col gap-3">
        {pending.map((p: any) => (
          <Card key={p.id} title={p.title} actions={<span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">{KIND[p.kind] ?? p.kind}</span>}>
            <p className="text-sm">{p.rationale}</p>
            <p className="mt-1 text-xs text-muted">Suggested by {p.agent_name} ({p.model_version}) · {fmtDateTime(p.createdAt)}</p>
            {p.kind === 'slot_allocation' && (
              <Table head={['Round', 'Time', 'Room']}>{p.payload.allocations.map((a: any, i: number) => <tr key={i}><Td>{a.label}</Td><Td>{fmtDateTime(a.start)}</Td><Td>{a.roomName ?? a.note}</Td></tr>)}</Table>
            )}
            {p.kind === 'support_candidate' && <p className="mt-2 text-sm">Suggested mentor: <span className="font-semibold">{p.payload.mentorName ?? 'none available'}</span></p>}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="Note (optional)"><input className={inputCls} value={note[p.id] ?? ''} onChange={e => setNote({ ...note, [p.id]: e.target.value })} /></Field>
              <Button busy={act.busy} onClick={() => decide(p.id, 'approve')}>Approve</Button>
              <Button kind="secondary" busy={act.busy} onClick={() => decide(p.id, 'reject')}>Reject</Button>
            </div>
          </Card>
        ))}
      </div>
      <Card title="Decided">
        <Table head={['Suggestion', 'Type', 'Decision', 'When']}>
          {data.proposals.filter((p: any) => p.status !== 'pending').slice(0, 20).map((p: any) => <tr key={p.id}><Td>{p.title}</Td><Td>{KIND[p.kind] ?? p.kind}</Td><Td>{p.status === 'applied' ? 'Approved' : 'Rejected'}{p.decision_note ? ` — ${p.decision_note}` : ''}</Td><Td>{fmtDateTime(p.decidedAt)}</Td></tr>)}
        </Table>
      </Card>
      <Card title="Recent helper activity">
        <Table head={['When', 'Helper', 'Action', 'Input', 'Result']}>
          {data.recentActions.map((a: any, i: number) => <tr key={i}><Td>{fmtDateTime(a.createdAt)}</Td><Td>{a.agent_name}</Td><Td className="font-mono text-xs">{a.tool}</Td><Td className="font-mono text-xs">{JSON.stringify(a.input_summary)}</Td><Td className="font-mono text-xs">{JSON.stringify(a.output_summary)}</Td></tr>)}
        </Table>
      </Card>
    </div>
  );
}
