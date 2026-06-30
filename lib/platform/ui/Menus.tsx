'use client';
/**
 * Menu primitives (CREATOR-140) — DropdownMenu, ContextMenu, CommandBar. Tokens only;
 * Escape + outside-click close, keyboard-focusable items, aria menu semantics.
 */
import React from 'react';
import { color, radius, shadow, space, fontSize, zIndex } from './tokens';

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }

function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <div role="menu" style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, boxShadow: shadow.lg, padding: space.xs, minWidth: 180, zIndex: zIndex.dropdown }}>
      {items.map((it, i) => (
        <button key={i} role="menuitem" type="button" disabled={it.disabled}
          onClick={() => { it.onSelect(); onClose(); }}
          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: radius.md, padding: `${space.sm}px ${space.md}px`, fontSize: fontSize.sm, color: it.disabled ? color.textSubtle : it.danger ? color.danger : color.text, cursor: it.disabled ? 'not-allowed' : 'pointer' }}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function DropdownMenu({ trigger, items }: { trigger: React.ReactNode; items: MenuItem[] }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>{trigger}</button>
      {open ? <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: space.xs }}><MenuList items={items} onClose={() => setOpen(false)} /></div> : null}
    </div>
  );
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  React.useEffect(() => {
    const onDoc = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return <div style={{ position: 'fixed', left: x, top: y, zIndex: zIndex.overlay }} onMouseDown={(e) => e.stopPropagation()}><MenuList items={items} onClose={onClose} /></div>;
}

export function CommandBar({ value, onChange, placeholder = 'Type a command…', children }: { value: string; onChange: (v: string) => void; placeholder?: string; children?: React.ReactNode }) {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, boxShadow: shadow.lg, overflow: 'hidden' }}>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus
        style={{ width: '100%', border: 'none', outline: 'none', padding: `${space.md}px ${space.lg}px`, fontSize: fontSize.base, color: color.text, background: 'transparent' }} />
      {children ? <div style={{ borderTop: `1px solid ${color.border}`, maxHeight: 320, overflow: 'auto' }}>{children}</div> : null}
    </div>
  );
}
