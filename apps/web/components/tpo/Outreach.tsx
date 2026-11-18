'use client';

import React, { useState } from 'react';
import { api, fmtDateTime, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, Table, Td } from '../ui';

export function Outreach() {
  const { data, error, reload } = useApi('/api/v2/tpo/outreach');
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const t = data.templates[0];
  const replied = data.messages.filter((m: any) => m.status === 'replied').length;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="AD-05" title="Bulk Mailing">Write the invitation once and send it to every company on your list. {data.companies.length} companies · {data.messages.length} messages · {replied} replies.</PageHeader>
      {data.transport === 'outbox' && <Notice tone="warn">Email sending is not set up, so messages stay in the outbox and are not actually sent. Set SMTP_HOST to turn on sending.</Notice>}
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      {t && (
        <Card title={`Template: ${t.name}`} actions={<Button busy={act.busy} onClick={async () => { const r = await act.run(() => api('/api/v2/tpo/outreach/send', { body: { templateId: t.id } })); if (r) { setMsg(`${r.recipients} messages created. ${r.note}`); reload(); } }}>Send to all {data.companies.length} companies</Button>}>
          <p className="text-sm font-semibold">{t.subject}</p>
          <pre className="mt-2 whitespace-pre-wrap rounded bg-paper p-3 font-sans text-sm">{t.body}</pre>
          <p className="mt-2 text-xs text-muted">{'{{company}}'} and {'{{college}}'} are replaced with each company’s and college’s name when sent.</p>
        </Card>
      )}
      <Card title="Messages" actions={data.transport === 'smtp' && data.messages.some((m: any) => m.status === 'queued') ? <Button kind="secondary" busy={act.busy} onClick={async () => { const r = await act.run(() => api('/api/v2/tpo/outreach/dispatch', { method: 'POST' })); if (r) { setMsg(r.note); reload(); } }}>Send waiting messages</Button> : undefined}>
        <p className="mb-2 text-xs text-muted">A message shows as Sent only after the mail server accepted it. Replies arrive in your own inbox; record them here by hand.</p>
        {data.messages.length === 0 ? <p className="text-sm text-muted">Nothing sent yet.</p> : (
          <Table head={['Company', 'Status', 'Sent', 'Reply', '']}>
            {data.messages.map((m: any) => (
              <tr key={m.id}>
                <Td>{m.company}<span className="block text-xs text-muted">{m.to_email}</span></Td>
                <Td>{m.status === 'queued' ? (data.transport === 'outbox' ? 'Saved, not sent' : 'Waiting to send') : m.status === 'failed' ? <span className="text-red-700">Failed{m.error ? `: ${m.error}` : ''}</span> : m.status}</Td><Td>{fmtDateTime(m.sentAt)}</Td><Td>{m.reply_excerpt ?? '—'}</Td>
                <Td>{m.status === 'failed' && <Button kind="ghost" busy={act.busy} onClick={async () => { if (await act.run(() => api(`/api/v2/tpo/outreach/messages/${m.id}/retry`, { method: 'POST' }))) reload(); }}>Try again</Button>}{m.status !== 'replied' && (replyFor === m.id ? (
                  <span className="flex flex-col gap-1"><Field label="Paste the reply"><input className={inputCls} value={reply} onChange={e => setReply(e.target.value)} /></Field>
                    <Button busy={act.busy} onClick={async () => { if (await act.run(() => api(`/api/v2/tpo/outreach/messages/${m.id}/reply`, { body: { excerpt: reply } }))) { setReplyFor(null); setReply(''); reload(); } }}>Save</Button></span>
                ) : <Button kind="ghost" onClick={() => setReplyFor(m.id)}>Save reply</Button>)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
