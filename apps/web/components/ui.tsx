'use client';

import Link from 'next/link';
import React from 'react';
import { Cta } from '@/components/Cta';

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow?.replace(/^[A-Z]{2}-\d+( · )?/, '') && <p className="text-xs font-semibold uppercase tracking-wider text-brand">{eyebrow.replace(/^[A-Z]{2}-\d+( · )?/, '')}</p>}
        <h1 className="mt-1 font-display text-4xl sm:text-5xl">{title}</h1>
        {children && <div className="mt-2 text-muted">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = '', actions }: { title?: React.ReactNode; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={`rounded-3xl border border-line bg-card p-6 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-display text-xl">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnKind = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({ kind = 'primary', busy, children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind; busy?: boolean }) {
  const styles: Record<BtnKind, string> = {
    primary: '',
    secondary: 'border border-line bg-card hover:border-brand',
    danger: 'border border-red-600 text-red-700 hover:bg-red-600/10 dark:text-red-300',
    ghost: 'text-brand hover:underline',
  };
  if (kind === 'primary') return <Cta {...rest} disabled={busy || rest.disabled} className={className}>{busy ? 'Working…' : children}</Cta>;
  return (
    <button {...rest} disabled={busy || rest.disabled} className={`inline-flex items-center justify-center gap-2 rounded-[14px] px-5 py-2.5 text-sm font-medium disabled:opacity-60 ${styles[kind]} ${className}`}>
      {busy ? 'Working…' : children}
    </button>
  );
}

export function LinkButton({ href, children, kind = 'secondary' }: { href: string; children: React.ReactNode; kind?: 'primary' | 'secondary' }) {
  if (kind === 'primary') return <Cta href={href}>{children}</Cta>;
  return (
    <Link href={href} className="inline-flex items-center rounded-[14px] border border-line bg-white px-5 py-2.5 text-sm font-medium hover:border-brand">{children}</Link>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-line bg-card p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-4xl tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <p className="py-10 text-center text-muted" aria-busy="true">{what}…</p>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <p role="alert" className="rounded-lg border border-red-600/40 bg-red-600/10 p-3 text-sm text-red-800 dark:text-red-200">{error}</p>;
}

export function Notice({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'success' | 'warn' }) {
  const t = { info: 'border-brand/30 bg-brand/10', success: 'border-ink/20 bg-ink/5', warn: 'border-accent bg-accent/15' }[tone];
  return <div role="status" className={`rounded-lg border p-3 text-sm ${t}`}>{children}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">{children}</p>;
}

/** Skill state badge: the word is always shown, colour is secondary. */
export function StateBadge({ state }: { state: string }) {
  const map: Record<string, [string, string]> = {
    claimed: ['Claimed', 'border border-line text-muted'],
    observed: ['Signal found', 'border border-brand/40 text-brand'],
    evidence_linked: ['Evidence added', 'bg-brand/15 text-brand'],
    verified: ['Verified', 'bg-ink text-white'],
    expired: ['Expired', 'bg-accent text-[#14162E]'],
    missing: ['Not on profile', 'border border-dashed border-line text-muted'],
  };
  const [label, cls] = map[state] ?? [state, 'border border-line'];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

export const PROOF_LABEL: Record<string, string> = {
  L1_code_backed: 'Level 1 · Code found', L2_assessed: 'Level 2 · Tested', L3_defended: 'Level 3 · Explained', L3_attested: 'Level 3 · Mentor approved',
};
export function ProofBadge({ level }: { level?: string | null }) {
  if (!level) return null;
  return <span className="inline-flex whitespace-nowrap rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold">{PROOF_LABEL[level] ?? level}</span>;
}

export function ResultBadge({ result }: { result: string }) {
  const map: Record<string, [string, string]> = {
    eligible: ['Eligible', 'bg-ink text-white'],
    ineligible: ['Not eligible', 'border border-red-600 text-red-700 dark:text-red-300'],
    needs_review: ['Needs review', 'bg-accent text-[#14162E]'],
  };
  const [l, c] = map[result] ?? [result, 'border border-line'];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${c}`}>{l}</span>;
}

export function CheckLine({ passed, children }: { passed: boolean | null; children: React.ReactNode }) {
  const [label, cls] = passed === true ? ['Pass', 'text-ink'] : passed === false ? ['Fail', 'text-red-700 dark:text-red-300'] : ['Review', 'text-amber-700 dark:text-amber-300'];
  return (
    <li className="flex gap-3 py-1.5 text-sm">
      <span className={`w-14 shrink-0 font-semibold ${cls}`}>{label}</span>
      <span>{children}</span>
    </li>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = 'rounded-lg border border-line bg-paper px-3 py-2 text-base font-normal';

export function Table({ head, children, caption }: { head: React.ReactNode[]; children: React.ReactNode; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead><tr className="border-b border-line text-muted">{head.map((h, i) => <th key={i} className="px-2 py-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <td className={`border-b border-line/60 px-2 py-2 align-top ${className}`}>{children}</td>;
