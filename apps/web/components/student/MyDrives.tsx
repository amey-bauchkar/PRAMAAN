'use client';

import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtDateTime, lpa, useAction, useApi } from '@/lib/api';
import { Button, Card, CheckLine, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, ResultBadge } from '../ui';
import { DecisionTrace } from './DecisionTrace';
import { Lang, LANGS, loadLang, reasonText, saveLang, timingText, ui } from '@/lib/i18n';

const HORIZON = {
  in_time: 'bg-ink/10 text-ink',
  tight: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  next_drives: 'bg-line text-muted',
} as const;

export function MyDrives() {
  const { data, error, reload } = useApi('/api/v2/student/drives');
  const act = useAction();
  const [appealFor, setAppealFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>('en');
  useEffect(() => setLang(loadLang()), []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const pp = data.proofPath;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="ST-07" title={ui(lang, 'drives.title')}>{ui(lang, 'drives.intro')}</PageHeader>
      <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label={ui(lang, 'lang')}>
        <span className="text-muted">{ui(lang, 'lang')}:</span>
        {LANGS.map(l => (
          <button key={l.code} type="button" lang={l.code} aria-pressed={lang === l.code} onClick={() => { setLang(l.code); saveLang(l.code); }}
            className={`rounded-full border px-3 py-1 ${lang === l.code ? 'border-accent bg-accent/10 font-semibold' : 'border-line'}`}>{l.label}</button>
        ))}
        {ui(lang, 'draftNote') && <span className="text-xs text-muted">{ui(lang, 'draftNote')}</span>}
      </div>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />

      <Card title={ui(lang, 'path.title', { n: pp.eligibleNow, total: pp.total })}>
        {pp.actions.length === 0 ? <p className="text-sm text-muted">No single skill would make you eligible for another drive right now.</p> : (
          <ol className="flex flex-col gap-2">
            {pp.actions.map((a: any, i: number) => (
              <li key={a.skillId} className={`rounded-lg border p-3 ${i === 0 ? 'border-2 border-accent bg-accent/10' : 'border-line'}`}>
                <span className="font-semibold" lang={lang}>{ui(lang, 'path.action', { skill: a.name, proof: String(a.targetProof).replace(/^L/, 'Level '), lvl: a.targetLevel > 1 ? ui(lang, 'path.lvl', { level: a.targetLevel }) : '', n: a.unlocksCount, drives: a.drives.join(', ') })}</span>
                {a.timing && (
                  <>
                    <p className="mt-1 text-sm" lang={lang}>{timingText(a.timing, lang)}</p>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {a.timing.drives.map((t: any) => (
                        <li key={t.driveId} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${HORIZON[t.horizon as keyof typeof HORIZON]}`}>
                          {t.title}: {ui(lang, `h.${t.horizon}`)} · {ui(lang, 'daysLeft', { n: t.daysLeft })}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-xs text-muted">We work this out by checking the published rules again as if you had that skill. There is no hidden scoring. Time estimates assume 2 hours of study a day, plus 2 days to book a mentor session for Level 3.</p>
      </Card>

      <div className="flex flex-col gap-4">
        {data.drives.map((d: any) => (
          <Card key={d.id} title={<span>{d.title} <span className="font-normal text-muted">· {d.company}</span></span>}
            actions={d.decision ? <ResultBadge result={d.decision.result} /> : <span className="text-sm text-muted">{ui(lang, 'notPublished')}</span>}>
            <p className="text-sm text-muted">{fmtDate(d.startsAt)} · {lpa(d.ctc)} · rules version {d.ruleVersion}{d.decision ? ` · checked ${fmtDateTime(d.decision.decidedAt)}` : ''}</p>
            {d.rounds.length > 0 && <p className="mt-1 text-sm">{d.rounds.map((r: any) => `${r.title} ${fmtDateTime(r.startsAt)}`).join(' · ')}</p>}
            {d.decision && (
              <>
                {d.decision.overridden && <Notice tone="success">The placement office changed this decision after your appeal.</Notice>}
                <ul className="mt-2 divide-y divide-line">
                  {d.decision.checks.map((c: any) => <CheckLine key={c.id} passed={c.passed}><span lang={lang}>{reasonText(c, lang)}</span></CheckLine>)}
                </ul>
                <div className="mt-2"><DecisionTrace decisionId={d.decision.id} /></div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {d.decision.result === 'eligible' && !d.application && (
                    <Button busy={act.busy} onClick={async () => { if (await act.run(() => api(`/api/v2/student/drives/${d.id}/apply`, { method: 'POST' }))) { setMsg(`Applied to ${d.title}.`); reload(); } }}>{ui(lang, 'apply')}</Button>
                  )}
                  {d.application && <span className="rounded-full bg-brand/15 px-3 py-1 text-sm font-semibold text-brand">Application status: {d.application.replace('_', ' ')}</span>}
                  {d.application === 'offered' && <OfferButtons drive={d} onDone={reload} />}
                  {d.decision.result !== 'eligible' && !d.decision.appeal && (
                    appealFor === d.id ? (
                      <div className="flex w-full flex-col gap-2">
                        <Field label="Why do you think this result is wrong?"><textarea className={inputCls} rows={3} value={reason} onChange={e => setReason(e.target.value)} /></Field>
                        <div className="flex gap-2">
                          <Button busy={act.busy} disabled={reason.length < 10} onClick={async () => {
                            const r = await act.run(() => api('/api/v2/student/appeals', { body: { decisionId: d.decision.id, reason } }));
                            if (r) { setMsg(r.message); setAppealFor(null); setReason(''); reload(); }
                          }}>Send appeal</Button>
                          <Button kind="secondary" onClick={() => setAppealFor(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : <Button kind="secondary" onClick={() => setAppealFor(d.id)}>{ui(lang, 'appeal')}</Button>
                  )}
                  {d.decision.appeal && <span className="text-sm">Appeal: <span className="font-semibold">{d.decision.appeal.status}</span>{d.decision.appeal.note ? ` — ${d.decision.appeal.note}` : ''}</span>}
                </div>
              </>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function OfferButtons({ drive, onDone }: { drive: any; onDone: () => void }) {
  const act = useAction();
  const respond = async (accept: boolean) => {
    if (await act.run(() => api(`/api/v2/student/offers/${drive.applicationId}/respond`, { body: { accept } }))) onDone();
  };
  return <span className="flex gap-2"><Button busy={act.busy} onClick={() => respond(true)}>Accept offer</Button><Button kind="secondary" busy={act.busy} onClick={() => respond(false)}>Decline</Button></span>;
}
