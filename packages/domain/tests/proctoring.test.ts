import { describe, it, expect } from 'vitest';
import { summarizeIntegrity, mayAwardProof, CameraAnalyzer, headPoseFromMatrix, DEFAULT_GAZE, ProctorEventInput } from '../src/proctoring.js';

const started = (camera: boolean): ProctorEventInput => ({ kind: 'session_started', detail: { camera } });

describe('integrity summary', () => {
  it('an attempt with no proctored session is unproctored and adds no proof', () => {
    const s = summarizeIntegrity([]);
    expect(s.status).toBe('unproctored');
    expect(mayAwardProof(s)).toBe(false);
  });
  it('a session without the camera is flagged', () => {
    expect(summarizeIntegrity([started(false)]).status).toBe('flagged');
  });
  it('a clean session counts', () => {
    const s = summarizeIntegrity([started(true), { kind: 'session_ended' }]);
    expect(s.status).toBe('clean');
    expect(mayAwardProof(s)).toBe(true);
  });
  it('one or two serious events need review but still count; three withhold proof', () => {
    const two = summarizeIntegrity([started(true), { kind: 'tab_hidden' }, { kind: 'fullscreen_exit' }]);
    expect(two.status).toBe('review');
    expect(mayAwardProof(two)).toBe(true);
    const three = summarizeIntegrity([started(true), { kind: 'tab_hidden' }, { kind: 'fullscreen_exit' }, { kind: 'phone_detected' }]);
    expect(three.status).toBe('flagged');
    expect(mayAwardProof(three)).toBe(false);
  });
  it('many minor events alone move a drive to review, never to flagged', () => {
    const ev: ProctorEventInput[] = [started(true), ...Array.from({ length: 20 }, () => ({ kind: 'looking_away' as const }))];
    expect(summarizeIntegrity(ev).status).toBe('review');
  });
});

describe('camera analysis', () => {
  const front = { faces: 1, yaw: 2, pitch: 0, eyeSide: 0.1 };
  const run = (samples: { t: number; faces: number; yaw?: number; pitch?: number; eyeSide?: number; phone?: boolean }[]) => {
    const a = new CameraAnalyzer(DEFAULT_GAZE);
    return samples.flatMap(s => a.push(s));
  };
  it('does not react to a brief glance away', () => {
    expect(run([{ t: 0, ...front }, { t: 1000, faces: 1, yaw: 40 }, { t: 2000, ...front }, { t: 3000, ...front }])).toEqual([]);
  });
  it('reports a sustained head turn once, not on every frame', () => {
    const out = run(Array.from({ length: 12 }, (_, i) => ({ t: i * 500, faces: 1, yaw: 40 })));
    expect(out.map(e => e.kind)).toEqual(['looking_away']);
    expect(out[0].detail).toEqual({ why: 'head turned sideways' });
  });
  it('reports sideways eyes with a straight head', () => {
    const out = run(Array.from({ length: 10 }, (_, i) => ({ t: i * 500, faces: 1, yaw: 0, pitch: 0, eyeSide: 0.9 })));
    expect(out[0]?.detail).toEqual({ why: 'eyes looking sideways' });
  });
  it('reports a missing face, a second person and a phone', () => {
    expect(run(Array.from({ length: 10 }, (_, i) => ({ t: i * 500, faces: 0 }))).map(e => e.kind)).toEqual(['face_missing']);
    expect(run(Array.from({ length: 6 }, (_, i) => ({ t: i * 500, faces: 2 }))).map(e => e.kind)).toEqual(['multiple_faces']);
    expect(run(Array.from({ length: 6 }, (_, i) => ({ t: i * 500, ...front, phone: true }))).map(e => e.kind)).toEqual(['phone_detected']);
  });
  it('can report again after the student recovers and the cooldown passes', () => {
    const away = (from: number) => Array.from({ length: 8 }, (_, i) => ({ t: from + i * 500, faces: 1, yaw: 45 }));
    const out = run([...away(0), { t: 4500, ...front }, ...away(20000)]);
    expect(out.filter(e => e.kind === 'looking_away')).toHaveLength(2);
  });
});

describe('head pose', () => {
  it('a straight-on face is near zero, a turned face is large', () => {
    const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    const p = headPoseFromMatrix(identity);
    expect(Math.abs(p.yaw)).toBeLessThan(1); expect(Math.abs(p.pitch)).toBeLessThan(1);
    const a = (40 * Math.PI) / 180; // rotation about Y, column-major
    const turned = [Math.cos(a),0,-Math.sin(a),0, 0,1,0,0, Math.sin(a),0,Math.cos(a),0, 0,0,0,1];
    expect(Math.abs(headPoseFromMatrix(turned).yaw)).toBeGreaterThan(35);
  });
});

import { analyzeTyping, cleanTypingStats, SERVER_ONLY_KINDS, PROCTOR_SEVERITY, TypingStats } from '../src/proctoring.js';

describe('typing observations', () => {
  const human: TypingStats = { keystrokes: 150, finalChars: 200, baseChars: 40, maxJump: 2, gaps: 140, medianGapMs: 180, gapCv: 0.7 };
  it('say nothing about ordinary typing, starter code or an empty answer', () => {
    expect(analyzeTyping(human, 200)).toEqual([]);
    expect(analyzeTyping({ ...human, keystrokes: 30, finalChars: 70, baseChars: 40 }, 70)).toEqual([]);
    expect(analyzeTyping(null, 0)).toEqual([]);
  });
  it('report code that arrived in one piece, with few keystrokes, or with machine-even timing', () => {
    expect(analyzeTyping({ ...human, maxJump: 300 }, 200).map(e => e.kind)).toEqual(['code_bulk_insert']);
    expect(analyzeTyping({ ...human, keystrokes: 8, maxJump: 2 }, 200).map(e => e.kind)).toEqual(['code_little_typing']);
    expect(analyzeTyping({ ...human, gapCv: 0.05 }, 200).map(e => e.kind)).toEqual(['code_uniform_typing']);
  });
  it('report a missing typing record instead of letting it hide anything', () => {
    expect(analyzeTyping(null, 120)[0]).toMatchObject({ kind: 'code_little_typing' });
  });
  it('clean untrusted numbers', () => {
    expect(cleanTypingStats({ keystrokes: -5, finalChars: 'x', maxJump: Infinity, gapCv: 3 })).toMatchObject({ keystrokes: 0, finalChars: 0, maxJump: 0, gapCv: 3 });
  });
  it('are server-only, never withhold proof, and only ask for a review', () => {
    expect(SERVER_ONLY_KINDS.every(k => PROCTOR_SEVERITY[k] === 'review')).toBe(true);
    const many = [started(true), ...Array.from({ length: 10 }, () => ({ kind: 'code_bulk_insert' as const }))];
    const s = summarizeIntegrity(many);
    expect(s.status).toBe('review');
    expect(s.review).toBe(10);
    expect(mayAwardProof(s)).toBe(true);
  });
});
