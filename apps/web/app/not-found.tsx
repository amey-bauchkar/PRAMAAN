import React from 'react';
import { Cta } from '@/components/Cta';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center gap-4 px-4">
      <h1 className="font-display text-2xl font-semibold">Page not found</h1>
      <p className="text-muted">This page does not exist, or you may not have access to it.</p>
      <div><Cta href="/">Go to the start</Cta></div>
    </main>
  );
}
