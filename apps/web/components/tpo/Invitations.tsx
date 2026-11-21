'use client';

import React, { useState } from 'react';
import { api, fmtDate, useAction, useApi } from '@/lib/api';
import { useMe } from '../WorkspaceShell';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, Table, Td } from '../ui';

const CSV_HEAD = 'name,email,enrollment_no,department,graduating_year,date_of_birth';

/**
 * Onboarding by invitation. People cannot create their own college record: an officer invites them, they get a one-time link at their
 * college email, sign in, and open it. Links are shown here once and are never stored in readable form.
 */
export function Invitations() {
  const me = useMe();
  const { data, error, reload } = useApi('/api/v2/tpo/invitations');
  const act = useAction();
  const [one, setOne] = useState({ fullName: '', email: '', role: 'student', departmentId: '', enrollmentNo: '', graduatingYear: String(new Date().getFullYear() + 1), dateOfBirth: '' });
  const [csv, setCsv] = useState('');
  const [out, setOut] = useState<{ results: any[]; note: string } | null>(null);
  const [fresh, setFresh] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const admin = me && ['college_admin', 'platform_admin'].includes(me.role);
  const needsStudentFields = one.role === 'student';
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); setCopied(url); } catch { setCopied(null); } };

  const send = async (invitations: any[]) => {
    const r = await act.run(() => api('/api/v2/tpo/invitations', { body: { invitations } }));
    if (r) { setOut(r); reload(); }
    return r;
  };

  const sendCsv = async () => {
    const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
    const rows = lines[0]?.toLowerCase().startsWith('name,') ? lines.slice(1) : lines;
    const invitations = rows.map(l => {
      const [fullName, email, enrollmentNo, dept, graduatingYear, dateOfBirth] = l.split(',').map(x => x.trim());
      const d = data.departments.find((x: any) => x.code.toLowerCase() === (dept ?? '').toLowerCase());
      return { role: 'student', fullName, email, enrollmentNo, departmentId: d?.id ?? null, graduatingYear: Number(graduatingYear), dateOfBirth };
    });
    if (await send(invitations)) setCsv('');
  };

  return (
    <Card title="Invite people to your college">
      <p className="mb-3 text-sm text-muted">Nobody can join by themselves. Each person gets a one-time link, valid for 14 days. They sign in with a password or GitHub and open it. A student&apos;s date of birth is needed because the camera and typing checks never apply to anyone under 18.</p>
      <ErrorBox error={act.error} />
      {out && (
        <div className="mb-4 flex flex-col gap-2">
          <Notice tone={out.results.some(r => r.status !== 'created') ? 'warn' : 'success'}>{out.note}</Notice>
          <Table head={['Email', 'Result', 'Link (shown once)']}>
            {out.results.map((r, i) => (
              <tr key={i}>
                <Td>{r.email}</Td>
                <Td>{r.status === 'created' ? (r.emailed ? 'Created and emailed' : 'Created') : r.error}</Td>
                <Td>{r.claimUrl ? <Button kind="secondary" onClick={() => copy(r.claimUrl)}>{copied === r.claimUrl ? 'Copied' : 'Copy link'}</Button> : '—'}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {fresh && (
        <div className="mb-4"><Notice tone="success">New link for {fresh.email}. The old one no longer works. <Button kind="ghost" onClick={() => copy(fresh.url)}>{copied === fresh.url ? 'Copied' : 'Copy link'}</Button></Notice></div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">One person</h3>
          <Field label="Full name"><input className={inputCls} value={one.fullName} onChange={e => setOne({ ...one, fullName: e.target.value })} /></Field>
          <Field label="College email"><input type="email" className={inputCls} value={one.email} onChange={e => setOne({ ...one, email: e.target.value })} /></Field>
          <Field label="Role">
            <select className={inputCls} value={one.role} onChange={e => setOne({ ...one, role: e.target.value })}>
              {['student', 'mentor', 'dept_coordinator', 'recruiter', 'officer', ...(admin ? ['college_admin'] : [])].map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label="Department"><select className={inputCls} value={one.departmentId} onChange={e => setOne({ ...one, departmentId: e.target.value })}><option value="">None</option>{data.departments.map((d: any) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}</select></Field>
          {needsStudentFields && (
            <>
              <Field label="Enrolment number"><input className={inputCls} value={one.enrollmentNo} onChange={e => setOne({ ...one, enrollmentNo: e.target.value })} /></Field>
              <Field label="Graduating year"><input className={inputCls} inputMode="numeric" value={one.graduatingYear} onChange={e => setOne({ ...one, graduatingYear: e.target.value })} /></Field>
              <Field label="Date of birth"><input type="date" className={inputCls} value={one.dateOfBirth} onChange={e => setOne({ ...one, dateOfBirth: e.target.value })} /></Field>
            </>
          )}
          <div><Button busy={act.busy} onClick={() => send([{ ...one, departmentId: one.departmentId || null, graduatingYear: Number(one.graduatingYear) }])}>Send invitation</Button></div>
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">Many students at once</h3>
          <Field label="Paste rows" hint={`One student per line: ${CSV_HEAD}. Department is its code, for example CSE. Dates are YYYY-MM-DD.`}>
            <textarea className={inputCls} rows={9} value={csv} onChange={e => setCsv(e.target.value)} placeholder={`${CSV_HEAD}\nAsha Patil,asha@college.edu,CSE2301,CSE,2027,2005-06-14`} spellCheck={false} />
          </Field>
          <div><Button busy={act.busy} disabled={!csv.trim()} onClick={sendCsv}>Send invitations</Button></div>
        </div>
      </div>

      <h3 className="mb-2 mt-6 font-semibold">Invitations</h3>
      <Table head={['Person', 'Role', 'Department', 'Status', 'Expires', '']}>
        {data.invitations.map((i: any) => (
          <tr key={i.id}>
            <Td>{i.full_name}<span className="block text-xs text-muted">{i.email}</span></Td>
            <Td>{i.role.replace('_', ' ')}</Td><Td>{i.department ?? '—'}</Td>
            <Td>{i.status === 'pending' && i.expired ? 'Expired' : i.status === 'pending' ? 'Waiting' : i.status === 'claimed' ? 'Joined' : 'Cancelled'}</Td>
            <Td>{i.status === 'pending' ? fmtDate(i.expires_at) : '—'}</Td>
            <Td>{i.status === 'pending' && (
              <span className="flex gap-2">
                <Button kind="ghost" busy={act.busy} onClick={async () => { const r = await act.run(() => api(`/api/v2/tpo/invitations/${i.id}/resend`, { method: 'POST', body: {} })); if (r) { setFresh({ email: i.email, url: r.claimUrl }); reload(); } }}>New link</Button>
                <Button kind="ghost" busy={act.busy} onClick={async () => { if (await act.run(() => api(`/api/v2/tpo/invitations/${i.id}/revoke`, { method: 'POST', body: {} }))) reload(); }}>Cancel</Button>
              </span>
            )}</Td>
          </tr>
        ))}
      </Table>
      {data.invitations.length === 0 && <p className="mt-2 text-sm text-muted">No invitations yet.</p>}
    </Card>
  );
}
