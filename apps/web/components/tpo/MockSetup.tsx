'use client';

import React, { useState } from 'react';
import { api, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, Stat, Table, Td } from '../ui';

export function MockSetup() {
  const { data, error, reload } = useApi('/api/v2/tpo/mock-setup');
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [role, setRole] = useState('Backend Developer');
  const [q, setQ] = useState({ topic: 'quantitative', subtopic: '', stem: '', options: ['', '', '', ''], answerIndex: 0, explanation: '' });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const drafts = data.interviewQuestions.filter((x: any) => x.status === 'draft');
  const roles = [...new Set(data.interviewQuestions.map((x: any) => x.role_title))] as string[];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="AD-04" title="Practice Drive Setup">The question banks used for practice drives. Students never see the answers or the hidden tests.</PageHeader>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Aptitude questions" value={data.aptitude.reduce((s: number, a: any) => s + a.n, 0)} sub="10 per topic per student" />
        <Stat label="Coding problems" value={data.problems.length} sub={`checked by: ${data.judge}`} />
        <Stat label="Practice attempts" value={`${data.attempts.done} / ${data.attempts.n}`} sub="finished / started" />
      </div>

      <Card title={`Interview questions awaiting approval (${drafts.length})`}
        actions={<span className="flex items-end gap-2"><select aria-label="Role" className={inputCls} value={role} onChange={e => setRole(e.target.value)}>{roles.map(r => <option key={r}>{r}</option>)}</select>
          <Button kind="secondary" busy={act.busy} onClick={async () => { const r = await act.run(() => api('/api/v2/tpo/mock-setup/interview-questions/draft', { body: { role } })); if (r) { setMsg(`${r.drafted} interview question(s) drafted for ${role}. Approve them below.`); reload(); } }}>Draft questions</Button></span>}>
        {drafts.length === 0 ? <p className="text-sm text-muted">Nothing waiting for approval.</p> : (
          <ul className="flex flex-col gap-3">
            {drafts.map((d: any) => (
              <li key={d.id} className="rounded-lg border border-line p-3 text-sm">
                <p className="font-semibold">{d.role_title} · {d.topic}</p><p className="mt-1">{d.question}</p>
                <p className="mt-1 text-xs text-muted">Key points: {d.key_points.map((k: any) => k.point).join('; ')}</p>
                <div className="mt-2 flex gap-2">
                  <Button busy={act.busy} onClick={async () => { if (await act.run(() => api(`/api/v2/tpo/mock-setup/interview-questions/${d.id}/status`, { body: { status: 'approved' } }))) reload(); }}>Approve</Button>
                  <Button kind="secondary" busy={act.busy} onClick={async () => { if (await act.run(() => api(`/api/v2/tpo/mock-setup/interview-questions/${d.id}/status`, { body: { status: 'retired' } }))) reload(); }}>Reject</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Aptitude bank">
          <Table head={['Topic', 'Subtopic', 'Questions']}>{data.aptitude.map((a: any) => <tr key={a.topic + a.subtopic}><Td className="capitalize">{a.topic}</Td><Td>{a.subtopic}</Td><Td className="tabular-nums">{a.n}</Td></tr>)}</Table>
        </Card>
        <Card title="Coding problems">
          <Table head={['Problem', 'Language', 'Hidden tests', 'Marks']}>{data.problems.map((p: any) => <tr key={p.id}><Td>{p.title}<span className="block text-xs text-muted">{p.topics.join(', ')}</span></Td><Td>{p.language}</Td><Td className="tabular-nums">{p.hidden}</Td><Td className="tabular-nums">{p.marks}</Td></tr>)}</Table>
        </Card>
      </div>

      <Card title="Add an aptitude question">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Topic"><select className={inputCls} value={q.topic} onChange={e => setQ({ ...q, topic: e.target.value })}><option value="quantitative">Quantitative</option><option value="logical">Logical</option><option value="verbal">Verbal</option></select></Field>
          <Field label="Subtopic"><input className={inputCls} value={q.subtopic} onChange={e => setQ({ ...q, subtopic: e.target.value })} placeholder="e.g. percentages" /></Field>
          <div className="sm:col-span-2"><Field label="Question"><textarea className={inputCls} rows={2} value={q.stem} onChange={e => setQ({ ...q, stem: e.target.value })} /></Field></div>
          {q.options.map((o, i) => (
            <Field key={i} label={`Option ${i + 1}${q.answerIndex === i ? ' (correct)' : ''}`}>
              <span className="flex gap-2"><input className={`${inputCls} flex-1`} value={o} onChange={e => setQ({ ...q, options: q.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                <input type="radio" name="correct" aria-label={`Option ${i + 1} is correct`} checked={q.answerIndex === i} onChange={() => setQ({ ...q, answerIndex: i })} /></span>
            </Field>
          ))}
          <div className="sm:col-span-2"><Field label="Explanation shown after the attempt"><input className={inputCls} value={q.explanation} onChange={e => setQ({ ...q, explanation: e.target.value })} /></Field></div>
          <div><Button busy={act.busy} onClick={async () => { if (await act.run(() => api('/api/v2/tpo/mock-setup/aptitude', { body: { ...q, options: q.options.filter(Boolean) } }))) { setMsg('Question added to your college’s bank.'); reload(); } }}>Add question</Button></div>
        </div>
      </Card>
    </div>
  );
}
