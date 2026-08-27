/**
 * Strategic Mix P6 — the Master Campaign Board.
 *
 * A LIVE OPERATIONAL PROJECTION over the canonical entities: structure
 * (calendar slots), content (Asset Library), assignments, and the P5-
 * synchronized execution lifecycle. The board owns NO data and contains NO
 * business logic — every number and judgement comes from
 * projectCampaignBoard / summarizeCampaignBoard (pure), the entities come
 * from the planner session + the library API, and execution state arrives
 * through the shared sync hook. Every surfaced issue links back to the
 * surface where it is resolved (Structure / Content / Alignment) without
 * losing planner state (tabs share the same session provider).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Image as ImageIcon,
  Lightbulb,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import type { CreatorAsset } from '../../lib/content/creatorAssetLibrary';
import { deriveStructureSlots, type AssignmentStatus } from '../../lib/campaign/campaignAssignments';
import type { AssignableAsset } from '../../lib/campaign/assignmentIntelligence';
import {
  projectCampaignBoard,
  summarizeCampaignBoard,
  type BoardIssueTarget,
} from '../../lib/campaign/campaignBoardProjection';
import { usePlannerSession } from './plannerSessionStore';
import { useAssignmentExecutionSync } from './useAssignmentExecutionSync';
import { useApprovalSettings } from './useApprovalSettings';
import { CampaignReleasePanel } from './CampaignReleasePanel';

const HEALTH_STYLE: Record<string, string> = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  attention: 'border-amber-200 bg-amber-50 text-amber-800',
  blocked: 'border-red-200 bg-red-50 text-red-800',
  empty: 'border-gray-200 bg-gray-50 text-gray-600',
};

const LIFECYCLE_ORDER: AssignmentStatus[] = [
  'draft', 'ready', 'confirmed', 'materialized', 'scheduled', 'publishing', 'published', 'archived',
];

interface Props {
  companyId?: string | null;
  campaignId?: string | null;
  /** Navigate to a sibling planner surface without losing session state. */
  onNavigate: (target: 'skeleton' | 'alignment') => void;
}

export function CampaignBoardTab({ companyId, campaignId, onNavigate }: Props) {
  const router = useRouter();
  const { state, setAssignments } = usePlannerSession();
  const assignments = state.assignments ?? [];
  const slots = useMemo(() => deriveStructureSlots(state.calendar_plan), [state.calendar_plan]);

  const { sync, lastSyncAt } = useAssignmentExecutionSync({ campaignId, assignments, setAssignments });

  // Content facts (Asset Library metadata — read-only, same source as Alignment).
  const [assets, setAssets] = useState<AssignableAsset[]>([]);
  const loadAssets = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await fetchWithAuth(`/api/creator-assets/library?company_id=${encodeURIComponent(companyId)}&limit=500`);
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      const entries: Array<{ asset: CreatorAsset }> = Array.isArray(data?.assets) ? data.assets : [];
      setAssets(entries
        .filter((e) => e?.asset?.id)
        .map((e) => ({
          id: e.asset.id,
          assetType: e.asset.metadata?.assetType ?? null,
          title: e.asset.versions?.find((v) => v.version === e.asset.currentVersion)?.payload?.title ?? null,
          tags: Array.isArray(e.asset.metadata?.tags) ? e.asset.metadata.tags : [],
        })));
    } catch { /* board degrades to structure+assignment facts */ }
  }, [companyId]);
  useEffect(() => { void loadAssets(); }, [loadAssets]);

  // ── R2-P1: company approval enablement (board displays + toggles) ──
  const { approvalsEnabled, setEnabled: setApprovalsEnabled } = useApprovalSettings(companyId);

  // ── The projection (pure; the board owns nothing) ──
  const board = useMemo(
    () => projectCampaignBoard({ slots, assignments, assets, requireApproval: approvalsEnabled }),
    [slots, assignments, assets, approvalsEnabled],
  );
  const insights = useMemo(() => summarizeCampaignBoard(board), [board]);

  const openTarget = useCallback((target: BoardIssueTarget) => {
    if (target === 'content') {
      void router.push('/command-center/creator-content/library');
      return;
    }
    onNavigate(target === 'structure' ? 'skeleton' : 'alignment');
  }, [onNavigate, router]);

  if (board.health.label === 'empty') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-gray-400 px-6 py-16">
        No structure yet — the board projects structure, content, assignments, and execution.
        <button type="button" onClick={() => onNavigate('skeleton')}
          className="text-indigo-600 font-medium hover:text-indigo-800 flex items-center gap-1">
          Build the skeleton <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const h = board.health;
  const maxWeekSlots = Math.max(1, ...board.structure.by_week.map((w) => w.slots));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      {/* ── P1: the release seam — the ONE handoff into execution ── */}
      <CampaignReleasePanel campaignId={campaignId} />

      {/* ── Campaign Health ── */}
      <div className={`rounded-xl border px-4 py-3 ${HEALTH_STYLE[h.label]}`}>
        <div className="flex items-center gap-2">
          {h.label === 'ready' ? <CheckCircle2 className="h-4 w-4" /> : h.label === 'blocked' ? <ShieldAlert className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          <span className="text-sm font-semibold capitalize">{h.label === 'attention' ? 'Needs attention' : h.label}</span>
          <span className="text-xs opacity-80">
            {h.blocking_count} blocking · {h.warning_count} warning{h.warning_count === 1 ? '' : 's'}
          </span>
          <button type="button" onClick={() => void sync()}
            title={lastSyncAt ? `Execution last synced ${new Date(lastSyncAt).toLocaleTimeString()}` : 'Sync execution state'}
            className="ml-auto flex items-center gap-1 text-[11px] font-medium opacity-70 hover:opacity-100">
            <RefreshCw className="h-3 w-3" /> Sync
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3">
          {([
            ['Coverage', h.coverage_pct],
            ['Scheduled', h.scheduling_pct],
            ['Published', h.publishing_pct],
            ['Completed', h.completion_pct],
            ['Execution', h.execution_progress_pct],
          ] as Array<[string, number]>).map(([label, value]) => (
            <div key={label}>
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="opacity-70">{label}</span>
                <span className="font-semibold">{value}%</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-black/10 overflow-hidden">
                <div className="h-full rounded-full bg-current opacity-60" style={{ width: `${value}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4 min-w-0">
          {/* ── Weekly coverage ── */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Weekly coverage</h3>
              <button type="button" onClick={() => onNavigate('skeleton')} className="text-[11px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                Structure <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {board.structure.by_week.map((w) => (
                <div key={w.week} className="flex items-center gap-3 text-xs">
                  <span className="w-14 flex-shrink-0 text-gray-500">Week {w.week || '?'}</span>
                  <div className="flex-1 flex h-3 rounded-full bg-gray-100 overflow-hidden" title={`${w.assigned}/${w.slots} assigned · ${w.in_execution} in execution · ${w.published} published`}>
                    <div className="h-full bg-teal-500" style={{ width: `${(w.published / maxWeekSlots) * 100}%` }} />
                    <div className="h-full bg-indigo-400" style={{ width: `${((w.in_execution - w.published) / maxWeekSlots) * 100}%` }} />
                    <div className="h-full bg-indigo-200" style={{ width: `${((w.assigned - w.in_execution) / maxWeekSlots) * 100}%` }} />
                  </div>
                  <span className="w-20 flex-shrink-0 text-right text-gray-500">{w.assigned}/{w.slots} assigned</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Platform coverage + lifecycle distribution ── */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Platform coverage</h3>
              <div className="mt-3 space-y-1.5">
                {board.structure.by_platform.map((p) => (
                  <div key={p.platform} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700">{p.platform}</span>
                    <span className={p.assigned === 0 ? 'text-amber-600 font-medium' : 'text-gray-500'}>
                      {p.assigned}/{p.slots} assigned
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Lifecycle</h3>
                <button type="button" onClick={() => onNavigate('alignment')} className="text-[11px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                  Alignment <ArrowRight className="h-3 w-3" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {LIFECYCLE_ORDER.map((s) => (
                  <span key={s} className={`text-[11px] px-2 py-0.5 rounded-full ${board.assignments.by_status[s] > 0 ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-gray-50 text-gray-400'}`}>
                    {s} {board.assignments.by_status[s]}
                  </span>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-gray-400">
                {board.assignments.total} assignment{board.assignments.total === 1 ? '' : 's'} · {board.execution.in_execution} in execution · {board.assignments.unassigned_slots} open slot{board.assignments.unassigned_slots === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          {/* ── Issues (each links to its source surface) ── */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Issues ({board.issues.length})
            </h3>
            {board.issues.length === 0 ? (
              <p className="mt-2 text-xs text-gray-400">Nothing needs attention.</p>
            ) : (
              <div className="mt-3 space-y-1.5">
                {board.issues.map((issue, i) => (
                  <div key={`${issue.code}-${issue.ref_id ?? i}`} className="flex items-start gap-2 text-xs">
                    {issue.severity === 'blocking'
                      ? <ShieldAlert className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-red-500" />
                      : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-amber-500" />}
                    <span className="flex-1 min-w-0 text-gray-700">{issue.message}</span>
                    <button type="button" onClick={() => openTarget(issue.target)}
                      className="flex-shrink-0 text-indigo-600 hover:text-indigo-800 font-medium">
                      {issue.target === 'content' ? 'Open Library' : issue.target === 'structure' ? 'Open Structure' : 'Open Alignment'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right rail: content facts + AI insights ── */}
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Content</h3>
              <button type="button" onClick={() => openTarget('content')} className="text-[11px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                <ImageIcon className="h-3 w-3" /> Library
              </button>
            </div>
            <div className="mt-2 space-y-1 text-xs text-gray-600">
              <div>{board.content.assets_available} asset{board.content.assets_available === 1 ? '' : 's'} in the library</div>
              <div>{board.content.assets_referenced} referenced by assignments</div>
              {board.content.missing_asset_ids.length > 0 && (
                <div className="text-red-600">{board.content.missing_asset_ids.length} referenced but missing</div>
              )}
            </div>
          </div>

          {/* R2-P1 — Approvals (planning-owned; the board counts and links) */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Approvals</h3>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer" title="Require approval before assignments can enter execution (company-wide)">
                <input
                  type="checkbox"
                  checked={approvalsEnabled}
                  onChange={(e) => void setApprovalsEnabled(e.target.checked)}
                  className="h-3 w-3"
                />
                required
              </label>
            </div>
            {board.approvals.enabled ? (
              <div className="mt-2 space-y-1 text-xs text-gray-600">
                <div className="flex items-center justify-between"><span>Pending</span><span className={board.approvals.pending > 0 ? 'text-amber-600 font-medium' : ''}>{board.approvals.pending}</span></div>
                <div className="flex items-center justify-between"><span>Approved</span><span className="text-emerald-600">{board.approvals.approved}</span></div>
                <div className="flex items-center justify-between"><span>Rejected</span><span className={board.approvals.rejected > 0 ? 'text-red-600 font-medium' : ''}>{board.approvals.rejected}</span></div>
                {board.approvals.blocking.length > 0 && (
                  <button type="button" onClick={() => onNavigate('alignment')}
                    className="mt-1 w-full text-left text-[11px] font-medium text-red-700 hover:text-red-900">
                    {board.approvals.blocking.length} assignment{board.approvals.blocking.length === 1 ? '' : 's'} blocked from execution — review in Alignment →
                  </button>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-gray-400">Approvals are off — assignments enter execution when confirmed.</p>
            )}
          </div>

          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-indigo-500 flex items-center gap-1.5">
              <Lightbulb className="h-3.5 w-3.5" /> AI summary
            </h3>
            <div className="mt-2 space-y-1.5">
              {insights.map((line) => (
                <p key={line} className="text-xs text-gray-700 leading-relaxed">{line}</p>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-gray-400">
              Read-only analysis over the live projection — changes happen in Structure, Content, or Alignment.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
