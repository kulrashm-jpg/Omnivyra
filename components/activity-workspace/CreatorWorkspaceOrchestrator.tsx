/**
 * CreatorWorkspaceOrchestrator — Step-12 multi-variant shell.
 * ──────────────────────────────────────────────────────────────────────────
 * Wraps the Step-11 single-variant <CreatorWorkspace>. On mount it
 * fetches the bundle (sibling platform variants of one card lineage)
 * from the creator-bundle endpoint and, when >1 variant exists, renders:
 *
 *   • a side-by-side variant strip (select which platform to edit)
 *   • an override-aware shared-core SYNC panel (propagate shared fields
 *     to non-overridden variants, optimistic revision check)
 *   • a conflict banner when another editor moved the core revision
 *
 * Graceful + additive: if the flag is off, the bundle has ≤1 variant, or
 * the fetch fails, it renders the plain single-variant workspace exactly
 * as Step-11 did (backward compatible). Scheduler boundary, human-
 * production lane and reel guidance are untouched (they live in the
 * wrapped component).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, GitBranch, RefreshCw, AlertTriangle, Layers } from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import type { useActivityWorkspace } from '@/hooks/useActivityWorkspace';
import type {
  CreatorWorkspaceBundle,
  CreatorWorkspaceTask,
} from '@/backend/services/creator/intelligence/workspace';
import CreatorWorkspace from './CreatorWorkspace';

type S = ReturnType<typeof useActivityWorkspace>;

const SYNC_FIELDS: Array<keyof any> = [
  'caption', 'hashtags', 'keywords', 'cta',
  'overlays', 'creator_notes', 'production_notes',
];

export default function CreatorWorkspaceOrchestrator({ d }: { d: S }) {
  const payload = d.payload!;
  const anchorRowId = String((payload as any).creator_workspace_row_id || '').trim();

  const [bundle, setBundle] = useState<CreatorWorkspaceBundle | null>(null);
  const [rowIds, setRowIds] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [conflict, setConflict] = useState<null | { expected: number; current: number; by: string }>(null);

  const endpoint = anchorRowId
    ? `/api/activity-workspace/${encodeURIComponent(anchorRowId)}/creator-bundle`
    : '';

  const fetchBundle = async () => {
    if (!endpoint) return;
    setLoading(true);
    try {
      const res = await apiFetch(endpoint, { method: 'GET' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'bundle load failed');
      const b = json.creator_bundle as CreatorWorkspaceBundle;
      setBundle(b);
      setRowIds(json.platform_row_ids || {});
      setConflict(null);
      setSelected((prev) =>
        prev && b.variants.some((v) => v.platform_context.platform === prev)
          ? prev
          : b.variants[0]?.platform_context.platform ?? '',
      );
    } catch {
      setBundle(null); // graceful → single-variant fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBundle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorRowId]);

  const selectedVariant: CreatorWorkspaceTask | null = useMemo(() => {
    if (!bundle) return null;
    return bundle.variants.find((v) => v.platform_context.platform === selected)
      ?? bundle.variants[0] ?? null;
  }, [bundle, selected]);

  const onSyncShared = async () => {
    if (!bundle?.shared_core || !endpoint || syncing) return;
    const core = bundle.shared_core;
    const edits: Record<string, unknown> = {};
    for (const f of SYNC_FIELDS) {
      (edits as any)[f] = (core.packaging_context as any)[f]
        ?? (core.production_context as any)[f];
    }
    edits.caption = core.packaging_context.caption;
    edits.hashtags = core.packaging_context.hashtags;
    edits.keywords = core.packaging_context.keywords;
    edits.cta = core.packaging_context.cta;
    edits.overlays = core.production_context.overlays;
    edits.creator_notes = core.production_context.creator_notes;
    edits.production_notes = core.production_context.production_notes;

    setSyncing(true);
    try {
      const res = await apiFetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync-shared',
          change_source: 'creator-bundle-ui',
          expected_core_revision: bundle.synchronization?.core_revision ?? 0,
          edits,
        }),
      });
      const json = await res.json();
      if (res.status === 409 && json?.code === 'STALE_WORKSPACE_EDIT') {
        setConflict({
          expected: json.conflict?.expected_revision,
          current: json.conflict?.current_revision,
          by: json.conflict?.last_editor ?? 'another editor',
        });
        d.notify?.('error', 'Shared core changed elsewhere — reload to merge.');
        return;
      }
      if (!res.ok) throw new Error(json?.error || 'sync failed');
      setBundle(json.creator_bundle as CreatorWorkspaceBundle);
      setRowIds(json.platform_row_ids || rowIds);
      setConflict(null);
      d.notify?.('success',
        `Synced shared core → ${json.propagated_to?.length ?? 0} variant(s)`);
    } catch (e) {
      d.notify?.('error', e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // ── Fallback: no bundle / single variant → Step-11 behavior ──────────
  if (!bundle || bundle.variants.length <= 1) {
    return <CreatorWorkspace d={d} />;
  }

  const sync = bundle.synchronization;
  const overrideLayers = bundle.override_layers ?? {};

  return (
    <div className="space-y-4">
      {/* Multi-variant orchestration bar */}
      <div className="rounded-xl border border-indigo-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-900">
            <Layers className="h-4 w-4" />
            <h2 className="text-sm font-semibold">
              {bundle.variants.length} platform variants •{' '}
              {bundle.classification.replace(/_/g, ' ')}
            </h2>
            {sync && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${sync.in_sync ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {sync.in_sync ? 'in sync' : 'drift — sync recommended'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchBundle}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Reload bundle
            </button>
            {bundle.shared_core && (
              <button
                onClick={onSyncShared}
                disabled={syncing}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                title="Propagate shared-core fields to every non-overridden variant"
              >
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
                Sync shared core
              </button>
            )}
          </div>
        </div>

        {conflict && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Conflict: shared core is at revision {conflict.current} (you had {conflict.expected}),
              last edited by {conflict.by}. Reload the bundle and re-apply your change.
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {bundle.variants.map((v) => {
            const p = v.platform_context.platform;
            const isCore = bundle.shared_core?.platform_context.platform === p;
            const overrides = overrideLayers[p] ?? [];
            return (
              <button
                key={v.task_id}
                onClick={() => setSelected(p)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  selected === p
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="capitalize">{p}</span>
                {isCore && <span className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">core</span>}
                {overrides.length > 0 && (
                  <span className="rounded bg-purple-100 px-1 text-[10px] text-purple-700" title={overrides.join(', ')}>
                    {overrides.length} override{overrides.length > 1 ? 's' : ''}
                  </span>
                )}
                <span className="text-[10px] text-gray-400">
                  r{v.workspace_meta?.workspace_revision ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected variant — full Step-11 editor (remounts per variant) */}
      {selectedVariant && (
        <CreatorWorkspace
          key={selectedVariant.task_id}
          d={d}
          taskOverride={selectedVariant}
          rowIdOverride={rowIds[selectedVariant.platform_context.platform] ?? ''}
        />
      )}
    </div>
  );
}
