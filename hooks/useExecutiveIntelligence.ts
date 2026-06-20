/**
 * useExecutiveIntelligence — fetches the proactive executive report and decides
 * whether to surface the popup (Phase 31 smart-display rules), persisting
 * dismissal state per org in localStorage (Phase 24).
 *
 * READ-ONLY w.r.t. billing — the only persistence is a UI dismissal preference
 * in localStorage; no backend writes, no billing impact.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { ExecutiveIntelligenceReport } from '@/backend/services/creditAdvisor/creditAdvisorTypes';

export type DismissKind = 'dismiss' | 'today' | 'forever' | 'remind';

interface ExecPrefs {
  dismissedForever?: boolean;
  dismissUntil?: string; // YYYY-MM-DD
  remindAt?: number; // epoch ms
  lastShownDate?: string; // YYYY-MM-DD
  lastSignature?: string;
}

const REMIND_MS = 4 * 60 * 60 * 1000; // 4 hours

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function keyFor(orgId: string): string {
  return `omnivyra.creditAdvisor.exec.${orgId}`;
}
function readPrefs(orgId: string): ExecPrefs {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(keyFor(orgId)) || '{}') as ExecPrefs;
  } catch {
    return {};
  }
}
function writePrefs(orgId: string, patch: Partial<ExecPrefs>): void {
  if (typeof window === 'undefined') return;
  try {
    const next = { ...readPrefs(orgId), ...patch };
    window.localStorage.setItem(keyFor(orgId), JSON.stringify(next));
  } catch {
    /* ignore quota/availability errors — popup just won't persist */
  }
}

export interface ExecutiveIntelligenceState {
  status: 'loading' | 'ready' | 'error';
  report: ExecutiveIntelligenceReport | null;
  /** Whether the popup should currently be visible. */
  visible: boolean;
  dismiss: (kind: DismissKind) => void;
  error: string | null;
}

export function useExecutiveIntelligence(
  orgId: string | null | undefined,
): ExecutiveIntelligenceState {
  const [report, setReport] = useState<ExecutiveIntelligenceReport | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!orgId) {
      setStatus('loading');
      return;
    }
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        const res = await apiFetch(`/api/credits/executive?org_id=${orgId}`);
        if (!res.ok) {
          if (!cancelled) { setStatus('error'); setError(`Request failed (${res.status})`); }
          return;
        }
        const data = (await res.json()) as ExecutiveIntelligenceReport;
        if (cancelled) return;
        setReport(data);
        setStatus('ready');

        // ── Phase 31 smart-display decision ──────────────────────────────
        const prefs = readPrefs(orgId);
        const now = Date.now();
        const today = todayStr();
        const sig = data.display.signature;

        const suppressed =
          prefs.dismissedForever === true ||
          (prefs.remindAt != null && now < prefs.remindAt) ||
          (prefs.dismissUntil != null && prefs.dismissUntil >= today);

        const signatureChanged = prefs.lastSignature !== sig;
        const shownToday = prefs.lastShownDate === today;

        const show =
          !suppressed && data.display.base_should_show && (!shownToday || signatureChanged);

        if (show) {
          setVisible(true);
          writePrefs(orgId, { lastShownDate: today, lastSignature: sig });
        } else {
          setVisible(false);
        }
      } catch (err: any) {
        if (!cancelled) { setStatus('error'); setError(err?.message ?? 'failed'); }
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const dismiss = useCallback(
    (kind: DismissKind) => {
      setVisible(false);
      if (!orgId) return;
      if (kind === 'forever') writePrefs(orgId, { dismissedForever: true });
      else if (kind === 'today') writePrefs(orgId, { dismissUntil: todayStr() });
      else if (kind === 'remind') writePrefs(orgId, { remindAt: Date.now() + REMIND_MS });
      // 'dismiss' → just close; lastShownDate/signature already persisted on show.
    },
    [orgId],
  );

  return useMemo(
    () => ({ status, report, visible, dismiss, error }),
    [status, report, visible, dismiss, error],
  );
}
