'use client';

import React, { useEffect, useState } from 'react';
import { API_URL, DEMO_MODE } from '@/lib/session';
import { api, fmtDateTime, lpa, useAction, useApi } from '@/lib/api';
import { Button, Card, ErrorBox, Loading, Notice, PageHeader, Stat, Table, Td } from '../ui';

const KIND: Record<string, string> = { offer_accepted: 'Placement', rule_published: 'Rules published', decisions_published: 'Decisions published' };

/** The college's own view of its placement ledger, with the checks an auditor would run. */
export function TrustLedger() {
  const led = useApi('/api/v2/tpo/ledger');
  const act = useAction();
  const [report, setReport] = useState<any>(null);
  const [sample, setSample] = useState<any>(null);
  const [tampered, setTampered] = useState<any>(null);
  // The demo buttons act on one fixed demo college, so they are offered only when that college's ledger is the one on screen.
  const [demoOrg, setDemoOrg] = useState<string | null>(null);
  useEffect(() => {
    if (!DEMO_MODE) return;
    fetch(`${API_URL}/api/demo/ledger`, { cache: 'no-store' }).then(r => r.json()).then(j => setDemoOrg(j.orgId ?? null)).catch(() => setDemoOrg(null));
  }, []);
  if (led.error) return <ErrorBox error={led.error} />;
  if (!led.data) return <Loading />;
  const d = led.data;
  const total = d.verifiedPlacements + d.collegeRecordedPlacements;
  const publicUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/ledger/${d.orgId}`;

  const verify = async () => { const r = await act.run(() => api('/api/v2/tpo/ledger/verify', { method: 'POST' })); if (r) setReport(r); };
  const audit = async () => { const r = await act.run(() => api('/api/v2/tpo/ledger/audit', { body: { k: 5 } })); if (r) setSample(r); };
  const witnessNote = 'The college auditing itself is the weakest form. The witnessing university can run the same audit with its own seed from its Ledger Witness page.';
  const demo = async (what: 'tamper' | 'rewrite' | 'restore') => {
    const res = await act.run(async () => (await fetch(`${API_URL}/api/demo/ledger/${what}`, { method: 'POST' })).json());
    if (res) { setTampered(what === 'restore' ? null : { ...res, what }); setSample(null); await verify(); led.reload(); }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Trust" title="Trust Ledger">
        Every placement here needs a recruiter’s signature and the student’s signature. Every published rule and batch of decisions is added to the same log. Anyone can check the log without trusting this college.
      </PageHeader>
      <ErrorBox error={act.error} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Verified placements" value={d.verifiedPlacements} sub="signed by the recruiter and the student" />
        <Stat label="Recorded by the college only" value={d.collegeRecordedPlacements} sub="no signatures, so not verifiable" />
        <Stat label="Entries in the log" value={d.head?.size ?? 0} sub={d.head ? `signed ${fmtDateTime(d.head.signedAt)}` : 'nothing yet'} />
      </div>
      {total > 0 && <Notice>{d.verifiedPlacements} of {total} placements can be proved by anyone. The other {d.collegeRecordedPlacements} are only the college’s word, and reports label them that way.</Notice>}

      <Card title="Check the log">
        <p className="text-sm text-muted">
          The public page lets anyone rebuild the log from published fingerprints and compare it with what the log operator signed. Share it with auditors, recruiters and students:
        </p>
        <p className="mt-1 break-all rounded bg-paper p-2 font-mono text-xs">{publicUrl}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button busy={act.busy} onClick={verify}>Check the whole log</Button>
          <Button kind="secondary" busy={act.busy} disabled={d.verifiedPlacements === 0} onClick={audit}>Audit 5 random placements</Button>
        </div>
        {report && (
          <div className="mt-3">
            <Notice tone={report.valid ? 'success' : 'warn'}>
              {report.valid
                ? `All ${report.entries} entries, ${report.checkpoints} signed checkpoints and ${report.offersChecked} placement signatures check out. ${report.witnessed ? `The university witnessed ${report.witnessed} state${report.witnessed === 1 ? '' : 's'} and they still match.` : 'No university has witnessed this log yet.'}`
                : `The log has been altered. ${report.problems.length} problem(s) found.`}
            </Notice>
            {!report.valid && (
              <ul className="mt-2 list-disc pl-5 text-sm text-red-800">
                {report.problems.map((p: any, i: number) => <li key={i}>{p.seq ? `Entry ${p.seq}: ` : ''}{p.text}</li>)}
              </ul>
            )}
          </div>
        )}
        {sample && (
          <div className="mt-3">
            <p className="text-sm text-muted">{sample.sample.length} of {sample.population} placements picked from seed <span className="font-mono">{sample.seed}</span> and the signed root <span className="font-mono">{String(sample.treeRoot).slice(0, 12)}…</span>. Names are never stored. {witnessNote}</p>
            <Table head={['Entry', 'Company', 'Role', 'CTC', 'Recruiter key', 'Recruiter', 'Student']}>
              {sample.sample.map((s: any) => (
                <tr key={s.seq}>
                  <Td className="tabular-nums">{s.seq}</Td><Td>{s.company}</Td><Td>{s.role}</Td><Td>{lpa(s.ctcInr)}</Td>
                  <Td><span className="font-mono text-xs">{s.recruiterKeyId}</span></Td>
                  <Td className={s.recruiterSignatureValid ? '' : 'font-semibold text-red-700'}>{s.recruiterSignatureValid ? 'Signature valid' : 'Signature does not match'}</Td>
                  <Td className={s.studentSignatureValid ? '' : 'font-semibold text-red-700'}>{s.studentSignatureValid ? 'Signature valid' : 'Signature does not match'}</Td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>

      {DEMO_MODE && demoOrg === d.orgId && (
        <Card title="Demo: a dishonest insider">
          <p className="text-sm text-muted">
            Two ways to cheat. First: someone with database access triples one salary and recomputes that entry’s fingerprint (the recruiter’s signature gives it away). Second: whoever runs the log rewrites a committed batch of decisions and signs the log again with the log’s signing key (the university’s witness signature gives it away). These buttons exist only in the demo.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button kind="danger" busy={act.busy} disabled={!!tampered} onClick={() => demo('tamper')}>Change one salary in the database</Button>
            <Button kind="danger" busy={act.busy} disabled={!!tampered} onClick={() => demo('rewrite')}>Rewrite history and sign it again</Button>
            <Button kind="secondary" busy={act.busy} disabled={!tampered} onClick={() => demo('restore')}>Put it back</Button>
          </div>
          {tampered?.what === 'tamper' && <p className="mt-2 text-sm">Entry {tampered.seq}: salary changed from {lpa(tampered.was)} to {lpa(tampered.now)}. The result of the check is shown above.</p>}
          {tampered?.what === 'rewrite' && <p className="mt-2 text-sm">Entry {tampered.seq}, a committed batch of decisions, was rewritten and every affected checkpoint was signed again with the log’s signing key. The log’s own signature checks pass. Only the university’s earlier witness signature gives it away.</p>}
        </Card>
      )}

      <Card title="Latest entries">
        <Table head={['#', 'What', 'Details', 'Fingerprint', 'When']}>
          {d.entries.map((e: any) => (
            <tr key={e.seq}><Td className="tabular-nums">{e.seq}</Td><Td>{KIND[e.kind] ?? e.kind}</Td><Td>{e.summary}</Td><Td><span className="font-mono text-xs">{e.leafHash}</span></Td><Td>{fmtDateTime(e.at)}</Td></tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
