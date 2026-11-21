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
import { ProctorGate } from './ProctorGate';
import { TypingTelemetry } from '@/lib/typing';

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
        Three rounds, just like a real campus drive: aptitude (30 questions, a different set for each student), a coding test (2 problems, 10 marks each, with partial marks) and an interview for your chosen role. Passing a round adds Level 2 proof to your profile. It is taken in a proctored test window: full screen, camera on, no tab switching, and your video stays on your device (students under 18 are not put under the camera). At the end you answer a short question about your own code, and answers that match another student's are flagged.
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
  // Typing summaries (numbers only) for students 18 and over; under-18 students are never measured.
  const tel = React.useRef<Record<string, TypingTelemetry>>({});
  const telFor = (pid: string) => (tel.current[pid] ??= new TypingTelemetry());
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

      {report && <Report report={report} events={data.proctorEvents ?? []} />}
      {data.interviewResult && <InterviewResult attemptId={id} result={data.interviewResult} reviews={data.reviews ?? []} reload={reload} />}

      {!report && data.status === 'in_progress' && data.proctorRequired === false && (
        <Notice>You are under 18, so the camera and test-window rules are not used for you. Your answers are still checked for copying, and you will answer a short follow-up question about your own code at the end.</Notice>
      )}
      {!report && data.status === 'in_progress' && (
        <Guarded required={data.proctorRequired !== false} attemptId={id} onStarted={reload}>{flush => (
          <div className="flex flex-col gap-5">
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
            <Button busy={act.busy} onClick={async () => after(await act.run(async () => { await flush(); return api(`/api/v2/student/mock/attempts/${id}/aptitude`, { body: { answers } }); }))}>Submit aptitude</Button>
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
                <CodeEditor label={p.language === 'sql' ? 'Your query (one statement)' : `function ${p.entry}(…)`} value={code[p.id] ?? ''} onChange={v => setCode({ ...code, [p.id]: v })} rows={10} telemetry={data.proctorRequired === false ? undefined : telFor(p.id)} />
                <div><Button kind="secondary" busy={act.busy} onClick={async () => { const r = await act.run(() => api(`/api/v2/student/mock/attempts/${id}/machine/run`, { body: { problemId: p.id, code: code[p.id] } })); if (r) setRunOut({ ...runOut, [p.id]: r }); }}>Try example tests</Button></div>
                <JudgeResults outcome={runOut[p.id]} />
              </div>
            ))}
            <div><Button busy={act.busy} onClick={async () => after(await act.run(async () => { await flush(); return api(`/api/v2/student/mock/attempts/${id}/machine/submit`, { body: { solutions: code, typing: data.proctorRequired === false ? undefined : Object.fromEntries(data.machine.map((p: any) => [p.id, telFor(p.id).stats((code[p.id] ?? '').length, (p.starter ?? '').length)])) } }); }))}>Submit both answers</Button></div>
          </div>
        </Card>
      )}

      {!done('interview') && data.interview && (
        <Card title="Round 3 · Interview">
          <p className="mb-3 text-sm text-muted">Scored only on what you write, using the key points for each question. Your camera is analysed on your device during the drive; no video or audio is recorded or uploaded. This score is a first draft, and you can ask a person to review it.</p>
          <div className="flex flex-col gap-4">
            {data.interview.map((q: any, i: number) => (
              <Field key={q.id} label={`${i + 1}. ${q.question}`}><textarea className={inputCls} rows={4} value={talk[q.id] ?? ''} onChange={e => setTalk({ ...talk, [q.id]: e.target.value })} /></Field>
            ))}
            <div><Button busy={act.busy} onClick={async () => after(await act.run(async () => { await flush(); return api(`/api/v2/student/mock/attempts/${id}/interview`, { body: { answers: talk } }); }))}>Submit interview</Button></div>
          </div>
        </Card>
      )}

            {data.defence && <Defence checks={data.defence} attemptId={id} flush={flush} after={after} />}
          </div>
        )}</Guarded>
      )}

      {!report && data.aptitudeResult && <Card title="Aptitude result"><p>{data.aptitudeResult.score}/{data.aptitudeResult.maxScore}. Weak: {data.aptitudeResult.weakTopics.join(', ') || 'none'}</p></Card>}
    </div>
  );
}

function Report({ report, events }: { report: any; events: any[] }) {
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
      {report.integrity && <Integrity integrity={report.integrity} events={events} />}
      {report.withheld?.length > 0 && (
        <Card title="Proof not added">
          <ul className="list-disc pl-5 text-sm">{report.withheld.map((w: any, i: number) => <li key={i}><span className="font-semibold">{w.what}:</span> {w.reason}</li>)}</ul>
          <p className="mt-3 text-xs text-muted">Nothing is rejected automatically. Ask your placement officer to review any of these.</p>
        </Card>
      )}
      {report.defence?.length > 0 && (
        <Card title="Explain-your-code results">
          <ul className="list-disc pl-5 text-sm">{report.defence.map((d: any, i: number) => <li key={i}>{d.title}: {d.correct ? 'answered correctly' : 'not answered correctly in time'}</li>)}</ul>
        </Card>
      )}
      {report.awarded?.length > 0 && <Card title="New proof added to your profile"><ul className="list-disc pl-5 text-sm">{report.awarded.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul></Card>}
      <div className="flex gap-3">
        <Cta href="/student/learning-path">Build my learning plan</Cta>
        <Link href="/student/drives" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">See my drives</Link>
      </div>
    </div>
  );
}

const KIND_LABELS: Record<string, string> = {
  tab_hidden: 'Left the test tab', window_blur: 'Test window lost focus', fullscreen_exit: 'Left full screen', copy_attempt: 'Tried to copy',
  paste_attempt: 'Tried to paste', context_menu: 'Opened the right-click menu', blocked_shortcut: 'Used a blocked shortcut', camera_lost: 'Camera stopped or was covered',
  face_missing: 'Face not visible', multiple_faces: 'More than one face visible', looking_away: 'Looked away from the screen', phone_detected: 'A phone was visible',
  code_bulk_insert: 'Code appeared in one piece', code_little_typing: 'Little typing for the amount of code', code_uniform_typing: 'Unusually even typing rhythm',
};

/** What the test window recorded, in the student's own words. Nothing here is a verdict: a person can review it. */
function Integrity({ integrity, events }: { integrity: any; events: any[] }) {
  const rows = Object.entries(integrity.byKind ?? {}).filter(([k]) => KIND_LABELS[k] && !k.startsWith('code_'));
  const typing = events.filter(e => e.severity === 'review');
  const tone = integrity.status === 'clean' ? 'success' : 'warn';
  return (
    <Card title="Test window record">
      <Notice tone={tone}>{integrity.message}</Notice>
      {rows.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm">{rows.map(([k, n]) => <li key={k}>{KIND_LABELS[k]}: {String(n)}</li>)}</ul>}
      {typing.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="font-semibold">Typing observations, for a person to look at</p>
          <ul className="mt-1 list-disc pl-5">{typing.map((e, i) => <li key={i}>{KIND_LABELS[e.kind] ?? e.kind}{e.problem ? ` (${e.problem})` : ''}: {e.why}</li>)}</ul>
          <p className="mt-1 text-xs text-muted">These are plain counts, not a score and not an AI-detection result. They do not change your marks or the proof this drive adds.</p>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Only these events and counts are stored. Your camera video was analysed on your device and was never recorded or uploaded, and what you typed is never kept as a typing record. If you think a flag is wrong, ask your placement officer to review it.</p>
    </Card>
  );
}

/** Wraps the rounds in the proctored window, or shows them directly when the camera is not used (students under 18). */
function Guarded({ required, attemptId, onStarted, children }: { required: boolean; attemptId: string; onStarted: () => void; children: (flush: () => Promise<void>) => React.ReactNode }) {
  if (!required) return <>{children(async () => {})}</>;
  return <ProctorGate attemptId={attemptId} onStarted={onStarted}>{children}</ProctorGate>;
}

function secondsLeft(deadlineAt: string) { return Math.max(0, Math.ceil((new Date(deadlineAt).getTime() - Date.now()) / 1000)); }

/**
 * Last step of a drive: what does your own code do on an input you never saw? Checked by the answer the code really gives,
 * so a pasted solution that the student cannot read earns no proof. One try, on a clock that the server keeps.
 */
function Defence({ checks, attemptId, flush, after }: { checks: any[]; attemptId: string; flush: () => Promise<void>; after: (r: any) => void }) {
  const act = useAction();
  const deadline = checks[0].deadlineAt as string;
  const [left, setLeft] = useState(secondsLeft(deadline));
  const [ans, setAns] = useState<Record<string, string>>({});
  const sent = React.useRef(false);
  const send = React.useCallback(async () => {
    if (sent.current) return;
    sent.current = true;
    await flush();
    const r = await act.run(() => api(`/api/v2/student/mock/attempts/${attemptId}/defence`, { body: { answers: ans } }));
    if (r) after(r.report ?? true); else sent.current = false;
  }, [ans, attemptId, flush, act, after]);
  useEffect(() => { const t = setInterval(() => setLeft(secondsLeft(deadline)), 500); return () => clearInterval(t); }, [deadline]);
  // When the time is up (or the student comes back after it), send what is typed so the drive can finish.
  useEffect(() => { if (left === 0) void send(); }, [left, send]);
  return (
    <Card title="Last step · Explain your own code">
      <p className="mb-3 text-sm text-muted">For each problem you solved, say what your code returns for one test input you have not seen. Work it out by reading your code. You have one try, and the clock is running: <b>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b> left.</p>
      <div className="flex flex-col gap-5">
        {checks.map(c => (
          <div key={c.id} className="flex flex-col gap-2">
            <h3 className="font-semibold">{c.title}</h3>
            <pre className="overflow-x-auto rounded bg-paper p-2 text-xs">{c.code}</pre>
            {c.kind === 'js'
              ? <p className="text-sm">What does <code className="font-mono">{c.entry}({(c.args ?? []).map((a: any) => JSON.stringify(a)).join(', ')})</code> return? Type the value as JSON, for example <code className="font-mono">[0, 1]</code>, <code className="font-mono">5</code> or <code className="font-mono">&quot;abc&quot;</code>.</p>
              : <><p className="text-sm">Your query is run after this data is added. How many rows does it return? Type a whole number.</p><pre className="overflow-x-auto rounded bg-paper p-2 text-xs">{c.setup}</pre></>}
            <input className={inputCls} value={ans[c.id] ?? ''} onChange={e => setAns({ ...ans, [c.id]: e.target.value })} aria-label={`Your answer for ${c.title}`} disabled={left === 0} />
          </div>
        ))}
        <div><Button busy={act.busy} disabled={left === 0} onClick={send}>Submit answers</Button></div>
        <ErrorBox error={act.error} />
      </div>
    </Card>
  );
}
