'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { api, fmtDate, useAction, useApi } from '@/lib/api';
import { claimsOf, decodeRequest, holderKey, listPasses, present, savePass, StoredPass } from '@/lib/wallet';
import { Button, Card, Empty, ErrorBox, Field, inputCls, Notice, PageHeader } from '../ui';

const LABELS: Record<string, string> = { name: 'Your name', branch: 'Your branch', graduating_year: 'Graduating year', cgpa: 'Your exact CGPA' };

/**
 * Eligibility Pass wallet: prove to any recruiter (on or off this platform) that you meet a drive's
 * criteria, showing only the facts you choose. Built on SD-JWT (IETF RFC 9901).
 */
export function Passes() {
  const drives = useApi('/api/v2/student/drives');
  const server = useApi('/api/v2/student/passes');
  const act = useAction();
  const [passes, setPasses] = useState<StoredPass[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [reveal, setReveal] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [presentation, setPresentation] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { listPasses().then(setPasses); }, []);

  const eligible = (drives.data?.drives ?? []).filter((d: any) => d.decision?.result === 'eligible');
  const revoked = new Set((server.data ?? []).filter((p: any) => p.status === 'revoked').map((p: any) => p.id));

  const issue = async (driveId: string) => {
    const { publicJwk } = await holderKey();
    const r = await act.run(() => api('/api/v2/student/passes', { body: { driveId, holderJwk: publicJwk } }));
    if (!r) return;
    const d = eligible.find((x: any) => x.id === driveId);
    await savePass({ id: r.id, drive: `${d.title} · ${d.company}`, sdJwt: r.sdJwt, expiresAt: r.expiresAt, predicates: r.predicates, exact: r.exact });
    setPasses(await listPasses()); server.reload();
    setMsg('Pass saved in this browser. Your private key stays on this device.');
  };

  const makePresentation = async (p: StoredPass) => {
    try {
      const req = decodeRequest(code);
      setPresentation(await present(p.sdJwt, reveal, req));
    } catch (e: any) { act.setError(e.message); }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Eligibility Pass" title="Show you qualify without sharing your marks">
        Your college confirms your details. You can then tell a recruiter “CGPA 7.5 or above: yes” without sharing your actual CGPA. This works with any recruiter, even one who does not use PRAMAAN. Gender, category and date of birth are never included.
      </PageHeader>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />

      <Card title="Get a pass">
        {eligible.length === 0 ? (
          <p className="text-sm text-muted">
            You can get a pass for any drive you are eligible for. You are not eligible for any yet.{' '}
            <Link href="/student/drives" className="font-semibold text-brand underline">See the quickest way to qualify for a drive</Link>.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">{eligible.map((d: any) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><span className="font-semibold">{d.title}</span> · {d.company}</span>
              <Button kind="secondary" busy={act.busy} onClick={() => issue(d.id)}>Get pass</Button>
            </li>))}</ul>
        )}
      </Card>

      {passes.length === 0 ? <Empty>No passes in this browser yet.</Empty> : passes.map(p => {
        const claims = claimsOf(p.sdJwt);
        const isRevoked = revoked.has(p.id);
        return (
          <Card key={p.id} title={p.drive} actions={<span className="text-xs text-muted">{isRevoked ? 'Cancelled' : `Valid until ${fmtDate(p.expiresAt)}`}</span>}>
            {open !== p.id ? (
              <div className="flex flex-wrap gap-2">
                <Button disabled={isRevoked} onClick={() => { setOpen(p.id); setReveal(Object.keys(p.predicates)); setPresentation(null); setCode(''); }}>Share with a recruiter</Button>
                {!isRevoked && <Button kind="danger" busy={act.busy} onClick={async () => { if (await act.run(() => api(`/api/v2/student/passes/${p.id}/revoke`, { method: 'POST' }))) { server.reload(); setMsg('Pass cancelled. Recruiters will now see it as invalid.'); } }}>Cancel pass</Button>}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <fieldset>
                  <legend className="text-sm font-semibold">Choose what to show</legend>
                  <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {claims.map(c => (
                      <li key={c.name}>
                        <label className="flex items-start gap-2 rounded border border-line p-2 text-sm">
                          <input type="checkbox" checked={reveal.includes(c.name)} onChange={e => setReveal(e.target.checked ? [...reveal, c.name] : reveal.filter(x => x !== c.name))} />
                          <span>{LABELS[c.name] ? <><span className="font-semibold">{LABELS[c.name]}</span>: {String(c.value)}</> : <><span className="font-semibold">Meets:</span> {String(c.value)}</>}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted">The recruiter always sees that you are eligible for this drive, your college, and when the pass expires. Anything you leave unticked stays hidden.</p>
                </fieldset>
                <Field label="Recruiter’s request code" hint="The recruiter gets this code from the PRAMAAN verify page. It works once and expires in 15 minutes.">
                  <input className={`${inputCls} font-mono text-xs`} value={code} onChange={e => setCode(e.target.value)} />
                </Field>
                <div className="flex gap-2">
                  <Button disabled={!code} onClick={() => makePresentation(p)}>Create share text</Button>
                  <Button kind="secondary" onClick={() => setOpen(null)}>Close</Button>
                </div>
                {presentation && (
                  <div className="flex flex-col gap-2">
                    <Notice tone="success">Ready. This text works only for that recruiter. Send it to them:</Notice>
                    <textarea readOnly className={`${inputCls} font-mono text-xs`} rows={5} value={presentation} onFocus={e => e.currentTarget.select()} />
                    <Button kind="secondary" onClick={() => navigator.clipboard.writeText(presentation).then(() => setMsg('Copied.'))}>Copy</Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
