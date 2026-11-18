'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { api, fmtDate, fmtDateTime, lpa, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, Table, Td } from '../ui';
import { NewDrive, ScheduleInterviews } from './DriveSetup';

export function Drives() {
  const { data, error, reload } = useApi('/api/v2/tpo/drives');
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [round, setRound] = useState({ driveId: '', title: '', kind: 'interview', startsAt: '', endsAt: '', roomId: '' });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const byDay = new Map<string, any[]>();
  for (const r of data.rounds) { const k = r.startsAt.slice(0, 10); byDay.set(k, [...(byDay.get(k) ?? []), r]); }
  const toIso = (local: string) => (local ? new Date(local).toISOString() : '');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Schedule" title="Drives & Calendar">One calendar for company visits, tests, interviews and offers. The system will not allow a room, interview panel or student to be booked twice at the same time.</PageHeader>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      {data.clashes.map((c: any, i: number) => <Notice key={i} tone="warn"><span className="font-semibold">{c.kind === 'room' ? 'Room clash' : 'Student clash'}:</span> {c.message}</Notice>)}

      <Card title="Company emails">
        {data.inbound.map((m: any) => (
          <div key={m.id} className="rounded-lg border border-line p-3 text-sm">
            <p className="font-semibold">{m.company ?? m.from_email} · {m.subject} <span className="font-normal text-muted">· {fmtDateTime(m.receivedAt)}</span></p>
            <p className="mt-1">{m.body}</p>
            {m.proposal_id ? <p className="mt-2 text-muted">Suggestion created. <Link className="text-brand underline" href="/tpo/proposals">Review it</Link></p> :
              <Button className="mt-2" busy={act.busy} onClick={async () => { const r = await act.run(() => api(`/api/v2/tpo/inbound/${m.id}/propose`, { method: 'POST' })); if (r) { setPreview(r); reload(); } }}>Read email and suggest time slots</Button>}
          </div>
        ))}
        {preview && (
          <div className="mt-3">
            <Notice>Visit date found in the email: {preview.parsed.date ?? 'not found'}. Suggested schedule (waiting for your approval in AI Proposals):</Notice>
            <Table head={['Round', 'Time', 'Room']}>{preview.allocations.map((a: any, i: number) => <tr key={i}><Td>{a.label}</Td><Td>{fmtDateTime(a.start)}–{new Date(a.end).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</Td><Td>{a.roomName ?? <span className="text-red-700">{a.note}</span>}</Td></tr>)}</Table>
          </div>
        )}
      </Card>

      <Card title="Calendar">
        {[...byDay.entries()].sort().map(([day, rs]) => (
          <div key={day} className="mb-3">
            <p className="font-semibold">{fmtDate(day)}</p>
            <ul className="mt-1 flex flex-col gap-1 text-sm">{rs.map((r: any) => (
              <li key={r.id} className="grid grid-cols-[120px_1fr_auto] gap-2 rounded border border-line px-2 py-1">
                <span className="tabular-nums">{new Date(r.startsAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}–{new Date(r.endsAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                <span>{r.drive}: {r.title}</span><span className="text-muted">{r.room ?? 'no room'}</span>
                {data.slots.some((s: any) => s.roundId === r.id) && <span className="col-span-3 text-xs text-muted">{data.slots.filter((s: any) => s.roundId === r.id).map((s: any) => `${new Date(s.startsAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} ${s.student} (${s.panel})`).join(' · ')}</span>}
              </li>))}</ul>
          </div>
        ))}
      </Card>

      <NewDrive data={data} reload={reload} setMsg={setMsg} />

      <Card title="Add a round">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Drive"><select className={inputCls} value={round.driveId} onChange={e => setRound({ ...round, driveId: e.target.value })}><option value="">Choose…</option>{data.drives.filter((d: any) => d.status !== 'completed').map((d: any) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></Field>
          <Field label="Title"><input className={inputCls} value={round.title} onChange={e => setRound({ ...round, title: e.target.value })} /></Field>
          <Field label="Room"><select className={inputCls} value={round.roomId} onChange={e => setRound({ ...round, roomId: e.target.value })}><option value="">No room</option>{data.rooms.map((r: any) => <option key={r.id} value={r.id}>{r.name} ({r.capacity})</option>)}</select></Field>
          <Field label="Starts"><input type="datetime-local" className={inputCls} value={round.startsAt} onChange={e => setRound({ ...round, startsAt: e.target.value })} /></Field>
          <Field label="Ends"><input type="datetime-local" className={inputCls} value={round.endsAt} onChange={e => setRound({ ...round, endsAt: e.target.value })} /></Field>
          <div className="flex items-end"><Button busy={act.busy} disabled={!round.driveId || !round.title} onClick={async () => {
            const r = await act.run(() => api(`/api/v2/tpo/drives/${round.driveId}/rounds`, { body: { ...round, startsAt: toIso(round.startsAt), endsAt: toIso(round.endsAt), roomId: round.roomId || null } }));
            if (r) { setMsg('Round added.'); reload(); }
          }}>Add round</Button></div>
        </div>
      </Card>

      <ScheduleInterviews data={data} reload={reload} setMsg={setMsg} />

      <Card title="Drives">
        <Table head={['Drive', 'Date', 'CTC', 'Rules', 'Eligible', 'Applications', '']}>
          {data.drives.map((d: any) => (
            <tr key={d.id}><Td className="font-semibold">{d.title}<span className="block text-xs font-normal text-muted">{d.company} · {d.status}</span></Td><Td>{fmtDate(d.startsAt)}</Td><Td>{lpa(d.ctc)}</Td>
              <Td>v{d.ruleVersion}{d.published ? '' : ' (not published)'}</Td><Td className="tabular-nums">{d.eligible}</Td><Td className="tabular-nums">{d.applications}</Td>
              <Td><Link className="text-brand underline" href={`/tpo/rules?drive=${d.id}`}>Rules</Link> · <Link className="text-brand underline" href={`/tpo/applications?drive=${d.id}`}>Applicants</Link>{d.status === 'draft' && d.published && <> · <button type="button" className="text-brand underline" onClick={async () => { if (await act.run(() => api(`/api/v2/tpo/drives/${d.id}/status`, { body: { status: 'scheduled' } }))) { setMsg('Drive is now scheduled.'); reload(); } }}>Schedule</button></>}</Td></tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
