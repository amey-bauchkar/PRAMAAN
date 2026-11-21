'use client';

import React, { useState } from 'react';
import { api, lpa, useAction, useApi } from '@/lib/api';
import { signText, signingKeyFor } from '@/lib/ledger';
import { Button, Card, ErrorBox, inputCls, Notice, Table, Td } from '../ui';
import { useMe } from '../WorkspaceShell';

/** A recruiter signs an offer with a key that stays in their browser. The placement office cannot sign for them, and a change after signing breaks the signature. */
export function IssueOffer({ driveId }: { driveId: string }) {
  const me = useMe();
  const rows = useApi(driveId ? `/api/v2/recruiter/offers?driveId=${driveId}` : null);
  const act = useAction();
  const keys = useApi('/api/v2/recruiter/keys');
  const [domain, setDomain] = useState('');
  const [ctc, setCtc] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  if (!me || !driveId) return null;

  const send = async (applicationId: string) => {
    const r = await act.run(async () => {
      const key = await signingKeyFor(me.userId);
      await api('/api/v2/recruiter/keys', { body: { publicJwk: key.publicJwk } });
      const prep = await api('/api/v2/recruiter/offers/prepare', { body: { applicationId, ctcInr: Number(ctc[applicationId]), keyId: key.keyId } });
      return api('/api/v2/recruiter/offers', { body: { applicationId, statement: prep.statement, signature: await signText(key, prep.canonical) } });
    });
    if (r) { setMsg(r.message); rows.reload(); keys.reload(); }
  };

  const claim = async () => {
    const r = await act.run(async () => {
      const key = await signingKeyFor(me.userId);
      await api('/api/v2/recruiter/keys', { body: { publicJwk: key.publicJwk } });
      return api('/api/v2/recruiter/keys/domain', { body: { keyId: key.keyId, domain } });
    });
    if (r) { setMsg(null); keys.reload(); }
  };
  const check = async (keyId: string) => {
    const r = await act.run(() => api('/api/v2/recruiter/keys/domain/verify', { body: { keyId } }));
    if (r) { setMsg(r.message); keys.reload(); }
  };

  return (
    <>
    <Card title="Prove your company domain">
      <p className="mb-3 text-sm text-muted">
        Auditors see the domain next to each offer you sign. To prove your key belongs to someone who controls the company’s website, publish one line there. This shows control of the domain. It does not show the company authorised you, so an auditor can still call the company.
      </p>
      {(keys.data ?? []).map((k: any) => (
        <div key={k.keyId} className="mb-3 rounded-lg border border-line bg-paper p-3 text-sm">
          <p>Key <span className="font-mono text-xs">{k.keyId}</span>: {k.verifiedAt ? <span className="font-semibold">domain {k.domain} verified</span> : k.domain ? `waiting for proof on ${k.domain}` : 'no domain proved yet'}</p>
          {k.proof && (
            <>
              <p className="mt-2">Publish this line at <span className="break-all font-mono text-xs">{k.proof.url}</span>:</p>
              <p className="mt-1 break-all rounded bg-card p-2 font-mono text-xs">{k.proof.content}</p>
              <div className="mt-2"><Button busy={act.busy} onClick={() => check(k.keyId)}>Check the file</Button></div>
            </>
          )}
        </div>
      ))}
      <span className="flex flex-wrap items-center gap-2">
        <input aria-label="Company domain" className={`${inputCls} w-64 py-1 text-sm`} placeholder="company website, e.g. example.com" value={domain} onChange={e => setDomain(e.target.value)} />
        <Button kind="secondary" busy={act.busy} disabled={domain.trim().length < 4} onClick={claim}>Get the proof line</Button>
      </span>
    </Card>
    <Card title="Signed offers">
      <p className="mb-3 text-sm text-muted">Make an offer by signing it. Your private key never leaves this browser. The student then signs their acceptance, and only then does it count as a verified placement.</p>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error ?? rows.error} />
      {rows.data && (rows.data.length === 0 ? <p className="text-sm text-muted">No shortlisted candidates for this drive.</p> : (
        <Table head={['Candidate', 'Stage', 'Offer', '']}>
          {rows.data.map((a: any) => (
            <tr key={a.applicationId}>
              <Td>{a.name}</Td>
              <Td>{a.stage.replace(/_/g, ' ')}</Td>
              <Td>{a.offer ? `${lpa(a.offer.ctc)} · ${a.offer.status === 'extended' ? 'waiting for the student' : a.offer.status}${a.offer.signed ? ' · signed' : ' · not signed'}` : '—'}</Td>
              <Td>{!a.offer && (
                <span className="flex flex-wrap items-center gap-2">
                  <input aria-label="CTC in rupees per year" className={`${inputCls} w-36 py-1 text-sm`} type="number" placeholder="CTC ₹ per year" value={ctc[a.applicationId] ?? ''} onChange={e => setCtc({ ...ctc, [a.applicationId]: e.target.value })} />
                  <Button busy={act.busy} disabled={!(Number(ctc[a.applicationId]) > 0)} onClick={() => send(a.applicationId)}>Sign and send offer</Button>
                </span>
              )}</Td>
            </tr>
          ))}
        </Table>
      ))}
    </Card>
    </>
  );
}
