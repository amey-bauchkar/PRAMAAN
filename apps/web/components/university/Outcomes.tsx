'use client';

import React from 'react';
import { fmtInr, useApi } from '@/lib/api';
import { BarList } from '../charts';
import { Card, ErrorBox, Loading, Notice, PageHeader, Table, Td } from '../ui';

export function Outcomes() {
  const { data, error } = useApi('/api/v2/university/outcomes');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="AD-12 · University" title="Results Across Colleges">{data.note}</PageHeader>
      <Card title="Per college">
        <Table head={['College', 'Tier', 'Students', 'Placed', 'Placed %', 'Median CTC', 'Students with at least 1 Verified skill']}>
          {data.colleges.map((c: any) => <tr key={c.id}><Td className="font-semibold">{c.name}</Td><Td>{c.tier ?? '—'}</Td><Td className="tabular-nums">{c.students}</Td><Td className="tabular-nums">{c.placed}</Td><Td className="tabular-nums">{c.placedPercent}%</Td><Td>{fmtInr(c.medianCtc)}</Td><Td className="tabular-nums">{c.studentsWithVerifiedSkill} ({c.verifiedCoveragePercent}%)</Td></tr>)}
        </Table>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Placement rate"><BarList items={data.colleges.map((c: any) => ({ label: c.name, value: c.placedPercent }))} /></Card>
        <Card title="Students with Verified skills"><BarList items={data.colleges.map((c: any) => ({ label: c.name, value: c.verifiedCoveragePercent }))} /></Card>
      </div>
      <Notice>Each college’s placement officers check fairness on their own drives. The university never receives records of individual students.</Notice>
    </div>
  );
}
