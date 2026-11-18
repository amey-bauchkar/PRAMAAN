'use client';

import Link from 'next/link';
import React from 'react';
import { SpecularButton } from './react-bits';

type Variant = 'brand' | 'light';
type Size = 'sm' | 'md' | 'lg';

// Orange body with a white specular edge, or a white body (for use on orange panels) with an orange edge.
const LOOK: Record<Variant, Record<string, unknown>> = {
  brand: { tint: '#FE4F02', tintOpacity: 1, textColor: '#ffffff', lineColor: '#ffffff', baseColor: '#c93a00', glow: 0.7, style: { boxShadow: '0 10px 24px -10px rgb(254 79 2 / 0.6)' } },
  light: { tint: '#ffffff', tintOpacity: 1, textColor: '#0a0a0a', lineColor: '#ff7a3d', baseColor: '#ffd9c4', glow: 0.7, style: { boxShadow: '0 12px 28px -12px rgb(0 0 0 / 0.45)' } },
};

type Props = {
  children: React.ReactNode;
  variant?: Variant;
  size?: Size;
  /** Renders a link when set, otherwise a button. */
  href?: string;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>;

/** The site's call-to-action button: a React Bits SpecularButton in the brand colours. */
export function Cta({ children, variant = 'brand', size = 'sm', href, className = '', ...rest }: Props) {
  const look = LOOK[variant];
  const common = { size, radius: 14, ...look, idleIntensity: 0.5, className };
  if (href) return <SpecularButton {...common} as={Link} href={href}>{children}</SpecularButton>;
  return <SpecularButton {...common} {...rest}>{children}</SpecularButton>;
}
