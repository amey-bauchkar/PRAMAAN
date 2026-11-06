import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'PRAMAAN — Skills you can defend. Evidence recruiters can trust.',
  description: 'Evidence-based placement intelligence platform connecting student skill defence to placement decisions.'
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
