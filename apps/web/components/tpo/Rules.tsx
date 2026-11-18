'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtDateTime, useAction, useApi } from '@/lib/api';
import { Button, Card, CheckLine, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, Table, Td } from '../ui';

export function Rules() {
  const router = useRouter();
  const driveId = useSearchParams().get('drive');
  const drives = useApi('/api/v2/tpo/drives');
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="AD-07" title="Eligibility Rules & Appeals">Set the rules once and every student is checked against them. Each decision saves the rules and marks that were used, so it can be explained and appealed.</PageHeader>
      <Field label="Drive">
        <select className={inputCls} value={driveId ?? ''} onChange={e => router.push(`/tpo/rules?drive=${e.target.value}`)}>
          <option value="">Choose a drive</option>
          {drives.data?.drives.map((d: any) => <option key={d.id} value={d.id}>{d.title} · {d.company}</option>)}
        </select>
      </Field>
      {driveId && <RuleEditor driveId={driveId} key={driveId} />}
      <Appeals />
    </div>
  );
}

const emptySkill = { skillId: '', name: '', minLevel: 1, minProof: 'L1' };

function RuleEditor({ driveId }: { driveId: string }) {
  const { data, error, reload } = useApi(`/api/v2/tpo/drives/${driveId}/rules`);
  const act = useAction();
  const [rules, setRules] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [repair, setRepair] = useState<any>(null);
  const [rationale, setRationale] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (data && !rules) setRules(structuredClone(data.versions[0]?.rules ?? { academics: {}, backlogs: {}, branches: [], graduatingYears: [2027], skills: [], policy: {} })); }, [data, rules]);
  if (error) return <ErrorBox error={error} />;
  if (!data || !rules) return <Loading />;

  const num = (v: string) => (v === '' ? undefined : Number(v));
  const set = (path: string[], v: any) => { const r = structuredClone(rules); let o = r; for (const k of path.slice(0, -1)) o = o[k] ??= {}; if (v === undefined) delete o[path.at(-1)!]; else o[path.at(-1)!] = v; setRules(r); setPreview(null); };
  const runPreview = async () => { const r = await act.run(() => api(`/api/v2/tpo/drives/${driveId}/rules/preview`, { body: { rules } })); if (r) { setPreview(r); setRepair(null); } };
  const findRepair = async () => { const r = await act.run(() => api(`/api/v2/tpo/drives/${driveId}/rules/repair`, { body: { rules } })); if (r) setRepair(r); };
  const applyRepair = async (opt: any) => {
    setRules(structuredClone(opt.rules)); setRepair(null);
    setRationale(`Fairer alternative: ${opt.description.join('; ')}`);
    const r = await act.run(() => api(`/api/v2/tpo/drives/${driveId}/rules/preview`, { body: { rules: opt.rules } }));
    if (r) setPreview(r);
  };
  const publish = async () => {
    const r = await act.run(() => api(`/api/v2/tpo/drives/${driveId}/rules/publish`, { body: { rules, rationale } }));
    if (r) { setMsg(`Version ${r.versionNo} saved: ${r.eligible} eligible, ${r.ineligible} not eligible, ${r.needsReview} need review. ${r.note}`); setRationale(''); setPreview(null); reload(); }
  };
  const publishDecisions = async () => { const r = await act.run(() => api(`/api/v2/tpo/drives/${driveId}/decisions/publish`, { method: 'POST' })); if (r) { setMsg(`Published to students: ${r.eligible} eligible.`); reload(); } };
  const adverse = preview ? Object.entries(preview.fairness).filter(([, v]: any) => v.adverseImpactDetected) : [];

  return (
    <>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      <Card title={`${data.drive.title} · ${data.drive.company}`} actions={!data.drive.published && data.drive.currentVersionId ? <Button busy={act.busy} onClick={publishDecisions}>Publish decisions to students</Button> : <span className="text-sm text-muted">{data.drive.published ? 'Decisions published' : ''}</span>}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Min CGPA"><input className={inputCls} type="number" step="0.1" value={rules.academics?.minCgpa ?? ''} onChange={e => set(['academics', 'minCgpa'], num(e.target.value))} /></Field>
          <Field label="Min 10th %"><input className={inputCls} type="number" value={rules.academics?.minTenthPct ?? ''} onChange={e => set(['academics', 'minTenthPct'], num(e.target.value))} /></Field>
          <Field label="Min 12th or diploma %"><input className={inputCls} type="number" value={rules.academics?.minTwelfthOrDiplomaPct ?? ''} onChange={e => set(['academics', 'minTwelfthOrDiplomaPct'], num(e.target.value))} /></Field>
          <Field label="Max gap years"><input className={inputCls} type="number" value={rules.academics?.maxGapYears ?? ''} onChange={e => set(['academics', 'maxGapYears'], num(e.target.value))} /></Field>
          <Field label="Max current backlogs"><input className={inputCls} type="number" value={rules.backlogs?.maxActive ?? ''} onChange={e => set(['backlogs', 'maxActive'], num(e.target.value))} /></Field>
          <Field label="Max past backlogs"><input className={inputCls} type="number" value={rules.backlogs?.maxHistory ?? ''} onChange={e => set(['backlogs', 'maxHistory'], num(e.target.value))} /></Field>
          <Field label="Branches (comma-separated)"><input className={inputCls} value={(rules.branches ?? []).join(', ')} onChange={e => set(['branches'], e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))} /></Field>
          <Field label="Max offers already received"><input className={inputCls} type="number" value={rules.policy?.maxOffersHeld ?? ''} onChange={e => set(['policy', 'maxOffersHeld'], num(e.target.value))} /></Field>
        </div>
        <p className="mt-4 text-sm font-semibold">Required skills (must be Verified)</p>
        <ul className="mt-2 flex flex-col gap-2">
          {rules.skills.map((s: any, i: number) => (
            <li key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <select aria-label="Skill" className={inputCls} value={s.skillId} onChange={e => { const k = data.skills.find((x: any) => x.id === e.target.value); const sk = [...rules.skills]; sk[i] = { ...s, skillId: k.id, name: k.name }; set(['skills'], sk); }}>
                <option value="">Choose…</option>{data.skills.map((k: any) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
              <select aria-label="Minimum skill level" className={inputCls} value={s.minLevel} onChange={e => { const sk = [...rules.skills]; sk[i] = { ...s, minLevel: Number(e.target.value) }; set(['skills'], sk); }}>{[1, 2, 3].map(l => <option key={l} value={l}>Level {l}</option>)}</select>
              <select aria-label="Minimum proof" className={inputCls} value={s.minProof} onChange={e => { const sk = [...rules.skills]; sk[i] = { ...s, minProof: e.target.value }; set(['skills'], sk); }}>{['L1', 'L2', 'L3'].map(l => <option key={l} value={l}>Proof level {l.slice(1)} or higher</option>)}</select>
              <Button kind="secondary" onClick={() => set(['skills'], rules.skills.filter((_: any, j: number) => j !== i))}>Remove</Button>
            </li>
          ))}
        </ul>
        <Button kind="ghost" className="mt-2" onClick={() => set(['skills'], [...rules.skills, { ...emptySkill }])}>+ Add skill</Button>

        <div className="mt-4 flex flex-wrap gap-2"><Button kind="secondary" busy={act.busy} onClick={runPreview}>Preview who would qualify</Button></div>
        {preview && (
          <div className="mt-4 flex flex-col gap-3">
            <Notice tone={adverse.length ? 'warn' : 'info'}>
              With these rules {preview.eligible} of {preview.population} students would be eligible (now {preview.currentlyEligible}): <span className="font-semibold">{preview.gained} would gain and {preview.lost} would lose</span> eligibility.
              {adverse.length ? ` Not fair to some groups (below 80% of the top group): ${adverse.map(([k]) => k.replace('_', ' ')).join(', ')}. About ${preview.shortfall} more student(s) from the lowest group would need to qualify to fix this.` : ' All groups are treated fairly (none below 80% of the top group).'}
              <span className="mt-1 block text-xs text-muted">{preview.populationNote}</span>
            </Notice>
            {adverse.length > 0 && (
              <div className="rounded-lg border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p><span className="font-semibold">Find a fairer rule.</span> PRAMAAN tries small changes to these rules and shows the ones that close the gap. Required skills are never removed.</p>
                  <Button kind="secondary" busy={act.busy} onClick={findRepair}>Find a fairer rule</Button>
                </div>
                {repair && (
                  <div className="mt-3 flex flex-col gap-2">
                    <p className="text-xs text-muted">Tried {repair.searched} small changes. {repair.note}</p>
                    {repair.options.length === 0 ? <p>No small change closes the gap. Think about whether each requirement is really needed for the job.</p> : (
                      <ul className="flex flex-col gap-2">
                        {repair.options.map((o: any, i: number) => (
                          <li key={i} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-line p-2">
                            <div>
                              <ul className="list-disc pl-5">{o.description.map((d: string) => <li key={d}>{d}</li>)}</ul>
                              <p className="mt-1 text-xs text-muted">
                                {o.fixesAdverseImpact ? 'Fair to all groups' : `Narrows the gap: shortfall below 80% goes from ${repair.baseline.ratioGap} to ${o.ratioGap}`} · lowest group at {o.minImpactRatio ?? '—'} · {o.eligible} eligible ({o.eligibleChange >= 0 ? '+' : ''}{o.eligibleChange})
                                {o.touchesSkills && <span className="text-amber-700 dark:text-amber-300"> · makes a skill requirement easier</span>}
                              </p>
                            </div>
                            <Button kind="ghost" onClick={() => applyRepair(o)}>Use this</Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="grid gap-3 lg:grid-cols-2">
              {Object.entries(preview.fairness).map(([dim, rep]: any) => (
                <div key={dim} className="rounded-lg border border-line p-3 text-sm">
                  <p className="font-semibold capitalize">{dim.replace('_', ' ')} {rep.adverseImpactDetected && <span className="text-amber-700 dark:text-amber-300">· flag</span>}</p>
                  <ul className="mt-1">{Object.values(rep.groups).map((g: any) => <li key={g.groupName} className="flex justify-between gap-2"><span>{g.groupName}</span><span className="tabular-nums">{g.isSuppressed ? 'too few to show' : `${Math.round(g.selectionRate * 100)}% · vs top group ${g.impactRatio ?? '—'}`}</span></li>)}</ul>
                </div>
              ))}
            </div>
            <Field label="Why are you making this change? (saved with the rules)"><input className={inputCls} value={rationale} onChange={e => setRationale(e.target.value)} /></Field>
            <div><Button busy={act.busy} disabled={rationale.length < 5} onClick={publish}>Save as a new version</Button></div>
          </div>
        )}
      </Card>

      <Card title="Rule history">
        <Table head={['Version', 'Published', 'Reason']}>
          {data.versions.map((v: any) => <tr key={v.id}><Td>v{v.version_no}{v.id === data.drive.currentVersionId ? ' (current)' : ''}</Td><Td>{fmtDateTime(v.publishedAt)}</Td><Td>{v.rationale}</Td></tr>)}
        </Table>
        <p className="mt-2 text-xs text-muted">Earlier versions cannot be edited or deleted. A new version replaces them.</p>
      </Card>
    </>
  );
}

function Appeals() {
  const { data, reload } = useApi('/api/v2/tpo/appeals');
  const act = useAction();
  const [note, setNote] = useState<Record<string, string>>({});
  if (!data) return null;
  const pending = data.filter((a: any) => a.status === 'pending');
  return (
    <Card title={`Appeals (${pending.length} open)`}>
      <ErrorBox error={act.error} />
      {data.length === 0 ? <p className="text-sm text-muted">No appeals.</p> : (
        <ul className="flex flex-col gap-3">
          {data.map((a: any) => (
            <li key={a.id} className="rounded-lg border border-line p-3 text-sm">
              <p className="font-semibold">{a.student} ({a.enrollmentNo}) · {a.drive} <span className="font-normal text-muted">· {fmtDate(a.createdAt)} · due {fmtDate(a.dueAt)}</span></p>
              <p className="mt-1">“{a.reason}”</p>
              <ul className="mt-1">{a.failing.map((f: string, i: number) => <CheckLine key={i} passed={false}>{f}</CheckLine>)}</ul>
              {a.status === 'pending' ? (
                <div className="mt-2 flex flex-col gap-2">
                  <Field label="Reply to the student (they will see this)"><input className={inputCls} value={note[a.id] ?? ''} onChange={e => setNote({ ...note, [a.id]: e.target.value })} /></Field>
                  <div className="flex gap-2">
                    <Button busy={act.busy} disabled={(note[a.id] ?? '').length < 5} onClick={async () => { if (await act.run(() => api(`/api/v2/tpo/appeals/${a.id}/decide`, { body: { status: 'overturned', note: note[a.id] } }))) reload(); }}>Change decision (make eligible)</Button>
                    <Button kind="secondary" busy={act.busy} disabled={(note[a.id] ?? '').length < 5} onClick={async () => { if (await act.run(() => api(`/api/v2/tpo/appeals/${a.id}/decide`, { body: { status: 'upheld', note: note[a.id] } }))) reload(); }}>Keep decision</Button>
                  </div>
                </div>
              ) : <p className="mt-2"><span className="font-semibold capitalize">{a.status}</span> — {a.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
