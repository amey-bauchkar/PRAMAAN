'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { api, fmtDate, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, Table, Td } from '../ui';
import { CodeEditor, JudgeResults } from '../code';
import { BarList } from '../charts';
import { Cta } from '@/components/Cta';
import { InterviewResult } from './InterviewResult';

export function MockDrive() {
  const id = useSearchParams().get('attempt');
  return id ? <Attempt id={id} /> : <MockHome />;
}

function MockHome() {
  const { data, error } = useApi('/api/v2/student/mock');
  const router = useRouter();
  const act = useAction();
  const [role, setRole] = useState('');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const start = async () => {
    const r = await act.run(() => api('/api/v2/student/mock/attempts', { body: { role: role || data.roles[0] } }));
    if (r) router.push(`/student/mock-drive?attempt=${r.id}`);
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="ST-05" title="Practice Drive">
        Three rounds, just like a real campus drive: aptitude (30 questions, a different set for each student), a coding test (2 problems, 10 marks each, with partial marks) and an interview for your chosen role. Passing a round adds Level 2 proof to your profile.
      </PageHeader>
      <Card title="Start a practice drive">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Target role">
            <select className={inputCls} value={role || data.roles[0]} onChange={e => setRole(e.target.value)}>{data.roles.map((r: string) => <option key={r}>{r}</option>)}</select>
          </Field>
          <Button busy={act.busy} onClick={start}>Start</Button>
        </div>
        <ErrorBox error={act.error} />
      </Card>
      {data.attempts.length > 0 && (
        <Card title="Your attempts">
          <Table head={['Started', 'Role', 'Status', 'Score', 'Summary']}>
            {data.attempts.map((a: any) => (
              <tr key={a.id}>
                <Td><Link className="text-brand underline" href={`/student/mock-drive?attempt=${a.id}`}>{fmtDate(a.startedAt)}</Link></Td>
                <Td>{a.role}</Td><Td>{a.status === 'completed' ? 'Completed' : 'In progress'}</Td>
                <Td>{a.totalPercent !== null ? `${a.totalPercent}%` : '—'}</Td><Td>{a.summary ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

function Attempt({ id }: { id: string }) {
  const { data, error, reload } = useApi(`/api/v2/student/mock/attempts/${id}`);
  const act = useAction();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [code, setCode] = useState<Record<string, string>>({});
  const [runOut, setRunOut] = useState<Record<string, any>>({});
  const [talk, setTalk] = useState<Record<string, string>>({});
  useEffect(() => {
    if (data?.machine) setCode(c => Object.keys(c).length ? c : Object.fromEntries(data.machine.map((p: any) => [p.id, p.starter])));
  }, [data]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const report = data.report;
  const done = (r: string) => data.rounds.some((x: any) => x.round === r);
  const after = (r: any) => { if (r) reload(); };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow={`Practice drive · ${data.role}`} title={report ? 'Your report' : 'Practice drive in progress'}>
        Rounds done: {data.rounds.map((r: any) => `${r.round.replace('_', ' ')} ${r.score}/${r.maxScore}`).join(' · ') || 'none yet'}
      </PageHeader>
      <ErrorBox error={act.error} />

      {report && <Report report={report} />}
      {data.interviewResult && <InterviewResult attemptId={id} result={data.interviewResult} reviews={data.reviews ?? []} reload={reload} />}

      {!done('aptitude') && data.aptitude && (
        <Card title={`Round 1 · Aptitude (${data.aptitude.length} questions)`}>
          <ol className="flex flex-col gap-4">
            {data.aptitude.map((q: any, i: number) => (
              <li key={q.id}>
                <fieldset>
                  <legend className="text-sm font-semibold">{i + 1}. {q.stem} <span className="font-normal text-muted">({q.topic})</span></legend>
                  <div className="mt-1 grid gap-1 sm:grid-cols-2">
                    {q.options.map((o: string, j: number) => (
                      <label key={j} className="flex items-center gap-2 rounded border border-line px-2 py-1 text-sm hover:border-brand">
                        <input type="radio" name={q.id} checked={answers[q.id] === j} onChange={() => setAnswers({ ...answers, [q.id]: j })} />{o}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-center gap-3">
            <Button busy={act.busy} onClick={async () => after(await act.run(() => api(`/api/v2/student/mock/attempts/${id}/aptitude`, { body: { answers } })))}>Submit aptitude</Button>
            <span className="text-sm text-muted">{Object.keys(answers).length}/{data.aptitude.length} answered</span>
          </div>
        </Card>
      )}

      {!done('machine_test') && data.machine && (
        <Card title="Round 2 · Coding test (2 problems, 10 marks each)">
          <div className="flex flex-col gap-6">
            {data.machine.map((p: any) => (
              <div key={p.id} className="flex flex-col gap-2">
                <h3 className="font-semibold">{p.title} <span className="text-sm font-normal text-muted">· {p.language === 'sql' ? 'SQL' : 'JavaScript'} · {p.marks} marks</span></h3>
                <p className="text-sm">{p.statement}</p>
                {p.schema && <pre className="overflow-x-auto rounded bg-paper p-2 text-xs">{p.schema}</pre>}
                <CodeEditor label={p.language === 'sql' ? 'Your query (one statement)' : `function ${p.entry}(…)`} value={code[p.id] ?? ''} onChange={v => setCode({ ...code, [p.id]: v })} rows={10} />
                <div><Button kind="secondary" busy={act.busy} onClick={async () => { const r = await act.run(() => api(`/api/v2/student/mock/attempts/${id}/machine/run`, { body: { problemId: p.id, code: code[p.id] } })); if (r) setRunOut({ ...runOut, [p.id]: r }); }}>Try example tests</Button></div>
                <JudgeResults outcome={runOut[p.id]} />
              </div>
            ))}
            <div><Button busy={act.busy} onClick={async () => after(await act.run(() => api(`/api/v2/student/mock/attempts/${id}/machine/submit`, { body: { solutions: code } })))}>Submit both answers</Button></div>
          </div>
        </Card>
      )}

      {!done('interview') && data.interview && (
        <Card title="Round 3 · Interview">
          <p className="mb-3 text-sm text-muted">Scored only on what you write, using the key points for each question. No voice or video is recorded. This score is a first draft, and you can ask a person to review it.</p>
          <div className="flex flex-col gap-4">
            {data.interview.map((q: any, i: number) => (
              <Field key={q.id} label={`${i + 1}. ${q.question}`}><textarea className={inputCls} rows={4} value={talk[q.id] ?? ''} onChange={e => setTalk({ ...talk, [q.id]: e.target.value })} /></Field>
            ))}
            <div><Button busy={act.busy} onClick={async () => after(await act.run(() => api(`/api/v2/student/mock/attempts/${id}/interview`, { body: { answers: talk } })))}>Submit interview</Button></div>
          </div>
        </Card>
      )}

      {!report && data.aptitudeResult && <Card title="Aptitude result"><p>{data.aptitudeResult.score}/{data.aptitudeResult.maxScore}. Weak: {data.aptitudeResult.weakTopics.join(', ') || 'none'}</p></Card>}
    </div>
  );
}

function Report({ report }: { report: any }) {
  return (
    <div className="flex flex-col gap-4">
      <Notice tone={report.weakTopics.length ? 'warn' : 'success'}><span className="font-semibold">{report.summary}</span> Overall {report.totalPercent}%.</Notice>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Score per round">
          <BarList items={report.rounds.map((r: any) => ({ label: r.round === 'machine_test' ? 'Coding test' : r.round[0].toUpperCase() + r.round.slice(1), value: r.percent, detail: `${r.score}/${r.maxScore}` }))} />
          <ul className="mt-3 text-sm text-muted">{report.rounds.map((r: any) => <li key={r.round}>{r.round.replace('_', ' ')}: {r.score}/{r.maxScore}</li>)}</ul>
        </Card>
        <Card title="Where marks were lost">
          {report.marksLost.length === 0 ? <p className="text-sm text-muted">No marks lost in the coding test or interview.</p> :
            <ul className="flex flex-col gap-2 text-sm">{report.marksLost.map((m: any, i: number) => (
              <li key={i} className="rounded border border-line p-2"><span className="font-semibold">−{m.marks}</span> {m.round}: {m.description}<span className="block break-all text-xs text-muted">{m.detail}</span></li>))}</ul>}
        </Card>
      </div>
      {report.awarded?.length > 0 && <Card title="New proof added to your profile"><ul className="list-disc pl-5 text-sm">{report.awarded.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul></Card>}
      <div className="flex gap-3">
        <Cta href="/student/learning-path">Build my learning plan</Cta>
        <Link href="/student/drives" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">See my drives</Link>
      </div>
    </div>
  );
}
