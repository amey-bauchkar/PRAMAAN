'use client';

import React, { useState } from 'react';
import { API_URL } from '@/lib/session';
import { api, fmtDateTime, lpa, useAction, useApi } from '@/lib/api';
import { merkleRoot, rememberState, rememberedState, signText, signingKeyFor, verifyCheckpointSignature, verifyConsistency, witnessTextOf } from '@/lib/ledger';
import { Button, Card, ErrorBox, Field, inputCls, Loading, Notice, PageHeader, Table, Td } from '../ui';
import { useMe } from '../WorkspaceShell';

const nostore = { cache: 'no-store' as const };

/**
 * The witness checks the log in its own browser from the public data, and only then signs, with its own clock.
 * It does not take the platform's word that the log is consistent.
 */
async function checkBeforeSigning(userId: string, collegeId: string): Promise<{ checkpoint: any; lines: string[] }> {
  const head = await fetch(`${API_URL}/api/public/ledger/${collegeId}`, nostore).then(r => r.json());
  const cp = head.checkpoint;
  const { leaves } = await fetch(`${API_URL}/api/public/ledger/${collegeId}/leaves`, nostore).then(r => r.json());
  const hashes: string[] = leaves.map((l: any) => l.leafHash);
  const lines: string[] = [];
  const local = await merkleRoot(hashes.slice(0, cp.size));
  if (hashes.length < cp.size || local !== cp.root) throw new Error('The published fingerprints do not rebuild the root the log operator signed. Do not sign.');
  lines.push(`Rebuilt the tree from ${cp.size} published fingerprints: it matches the root the log operator signed.`);
  if (head.issuerPublicKeyPem) {
    const ok = await verifyCheckpointSignature(cp, head.issuerPublicKeyPem);
    if (ok === false) throw new Error('The log operator’s signature on this state is not valid. Do not sign.');
    lines.push(ok ? 'The log operator’s signature on this state is valid.' : 'This browser cannot check the log operator’s Ed25519 signature.');
  }
  const seen = await rememberedState(userId, head.origin);
  if (seen) {
    if (seen.size > cp.size) throw new Error(`The log has fewer entries (${cp.size}) than the ${seen.size} you witnessed before. Entries were removed. Do not sign.`);
    const c = await fetch(`${API_URL}/api/public/ledger/${collegeId}/consistency?from=${seen.size}&to=${cp.size}`, nostore).then(r => r.json());
    if (!c.proof || !(await verifyConsistency(seen.size, cp.size, seen.root, local, c.proof))) {
      throw new Error(`The log no longer matches the state of ${seen.size} entries this browser saw when you last witnessed it. History was rewritten. Do not sign.`);
    }
    lines.push(`Checked in this browser: the log only grew since the ${seen.size} entries you witnessed last time.`);
  } else lines.push('First time in this browser: earlier witnessing is only known from the platform. From now on this browser keeps its own record.');
  return { checkpoint: cp, lines };
}

/** The university signs each college's placement log with a key the log operator does not hold, and can audit a sample itself. */
export function Witness() {
  const me = useMe();
  const data = useApi('/api/v2/university/witness');
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [checks, setChecks] = useState<string[] | null>(null);
  const [audit, setAudit] = useState<any>(null);
  const [seed, setSeed] = useState('');
  if (!me) return null;
  if (data.error) return <ErrorBox error={data.error} />;
  if (!data.data) return <Loading />;

  const witness = async (collegeId: string) => {
    setMsg(null); setChecks(null);
    const r = await act.run(async () => {
      const key = await signingKeyFor(me.userId);
      await api('/api/v2/university/witness/key', { body: { publicJwk: key.publicJwk } });
      const server = await api('/api/v2/university/witness/prepare', { body: { collegeId, keyId: key.keyId } });
      const mine = await checkBeforeSigning(me.userId, collegeId);
      if (mine.checkpoint.size !== server.checkpoint.size || mine.checkpoint.root !== server.checkpoint.root) throw new Error('The platform and the public data disagree about the newest state. Do not sign.');
      setChecks(mine.lines);
      const at = new Date().toISOString();
      const res = await api('/api/v2/university/witness/cosign', { body: { collegeId, size: mine.checkpoint.size, root: mine.checkpoint.root, keyId: key.keyId, at, signature: await signText(key, witnessTextOf(mine.checkpoint, key.keyId, at)) } });
      await rememberState(me.userId, mine.checkpoint.origin, { size: mine.checkpoint.size, root: mine.checkpoint.root });
      return res;
    });
    if (r) { setMsg(r.message); data.reload(); }
  };

  const runAudit = async (collegeId: string) => {
    const s = seed.trim() || Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
    const r = await act.run(() => api('/api/v2/university/witness/audit', { body: { collegeId, seed: s, k: 5 } }));
    if (r) setAudit(r);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Trust" title="Ledger Witness">
        The log operator signs each college’s placement log. You sign it too, with a key the operator does not have. Once you have signed a state, a rewrite of those entries shows up as a mismatch, even if the operator signs the log again. You can also audit a sample of a college’s placements yourself.
      </PageHeader>
      {msg && <Notice tone="success">{msg}</Notice>}
      {checks && <Notice><ul className="list-disc pl-5">{checks.map(c => <li key={c}>{c}</li>)}</ul></Notice>}
      {act.error && <Notice tone="warn">{act.error}</Notice>}
      <Card title="Colleges">
        <p className="mb-3 text-sm text-muted">
          Before you sign, your own browser rebuilds the log from the public fingerprints and checks it against what this browser saw last time. The platform’s check is only a second opinion. If the log was rewritten, signing is refused.
        </p>
        {data.data.colleges.length === 0 ? <p className="text-sm text-muted">No college under your university has a ledger yet.</p> : (
          <Table head={['College', 'Entries in the log', 'Last witnessed', '']}>
            {data.data.colleges.map((c: any) => (
              <tr key={c.collegeId}>
                <Td>{c.name}<span className="block text-xs text-muted">signed {fmtDateTime(c.signedAt)}</span></Td>
                <Td className="tabular-nums">{c.size}</Td>
                <Td>{c.witnessedSize ? `${c.witnessedSize} entries · ${fmtDateTime(c.witnessedAt)}` : 'Never'}{c.upToDate ? ' · up to date' : ''}</Td>
                <Td>
                  <span className="flex flex-wrap gap-2">
                    <Button busy={act.busy} disabled={c.upToDate} onClick={() => witness(c.collegeId)}>{c.upToDate ? 'Witnessed' : 'Witness newest state'}</Button>
                    <Button kind="secondary" busy={act.busy} onClick={() => runAudit(c.collegeId)}>Audit 5 placements</Button>
                  </span>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Audit seed">
        <Field label="Your seed (optional)" hint="Pick it yourself after the college has published its signed state. Leave it empty for a random one. Anyone with the seed and the root can pick the same entries.">
          <input className={inputCls} value={seed} onChange={e => setSeed(e.target.value)} />
        </Field>
      </Card>

      {audit && (
        <Card title={`Audit of ${audit.college}`}>
          <p className="text-sm text-muted">{audit.sample.length} of {audit.population} placements. Seed <span className="font-mono">{audit.seed}</span>, signed root <span className="font-mono">{String(audit.treeRoot).slice(0, 16)}…</span> ({audit.treeSize} entries). {audit.method}</p>
          <p className="mt-1 text-sm">{audit.note}</p>
          <Table head={['Entry', 'Company', 'Role', 'CTC', 'Recruiter key', 'Key registered', 'Recruiter', 'Student']}>
            {audit.sample.map((s: any) => (
              <tr key={s.seq}>
                <Td className="tabular-nums">{s.seq}</Td><Td>{s.company}</Td><Td>{s.role}</Td><Td>{lpa(s.ctcInr)}</Td>
                <Td><span className="font-mono text-xs">{s.recruiterKeyId}</span></Td>
                <Td>{s.recruiterKeyRegisteredAt ? fmtDateTime(s.recruiterKeyRegisteredAt) : 'unknown'}</Td>
                <Td className={s.recruiterSignatureValid ? '' : 'font-semibold text-red-700'}>{s.recruiterSignatureValid ? 'Signature valid' : 'Does not match'}</Td>
                <Td className={s.studentSignatureValid ? '' : 'font-semibold text-red-700'}>{s.studentSignatureValid ? 'Signature valid' : 'Does not match'}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <ErrorBox error={null} />
    </div>
  );
}
