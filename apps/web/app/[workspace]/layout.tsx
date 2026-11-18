import { notFound } from 'next/navigation';
import React from 'react';
import { WorkspaceShell } from '@/components/WorkspaceShell';
import { isWorkspaceKey } from '@/lib/workspaces';

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  if (!isWorkspaceKey(workspace)) notFound();
  return <WorkspaceShell workspace={workspace}>{children}</WorkspaceShell>;
}
