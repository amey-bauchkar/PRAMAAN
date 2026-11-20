'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { API_URL, DEMO_MODE } from '@/lib/session';
import { Check, checkReceipt, keyIdOf, merkleRoot, verifyEcdsa, witnessTextOf, verifyCheckpointSignature, verifyConsistency, verifyInclusion } from '@/lib/ledger';

const KIND: Record<string, string> = { offer_accepted: 'Placements signed by recruiter and student', rule_published: 'Eligibility rule versions published', decisions_published: 'Batches of decisions published' };

function Result({ c }: { c: Check }) {
  return (
    <li className="flex gap-3 py-1.5 text-sm">
      <span className={`w-28 shrink-0 font-semibold ${c.ok === true ? 'text-ink' : c.ok === false ? 'text-red-700' : 'text-amber-700'}`}>{c.ok === true ? 'Yes' : c.ok === false ? 'NO' : 'Cannot check'}</span>
      <span>{c.label}{c.detail ? <span className="block text-xs text-muted">{c.detail}</span> : null}</span>
    </li>
  );
}

/** Public placement ledger. No sign-in. Everything below is checked in this browser from public data. */
export default function LedgerPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [head, setHead] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiptText, setReceiptText] = useState('');
  const [receiptChecks, setReceiptChecks] = useState<Check[] | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/public/ledger/${orgId}`, { cache: 'no-store' }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setHead(j); }).catch(e => setError(e.message));
  }, [orgId]);

  // Remembered per log identity, so a different log (for example a restarted demo) is never taken for a rewrite of this one.
  const seenKeyFor = (origin: string) => `pramaan-ledger-seen:${origin}`;

  async function verifyAll() {
    setBusy(true); setChecks(null);
    const out: Check[] = [];
    try {
      const fresh = await fetch(`${API_URL}/api/public/ledger/${orgId}`, { cache: 'no-store' }).then(r => r.json());
      setHead(fresh);
      const { leaves, checkpoints } = await fetch(`${API_URL}/api/public/ledger/${orgId}/leaves`, { cache: 'no-store' }).then(r => r.json());
      const hashes: string[] = leaves.map((l: any) => l.leafHash);
      const cp = fresh.checkpoint;
      const seenKey = seenKeyFor(fresh.origin);
      out.push({ label: `The published list holds ${hashes.length} fingerprints, and the newest signed state covers ${cp.size}`, ok: hashes.length >= cp.size });
      const localRoot = await merkleRoot(hashes.slice(0, cp.size));
      out.push({ label: 'Rebuilding the tree from those fingerprints gives the root the log operator signed', ok: localRoot === cp.root, detail: `root ${cp.root.slice(0, 24)}…` });
      if (fresh.issuerPublicKeyPem) {
        const s = await verifyCheckpointSignature(cp, fresh.issuerPublicKeyPem);
        out.push({ label: 'The log operator’s signature on that state is valid', ok: s, detail: s === null ? 'This browser cannot check Ed25519 signatures. Use a current Chrome, Edge, Firefox or Safari.' : undefined });
      }
      const witnessLines: Check[] = [];
      for (const w of (fresh.witnesses ?? []).slice(-3)) {
        const sigOk = await verifyEcdsa(w.publicKey, witnessTextOf({ origin: fresh.origin, size: w.size, root: w.root, at: w.checkpointAt }, w.keyId, w.at), w.signature) && (await keyIdOf(w.publicKey)) === w.keyId;
        const sameHistory = w.size <= hashes.length && (await merkleRoot(hashes.slice(0, w.size))) === w.root;
        witnessLines.push({ label: `${w.name} witnessed the first ${w.size} entries, and they are unchanged`, ok: sigOk && sameHistory, detail: !sigOk ? 'The witness signature is not valid.' : !sameHistory ? 'The log was rewritten after it was witnessed.' : `key ${w.keyId}, signed ${new Date(w.at).toLocaleString('en-IN')} by the witness's own clock` });
      }
      if (witnessLines.length === 0) out.push({ label: 'No university has witnessed this log yet, so a rewrite by the college itself would not be caught by a witness', ok: null });
      out.push(...witnessLines);
      let allOk = true;
      for (const c of checkpoints.slice(-25)) if ((await merkleRoot(hashes.slice(0, c.size))) !== c.root) allOk = false;
      out.push({ label: `Each of the last ${Math.min(25, checkpoints.length)} earlier signed states also matches the list`, ok: allOk });
      let seen: any = null;
      try { seen = JSON.parse(localStorage.getItem(seenKey) ?? 'null'); } catch { seen = null; }
      if (seen) {
        if (seen.size > cp.size) out.push({ label: `Nothing was removed since your last visit (you saw ${seen.size} entries, now ${cp.size})`, ok: false });
        else {
          const c = await fetch(`${API_URL}/api/public/ledger/${orgId}/consistency?from=${seen.size}&to=${cp.size}`, { cache: 'no-store' }).then(r => r.json());
          out.push({ label: `Nothing was changed or removed since your last visit (${seen.size} entries then, ${cp.size} now)`, detail: 'If you expected this, for example after the college moved to a new log, press "Forget what this browser remembers".', ok: c.proof ? await verifyConsistency(seen.size, cp.size, seen.root, localRoot, c.proof) : false });
        }
      } else out.push({ label: 'First visit: this state is remembered in this browser, so the next visit can prove history was only added to', ok: true });
      // Only a state that passed every check is remembered, so a rewritten log is never taken as the new normal.
      if (out.every(c => c.ok !== false)) { try { localStorage.setItem(seenKey, JSON.stringify({ size: cp.size, root: cp.root })); } catch { /* storage may be blocked */ } }
    } catch (e: any) {
      out.push({ label: 'Could not reach the ledger', ok: false, detail: e.message });
    }
    setChecks(out); setBusy(false);
  }

  async function checkMine() {
    setReceiptChecks(null);
    try {
      const receipt = JSON.parse(receiptText);
      const res = await checkReceipt(receipt, head?.issuerPublicKeyPem ?? null);
      const p = await fetch(`${API_URL}/api/public/ledger/${orgId}/proof?seq=${receipt.seq}`, { cache: 'no-store' }).then(r => r.json());
      res.push({ label: 'It is also in the college’s current log', ok: p.leafHash === receipt.leafHash && await verifyInclusion(p.leafHash, p.seq - 1, p.treeSize, p.proof, p.root) });
      setReceiptChecks(res);
    } catch { setReceiptChecks([{ label: 'This is not a PRAMAAN placement receipt', ok: false }]); }
  }

  if (error) return <main className="mx-auto max-w-xl p-8"><h1 className="font-display text-2xl">Ledger not found</h1><p className="mt-2 text-muted">{error}</p></main>;
  if (!head) return <main className="p-8 text-muted">Loading…</main>;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12">
      <Link href="/" className="font-display text-2xl font-medium tracking-tight">pramaan<span className="text-brand">.</span></Link>
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-brand">Placement ledger</p>
        <h1 className="mt-1 font-display text-4xl sm:text-5xl">{head.college}</h1>
        <p className="mt-3 text-muted">
          A placement counts here only if the recruiter and the student both signed it. This page publishes fingerprints, not people: nothing identifies a student.
          Press the button and your browser checks the log itself, without asking this website to vouch for it.
        </p>
      </div>

      {DEMO_MODE && <p className="rounded-2xl border border-line bg-card px-4 py-3 text-sm text-muted">Demo data: this college, its students, its recruiters and the companies are made up for the demo. The checks below are real.</p>}

      <section className="grid gap-3 sm:grid-cols-3">
        {Object.entries(head.counts).map(([k, n]) => (
          <div key={k} className="rounded-3xl border border-line bg-card p-5"><p className="font-display text-4xl tabular-nums">{String(n)}</p><p className="mt-1 text-sm text-muted">{KIND[k] ?? k}</p></div>
        ))}
      </section>

      <section className="rounded-3xl border border-line bg-card p-6">
        <h2 className="font-display text-xl">Check it yourself</h2>
        <p className="mt-1 text-sm text-muted">Newest signed state: {head.checkpoint.size} entries, signed {new Date(head.checkpoint.at).toLocaleString('en-IN')}.</p>
        <button type="button" onClick={verifyAll} disabled={busy} className="btn-brand mt-3 rounded-[14px] px-6 py-3 text-sm font-medium disabled:opacity-60">{busy ? 'Checking…' : 'Check this ledger in my browser'}</button>
        <button type="button" onClick={() => { try { localStorage.removeItem(seenKeyFor(head.origin)); } catch { /* storage may be blocked */ } setChecks(null); }} className="ml-2 mt-3 rounded-[14px] border border-line bg-white px-5 py-3 text-sm font-medium hover:border-brand">Forget what this browser remembers</button>
        {checks && <ul className="mt-4 divide-y divide-line">{checks.map(c => <Result key={c.label} c={c} />)}</ul>}
      </section>

      <section className="rounded-3xl border border-line bg-card p-6">
        <h2 className="font-display text-xl">Have a placement receipt?</h2>
        <p className="mt-1 text-sm text-muted">Students and recruiters keep a receipt. Paste it to check the offer and both signatures, and that the entry is in this log.</p>
        <textarea className="mt-3 w-full rounded-lg border border-line bg-paper p-3 font-mono text-xs" rows={5} value={receiptText} onChange={e => setReceiptText(e.target.value)} placeholder="Paste the receipt JSON here" />
        <button type="button" onClick={checkMine} disabled={receiptText.length < 20} className="mt-2 rounded-[14px] border border-line bg-white px-5 py-2.5 text-sm font-medium hover:border-brand disabled:opacity-60">Check this receipt</button>
        {receiptChecks && <ul className="mt-3 divide-y divide-line">{receiptChecks.map(c => <Result key={c.label} c={c} />)}</ul>}
      </section>

      <p className="text-xs text-muted">
        What this shows and what it does not: it shows that each placement counted here carries a recruiter’s signature and a student’s signature, and that nothing was changed afterwards.
        It does not show that a recruiter key belongs to the company it names (an auditor can pick random entries and ask the company to confirm the key), or that an accepted offer led to a joining. The log is signed by its operator. A university witness signs it with a separate key, and until a witness has signed, a rewrite by the operator itself would not be caught.
      </p>
    </main>
  );
}
