'use client';

import React, { useState } from 'react';
import { api, fmtDateTime, useAction, useApi } from '@/lib/api';
import { useMe } from '../WorkspaceShell';
import { DataRequests } from './DataRequests';
import { RecruiterAccess } from './AccessAndOutcomes';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, Table, Td } from '../ui';

export function Roles() {
  const me = useMe();
  const { data, error, reload } = useApi('/api/v2/tpo/members');
  const auditLog = useApi('/api/v2/tpo/audit');
  const act = useAction();
  const [form, setForm] = useState({ email: '', role: 'mentor', departmentId: '' });
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const canManage = me && ['officer', 'college_admin', 'platform_admin'].includes(me.role);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="AD-12" title="Team & Activity Log">This college’s data is kept completely separate from every other college’s. The university can see totals only.</PageHeader>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="Staff and recruiters">
          <Table head={['Name', 'Role', 'Department', 'Status', '']}>
            {data.members.map((m: any) => (
              <tr key={m.id}><Td>{m.full_name}<span className="block text-xs text-muted">{m.email}</span></Td><Td>{m.role.replace('_', ' ')}</Td><Td>{m.department ?? '—'}</Td><Td>{m.status}</Td>
                <Td>{canManage && m.status === 'active' && m.role !== 'officer' && <Button kind="ghost" busy={act.busy} onClick={async () => { if (await act.run(() => api(`/api/v2/tpo/members/${m.id}/status`, { body: { status: 'suspended' } }))) reload(); }}>Suspend</Button>}</Td></tr>
            ))}
          </Table>
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="People by role"><ul className="text-sm">{data.counts.map((c: any) => <li key={c.role} className="flex justify-between"><span>{c.role.replace('_', ' ')}</span><span className="tabular-nums">{c.n}</span></li>)}</ul></Card>
          {canManage && (
            <Card title="Add a member">
              <div className="flex flex-col gap-3">
                <Field label="Email of an existing account"><input className={inputCls} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
                <Field label="Role"><select className={inputCls} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{['mentor', 'dept_coordinator', 'officer', 'recruiter'].map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select></Field>
                <Field label="Department"><select className={inputCls} value={form.departmentId} onChange={e => setForm({ ...form, departmentId: e.target.value })}><option value="">None</option>{data.departments.map((d: any) => <option key={d.id} value={d.id}>{d.code}</option>)}</select></Field>
                <Button busy={act.busy} onClick={async () => { if (await act.run(() => api('/api/v2/tpo/members', { body: { ...form, departmentId: form.departmentId || null } }))) { setMsg('Member added.'); reload(); } }}>Add</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
      <RecruiterAccess />
      <DataRequests />
      <Card title="Activity log (latest)" actions={<Button kind="secondary" busy={act.busy} onClick={async () => { const r = await act.run(() => api('/api/v2/tpo/audit/verify')); if (r) setMsg(r.message); }}>Check the log is intact</Button>}>
        {!auditLog.data ? <Loading /> : (
          <Table head={['#', 'When', 'Action', 'What', 'Done by', 'Fingerprint']}>
            {auditLog.data.map((a: any) => <tr key={a.seq}><Td className="tabular-nums">{a.seq}</Td><Td>{fmtDateTime(a.occurredAt)}</Td><Td className="font-mono text-xs">{a.action}</Td><Td>{a.object_type}</Td><Td>{a.actor_type}</Td><Td className="font-mono text-xs">{a.hash}…</Td></tr>)}
          </Table>
        )}
        <p className="mt-2 text-xs text-muted">Each entry is linked to the one before it, and entries cannot be edited or deleted. Any tampering would be detected.</p>
      </Card>
    </div>
  );
}
