'use client';

import React, { useEffect, useState } from 'react';
import { TileSphere } from './TileSphere';

const NODES = [
  { t: 'Eligibility rules', done: 'Latest rules applied' },
  { t: 'Fairness check', done: 'Checked for fairness' },
  { t: 'Next step', done: 'Best next step found' },
  { t: 'Eligibility Pass', done: 'Pass issued' },
  { t: 'Reasons', done: 'Shown in Marathi' },
  { t: 'Consent', done: 'Student’s consent saved' },
];

/** A sphere wired to the steps of one eligibility decision. One step lights up at a time. */
export function DecisionFlow() {
  const [active, setActive] = useState(2);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setActive(a => (a + 1) % NODES.length), 2400);
    return () => clearInterval(id);
  }, []);
  const n = NODES.length;
  const y = (i: number) => ((i + 0.5) / n) * 100;

  return (
    <div className="relative mx-auto grid max-w-5xl items-center gap-8 md:grid-cols-[1fr_1fr]">
      <div className="relative">
        <TileSphere count={700} maxDpr={1.25} color="#e6dccd" light="#ffffff" className="mx-auto aspect-square w-full max-w-[420px]" />
      </div>
      <div className="relative">
        <svg className="pointer-events-none absolute -left-[22%] top-0 hidden h-full w-[24%] md:block" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {NODES.map((_, i) => {
            const sy = 50 + (i - (n - 1) / 2) * 7;
            return <path key={i} d={`M 0 ${sy} C 55 ${sy}, 45 ${y(i)}, 100 ${y(i)}`} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={i === active ? 2 : 1} stroke={i === active ? '#7a6a58' : '#d9cfc0'} style={{ transition: 'stroke .5s, stroke-width .5s' }} />;
          })}
        </svg>
        <ul className="flex flex-col gap-3">
          {NODES.map((nd, i) => (
            <li key={nd.t} className="relative">
              <span className={`inline-flex items-center rounded-full border bg-white px-5 py-3 text-base shadow-sm transition-all duration-500 ${i === active ? 'border-[#7a6a58] text-ink shadow-md' : 'border-transparent text-[#9b9186]'}`}>{nd.t}</span>
              <span className={`ml-3 inline-flex items-center rounded-full bg-[#7a6a58] px-3 py-1 text-xs font-medium text-white transition-all duration-500 ${i === active ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0'}`} aria-hidden={i !== active}>✓ {nd.done}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
