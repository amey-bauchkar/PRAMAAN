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
    if (r) { setMsg(r.message); rows.reload(); }
  };

  return (
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
  );
}
