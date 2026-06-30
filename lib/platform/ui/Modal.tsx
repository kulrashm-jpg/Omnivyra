'use client';
/**
 * Modal (CREATOR-139) — the ONE canonical modal. Replaces the 26+ inline
 * `fixed inset-0` overlays (z-index 50/100/9999, mixed scrims) found in CREATOR-138.
 * Single z-index (tokens.zIndex.modal), single scrim, Escape-to-close, aria-modal,
 * focus-return. All values come from tokens — no raw hex/spacing/shadow.
 */
import React from 'react';
import { color, radius, shadow, zIndex, space, fontSize, fontWeight } from './tokens';

export function Modal({ open, onClose, title, children, footer, width = 560 }: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  const lastFocus = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    lastFocus.current = (document.activeElement as HTMLElement) ?? null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); lastFocus.current?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: color.overlayScrim, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: zIndex.modal, padding: space.xl }}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        style={{ background: color.surface, borderRadius: radius.xl, boxShadow: shadow.overlay, maxWidth: width, width: '100%', maxHeight: '90vh', overflow: 'auto', color: color.text }}>
        {title ? (
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: `${space.lg}px ${space.xl}px`, borderBottom: `1px solid ${color.border}` }}>
            <div style={{ fontSize: fontSize.lg, fontWeight: fontWeight.bold }}>{title}</div>
            <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: color.textSubtle, fontSize: fontSize.xl, lineHeight: 1 }}>×</button>
          </header>
        ) : null}
        <div style={{ padding: space.xl }}>{children}</div>
        {footer ? <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: space.sm, padding: `${space.md}px ${space.xl}px`, borderTop: `1px solid ${color.border}` }}>{footer}</footer> : null}
      </div>
    </div>
  );
}
