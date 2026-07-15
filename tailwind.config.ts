import type { Config } from 'tailwindcss';

/**
 * "Quiet confidence" design tokens.
 * Restrained, premium, calm — the system is the product, so the chrome stays out of the way.
 * Semantic surface/ink colours are CSS variables (themeable, dark-mode-ready); brand + status
 * scales are concrete. Radius, elevation and motion are tokenised so components never improvise.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Semantic surfaces + text (defined as RGB channels in globals.css).
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        hairline: 'rgb(var(--hairline) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          subtle: 'rgb(var(--ink-subtle) / <alpha-value>)',
        },
        // Brand — RoleProof rebrand (global): the brand scale IS the proof-green ramp
        // (600 = #137A5B), so every existing brand-* usage turns green app-wide.
        brand: {
          50: '#eaf5ef',
          100: '#cde8dc',
          200: '#9fd3bf',
          300: '#6bb99c',
          400: '#3e9e7b',
          500: '#1f8763',
          600: '#137a5b',
          700: '#0e6149',
          800: '#0d4e3b',
          900: '#0c4031',
          950: '#06281e',
        },
        // RoleProof rebrand — the warm "proof" palette. Scoped to .theme-roleproof;
        // concrete hexes (same in light mode), so adding them is harmless elsewhere.
        proof: {
          DEFAULT: '#137A5B',
          deep: '#0E6149',
          light: '#3DBE8B',
          soft: '#E7F2EC',
          ring: '#C9E2D4',
        },
        caution: { DEFAULT: '#B57D14', deep: '#8A5D08', soft: '#F7EFD9', ring: '#EAD9A8' },
        drop: { DEFAULT: '#B23A2E', deep: '#8F2B20', soft: '#F6E5E1', ring: '#EAC9C3' },
        paper: '#FAF8F3',
        // Dark surfaces (prototype's curate bar, "See why" modal, Pipeline principle
        // band): an ink ground with its own on-dark text + divider ramp and the proof
        // accent. Named so these moments read as intentional, not one-off hexes.
        dark: {
          DEFAULT: '#1B1A17', // ground (matches --ink)
          raised: '#2A2832', // dividers / hairlines on dark
          ink: '#FAF8F3', // primary text on dark
          muted: '#A9A3B5', // secondary text on dark
          subtle: '#8A8494', // tertiary text on dark
          accent: '#3DBE8B', // proof accent on dark
        },
      },
      fontFamily: {
        sans: [
          'var(--font-sans)',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        // RoleProof — Instrument Serif (editorial display) + Hanken Grotesk (UI).
        serif: ['var(--font-serif)', 'Instrument Serif', 'Georgia', 'serif'],
        display: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        field: '0.625rem', // 10px — inputs, small controls
        card: '0.75rem', // 12px — cards, panels (one radius across the whole app)
        xl2: '1.125rem', // 18px — heroes, modals
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(16 24 40 / 0.04)',
        // resting card — light, flat, single-layer; the RoleProof surface, leaning on
        // the hairline border for definition. One shadow for every card in the app.
        card: '0 1px 2px 0 rgb(16 24 40 / 0.05)',
        elevated:
          '0 2px 4px -1px rgb(16 24 40 / 0.04), 0 12px 28px -8px rgb(16 24 40 / 0.14)',
        pop: '0 10px 30px -8px rgb(16 24 40 / 0.20)',
        // soft inner highlight for "active stage" emphasis
        glow: '0 0 0 1px rgb(19 122 91 / 0.18), 0 8px 24px -10px rgb(19 122 91 / 0.35)',
      },
      transitionTimingFunction: {
        'out-soft': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'in-out-soft': 'cubic-bezier(0.65, 0, 0.35, 1)',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.94)' },
          '60%': { opacity: '1', transform: 'scale(1.012)' },
          '100%': { transform: 'scale(1)' },
        },
        'rail-grow': {
          from: { transform: 'scaleY(0)' },
          to: { transform: 'scaleY(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out both',
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pop-in': 'pop-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};

export default config;
