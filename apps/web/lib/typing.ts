'use client';

import type { TypingStats } from '../../../packages/domain/src/proctoring';

/**
 * Keeps a summary of how an answer was typed: how many keys, the biggest single insert, and how even the pauses were.
 * It stores numbers only. It never keeps the text, and it never keeps which keys were pressed. Used for students 18 and over.
 */
export class TypingTelemetry {
  private keystrokes = 0;
  private maxJump = 0;
  private last = 0;
  private gaps: number[] = [];

  key(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat?: boolean }) {
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.repeat || !(printable || e.key === 'Enter' || e.key === 'Tab')) return;
    this.keystrokes++;
    const now = performance.now();
    // Pauses over 5 seconds are thinking time, not rhythm.
    if (this.last && now - this.last < 5000) { this.gaps.push(now - this.last); if (this.gaps.length > 2000) this.gaps.shift(); }
    this.last = now;
  }

  change(prevLen: number, nextLen: number) {
    const added = nextLen - prevLen;
    if (added > this.maxJump) this.maxJump = added;
  }

  stats(finalChars: number, baseChars: number): TypingStats {
    const g = [...this.gaps].sort((a, b) => a - b);
    const mean = g.length ? g.reduce((s, x) => s + x, 0) / g.length : 0;
    const sd = g.length ? Math.sqrt(g.reduce((s, x) => s + (x - mean) ** 2, 0) / g.length) : 0;
    return {
      keystrokes: this.keystrokes, finalChars, baseChars, maxJump: this.maxJump,
      gaps: g.length, medianGapMs: g.length ? Math.round(g[Math.floor(g.length / 2)]) : 0, gapCv: mean ? Math.round((sd / mean) * 1000) / 1000 : 0,
    };
  }
}
