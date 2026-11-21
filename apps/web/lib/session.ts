'use client';

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceKey } from './workspaces';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

/**
 * Demo mode signs in as a synthetic persona against the offline demo API (npm run demo).
 * It is a separate API process with simulated sign-in; it never talks to Supabase.
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
export const authConfigured = !DEMO_MODE && SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';
export const signInAvailable = DEMO_MODE || authConfigured;

const store = {
  get(k: string) { try { return window.sessionStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v === null) window.sessionStorage.removeItem(k); else window.sessionStorage.setItem(k, v); } catch {} },
};

/** Shown only once GitHub is switched on in Supabase (see docs/PLAN_REAL_AUTH_GITHUB_VERCEL.md). */
export const GITHUB_SIGNIN = process.env.NEXT_PUBLIC_GITHUB_SIGNIN === 'true';

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!authConfigured) throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    // Supabase hands over the GitHub access token only at the moment of sign-in and never refreshes it. Keep it for this tab only,
    // so a recruiter's scans use their own GitHub request limit. It has the read:user scope only and is never stored on our servers.
    client.auth.onAuthStateChange((_event, session) => {
      const gh = session?.provider_token;
      if (gh && session?.user?.identities?.some(i => i.provider === 'github')) store.set('pramaan_github_token', gh);
    });
  }
  return client;
}

/** The GitHub token from this tab's GitHub sign-in, if any. */
export function githubToken(): string | null { return store.get('pramaan_github_token'); }

/** Starts GitHub sign-in and comes back to `returnPath`. Returns an error message, or null when the redirect has started. */
export async function signInWithGitHub(returnPath: string): Promise<string | null> {
  const { error } = await supabase().auth.signInWithOAuth({ provider: 'github', options: { redirectTo: `${window.location.origin}${returnPath}`, scopes: 'read:user' } });
  return error ? (/provider is not enabled|Unsupported provider/i.test(error.message) ? 'GitHub sign-in is not switched on for this site yet.' : error.message) : null;
}

export interface Me { userId: string; orgId: string; role: string; workspace: WorkspaceKey }


export async function accessToken(): Promise<string | null> {
  if (DEMO_MODE) return store.get('pramaan_session_token');
  if (!authConfigured) return null;
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token ?? null;
  store.set('pramaan_session_token', token);
  return token;
}

export async function demoSignIn(persona: string): Promise<Me | null> {
  const res = await fetch(`${API_URL}/api/demo/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ persona }) });
  if (!res.ok) return null;
  store.set('pramaan_session_token', (await res.json()).token);
  return fetchMe();
}

let meCache: Me | null = null;
export async function fetchMe(force = false): Promise<Me | null> {
  if (meCache && !force) return meCache;
  const token = await accessToken();
  if (!token) return null;
  const res = await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  meCache = (await res.json()) as Me;
  store.set('pramaan_org_id', meCache.orgId);
  return meCache;
}

export async function signOut(): Promise<void> {
  meCache = null;
  store.set('pramaan_session_token', null);
  store.set('pramaan_org_id', null);
  store.set('pramaan_github_token', null);
  if (authConfigured) await supabase().auth.signOut();
}
