'use client';

// The rules and camera analysis live in packages/domain (shared with the API, no Node-only imports in this file).
import {
  CameraAnalyzer, CameraSample, ProctorEventInput, ProctorEventKind, PROCTOR_LABELS, PROCTOR_SEVERITY, headPoseFromMatrix,
} from '../../../packages/domain/src/proctoring';
import { api } from './api';

export type ProctorStage = 'idle' | 'preparing' | 'ready' | 'active' | 'stopped';

export interface ProctorWarning { id: number; kind: ProctorEventKind; label: string; severity: 'minor' | 'major' | 'review'; at: number }

export interface ProctorState {
  stage: ProctorStage;
  /** True while the test must be hidden: not in full screen, or the tab is hidden. */
  blocked: boolean;
  cameraOk: boolean;
  faces: number;
  major: number;
  minor: number;
  warnings: ProctorWarning[];
  error: string | null;
}

const BLOCKED_KEYS = new Set(['c', 'v', 'x', 'p', 's', 'u', 'f', 'g', 'a', 'l', 't', 'n', 'w', 'r']);

/**
 * Runs the proctored test window for one practice-drive attempt:
 *  - asks for full screen and hides the test whenever the student leaves it or switches tab,
 *  - blocks paste, right-click, drag and common shortcuts, and records each try,
 *  - watches the camera ON THIS DEVICE (face count, head and eye direction, phones). Video is never uploaded or stored;
 *    only the rule events reach the server.
 * A browser cannot lock a computer or see a second device, so this deters and records; the server decides what counts.
 */
export class ProctorSession {
  state: ProctorState = { stage: 'idle', blocked: false, cameraOk: false, faces: 0, major: 0, minor: 0, warnings: [], error: null };
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private face: any = null;
  private objects: any = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private queue: ProctorEventInput[] = [];
  private analyzer = new CameraAnalyzer();
  private tick = 0;
  private lastTs = 0;
  private lastHidden = 0;
  private nextId = 1;
  private cleanup: (() => void)[] = [];

  constructor(private attemptId: string, private onChange: (s: ProctorState) => void) {}

  private set(patch: Partial<ProctorState>) { this.state = { ...this.state, ...patch }; this.onChange(this.state); }

  static unsupported(): string | null {
    if (typeof window === 'undefined') return 'This test needs a browser.';
    if (!navigator.mediaDevices?.getUserMedia) return 'This browser cannot use a camera. Use a recent Chrome, Edge or Firefox on a laptop or desktop.';
    if (!document.documentElement.requestFullscreen) return 'This device cannot show the test in full screen. Use a laptop or desktop computer.';
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return 'Take the practice drive on a laptop or desktop computer, not a phone or tablet.';
    return null;
  }

  /** Step 1: camera on, models loaded, a live face count. Needs a click (permission prompt). */
  async prepare(video: HTMLVideoElement): Promise<void> {
    this.set({ stage: 'preparing', error: null });
    try {
      this.video = video;
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
      video.srcObject = this.stream;
      video.muted = true;
      await video.play();
      const track = this.stream.getVideoTracks()[0];
      track.addEventListener('ended', () => this.camLost());
      const { FilesetResolver, FaceLandmarker, ObjectDetector } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks('/proctor/wasm');
      const make = async (delegate: 'GPU' | 'CPU') => ({
        face: await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/proctor/face_landmarker.task', delegate }, runningMode: 'VIDEO', numFaces: 2,
          outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
        }),
        objects: await ObjectDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/proctor/efficientdet_lite0.tflite', delegate }, runningMode: 'VIDEO',
          scoreThreshold: 0.45, maxResults: 3, categoryAllowlist: ['cell phone'],
        }),
      });
      let m;
      try { m = await make('GPU'); } catch { m = await make('CPU'); }
      this.face = m.face; this.objects = m.objects;
      this.set({ stage: 'ready', cameraOk: true });
      this.timer = setInterval(() => this.analyse(), 400);
    } catch (e: any) {
      this.release();
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
      this.set({ stage: 'idle', cameraOk: false, error: denied ? 'Camera permission was refused. Allow the camera for this site and try again.' : (e?.name === 'NotFoundError' ? 'No camera was found on this device.' : `The camera check could not start: ${e?.message ?? 'unknown error'}`) });
    }
  }

  /** Step 2: full screen, listeners, and the start record. Needs a click (full screen requires a user gesture). */
  async begin(): Promise<boolean> {
    try { await document.documentElement.requestFullscreen(); }
    catch { this.set({ error: 'Full screen was refused. Allow it and try again.' }); return false; }
    this.attach();
    this.queue.push({ kind: 'session_started', detail: { camera: this.state.cameraOk } });
    await this.flush();
    this.flushTimer = setInterval(() => { void this.flush(); }, 4000);
    this.set({ stage: 'active', blocked: false });
    return true;
  }

  /** Sends queued events now. Call before submitting a round so the server sees everything. */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, 50);
    try { await api(`/api/v2/student/mock/attempts/${this.attemptId}/proctor`, { body: { events: batch } }); }
    catch (e: any) { if (!/already completed/i.test(e?.message ?? '')) this.queue.unshift(...batch); }
  }

  async returnToFullScreen() { try { await document.documentElement.requestFullscreen(); } catch { /* the overlay stays until it works */ } }

  stop() {
    if (this.state.stage === 'stopped') return;
    const wasActive = this.state.stage === 'active';
    if (wasActive) this.queue.push({ kind: 'session_ended' });
    void this.flush();
    this.release();
    // A session that never started goes back to idle, so React's development double-mount does not leave it stopped.
    this.set({ stage: wasActive ? 'stopped' : 'idle', cameraOk: false, blocked: false });
  }

  // ---------------------------------------------------------------- internals

  private record(kind: ProctorEventKind, extra: Partial<ProctorEventInput> = {}) {
    if (this.state.stage !== 'active') return;
    this.queue.push({ kind, ...extra });
    const sev = PROCTOR_SEVERITY[kind];
    if (sev === 'info') return;
    const w: ProctorWarning = { id: this.nextId++, kind, label: PROCTOR_LABELS[kind], severity: sev, at: Date.now() };
    this.set({
      major: this.state.major + (sev === 'major' ? 1 : 0), minor: this.state.minor + (sev === 'minor' ? 1 : 0),
      warnings: [...this.state.warnings.slice(-4), w],
    });
  }

  private attach() {
    const on = (t: Document | Window, ev: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn as EventListener, opts); this.cleanup.push(() => t.removeEventListener(ev, fn as EventListener, opts));
    };
    on(document, 'visibilitychange', () => {
      if (document.hidden) { this.lastHidden = Date.now(); this.record('tab_hidden'); this.set({ blocked: true }); }
      else this.set({ blocked: !document.fullscreenElement });
    });
    on(window, 'blur', () => { if (Date.now() - this.lastHidden > 1500) this.record('window_blur'); });
    on(document, 'fullscreenchange', () => {
      if (!document.fullscreenElement) { this.record('fullscreen_exit'); this.set({ blocked: true }); }
      else this.set({ blocked: document.hidden });
    });
    const inField = (e: Event) => (e.target as HTMLElement | null)?.closest?.('textarea, input');
    on(document, 'paste', e => { e.preventDefault(); this.record('paste_attempt'); }, { capture: true });
    // Copying your own code out of the editor is allowed; copying the questions is not.
    on(document, 'copy', e => { if (!inField(e)) { e.preventDefault(); this.record('copy_attempt'); } }, { capture: true });
    on(document, 'cut', e => { if (!inField(e)) { e.preventDefault(); this.record('copy_attempt'); } }, { capture: true });
    on(document, 'contextmenu', e => { e.preventDefault(); this.record('context_menu'); }, { capture: true });
    on(document, 'dragstart', e => e.preventDefault(), { capture: true });
    on(document, 'drop', e => e.preventDefault(), { capture: true });
    on(document, 'keydown', e => {
      const k = String(e.key).toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const devtools = k === 'f12' || (mod && e.shiftKey && ['i', 'j', 'c'].includes(k)) || (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(k));
      if (devtools || k === 'printscreen' || (mod && BLOCKED_KEYS.has(k) && !(k === 'a' && inField(e)) && !((k === 'c' || k === 'x') && inField(e)))) {
        e.preventDefault(); this.record('blocked_shortcut', { detail: { key: k.slice(0, 12) } });
      }
    }, { capture: true });
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    on(window, 'beforeunload', beforeUnload);
    document.documentElement.classList.add('proctor-active');
    this.cleanup.push(() => document.documentElement.classList.remove('proctor-active'));
  }

  private camLost() {
    if (this.state.stage === 'active') this.record('camera_lost');
    this.set({ cameraOk: false });
  }

  private analyse() {
    const v = this.video;
    if (!v || !this.face || v.readyState < 2) return;
    if (this.stream && !this.stream.getVideoTracks().some(t => t.readyState === 'live' && t.enabled)) { if (this.state.cameraOk) this.camLost(); return; }
    if (!this.state.cameraOk) this.set({ cameraOk: true });
    const ts = Math.max(performance.now(), this.lastTs + 1); this.lastTs = ts;
    let sample: CameraSample;
    try {
      const r = this.face.detectForVideo(v, ts);
      const faces = r.faceLandmarks?.length ?? 0;
      sample = { t: ts, faces };
      if (faces >= 1) {
        const m = r.facialTransformationMatrixes?.[0]?.data;
        if (m) { const p = headPoseFromMatrix(m); sample.yaw = p.yaw; sample.pitch = p.pitch; }
        const bs: Record<string, number> = {};
        for (const c of r.faceBlendshapes?.[0]?.categories ?? []) bs[c.categoryName] = c.score;
        if ('eyeLookOutLeft' in bs) {
          sample.eyeSide = Math.max(((bs.eyeLookOutLeft ?? 0) + (bs.eyeLookInRight ?? 0)) / 2, ((bs.eyeLookInLeft ?? 0) + (bs.eyeLookOutRight ?? 0)) / 2);
        }
      }
      // Object detection is heavier, so it runs about every two seconds; the last answer holds in between.
      if (++this.tick % 5 === 0 && this.objects) {
        const o = this.objects.detectForVideo(v, ts + 0.5);
        this.phone = (o.detections?.length ?? 0) > 0;
      }
      sample.phone = this.phone;
    } catch { return; }
    if (sample.faces !== this.state.faces) this.set({ faces: sample.faces });
    if (this.state.stage !== 'active') return;
    for (const e of this.analyzer.push(sample)) this.record(e.kind, e);
  }
  private phone = false;

  private release() {
    if (this.timer) clearInterval(this.timer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.timer = this.flushTimer = null;
    for (const c of this.cleanup.splice(0)) c();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    try { this.face?.close(); this.objects?.close(); } catch { /* already closed */ }
    this.face = this.objects = null;
    if (this.video) this.video.srcObject = null;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }
}
