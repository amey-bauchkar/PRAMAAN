'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { api, fmtDate, useAction, useApi } from '@/lib/api';
import { PairedBars } from '../charts';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, PageHeader } from '../ui';

export function Demand() {
  const { data, error, reload } = useApi('/api/v2/tpo/demand');
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [jd, setJd] = useState({ title: '', body: '' });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const scan = async () => { const r = await act.run(() => api('/api/v2/tpo/demand/scan', { method: 'POST' })); if (r) { setMsg(`Read ${r.scanned} job descriptions and sent ${r.proposals} alert(s) to your AI Proposals inbox.`); reload(); } };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Market demand" title="Industry Skill Gaps" actions={<Button busy={act.busy} onClick={scan}>Scan job descriptions</Button>}>
        {data.sampleSize} job descriptions from {fmtDate(data.dateFrom)} to {fmtDate(data.dateTo)}, compared with the Verified skills of {data.cohortSize} students.
      </PageHeader>
      {msg && <Notice tone="success">{msg} <Link className="underline" href="/tpo/proposals">Open inbox</Link></Notice>}
      <ErrorBox error={act.error} />
      {data.alerts.map((a: any) => <Notice key={a.skillId} tone="warn"><span className="font-semibold">{a.name}:</span> {a.message}</Notice>)}
      <Card title="Skills companies ask for vs skills students have">
        <PairedBars a="Share of job descriptions that ask for it" b="Share of students with it Verified"
          rows={data.rows.slice(0, 15).map((r: any) => ({ label: r.name, a: r.demandPercent, b: r.supplyPercent, detail: `${r.name}: in ${r.demandCount}/${data.sampleSize} JDs (${r.demandPercent}%); Verified for ${r.supplyCount}/${data.cohortSize} students (${r.supplyPercent}%)` }))} />
        <p className="mt-3 text-xs text-muted">Skills are matched by their exact names and known alternative names. There is no AI guessing. The job descriptions in this demo are sample data.</p>
      </Card>
      <Card title="Add a job description">
        <div className="grid gap-3">
          <Field label="Title"><input className={inputCls} value={jd.title} onChange={e => setJd({ ...jd, title: e.target.value })} /></Field>
          <Field label="Job description text"><textarea className={inputCls} rows={4} value={jd.body} onChange={e => setJd({ ...jd, body: e.target.value })} /></Field>
          <div><Button busy={act.busy} disabled={jd.title.length < 3 || jd.body.length < 20} onClick={async () => { if (await act.run(() => api('/api/v2/tpo/demand/jds', { body: jd }))) { setJd({ title: '', body: '' }); reload(); } }}>Add</Button></div>
        </div>
      </Card>
    </div>
  );
}
