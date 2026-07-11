/**
 * Strategic Mix P3 — the Assignment (Alignment) workspace.
 *
 * Structure defines publishing opportunities (left, from the calendar plan —
 * read-only here). Content lives in the Asset Library (right, P2 — created
 * elsewhere, never here). ASSIGNMENT is the only thing this workspace edits:
 * drag an asset onto a slot (or select + assign), move it between slots,
 * replace it, duplicate it, reorder within a slot, detach it. Assets are
 * reusable — assigning never copies, detaching never deletes.
 *
 * AI advice (gaps / conflicts / recommendations) is computed deterministically
 * and rendered as suggestions; every change requires an explicit user action.
 * Assignments persist inside planner_state through the P1 draft seam.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  Image as ImageIcon,
  Lightbulb,
  Lock,
  RefreshCw,
  Replace,
  Search,
  X,
} from 'lucide-react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import { installServerCreatorAssetBackend } from '../../lib/content/creatorAssetServerBackend';
import type { CreatorAsset } from '../../lib/content/creatorAssetLibrary';
import {
  assignAsset,
  duplicateAssignment,
  moveAssignment,
  replaceAssignmentAsset,
  reorderAssignments,
  unassignAssignment,
  updateAssignmentMetadata,
  assignmentsForSlot,
  deriveStructureSlots,
  isAssignmentLocked,
  type AssignmentStatus,
  type CampaignAssignment,
  type StructureSlot,
} from '../../lib/campaign/campaignAssignments';
import { useAssignmentExecutionSync } from './useAssignmentExecutionSync';
import {
  assessExecutionReadiness,
  detectAssignmentConflicts,
  detectAssignmentGaps,
  recommendAssignments,
  type AssignableAsset,
} from '../../lib/campaign/assignmentIntelligence';
import { usePlannerSession } from './plannerSessionStore';

interface AssetCard {
  id: string;
  title: string;
  assetType: string | null;
  url: string | null;
  tags: string[];
}

function envelopeToCard(envelope: CreatorAsset): AssetCard | null {
  if (!envelope?.id) return null;
  const current =
    envelope.versions?.find((v) => v.version === envelope.currentVersion) ??
    envelope.versions?.[envelope.versions.length - 1];
  const payload = current?.payload;
  return {
    id: envelope.id,
    title: (payload?.title && String(payload.title)) || 'Untitled asset',
    assetType: envelope.metadata?.assetType ?? payload?.creatorType ?? null,
    url: (payload?.url && String(payload.url)) || null,
    tags: Array.isArray(envelope.metadata?.tags) ? envelope.metadata.tags : [],
  };
}

const STATUS_STYLE: Record<AssignmentStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  ready: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  // P4 — protected execution states (per-item lock)
  materialized: 'bg-indigo-100 text-indigo-700',
  scheduled: 'bg-blue-100 text-blue-700',
  publishing: 'bg-violet-100 text-violet-700',
  published: 'bg-teal-100 text-teal-700',
  archived: 'bg-slate-200 text-slate-600',
};

interface Props {
  companyId?: string | null;
  campaignId?: string | null;
}

export function AssignmentWorkspace({ companyId, campaignId }: Props) {
  const { state, setAssignments } = usePlannerSession();
  const assignments = state.assignments ?? [];
  const slots = useMemo(() => deriveStructureSlots(state.calendar_plan), [state.calendar_plan]);

  // ── Content side: the Asset Library (P2, server-canonical) ──
  const [assets, setAssets] = useState<AssetCard[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [expandedAssignmentId, setExpandedAssignmentId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    installServerCreatorAssetBackend(companyId);
  }, [companyId]);

  // ── P5: Execution Lifecycle Synchronization (shared hook — recovery on
  // campaign reload, on-load event fold, manual refresh; never a timer). ──
  const { sync: syncExecution, lastSyncAt } = useAssignmentExecutionSync({
    campaignId,
    assignments,
    setAssignments,
  });

  const loadAssets = useCallback(async () => {
    if (!companyId) return;
    setAssetsLoading(true);
    try {
      const params = new URLSearchParams({ company_id: companyId, limit: '200' });
      if (query.trim()) params.set('q', query.trim());
      const res = await fetchWithAuth(`/api/creator-assets/library?${params.toString()}`);
      if (!res.ok) throw new Error(`library list failed (${res.status})`);
      const data = await res.json().catch(() => null);
      const entries: Array<{ asset: CreatorAsset }> = Array.isArray(data?.assets) ? data.assets : [];
      setAssets(entries.map((e) => envelopeToCard(e.asset)).filter((c): c is AssetCard => Boolean(c)));
    } catch {
      setAssets([]);
    } finally {
      setAssetsLoading(false);
    }
  }, [companyId, query]);

  useEffect(() => { void loadAssets(); }, [loadAssets]);

  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const assignableAssets: AssignableAsset[] = useMemo(
    () => assets.map((a) => ({ id: a.id, assetType: a.assetType, title: a.title, tags: a.tags })),
    [assets],
  );

  // ── AI advice (deterministic, assist-only — user applies explicitly) ──
  const gaps = useMemo(() => detectAssignmentGaps(slots, assignments), [slots, assignments]);
  const conflicts = useMemo(
    () => detectAssignmentConflicts(slots, assignments, assignableAssets),
    [slots, assignments, assignableAssets],
  );
  const suggestions = useMemo(
    () => (showSuggestions ? recommendAssignments(slots, assignableAssets, assignments) : []),
    [showSuggestions, slots, assignableAssets, assignments],
  );
  // P4 — execution readiness (assist-only report; finalize consumes the
  // confirmed assignments, this just tells the user where they stand).
  const readiness = useMemo(
    () => assessExecutionReadiness(slots, assignments, assignableAssets),
    [slots, assignments, assignableAssets],
  );

  // ── Assignment mutations (all through the pure model, all user-initiated) ──
  const doAssign = useCallback(
    (assetId: string, slot: StructureSlot) => {
      setAssignments((current) => assignAsset(current, { campaignId: campaignId ?? null, assetId, slot }).assignments);
    },
    [campaignId, setAssignments],
  );

  const onSlotDrop = useCallback(
    (event: React.DragEvent, slot: StructureSlot) => {
      event.preventDefault();
      const assetId = event.dataTransfer.getData('application/x-omnivyra-asset');
      const assignmentId = event.dataTransfer.getData('application/x-omnivyra-assignment');
      if (assetId) doAssign(assetId, slot);
      else if (assignmentId) setAssignments((current) => moveAssignment(current, assignmentId, slot));
    },
    [doAssign, setAssignments],
  );

  const weeks = useMemo(() => {
    const byWeek = new Map<number, StructureSlot[]>();
    for (const slot of slots) {
      const wk = slot.week ?? 0;
      byWeek.set(wk, [...(byWeek.get(wk) ?? []), slot]);
    }
    return Array.from(byWeek.entries()).sort((a, b) => a[0] - b[0]);
  }, [slots]);

  if (slots.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400 text-center px-6 py-16">
        Build the campaign skeleton first — the structure defines the publishing slots that content is assigned to.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex gap-3 p-3">
      {/* ── Structure + assignments (left) ── */}
      <div className="flex-1 min-w-0 overflow-y-auto space-y-4 pr-1">
        {/* P4 — readiness strip (report only; nothing here mutates) */}
        <div className={`rounded-lg border px-3 py-2 flex items-start gap-2 text-xs ${
          readiness.ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-600'
        }`}>
          {readiness.ready
            ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            : <Lightbulb className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-gray-400" />}
          <div className="min-w-0">
            <span className="font-medium">{readiness.summary}</span>
            <span className="text-gray-400">
              {' '}{readiness.assigned_slots}/{readiness.total_slots} slots assigned
              {readiness.materialized_count > 0 ? ` · ${readiness.materialized_count} in execution` : ''}
            </span>
            {readiness.schedule_imbalance.map((m) => (
              <div key={m} className="text-amber-700 mt-0.5">{m}</div>
            ))}
            {readiness.failed_publishing.length > 0 && (
              <div className="text-red-700 mt-0.5">
                {readiness.failed_publishing.length} assignment{readiness.failed_publishing.length === 1 ? '' : 's'} with publish failures — open the item for details.
              </div>
            )}
            {readiness.stalled_execution.length > 0 && (
              <div className="text-amber-700 mt-0.5">
                {readiness.stalled_execution.length} materialized item{readiness.stalled_execution.length === 1 ? '' : 's'} not yet scheduled while others progressed.
              </div>
            )}
            {readiness.execution_coverage.total > 0 && (
              <div className="text-gray-400 mt-0.5">
                Execution: {readiness.execution_coverage.scheduled} scheduled · {readiness.execution_coverage.publishing} publishing · {readiness.execution_coverage.published} published · {readiness.execution_coverage.archived} archived
              </div>
            )}
          </div>
          {campaignId && (
            <button
              type="button"
              onClick={() => void syncExecution()}
              title={lastSyncAt ? `Last synced ${new Date(lastSyncAt).toLocaleTimeString()}` : 'Sync lifecycle from execution'}
              className="ml-auto flex-shrink-0 flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-800"
            >
              <RefreshCw className="h-3 w-3" /> Sync
            </button>
          )}
        </div>
        {conflicts.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
            {conflicts.map((c, i) => (
              <div key={`${c.kind}-${i}`} className="flex items-start gap-2 text-xs text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>{c.message}</span>
              </div>
            ))}
          </div>
        )}

        {weeks.map(([week, weekSlots]) => (
          <div key={week} className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Week {week || '?'}
            </div>
            {weekSlots.map((slot) => {
              const slotAssignments = assignmentsForSlot(assignments, slot.structure_id);
              const isGap = slotAssignments.length === 0;
              return (
                <div
                  key={slot.structure_id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onSlotDrop(e, slot)}
                  className={`rounded-lg border px-3 py-2 transition-colors ${
                    isGap ? 'border-dashed border-gray-300 bg-gray-50/60' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">
                        {slot.day ?? 'Any day'} · {slot.platform ?? 'any platform'} · {slot.content_type ?? 'any type'}
                      </div>
                      {slot.title && <div className="text-xs text-gray-500 truncate">{slot.title}</div>}
                    </div>
                    <button
                      type="button"
                      disabled={!selectedAssetId}
                      onClick={() => selectedAssetId && doAssign(selectedAssetId, slot)}
                      className="flex-shrink-0 text-xs font-medium rounded-full border border-indigo-200 text-indigo-600 px-2.5 py-1 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Assign selected
                    </button>
                  </div>

                  {isGap ? (
                    <div className="mt-1.5 text-[11px] text-gray-400">
                      Unassigned — drag an asset here or select one on the right.
                    </div>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {slotAssignments.map((a, idx) => {
                        const asset = assetById.get(a.asset_id);
                        const expanded = expandedAssignmentId === a.id;
                        // P4 per-item lock: items in protected execution
                        // states are immutable; everything else stays editable.
                        const locked = isAssignmentLocked(a);
                        return (
                          <div
                            key={a.id}
                            draggable={!locked}
                            onDragStart={(e) => !locked && e.dataTransfer.setData('application/x-omnivyra-assignment', a.id)}
                            className={`rounded-md border px-2 py-1.5 ${locked ? 'border-indigo-100 bg-indigo-50/50' : 'border-gray-200 bg-gray-50 cursor-grab'}`}
                          >
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setExpandedAssignmentId(expanded ? null : a.id)}
                                className="flex-1 min-w-0 flex items-center gap-2 text-left"
                              >
                                <ImageIcon className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                                <span className="text-xs font-medium text-gray-800 truncate">
                                  {asset?.title ?? a.asset_id}
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${STATUS_STYLE[a.status]}`}>
                                  {a.status}
                                </span>
                                {a.execution_failure && (
                                  <span
                                    title={a.execution_failure.message ?? 'Publish failed'}
                                    className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 bg-red-100 text-red-700"
                                  >
                                    publish failed
                                  </span>
                                )}
                              </button>
                              {locked ? (
                                <span title="In execution — this item is locked; other assignments stay editable" className="flex-shrink-0 p-1 text-indigo-400">
                                  <Lock className="h-3 w-3" />
                                </span>
                              ) : (
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                <button type="button" title="Move up" disabled={idx === 0}
                                  onClick={() => setAssignments((cur) => reorderAssignments(cur, slot.structure_id, slotAssignments.map((s, i) => (i === idx - 1 ? a.id : i === idx ? slotAssignments[idx - 1].id : s.id))))}
                                  className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30">
                                  <ArrowUp className="h-3 w-3" />
                                </button>
                                <button type="button" title="Move down" disabled={idx === slotAssignments.length - 1}
                                  onClick={() => setAssignments((cur) => reorderAssignments(cur, slot.structure_id, slotAssignments.map((s, i) => (i === idx + 1 ? a.id : i === idx ? slotAssignments[idx + 1].id : s.id))))}
                                  className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30">
                                  <ArrowDown className="h-3 w-3" />
                                </button>
                                <button type="button" title="Duplicate assignment (reuses the same asset)"
                                  onClick={() => setAssignments((cur) => duplicateAssignment(cur, a.id).assignments)}
                                  className="p-1 text-gray-400 hover:text-gray-700">
                                  <Copy className="h-3 w-3" />
                                </button>
                                <button type="button" title={selectedAssetId ? 'Replace with the selected asset' : 'Select an asset on the right first'}
                                  disabled={!selectedAssetId || selectedAssetId === a.asset_id}
                                  onClick={() => selectedAssetId && setAssignments((cur) => replaceAssignmentAsset(cur, a.id, selectedAssetId))}
                                  className="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-30">
                                  <Replace className="h-3 w-3" />
                                </button>
                                <button type="button" title="Detach (the asset stays in the library)"
                                  onClick={() => setAssignments((cur) => unassignAssignment(cur, a.id))}
                                  className="p-1 text-gray-400 hover:text-red-600">
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                              )}
                            </div>

                            {expanded && (
                              <div className="mt-2 pt-2 border-t border-gray-200 space-y-2">
                                {asset?.url && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={asset.url} alt={asset.title} className="max-h-32 rounded border border-gray-200 object-contain" />
                                )}
                                {/* P5 — synchronized execution state (read-only view of the engine) */}
                                {(a.scheduled_post_id || a.execution_failure || a.execution_synced_at) && (
                                  <div className="text-[11px] text-gray-500 space-y-0.5">
                                    <div>
                                      <span className="font-medium text-gray-600">Execution:</span>{' '}
                                      {isAssignmentLocked(a) ? a.status : 'not yet handed off'}
                                      {a.scheduled_post_id ? <> · scheduled post <span className="font-mono">{a.scheduled_post_id}</span></> : ' · not scheduled'}
                                    </div>
                                    {a.execution_failure && (
                                      <div className="text-red-700">
                                        Publish failed{a.execution_failure.code ? ` (${a.execution_failure.code})` : ''}
                                        {a.execution_failure.message ? `: ${a.execution_failure.message}` : ''} — lifecycle preserved; the engine retries.
                                      </div>
                                    )}
                                    {a.execution_synced_at && (
                                      <div className="text-gray-400">Synced {new Date(a.execution_synced_at).toLocaleString()}</div>
                                    )}
                                  </div>
                                )}
                                {locked ? (
                                  <div className="text-[11px] text-indigo-600 flex items-center gap-1.5">
                                    <Lock className="h-3 w-3" />
                                    This assignment is {a.status} — it entered execution and is immutable. Unaffected assignments remain editable.
                                  </div>
                                ) : (
                                <>
                                <div className="flex items-center gap-2">
                                  <label className="text-[11px] text-gray-500">Status</label>
                                  <select
                                    value={a.status}
                                    onChange={(e) => setAssignments((cur) => updateAssignmentMetadata(cur, a.id, { status: e.target.value as AssignmentStatus }))}
                                    className="text-xs border border-gray-300 rounded px-1.5 py-0.5 bg-white"
                                  >
                                    <option value="draft">draft</option>
                                    <option value="ready">ready</option>
                                    <option value="confirmed">confirmed</option>
                                  </select>
                                  <label className="text-[11px] text-gray-500 ml-2">Move to</label>
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      const target = slots.find((s) => s.structure_id === e.target.value);
                                      if (target) setAssignments((cur) => moveAssignment(cur, a.id, target));
                                    }}
                                    className="text-xs border border-gray-300 rounded px-1.5 py-0.5 bg-white max-w-[180px]"
                                  >
                                    <option value="">choose slot…</option>
                                    {slots.filter((s) => s.structure_id !== slot.structure_id).map((s) => (
                                      <option key={s.structure_id} value={s.structure_id}>
                                        W{s.week ?? '?'} {s.day ?? ''} · {s.platform ?? 'any'} · {s.content_type ?? 'any'}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <input
                                  value={a.notes}
                                  onChange={(e) => setAssignments((cur) => updateAssignmentMetadata(cur, a.id, { notes: e.target.value }))}
                                  placeholder="Assignment notes…"
                                  className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                                />
                                </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Content: the Asset Library (right) ── */}
      <div className="w-[320px] flex-shrink-0 flex flex-col min-h-0 border border-gray-200 rounded-lg bg-white overflow-hidden">
        <div className="flex-shrink-0 px-3 py-2 border-b border-gray-200 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Asset Library</span>
            <button type="button" onClick={() => void loadAssets()} title="Refresh"
              className="p-1 text-gray-400 hover:text-gray-700">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search assets…"
              className="w-full text-xs border border-gray-300 rounded-md pl-7 pr-2 py-1.5"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowSuggestions((v) => !v)}
            className={`w-full flex items-center justify-center gap-1.5 text-xs font-medium rounded-md border px-2 py-1.5 ${
              showSuggestions ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Lightbulb className="h-3.5 w-3.5" />
            {showSuggestions ? 'Hide AI suggestions' : `AI suggestions (${gaps.length} gap${gaps.length === 1 ? '' : 's'})`}
          </button>
        </div>

        {showSuggestions && (
          <div className="flex-shrink-0 max-h-56 overflow-y-auto border-b border-gray-200 bg-indigo-50/40 px-3 py-2 space-y-1.5">
            {suggestions.length === 0 ? (
              <div className="text-[11px] text-gray-500">
                {gaps.length === 0 ? 'No gaps — every slot has content assigned.' : 'No suitable library assets found for the open gaps.'}
              </div>
            ) : (
              suggestions.map((s) => (
                <div key={`${s.slot.structure_id}-${s.asset_id}`} className="rounded-md border border-indigo-100 bg-white px-2 py-1.5">
                  <div className="text-[11px] text-gray-700">
                    <span className="font-medium">{assetById.get(s.asset_id)?.title ?? s.asset_id}</span>
                    {' → '}W{s.slot.week ?? '?'} {s.slot.day ?? ''} · {s.slot.platform ?? 'any'} · {s.slot.content_type ?? 'any'}
                  </div>
                  <div className="text-[10px] text-gray-400">{s.reason}</div>
                  <button
                    type="button"
                    onClick={() => doAssign(s.asset_id, s.slot)}
                    className="mt-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    Apply suggestion
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {assetsLoading ? (
            <div className="text-xs text-gray-400 px-2 py-4 text-center">Loading library…</div>
          ) : assets.length === 0 ? (
            <div className="text-xs text-gray-400 px-2 py-4 text-center">
              No assets in the library yet — create them in Creator Content, then assign them here.
            </div>
          ) : (
            assets.map((asset) => {
              const uses = assignments.filter((a) => a.asset_id === asset.id).length;
              const selected = selectedAssetId === asset.id;
              return (
                <button
                  key={asset.id}
                  type="button"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('application/x-omnivyra-asset', asset.id)}
                  onClick={() => setSelectedAssetId(selected ? null : asset.id)}
                  className={`w-full text-left rounded-md border px-2 py-1.5 cursor-grab transition-colors ${
                    selected ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {asset.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.url} alt="" className="h-8 w-8 rounded object-cover border border-gray-200 flex-shrink-0" />
                    ) : (
                      <div className="h-8 w-8 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <ImageIcon className="h-4 w-4 text-gray-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-gray-800 truncate">{asset.title}</div>
                      <div className="text-[10px] text-gray-400 truncate">
                        {asset.assetType ?? 'asset'}
                        {uses > 0 ? ` · used ${uses}×` : ''}
                        {asset.tags.length > 0 ? ` · ${asset.tags.slice(0, 2).join(', ')}` : ''}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
