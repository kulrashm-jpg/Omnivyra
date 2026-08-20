/**
 * CreditWarningBanner — session-level credit-consumption warning (80/90/95%).
 *
 * Reads existing in-app `credit_alert` notification records (written by creditAlertService), shows
 * the highest threshold once per browser session (sessionStorage, like DailyBrief), and never
 * spams. Mounted via AppLayout; only renders for authenticated sessions with a fresh warning.
 */

import React, { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { NOTIFICATIONS_KEY } from '../NotificationBell';

type NotificationRow = { type?: string; category?: string; message?: string; created_at?: string; is_read?: boolean };
const THRESHOLD_CATS = ['consumed_95', 'consumed_90', 'consumed_80'] as const; // highest first
const sessionKey = (cat: string) => `omnivyra_credit_warn_${cat}_dismissed`;

function dismissedThisSession(cat: string): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(sessionKey(cat)) === 'true';
}

export default function CreditWarningBanner() {
  const [warning, setWarning] = useState<{ cat: string; message: string } | null>(null);

  // Read-only subscriber to the notifications key that NotificationBell owns.
  // Same URL, same payload — subscribing shares that cache entry instead of
  // issuing a second request for identical data. NotificationBell stays the
  // sole revalidation owner: no refreshInterval here, and focus/reconnect
  // revalidation is suppressed to match the owner's configuration so this
  // subscription can never trigger a poll of its own.
  const { data } = useSWR<{ notifications?: NotificationRow[] } | NotificationRow[]>(
    NOTIFICATIONS_KEY,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  // Evaluated ONCE per mount, as the previous one-shot fetch was. This matters:
  // the shared entry refreshes on the owner's 60s poll, and re-deriving on every
  // update would change behaviour — after dismissing the 95% alert the next
  // refresh would surface the 90% one, which the old effect never did because it
  // simply never ran again.
  const evaluatedRef = useRef(false);
  useEffect(() => {
    if (evaluatedRef.current || data === undefined) return;
    evaluatedRef.current = true;
    // Tolerates both response shapes the previous implementation accepted.
    const rows: NotificationRow[] = Array.isArray(data) ? data : (data?.notifications ?? []);
    const credit = rows.filter((r) => r.type === 'credit_alert');
    for (const cat of THRESHOLD_CATS) {
      const hit = credit.find((r) => r.category === cat);
      if (hit && !dismissedThisSession(cat)) {
        setWarning({ cat, message: hit.message ?? `You have used ${cat.replace('consumed_', '')}% of this cycle's credits.` });
        return;
      }
    }
  }, [data]);

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
