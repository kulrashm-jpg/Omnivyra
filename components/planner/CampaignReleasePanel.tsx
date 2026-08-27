/**
 * Strategic Mix P1 — the Release panel.
 *
 * The ONE place a CMO hands a planned campaign to execution. It calls
 * POST /api/campaigns/[id]/release and shows what the server actually did —
 * it never simulates success from local state (P0 honesty contract).
 *
 * Pre-flight numbers come from the planner's own content coverage
 * (lib/campaign/campaignContentModel), so the confirmation reflects the same
 * draft → review → approved lifecycle the Content Workspace edits. The exact
 * publish window is reported by the SERVER after release, not guessed here.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Rocket, X } from 'lucide-react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import { summarizeContentCoverage } from '../../lib/campaign/campaignContentModel';
import { deriveStructureSlots } from '../../lib/campaign/campaignAssignments';
import { usePlannerSession } from './plannerSessionStore';

interface ReleaseResult {
  scheduled_count?: number;
  eligible_count?: number;
  approved_count?: number;
  generated_count?: number;
  skipped_count?: number;
  platforms?: string[];
  first_scheduled_at?: string | null;
  last_scheduled_at?: string | null;
  stage?: string;
  skipped_by_reason?: Record<string, number>;
}

interface ReleaseError {
  code?: string;
  message?: string;
  skipped_by_reason?: Record<string, number>;
}

const SKIP_LABEL: Record<string, string> = {
  content_in_draft: 'still in draft',
  content_in_review: 'awaiting approval',
  already_scheduled: 'already scheduled',
  out_of_scope: 'outside this selection',
};

function formatStamp(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).replace('T', ' ');
  return parsed.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function CampaignReleasePanel({ campaignId }: { campaignId?: string | null }) {
  const { state } = usePlannerSession();
  const [confirming, setConfirming] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [result, setResult] = useState<ReleaseResult | null>(null);
  const [error, setError] = useState<ReleaseError | null>(null);

  const plan = state.calendar_plan ?? null;
  const coverage = useMemo(() => summarizeContentCoverage(plan), [plan]);
  const slots = useMemo(() => deriveStructureSlots(plan), [plan]);

  const platforms = useMemo(() => {
    const set = new Set<string>();
    for (const slot of slots) if (slot.platform) set.add(String(slot.platform).toLowerCase());
    return Array.from(set).sort();
  }, [slots]);

  // What the release will NOT take: written-but-unapproved copy. Empty slots
  // are releasable (the scheduler generates for them) — mirrors the server
  // policy in lib/campaign/campaignRelease.
  const unapproved = coverage.in_review + coverage.drafts;
  const releasableNow = coverage.approved + coverage.empty;
  const startDate = state.strategy_context?.planned_start_date ?? null;

  const doRelease = useCallback(async () => {
    if (!campaignId || releasing) return;
    setReleasing(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/campaigns/${encodeURIComponent(campaignId)}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'campaign' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ code: data?.code, message: data?.message ?? 'Release failed', skipped_by_reason: data?.skipped_by_reason });
        return;
      }
      setResult(data as ReleaseResult);
      setConfirming(false);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : 'Release request failed' });
    } finally {
      setReleasing(false);
    }
  }, [campaignId, releasing]);

  if (!campaignId) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs text-gray-500">
        Finalize the campaign to enable scheduling.
      </div>
    );
  }

  // ── Released ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex items-center gap-2 text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-sm font-semibold">
            {result.scheduled_count ?? 0} post{(result.scheduled_count ?? 0) === 1 ? '' : 's'} scheduled
          </span>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-emerald-900/80">
          <dt>First publish</dt><dd className="text-right font-medium">{formatStamp(result.first_scheduled_at)}</dd>
          <dt>Last publish</dt><dd className="text-right font-medium">{formatStamp(result.last_scheduled_at)}</dd>
          <dt>Platforms</dt><dd className="text-right font-medium">{(result.platforms ?? []).join(', ') || '—'}</dd>
          <dt>Campaign stage</dt><dd className="text-right font-medium capitalize">{result.stage ?? '—'}</dd>
        </dl>
        {(result.skipped_count ?? 0) > 0 && (
          <p className="mt-2 text-[11px] text-emerald-900/70">
            {result.skipped_count} item{result.skipped_count === 1 ? '' : 's'} not released
            {result.skipped_by_reason
              ? ` — ${Object.entries(result.skipped_by_reason)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => `${n} ${SKIP_LABEL[k] ?? k}`)
                  .join(', ')}`
              : ''}
            .
          </p>
        )}
      </div>
    );
  }

  // ── Pre-flight confirmation ───────────────────────────────────────────
  if (confirming) {
    return (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Release this campaign?</h4>
            <p className="text-[11px] text-gray-600 mt-0.5">
              Scheduling creates real posts on your connected accounts. Review before confirming.
            </p>
          </div>
          <button type="button" onClick={() => { setConfirming(false); setError(null); }}
            className="p-1 rounded hover:bg-white/70 text-gray-500" aria-label="Cancel release">
            <X className="h-4 w-4" />
          </button>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-700">
          <dt>Planned items</dt><dd className="text-right font-medium">{coverage.total}</dd>
          <dt>Approved copy</dt><dd className="text-right font-medium">{coverage.approved}</dd>
          <dt>Will be written by AI</dt><dd className="text-right font-medium">{coverage.empty}</dd>
          <dt>Platforms</dt><dd className="text-right font-medium">{platforms.join(', ') || '—'}</dd>
          <dt>Starts</dt><dd className="text-right font-medium">{startDate ?? 'campaign start date'}</dd>
        </dl>

        {unapproved > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-amber-900">
              <strong>{unapproved} item{unapproved === 1 ? '' : 's'} will not be released</strong>
              {coverage.in_review > 0 && ` — ${coverage.in_review} awaiting approval`}
              {coverage.drafts > 0 && `${coverage.in_review > 0 ? ',' : ' —'} ${coverage.drafts} still in draft`}
              . Approve them in the Content Workspace to include them.
            </p>
          </div>
        )}

        {error && (
          <p className="mt-2 text-[11px] text-red-700">{error.message}</p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={doRelease} disabled={releasing || releasableNow === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {releasing ? <><Loader2 className="h-4 w-4 animate-spin" />Scheduling…</> : <><Rocket className="h-4 w-4" />Confirm — schedule {releasableNow} item{releasableNow === 1 ? '' : 's'}</>}
          </button>
          <button type="button" onClick={() => { setConfirming(false); setError(null); }}
            className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-white">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Entry ─────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Release Campaign</h4>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Schedules approved content to your connected accounts.
            {unapproved > 0 && ` ${unapproved} unapproved item${unapproved === 1 ? '' : 's'} will be left behind.`}
          </p>
        </div>
        <button type="button" onClick={() => setConfirming(true)} disabled={coverage.total === 0}
          className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
          <Rocket className="h-4 w-4" />
          Release Campaign
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] text-red-700">{error.message}</p>}
    </div>
  );
}

export default CampaignReleasePanel;
