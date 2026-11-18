import { notFound } from 'next/navigation';
import React from 'react';
import { isWorkspaceKey } from '@/lib/workspaces';
import { Overview } from '@/components/Overview';

export default async function WorkspaceOverview({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  if (!isWorkspaceKey(workspace)) notFound();
  return <Overview workspace={workspace} />;
}
