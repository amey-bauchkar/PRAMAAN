'use client';

import React, { useEffect, useState } from 'react';
import { API_URL, DEMO_MODE } from '@/lib/session';

/** In the demo, a way to open the live public ledger straight from the landing page. Renders nothing elsewhere. */
export function LedgerLink() {
  const [orgId, setOrgId] = useState<string | null>(null);
  useEffect(() => {
    if (!DEMO_MODE) return;
    fetch(`${API_URL}/api/demo/ledger`).then(r => r.json()).then(d => setOrgId(d.orgId ?? null)).catch(() => undefined);
  }, []);
  if (!orgId) return null;
  return (
    <a href={`/ledger/${orgId}`} className="rounded-[14px] border border-line bg-white px-7 py-[14px] text-base font-medium leading-none hover:border-brand">Check a placement ledger yourself</a>
  );
}
