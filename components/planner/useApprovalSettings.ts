/**
 * Strategic Mix R2-P1 — company approval-settings hook.
 *
 * One fetch per company for `require_assignment_approval` (default false on
 * any failure — approvals must never break planning when the read is
 * unavailable). Shared by the Alignment workspace, Campaign Board, and
 * FinalizeSection so every surface agrees on whether approvals gate the
 * handoff. `setEnabled` performs the company-level toggle (explicit user
 * action; tenant-guarded server-side).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';

export function useApprovalSettings(companyId: string | null | undefined): {
  approvalsEnabled: boolean;
  loaded: boolean;
  setEnabled: (value: boolean) => Promise<void>;
} {
  const [approvalsEnabled, setApprovalsEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    const cid = typeof companyId === 'string' ? companyId.trim() : '';
    if (!cid || loadedForRef.current === cid) return;
    loadedForRef.current = cid;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/companies/approval-settings?company_id=${encodeURIComponent(cid)}`);
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (!cancelled) setApprovalsEnabled(data?.require_assignment_approval === true);
      } catch { /* default false — planning never blocks on this read */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  const setEnabled = useCallback(async (value: boolean) => {
    const cid = typeof companyId === 'string' ? companyId.trim() : '';
    if (!cid) return;
    setApprovalsEnabled(value); // optimistic; server is the record
    try {
      const res = await fetchWithAuth('/api/companies/approval-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: cid, require_assignment_approval: value }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setApprovalsEnabled(!value); // roll back the optimistic flip
    }
  }, [companyId]);

  return { approvalsEnabled, loaded, setEnabled };
}

/** One-shot read for non-hook contexts (finalize handler). Fail-closed to
 *  false so an offline read degrades to today's behavior. */
export async function fetchRequireAssignmentApproval(companyId: string | null | undefined): Promise<boolean> {
  const cid = typeof companyId === 'string' ? companyId.trim() : '';
  if (!cid) return false;
  try {
    const res = await fetchWithAuth(`/api/companies/approval-settings?company_id=${encodeURIComponent(cid)}`);
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.require_assignment_approval === true;
  } catch {
    return false;
  }
}
