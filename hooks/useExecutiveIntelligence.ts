/**
 * useExecutiveIntelligence — fetches the proactive executive report and decides
 * whether to surface the popup (Phase 31 smart-display rules), persisting
 * dismissal state per org in localStorage (Phase 24).
 *
 * READ-ONLY w.r.t. billing — the only persistence is a UI dismissal preference
 * in localStorage; no backend writes, no billing impact.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ApiFetchError } from '@/lib/swr/swrClient';
import type { ExecutiveIntelligenceReport } from '@/backend/services/creditAdvisor/creditAdvisorTypes';

/** OPT-005 Phase 2A: shared SWR key — CreditAdvisorBanner uses the SAME key,
 * so the two consumers of /api/credits/executive now share one request. */
export function executiveReportKey(orgId: string): string {
  return `/api/credits/executive?org_id=${orgId}`;
}

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
  const [visible, setVisible] = useState(false);

  // OPT-005 Phase 2A: SWR facade — global apiFetch fetcher; shared cache
  // entry with CreditAdvisorBanner. Public signature unchanged.
  const { data, error: swrError } = useSWR<ExecutiveIntelligenceReport>(
    orgId ? executiveReportKey(orgId) : null,
  );

  const report = data ?? null;
  const status: 'loading' | 'ready' | 'error' =
    !orgId || (!data && !swrError) ? 'loading' : swrError ? 'error' : 'ready';
  const error =
    status === 'error'
      ? swrError instanceof ApiFetchError
        ? `Request failed (${swrError.status})`
        : (swrError as Error)?.message ?? 'failed'
      : null;

  // ── Phase 31 smart-display decision — same logic, now driven by report
  // arrival (runs identically for a cache-served report on remount, which
  // is what the previous per-mount refetch produced).
  useEffect(() => {
    if (!orgId || !report) return;
    const prefs = readPrefs(orgId);
    const now = Date.now();
    const today = todayStr();
    const sig = report.display.signature;

    const suppressed =
      prefs.dismissedForever === true ||
      (prefs.remindAt != null && now < prefs.remindAt) ||
      (prefs.dismissUntil != null && prefs.dismissUntil >= today);

    const signatureChanged = prefs.lastSignature !== sig;
    const shownToday = prefs.lastShownDate === today;

    const show =
      !suppressed && report.display.base_should_show && (!shownToday || signatureChanged);

    if (show) {
      setVisible(true);
      writePrefs(orgId, { lastShownDate: today, lastSignature: sig });
    } else {
      setVisible(false);
    }
  }, [orgId, report]);

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
