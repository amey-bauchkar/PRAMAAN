/**
 * Test-integrity rules for the practice drive. Pure and shared: the browser uses it to warn the student
 * as it happens, and the API uses it as the authoritative summary when a drive finishes.
 *
 * A browser cannot truly lock a computer or see a second device, so this is a deterrent plus a record, not
 * a guarantee. Consistent with the rest of the product, a flag never rejects anyone by itself: it only
 * withholds the proof a drive would add, and the student can see every flag and ask a person to look.
 */

export const PROCTOR_EVENT_KINDS = [
  'session_started',   // the student accepted the rules; detail.camera says whether the camera is on
  'session_ended',
  'tab_hidden',        // the test tab was hidden or another tab was opened
  'window_blur',       // the window lost focus (another app, a second monitor, a notification)
  'fullscreen_exit',
  'copy_attempt',
  'paste_attempt',
  'context_menu',
  'blocked_shortcut',
  'camera_lost',       // the camera stopped or was covered
  'face_missing',
  'multiple_faces',
  'looking_away',      // head or eyes turned away from the screen for a sustained time
  'phone_detected',
  // Derived on the server from the typing summary sent with a coding answer (never accepted from the browser directly).
  'code_bulk_insert',
  'code_little_typing',
  'code_uniform_typing',
] as const;
export type ProctorEventKind = (typeof PROCTOR_EVENT_KINDS)[number];

/**
 * `review` is for typing observations. They are facts about how the code reached the box, not a verdict and not an "AI score":
 * they never withhold proof by themselves, they only ask a person to look (the problem statement says never to penalise on
 * AI-generated-code detection scores).
 */
export type ProctorSeverity = 'info' | 'minor' | 'major' | 'review';

/** Kinds that only the server may create. */
export const SERVER_ONLY_KINDS: readonly ProctorEventKind[] = ['code_bulk_insert', 'code_little_typing', 'code_uniform_typing'];

export const PROCTOR_SEVERITY: Record<ProctorEventKind, ProctorSeverity> = {
  session_started: 'info',
  session_ended: 'info',
  tab_hidden: 'major',
  window_blur: 'minor',
  fullscreen_exit: 'major',
  copy_attempt: 'minor',
  paste_attempt: 'minor',
  context_menu: 'minor',
  blocked_shortcut: 'minor',
  camera_lost: 'major',
  face_missing: 'minor',
  multiple_faces: 'major',
  looking_away: 'minor',
  phone_detected: 'major',
  code_bulk_insert: 'review',
  code_little_typing: 'review',
  code_uniform_typing: 'review',
};

export const PROCTOR_LABELS: Record<ProctorEventKind, string> = {
  session_started: 'Proctoring started',
  session_ended: 'Proctoring ended',
  tab_hidden: 'Left the test tab',
  window_blur: 'Test window lost focus',
  fullscreen_exit: 'Left full screen',
  copy_attempt: 'Tried to copy',
  paste_attempt: 'Tried to paste',
  context_menu: 'Opened the right-click menu',
  blocked_shortcut: 'Used a blocked shortcut',
  camera_lost: 'Camera stopped or was covered',
  face_missing: 'Face not visible',
  multiple_faces: 'More than one face visible',
  looking_away: 'Looked away from the screen',
  phone_detected: 'A phone was visible',
  code_bulk_insert: 'Code appeared in one piece',
  code_little_typing: 'Little typing for the amount of code',
  code_uniform_typing: 'Unusually even typing rhythm',
};

export interface ProctorEventInput {
  kind: ProctorEventKind;
  at?: string;
  seconds?: number;
  detail?: Record<string, unknown>;
}

export type IntegrityStatus = 'unproctored' | 'clean' | 'review' | 'flagged' | 'exempt';

export interface IntegritySummary {
  status: IntegrityStatus;
  proctored: boolean;
  cameraOn: boolean;
  major: number;
  minor: number;
  /** Typing observations waiting for a person's look. */
  review: number;
  byKind: Partial<Record<ProctorEventKind, number>>;
  /** Plain-language reason, shown to the student and the placement office. */
  message: string;
}

/** Number of major events at which the drive stops adding proof. */
export const FLAG_MAJOR_THRESHOLD = 3;
/** Number of minor events that moves a drive to "review". */
export const REVIEW_MINOR_THRESHOLD = 6;

/**
 * `exempt` is for students under 18: the camera and the test-window rules are not used for them at all (project rule:
 * no webcam proctoring and no behavioural signals for minors). Their drives are checked by the content checks only.
 */
export function summarizeIntegrity(events: ProctorEventInput[], opts: { exempt?: boolean } = {}): IntegritySummary {
  if (opts.exempt) return { status: 'exempt', proctored: false, cameraOn: false, major: 0, minor: 0, review: 0, byKind: {}, message: 'The camera and test-window rules are not used for students under 18. Your answers are still checked for copying and with a short follow-up.' };
  const byKind: Partial<Record<ProctorEventKind, number>> = {};
  let major = 0, minor = 0, review = 0;
  for (const e of events) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    const sev = PROCTOR_SEVERITY[e.kind];
    if (sev === 'major') major++;
    else if (sev === 'minor') minor++;
    else if (sev === 'review') review++;
  }
  // The latest start decides: a student whose camera failed can fix it and start again.
  const started = [...events].reverse().find(e => e.kind === 'session_started');
  const proctored = !!started;
  const cameraOn = started?.detail?.camera === true;
  const base = { proctored, cameraOn, major, minor, review, byKind };
  if (!proctored) return { ...base, status: 'unproctored', message: 'This drive was not taken in the proctored test window, so it adds no proof to your profile.' };
  if (!cameraOn) return { ...base, status: 'flagged', message: 'The camera was not on for this drive, so it adds no proof to your profile.' };
  if (major >= FLAG_MAJOR_THRESHOLD) return { ...base, status: 'flagged', message: `${major} serious test-rule events were recorded, so this drive adds no proof to your profile. You can ask your placement officer to review it.` };
  if (review > 0 && major === 0 && minor < REVIEW_MINOR_THRESHOLD) return { ...base, status: 'review', message: `${review} typing observation${review === 1 ? '' : 's'} (for example code arriving in one piece) need a person's look. They do not change your marks or the proof this drive adds.` };
  if (major >= 1 || minor >= REVIEW_MINOR_THRESHOLD) return { ...base, status: 'review', message: `${major} serious and ${minor} minor test-rule events were recorded. The drive still counts.` };
  return { ...base, status: 'clean', message: 'No test-rule events were recorded.' };
}

/** True when the drive may add proof (skills) to the student's profile. */
export function mayAwardProof(summary: IntegritySummary): boolean {
  return summary.status === 'clean' || summary.status === 'review' || summary.status === 'exempt';
}

// ---------------------------------------------------------------------------
// Camera analysis: turns noisy per-frame readings into a few meaningful events.
// ---------------------------------------------------------------------------

export interface CameraSample {
  /** Milliseconds, any monotonic clock. */
  t: number;
  faces: number;
  /** Head turn in degrees (left/right) and tilt (up/down). Undefined when no face. */
  yaw?: number;
  pitch?: number;
  /** Horizontal eye direction, 0 = centre, 1 = fully sideways. Undefined when unknown. */
  eyeSide?: number;
  phone?: boolean;
}

export interface GazeConfig {
  /** How long a condition must last before it is reported, in ms. */
  sustainMs: number;
  maxYaw: number;
  maxPitchDown: number;
  maxPitchUp: number;
  maxEyeSide: number;
  /** Minimum gap between two reports of the same kind, in ms. */
  cooldownMs: number;
}

export const DEFAULT_GAZE: GazeConfig = { sustainMs: 3000, maxYaw: 28, maxPitchDown: 25, maxPitchUp: 25, maxEyeSide: 0.6, cooldownMs: 8000 };

type Cond = 'face_missing' | 'multiple_faces' | 'looking_away' | 'phone_detected';

/**
 * Feed samples in time order. It emits an event once a condition has lasted `sustainMs`, with its duration
 * in `seconds` when it ends or is re-reported, and never reports the same kind more than once per cooldown.
 */
export class CameraAnalyzer {
  private since: Partial<Record<Cond, number>> = {};
  private last: Partial<Record<Cond, number>> = {};
  private reported: Partial<Record<Cond, boolean>> = {};
  constructor(private cfg: GazeConfig = DEFAULT_GAZE) {}

  static isLookingAway(s: CameraSample, c: GazeConfig): { away: boolean; why: string } {
    if (s.faces !== 1) return { away: false, why: '' };
    if (s.yaw !== undefined && Math.abs(s.yaw) > c.maxYaw) return { away: true, why: 'head turned sideways' };
    // The sign of pitch depends on the camera's axis convention, so both directions use the larger limit.
    if (s.pitch !== undefined && Math.abs(s.pitch) > Math.max(c.maxPitchDown, c.maxPitchUp)) return { away: true, why: 'head tilted up or down' };
    if (s.eyeSide !== undefined && s.eyeSide > c.maxEyeSide) return { away: true, why: 'eyes looking sideways' };
    return { away: false, why: '' };
  }

  push(s: CameraSample): ProctorEventInput[] {
    const away = CameraAnalyzer.isLookingAway(s, this.cfg);
    const now: Record<Cond, boolean> = {
      face_missing: s.faces === 0,
      multiple_faces: s.faces > 1,
      looking_away: away.away,
      phone_detected: !!s.phone,
    };
    const out: ProctorEventInput[] = [];
    for (const kind of Object.keys(now) as Cond[]) {
      if (!now[kind]) { delete this.since[kind]; this.reported[kind] = false; continue; }
      if (this.since[kind] === undefined) this.since[kind] = s.t;
      const held = s.t - (this.since[kind] as number);
      const needed = kind === 'phone_detected' || kind === 'multiple_faces' ? Math.min(this.cfg.sustainMs, 2000) : this.cfg.sustainMs;
      const cooled = this.last[kind] === undefined || s.t - (this.last[kind] as number) >= this.cfg.cooldownMs;
      if (held >= needed && !this.reported[kind] && cooled) {
        this.reported[kind] = true;
        this.last[kind] = s.t;
        out.push({ kind, seconds: Math.round(held / 1000), detail: kind === 'looking_away' ? { why: away.why } : undefined });
      }
    }
    return out;
  }
}

/** Head yaw and pitch, in degrees, from a 4x4 column-major face transform (as MediaPipe returns it). */
export function headPoseFromMatrix(m: ArrayLike<number>): { yaw: number; pitch: number } {
  const r20 = m[2], r21 = m[6], r22 = m[10];
  const yaw = (Math.atan2(-r20, Math.sqrt(r21 * r21 + r22 * r22)) * 180) / Math.PI;
  const pitch = (Math.atan2(r21, r22) * 180) / Math.PI;
  return { yaw, pitch };
}

// ---------------------------------------------------------------------------
// Typing summary for a coding answer (students 18 and over only).
// The browser sends counts and timing, never the text or which keys were pressed.
// ---------------------------------------------------------------------------

export interface TypingStats {
  /** Printable keys, Enter and Tab pressed in the answer box. */
  keystrokes: number;
  /** Characters in the box when it was submitted, and how many were there before the student touched it (starter code). */
  finalChars: number;
  baseChars: number;
  /** Largest number of characters added by one input. Paste and drop are blocked, so a large value means another route. */
  maxJump: number;
  /** Number of pauses measured between keystrokes (pauses over 5 seconds are ignored), their median, and how much they vary. */
  gaps: number;
  medianGapMs: number;
  gapCv: number;
}

export const TYPING_LIMITS = { bulkJump: 40, minChars: 80, minKeyShare: 0.25, minGaps: 60, maxUniformCv: 0.15 };

const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);

/** Cleans untrusted numbers from the browser. */
export function cleanTypingStats(raw: any): TypingStats {
  return {
    keystrokes: Math.round(num(raw?.keystrokes, 100000)), finalChars: Math.round(num(raw?.finalChars, 20000)), baseChars: Math.round(num(raw?.baseChars, 20000)),
    maxJump: Math.round(num(raw?.maxJump, 20000)), gaps: Math.round(num(raw?.gaps, 100000)), medianGapMs: Math.round(num(raw?.medianGapMs, 5000)), gapCv: Math.round(num(raw?.gapCv, 100) * 1000) / 1000,
  };
}

/**
 * Plain observations about how an answer reached the box. A missing summary for a non-empty answer is itself reported,
 * so leaving the telemetry out does not hide anything.
 */
export function analyzeTyping(stats: TypingStats | null, answerChars: number): ProctorEventInput[] {
  const L = TYPING_LIMITS;
  if (answerChars === 0) return [];
  if (!stats) return [{ kind: 'code_little_typing', detail: { why: 'no typing record was sent with this answer' } }];
  const out: ProctorEventInput[] = [];
  const written = Math.max(0, answerChars - stats.baseChars);
  if (stats.maxJump >= L.bulkJump) out.push({ kind: 'code_bulk_insert', detail: { chars: stats.maxJump, why: `one input added ${stats.maxJump} characters` } });
  if (written >= L.minChars && stats.keystrokes < written * L.minKeyShare) out.push({ kind: 'code_little_typing', detail: { chars: written, keys: stats.keystrokes, why: `${stats.keystrokes} keystrokes for ${written} characters` } });
  if (stats.gaps >= L.minGaps && stats.gapCv < L.maxUniformCv) out.push({ kind: 'code_uniform_typing', detail: { keys: stats.gaps, why: `${stats.gaps} pauses between keys varied by only ${Math.round(stats.gapCv * 100)}%` } });
  return out;
}
