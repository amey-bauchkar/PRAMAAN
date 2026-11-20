'use client';

import React, { useEffect, useState } from 'react';
import { API_URL } from '@/lib/session';
import { api, lpa, useAction, useApi } from '@/lib/api';
import { checkReceipt, signText, signingKeyFor, Check } from '@/lib/ledger';
import { Button, Card, Empty, ErrorBox, Loading, Notice, PageHeader } from '../ui';
import { useMe } from '../WorkspaceShell';

/** Shows what a receipt proves, checked here in the browser with the college's public key. */
function ReceiptPanel({ receipt, orgId }: { receipt: any; orgId: string }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const head = await fetch(`${API_URL}/api/public/ledger/${orgId}`, { cache: 'no-store' }).then(r => r.json());
      setChecks(await checkReceipt(receipt, head.issuerPublicKeyPem ?? null));
    } finally { setBusy(false); }
  };
  // Receipts help only if someone checks them, so a receipt is checked as soon as it is shown.
  useEffect(() => { void run(); }, []);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `placement-receipt-${receipt.seq}.json`; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="mt-3 rounded-lg border border-line bg-paper p-3 text-sm">
      <p className="font-semibold">Your signed receipt · entry {receipt.seq} of the placement ledger</p>
      <p className="mt-1 text-xs text-muted">It holds the recruiter’s signed offer and your signed acceptance. It proves your placement without asking the college, and it contains no name.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button kind="secondary" busy={busy} onClick={run}>Check this receipt in my browser</Button>
        <Button kind="ghost" onClick={download}>Download receipt</Button>
      </div>
      {checks && (
        <ul className="mt-2 flex flex-col gap-1">
          {checks.map(c => (
            <li key={c.label}>
              <span className={`font-semibold ${c.ok === true ? 'text-ink' : c.ok === false ? 'text-red-700' : 'text-amber-700'}`}>{c.ok === true ? 'Yes' : c.ok === false ? 'No' : 'Cannot check'}</span> · {c.label}
              {c.detail ? <span className="text-xs text-muted"> ({c.detail})</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MyOffers() {
  const me = useMe();
  const offers = useApi('/api/v2/student/offers');
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  if (!me) return null;
  if (offers.error) return <ErrorBox error={offers.error} />;
  if (!offers.data) return <Loading />;

  const accept = async (o: any) => {
    const r = await act.run(async () => {
      const key = await signingKeyFor(me.userId);
      await api('/api/v2/student/keys', { body: { publicJwk: key.publicJwk } });
      const prep = await api(`/api/v2/student/offers/${o.applicationId}/accept/prepare`, { body: { keyId: key.keyId } });
      return api(`/api/v2/student/offers/${o.applicationId}/accept`, { body: { acceptance: prep.acceptance, signature: await signText(key, prep.canonical) } });
    });
    if (r) { setMsg(r.message); offers.reload(); }
  };
  const decline = async (o: any) => {
    if (await act.run(() => api(`/api/v2/student/offers/${o.applicationId}/respond`, { body: { accept: false } }))) { setMsg('Offer declined.'); offers.reload(); }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Offers" title="My Offers">
        When a recruiter signs an offer, you see it here. You accept by signing with a key that stays in this browser. That signature, plus the recruiter’s, is what makes a placement count as verified.
      </PageHeader>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      {offers.data.length === 0 ? <Empty>No offers yet. When a company makes you an offer it will appear here.</Empty> : offers.data.map((o: any) => (
        <Card key={o.applicationId} title={<span>{o.role} <span className="font-normal text-muted">· {o.company}</span></span>} actions={<span className="text-sm text-muted">{lpa(o.ctcInr)}</span>}>
          <p className="text-sm text-muted">
            {o.status === 'accepted' ? 'Accepted' : o.status === 'declined' ? 'Declined' : 'Waiting for your answer'} · {o.signed ? 'signed by the recruiter' : 'recorded by the placement office, not signed by the recruiter'}
          </p>
          {o.needsSignature && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button busy={act.busy} onClick={() => accept(o)}>Accept and sign</Button>
              <Button kind="secondary" busy={act.busy} onClick={() => decline(o)}>Decline</Button>
            </div>
          )}
          {!o.signed && o.status === 'extended' && (
            <p className="mt-2 text-sm">This offer was entered by the placement office without a recruiter signature, so it cannot become a verified placement.</p>
          )}
          {o.receipt && <ReceiptPanel receipt={o.receipt} orgId={me.orgId} />}
        </Card>
      ))}
    </div>
  );
}
