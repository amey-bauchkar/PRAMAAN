'use client';

import React, { useEffect, useState } from 'react';
import { api, fmtDate, useAction, useApi } from '@/lib/api';
import { GITHUB_SIGNIN, githubToken, signInWithGitHub } from '@/lib/session';
import { Button, Card, Empty, ErrorBox, Field, inputCls, Loading, Notice, PageHeader } from '../ui';

const LEVELS = ['easy', 'medium', 'hard'] as const;
const LEVEL_HELP: Record<string, string> = {
  easy: 'What it is and why: purpose, their own role, the stack',
  medium: 'How it works: a real file or flow, the data, testing, a problem they solved',
  hard: 'Trade-offs: alternatives, 100 times the load, security, what they would reverse',
};
const MAX_PDF = 3 * 1024 * 1024;

type Q = { level: string; question: string; evidence: string | null; lookFor: string[]; followUp: string | null; focus: string; source: 'ai' | 'template' };

function kitAsText(kit: any, candidate: string): string {
  const out = [`Project interview kit: ${candidate}`, `GitHub: https://github.com/${kit.github.login}`, ''];
  for (const p of kit.projects) {
    out.push(`== ${p.name}${p.match ? ` (repository ${p.match.repo})` : ' (no repository found)'} ==`);
    for (const level of LEVELS) {
      const qs: Q[] = (p.questions?.items ?? []).filter((q: Q) => q.level === level);
      if (!qs.length) continue;
      out.push(level.toUpperCase());
      qs.forEach((q, i) => {
        out.push(`${i + 1}. ${q.question}${q.evidence ? `  [${q.evidence}]` : ''}`);
        out.push(`   A good answer covers: ${q.lookFor.join('; ')}`);
        if (q.followUp) out.push(`   Follow-up: ${q.followUp}`);
      });
    }
    out.push('');
  }
  return out.join('\n');
}

export function InterviewKit() {
  const drives = useApi('/api/v2/recruiter/drives');
  const [driveId, setDriveId] = useState('');
  const cands = useApi(driveId ? `/api/v2/recruiter/kit/candidates?driveId=${driveId}` : null);
  const act = useAction();
  const [studentId, setStudentId] = useState('');
  const [profile, setProfile] = useState('');
  const [mode, setMode] = useState<'paste' | 'pdf'>('paste');
  const [resumeText, setResumeText] = useState('');
  const [pdf, setPdf] = useState<{ name: string; b64: string } | null>(null);
  const [kit, setKit] = useState<any>(null);
  const [perLevel, setPerLevel] = useState(2);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [ghToken, setGhToken] = useState<string | null>(null);
  const earlier = useApi(studentId ? `/api/v2/recruiter/kit?studentId=${studentId}` : null);

  useEffect(() => { setGhToken(githubToken()); }, []);
  useEffect(() => { if (drives.data && !driveId && drives.data.drives[0]) setDriveId(drives.data.drives[0].id); }, [drives.data, driveId]);
  useEffect(() => { setStudentId(''); setKit(null); }, [driveId]);

  if (drives.error) return <ErrorBox error={drives.error} />;
  if (!drives.data) return <Loading />;
  if (drives.data.drives.length === 0) return <Empty>You do not have access to any drive yet. The placement office gives access one drive at a time.</Empty>;

  const candidate = cands.data?.candidates.find((c: any) => c.id === studentId)?.name ?? 'Candidate';
  const ready = !!studentId && profile.trim().length > 0 && (mode === 'paste' ? resumeText.trim().length >= 40 : !!pdf);

  const readPdf = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_PDF) { act.setError('That PDF is larger than 3 MB. Paste the text of the Projects section instead.'); return; }
    const rd = new FileReader();
    rd.onload = () => { const s = String(rd.result); setPdf({ name: f.name, b64: s.slice(s.indexOf(',') + 1) }); act.setError(null); };
    rd.readAsDataURL(f);
  };

  const scan = async () => {
    const r = await act.run(() => api('/api/v2/recruiter/kit/scan', { body: { driveId, studentId, githubProfile: profile, resumeText: mode === 'paste' ? resumeText : '', resumePdfBase64: mode === 'pdf' ? pdf?.b64 : '', githubToken: githubToken() ?? undefined } }));
    if (r) { setKit(r); earlier.reload(); }
  };

  const generate = async (index: number) => {
    setBusyIdx(index);
    const r = await act.run(() => api(`/api/v2/recruiter/kit/${kit.id}/questions`, { body: { projectIndex: index, perLevel } }));
    setBusyIdx(null);
    if (r) setKit((k: any) => ({ ...k, projects: k.projects.map((p: any) => (p.index === index ? { ...p, questions: r.questions } : p)) }));
  };
  const generateAll = async () => { for (const p of kit.projects) await generate(p.index); };
  const open = async (id: string) => { const r = await act.run(() => api(`/api/v2/recruiter/kit/${id}`)); if (r) setKit(r); };
  const copy = async () => { try { await navigator.clipboard.writeText(kitAsText(kit, candidate)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="New" title="Project Interview Kit">Pick a candidate, paste their GitHub profile and resume. PRAMAAN reads their public projects, finds the ones the resume highlights, and drafts easy, medium and hard questions about the real code. You decide what to ask: nothing is scored.</PageHeader>
      <ErrorBox error={act.error} />

      <Card title="1. Candidate and sources">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Field label="Drive"><select className={inputCls} value={driveId} onChange={e => setDriveId(e.target.value)}>{drives.data.drives.map((d: any) => <option key={d.id} value={d.id}>{d.company} · {d.title}</option>)}</select></Field>
            <Field label="Candidate" hint="Only students who are eligible or applied, and agreed to share with recruiters.">
              <select className={inputCls} value={studentId} onChange={e => { setStudentId(e.target.value); setKit(null); }}>
                <option value="">Choose a candidate…</option>
                {cands.data?.candidates.map((c: any) => <option key={c.id} value={c.id}>{c.name} · {c.branch}</option>)}
              </select>
            </Field>
            <Field label="GitHub profile" hint="For example https://github.com/username. Only public repositories are read."><input className={inputCls} value={profile} onChange={e => setProfile(e.target.value)} placeholder="https://github.com/username" /></Field>
            <p className="text-xs text-muted">
              {ghToken ? 'Signed in with GitHub: scans use your own GitHub request limit.' : cands.data?.githubToken === 'server' ? 'Scans use the college’s GitHub token.' : 'Not signed in with GitHub: GitHub allows very few scans an hour for everyone sharing this connection.'}
              {!ghToken && GITHUB_SIGNIN && <> <button type="button" className="underline" onClick={async () => { act.setError(await signInWithGitHub('/recruiter/interview-kit')); }}>Sign in with GitHub</button></>}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2 text-sm" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'paste'} onClick={() => setMode('paste')} className={`rounded-full px-3 py-1 ${mode === 'paste' ? 'bg-ink text-paper' : 'border border-line'}`}>Paste resume text</button>
              <button type="button" role="tab" aria-selected={mode === 'pdf'} onClick={() => setMode('pdf')} className={`rounded-full px-3 py-1 ${mode === 'pdf' ? 'bg-ink text-paper' : 'border border-line'}`}>Upload PDF</button>
            </div>
            {mode === 'paste'
              ? <Field label="Resume" hint="The whole resume, or just its Projects section."><textarea className={inputCls} rows={11} value={resumeText} onChange={e => setResumeText(e.target.value)} spellCheck={false} placeholder={'PROJECTS\nCampus Cab Share | React, Node.js, MongoDB\n• Ride-sharing app for students…'} /></Field>
              : <Field label="Resume PDF" hint="Up to 3 MB. It must contain text; a scanned picture cannot be read."><input type="file" accept="application/pdf" className={inputCls} onChange={e => readPdf(e.target.files?.[0])} />{pdf && <span className="text-xs text-muted">{pdf.name}</span>}</Field>}
          </div>
        </div>
        <Notice>The candidate chose to share with recruiters. Only the Projects part of the resume, with emails, phone numbers and links removed, and public code with secrets removed, is sent to the AI (Groq, then Gemini) to draft questions. The resume itself is not stored. Withdrawing sharing consent deletes the kit.</Notice>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button busy={act.busy && busyIdx === null} disabled={!ready} onClick={scan}>Scan and find projects</Button>
          <span className="text-sm text-muted">{act.busy && busyIdx === null ? 'Reading GitHub and the resume. This can take up to a minute.' : ''}</span>
        </div>
        {earlier.data?.kits?.length > 0 && (
          <p className="mt-3 text-sm text-muted">Earlier for this candidate: {earlier.data.kits.map((k: any) => <button key={k.id} type="button" className="mr-3 underline" onClick={() => open(k.id)}>{k.github} · {fmtDate(k.createdAt)}</button>)}</p>
        )}
      </Card>

      {kit && <Result kit={kit} perLevel={perLevel} setPerLevel={setPerLevel} generate={generate} generateAll={generateAll} busyIdx={busyIdx} busy={act.busy} copy={copy} copied={copied} />}
    </div>
  );
}

function Result({ kit, perLevel, setPerLevel, generate, generateAll, busyIdx, busy, copy, copied }: any) {
  const g = kit.github;
  return (
    <>
      <Card title="2. What was found on GitHub">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="text-sm">
            <p><b>{g.name ?? g.login}</b> <span className="text-muted">@{g.login}</span> · {g.publicRepos} public repositories · {g.followers} followers</p>
            {g.bio && <p className="text-muted">{g.bio}</p>}
            <p className="mt-2">Name on GitHub {g.nameCheck === 'same' ? <b>matches</b> : g.nameCheck === 'different' ? <b className="text-red-700 dark:text-red-300">does not match</b> : <b>is not shown</b>} the candidate’s name ({g.candidateName}). Check this is the right person.</p>
            <p className="mt-1 text-muted">Read in depth: {kit.scan.reposDeep} of {kit.scan.reposTotal} repositories{g.forks ? ` · ${g.forks} are forks` : ''}.</p>
          </div>
          <div className="text-sm">
            <p className="font-semibold">Main languages</p>
            <p className="text-muted">{g.topLanguages.map((l: any) => `${l.name} (${l.repos})`).join(', ') || 'None listed'}</p>
          </div>
        </div>
        {kit.scan.rateLimited && <div className="mt-3"><Notice tone="warn">GitHub’s request limit stopped part of the scan, so some projects were read less deeply. Sign in with GitHub for a higher limit, or try again later.</Notice></div>}
        {g.truncated && <p className="mt-2 text-xs text-muted">Only the 200 most recently updated repositories were listed.</p>}
      </Card>

      <Card title="3. Highlighted projects and their questions" actions={
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">Questions per level <select className="rounded border border-line bg-paper px-1" value={perLevel} onChange={e => setPerLevel(Number(e.target.value))}>{[1, 2, 3, 4].map(n => <option key={n}>{n}</option>)}</select></label>
          <Button busy={busy} onClick={generateAll}>Draft questions for all</Button>
          <Button kind="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy everything'}</Button>
        </span>}>
        <p className="mb-3 text-xs text-muted">Projects were read from the resume {kit.extraction && kit.extraction !== 'rules' ? `by the AI (${kit.extraction})` : 'with simple rules, because the AI was not available'}. Ignore any project you do not want to ask about.</p>
        <div className="flex flex-col gap-5">
          {kit.projects.map((p: any) => <Project key={p.index} p={p} generate={generate} busy={busyIdx === p.index} />)}
        </div>
      </Card>
    </>
  );
}

function Project({ p, generate, busy }: { p: any; generate: (i: number) => void; busy: boolean }) {
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('easy');
  const tone = p.status === 'matched' ? 'success' : p.status === 'possible' ? 'info' : 'warn';
  const qs: Q[] = p.questions?.items ?? [];
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold">{p.name}</h3>
          {p.summary && <p className="text-sm text-muted">{p.summary}</p>}
          {p.tech.length > 0 && <p className="mt-1 text-xs text-muted">Resume says: {p.tech.join(', ')}</p>}
        </div>
        <Button kind={p.questions ? 'secondary' : 'primary'} busy={busy} onClick={() => generate(p.index)}>{p.questions ? 'Draft again' : 'Draft questions'}</Button>
      </div>

      <div className="mt-3"><Notice tone={tone as any}>
        {p.match ? (
          <>
            <b>{p.status === 'matched' ? 'Found on GitHub' : 'Possible match, confirm with the candidate'}:</b> <a className="underline" href={p.match.url} target="_blank" rel="noreferrer noopener">{p.match.repo}</a>
            {p.match.fork ? ' (a fork)' : ''} · {p.match.language ?? 'language not listed'} · {p.match.stars} stars · updated {fmtDate(p.match.pushedAt)}
            <ul className="mt-1 list-disc pl-5">{p.match.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
            <p className="mt-1 text-xs">Read: {p.scanned.files} files{p.scanned.hasTests ? ' · has tests' : ' · no tests found'}{p.scanned.hasCI ? ' · automated checks' : ''}{p.scanned.hasDocker ? ' · Docker' : ''}{p.scanned.commits ? ` · the candidate wrote ${p.scanned.commits.byCandidate} of the latest ${p.scanned.commits.seen} commits` : ''}.</p>
          </>
        ) : (
          <><b>No matching public repository found.</b> It may be private, kept in another account, or named differently. This is not a finding about the candidate: ask them to show it. The questions below come from the resume only.</>
        )}
      </Notice></div>

      {p.questions && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2" role="tablist">
            {LEVELS.map(l => <button key={l} type="button" role="tab" aria-selected={level === l} onClick={() => setLevel(l)} className={`rounded-full px-3 py-1 text-sm capitalize ${level === l ? 'bg-ink text-paper' : 'border border-line'}`}>{l} ({qs.filter(q => q.level === l).length})</button>)}
            <span className="text-xs text-muted">{LEVEL_HELP[level]}</span>
          </div>
          <ol className="mt-3 flex flex-col gap-3">
            {qs.filter(q => q.level === level).map((q, i) => (
              <li key={i} className="rounded-xl border border-line bg-paper p-3 text-sm">
                <p className="font-medium">{i + 1}. {q.question}</p>
                <p className="mt-1 text-xs text-muted">
                  <span className="rounded border border-line px-1">{q.source === 'ai' ? 'AI draft' : 'Template'}</span>{' '}
                  {q.evidence ? <>Based on <code className="font-mono">{q.evidence}</code></> : 'About the project as a whole'}
                </p>
                <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold">A good answer covers, and a follow-up</summary>
                  <ul className="mt-1 list-disc pl-5">{q.lookFor.map((l, j) => <li key={j}>{l}</li>)}</ul>
                  {q.followUp && <p className="mt-1"><b>Follow-up:</b> {q.followUp}</p>}
                </details>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted">{p.questions.source === 'template' ? 'Drafted from the facts above with fixed templates, because the AI was not available.' : p.questions.source === 'mixed' ? `Drafted by the AI (${p.questions.model}); templates filled the gaps.` : `Drafted by the AI (${p.questions.model}).`} Questions are suggestions for you, not a score of the candidate.</p>
        </div>
      )}
    </div>
  );
}
