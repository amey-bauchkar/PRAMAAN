'use client';

import React, { useState } from 'react';

/*
 * Chart colours follow the dataviz reference palette (validated): sequential blue ramp for magnitude,
 * categorical blue/orange for two series. Text always uses text tokens, never series colours.
 */
const SEQ = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];

function seqColor(pct: number) {
  const i = Math.min(SEQ.length - 1, Math.max(0, Math.round((pct / 100) * (SEQ.length - 1))));
  return { bg: SEQ[i], fg: i >= 6 ? '#ffffff' : '#0b0b0b' };
}

interface Tip { x: number; y: number; text: string }
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const bind = (text: string) => ({
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, text }),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => { const r = (e.target as HTMLElement).getBoundingClientRect(); setTip({ x: r.left + r.width / 2, y: r.top, text }); },
    onBlur: () => setTip(null),
  });
  const node = tip ? (
    <div role="tooltip" className="pointer-events-none fixed z-50 max-w-xs -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-card px-3 py-2 text-xs shadow-lg" style={{ left: tip.x, top: tip.y - 10 }}>
      {tip.text}
    </div>
  ) : null;
  return { bind, node };
}

/** Skill × branch heatmap: share of each branch's students with the skill Verified. */
export function Heatmap({ rows, columns }: { rows: { label: string; cells: { column: string; percent: number; detail: string; dimmed?: boolean }[] }[]; columns: string[] }) {
  const { bind, node } = useTip();
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid min-w-full gap-0.5" style={{ gridTemplateColumns: `minmax(130px, 1.4fr) repeat(${columns.length}, minmax(64px, 1fr))` }} role="table" aria-label="Verified skill heatmap">
        <div role="columnheader" />
        {columns.map(c => <div key={c} role="columnheader" className="px-1 pb-1 text-center text-xs font-semibold text-muted">{c}</div>)}
        {rows.map(r => (
          <React.Fragment key={r.label}>
            <div role="rowheader" className="flex items-center pr-2 text-sm">{r.label}</div>
            {r.cells.map(c => {
              const col = seqColor(c.percent);
              return (
                <div key={c.column} role="cell" tabIndex={0} {...bind(c.detail)} aria-label={c.detail}
                  className={`flex h-10 items-center justify-center rounded text-xs font-semibold tabular-nums ${c.dimmed ? 'opacity-40' : ''}`}
                  style={{ background: col.bg, color: col.fg }}>
                  {c.percent.toFixed(0)}%
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted" aria-hidden="true">
        <span>0%</span>
        <div className="h-2 w-40 rounded" style={{ background: `linear-gradient(to right, ${SEQ[0]}, ${SEQ[SEQ.length - 1]})` }} />
        <span>100% of students Verified</span>
      </div>
      {node}
    </div>
  );
}

/** Horizontal bars for one series; the label carries the value as text. */
export function BarList({ items, max = 100, unit = '%' }: { items: { label: string; value: number; detail?: string }[]; max?: number; unit?: string }) {
  const { bind, node } = useTip();
  return (
    <ul className="flex flex-col gap-2">
      {items.map(i => (
        <li key={i.label} className="grid grid-cols-[minmax(110px,1fr)_3fr_auto] items-center gap-3 text-sm" tabIndex={0} {...bind(i.detail ?? `${i.label}: ${i.value}${unit}`)}>
          <span className="truncate">{i.label}</span>
          <span className="h-3 rounded-r bg-line/40">
            <span className="block h-3 rounded-r" style={{ width: `${Math.max(1, Math.min(100, (i.value / max) * 100))}%`, background: 'var(--series-1, #2a78d6)' }} />
          </span>
          <span className="w-14 text-right tabular-nums">{i.value}{unit}</span>
        </li>
      ))}
      {node}
    </ul>
  );
}

/** Two series per row (e.g. job demand vs. cohort supply). Legend always shown; values as text. */
export function PairedBars({ rows, a, b }: { rows: { label: string; a: number; b: number; detail?: string }[]; a: string; b: string }) {
  const { bind, node } = useTip();
  return (
    <div className="viz-root">
      <div className="mb-3 flex gap-4 text-xs" aria-label="Legend">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--series-1)' }} />{a}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--series-2)' }} />{b}</span>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map(r => (
          <li key={r.label} tabIndex={0} {...bind(r.detail ?? `${r.label}: ${a} ${r.a}%, ${b} ${r.b}%`)} className="grid grid-cols-[minmax(110px,1fr)_3fr_auto] items-center gap-3 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="flex flex-col gap-0.5">
              <span className="block h-2.5 rounded-r" style={{ width: `${Math.max(1, r.a)}%`, background: 'var(--series-1)' }} />
              <span className="block h-2.5 rounded-r" style={{ width: `${Math.max(1, r.b)}%`, background: 'var(--series-2)' }} />
            </span>
            <span className="w-24 text-right text-xs tabular-nums">{r.a}% · {r.b}%</span>
          </li>
        ))}
      </ul>
      {node}
    </div>
  );
}
