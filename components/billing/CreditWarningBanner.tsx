/**
 * CreditWarningBanner — session-level credit-consumption warning (80/90/95%).
 *
 * Reads existing in-app `credit_alert` notification records (written by creditAlertService), shows
 * the highest threshold once per browser session (sessionStorage, like DailyBrief), and never
 * spams. Mounted via AppLayout; only renders for authenticated sessions with a fresh warning.
 */

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/apiFetch';

type NotificationRow = { type?: string; category?: string; message?: string; created_at?: string; is_read?: boolean };
const THRESHOLD_CATS = ['consumed_95', 'consumed_90', 'consumed_80'] as const; // highest first
const sessionKey = (cat: string) => `omnivyra_credit_warn_${cat}_dismissed`;

function dismissedThisSession(cat: string): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(sessionKey(cat)) === 'true';
}

export default function CreditWarningBanner() {
  const [warning, setWarning] = useState<{ cat: string; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await apiFetch('/api/notifications');
        const json = await res.json();
        const rows: NotificationRow[] = json?.notifications ?? json ?? [];
        const credit = rows.filter((r) => r.type === 'credit_alert');
        for (const cat of THRESHOLD_CATS) {
          const hit = credit.find((r) => r.category === cat);
          if (hit && !dismissedThisSession(cat)) {
            if (active) setWarning({ cat, message: hit.message ?? `You have used ${cat.replace('consumed_', '')}% of this cycle's credits.` });
            return;
          }
        }
      } catch { /* non-fatal */ }
    })();
    return () => { active = false; };
  }, []);

  if (!warning) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(sessionKey(warning.cat), 'true'); } catch { /* ignore */ }
    setWarning(null);
  };

  return (
    <div style={{ background: '#fbf2da', borderBottom: '1px solid #e6cf8f', color: '#7a5b00', padding: '8px 16px', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <span>⚠️ {warning.message} <a href="/company/billing" style={{ color: '#7a5b00', fontWeight: 600, textDecoration: 'underline' }}>Review credits</a></span>
      <button onClick={dismiss} aria-label="Dismiss" style={{ background: 'transparent', border: 'none', color: '#7a5b00', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
    </div>
  );
}
