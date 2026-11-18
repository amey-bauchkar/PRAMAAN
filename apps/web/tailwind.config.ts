import type { Config } from 'tailwindcss';

// Colours come from CSS variables in app/globals.css (one palette, shared with the pitch deck).
const config: Config = {
  // The design is light-only (like the reference site), so dark: variants never apply.
  darkMode: 'class',
  // Globs resolve against this file's folder (not the working directory), with no __dirname, which is
  // undefined when Tailwind reloads the config as an ES module during hot reload.
  content: { relative: true, files: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'] },
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-text)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
