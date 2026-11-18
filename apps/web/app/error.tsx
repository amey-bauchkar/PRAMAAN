'use client';

import React, { useEffect } from 'react';
import { Cta } from '@/components/Cta';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center gap-4 px-4">
      <h1 className="font-display text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted">The page hit an unexpected error. Nothing you saved was lost. Try again, and if it keeps happening, tell your placement office{error.digest ? ` (reference ${error.digest})` : ''}.</p>
      <div><Cta onClick={reset}>Try again</Cta></div>
    </main>
  );
}
