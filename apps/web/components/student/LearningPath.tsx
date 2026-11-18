'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import React, { useState } from 'react';
import { api, useAction, useApi } from '@/lib/api';
import { Button, Card, Empty, ErrorBox, Field, inputCls, Loading, Notice, PageHeader } from '../ui';
import { CodeEditor, JudgeResults } from '../code';

export function LearningPath() {
  const item = useSearchParams().get('item');
  return item ? <Task id={item} /> : <Path />;
}

function Path() {
  const { data, error, reload, setData } = useApi('/api/v2/student/learning-path');
  const act = useAction();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const p = data.path;
  const generate = async () => { const r = await act.run(() => api('/api/v2/student/learning-path/generate', { body: {} })); if (r) setData(r); };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="ST-06" title="Learning Plan" actions={<Button kind={p ? 'secondary' : 'primary'} busy={act.busy} onClick={generate}>{p ? 'Update with latest results' : 'Build my plan'}</Button>}>
        Based on your latest practice drive and the skill gaps that block the most drives. Every task adds new proof to your profile, not just a tick.
      </PageHeader>
      <ErrorBox error={act.error} />
      {!p ? <Empty>No plan yet. Take a practice drive, then build your plan.</Empty> : (
        <>
          {p.rationale?.topActions?.length > 0 && <Notice>Why these tasks: {p.rationale.topActions.join(' · ')}{p.rationale.weakTopics?.length ? ` · weak topics: ${p.rationale.weakTopics.join(', ')}` : ''}</Notice>}
          {p.retakeUnlocked && <Notice tone="success">You have passed half your tasks. <Link className="underline" href="/student/mock-drive">Retake the practice drive</Link> to see how much you have improved.</Notice>}
          <ol className="flex flex-col gap-3">
            {p.items.map((it: any) => (
              <li key={it.id}>
                <Link href={`/student/learning-path?item=${it.id}`} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-card p-4 hover:border-brand">
                  <span className="min-w-0">
                    <span className="block font-semibold">{it.position}. {it.title}</span>
                    <span className="block text-sm text-muted">{it.skill} · target proof {it.target_proof} · about {it.estHours} h · {it.kind === 'coding' ? 'checked automatically' : 'reviewed by a mentor'}</span>
                    <span className="mt-1 block text-sm">{it.reason}</span>
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${it.status === 'passed' ? 'bg-ink text-white' : it.status === 'failed' ? 'border border-red-600 text-red-700 dark:text-red-300' : it.status === 'submitted' ? 'bg-accent text-[#14162E]' : 'border border-line'}`}>
                    {{ todo: 'To do', submitted: 'In review', passed: 'Passed', failed: 'Try again' }[it.status as string]}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
      {act.busy ? null : <button className="sr-only" onClick={reload}>Refresh</button>}
    </div>
  );
}

function Task({ id }: { id: string }) {
  const { data, error, reload } = useApi(`/api/v2/student/learning-path/items/${id}`);
  const act = useAction();
  const [code, setCode] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [result, setResult] = useState<any>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const src = code ?? data.problem?.starter ?? '';
  const submit = async (body: unknown) => { const r = await act.run(() => api(`/api/v2/student/learning-path/items/${id}/submit`, { body })); if (r) { setResult(r); reload(); } };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow={`Learning task · ${data.skill} → ${data.targetProof}`} title={data.title}>{data.description}</PageHeader>
      <Notice>{data.reason}</Notice>
      {data.status === 'passed' && <Notice tone="success">Passed. This proof is now on your profile.</Notice>}
      {data.problem ? (
        <Card title={data.problem.title}>
          <p className="mb-2 text-sm">{data.problem.statement}</p>
          {data.problem.schema && <pre className="mb-2 overflow-x-auto rounded bg-paper p-2 text-xs">{data.problem.schema}</pre>}
          <CodeEditor label={data.problem.language === 'sql' ? 'Your query' : 'Your code'} value={src} onChange={setCode} />
          <div className="mt-3"><Button busy={act.busy} onClick={() => submit({ code: src })}>Submit for checking</Button></div>
        </Card>
      ) : (
        <Card title="Submit your work">
          <Field label="Link to your work (repository, document or folder)"><input className={inputCls} type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="https://" /></Field>
          <div className="mt-3"><Button busy={act.busy} disabled={!link.startsWith('http')} onClick={() => submit({ link })}>Send to mentor</Button></div>
        </Card>
      )}
      <ErrorBox error={act.error} />
      {result && <Notice tone={result.status === 'passed' ? 'success' : 'warn'}>{result.message}</Notice>}
      {result?.judge && <JudgeResults outcome={result.judge} />}
      <Link href="/student/learning-path" className="text-sm font-semibold text-brand hover:underline">← Back to my plan</Link>
    </div>
  );
}
