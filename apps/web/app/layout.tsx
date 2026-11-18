import type { Metadata } from 'next';
import { Hanken_Grotesk } from 'next/font/google';
import React from 'react';
import { SmoothScroll } from '@/components/SmoothScroll';
import './globals.css';

// Light-weight geometric grotesque for headings and body, close to the Atyp family used on kivoagentic.ai
// (Atyp is a commercial font, so it is not bundled).
const sans = Hanken_Grotesk({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'PRAMAAN — Skills you can prove',
  description: 'Evidence-based placement intelligence: verified skills, gap-bridging and explainable campus drives.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body
        className="min-h-screen font-sans antialiased"
        style={{
          ['--font-text' as string]: 'var(--font-sans), system-ui, sans-serif',
          ['--font-display' as string]: 'var(--font-sans), system-ui, sans-serif',
        }}
      >
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
