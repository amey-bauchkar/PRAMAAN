'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { API_URL, authConfigured, DEMO_MODE, demoSignIn, fetchMe, supabase } from '@/lib/session';
import { Cta } from '@/components/Cta';

interface Persona { key: string; label: string; role: string; workspace: string }

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Persona[] | null>(null);

  useEffect(() => {
    if (DEMO_MODE) {
      fetch(`${API_URL}/api/demo/personas`).then(r => r.json()).then(d => setPersonas(d.personas))
        .catch(() => setError(`The demo server is not running at ${API_URL}. Start it with: npm run demo`));
    }
    if (authConfigured || DEMO_MODE) fetchMe().then(me => { if (me) router.replace(`/${me.workspace}`); });
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy('form'); setError(null);
    const { error: err } = await supabase().auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); setBusy(null); return; }
    const me = await fetchMe(true);
    if (!me) { setError('You are signed in, but no college has added you yet. Ask your placement office to add this email address.'); setBusy(null); return; }
    router.replace(`/${me.workspace}`);
  }

  async function asPersona(key: string) {
    setBusy(key); setError(null);
    const me = await demoSignIn(key);
    if (!me) { setError('Demo sign-in failed. Is the demo server running?'); setBusy(null); return; }
    router.replace(`/${me.workspace}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-4 py-16">
      <div>
        <Link href="/" className="font-display text-2xl font-bold">PRAMAAN</Link>
        <h1 className="mt-6 font-display text-3xl font-semibold">Sign in</h1>
        <p className="mt-2 text-muted">{DEMO_MODE ? 'Choose a role to explore the demo. All people here are made up.' : 'Use the account your college placement office gave you.'}</p>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-600/40 bg-red-600/10 p-3 text-sm">{error}</p>}

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

      {!DEMO_MODE && !authConfigured && (
        <div className="rounded-2xl border border-line bg-card p-6 text-sm text-muted">
          Sign-in is not set up yet. For the offline demo, set <code>NEXT_PUBLIC_DEMO_MODE=true</code>. For a live site, add the Supabase keys to <code>apps/web/.env.local</code>.
        </div>
      )}
    </main>
  );
}
