'use client';

import React, { useState } from 'react';
import { api, fmtDate, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, Table, Td } from '../ui';

/** Which recruiters may search which drive, and for how long. Without a grant a recruiter sees nothing. */
export function RecruiterAccess() {
  const grants = useApi('/api/v2/tpo/recruiter-grants');
  const drives = useApi('/api/v2/tpo/drives');
  const act = useAction();
  const [f, setF] = useState({ recruiterMembershipId: '', driveId: '', days: '30' });
  const [msg, setMsg] = useState<string | null>(null);
  if (!grants.data || !drives.data) return <Loading />;
  return (
    <Card title="Recruiter access to drives">
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error ?? grants.error} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Recruiter"><select className={inputCls} value={f.recruiterMembershipId} onChange={e => setF({ ...f, recruiterMembershipId: e.target.value })}><option value="">Choose</option>{grants.data.recruiters.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Drive"><select className={inputCls} value={f.driveId} onChange={e => setF({ ...f, driveId: e.target.value })}><option value="">Choose</option>{drives.data.drives.map((d: any) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></Field>
        <Field label="Days of access"><input className={inputCls} type="number" min={1} max={180} value={f.days} onChange={e => setF({ ...f, days: e.target.value })} /></Field>
        <div className="flex items-end"><Button busy={act.busy} disabled={!f.recruiterMembershipId || !f.driveId} onClick={async () => {
          const r = await act.run(() => api('/api/v2/tpo/recruiter-grants', { body: { ...f, days: Number(f.days) } }));
          if (r) { setMsg(r.message); grants.reload(); }
        }}>Give access</Button></div>
      </div>
      {grants.data.grants.length > 0 && (
        <div className="mt-4">
          <Table head={['Recruiter', 'Drive', 'Access until', '']}>
            {grants.data.grants.map((g: any) => (
              <tr key={g.id}><Td>{g.recruiter}<span className="block text-xs text-muted">{g.email}</span></Td><Td>{g.drive}</Td><Td>{g.active ? fmtDate(g.expiresAt) : `Ended ${fmtDate(g.expiresAt)}`}</Td>
                <Td>{g.active && <Button kind="ghost" busy={act.busy} onClick={async () => { if (await act.run(() => api(`/api/v2/tpo/recruiter-grants/${g.id}/revoke`, { method: 'POST' }))) grants.reload(); }}>End access</Button>}</Td></tr>
            ))}
          </Table>
        </div>
      )}
    </Card>
  );
}

/** Adds an outcome the system did not see, such as an off-campus job or higher studies, so accreditation tables are complete. */
export function RecordOutcome({ onDone }: { onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ enrollmentNo: '', outcomeType: 'higher_studies', organization: '', ctcInr: '' });
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card title="Record an outcome">
      <p className="mb-3 text-sm text-muted">On-campus offers are counted automatically when a student accepts. Use this for off-campus jobs, higher studies and start-ups.</p>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label="Enrollment number"><input className={inputCls} value={f.enrollmentNo} onChange={e => setF({ ...f, enrollmentNo: e.target.value })} /></Field>
        <Field label="Outcome"><select className={inputCls} value={f.outcomeType} onChange={e => setF({ ...f, outcomeType: e.target.value })}><option value="higher_studies">Higher studies</option><option value="placed">Placed (off campus)</option><option value="entrepreneurship">Start-up</option></select></Field>
        <Field label="Organisation or institute"><input className={inputCls} value={f.organization} onChange={e => setF({ ...f, organization: e.target.value })} /></Field>
        <Field label="CTC per year (if placed)"><input className={inputCls} type="number" value={f.ctcInr} onChange={e => setF({ ...f, ctcInr: e.target.value })} /></Field>
        <div className="flex items-end"><Button busy={act.busy} disabled={f.enrollmentNo.length < 2} onClick={async () => {
          const r = await act.run(() => api('/api/v2/tpo/outcomes', { body: { ...f, ctcInr: f.ctcInr || null } }));
          if (r) { setMsg(r.message); setF({ ...f, enrollmentNo: '', organization: '', ctcInr: '' }); onDone(); }
        }}>Save</Button></div>
      </div>
    </Card>
  );
}
