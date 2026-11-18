'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { api, fmtDate, useAction, useApi } from '@/lib/api';
import { Button, Card, Empty, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, ProofBadge } from '../ui';

export function Search() {
  const params = useSearchParams();
  const candidate = params.get('candidate');
  const drive = params.get('drive');
  if (candidate && drive) return <EvidenceCard id={candidate} driveId={drive} />;
  return <SearchView />;
}

function SearchView() {
  const { data, error } = useApi('/api/v2/recruiter/drives');
  const act = useAction();
  const [driveId, setDriveId] = useState('');
  const [filters, setFilters] = useState<{ slug: string; proof: string }[]>([{ slug: 'sql', proof: 'L2' }]);
  const [maxAge, setMaxAge] = useState('');
  const [res, setRes] = useState<any>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (data && !driveId && data.drives[0]) setDriveId(data.drives[0].id); }, [data, driveId]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  if (data.drives.length === 0) return <Empty>You do not have access to any drive yet. The placement office gives access one drive at a time.</Empty>;

  const search = async () => {
    const q = filters.filter(f => f.slug).map(f => `${f.slug}:${f.proof}`).join(',');
    const r = await act.run(() => api(`/api/v2/recruiter/search?driveId=${driveId}&skills=${encodeURIComponent(q)}${maxAge ? `&maxAgeDays=${maxAge}` : ''}`));
    if (r) { setRes(r); setPicked([]); }
  };
  const shortlist = async () => { const r = await act.run(() => api('/api/v2/recruiter/shortlist', { body: { driveId, studentIds: picked } })); if (r) setMsg(r.message); };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="AD-08" title="Candidate Search">You only see students who are eligible for or have applied to your drive and chose to share with recruiters. Each result shows exactly why it matched. There is no hidden score.</PageHeader>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      <Card>
        <div className="grid gap-3 md:grid-cols-[2fr_3fr_1fr_auto] md:items-end">
          <Field label="Drive"><select className={inputCls} value={driveId} onChange={e => setDriveId(e.target.value)}>{data.drives.map((d: any) => <option key={d.id} value={d.id}>{d.title} · access until {fmtDate(d.accessUntil)}</option>)}</select></Field>
          <div className="flex flex-col gap-2">
            {filters.map((f, i) => (
              <div key={i} className="flex gap-2">
                <select aria-label="Skill" className={`${inputCls} flex-1`} value={f.slug} onChange={e => setFilters(filters.map((x, j) => j === i ? { ...x, slug: e.target.value } : x))}>
                  <option value="">Skill…</option>{data.skills.map((s: any) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
                </select>
                <select aria-label="Minimum proof level" className={inputCls} value={f.proof} onChange={e => setFilters(filters.map((x, j) => j === i ? { ...x, proof: e.target.value } : x))}>{['L1', 'L2', 'L3'].map(p => <option key={p} value={p}>Level {p.slice(1)} or higher</option>)}</select>
                {filters.length > 1 && <Button kind="secondary" onClick={() => setFilters(filters.filter((_, j) => j !== i))}>×</Button>}
              </div>
            ))}
            <Button kind="ghost" className="self-start" onClick={() => setFilters([...filters, { slug: '', proof: 'L1' }])}>+ Skill</Button>
          </div>
          <Field label="Proof checked within (days)"><input className={inputCls} type="number" value={maxAge} onChange={e => setMaxAge(e.target.value)} placeholder="any" /></Field>
          <Button busy={act.busy} onClick={search}>Search</Button>
        </div>
      </Card>
      {res && (
        <>
          <p className="text-sm text-muted">{res.results.length} of {res.poolSize} candidates who share their profile matched. {res.sortOrder}</p>
          {picked.length > 0 && <div><Button busy={act.busy} onClick={shortlist}>Ask for a shortlist of {picked.length} (the placement officer must approve)</Button></div>}
          <ul className="flex flex-col gap-3">
            {res.results.map((c: any) => (
              <li key={c.studentId} className="flex gap-3 rounded-2xl border border-line bg-card p-4">
                <input type="checkbox" aria-label={`Select ${c.displayName}`} checked={picked.includes(c.studentId)} onChange={e => setPicked(e.target.checked ? [...picked, c.studentId] : picked.filter(x => x !== c.studentId))} />
                <div className="min-w-0 flex-1">
                  <Link href={`/recruiter/search?candidate=${c.studentId}&drive=${driveId}`} className="font-semibold hover:underline">{c.displayName}</Link> <span className="text-sm text-muted">· {c.branch} · matched {c.matchedCount}/{c.matchedCount + c.unmatched.length}</span>
                  <ul className="mt-1 text-sm">{c.matched.map((m: any, i: number) => <li key={i}>✓ {m.reason}</li>)}{c.unmatched.map((u: any, i: number) => <li key={`u${i}`} className="text-muted">– {u.skill}: {u.reason}</li>)}</ul>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function EvidenceCard({ id, driveId }: { id: string; driveId: string }) {
  const { data, error } = useApi(`/api/v2/recruiter/candidates/${id}?driveId=${driveId}`);
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Candidate profile" title={data.name}>{data.department} · Batch of {data.graduatingYear} · CGPA {data.cgpa ?? '—'}{data.application ? ` · application: ${data.application.stage}` : ''}</PageHeader>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      <Notice>{data.note}</Notice>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.skills.map((s: any) => (
          <Card key={s.name} title={s.name} actions={<ProofBadge level={s.proofLevel} />}>
            <p className="text-xs text-muted">Verified {fmtDate(s.verifiedAt)} · check again by {fmtDate(s.validUntil)} · level {s.level}</p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">{s.evidence.map((e: any, i: number) => <li key={i}>{e.description} <span className="font-mono text-xs text-muted">#{e.hash}</span></li>)}</ul>
            <Button kind="ghost" className="mt-2" busy={act.busy} onClick={async () => { const r = await act.run(() => api('/api/v2/recruiter/reprobe', { body: { studentId: id, skill: s.name } })); if (r) setMsg(r.message); }}>Ask for a new check</Button>
          </Card>
        ))}
      </div>
      {data.mock && <Card title={`Latest practice drive (${data.mock.role})`}><p className="text-sm">{data.mock.rounds.map((r: any) => `${r.round.replace('_', ' ')} ${r.score}/${r.maxScore}`).join(' · ')}</p></Card>}
      <Link href="/recruiter/search" className="text-sm font-semibold text-brand hover:underline">← Back to search</Link>
    </div>
  );
}
