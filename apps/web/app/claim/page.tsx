'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { authConfigured, DEMO_MODE, fetchMe, GITHUB_SIGNIN, signInWithGitHub, supabase } from '@/lib/session';
import { Cta } from '@/components/Cta';

const KEY = 'pramaan_claim_token';
const mem = {
  get() { try { return window.sessionStorage.getItem(KEY); } catch { return null; } },
  set(v: string | null) { try { if (v === null) window.sessionStorage.removeItem(KEY); else window.sessionStorage.setItem(KEY, v); } catch { /* private window */ } },
};

/**
 * Where an invitation link lands. The link's token is in the URL fragment (never sent to a server). We keep it for this tab only,
 * take it out of the address bar, ask the person to sign in, and then exchange it for their college record.
 */
export default function ClaimPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<string | null | undefined>(undefined); // email, null = signed out, undefined = checking
  const [mode, setMode] = useState<'in' | 'up'>('up');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    const m = /[#&]t=([A-Za-z0-9_-]+)/.exec(window.location.hash);
    if (m) { mem.set(m[1]); window.history.replaceState(null, '', window.location.pathname); }
    setToken(mem.get());
    if (!authConfigured) { setSignedIn(null); return; }
    supabase().auth.getSession().then(({ data }) => setSignedIn(data.session?.user.email ?? null));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    const auth = supabase().auth;
    const res = mode === 'up' ? await auth.signUp({ email, password }) : await auth.signInWithPassword({ email, password });
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    if (res.data.session) { setSignedIn(res.data.session.user.email ?? email); return; }
    setInfo('Check your email and confirm your address. Then open your invitation link again.');
  }

  async function join() {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ workspace: string }>('/api/auth/claim', { body: { token } });
      mem.set(null);
      await fetchMe(true);
      router.replace(`/${r.workspace}`);
    } catch (e: any) { setError(e.message); setBusy(false); }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-16">
      <div>
        <Link href="/" className="font-display text-2xl font-bold">PRAMAAN</Link>
        <h1 className="mt-6 font-display text-3xl font-semibold">Join your college</h1>
        <p className="mt-2 text-muted">Your placement office invited you. Sign in, then confirm to join.</p>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-600/40 bg-red-600/10 p-3 text-sm">{error}</p>}
      {info && <p role="status" className="rounded-lg border border-brand/30 bg-brand/10 p-3 text-sm">{info}</p>}

      {DEMO_MODE && <p className="rounded-2xl border border-line bg-card p-5 text-sm text-muted">The offline demo has no real sign-in, so invitations cannot be claimed here. Run the site with the Supabase keys to try it.</p>}
      {!DEMO_MODE && !authConfigured && <p className="rounded-2xl border border-line bg-card p-5 text-sm text-muted">Sign-in is not set up on this site yet.</p>}

      {!DEMO_MODE && authConfigured && !token && (
        <p className="rounded-2xl border border-line bg-card p-5 text-sm">This page needs the invitation link from your email. Open that link again. If it does not work, ask your placement office to send a new one.</p>
      )}

      {!DEMO_MODE && authConfigured && token && signedIn === null && (
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-6">
          <div className="flex gap-2 text-sm" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'up'} onClick={() => setMode('up')} className={`rounded-full px-3 py-1 ${mode === 'up' ? 'bg-ink text-paper' : 'border border-line'}`}>Create account</button>
            <button type="button" role="tab" aria-selected={mode === 'in'} onClick={() => setMode('in')} className={`rounded-full px-3 py-1 ${mode === 'in' ? 'bg-ink text-paper' : 'border border-line'}`}>I have an account</button>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Email (use the address the invitation was sent to)
            <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-2 text-base font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Password
            <input type="password" required minLength={8} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-2 text-base font-normal" />
          </label>
          <Cta type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'up' ? 'Create account' : 'Sign in'}</Cta>
          {GITHUB_SIGNIN && (
            <>
              <p className="text-center text-xs text-muted">or</p>
              <button type="button" onClick={async () => { setError(await signInWithGitHub('/claim')); }} className="rounded-[14px] border border-line bg-white px-4 py-2.5 text-sm font-medium hover:border-brand">Continue with GitHub</button>
              <p className="text-xs text-muted">With GitHub you do not need to use your college email: the invitation link already proves it is you.</p>
            </>
          )}
        </form>
      )}

      {!DEMO_MODE && authConfigured && token && typeof signedIn === 'string' && (
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-6">
          <p className="text-sm">Signed in as <b>{signedIn}</b>.</p>
          <Cta onClick={join} disabled={busy}>{busy ? 'Joining…' : 'Join my college'}</Cta>
          <button type="button" className="text-sm text-muted underline" onClick={async () => { await supabase().auth.signOut(); setSignedIn(null); }}>Use a different account</button>
        </div>
      )}
    </main>
  );
}
