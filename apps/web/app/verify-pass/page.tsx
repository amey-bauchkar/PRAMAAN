'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { API_URL } from '@/lib/session';
import { Cta } from '@/components/Cta';

const LABELS: Record<string, string> = { name: 'Name', branch: 'Branch', graduating_year: 'Graduating year', cgpa: 'CGPA' };

/** Public verifier for Eligibility Passes: no account needed. */
export default function VerifyPassPage() {
  const [verifier, setVerifier] = useState('');
  const [request, setRequest] = useState<{ requestCode: string; audience: string } | null>(null);
  const [presentation, setPresentation] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (path: string, body: unknown) => {
    setError(null);
    const r = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? 'Request failed.');
    return j;
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/" className="font-display text-xl font-bold">PRAMAAN</Link>
        <h1 className="mt-4 font-display text-3xl font-semibold">Verify an Eligibility Pass</h1>
        <p className="mt-2 text-muted">Check that a student meets a drive’s requirements. The pass is signed by their college, and you only see what the student chose to share. No account needed.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-600/40 bg-red-600/10 p-3 text-sm">{error}</p>}

      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-display text-lg font-semibold">1 · Create a request</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">Your organisation
            <input className="rounded-lg border border-line bg-paper px-3 py-2 font-normal" value={verifier} onChange={e => setVerifier(e.target.value)} placeholder="e.g. Nimbus Analytics" />
          </label>
          <Cta disabled={verifier.trim().length < 3}
            onClick={async () => { try { setRequest(await call('/api/public/pass-requests', { verifier })); setResult(null); } catch (e: any) { setError(e.message); } }}>Create request</Cta>
        </div>
        {request && (
          <div className="mt-3 text-sm">
            <p>Give the student this code. It works once and expires in 15 minutes:</p>
            <p className="mt-2 break-all rounded-lg bg-paper p-3 font-mono text-xs">{request.requestCode}</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-display text-lg font-semibold">2 · Paste what the student sends you</h2>
        <textarea className="mt-3 w-full rounded-lg border border-line bg-paper p-3 font-mono text-xs" rows={5} value={presentation} onChange={e => setPresentation(e.target.value)} />
        <Cta className="mt-2" disabled={presentation.length < 20}
          onClick={async () => { try { setResult(await call('/api/public/passes/verify', { presentation })); } catch (e: any) { setError(e.message); } }}>Verify</Cta>
      </section>

      {result && (
        <section className={`rounded-2xl border-2 p-5 ${result.valid ? 'border-ink' : 'border-red-600'}`}>
          <p className={`font-display text-2xl font-semibold ${result.valid ? 'text-ink' : 'text-red-700 dark:text-red-300'}`}>{result.valid ? 'Valid pass' : 'Not valid'}</p>
          {!result.valid && <ul className="mt-2 list-disc pl-5 text-sm">{result.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>}
          {result.visible?.drive && (
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">Eligible for</dt><dd className="font-semibold">{result.visible.drive} · {result.visible.company}</dd>
              <dt className="text-muted">Issued by</dt><dd>{result.visible.college} (rules v{result.visible.rule_version})</dd>
              <dt className="text-muted">Sent from student’s device</dt><dd>{result.keyBound ? 'Yes: sent from the student’s own device, for your request only' : 'No'}</dd>
              {Object.entries(result.disclosed).map(([k, v]) => <React.Fragment key={k}><dt className="text-muted">{LABELS[k] ?? 'Meets'}</dt><dd>{String(v)}</dd></React.Fragment>)}
              <dt className="text-muted">Hidden</dt><dd>{result.hiddenCount} item(s) not shared (count includes decoys)</dd>
            </dl>
          )}
          <p className="mt-4 text-xs text-muted">Technical details: SD-JWT (IETF RFC 9901), Ed25519 college signature, P-256 device key.</p>
        </section>
      )}
    </main>
  );
}
