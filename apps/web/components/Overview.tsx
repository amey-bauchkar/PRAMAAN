'use client';

import Link from 'next/link';
import React from 'react';
import { modulesFor, WORKSPACES, WorkspaceKey } from '@/lib/workspaces';
import { useMe } from './WorkspaceShell';
import { StudentHome } from './student/StudentHome';

export function Overview({ workspace }: { workspace: WorkspaceKey }) {
  const me = useMe();
  const def = WORKSPACES[workspace];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">{def.title}</h1>
        <p className="mt-1 text-muted">{def.audience}</p>
      </div>
      {workspace === 'student' && <StudentHome />}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {modulesFor(workspace, me?.role ?? null).map(m => (
          <li key={m.slug}>
            <Link href={`/${workspace}/${m.slug}`} className="flex h-full flex-col gap-2 rounded-2xl border border-line bg-card p-5 hover:border-brand">
              <span className="font-display text-lg font-semibold">{m.title}</span>
              <span className="text-sm text-muted">{m.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
