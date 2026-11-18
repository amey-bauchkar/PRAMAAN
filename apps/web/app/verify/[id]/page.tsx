'use client';

import { useParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { API_URL } from '@/lib/session';
import { PROOF_LABEL } from '@/components/ui';

/** Public Skill Passport verification: no sign-in, anyone the student shares the link with. */
export default function VerifyPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${API_URL}/api/public/credentials/${id}`).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setData(j); }).catch(e => setError(e.message));
  }, [id]);
  if (error) return <main className="mx-auto max-w-xl p-8"><h1 className="font-display text-2xl font-semibold">Certificate not found</h1><p className="mt-2 text-muted">{error}</p></main>;
  if (!data) return <main className="p-8 text-muted">Checking…</main>;
  const c = data.credential, ok = data.check.valid;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-12">
      <p className="text-sm font-semibold uppercase tracking-wider text-brand">PRAMAAN Skill Certificate</p>
      <div className={`rounded-2xl border-2 p-6 ${ok ? 'border-ink' : 'border-red-600'}`}>
        <p className={`font-display text-2xl font-semibold ${ok ? 'text-ink' : 'text-red-700 dark:text-red-300'}`}>{ok ? 'Valid credential' : 'Not valid'}</p>
        {!ok && <ul className="mt-2 list-disc pl-5 text-sm">{data.check.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>}
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Holder</dt><dd className="font-semibold">{c.credentialSubject.name}</dd>
          <dt className="text-muted">Skill</dt><dd className="font-semibold">{c.credentialSubject.achievement.name}</dd>
          <dt className="text-muted">How proven</dt><dd>{c.credentialSubject.achievement.description}</dd>
          <dt className="text-muted">Issued by</dt><dd>{c.issuer.name}</dd>
          <dt className="text-muted">Valid</dt><dd>{new Date(c.validFrom).toLocaleDateString('en-IN')} – {new Date(c.validUntil).toLocaleDateString('en-IN')}</dd>
          <dt className="text-muted">Signature</dt><dd>{data.check.signatureValid ? 'Valid: signed by the college' : 'Not valid: signature does not match'} <span className="text-xs text-muted">({data.issuerKeyId})</span></dd>
        </dl>
        {c.evidence?.length > 0 && <><p className="mt-4 text-sm font-semibold">Evidence</p><ul className="list-disc pl-5 text-sm">{c.evidence.map((e: any) => <li key={e.id}>{e.description}</li>)}</ul></>}
      </div>
      <details className="text-sm"><summary className="cursor-pointer font-semibold">Technical details (Open Badges 3.0)</summary><pre className="mt-2 overflow-x-auto rounded bg-card p-3 text-xs">{JSON.stringify(c, null, 2)}</pre></details>
      <p className="text-xs text-muted">{Object.keys(PROOF_LABEL).length ? 'Proof levels: Level 1 code found, Level 2 tested, Level 3 explained or mentor approved.' : ''}</p>
    </main>
  );
}
