/**
 * Strategic Mix R3-P1 — the Content Workspace (SPEC-001 §3.2).
 *
 * ONE workspace, three operating scopes (campaign / week / activity), zero
 * generators: every generation call goes to the EXISTING
 * /api/planner/generate-workspace-content seam; every assist verb goes to
 * /api/campaign-content/assist (proposal → apply). All state rides
 * planner_state.calendar_plan through the P1 draft seam via the pure ops in
 * lib/campaign/campaignContentModel — this component owns no persistence.
 *
 * Progressive disclosure: the default path is Generate campaign → minor
 * edits → approve; per-activity controls (assist verbs, move/duplicate,
 * selected-only generation) reveal on demand.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  Loader2,
  MoveRight,
  PenLine,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { usePlannerSession, type CalendarPlan } from './plannerSessionStore';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import {
  applyGeneratedContent,
  applyManualContentEdit,
  deriveContentItems,
  duplicateActivityContent,
  moveActivityContent,
  planContentGeneration,
  removeActivityContent,
  setContentPlanningStatus,
  summarizeContentCoverage,
  type ContentGenerationMode,
  type ContentGenerationScope,
  type ContentGenerationTarget,
  type ContentPlanningStatus,
  type ContentWorkspaceItem,
} from '../../lib/campaign/campaignContentModel';
// P3-B — derived per-slot review package (text + assets + readiness).
import {
  deriveSlotReviewPackages,
  summarizeSlotReadiness,
  type ReviewableAssetSource,
  type SlotReviewPackage,
} from '../../lib/campaign/slotReadiness';
import { SlotReviewPanel } from './SlotReviewPanel';
import { fetchLibraryMaterializableAssets } from '../../lib/content/creatorAssetServerBackend';
import { fetchRequireAssignmentApproval } from './useApprovalSettings';

const ASSIST_VERBS: Array<{ action: string; label: string }> = [
  { action: 'improve', label: 'Improve' },
  { action: 'shorten', label: 'Shorten' },
  { action: 'expand', label: 'Expand' },
  { action: 'more_technical', label: 'More technical' },
  { action: 'more_executive', label: 'More executive' },
  { action: 'more_emotional', label: 'More emotional' },
  { action: 'alternatives', label: 'Alternatives' },
  { action: 'platform_adapt', label: 'Platform-native rewrite' },
  { action: 'improve_cta', label: 'Stronger CTA' },
  { action: 'improve_hook', label: 'Stronger hook' },
];

const STATUS_META: Record<ContentPlanningStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-gray-100 text-gray-700' },
  review: { label: 'In review', cls: 'bg-amber-50 text-amber-700' },
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700' },
};

interface GenerationProgress {
  running: boolean;
  done: number;
  total: number;
  failures: string[];
  label: string;
}

export interface ContentWorkspaceProps {
  companyId?: string | null;
  campaignId?: string | null;
}

export function ContentWorkspace({ companyId, campaignId }: ContentWorkspaceProps) {
  const { state, setCalendarPlan } = usePlannerSession();
  const plan = (state.execution_plan?.calendar_plan ?? state.calendar_plan) as CalendarPlan | null;
  const assignments = state.assignments ?? [];

  const items = useMemo(() => deriveContentItems(plan), [plan]);
  const coverage = useMemo(() => summarizeContentCoverage(plan), [plan]);
  const assignedSlotIds = useMemo(() => new Set(assignments.map((a) => a.structure_id)), [assignments]);

  const weeks = useMemo(() => {
    const byWeek = new Map<number | null, ContentWorkspaceItem[]>();
    for (const item of items) {
      const list = byWeek.get(item.slot.week) ?? [];
      list.push(item);
      byWeek.set(item.slot.week, list);
    }
    return Array.from(byWeek.entries()).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  }, [items]);

  // P3-B — asset facts for review, from the SAME company-scoped library seam
  // Alignment and Finalize use (ownership enforced server-side there).
  const [assetLibrary, setAssetLibrary] = useState<Map<string, ReviewableAssetSource> | null>(null);
  const [requireApproval, setRequireApproval] = useState(false);
  React.useEffect(() => {
    let cancelled = false;
    const cid = typeof companyId === 'string' ? companyId.trim() : '';
    if (!cid) { setAssetLibrary(null); return; }
    void (async () => {
      const [assets, approvals] = await Promise.all([
        fetchLibraryMaterializableAssets(cid).catch(() => new Map()),
        fetchRequireAssignmentApproval(cid).catch(() => false),
      ]);
      if (cancelled) return;
      setAssetLibrary(assets as Map<string, ReviewableAssetSource>);
      setRequireApproval(approvals === true);
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  // Derived on read — never persisted, never a lifecycle status.
  const reviewPackages = useMemo(
    () => deriveSlotReviewPackages({ plan, assignments, assets: assetLibrary, requireApproval }),
    [plan, assignments, assetLibrary, requireApproval],
  );
  const packageBySlot = useMemo(
    () => new Map(reviewPackages.map((p) => [p.slot.structure_id, p])),
    [reviewPackages],
  );
  const readiness = useMemo(() => summarizeSlotReadiness(reviewPackages), [reviewPackages]);

  const [collapsed, setCollapsed] = useState<Set<number | null>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);
  const [progress, setProgress] = useState<GenerationProgress>({ running: false, done: 0, total: 0, failures: [], label: '' });
  const [confirmOverwrite, setConfirmOverwrite] = useState<{ scope: ContentGenerationScope; targets: ContentGenerationTarget[] } | null>(null);
  const cancelRef = useRef(false);

  // The generation loop applies results one at a time onto the LATEST plan —
  // planRef keeps the loop honest across async awaits (setCalendarPlan takes
  // a value, not an updater).
  const planRef = useRef(plan);
  planRef.current = plan;
  const commitPlan = useCallback((next: CalendarPlan) => {
    planRef.current = next;
    setCalendarPlan(next);
  }, [setCalendarPlan]);

  const themeForWeek = useCallback((week: number | null) => {
    if (week == null) return undefined;
    return state.strategic_themes?.find((t) => t.week === week);
  }, [state.strategic_themes]);

  /* ── Generation orchestration (existing seam; sequential + cancellable) ── */

  const runGeneration = useCallback(async (targets: ContentGenerationTarget[], label: string, overwriteManual: boolean) => {
    if (!companyId || targets.length === 0) return;
    cancelRef.current = false;
    setProgress({ running: true, done: 0, total: targets.length, failures: [], label });
    const failures: string[] = [];
    for (let i = 0; i < targets.length; i += 1) {
      if (cancelRef.current) break;
      const target = targets[i];
      const theme = themeForWeek(target.week);
      try {
        const res = await fetchWithAuth('/api/planner/generate-workspace-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            topic: target.topic ?? theme?.title ?? 'Campaign content',
            platforms: [target.platform],
            contentTypes: target.content_type ? { [String(target.platform)]: target.content_type } : undefined,
            theme: theme?.title,
            objective: theme?.objective,
            week: target.week ?? undefined,
            // P2 — name the slot; the SERVER resolves strategy/skeleton/slot
            // context from the campaign's own planner_state. Sent only when
            // the session owns a campaign; without it the route keeps its
            // pre-P2 behaviour exactly.
            ...(campaignId ? { campaignId, slot_id: target.slot_id } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        const body = res.ok ? data?.variants?.[String(target.platform).toLowerCase()] : null;
        if (typeof body === 'string' && body.trim()) {
          const applied = applyGeneratedContent(planRef.current ?? {}, target.slot_id, body, {
            operation: 'generatePlatformVariants',
            overwriteManual,
          });
          if (applied.changed) commitPlan(applied.plan as CalendarPlan);
          else if (applied.reason === 'manual_overwrite_blocked') failures.push(`${describeTarget(target)}: kept manual copy`);
          else failures.push(`${describeTarget(target)}: could not apply`);
        } else {
          failures.push(`${describeTarget(target)}: ${data?.error ?? 'no content returned'}`);
        }
      } catch (err) {
        failures.push(`${describeTarget(target)}: ${err instanceof Error ? err.message : 'request failed'}`);
      }
      setProgress((p) => ({ ...p, done: i + 1, failures: [...failures] }));
    }
    setProgress((p) => ({ ...p, running: false }));
  }, [companyId, campaignId, commitPlan, themeForWeek]);

  const startGeneration = useCallback((scope: ContentGenerationScope, mode: ContentGenerationMode, label: string) => {
    const targets = planContentGeneration(planRef.current ?? {}, scope, mode, Array.from(selected));
    if (targets.length === 0) return;
    // SPEC-001 §4.4 — regenerating over content requires explicit
    // confirmation whenever any filled slot is in range.
    const touchesExisting = targets.some((t) => t.has_content);
    if (mode !== 'missing' && touchesExisting) {
      setConfirmOverwrite({ scope, targets });
      return;
    }
    void runGeneration(targets, label, false);
  }, [runGeneration, selected]);

  /* ── Per-item actions (pure ops → store) ── */

  const withPlan = useCallback((fn: () => { plan: unknown; changed: boolean }) => {
    const result = fn();
    if (result.changed) commitPlan(result.plan as CalendarPlan);
    return result.changed;
  }, [commitPlan]);

  if (!plan || items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center text-sm text-gray-500 max-w-md">
          <PenLine className="h-8 w-8 mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-700 mb-1">No campaign structure yet</p>
          <p>Build the skeleton first — the Content Workspace fills the publishing slots your structure defines.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      {/* ── Header: coverage + campaign-scope actions ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-indigo-600" />
          <span className="font-semibold text-gray-900">Content</span>
        </div>
        <span className="text-sm text-gray-500">
          {coverage.with_content}/{coverage.total} written · {coverage.approved} approved
          {readiness.total > 0 && (
            <>
              {' · '}
              <span className="text-emerald-600">{readiness.ready} ready</span>
              {readiness.blocked_asset > 0 && <span className="text-amber-700">{' · '}{readiness.blocked_asset} asset issue{readiness.blocked_asset === 1 ? '' : 's'}</span>}
              {readiness.blocked_execution > 0 && <span className="text-red-600">{' · '}{readiness.blocked_execution} cannot publish media</span>}
            </>
          )}
          {coverage.in_review > 0 ? ` · ${coverage.in_review} in review` : ''}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && (
            <button
              type="button"
              disabled={progress.running}
              onClick={() => startGeneration({ kind: 'campaign' }, 'selected', `Generating ${selected.size} selected`)}
              className="px-3 py-1.5 rounded-lg text-sm border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              Generate selected ({selected.size})
            </button>
          )}
          <button
            type="button"
            disabled={progress.running || coverage.empty === 0}
            onClick={() => startGeneration({ kind: 'campaign' }, 'missing', 'Generating missing content')}
            title={coverage.empty === 0 ? 'Every slot already has content' : `Generate the ${coverage.empty} empty slot${coverage.empty === 1 ? '' : 's'}`}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {progress.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate campaign
          </button>
          <button
            type="button"
            disabled={progress.running}
            onClick={() => startGeneration({ kind: 'campaign' }, 'all', 'Regenerating campaign')}
            title="Regenerate every slot (asks before overwriting)"
            className="px-2.5 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Generation progress ── */}
      {(progress.running || progress.failures.length > 0) && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-3">
            {progress.running && <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />}
            <span className="text-indigo-800 font-medium">{progress.label}</span>
            <span className="text-indigo-600">{progress.done}/{progress.total}</span>
            {progress.running && (
              <button type="button" onClick={() => { cancelRef.current = true; }} className="ml-auto text-indigo-700 underline">
                Stop
              </button>
            )}
            {!progress.running && (
              <button type="button" onClick={() => setProgress({ running: false, done: 0, total: 0, failures: [], label: '' })} className="ml-auto text-indigo-700 underline">
                Dismiss
              </button>
            )}
          </div>
          {progress.failures.length > 0 && (
            <ul className="mt-1.5 text-xs text-amber-800 list-disc list-inside">
              {progress.failures.slice(0, 5).map((f) => <li key={f}>{f}</li>)}
              {progress.failures.length > 5 && <li>…and {progress.failures.length - 5} more</li>}
            </ul>
          )}
        </div>
      )}

      {/* ── Overwrite confirmation (explicit, per SPEC-001 §4.4) ── */}
      {confirmOverwrite && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <p className="text-amber-900 font-medium mb-2">
            This will regenerate {confirmOverwrite.targets.length} slot{confirmOverwrite.targets.length === 1 ? '' : 's'},
            including {confirmOverwrite.targets.filter((t) => t.has_content).length} that already have content
            {confirmOverwrite.targets.some((t) => t.manually_edited)
              ? ` (${confirmOverwrite.targets.filter((t) => t.manually_edited).length} manually edited)`
              : ''}.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { const c = confirmOverwrite; setConfirmOverwrite(null); void runGeneration(c.targets, 'Regenerating', true); }}
              className="px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700"
            >
              Regenerate and overwrite
            </button>
            <button
              type="button"
              onClick={() => { const c = confirmOverwrite; setConfirmOverwrite(null); void runGeneration(c.targets.filter((t) => !t.has_content), 'Generating missing content', false); }}
              className="px-3 py-1.5 rounded-lg border border-amber-400 text-amber-800 hover:bg-amber-100"
            >
              Only fill empty slots
            </button>
            <button type="button" onClick={() => setConfirmOverwrite(null)} className="px-3 py-1.5 text-amber-800 underline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Week sections ── */}
      {weeks.map(([week, weekItems]) => {
        const isCollapsed = collapsed.has(week);
        const weekCoverage = coverage.weeks.find((w) => w.week === week);
        return (
          <div key={String(week)} className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
              <button
                type="button"
                onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(week)) next.delete(week); else next.add(week); return next; })}
                className="flex items-center gap-2 text-sm font-semibold text-gray-800"
              >
                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                Week {week ?? '—'}
              </button>
              <span className="text-xs text-gray-400">
                {weekCoverage ? `${weekCoverage.with_content}/${weekCoverage.total} written · ${weekCoverage.approved} approved` : ''}
              </span>
              {themeForWeek(week)?.title && (
                <span className="text-xs text-indigo-500 truncate max-w-[16rem]" title={themeForWeek(week)?.title}>
                  {themeForWeek(week)?.title}
                </span>
              )}
              {week != null && (
                <button
                  type="button"
                  disabled={progress.running}
                  onClick={() => startGeneration({ kind: 'week', week }, 'missing', `Generating week ${week}`)}
                  className="ml-auto px-2.5 py-1 rounded-md text-xs border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 flex items-center gap-1"
                >
                  <Sparkles className="h-3 w-3" /> Generate week
                </button>
              )}
              {week != null && (
                <button
                  type="button"
                  disabled={progress.running}
                  onClick={() => startGeneration({ kind: 'week', week }, 'all', `Regenerating week ${week}`)}
                  title="Regenerate the whole week (asks before overwriting)"
                  className="px-2 py-1 rounded-md text-xs border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
            </div>
            {!isCollapsed && (
              <div className="divide-y divide-gray-50">
                {weekItems.map((item) => (
                  <ActivityContentRow
                    key={item.slot.structure_id}
                    item={item}
                    companyId={companyId}
                    expanded={expandedSlot === item.slot.structure_id}
                    onToggleExpand={() => setExpandedSlot((cur) => (cur === item.slot.structure_id ? null : item.slot.structure_id))}
                    selected={selected.has(item.slot.structure_id)}
                    onToggleSelect={() => setSelected((prev) => { const next = new Set(prev); const id = item.slot.structure_id; if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                    hasAssignment={assignedSlotIds.has(item.slot.structure_id)}
                    reviewPackage={packageBySlot.get(item.slot.structure_id)}
                    busy={progress.running}
                    emptySlots={items.filter((i) => !i.has_content && i.slot.structure_id !== item.slot.structure_id)}
                    onGenerate={(overwrite) => {
                      if (item.has_content && !overwrite) {
                        setConfirmOverwrite({ scope: { kind: 'activity', slot_id: item.slot.structure_id }, targets: planContentGeneration(planRef.current ?? {}, { kind: 'activity', slot_id: item.slot.structure_id }, 'all') });
                      } else {
                        void runGeneration(planContentGeneration(planRef.current ?? {}, { kind: 'activity', slot_id: item.slot.structure_id }, 'all'), `Generating ${item.slot.platform ?? ''} ${item.slot.content_type ?? ''}`, overwrite);
                      }
                    }}
                    onManualSave={(body) => withPlan(() => applyManualContentEdit(planRef.current ?? {}, item.slot.structure_id, body))}
                    onApplyProposal={(body, operation) => withPlan(() => applyGeneratedContent(planRef.current ?? {}, item.slot.structure_id, body, { operation, overwriteManual: true }))}
                    onStatus={(status) => withPlan(() => setContentPlanningStatus(planRef.current ?? {}, item.slot.structure_id, status))}
                    onRemove={() => withPlan(() => removeActivityContent(planRef.current ?? {}, item.slot.structure_id))}
                    onDuplicateTo={(toSlotId) => withPlan(() => duplicateActivityContent(planRef.current ?? {}, item.slot.structure_id, toSlotId))}
                    onMoveTo={(toSlotId) => withPlan(() => moveActivityContent(planRef.current ?? {}, item.slot.structure_id, toSlotId))}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function describeTarget(t: ContentGenerationTarget): string {
  return `W${t.week ?? '?'} ${t.day ?? ''} ${t.platform ?? ''}/${t.content_type ?? ''}`.trim();
}

/* ── One activity row ── */

interface ActivityContentRowProps {
  item: ContentWorkspaceItem;
  companyId?: string | null;
  expanded: boolean;
  onToggleExpand: () => void;
  selected: boolean;
  onToggleSelect: () => void;
  hasAssignment: boolean;
  /** P3-B — the derived review package for this slot (read-only). */
  reviewPackage?: SlotReviewPackage;
  busy: boolean;
  emptySlots: ContentWorkspaceItem[];
  onGenerate: (overwrite: boolean) => void;
  onManualSave: (body: string) => boolean;
  onApplyProposal: (body: string, operation: string) => boolean;
  onStatus: (status: ContentPlanningStatus) => boolean;
  onRemove: () => void;
  onDuplicateTo: (toSlotId: string) => void;
  onMoveTo: (toSlotId: string) => void;
}

function ActivityContentRow({
  item, companyId, expanded, onToggleExpand, selected, onToggleSelect, hasAssignment, reviewPackage, busy,
  emptySlots, onGenerate, onManualSave, onApplyProposal, onStatus, onRemove, onDuplicateTo, onMoveTo,
}: ActivityContentRowProps) {
  const { slot, draft, status, has_content } = item;
  const [editBody, setEditBody] = useState<string | null>(null);
  const [assistBusy, setAssistBusy] = useState<string | null>(null);
  const [proposals, setProposals] = useState<{ operation: string; label: string; bodies: string[]; note?: string } | null>(null);
  const [transfer, setTransfer] = useState<'duplicate' | 'move' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const runAssist = async (action: string, label: string) => {
    if (!companyId || !draft?.body) return;
    setAssistBusy(action);
    setProposals(null);
    try {
      const res = await fetchWithAuth('/api/campaign-content/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          action,
          content: draft.body,
          platform: slot.platform ?? undefined,
          content_type: slot.content_type ?? undefined,
          count: action === 'alternatives' ? 3 : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data?.proposals) && data.proposals.length > 0) {
        setProposals({ operation: `assist:${action}`, label, bodies: data.proposals, note: data.used_fallback ? 'AI unavailable — deterministic fallback shown' : undefined });
      } else {
        setProposals({ operation: `assist:${action}`, label, bodies: [], note: data?.error ?? (data?.used_fallback ? 'AI unavailable for this action right now' : 'No proposals returned') });
      }
    } catch {
      setProposals({ operation: `assist:${action}`, label, bodies: [], note: 'Request failed' });
    } finally {
      setAssistBusy(null);
    }
  };

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} className="h-3.5 w-3.5 rounded border-gray-300" title="Select for 'Generate selected'" />
        <button type="button" onClick={onToggleExpand} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          <span className="text-xs font-medium text-gray-500 w-20 shrink-0">{slot.day ?? '—'}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0">{slot.platform ?? '?'}/{slot.content_type ?? '?'}</span>
          <span className="text-sm text-gray-800 truncate">{slot.title ?? 'Untitled activity'}</span>
        </button>
        {hasAssignment && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 shrink-0" title="A library asset is assigned to this slot — manage it in Alignment">
            asset assigned
          </span>
        )}
        {draft?.manually_edited && (
          <span title="Manually edited" className="shrink-0">
            <PenLine className="h-3 w-3 text-gray-400" />
          </span>
        )}
        <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${has_content ? STATUS_META[status].cls : 'bg-gray-50 text-gray-400'}`}>
          {has_content ? STATUS_META[status].label : 'Empty'}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => onGenerate(false)}
          title={has_content ? 'Regenerate this activity' : 'Generate this activity'}
          className="p-1.5 rounded-md text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 shrink-0"
        >
          {has_content ? <RotateCcw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-2.5 ml-6 space-y-2.5">
          {/* P3-B — the content PACKAGE that would actually execute: derived
              readiness plus every assigned asset, rendered in order. */}
          {reviewPackage && <SlotReviewPanel pkg={reviewPackage} />}

          {/* Body editor */}
          <textarea
            value={editBody ?? draft?.body ?? ''}
            onChange={(e) => setEditBody(e.target.value)}
            onBlur={() => {
              if (editBody != null && editBody.trim() && editBody !== draft?.body) onManualSave(editBody);
              setEditBody(null);
            }}
            placeholder={has_content ? '' : 'Write this activity by hand, or generate it — your call.'}
            rows={Math.min(14, Math.max(4, (draft?.body?.split('\n').length ?? 0) + 1))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-normal text-gray-800 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
          />

          {/* Lifecycle + item actions */}
          <div className="flex flex-wrap items-center gap-1.5">
            {has_content && (
              <>
                {status !== 'review' && status !== 'approved' && (
                  <button type="button" onClick={() => onStatus('review')} className="px-2.5 py-1 rounded-md text-xs border border-amber-200 text-amber-700 hover:bg-amber-50 flex items-center gap-1">
                    <Eye className="h-3 w-3" /> Submit for review
                  </button>
                )}
                {status !== 'approved' && (
                  <button type="button" onClick={() => onStatus('approved')} className="px-2.5 py-1 rounded-md text-xs border border-emerald-200 text-emerald-700 hover:bg-emerald-50 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Approve
                  </button>
                )}
                {status !== 'draft' && (
                  <button type="button" onClick={() => onStatus('draft')} className="px-2.5 py-1 rounded-md text-xs border border-gray-200 text-gray-600 hover:bg-gray-50">
                    Back to draft
                  </button>
                )}
                <span className="mx-1 text-gray-200">|</span>
                {ASSIST_VERBS.map((verb) => (
                  <button
                    key={verb.action}
                    type="button"
                    disabled={assistBusy != null}
                    onClick={() => void runAssist(verb.action, verb.label)}
                    className="px-2 py-1 rounded-md text-xs border border-indigo-100 text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 flex items-center gap-1"
                  >
                    {assistBusy === verb.action ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    {verb.label}
                  </button>
                ))}
                <span className="mx-1 text-gray-200">|</span>
                <button type="button" onClick={() => setTransfer(transfer === 'duplicate' ? null : 'duplicate')} className="px-2 py-1 rounded-md text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                  <Copy className="h-3 w-3" /> Duplicate to…
                </button>
                <button type="button" onClick={() => setTransfer(transfer === 'move' ? null : 'move')} className="px-2 py-1 rounded-md text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                  <MoveRight className="h-3 w-3" /> Move to…
                </button>
                {!confirmRemove ? (
                  <button type="button" onClick={() => setConfirmRemove(true)} className="px-2 py-1 rounded-md text-xs border border-red-100 text-red-500 hover:bg-red-50 flex items-center gap-1">
                    <Trash2 className="h-3 w-3" /> Remove
                  </button>
                ) : (
                  <span className="flex items-center gap-1 text-xs">
                    <button type="button" onClick={() => { onRemove(); setConfirmRemove(false); }} className="px-2 py-1 rounded-md bg-red-600 text-white">Remove content</button>
                    <button type="button" onClick={() => setConfirmRemove(false)} className="px-2 py-1 text-gray-500 underline">Keep</button>
                  </span>
                )}
              </>
            )}
          </div>

          {/* Duplicate/Move target picker */}
          {transfer && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
              <p className="text-gray-600 mb-1.5">{transfer === 'duplicate' ? 'Copy' : 'Move'} this content to an empty slot:</p>
              {emptySlots.length === 0 ? (
                <p className="text-gray-400">No empty slots available.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {emptySlots.slice(0, 12).map((target) => (
                    <button
                      key={target.slot.structure_id}
                      type="button"
                      onClick={() => { (transfer === 'duplicate' ? onDuplicateTo : onMoveTo)(target.slot.structure_id); setTransfer(null); }}
                      className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:border-indigo-400"
                    >
                      W{target.slot.week ?? '?'} {target.slot.day ?? ''} · {target.slot.platform}/{target.slot.content_type}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI proposals (proposal → apply; never silent) */}
          {proposals && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                <span className="text-xs font-medium text-indigo-800">AI proposal — {proposals.label}</span>
                {proposals.note && <span className="text-[11px] text-amber-700">{proposals.note}</span>}
                <button type="button" onClick={() => setProposals(null)} className="ml-auto text-xs text-indigo-600 underline">Dismiss</button>
              </div>
              <div className="space-y-2">
                {proposals.bodies.map((body, i) => (
                  <div key={i} className="rounded-md border border-indigo-100 bg-white px-3 py-2">
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans max-h-40 overflow-y-auto">{body}</pre>
                    <button
                      type="button"
                      onClick={() => { if (onApplyProposal(body, proposals.operation)) setProposals(null); }}
                      className="mt-1.5 px-2.5 py-1 rounded-md text-xs bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                      Apply {proposals.bodies.length > 1 ? `option ${i + 1}` : ''}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
