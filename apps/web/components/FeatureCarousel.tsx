'use client';

import React, { useEffect, useState } from 'react';
import { Ctx, rr, siteFont, wrapText } from '@/lib/canvas';
import { FlexCarousel } from './react-bits';

export const FEATURES = [
  { t: 'Code ownership check', d: 'We change one line of your own code and ask what will happen. Only someone who wrote and understood the code can answer, so copied or AI-written code does not pass.', e: 'Example: "if qty > 0" becomes "if qty >= 0". What happens when qty is 0?' },
  { t: 'Your next step', d: 'For each student, the one skill that opens the most company drives, how many hours it takes, and whether there is time before each deadline.', e: 'Example: Pass the SQL test to apply to 2 more drives. About 4 hours, in time for both.' },
  { t: 'Fairness check and fix', d: 'Before a rule goes live, we check whether it treats groups of students fairly. If it does not, PRAMAAN suggests a fairer rule that still asks for the required skills.', e: 'The placement officer chooses. Nothing changes without a written reason.' },
  { t: 'Eligibility Pass', d: 'A pass that tells a recruiter a student is eligible without showing their marks. A pass can be checked only once.', e: 'Shows "CGPA 7.5 or above: yes". Does not show the actual CGPA.' },
  { t: 'Reasons in your language', d: 'Every eligibility decision is explained in English, Hindi or Marathi, so students understand exactly why.', e: 'CGPA 6.8 न्यूनतम 7 से कम है।' },
  { t: 'Consent you can take back', d: 'Students choose what to share and can change their mind at any time. Built to follow India’s data protection law (DPDP). If a student withdraws consent, the proofs that depended on it are paused.', e: 'Every rule keeps its history. Every decision has a reason and a way to appeal.' },
];

// Card palettes: [from, to, ink, soft ink, panel fill]
const LOOKS: [string, string, string, string, string][] = [
  ['#ff8a4d', '#d94400', '#ffffff', 'rgba(255,255,255,.88)', 'rgba(255,255,255,.16)'],
  ['#0d0d0d', '#3a1604', '#ffffff', 'rgba(255,255,255,.72)', 'rgba(255,255,255,.09)'],
  ['#fff1e6', '#ffb27f', '#0a0a0a', 'rgba(10,10,10,.72)', 'rgba(255,255,255,.7)'],
  ['#ff6a1f', '#a93500', '#ffffff', 'rgba(255,255,255,.88)', 'rgba(255,255,255,.16)'],
  ['#f8f4ee', '#e6dccd', '#0a0a0a', 'rgba(10,10,10,.7)', 'rgba(255,255,255,.75)'],
  ['#ff7a3d', '#c93a00', '#ffffff', 'rgba(255,255,255,.88)', 'rgba(255,255,255,.16)'],
];

const W = 1200, H = 900;

function paint(i: number, font: string): string {
  const f = FEATURES[i]!;
  const [from, to, ink, soft, panel] = LOOKS[i]!;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c: Ctx = cv.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, from); g.addColorStop(1, to);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const rg = c.createRadialGradient(W * 0.85, H * 0.1, 0, W * 0.85, H * 0.1, W * 0.55);
  rg.addColorStop(0, 'rgba(255,255,255,.22)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = rg; c.fillRect(0, 0, W, H);

  c.textBaseline = 'alphabetic';
  c.fillStyle = soft; c.font = `400 36px ${font}`;
  c.fillText(`${String(i + 1).padStart(2, '0')} / ${String(FEATURES.length).padStart(2, '0')}`, 80, 110);

  c.fillStyle = ink; c.font = `300 92px ${font}`;
  (c as unknown as { letterSpacing: string }).letterSpacing = '-3px';
  const afterTitle = wrapText(c, f.t, 76, 230, W - 150, 98);
  (c as unknown as { letterSpacing: string }).letterSpacing = '0px';

  c.fillStyle = soft; c.font = `400 40px ${font}`;
  wrapText(c, f.d, 80, afterTitle + 22, W - 170, 58);

  const bh = 150, by = H - bh - 70;
  c.fillStyle = panel; rr(c, 80, by, W - 160, bh, 30); c.fill();
  c.fillStyle = ink; c.font = `400 34px ${font}`;
  wrapText(c, f.e, 116, by + 62, W - 232, 46);
  return cv.toDataURL('image/png');
}

function Static() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map(f => (
        <article key={f.t} className="flex h-full flex-col rounded-3xl border border-line bg-card p-8">
          <h3 className="text-3xl">{f.t}</h3>
          <p className="mb-8 mt-4 leading-7 text-muted">{f.d}</p>
          <p className="mt-auto rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-ink/80">{f.e}</p>
        </article>
      ))}
    </div>
  );
}

/** The feature cards as a GPU carousel. Falls back to a plain grid when WebGL 2 is unavailable. */
export function FeatureCarousel() {
  const [items, setItems] = useState<{ src: string; alt: string; title: string }[] | null>(null);
  const [gl2, setGl2] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2')) { setGl2(false); return; }
    probe.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    (async () => {
      const font = await siteFont();
      if (cancelled) return;
      setItems(FEATURES.map((f, i) => ({ src: paint(i, font), alt: `${f.t}. ${f.d} ${f.e}`, title: f.t })));
    })();
    return () => { cancelled = true; };
  }, []);

  if (!gl2) return <Static />;
  return (
    <div className="h-[460px] w-full sm:h-[560px]">
      {items && (
        <FlexCarousel items={items} preset="liquid" intro="rise" cardHeight={0.66} gap={18} radius={28} squeeze={0.2}
          focusOnClick captions={false} captureWheel={false} />
      )}
    </div>
  );
}
