'use client';

import React, { useState } from 'react';
import { api, fmtDate, useAction, useApi } from '@/lib/api';
import { DEMO_MODE } from '@/lib/session';
import { ImportedCode } from './ImportedCode';
import { Button, Card, ErrorBox, Field, inputCls, Notice, PageHeader, Table, Td } from '../ui';

export function Import() {
  const profile = useApi('/api/v2/student/profile');
  const subs = useApi('/api/v2/student/evidence');
  const privacy = useApi('/api/v2/student/privacy');
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [provider, setProvider] = useState<'leetcode' | 'codeforces'>('leetcode');
  const [handle, setHandle] = useState('');
  const [pending, setPending] = useState<{ token: string; instructions: string } | null>(null);
  const [ev, setEv] = useState({ kind: 'certificate', skillSlug: '', title: '', details: '', link: '' });
  const [skillQ, setSkillQ] = useState('');
  const [skillHits, setSkillHits] = useState<any[]>([]);

  const repoConsent = privacy.data?.purposes.find((p: any) => p.code === 'repo_verification');

  const link = async () => {
    const r = await act.run(() => api('/api/v2/student/external-profiles', { body: { provider, handle } }));
    if (r) setPending(r);
  };
  const verify = async () => {
    const r = await act.run(() => api(`/api/v2/student/external-profiles/${provider}/verify`, { method: 'POST' }));
    if (r) { setMsg(r.verified ? `${r.note} ${r.skill} ${r.next}` : r.note); if (r.verified) setPending(null); profile.reload(); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await act.run(() => api('/api/v2/student/evidence', { body: ev }));
    if (r) { setMsg(r.message); setEv({ kind: 'certificate', skillSlug: '', title: '', details: '', link: '' }); setSkillQ(''); subs.reload(); }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="ST-02" title="Add Your Work">We can only read your work, and you can stop sharing at any time. No GitHub? You can also add lab work, certificates and contest results.</PageHeader>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="GitHub (read-only, only the repositories you pick)">
          <p className="text-sm">Repository consent: <span className="font-semibold">{repoConsent?.active ? `active since ${fmtDate(repoConsent.grantedAt)}` : 'not given'}</span></p>
          <p className="mt-2 text-sm text-muted">You choose which repositories to share. We read the files at one fixed point in time, confirm they are unchanged, and never run your code on our servers. You can stop sharing in Privacy & Consent at any time.</p>
          {DEMO_MODE
            ? <Notice>Demo: GitHub sign-in is not connected here, so the demo uses sample code from a student project (Rahul’s canteen app). It is labelled as sample code wherever it appears.</Notice>
            : <Button className="mt-3" onClick={async () => { const r = await act.run(() => api('/api/integrations/github/connect')); if (r?.authorizeUrl) window.location.href = r.authorizeUrl; }}>Connect GitHub</Button>}
          <ImportedCode onDone={profile.reload} />
        </Card>

        <Card title="LeetCode or Codeforces">
          {!pending ? (
            <div className="flex flex-col gap-3">
              <Field label="Platform">
                <select className={inputCls} value={provider} onChange={e => setProvider(e.target.value as any)}><option value="leetcode">LeetCode</option><option value="codeforces">Codeforces</option></select>
              </Field>
              <Field label="Your username"><input className={inputCls} value={handle} onChange={e => setHandle(e.target.value)} placeholder={DEMO_MODE ? 'rahul-deshmukh-demo' : ''} /></Field>
              <Button onClick={link} busy={act.busy} disabled={!handle}>Get my code</Button>
              <p className="text-xs text-muted">We never ask for your password. To show the account is yours, you add a one-time code to your public profile.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm">{pending.instructions}</p>
              <p className="rounded-lg bg-paper p-3 text-center font-mono text-lg font-semibold">{pending.token}</p>
              <Button onClick={verify} busy={act.busy}>I’ve added it, check now</Button>
              <p className="text-xs text-muted">Your platform stats show a signal for the skill. The practice coding test turns it into a Verified skill.</p>
            </div>
          )}
        </Card>
      </div>

      <Card title="Add certificates, lab work or contest results">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <select className={inputCls} value={ev.kind} onChange={e => setEv({ ...ev, kind: e.target.value })}>
              <option value="certificate">Certificate</option><option value="lab">Lab or hardware work</option><option value="competition">Competition result</option>
            </select>
          </Field>
          <Field label="Skill it shows" hint={ev.skillSlug ? `Selected: ${ev.skillSlug}` : 'Search and pick one'}>
            <input className={inputCls} value={skillQ} onChange={async e => { setSkillQ(e.target.value); setSkillHits(e.target.value.length > 1 ? await api(`/api/v2/catalog/skills?q=${encodeURIComponent(e.target.value)}`) : []); }} />
            {skillHits.length > 0 && <ul className="max-h-32 overflow-y-auto rounded border border-line text-sm font-normal">{skillHits.map(s => (
              <li key={s.slug}><button type="button" className="w-full px-2 py-1 text-left hover:bg-brand/10" onClick={() => { setEv({ ...ev, skillSlug: s.slug }); setSkillQ(s.name); setSkillHits([]); }}>{s.name}</button></li>))}</ul>}
          </Field>
          <Field label="Title"><input className={inputCls} required value={ev.title} onChange={e => setEv({ ...ev, title: e.target.value })} placeholder="e.g. PLC traffic-light lab, semester 5" /></Field>
          <Field label="Link (optional)"><input className={inputCls} type="url" value={ev.link} onChange={e => setEv({ ...ev, link: e.target.value })} placeholder="https://" /></Field>
          <div className="sm:col-span-2"><Field label="What did you do?"><textarea className={inputCls} rows={3} value={ev.details} onChange={e => setEv({ ...ev, details: e.target.value })} /></Field></div>
          <div><Button type="submit" busy={act.busy} disabled={!ev.skillSlug || ev.title.length < 3}>Send to mentor</Button></div>
        </form>
      </Card>

      {subs.data?.length > 0 && (
        <Card title="Your submissions">
          <Table head={['Submitted', 'Type', 'Skill', 'What', 'Status']}>
            {subs.data.map((s: any) => (
              <tr key={s.id}><Td>{fmtDate(s.createdAt)}</Td><Td className="capitalize">{s.kind}</Td><Td>{s.skill}</Td><Td>{s.description}{s.review_note && <span className="block text-xs text-muted">Mentor: {s.review_note}</span>}</Td><Td className="capitalize">{s.status === 'submitted' ? 'Waiting for review' : s.status}</Td></tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
