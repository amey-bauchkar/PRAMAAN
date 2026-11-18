'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { api, fmtDate, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, inputCls, LinkButton, Loading, Notice, PageHeader, ProofBadge, StateBadge, Table, Td } from '../ui';

export function Profile() {
  const { data, error, loading, reload } = useApi('/api/v2/student/profile');
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const p = data;

  const search = async (v: string) => { setQ(v); setResults(v.length > 1 ? await api(`/api/v2/catalog/skills?q=${encodeURIComponent(v)}`) : []); };
  const claim = async (slug: string) => {
    const r = await act.run(() => api('/api/v2/student/skills/claim', { body: { skillSlug: slug } }));
    if (r) { setMsg(r.message); setQ(''); setResults([]); reload(); }
  };
  const issue = async (id: string) => {
    const r = await act.run(() => api('/api/v2/student/credentials', { body: { studentSkillId: id } }));
    if (r) { setMsg(`Certificate created. Share this link so anyone can check it: ${r.verifyUrl}`); reload(); }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="ST-01" title={p.student.name} actions={<LinkButton href="/resume" kind="primary">Generate resume</LinkButton>}>
        {p.student.department} · {p.student.college} · Batch of {p.student.graduatingYear}
        {p.student.isMinor && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-[#14162E]">Under 18: extra privacy protections apply</span>}
      </PageHeader>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Marks">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">CGPA</dt><dd>{p.academics.cgpa ?? '—'}</dd>
            <dt className="text-muted">10th</dt><dd>{p.academics.tenthPct ? `${p.academics.tenthPct}%` : '—'}</dd>
            <dt className="text-muted">{p.academics.diplomaPct ? 'Diploma' : '12th'}</dt><dd>{p.academics.diplomaPct ?? p.academics.twelfthPct ?? '—'}%</dd>
            <dt className="text-muted">Active backlogs</dt><dd>{p.academics.activeBacklogs ?? '—'}</dd>
          </dl>
          <p className="mt-3 text-xs text-muted">These come from your college’s records. Ask the placement office to fix any mistakes.</p>
        </Card>
        <Card title="Coding profiles">
          {p.externalProfiles.length === 0 ? <p className="text-sm text-muted">None linked. <Link className="text-brand underline" href="/student/import">Link LeetCode or Codeforces</Link>.</p> :
            <ul className="flex flex-col gap-2 text-sm">{p.externalProfiles.map((x: any) => (
              <li key={x.provider}><span className="font-semibold capitalize">{x.provider}</span> @{x.handle} · {x.status}
                {x.stats && <span className="block text-muted">{Object.entries(x.stats).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span>}
                {x.source === 'demo_fixture' && <span className="text-xs text-muted">(demo fixture)</span>}</li>))}</ul>}
        </Card>
        <Card title="Add a skill you have">
          <input aria-label="Search skills" className={`${inputCls} w-full`} placeholder="e.g. SQL, AutoCAD, PLC" value={q} onChange={e => search(e.target.value)} />
          <ul className="mt-2 max-h-40 overflow-y-auto text-sm">
            {results.map(r => <li key={r.slug}><button className="w-full rounded px-2 py-1 text-left hover:bg-brand/10" onClick={() => claim(r.slug)}>{r.name} <span className="text-muted">· {r.category}</span></button></li>)}
          </ul>
          <p className="mt-2 text-xs text-muted">A new skill starts as Claimed until you add proof of it.</p>
        </Card>
      </div>

      <Card title={`Skills (${p.skills.length})`}>
        <Table head={['Skill', 'Status', 'Proof level', 'Evidence', 'Check again by', '']} caption="Your skills">
          {p.skills.map((s: any) => (
            <tr key={s.id}>
              <Td><Link href={`/student/proofs?skill=${s.id}`} className="font-semibold hover:underline">{s.name}</Link><span className="block text-xs text-muted">{s.category}</span></Td>
              <Td><StateBadge state={s.state} /></Td>
              <Td><ProofBadge level={s.proofLevel} /></Td>
              <Td className="tabular-nums">{s.evidenceCount}</Td>
              <Td>{s.state === 'verified' ? <span className={s.expiresSoon ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}>{fmtDate(s.validUntil)}{s.expiresSoon ? ' (soon)' : ''}</span> : '—'}</Td>
              <Td>{s.state === 'verified' && !p.credentials.some((c: any) => c.skill === s.name && c.status === 'active') &&
                <Button kind="ghost" busy={act.busy} onClick={() => issue(s.id)}>Get certificate</Button>}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      {p.credentials.length > 0 && (
        <Card title="Skill certificates">
          <ul className="flex flex-col gap-2 text-sm">
            {p.credentials.map((c: any) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2"><span className="font-semibold">{c.skill}</span><ProofBadge level={c.proofLevel} />
                <span className="text-muted">valid until {fmtDate(c.validUntil)}</span>
                <Link className="text-brand underline" href={`/verify/${c.id}`}>Check this certificate</Link></li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Signed by your college using an open standard (Open Badges 3.0). Anyone with the link can check that it is real and has not been changed.</p>
        </Card>
      )}
    </div>
  );
}
