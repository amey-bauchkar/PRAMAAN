'use client';

import React, { useEffect, useRef, useState } from 'react';
import { TileSphere } from './TileSphere';

const OUTER = ['Code repositories', 'Skill tests', 'Code walkthroughs', 'Certificates', 'Hackathons', 'Internships'];
const INNER = ['Mentor sign-offs', 'Academic records', 'Project demos', 'Course work'];
const ROWS = ['Code', 'Tests', 'Walkthroughs', 'Certificates'];

function Ring({ items, inset, seconds, offset, active, startIndex }: { items: string[]; inset: string; seconds: number; offset: number; active: number; startIndex: number }) {
  return (
    <div className="orbit-ring absolute rounded-full border border-dashed border-[#d9cfc0]" style={{ inset, animationDuration: `${seconds}s` }}>
      {items.map((label, i) => {
        const a = offset + (i / items.length) * Math.PI * 2;
        const on = active === startIndex + i;
        return (
          <span key={label} className="absolute" style={{ left: `${50 + 50 * Math.cos(a)}%`, top: `${50 + 50 * Math.sin(a)}%`, transform: 'translate(-50%, -50%)' }}>
            <span className="orbit-chip block" style={{ animationDuration: `${seconds}s` }}>
              <span className={`block whitespace-nowrap rounded-full border bg-white px-3 py-1.5 text-[11px] shadow-sm transition-all duration-500 sm:px-3.5 sm:py-1.5 sm:text-xs ${on ? 'border-[#a98f72] text-ink shadow-md' : 'border-transparent text-[#9b9186]'}`}>{label}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Evidence orbiting a single skill graph. Chips highlight one at a time. */
export function EvidenceOrbit() {
  const total = OUTER.length + INNER.length;
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  // Pause the CSS animations while the orbit is off screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => el.classList.toggle('orbit-paused', !e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setActive(a => (a + 1) % total), 2200);
    return () => clearInterval(id);
  }, [total]);

  return (
    <div ref={rootRef} className="relative mx-auto aspect-square w-full max-w-[540px]">
      <Ring items={OUTER} inset="0%" seconds={120} offset={-Math.PI / 2} active={active} startIndex={0} />
      <Ring items={INNER} inset="17%" seconds={90} offset={-Math.PI / 4} active={active} startIndex={OUTER.length} />
      <div className="absolute left-1/2 top-1/2 w-[56%] max-w-[240px] -translate-x-1/2 -translate-y-1/2 rounded-[2rem] bg-white p-4 shadow-[0_24px_60px_-24px_rgb(90,70,40,.35)] sm:p-5">
        <div className="flex items-center justify-between text-[11px] sm:text-xs">
          <span className="rounded-full bg-[#f6f2ec] px-3 py-1 font-medium text-ink">Skill profile</span>
          <span className="text-[#9b9186]">Student</span>
        </div>
        <TileSphere count={450} maxDpr={1.25} color="#e6dccd" light="#ffffff" className="mx-auto my-2 aspect-square w-[68%]" />
        <ul className="space-y-1.5 text-[11px] sm:text-xs">
          {ROWS.map((r, i) => (
            <li key={r} className="flex items-center justify-between">
              <span className={i === active % ROWS.length ? 'text-ink' : 'text-[#9b9186]'}>{r}</span>
              <span className="flex gap-[3px]" aria-hidden>
                {Array.from({ length: 10 }).map((_, d) => <i key={d} className="dot-fill block h-1.5 w-1.5 rounded-full bg-[#a98f72]" style={{ animationDelay: `${(d + i * 3) * 0.12}s` }} />)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-[#eee8de] pt-3 text-[11px] text-[#9b9186] sm:text-xs"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#a98f72]" />Matching work to skills</p>
      </div>
    </div>
  );
}
