'use client';

import React, { useState } from 'react';
import { api, fmtDate, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Loading, Notice, PageHeader, Table, Td } from '../ui';

const NAMES: Record<string, string> = {
  placement_operations: 'Run placements for my college', repo_verification: 'Read my selected repositories', recruiter_sharing: 'Share verified skills with approved recruiters',
  analytics_research: 'Anonymous batch statistics', model_evaluation: 'Improve question quality (anonymous)', fairness_monitoring: 'Use gender and category only for fairness checks',
};

export function Privacy() {
  const { data, error, reload } = useApi('/api/v2/student/privacy');
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const toggle = async (code: string, active: boolean) => {
    if (active && code === 'repo_verification' && !window.confirm('Stop sharing your repositories? Code that proved a skill will be removed, and skills that depended only on it go back to Claimed.')) return;
    const r = await act.run(() => api('/api/v2/student/consents', { body: { purpose: code, action: active ? 'revoke' : 'grant' } }));
    if (r) { setMsg(r.message ?? (r.active ? 'Consent given.' : 'Consent taken back.')); reload(); }
  };
  const request = async (type: string) => { const r = await act.run(() => api('/api/v2/student/data-requests', { body: { type } })); if (r) { setMsg(r.message); reload(); } };
  const exportData = async () => {
    const d = await act.run(() => api('/api/v2/student/export'));
    if (!d) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'my-pramaan-data.json'; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="ST-08" title="Privacy & Consent">You decide what is used and why. If you take back consent, it applies straight away.</PageHeader>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      {data.isMinor && <Notice tone="warn">You are under 18. Sharing with recruiters needs a parent or guardian’s consent (status: {data.guardianConsent ?? 'none'}). Your activity is never tracked.</Notice>}

      <Card title="Consents">
        <ul className="divide-y divide-line">
          {data.purposes.map((p: any) => (
            <li key={p.code} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 max-w-2xl">
                <p className="font-semibold">{NAMES[p.code] ?? p.code}</p>
                <p className="text-sm text-muted">{p.description}</p>
                <p className="text-xs text-muted">Kept for up to {Math.round(p.retentionDays / 365 * 10) / 10} years{p.active ? ` · given ${fmtDate(p.grantedAt)}` : ''}</p>
              </div>
              <Button kind={p.active ? 'danger' : 'secondary'} busy={act.busy} disabled={!p.active && p.blockedForMinor} onClick={() => toggle(p.code, p.active)}
                aria-label={`${p.active ? 'Take back' : 'Give'} consent: ${NAMES[p.code] ?? p.code}`}>
                {p.active ? 'Take back' : p.blockedForMinor ? 'Needs parent consent' : 'Give consent'}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Your data">
          <div className="flex flex-wrap gap-2">
            <Button kind="secondary" busy={act.busy} onClick={exportData}>Download my data</Button>
            <Button kind="secondary" busy={act.busy} onClick={() => request('correction')}>Correct my data</Button>
            <Button kind="danger" busy={act.busy} onClick={() => window.confirm('Ask for your data to be deleted? The placement office must reply within 30 days.') && request('erasure')}>Delete my data</Button>
            <Button kind="secondary" busy={act.busy} onClick={() => request('grievance')}>Make a complaint</Button>
          </div>
          {data.dataRequests.length > 0 && (
            <div className="mt-3"><Table head={['Request', 'Status', 'Due']}>{data.dataRequests.map((r: any) => <tr key={r.id}><Td className="capitalize">{r.type}</Td><Td>{r.status}</Td><Td>{fmtDate(r.dueAt)}</Td></tr>)}</Table></div>
          )}
        </Card>
        <Card title="How your scores work">
          <ul className="list-disc pl-5 text-sm">{data.howScoresWork.map((s: string, i: number) => <li key={i} className="mb-1">{s}</li>)}</ul>
        </Card>
      </div>
    </div>
  );
}
