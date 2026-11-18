'use client';

import React, { useState } from 'react';
import { api, useAction, useApi } from '@/lib/api';
import { Button, ErrorBox, Notice } from '../ui';

/** Shows what imported repository code says about the student's skills and records it as evidence on request. */
export function ImportedCode({ onDone }: { onDone: () => void }) {
  const sum = useApi('/api/v2/student/github/summary');
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  if (!sum.data || sum.data.files === 0) return <p className="mt-3 text-xs text-muted">No repository code has been imported yet.</p>;
  return (
    <div className="mt-3 flex flex-col gap-2 text-sm">
      <p className="font-semibold">{sum.data.files} imported file(s) from {sum.data.repositories.join(', ')}</p>
      <ul className="list-disc pl-5">{sum.data.signals.map((s: any) => <li key={s.skillSlug}>{s.skillSlug}: {s.files} file(s), {s.lines} lines</li>)}</ul>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      <div><Button busy={act.busy} onClick={async () => { const r = await act.run(() => api('/api/v2/student/github/evidence', { method: 'POST' })); if (r) { setMsg(r.message); sum.reload(); onDone(); } }}>Add this code as evidence</Button></div>
    </div>
  );
}
