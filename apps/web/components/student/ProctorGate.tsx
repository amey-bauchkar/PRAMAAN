'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProctorSession, ProctorState } from '@/lib/proctor';
import { Button, Card, Notice } from '../ui';

const FLAG_AT = 3;

/**
 * Wraps the test rounds. `children` receives `flush`: call it before a round is submitted so the server sees every
 * queued test-rule event before it decides. Until the student passes the camera check and starts the proctored window, the questions are not
 * shown (and the server does not send them). While the window is active, leaving full screen or switching tab hides the test.
 */
export function ProctorGate({ attemptId, onStarted, children }: { attemptId: string; onStarted: () => void; children: (flush: () => Promise<void>) => React.ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<ProctorSession | null>(null);
  const [state, setState] = useState<ProctorState>({ stage: 'idle', blocked: false, cameraOk: false, faces: 0, major: 0, minor: 0, warnings: [], error: null });
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const unsupported = useMemo(() => ProctorSession.unsupported(), []);

  if (!sessionRef.current) sessionRef.current = new ProctorSession(attemptId, setState);
  const session = sessionRef.current;
  useEffect(() => () => session.stop(), [session]);

  const flush = useCallback(() => session.flush(), [session]);
  const active = state.stage === 'active';

  const check = async () => { if (videoRef.current) { setBusy(true); await session.prepare(videoRef.current); setBusy(false); } };
  const begin = async () => { setBusy(true); const ok = await session.begin(); setBusy(false); if (ok) onStarted(); };

  const preview = (
    <video ref={videoRef} playsInline muted aria-label="Your camera preview, shown only to you"
      className={active
        ? 'fixed bottom-4 right-4 z-40 h-24 w-32 rounded-lg border-2 border-line bg-black object-cover shadow-lg [transform:scaleX(-1)]'
        : `w-full max-w-sm rounded-lg border border-line bg-black object-cover [transform:scaleX(-1)] ${state.stage === 'ready' || state.stage === 'preparing' ? '' : 'hidden'}`} />
  );

  // Every fresh page load needs a new camera check and start, even when the server already has an earlier session.
  if (!active && state.stage !== 'stopped') {
    const ready = state.stage === 'ready';
    const oneFace = state.faces === 1;
    return (
      <Card title="Before you start: the proctored test window">
        <div className="flex flex-col gap-4 text-sm">
          <p>This practice drive is taken like a real online test, so the proof it adds to your profile means something.</p>
          <ul className="list-disc pl-5">
            <li>The test opens in <b>full screen</b>. If you leave full screen or switch tab or window, the test is hidden until you return, and it is recorded.</li>
            <li>Pasting, right-click and the usual copy, print, save and developer shortcuts are blocked. Typing and copying your own code are fine.</li>
            <li>Your <b>camera stays on</b>. It checks that one face is in view, that you are looking at the screen, and that no phone is visible. Use a well-lit room and sit facing the screen.</li>
            <li><b>Your video never leaves this device and is never recorded.</b> The analysis runs in your browser. Only short rule events (for example "looked away for 5 seconds") are saved, and you can see all of them in your report.</li>
            <li>In the code boxes, a <b>summary of how you type</b> is kept: how many keys, the biggest single insert and how even the pauses were. It is numbers only: never what you type or which keys. It is shown in your report with a plain reason, goes to a person to look at, and never lowers your marks or removes proof by itself.</li>
            <li>Three serious events (leaving full screen or the tab, a second face, a phone, or the camera stopping) mean this drive adds no proof. You can still finish it, and you can ask your placement officer to review it. Nothing is rejected automatically.</li>
          </ul>
          {unsupported && <Notice tone="warn">{unsupported}</Notice>}
          {state.error && <Notice tone="warn">{state.error}</Notice>}
          <div className="flex flex-col items-start gap-3">
            {preview}
            {ready && (
              <p className={`font-semibold ${oneFace && state.cameraOk ? 'text-ink' : 'text-red-700 dark:text-red-300'}`}>
                {!state.cameraOk ? 'The camera is not sending video.' : state.faces === 0 ? 'No face found. Face the camera.' : state.faces > 1 ? 'More than one face is visible. Only you should be in view.' : 'Camera check passed: one face found.'}
              </p>
            )}
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={agreed} onChange={e => setAgreed(e.target.checked)} disabled={!!unsupported} />
            <span>I agree to use my camera for this practice drive and to follow the test rules above. I can stop at any time by leaving the drive.</span>
          </label>
          <div className="flex flex-wrap gap-3">
            {!ready && <Button busy={busy || state.stage === 'preparing'} disabled={!agreed || !!unsupported} onClick={check}>{state.stage === 'preparing' ? 'Starting camera…' : 'Check my camera'}</Button>}
            {ready && <Button busy={busy} disabled={!(oneFace && state.cameraOk)} onClick={begin}>Start the test in full screen</Button>}
          </div>
        </div>
      </Card>
    );
  }

  if (!active) return null; // stopped

  const left = Math.max(0, FLAG_AT - state.major);
  return (
    <>
      {preview}
      <div className="fixed left-4 top-4 z-40 flex max-w-xs flex-col gap-2 text-xs">
        <div className="flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 shadow">
          <span className={`inline-block h-2 w-2 rounded-full ${state.cameraOk && state.faces === 1 ? 'bg-green-600' : 'bg-red-600'}`} />
          <span>{!state.cameraOk ? 'Camera stopped' : state.faces === 1 ? 'Proctoring on' : state.faces === 0 ? 'No face in view' : 'More than one face'}</span>
          <span className="text-muted">· {state.major} serious, {state.minor} minor</span>
        </div>
        {state.warnings.slice(-2).map(w => (
          <div key={w.id} role="alert" className={`rounded border px-3 py-1 shadow ${w.severity === 'major' ? 'border-red-600 bg-red-600/10' : 'border-line bg-card'}`}>
            {w.label}{w.severity === 'major' ? (left > 0 ? `. ${left} more serious event${left === 1 ? '' : 's'} and this drive adds no proof.` : '. This drive will not add proof to your profile.') : '.'}
          </div>
        ))}
      </div>
      {state.blocked && (
        <div role="alertdialog" aria-modal="true" aria-label="Return to the test" className="fixed inset-0 z-50 flex items-center justify-center bg-paper p-6">
          <div className="max-w-md text-center">
            <h2 className="text-xl font-semibold">The test is paused</h2>
            <p className="mt-2 text-sm">You left full screen or switched away. This was recorded. Return to full screen to see the questions again.</p>
            <div className="mt-4"><Button onClick={() => session.returnToFullScreen()}>Return to full screen</Button></div>
          </div>
        </div>
      )}
      <div className={state.blocked ? 'invisible' : 'proctored select-none'} aria-hidden={state.blocked}>{children(flush)}</div>
    </>
  );
}
