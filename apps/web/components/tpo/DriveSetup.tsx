'use client';

import React, { useState } from 'react';
import { api, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Field, inputCls } from '../ui';

type Props = { data: any; reload: () => void; setMsg: (m: string) => void };

/** Books consecutive interview slots for chosen applicants. The database refuses any overlap for a panel or a student. */
export function ScheduleInterviews({ data, reload, setMsg }: Props) {
  const act = useAction();
  const interviewRounds = data.rounds.filter((r: any) => ['interview', 'hr', 'group_discussion'].includes(r.kind));
  const [roundId, setRoundId] = useState('');
  const round = interviewRounds.find((r: any) => r.id === roundId);
  const apps = useApi(round ? `/api/v2/tpo/applications?driveId=${round.driveId}` : null);
  const [picked, setPicked] = useState<string[]>([]);
  const [panel, setPanel] = useState('Panel A');
  const [mins, setMins] = useState('30');

  return (
    <Card title="Schedule interviews">
      <p className="mb-3 text-sm text-muted">
        Gives each chosen applicant a time slot, one after another, starting when the round starts. The system refuses a slot if the panel or the student is already booked at that time.
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Round">
          <select className={inputCls} value={roundId} onChange={e => { setRoundId(e.target.value); setPicked([]); }}>
            <option value="">Choose a round</option>
            {interviewRounds.map((r: any) => <option key={r.id} value={r.id}>{r.drive}: {r.title}</option>)}
          </select>
        </Field>
        <Field label="Panel"><input className={inputCls} value={panel} onChange={e => setPanel(e.target.value)} /></Field>
        <Field label="Minutes per student"><input className={inputCls} type="number" min={5} max={120} value={mins} onChange={e => setMins(e.target.value)} /></Field>
        <div className="flex items-end">
          <Button busy={act.busy} disabled={!round || picked.length === 0 || !panel} onClick={async () => {
            const r = await act.run(() => api(`/api/v2/tpo/rounds/${roundId}/slots`, { body: { applicationIds: picked, panel, slotMinutes: Number(mins) } }));
            if (r) { setMsg(r.message); setPicked([]); reload(); }
          }}>Book {picked.length || ''} slot{picked.length === 1 ? '' : 's'}</Button>
        </div>
      </div>
      {round && (apps.data ? (
        apps.data.length === 0 ? <p className="mt-3 text-sm text-muted">No one has applied to this drive yet.</p> : (
          <ul className="mt-3 grid gap-1 sm:grid-cols-2">
            {apps.data.map((a: any) => (
              <li key={a.id}>
                <label className="flex items-center gap-2 rounded border border-line px-2 py-1 text-sm">
                  <input type="checkbox" checked={picked.includes(a.id)} onChange={e => setPicked(e.target.checked ? [...picked, a.id] : picked.filter(x => x !== a.id))} />
                  {a.name} <span className="text-muted">· {a.stage.replace(/_/g, ' ')}</span>
                </label>
              </li>
            ))}
          </ul>
        )
      ) : <p className="mt-3 text-sm text-muted">Loading applicants…</p>)}
      <ErrorBox error={act.error} />
    </Card>
  );
}

/** Adds a company and creates a draft drive for it. Rules are written afterwards on the Rules page. */
export function NewDrive({ data, reload, setMsg }: Props) {
  const act = useAction();
  const [f, setF] = useState({ companyId: '', title: '', startsAt: '', endsAt: '', ctcInr: '' });
  const [co, setCo] = useState({ name: '', industry: '', contactEmail: '' });
  const iso = (l: string) => (l ? new Date(l).toISOString() : '');
  return (
    <Card title="Add a company or drive">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold">New company</p>
          <Field label="Company name"><input className={inputCls} value={co.name} onChange={e => setCo({ ...co, name: e.target.value })} /></Field>
          <Field label="Industry"><input className={inputCls} value={co.industry} onChange={e => setCo({ ...co, industry: e.target.value })} /></Field>
          <Field label="Contact email"><input className={inputCls} type="email" value={co.contactEmail} onChange={e => setCo({ ...co, contactEmail: e.target.value })} /></Field>
          <div><Button kind="secondary" busy={act.busy} disabled={co.name.length < 2 || co.industry.length < 2 || !co.contactEmail} onClick={async () => {
            if (await act.run(() => api('/api/v2/tpo/companies', { body: co }))) { setMsg('Company added.'); setCo({ name: '', industry: '', contactEmail: '' }); reload(); }
          }}>Add company</Button></div>
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold">New drive</p>
          <Field label="Company">
            <select className={inputCls} value={f.companyId} onChange={e => setF({ ...f, companyId: e.target.value })}>
              <option value="">Choose a company</option>
              {data.companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Drive title"><input className={inputCls} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="e.g. Graduate Engineer Trainee" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts"><input type="datetime-local" className={inputCls} value={f.startsAt} onChange={e => setF({ ...f, startsAt: e.target.value })} /></Field>
            <Field label="Ends"><input type="datetime-local" className={inputCls} value={f.endsAt} onChange={e => setF({ ...f, endsAt: e.target.value })} /></Field>
          </div>
          <Field label="CTC in rupees per year (optional)"><input className={inputCls} type="number" value={f.ctcInr} onChange={e => setF({ ...f, ctcInr: e.target.value })} /></Field>
          <div><Button busy={act.busy} disabled={!f.companyId || f.title.length < 3 || !f.startsAt || !f.endsAt} onClick={async () => {
            const r = await act.run(() => api('/api/v2/tpo/drives', { body: { ...f, startsAt: iso(f.startsAt), endsAt: iso(f.endsAt), ctcInr: f.ctcInr || null } }));
            if (r) { setMsg(r.message); setF({ companyId: '', title: '', startsAt: '', endsAt: '', ctcInr: '' }); reload(); }
          }}>Create drive</Button></div>
        </div>
      </div>
      <ErrorBox error={act.error} />
    </Card>
  );
}
