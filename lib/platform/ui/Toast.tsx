'use client';
/**
 * Toast + ToastProvider (CREATOR-139) — the ONE notification system. Replaces the
 * fragmented per-feature notifications (RewardToast was isolated). Single queue,
 * single viewport at tokens.zIndex.toast, auto-dismiss, semantic tones from tokens.
 */
import React from 'react';
import { color, radius, shadow, zIndex, space, fontSize, fontWeight } from './tokens';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';
interface ToastItem { id: number; tone: ToastTone; message: string }

const TONE: Record<ToastTone, string> = { info: color.info, success: color.success, warning: color.warning, danger: color.danger };

const ToastCtx = React.createContext<{ notify: (message: string, tone?: ToastTone) => void }>({ notify: () => {} });
export function useToast(): { notify: (message: string, tone?: ToastTone) => void } { return React.useContext(ToastCtx); }

export function ToastProvider({ children, durationMs = 5000 }: { children: React.ReactNode; durationMs?: number }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const seq = React.useRef(0);
  const notify = React.useCallback((message: string, tone: ToastTone = 'info') => {
    const id = (seq.current += 1);
    setItems((xs) => [...xs, { id, tone, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), durationMs);
  }, [durationMs]);
  return (
    <ToastCtx.Provider value={{ notify }}>
      {children}
      <div aria-live="polite" style={{ position: 'fixed', right: space.xl, bottom: space.xl, display: 'flex', flexDirection: 'column', gap: space.sm, zIndex: zIndex.toast }}>
        {items.map((t) => (
          <div key={t.id} role="status"
            style={{ background: color.surface, borderRadius: radius.lg, boxShadow: shadow.lg, borderLeft: `4px solid ${TONE[t.tone]}`, padding: `${space.md}px ${space.lg}px`, minWidth: 240, maxWidth: 380, color: color.text, fontSize: fontSize.sm, fontWeight: fontWeight.medium }}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
