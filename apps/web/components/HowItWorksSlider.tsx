'use client';

import React, { useEffect, useState } from 'react';
import { MorphItem, MorphSlider } from './react-bits';

const STEPS = [
  { n: '01', t: 'Prove', d: 'Connect your real work, such as code, tests and projects. Each skill is graded at three levels of proof.' },
  { n: '02', t: 'Check', d: 'We change a line of your own code and ask what happens. If you wrote it, you can answer. Copied code cannot.' },
  { n: '03', t: 'Plan', d: 'See the one skill that opens the most companies, how long it takes, and how many days are left.' },
  { n: '04', t: 'Pass', d: 'Share a pass that says you are eligible. Recruiters do not see your marks.' },
];

type Ctx = CanvasRenderingContext2D;
type Box = { x: number; y: number; w: number; h: number };

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

function wrapText(c: Ctx, text: string, x: number, y: number, maxW: number, lh: number) {
  let line = '';
  let yy = y;
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (c.measureText(test).width > maxW && line) { c.fillText(line, x, yy); line = word; yy += lh; } else line = test;
  }
  if (line) c.fillText(line, x, yy);
}

// Each card is drawn on a 600 x 520 design grid, scaled into the box.
function drawCard(c: Ctx, i: number, b: Box, font: string) {
  const s = b.w / 600;
  c.save();
  c.translate(b.x, b.y);
  c.scale(s, s);
  c.shadowColor = 'rgba(60,15,0,.35)';
  c.shadowBlur = 60;
  c.shadowOffsetY = 24;
  c.fillStyle = i === 1 ? '#111111' : '#ffffff';
  rr(c, 0, 0, 600, 520, 44);
  c.fill();
  c.shadowColor = 'transparent';
  c.textBaseline = 'alphabetic';

  if (i === 0) {
    c.fillStyle = '#0a0a0a'; c.font = `300 38px ${font}`; c.fillText('Skills', 44, 82);
    const rows: [string, string, string][] = [['Python', 'Verified', '#0a0a0a'], ['SQL', 'Evidence added', '#fe4f02'], ['React', 'Signal found', '#8a8a8a'], ['Docker', 'Expired', '#c93a00']];
    rows.forEach(([name, state, col], k) => {
      const y = 140 + k * 92;
      c.fillStyle = '#e8e5e0'; c.fillRect(44, y - 38, 512, 2);
      c.fillStyle = '#0a0a0a'; c.font = `500 32px ${font}`; c.fillText(name, 44, y + 20);
      c.font = `500 24px ${font}`;
      const w = c.measureText(state).width + 36;
      c.fillStyle = state === 'Verified' ? '#0a0a0a' : 'transparent';
      rr(c, 556 - w, y - 14, w, 46, 23); c.fill();
      c.strokeStyle = col; c.lineWidth = 2; c.stroke();
      c.fillStyle = state === 'Verified' ? '#ffffff' : col; c.fillText(state, 556 - w + 18, y + 18);
    });
  } else if (i === 1) {
    c.fillStyle = 'rgba(255,255,255,.5)'; c.font = `500 22px ${font}`; c.fillText('CODE OWNERSHIP CHECK', 44, 70);
    c.font = `400 30px ui-monospace, Menlo, Consolas, monospace`;
    const lines: [string, string][] = [['def total(items):', '#ffffff'], ['    return sum(i.price', '#ffffff'], ['      for i in items', '#ffffff'], ['      if i.qty > 0)', '#8a8a8a'], ['      if i.qty >= 0)   # changed', '#ff7a3d']];
    lines.forEach(([t, col], k) => { c.fillStyle = col; c.fillText(t, 44, 150 + k * 56); });
    c.fillStyle = 'rgba(255,255,255,.1)'; rr(c, 44, 400, 512, 76, 20); c.fill();
    c.fillStyle = '#ffffff'; c.font = `400 28px ${font}`; c.fillText('What happens when qty is 0?', 72, 448);
  } else if (i === 2) {
    c.fillStyle = '#8a8a8a'; c.font = `500 22px ${font}`; c.fillText('YOUR NEXT STEP', 44, 76);
    c.fillStyle = '#0a0a0a'; c.font = `300 52px ${font}`;
    wrapText(c, 'Pass the SQL test to apply to 2 more companies', 44, 160, 510, 62);
    c.fillStyle = '#eeeae4'; rr(c, 44, 330, 512, 18, 9); c.fill();
    c.fillStyle = '#fe4f02'; rr(c, 44, 330, 340, 18, 9); c.fill();
    c.fillStyle = '#585858'; c.font = `400 26px ${font}`; c.fillText('About 4 hours · in time for both deadlines', 44, 410);
  } else {
    c.fillStyle = '#0a0a0a'; c.beginPath(); c.arc(300, 190, 88, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#ffffff'; c.lineWidth = 14; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(258, 192); c.lineTo(288, 224); c.lineTo(346, 158); c.stroke();
    c.fillStyle = '#0a0a0a'; c.textAlign = 'center'; c.font = `300 52px ${font}`; c.fillText('Eligible', 300, 368);
    c.fillStyle = '#585858'; c.font = `400 26px ${font}`; c.fillText('Your marks are not shared', 300, 420);
    c.textAlign = 'left';
  }
  c.restore();
}

function paint(i: number, wide: boolean, font: string): string {
  const W = wide ? 1600 : 900, H = wide ? 900 : 1100;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  const light = i === 3, dark = i === 1;
  const g = c.createLinearGradient(0, 0, W, H);
  if (dark) { g.addColorStop(0, '#0d0d0d'); g.addColorStop(1, '#3a1604'); }
  else if (light) { g.addColorStop(0, '#fff1e6'); g.addColorStop(1, '#ffb27f'); }
  else { g.addColorStop(0, i === 0 ? '#ff8a4d' : '#ff6a1f'); g.addColorStop(0.55, '#e84d00'); g.addColorStop(1, '#a93500'); }
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // soft highlight
  const rg = c.createRadialGradient(W * 0.75, H * 0.2, 0, W * 0.75, H * 0.2, W * 0.5);
  rg.addColorStop(0, light ? 'rgba(255,255,255,.55)' : 'rgba(255,200,160,.30)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = rg; c.fillRect(0, 0, W, H);

  const ink = light ? '#0a0a0a' : '#ffffff';
  const step = STEPS[i]!;
  c.fillStyle = ink; c.textBaseline = 'alphabetic';
  if (wide) {
    c.globalAlpha = 0.75; c.font = `400 34px ${font}`; c.fillText(`${step.n} / 04`, 110, 190); c.globalAlpha = 1;
    c.font = `300 200px ${font}`; (c as unknown as { letterSpacing: string }).letterSpacing = '-8px'; c.fillText(step.t, 104, 390);
    (c as unknown as { letterSpacing: string }).letterSpacing = '0px';
    c.globalAlpha = 0.95; c.font = `400 40px ${font}`; wrapText(c, step.d, 110, 480, 640, 58); c.globalAlpha = 1;
    drawCard(c, i, { x: 900, y: 190, w: 600, h: 520 }, font);
  } else {
    c.globalAlpha = 0.75; c.font = `400 34px ${font}`; c.fillText(`${step.n} / 04`, 70, 110); c.globalAlpha = 1;
    c.font = `300 150px ${font}`; (c as unknown as { letterSpacing: string }).letterSpacing = '-6px'; c.fillText(step.t, 66, 260);
    (c as unknown as { letterSpacing: string }).letterSpacing = '0px';
    c.globalAlpha = 0.95; c.font = `400 36px ${font}`; wrapText(c, step.d, 70, 330, 760, 50); c.globalAlpha = 1;
    drawCard(c, i, { x: 150, y: 520, w: 600, h: 520 }, font);
  }
  return cv.toDataURL('image/png');
}

/** The "How it works" steps as a GPU morph slider. Slide images are drawn in the browser with the site's own font. */
export function HowItWorksSlider() {
  const [items, setItems] = useState<MorphItem[] | null>(null);
  const [wide, setWide] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 720px)');
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
      try {
        await Promise.all([300, 400, 500].map(w => document.fonts.load(`${w} 40px ${font}`)));
        await document.fonts.ready;
      } catch { /* draw with whatever font is available */ }
      if (cancelled) return;
      setItems(STEPS.map((s, i) => ({ image: paint(i, wide, font), caption: `${s.n} · ${s.t}` })));
    })();
    return () => { cancelled = true; };
  }, [wide]);

  return (
    <div className={`relative w-full overflow-hidden rounded-[2rem] bg-ink ${wide ? 'aspect-[16/9]' : 'aspect-[9/11]'}`}>
      {items && (
        <MorphSlider items={items} transition="melt" intensity={0.55} aberration={0.35} drift={0.4} autoplay autoplayDelay={5}
          radius={32} showCaptions={false} />
      )}
      <ol className="sr-only">{STEPS.map(s => <li key={s.n}>{s.t}: {s.d}</li>)}</ol>
    </div>
  );
}
