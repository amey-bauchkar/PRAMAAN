'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { DEMO_MODE, fetchMe, Me, signInAvailable, signOut } from '@/lib/session';
import { modulesFor, WORKSPACES, WorkspaceKey } from '@/lib/workspaces';

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

/**
 * Sidebar + header for one workspace, and a navigation gate that sends users to the workspace their
 * role maps to. Authorisation itself is enforced by the API and the database, never by this component.
 */
export function WorkspaceShell({ workspace, children }: { workspace: WorkspaceKey; children: React.ReactNode }) {
  const def = WORKSPACES[workspace];
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!signInAvailable) { router.replace('/login'); return; }
    let cancelled = false;
    fetchMe().then(m => {
      if (cancelled) return;
      if (!m) router.replace('/login');
      else if (m.workspace !== workspace) router.replace(`/${m.workspace}`);
      else setMe(m);
    });
    return () => { cancelled = true; };
  }, [router, workspace]);

  useEffect(() => setMenuOpen(false), [pathname]);

  if (!me) return <div className="flex min-h-screen items-center justify-center text-muted" aria-busy="true">Signing you in…</div>;

  const modules = modulesFor(workspace, me.role);
  const nav = (
    <nav aria-label={`${def.title} menu`} className="flex flex-col gap-1">
      <NavLink href={`/${workspace}`} active={pathname === `/${workspace}`}>Overview</NavLink>
      {modules.map(m => <NavLink key={m.slug} href={`/${workspace}/${m.slug}`} active={pathname.startsWith(`/${workspace}/${m.slug}`)}>{m.title}</NavLink>)}
    </nav>
  );

  return (
    <MeContext.Provider value={me}>
      <div className="min-h-screen">
        {DEMO_MODE && (
          <div className="no-print bg-accent px-4 py-1.5 text-center text-xs font-semibold text-[#14162E]">
            Demo mode: sample data and a simulated sign-in. No real students.
          </div>
        )}
        <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-4 bg-white/95 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <button type="button" className="rounded-md border border-line px-2 py-1 text-sm lg:hidden" aria-expanded={menuOpen} aria-controls="mobile-nav" onClick={() => setMenuOpen(o => !o)}>Menu</button>
            <Link href={`/${workspace}`} className="font-display text-2xl font-medium tracking-tight">PRAMAAN</Link>
            <span className="hidden pill-nav px-4 py-1.5 text-sm font-medium sm:inline">{def.title}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{me.role.replace('_', ' ')}</span>
            <button type="button" onClick={() => signOut().then(() => router.replace('/login'))} className="rounded-md border border-line px-3 py-1.5 font-semibold hover:border-brand">Sign out</button>
          </div>
        </header>
        {menuOpen && <div id="mobile-nav" className="no-print border-b border-line bg-card p-4 lg:hidden">{nav}</div>}
        <div className="mx-auto flex max-w-7xl gap-8 px-4 py-6 sm:px-6">
          <aside className="no-print hidden w-60 shrink-0 lg:block">{nav}</aside>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </MeContext.Provider>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={`flex items-center gap-2 rounded-[14px] px-3.5 py-2 text-sm font-medium ${active ? 'btn-brand' : 'hover:bg-black/5'}`}>
      {children}
    </Link>
  );
}
