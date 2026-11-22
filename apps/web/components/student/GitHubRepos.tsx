'use client';

import React, { useState } from 'react';
import { api, useAction, useApi } from '@/lib/api';
import { Button, ErrorBox, Notice } from '../ui';

/** Connect GitHub, see the connected account, pick public repositories to share, and stop sharing. */
export function GitHubRepos({ onDone }: { onDone: () => void }) {
  const status = useApi('/api/integrations/github/status');
  const connected = !!status.data?.connected;
  const repos = useApi(connected ? '/api/integrations/github/repositories' : null);
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [busyRepo, setBusyRepo] = useState<string | null>(null);

  const connect = async () => {
    const r = await act.run(() => api('/api/integrations/github/connect'));
    const to = r?.url ?? r?.authorizeUrl;
    if (to) window.location.href = to;
  };
  const importRepo = async (owner: string, name: string, ref: string) => {
    setBusyRepo(name); setMsg(null);
    const r = await act.run(() => api('/api/evidence/repositories/ingest', { body: { owner, repo: name, ref } }));
    setBusyRepo(null);
    if (r) { setMsg(`Imported ${owner}/${name}. Add it as evidence below.`); onDone(); }
  };
  const disconnect = async () => {
    const r = await act.run(() => api('/api/integrations/github/connection', { method: 'DELETE' }));
    if (r) { setMsg('GitHub disconnected.'); status.reload(); }
  };

  if (!connected) {
    return (
      <>
        <ErrorBox error={act.error} />
        <Button className="mt-3" onClick={connect}>Connect GitHub</Button>
      </>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-3 text-sm">
      <p>Connected as <span className="font-semibold">{status.data.githubUsername}</span> (read-only, public repositories).</p>
      {msg && <Notice tone="success">{msg}</Notice>}
      <ErrorBox error={act.error} />
      {repos.error ? <ErrorBox error={repos.error} /> : !repos.data ? <p className="text-muted">Loading your repositories…</p> : repos.data.repositories.length === 0 ? <p className="text-muted">No public repositories found.</p> : (
        <ul className="flex max-h-72 flex-col gap-2 overflow-auto">
          {repos.data.repositories.map((r: any) => (
            <li key={r.name} className="flex items-center justify-between gap-3 rounded border border-line p-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{r.name}{r.language ? <span className="ml-2 text-xs font-normal text-muted">{r.language}</span> : null}</p>
                {r.description && <p className="truncate text-xs text-muted">{r.description}</p>}
              </div>
              <Button busy={busyRepo === r.name} onClick={() => importRepo(r.owner, r.name, r.defaultBranch)}>Share</Button>
            </li>
          ))}
        </ul>
      )}
      <div><Button onClick={disconnect}>Disconnect GitHub</Button></div>
    </div>
  );
}
