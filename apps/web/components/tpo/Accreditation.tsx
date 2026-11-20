'use client';

import React from 'react';
import { download, fmtInr, useAction, useApi } from '@/lib/api';
import { RecordOutcome } from './AccessAndOutcomes';
import { Button, Card, ErrorBox, Loading, Notice, PageHeader, Table, Td } from '../ui';

export function Accreditation() {
  const { data, error, reload } = useApi('/api/v2/tpo/accreditation');
  const act = useAction();
  const led = useApi('/api/v2/tpo/ledger');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const rows = [...data.rows, data.total];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="AD-11" title="Accreditation Reports" actions={<>
        <Button busy={act.busy} onClick={() => act.run(() => download('/api/v2/tpo/accreditation/export.xlsx', 'placement-outcomes.xlsx'))}>Download Excel file</Button>
        <Button kind="secondary" busy={act.busy} onClick={() => act.run(() => download('/api/v2/tpo/accreditation/export.csv', 'naac-nirf-placement.csv'))}>Download CSV</Button>
        <Button kind="secondary" onClick={() => window.print()}>Print or save as PDF</Button>
      </>}>Placement results for the 2027 batch, in the format used for NAAC (criterion 5.2) and NIRF.</PageHeader>
      <ErrorBox error={act.error} />
      {led.data && (led.data.verifiedPlacements + led.data.collegeRecordedPlacements > 0) && (
        <Notice tone="success">Of {led.data.verifiedPlacements + led.data.collegeRecordedPlacements} placements, {led.data.verifiedPlacements} are verified: signed by the recruiter and the student and recorded in the <a className="underline" href={`/ledger/${led.data.orgId}`}>public placement ledger</a>. The other {led.data.collegeRecordedPlacements} are recorded by the college without signatures. Auditors can check the first group themselves.</Notice>
      )}
      <Card title="Placement and progression by branch">
        <Table head={['Branch', 'Graduating', 'Placed', 'Placed %', 'Higher studies', 'Entrepreneurship', 'Median CTC', 'Highest CTC', 'Average CTC']}>
          {rows.map((r: any) => (
            <tr key={r.branch} className={r.branch === 'All branches' ? 'font-semibold' : ''}>
              <Td>{r.branch}</Td><Td className="tabular-nums">{r.graduating}</Td><Td className="tabular-nums">{r.placed}</Td><Td className="tabular-nums">{r.placedPercent}%</Td>
              <Td className="tabular-nums">{r.higherStudies}</Td><Td className="tabular-nums">{r.entrepreneurship}</Td><Td>{fmtInr(r.medianCtcInr)}</Td><Td>{fmtInr(r.highestCtcInr)}</Td><Td>{fmtInr(r.averageCtcInr)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <RecordOutcome onDone={reload} />
      <Notice tone="warn"><ul className="list-disc pl-5">{data.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></Notice>
    </div>
  );
}
