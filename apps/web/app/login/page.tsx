'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { API_URL, authConfigured, DEMO_MODE, demoSignIn, fetchMe, GITHUB_SIGNIN, signInWithGitHub, supabase } from '@/lib/session';
import { Cta } from '@/components/Cta';

interface Persona { key: string; label: string; role: string; workspace: string }

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [ledgerOrg, setLedgerOrg] = useState<string | null>(null);

  useEffect(() => {
    if (DEMO_MODE) {
      fetch(`${API_URL}/api/demo/ledger`).then(r => r.json()).then(d => setLedgerOrg(d.orgId ?? null)).catch(() => undefined);
      fetch(`${API_URL}/api/demo/personas`).then(r => r.json()).then(d => setPersonas(d.personas))
        .catch(() => setError(`The demo server is not running at ${API_URL}. Start it with: npm run demo`));
    }
    if (authConfigured || DEMO_MODE) fetchMe().then(async me => {
      if (me) { router.replace(`/${me.workspace}`); return; }
      // Signed in (for example with GitHub) but no college record yet: say what to do instead of showing a blank form.
      if (authConfigured && (await supabase().auth.getSession()).data.session) setError('You are signed in, but no college has added you yet. Open the invitation link your placement office emailed you, or ask them to send a new one.');
    });
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy('form'); setError(null);
    const { error: err } = await supabase().auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); setBusy(null); return; }
    const me = await fetchMe(true);
    if (!me) { setError('You are signed in, but no college has added you yet. Open the invitation link your placement office emailed you, or ask them to send a new one.'); setBusy(null); return; }
    router.replace(`/${me.workspace}`);
  }

  async function asPersona(key: string, dest?: string) {
    setBusy(key); setError(null);
    const me = await demoSignIn(key);
    if (!me) { setError('Demo sign-in failed. Is the demo server running?'); setBusy(null); return; }
    router.replace(dest ?? `/${me.workspace}`);
  }

  const has = (key: string) => (personas ?? []).some(p => p.key === key);
  const candidate = (personas ?? []).find(p => p.key === 'candidate')?.label ?? 'the shortlisted student';
  const TOUR: { t: string; d: string; persona?: string; dest?: string }[] = [
    { t: 'See the placement ledger', d: 'A public page, no sign-in. Press the check button and your own browser verifies the log.' },
    { t: 'As the recruiter, sign an offer', d: `Neha Kapoor signs an offer for ${candidate} with a key that stays in her browser.`, persona: 'recruiter', dest: '/recruiter/pipeline' },
    { t: 'As the student, accept it', d: `${candidate} signs the acceptance and keeps a receipt that proves the placement.`, persona: 'candidate', dest: '/student/offers' },
    { t: 'As the officer, try to cheat and get caught', d: 'Change a salary in the database, or rewrite history and sign the log again. Then check the log and see what gives it away.', persona: 'tpo', dest: '/tpo/ledger' },
    { t: 'As a student, replay a decision', d: 'Re-run a stored eligibility decision on its saved inputs and rules. The result must match.', persona: 'rahul', dest: '/student/drives' },
  ];

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-4 py-16">
      <div>
        <Link href="/" className="font-display text-2xl font-bold">PRAMAAN</Link>
        <h1 className="mt-6 font-display text-3xl font-semibold">Sign in</h1>
        <p className="mt-2 text-muted">{DEMO_MODE ? 'Choose a role to explore the demo. All people here are made up.' : 'Sign in with your account. New here? Open the invitation link from your college email.'}</p>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-600/40 bg-red-600/10 p-3 text-sm">{error}</p>}

      {DEMO_MODE && (
        <section className="rounded-2xl border border-line bg-card p-5" aria-label="Guided demo">
          <h2 className="font-display text-xl">Five-minute tour</h2>
          <p className="mt-1 text-sm text-muted">Receipts, not claims: follow one placement from offer to receipt, then try to cheat.</p>
          <ol className="mt-3 flex flex-col gap-3">
            {TOUR.map((s, i) => (
              <li key={s.t} className="flex items-start justify-between gap-3">
                <span className="min-w-0 text-sm"><span className="font-semibold">{i + 1}. {s.t}</span><span className="block text-muted">{s.d}</span></span>
                {s.persona
                  ? <button type="button" disabled={!!busy || !has(s.persona)} onClick={() => asPersona(s.persona!, s.dest)} className="shrink-0 rounded-[14px] border border-line bg-white px-4 py-2 text-sm font-medium hover:border-brand disabled:opacity-50">{busy === s.persona ? 'Opening…' : 'Go'}</button>
                  : ledgerOrg ? <a href={`/ledger/${ledgerOrg}`} className="shrink-0 rounded-[14px] border border-line bg-white px-4 py-2 text-sm font-medium hover:border-brand">Go</a> : null}
              </li>
            ))}
          </ol>
        </section>
      )}

      {DEMO_MODE && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {(personas ?? []).map(p => (
            <li key={p.key}>
              <button type="button" onClick={() => asPersona(p.key)} disabled={!!busy}
                className="flex w-full flex-col items-start rounded-2xl border border-line bg-card p-4 text-left hover:border-brand disabled:opacity-60">
                <span className="font-display font-semibold">{p.label}</span>
                <span className="text-sm text-muted">{busy === p.key ? 'Signing in…' : p.role}</span>
              </button>
            </li>
          ))}
          {personas === null && !error && <li className="text-muted">Loading roles…</li>}
        </ul>
      )}

      {authConfigured && (
        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-6">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">College email
            <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-2 text-base font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Password
            <input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-2 text-base font-normal" />
          </label>
          <Cta type="submit" disabled={busy === 'form'}>{busy === 'form' ? 'Signing in…' : 'Sign in'}</Cta>
        </form>
      )}

      {authConfigured && GITHUB_SIGNIN && (
        <button type="button" onClick={async () => { setError(await signInWithGitHub('/login')); }} className="rounded-[14px] border border-line bg-white px-4 py-2.5 text-sm font-medium hover:border-brand">Continue with GitHub</button>
      )}

      {!DEMO_MODE && !authConfigured && (
        <div className="rounded-2xl border border-line bg-card p-6 text-sm text-muted">
          Sign-in is not set up yet. For the offline demo, set <code>NEXT_PUBLIC_DEMO_MODE=true</code>. For a live site, add the Supabase keys to <code>apps/web/.env.local</code>.
        </div>
      )}
    </main>
  );
}
