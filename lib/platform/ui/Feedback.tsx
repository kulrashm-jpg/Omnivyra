'use client';
/**
 * Skeleton + Progress + LoadingState + ErrorState (CREATOR-139) — the ONE set for
 * loading/progress/error, replacing the 10+ ad-hoc progress bars and scattered inline
 * loaders/errors (CREATOR-138). All values from tokens.
 */
import React from 'react';
import { color, radius, space, fontSize, fontWeight, iconSize } from './tokens';

/** Shimmer placeholder. */
export function Skeleton({ width = '100%', height = 16, round = radius.sm }: { width?: number | string; height?: number; round?: number }) {
  return <div style={{ width, height, borderRadius: round, background: color.surface2, backgroundImage: `linear-gradient(90deg, ${color.surface2}, ${color.border}, ${color.surface2})`, backgroundSize: '200% 100%', animation: 'ovrShimmer 1.2s ease-in-out infinite' }} />;
}

/** Determinate progress bar (0..1). */
export function Progress({ value, tone = color.primary[600] }: { value: number; tone?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div style={{ width: '100%', height: 8, borderRadius: radius.full, background: color.border, overflow: 'hidden' }}>
      <div style={{ width: `${Math.round(pct * 100)}%`, height: '100%', borderRadius: radius.full, background: tone, transition: 'width 200ms ease-out' }} />
    </div>
  );
}

/** Canonical loading state (spinner-free; consumers may pass a spinner icon). */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, color: color.textMuted, fontSize: fontSize.sm, padding: space.lg }}>
    <span style={{ width: iconSize.md, height: iconSize.md, borderRadius: radius.full, border: `2px solid ${color.border}`, borderTopColor: color.primary[600], display: 'inline-block', animation: 'spin 1s linear infinite' }} />
    {label}
  </div>;
}

/** Canonical inline error (one color, one shape). */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: space.md, background: color.dangerSurface, border: `1px solid ${color.danger}`, borderRadius: radius.lg, padding: `${space.md}px ${space.lg}px`, color: color.dangerInk, fontSize: fontSize.sm }}>
    <span style={{ flex: 1 }}>{message}</span>
    {onRetry ? <button type="button" onClick={onRetry} style={{ background: 'transparent', border: 'none', color: color.danger, fontWeight: fontWeight.semibold, cursor: 'pointer', fontSize: fontSize.sm }}>Retry</button> : null}
  </div>;
}
