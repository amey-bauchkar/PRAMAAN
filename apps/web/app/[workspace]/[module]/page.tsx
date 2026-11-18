import { notFound } from 'next/navigation';
import React from 'react';
import { isWorkspaceKey, WORKSPACES } from '@/lib/workspaces';
import { ModuleView } from '@/components/ModuleView';

export default async function ModulePage({ params }: { params: Promise<{ workspace: string; module: string }> }) {
  const { workspace, module } = await params;
  if (!isWorkspaceKey(workspace) || !WORKSPACES[workspace].modules.some(m => m.slug === module)) notFound();
  return <ModuleView workspace={workspace} module={module} />;
}
