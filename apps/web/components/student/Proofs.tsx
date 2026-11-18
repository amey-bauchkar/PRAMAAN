'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtDateTime, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, PROOF_LABEL, ProofBadge, StateBadge } from '../ui';
import { CodeBlock, CodeEditor, JudgeResults } from '../code';
import { Cta } from '@/components/Cta';

export function Proofs() {
  const params = useSearchParams();
  const skillId = params.get('skill');
  const probeId = params.get('probe');
  if (probeId) return <Probe id={probeId} />;
  if (skillId) return <SkillDetail id={skillId} />;
  return <ProofOverview />;
}

function ProofOverview() {
  const profile = useApi('/api/v2/student/profile');
  const probes = useApi('/api/v2/student/probes');
  if (!profile.data) return <Loading />;
  const levels = [
    ['Level 1 · Code found', 'Real code in a repository you shared (at least 2 files, 50 lines and 2 weeks of work), or a certificate the issuer confirms.'],
    ['Level 2 · Tested', 'You passed a test on this platform: the practice coding test, an aptitude section, or a learning task.'],
    ['Level 3 · Explained', 'You explained your own code and then changed it correctly while hidden tests ran (the code ownership check).'],
    ['Level 3 · Mentor approved', 'A faculty mentor reviewed your lab, hardware or project work and approved it.'],
  ];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="ST-03" title="Prove a Skill">A skill only becomes Verified after it is checked. Each Verified skill shows how it was proven and when to check it again.</PageHeader>
      <div className="grid gap-3 md:grid-cols-2">
        {levels.map(([t, d]) => <Card key={t}><p className="font-semibold">{t}</p><p className="mt-1 text-sm text-muted">{d}</p></Card>)}
      </div>
      {probes.data?.length > 0 && (
        <Card title="Code ownership check available">
          {probes.data.map((p: any) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-semibold">{p.skill}: {p.file_path}</p><p className="text-sm text-muted">{p.description} · {p.provenance === 'preloaded_demo_snapshot' ? 'sample code for the demo' : 'read from your repository'}</p></div>
              <Cta href={`/student/proofs?probe=${p.id}`}>Start the check</Cta>
            </div>
          ))}
        </Card>
      )}
      <Card title="Your skills">
        <ul className="divide-y divide-line">
          {profile.data.skills.map((s: any) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={`/student/proofs?skill=${s.id}`} className="font-semibold hover:underline">{s.name}</Link>
              <span className="flex items-center gap-2"><StateBadge state={s.state} /><ProofBadge level={s.proofLevel} /></span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function SkillDetail({ id }: { id: string }) {
  const { data, error } = useApi(`/api/v2/student/skills/${id}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const next: Record<string, React.ReactNode> = {
    claimed: <>Add your work on the <Link className="underline" href="/student/import">Add Your Work</Link> page, or prove it in the <Link className="underline" href="/student/mock-drive">practice drive</Link>.</>,
    observed: <>Take the <Link className="underline" href="/student/mock-drive">practice coding test</Link> to turn this into a Verified skill.</>,
    evidence_linked: <>Pass one check: a <Link className="underline" href="/student/mock-drive">practice test</Link>, a <Link className="underline" href="/student/learning-path">learning task</Link>, or get a mentor’s approval.</>,
    verified: <>Keep it current: check it again before {fmtDate(data.validUntil)}.</>,
    expired: <>Pass any new check to make it Verified again.</>,
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="ST-03 · Skill" title={data.name}><span className="flex items-center gap-2"><StateBadge state={data.state} /><ProofBadge level={data.proofLevel} /></span></PageHeader>
      <Notice>{data.explanation} {next[data.state]}</Notice>
      <Card title={`Evidence (${data.evidence.length})`}>
        {data.evidence.length === 0 ? <p className="text-sm text-muted">No evidence yet.</p> :
          <ul className="flex flex-col gap-2 text-sm">{data.evidence.map((e: any) => (
            <li key={e.id} className="rounded-lg border border-line p-3">
              <p className="font-semibold">{e.description}</p>
              <p className="text-xs text-muted">{e.kind.replace('_', ' ')} · {e.source ?? 'import'} · {e.status} · added {fmtDate(e.createdAt)}{e.validUntil ? ` · valid until ${fmtDate(e.validUntil)}` : ''}</p>
            </li>))}</ul>}
      </Card>
      <Card title="History">
        <ol className="flex flex-col gap-1 text-sm">
          {data.history.length === 0 && <li className="text-muted">No changes yet.</li>}
          {data.history.map((h: any, i: number) => (
            <li key={i}><span className="text-muted">{fmtDateTime(h.at)}</span> · {h.from.replace('_', '-')} → <span className="font-semibold">{h.to.replace('_', '-')}</span>{h.proofLevel ? ` (${PROOF_LABEL[h.proofLevel]})` : ''} · {h.reason.replace(/_/g, ' ').toLowerCase()}</li>
          ))}
        </ol>
      </Card>
      <Link href="/student/proofs" className="text-sm font-semibold text-brand hover:underline">← All skills</Link>
    </div>
  );
}

function Probe({ id }: { id: string }) {
  const { data, error, reload } = useApi(`/api/v2/student/probes/${id}`);
  const act = useAction();
  const [answer, setAnswer] = useState('');
  const [predict, setPredict] = useState<any>(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<any>(null);
  useEffect(() => { if (data && !code) setCode(data.code.split('\n').filter((l: string) => !l.startsWith('//')).join('\n')); }, [data, code]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const predicted = predict?.passed || (data.predict && data.predict.score >= 6);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Code ownership check · Level 3" title={`Explain your ${data.skill} code`}>
        Three steps on your own code. We pick the exact lines, you explain what they do, and then you change them while hidden tests run.
      </PageHeader>
      {data.provenance === 'preloaded_demo_snapshot' && <Notice tone="warn">This is sample code for the demo. It was not fetched from GitHub.</Notice>}

      <Card title="1 · The code we picked">
        <p className="mb-2 text-sm">{data.anchor.repository} · <span className="font-mono">{data.anchor.filePath}</span> lines {data.anchor.lineStart}–{data.anchor.lineEnd}</p>
        <p className="mb-3 text-sm">{data.anchor.hashVerified ? <span className="font-semibold text-ink">Code matches your repository</span> : <span className="font-semibold text-red-700">Code does not match your repository</span>}
          <span className="font-mono text-xs text-muted"> sha256 {data.anchor.contentHash.slice(0, 16)}…</span></p>
        <CodeBlock code={data.code} />
      </Card>

      <Card title="2 · Explain what it does">
        <p className="mb-3 text-sm">{data.predictQuestion}</p>
        {predicted ? <Notice tone="success">Answer accepted{predict ? ` (${predict.score}/10)` : ''}. {predict?.missed?.length ? `You could also mention: ${predict.missed.join('; ')}.` : ''}</Notice> : (
          <div className="flex flex-col gap-3">
            <Field label="Your answer"><textarea className={inputCls} rows={4} value={answer} onChange={e => setAnswer(e.target.value)} /></Field>
            <Button busy={act.busy} disabled={answer.length < 10} onClick={async () => { const r = await act.run(() => api(`/api/v2/student/probes/${id}/predict`, { body: { answer } })); if (r) setPredict(r); }}>Submit answer</Button>
            {predict && !predict.passed && <Notice tone="warn">{predict.message} Missed: {predict.missed.join('; ')}</Notice>}
          </div>
        )}
      </Card>

      <Card title="3 · Change the code">
        <p className="mb-3 text-sm">{data.mutationTask}</p>
        {!predicted ? <p className="text-sm text-muted">Complete step 2 first.</p> : (
          <div className="flex flex-col gap-3">
            <CodeEditor label={`Edit ${data.entry}`} value={code} onChange={setCode} />
            <Button busy={act.busy} onClick={async () => { const r = await act.run(() => api(`/api/v2/student/probes/${id}/mutate`, { body: { code } })); if (r) { setResult(r); reload(); } }}>Run tests</Button>
            {result && <Notice tone={result.passed ? 'success' : 'warn'}>{result.message}</Notice>}
            {result && <JudgeResults outcome={result.judge} />}
          </div>
        )}
      </Card>
      <ErrorBox error={act.error} />
    </div>
  );
}
