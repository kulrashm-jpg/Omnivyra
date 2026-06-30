/**
 * OmniVyra canonical design tokens (CREATOR-139) — the ONE permanent token layer.
 *
 * Single source of truth for the whole platform. Tailwind consumes these
 * (tailwind.config.js), primitives consume these, and migration codemods map legacy
 * hardcoded values onto them. NO raw hex / inline spacing / inline shadow / arbitrary
 * Tailwind value is permitted outside this file (enforced by lint — RULE 8).
 *
 * Derived verbatim from CREATOR-138 §9 (the OmniVyra Design Language).
 */

/* ── Color — ONE brand palette + ONE semantic palette (collapses 248 → ~18) ── */
export const color = {
  // Brand (omnivyra). Deprecates #2563eb / #0A66C2 / #7c3aed / blue-500.
  primary: { 50: '#eef5ff', 100: '#d9e8ff', 500: '#1EA7FF', 600: '#0B5ED7', 700: '#084aac' },
  onPrimary: '#ffffff',
  // Surfaces
  surface: '#ffffff',
  surface2: '#f8fafc',
  surfaceDark: '#0b1220',
  surfaceDark2: '#020617',
  // Borders
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  borderDark: '#1f2937',
  // Text
  text: '#0f172a',
  textMuted: '#64748b',
  textSubtle: '#94a3b8',
  textOnDark: '#f8fafc',
  // Semantic
  success: '#16a34a',
  warning: '#d97706',
  danger: '#ef4444',
  info: '#0ea5e9',
  // Semantic surfaces / scrim (so primitives never hardcode tints)
  dangerSurface: '#fef2f2',
  dangerInk: '#7f1d1d',
  overlayScrim: 'rgba(15,23,42,0.45)',
} as const;

/** Ordered chart cycle (ties to the Creator Design System chart language). */
export const chartColors = ['#0B5ED7', '#16a34a', '#d97706', '#7c3aed', '#0ea5e9', '#ef4444'] as const;

/* ── Spacing — strict 8px grid (collapses 15+ → 8) ─────────────────────────── */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32, '3xl': 48, '4xl': 64 } as const;

/* ── Radius (collapses 12+ → 5) ────────────────────────────────────────────── */
export const radius = { sm: 4, md: 8, lg: 12, xl: 16, full: 9999 } as const;

/* ── Shadow / elevation (collapses 25+ → 4) ────────────────────────────────── */
export const shadow = {
  sm: '0 1px 2px rgba(15,23,42,0.06)',
  md: '0 4px 12px rgba(15,23,42,0.08)',
  lg: '0 10px 30px rgba(15,23,42,0.10)',
  overlay: '0 20px 60px rgba(15,23,42,0.25)',
} as const;

/* ── Typography (collapses 18 sizes → 7; two weight systems → one) ──────────── */
export const fontSize = { xs: 12, sm: 14, base: 16, lg: 20, xl: 24, '2xl': 30, '3xl': 36 } as const;
export const fontWeight = { normal: 400, medium: 500, semibold: 600, bold: 700 } as const;
export const fontFamily = 'Inter, ui-sans-serif, system-ui, Arial, sans-serif';
export const lineHeight = { tight: 1.2, base: 1.4, relaxed: 1.6 } as const;

/* ── Z-index (ends the 50/100/9999 chaos) ──────────────────────────────────── */
export const zIndex = { base: 0, dropdown: 1000, sticky: 1100, overlay: 1200, modal: 1300, toast: 1400 } as const;

/* ── Motion ────────────────────────────────────────────────────────────────── */
export const motion = {
  duration: { fast: 120, base: 200, slow: 320 },
  easing: { out: 'cubic-bezier(0.16,1,0.3,1)', in: 'cubic-bezier(0.4,0,1,1)' },
} as const;

/* ── Breakpoints · opacity · icon sizing ───────────────────────────────────── */
export const breakpoint = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;
export const opacity = { disabled: 0.5, muted: 0.7, scrim: 0.45 } as const;
export const iconSize = { sm: 14, md: 16, lg: 20, xl: 24 } as const;

/* ── Surface hierarchy (background → card → elevated → overlay) ─────────────── */
export const surfaceLevel = {
  background: { bg: color.surface2 },
  card: { bg: color.surface, border: color.border, radius: radius.lg, shadow: shadow.sm },
  elevated: { bg: color.surface, border: color.border, radius: radius.lg, shadow: shadow.md },
  overlay: { bg: color.surface, border: color.border, radius: radius.xl, shadow: shadow.overlay },
} as const;

/** Canonical focus ring (ONE color everywhere — replaces indigo/blue/amber/slate). */
export const focusRing = { width: 2, color: color.primary[500] } as const;

export const tokens = {
  color, chartColors, space, radius, shadow, fontSize, fontWeight, fontFamily, lineHeight,
  zIndex, motion, breakpoint, opacity, iconSize, surfaceLevel, focusRing,
} as const;
export type Tokens = typeof tokens;
