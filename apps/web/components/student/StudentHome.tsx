'use client';

import Link from 'next/link';
import React from 'react';
import { useApi } from '@/lib/api';
import { Stat } from '../ui';

/** Student home: four key numbers and the best next step. */
export function StudentHome() {
  const profile = useApi('/api/v2/student/profile');
  const drives = useApi('/api/v2/student/drives');
  if (!profile.data || !drives.data) return null;
  const skills = profile.data.skills as any[];
  const top = drives.data.proofPath.actions[0];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg">Hi {profile.data.student.name.split(' ')[0]}.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Verified skills" value={skills.filter(s => s.state === 'verified').length} sub={`of ${skills.length} on your profile`} />
        <Stat label="Added, no proof yet" value={skills.filter(s => s.state === 'claimed').length} />
        <Stat label="Drives you can apply to" value={`${drives.data.proofPath.eligibleNow} / ${drives.data.proofPath.total}`} />
        <Stat label="Need re-checking in 60 days" value={skills.filter(s => s.expiresSoon).length} />
      </div>
      {top && (
        <Link href="/student/drives" className="rounded-2xl border-2 border-accent bg-accent/10 p-5 hover:bg-accent/20">
          <p className="text-xs font-semibold uppercase tracking-wider">Your next step</p>
          <p className="mt-1 font-display text-xl font-semibold">Prove {top.name} ({String(top.targetProof).replace(/^L/, 'Level ')}) to apply to {top.unlocksCount} more drive{top.unlocksCount === 1 ? '' : 's'}</p>
          <p className="mt-1 text-sm text-muted">{top.drives.join(', ')}</p>
        </Link>
      )}
    </div>
  );
}
