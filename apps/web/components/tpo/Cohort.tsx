'use client';

import React, { useState } from 'react';
import { download, useAction, useApi } from '@/lib/api';
import { BarList, Heatmap } from '../charts';
import { Button, Card, ErrorBox, Loading, Notice, PageHeader, Stat, Table, Td } from '../ui';

const fmtKpi = (k: any) => (k.value === null ? '—' : k.unit === '%' ? `${k.value}%` : k.unit === 'days' ? `${k.value} d` : `${k.value}`);

export function Cohort() {
  const { data, error } = useApi('/api/v2/tpo/cohort');
  const iv = useApi('/api/v2/tpo/interventions');
  const act = useAction();
  const [showTable, setShowTable] = useState(false);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading what="Preparing the batch report" />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow={`AD-01 · ${data.scope}`} title="Batch Dashboard" actions={<>
        <Button kind="secondary" busy={act.busy} onClick={() => act.run(() => download('/api/v2/tpo/cohort/export.csv', 'cohort-report.csv'))}>Download CSV file</Button>
        <Button kind="secondary" onClick={() => window.print()}>Print or save as PDF</Button>
      </>}>{data.cohortSize} students in the 2027 batch.</PageHeader>
      <ErrorBox error={act.error} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.kpis.map((k: any) => (
          <Stat key={k.key} label={k.label} value={fmtKpi(k)} sub={<>{k.formula}<br />{k.key === 'time_to_shortlist' ? `${k.denominator} drive(s) with a shortlist` : `${k.numerator} ÷ ${k.denominator}`}</>} />
        ))}
      </div>

      <Card title="Verified core skills by branch" actions={<Button kind="ghost" onClick={() => setShowTable(s => !s)}>{showTable ? 'Show heatmap' : 'Show as table'}</Button>}>
        <p className="mb-3 text-sm text-muted">Share of each branch’s students who have this skill Verified (at any level). Faded cells are skills that are not core for that branch.</p>
        {showTable ? (
          <Table head={['Skill', ...data.branches]}>
            {data.heatmap.map((r: any) => <tr key={r.slug}><Td>{r.skill}</Td>{r.cells.map((c: any) => <Td key={c.branch} className="tabular-nums">{c.verified}/{c.total} ({c.percent}%)</Td>)}</tr>)}
          </Table>
        ) : (
          <Heatmap columns={data.branches} rows={data.heatmap.map((r: any) => ({
            label: r.skill,
            cells: r.cells.map((c: any) => ({ column: c.branch, percent: c.percent, dimmed: !c.required, detail: `${r.skill} · ${c.branch}: ${c.verified} of ${c.total} students Verified (${c.percent}%)${c.required ? '' : ' · not a core skill here'}` })),
          }))} />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Practice drive results (${data.mock.studentsWithAttempt} students, latest attempt)`}>
          <BarList items={Object.entries(data.mock.averages).filter(([, v]) => v !== null).map(([k, v]) => ({ label: k === 'machine_test' ? 'Coding test' : k[0].toUpperCase() + k.slice(1), value: v as number, detail: `Average ${k.replace('_', ' ')} score: ${v}%` }))} />
          <p className="mt-4 text-sm font-semibold">Weakest topics</p>
          <BarList items={data.mock.topWeakTopics.map((t: any) => ({ label: t.topic.replace(/-/g, ' '), value: t.percent, detail: `${t.students} students weak in ${t.topic} (${t.percent}%)` }))} />
        </Card>
        {data.beforeAfter && (
          <Card title={`Before vs after: ${data.beforeAfter.intervention}`}>
            <p className="text-sm text-muted">Share of {data.beforeAfter.branch} practice attempts that were weak in {data.beforeAfter.skill}.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Stat label="Before the workshop" value={`${data.beforeAfter.before.weakPercent ?? '—'}%`} sub={`${data.beforeAfter.before.attempts} attempts`} />
              <Stat label="After the workshop" value={`${data.beforeAfter.after.weakPercent ?? '—'}%`} sub={`${data.beforeAfter.after.attempts} attempts`} />
            </div>
            <p className="mt-3 text-xs text-muted">The same skill and branch are compared in both periods. The history shown here is sample data.</p>
          </Card>
        )}
      </div>

      <Card title="Training that would help the most students">
        {!iv.data ? <Loading what="Checking the rules for every student" /> : (
          <>
            <Table head={['Skill', 'Level to reach', 'Students held back', 'Extra drive eligibilities']}>
              {iv.data.ranking.map((r: any) => <tr key={r.skillId}><Td className="font-semibold">{r.name}</Td><Td>{r.targetProof}</Td><Td className="tabular-nums">{r.studentsAffected}</Td><Td className="tabular-nums">+{r.eligibilitiesGained}</Td></tr>)}
            </Table>
            <Notice>{iv.data.method}</Notice>
          </>
        )}
      </Card>
    </div>
  );
}
