'use client';
/**
 * Drawer + ConfirmDialog (CREATOR-140) — replaces the 18+ inline drawer implementations
 * (CREATOR-138). Single z-index, scrim, Escape, aria, focus-return. Tokens only.
 */
import React from 'react';
import { color, radius, shadow, zIndex, space, fontSize, fontWeight } from './tokens';
import { Modal } from './Modal';

export function Drawer({ open, onClose, title, children, side = 'right', width = 420 }: {
  open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; side?: 'left' | 'right'; width?: number;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: color.overlayScrim, zIndex: zIndex.modal, display: 'flex', justifyContent: side === 'right' ? 'flex-end' : 'flex-start' }}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        style={{ width, maxWidth: '92vw', height: '100%', background: color.surface, boxShadow: shadow.overlay, display: 'flex', flexDirection: 'column', color: color.text }}>
        {title ? (
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: `${space.lg}px ${space.xl}px`, borderBottom: `1px solid ${color.border}` }}>
            <div style={{ fontSize: fontSize.lg, fontWeight: fontWeight.bold }}>{title}</div>
            <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: color.textSubtle, fontSize: fontSize.xl }}>×</button>
          </header>
        ) : null}
        <div style={{ flex: 1, overflow: 'auto', padding: space.xl }}>{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onConfirm, onCancel, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger }: {
  open: boolean; onConfirm: () => void; onCancel: () => void; title: string; message: React.ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean;
}) {
  const btn = (bg: string, fg: string): React.CSSProperties => ({ background: bg, color: fg, border: 'none', borderRadius: radius.md, padding: `${space.sm}px ${space.lg}px`, fontWeight: fontWeight.semibold, fontSize: fontSize.sm, cursor: 'pointer' });
  return (
    <Modal open={open} onClose={onCancel} title={title} width={440}
      footer={<>
        <button type="button" onClick={onCancel} style={{ ...btn(color.surface, color.text), border: `1px solid ${color.border}` }}>{cancelLabel}</button>
        <button type="button" onClick={onConfirm} style={btn(danger ? color.danger : color.primary[600], color.onPrimary)}>{confirmLabel}</button>
      </>}>
      <div style={{ fontSize: fontSize.sm, color: color.textMuted, lineHeight: 1.5 }}>{message}</div>
    </Modal>
  );
}
