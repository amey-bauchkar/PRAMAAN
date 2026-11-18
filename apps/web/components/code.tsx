'use client';

import React from 'react';

/** Plain, accessible code editor (monospace textarea with Tab support). */
export function CodeEditor({ value, onChange, label, rows = 14 }: { value: string; onChange: (v: string) => void; label: string; rows?: number }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {label}
      <textarea
        value={value} rows={rows} spellCheck={false}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            const t = e.currentTarget, s = t.selectionStart;
            onChange(value.slice(0, s) + '  ' + value.slice(t.selectionEnd));
            requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
          }
        }}
        className="rounded-lg border border-line bg-paper p-3 font-mono text-sm font-normal leading-relaxed"
      />
      <span className="text-xs font-normal text-muted">Press Tab to indent. Press Shift+Tab to leave this box.</span>
    </label>
  );
}

export function CodeBlock({ code, startLine = 1 }: { code: string; startLine?: number }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-line bg-paper p-3 text-sm leading-relaxed">
      <code>{code.split('\n').map((l, i) => (
        <span key={i} className="block"><span className="mr-4 inline-block w-6 select-none text-right text-muted">{startLine + i}</span>{l}</span>
      ))}</code>
    </pre>
  );
}

/** Per-test results from the judge, with expected vs received for every failure. */
export function JudgeResults({ outcome }: { outcome: any }) {
  if (!outcome) return null;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-semibold">{outcome.passed} of {outcome.total} tests passed</p>
      {outcome.compileError && <p className="rounded bg-red-600/10 p-2 text-red-800 dark:text-red-200">{outcome.compileError}</p>}
      <ul className="flex flex-col gap-1">
        {outcome.results?.map((r: any) => (
          <li key={r.index} className="rounded border border-line p-2">
            <span className={`font-semibold ${r.passed ? 'text-ink' : 'text-red-700 dark:text-red-300'}`}>{r.passed ? 'Pass' : 'Fail'}</span>
            {' '}{r.description ?? `Test ${r.index + 1}`}
            {!r.passed && (r.error ? <span className="block text-muted">{r.error}</span> :
              <span className="block break-all font-mono text-xs text-muted">expected {JSON.stringify(r.expected)}, got {JSON.stringify(r.received)}</span>)}
          </li>
        ))}
      </ul>
    </div>
  );
}
