'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { api, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Loading, Notice, PageHeader, Stat, Table, Td } from '../ui';

export function Readiness() {
  const { data, error, reload } = useApi('/api/v2/tpo/readiness');
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const f = data.forecast;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Placement readiness" title="Placement Readiness" actions={<Button busy={act.busy} onClick={async () => { const r = await act.run(() => api('/api/v2/tpo/readiness/propose-support', { method: 'POST' })); if (r) { setMsg(`${r.proposed} mentoring suggestion(s) sent to your inbox for approval.`); reload(); } }}>Propose mentoring</Button>}>
        {data.note}
      </PageHeader>
      {msg && <Notice tone="success">{msg} <Link className="underline" href="/tpo/proposals">Review suggestions</Link></Notice>}
      <ErrorBox error={act.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Batch ready now (estimate)" value={`${f.estimatePercent}%`} sub={`likely range ${f.lowPercent}–${f.highPercent}%`} />
        <Stat label="Students at or above the target score" value={`${f.readyCount} / ${f.cohortSize}`} sub={`target score ${f.threshold} out of 100`} />
        <Stat label="Need support" value={f.cohortSize - f.readyCount} />
      </div>
      <Notice>{f.caveat} Readiness score = 45% verified core skills + 30% latest practice drive + 15% learning tasks + 10% backlogs. It is used to decide who to help first. It never rejects anyone.</Notice>
      <Card title="By branch">
        <Table head={['Branch', 'Ready', 'Estimate', 'Likely range']}>
          {data.byBranch.map((b: any) => <tr key={b.branch}><Td>{b.branch}</Td><Td className="tabular-nums">{b.readyCount}/{b.cohortSize}</Td><Td className="tabular-nums">{b.estimatePercent}%</Td><Td className="tabular-nums">{b.lowPercent}–{b.highPercent}%</Td></tr>)}
        </Table>
      </Card>
      <Card title="Students who need support (lowest score first)">
        <Table head={['Student', 'Branch', 'Score', 'Weakest area', 'Mentor']}>
          {data.needsSupport.map((s: any) => {
            const weak = [...s.factors].sort((a: any, b: any) => a.value - b.value)[0];
            return <tr key={s.studentId}><Td>{s.name}<span className="block text-xs text-muted">{s.enrollmentNo}</span></Td><Td>{s.branch}</Td><Td className="tabular-nums font-semibold">{s.score}</Td>
              <Td>{weak.label}: {weak.explanation}{s.missingData.length ? <span className="block text-xs text-muted">{s.missingData.join(' ')}</span> : null}</Td><Td>{s.mentorAssigned ? 'Assigned' : '—'}</Td></tr>;
          })}
        </Table>
      </Card>
    </div>
  );
}
