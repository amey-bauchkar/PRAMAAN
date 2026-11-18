'use client';

import Link from 'next/link';
import React from 'react';
import { fmtDate, useApi } from '@/lib/api';
import { PROOF_LABEL } from '@/components/ui';
import { Cta } from '@/components/Cta';

/** One-click resume (ST-01): generated from verified proof; print or save as PDF from the browser. */
export default function ResumePage() {
  const { data, error } = useApi('/api/v2/student/resume');
  if (error) return <p className="p-8">{error} <Link className="underline" href="/login">Sign in</Link></p>;
  if (!data) return <p className="p-8 text-muted">Generating…</p>;
  const groups = new Map<string, any[]>();
  for (const s of data.verifiedSkills) groups.set(s.category, [...(groups.get(s.category) ?? []), s]);
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="no-print mb-6 flex items-center justify-between gap-3">
        <Link href="/student/profile" className="text-sm font-semibold text-brand hover:underline">← Back to profile</Link>
        <Cta onClick={() => window.print()}>Print or save as PDF</Cta>
      </div>
      <article className="rounded-2xl border border-line bg-card p-8 print:border-0 print:p-0">
        <h1 className="font-display text-3xl font-bold">{data.name}</h1>
        <p className="text-muted">{data.department} · {data.college} · Batch of {data.graduatingYear} · {data.email}</p>

        <h2 className="mt-6 border-b border-line pb-1 font-display text-lg font-semibold">Education</h2>
        <p className="mt-2 text-sm">B.E./Diploma, {data.department}, {data.college} — CGPA {data.academics.cgpa ?? '—'}</p>
        <p className="text-sm">{data.academics.twelfthPct ? `12th: ${data.academics.twelfthPct}%` : data.academics.diplomaPct ? `Diploma: ${data.academics.diplomaPct}%` : ''}{data.academics.tenthPct ? ` · 10th: ${data.academics.tenthPct}%` : ''}</p>

        <h2 className="mt-6 border-b border-line pb-1 font-display text-lg font-semibold">Verified skills</h2>
        {[...groups.entries()].map(([cat, items]) => (
          <p key={cat} className="mt-2 text-sm"><span className="font-semibold">{cat}:</span> {items.map(s => `${s.name} (${PROOF_LABEL[s.proofLevel] ?? s.proofLevel})`).join(', ')}</p>
        ))}

        {data.projects.length > 0 && (<>
          <h2 className="mt-6 border-b border-line pb-1 font-display text-lg font-semibold">Projects with code as proof</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">{data.projects.map((p: any) => <li key={p.path}>{p.description ?? p.path} — {p.skill}</li>)}</ul>
        </>)}

        {(data.latestMock || data.profiles.length > 0) && (<>
          <h2 className="mt-6 border-b border-line pb-1 font-display text-lg font-semibold">Tests and coding profiles</h2>
          {data.latestMock && <p className="mt-2 text-sm">Practice drive ({data.latestMock.role}): {data.latestMock.totalPercent}% on {fmtDate(data.latestMock.at)}</p>}
          {data.profiles.map((p: any) => <p key={p.provider} className="text-sm capitalize">{p.provider} @{p.handle}: {Object.entries(p.stats ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}</p>)}
        </>)}

        <p className="mt-8 text-xs text-muted">{data.note} Generated {fmtDate(data.generatedAt)} by PRAMAAN. Proof levels: Level 1 code found, Level 2 tested, Level 3 explained or mentor approved.</p>
      </article>
    </div>
  );
}
