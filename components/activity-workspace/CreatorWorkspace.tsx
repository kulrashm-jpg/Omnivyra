/**
 * CreatorWorkspace — Step-11 Creator-native production workspace.
 * ──────────────────────────────────────────────────────────────────────────
 * A DEDICATED Creator experience (NOT a writer-workspace adaptation). It
 * consumes `payload.creator_workspace` (the Step-10 reconstructed
 * CreatorWorkspaceTask) and drives the Step-10 creator-lifecycle
 * endpoint for edits / lifecycle transitions / reload.
 *
 * Hard domain separation: this component is rendered ONLY when a
 * reconstructed Creator task is present AND the UI flag is on. Text rows
 * never reach here (no `creator_workspace` in their payload), so the
 * existing Text Activity Workspace is byte-identical and untouched.
 *
 * Scheduler isolation preserved: the UI edits ONLY packaging /
 * production / adaptation copy. The scheduler_row is shown READ-ONLY and
 * is never mutated by the client — re-projection happens server-side in
 * the (pure) Step-9 layer behind the lifecycle endpoint.
 *
 * NO rendering infrastructure: reel/video is presented as production
 * GUIDANCE (shot list / pacing / overlays), never a render/preview UI.
 */

import React, { useMemo, useState } from 'react';
import {
  ArrowLeft, Loader2, RefreshCw, Save, Film, Image as ImageIcon,
  LayoutGrid, CheckCircle2, Clock, UploadCloud, X,
} from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import SharedMediaPanel from './SharedMediaPanel';
import ExternalVideoPanel from './ExternalVideoPanel';
import type { useActivityWorkspace } from '@/hooks/useActivityWorkspace';
import type {
  CreatorWorkspaceTask,
  CreatorProductionStatus,
} from '@/backend/services/creator/intelligence/workspace';

type S = ReturnType<typeof useActivityWorkspace>;

const STATUS_ORDER: CreatorProductionStatus[] = [
  'draft', 'awaiting_human_production', 'in_production', 'asset_uploaded',
  'approval_ready', 'ready_for_scheduling', 'scheduled',
];
const LEGAL_NEXT: Record<CreatorProductionStatus, CreatorProductionStatus[]> = {
  draft: ['ready_for_scheduling', 'awaiting_human_production'],
  awaiting_human_production: ['in_production'],
  in_production: ['asset_uploaded'],
  asset_uploaded: ['approval_ready', 'in_production'],
  approval_ready: ['ready_for_scheduling', 'in_production'],
  ready_for_scheduling: ['scheduled'],
  scheduled: [],
};

function familyIcon(fam: string | null) {
  if (fam === 'video') return <Film className="h-4 w-4" />;
  if (fam === 'carousel') return <LayoutGrid className="h-4 w-4" />;
  return <ImageIcon className="h-4 w-4" />;
}

function Section({ title, hint, children }: {
  title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-gray-500">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, textarea }: {
  label: string; value: string; onChange: (v: string) => void; textarea?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
      )}
    </label>
  );
}

export default function CreatorWorkspace({
  d,
  taskOverride,
  rowIdOverride,
}: {
  d: S;
  // Step-12: when rendered inside the bundle orchestrator, the selected
  // sibling variant + its row id are injected instead of payload's.
  taskOverride?: CreatorWorkspaceTask;
  rowIdOverride?: string;
}) {
  const payload = d.payload!;
  const rowId =
    (rowIdOverride ?? '').trim() ||
    String((payload as any).creator_workspace_row_id || '').trim();
  const serverTask =
    taskOverride ?? ((payload as any).creator_workspace as CreatorWorkspaceTask);

  // Editable local copy (Phase-4 editable surface only).
  const [task, setTask] = useState<CreatorWorkspaceTask>(serverTask);
  const [caption, setCaption] = useState(task.packaging_context.caption ?? '');
  const [hashtags, setHashtags] = useState((task.packaging_context.hashtags ?? []).join(', '));
  const [keywords, setKeywords] = useState((task.packaging_context.keywords ?? []).join(', '));
  const [cta, setCta] = useState(task.packaging_context.cta ?? '');
  const [adaptationNote, setAdaptationNote] = useState(task.platform_context.adaptation_note ?? '');
  const [overlays, setOverlays] = useState((task.production_context.overlays ?? []).join('\n'));
  const [creatorNotes, setCreatorNotes] = useState((task.production_context.creator_notes ?? []).join('\n'));
  const [productionNotes, setProductionNotes] = useState((task.production_context.production_notes ?? []).join('\n'));
  const [uploadRef, setUploadRef] = useState(task.workspace_meta?.uploaded_asset_ref ?? '');

  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [advancing, setAdvancing] = useState<CreatorProductionStatus | null>(null);
  const [generating, setGenerating] = useState(false);

  const endpoint = rowId ? `/api/activity-workspace/${encodeURIComponent(rowId)}/creator-lifecycle` : '';
  const canPersist = Boolean(endpoint);

  const splitList = (s: string, sep: RegExp) =>
    s.split(sep).map((x) => x.trim()).filter(Boolean);

  const applyServerTask = (next: CreatorWorkspaceTask) => {
    setTask(next);
    setCaption(next.packaging_context.caption ?? '');
    setHashtags((next.packaging_context.hashtags ?? []).join(', '));
    setKeywords((next.packaging_context.keywords ?? []).join(', '));
    setCta(next.packaging_context.cta ?? '');
    setAdaptationNote(next.platform_context.adaptation_note ?? '');
    setOverlays((next.production_context.overlays ?? []).join('\n'));
    setCreatorNotes((next.production_context.creator_notes ?? []).join('\n'));
    setProductionNotes((next.production_context.production_notes ?? []).join('\n'));
    setUploadRef(next.workspace_meta?.uploaded_asset_ref ?? '');
    d.setPayload?.({ ...(payload as any), creator_workspace: next });
  };

  const onSave = async () => {
    if (!canPersist || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit',
          change_source: 'creator-workspace-ui',
          edits: {
            caption,
            cta,
            hashtags: splitList(hashtags, /[,]/),
            keywords: splitList(keywords, /[,]/),
            overlays: splitList(overlays, /\n/),
            creator_notes: splitList(creatorNotes, /\n/),
            production_notes: splitList(productionNotes, /\n/),
            adaptation_note: adaptationNote,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Save failed');
      applyServerTask(json.creator_workspace as CreatorWorkspaceTask);
      d.notify?.('success', `Saved (revision ${json.creator_workspace?.workspace_meta?.workspace_revision ?? '?'})`);
    } catch (e) {
      d.notify?.('error', e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onReload = async () => {
    if (!canPersist || reloading) return;
    setReloading(true);
    try {
      const res = await apiFetch(endpoint, { method: 'GET' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Reload failed');
      applyServerTask(json.creator_workspace as CreatorWorkspaceTask);
      d.notify?.('info', 'Reloaded from persisted state');
    } catch (e) {
      d.notify?.('error', e instanceof Error ? e.message : 'Reload failed');
    } finally {
      setReloading(false);
    }
  };

  // Step-R3: synchronous AI image render. Flag-gated server-side (404
  // when OFF → graceful notice). On success, reload to pick up the
  // attached shared-media lineage.
  const onGenerateImage = async () => {
    if (!rowId || generating) return;
    setGenerating(true);
    try {
      const res = await apiFetch(
        `/api/activity-workspace/${encodeURIComponent(rowId)}/render-image`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      const json = await res.json();
      if (res.status === 404) { d.notify?.('info', 'Image rendering is not enabled.'); return; }
      // Step-R6: governance blocks (quota / emergency-stop / paused /
      // provider disabled) are operational, not errors — inform calmly.
      if (res.status === 429 || res.status === 503) {
        d.notify?.('info', `Rendering unavailable: ${json?.render?.reason || 'governance limit'}`);
        return;
      }
      if (!res.ok) throw new Error(json?.render?.reason || json?.error || 'Render failed');
      const r = json.render;
      // Step-R4: async queue path returns status:'queued'. Drive one
      // worker tick + poll status (no websockets) so the UI completes
      // end-to-end without a background cron.
      if (r.status === 'queued') {
        d.notify?.('info', 'Render queued — a worker will process it shortly.');
        const statusUrl = `/api/activity-workspace/${encodeURIComponent(rowId)}/render-status`;
        try {
          // Nudge one tick (autonomous workers also poll on a schedule),
          // then poll status a few times (no websockets).
          await apiFetch(statusUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'tick' }),
          });
          let qs = 'queued';
          for (let i = 0; i < 3; i++) {
            const sres = await apiFetch(statusUrl, { method: 'GET' });
            const sj = await sres.json();
            qs = sj?.render_status?.queue?.queue_state ?? qs;
            if (['completed', 'failed', 'cancelled'].includes(qs)) break;
          }
          if (qs === 'completed') d.notify?.('success', 'Render completed & attached.');
          else if (qs === 'failed') d.notify?.('error', 'Render failed — use Retry to try again.');
          else if (qs === 'retry_scheduled') d.notify?.('info', 'Transient failure — render auto-retry scheduled.');
          else d.notify?.('info', `Render ${qs} — workers will continue processing.`);
        } catch { d.notify?.('info', 'Render queued; check back shortly.'); }
        await onReload();
        return;
      }
      d.notify?.('success',
        r.status === 'reused' ? 'Reused existing rendered image (no duplicate render)'
          : `Image rendered & attached (${r.status})`);
      await onReload();
    } catch (e) {
      d.notify?.('error', e instanceof Error ? e.message : 'Render failed');
    } finally {
      setGenerating(false);
    }
  };

  const onAdvance = async (to: CreatorProductionStatus) => {
    if (!canPersist || advancing) return;
    setAdvancing(to);
    try {
      const res = await apiFetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'advance',
          to,
          change_source: 'creator-workspace-ui',
          ...(to === 'asset_uploaded' ? { uploaded_asset_ref: uploadRef.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Cannot move to ${to}`);
      applyServerTask(json.creator_workspace as CreatorWorkspaceTask);
      d.notify?.('success', `Status → ${to.replace(/_/g, ' ')}`);
    } catch (e) {
      d.notify?.('error', e instanceof Error ? e.message : 'Transition rejected');
    } finally {
      setAdvancing(null);
    }
  };

  const classification = task.adaptation_context.classification;
  const isShared = task.adaptation_context.is_shared_core_variant;
  const overrideKeys = Object.keys(task.adaptation_context.override_layer || {});
  const storyboard = (task.production_context.storyboard ?? []) as any[];
  const isReel = task.asset_family === 'video';
  const bp = task.production_context.blueprint as any;

  const statusIdx = STATUS_ORDER.indexOf(task.production_status);

  return (
    <div className="space-y-5">
      {/* ── Creator-native header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-900">
            {familyIcon(task.asset_family)}
            <h1 className="text-xl font-bold">Creator Production Workspace</h1>
            <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
              {task.asset_family ?? 'creator'}
            </span>
          </div>
          <p className="mt-1 text-sm text-indigo-800/80">
            {payload.title} • Platform: <strong>{task.platform_context.platform}</strong> •{' '}
            {classification.replace(/_/g, ' ')} •{' '}
            rev {task.workspace_meta?.workspace_revision ?? 0}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={d.handleBackToWeekPlan}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            <ArrowLeft className="h-4 w-4" /> Week plan
          </button>
          <button
            onClick={onReload}
            disabled={!canPersist || reloading}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            {reloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Reload
          </button>
          {task.asset_family === 'image' && rowId ? (
            <button
              onClick={onGenerateImage}
              disabled={generating}
              className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              title="Render an AI image and attach it across compatible platforms (flag-gated)"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
              Generate Image
            </button>
          ) : null}
          <button
            onClick={onSave}
            disabled={!canPersist || saving}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>
      </div>

      {!canPersist && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Read-only: this Creator row has no persistable id (legacy/preview). Editing is disabled.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 1 — Creative Brief */}
        <Section title="Creative Brief" hint="Strategic intent (read-only — locked behind the scheduler boundary)">
          <dl className="space-y-2 text-sm">
            <div><dt className="text-xs font-medium text-gray-500">Creative objective</dt><dd className="text-gray-900">{task.planning_context.creative_objective || '—'}</dd></div>
            <div><dt className="text-xs font-medium text-gray-500">Core message</dt><dd className="text-gray-900">{task.planning_context.core_message || '—'}</dd></div>
            <div><dt className="text-xs font-medium text-gray-500">Audience intent</dt><dd className="text-gray-900">{task.planning_context.audience_intent || '—'}</dd></div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Emotional goal</dt>
              <dd className="text-gray-900">
                {task.planning_context.emotional_goal.pain_point || '—'} →{' '}
                {task.planning_context.emotional_goal.outcome_promise || '—'}{' '}
                <span className="text-gray-500">({task.planning_context.emotional_goal.tone || 'neutral'})</span>
              </dd>
            </div>
            {bp ? (
              <div>
                <dt className="text-xs font-medium text-gray-500">Hook strategy</dt>
                <dd className="text-gray-900">
                  <div><span className="text-gray-500">Verbal:</span> {bp.hook ?? bp.hook_strategy?.verbal ?? '—'}</div>
                  <div><span className="text-gray-500">Visual:</span> {bp.opening_shot ?? bp.hook_strategy?.visual ?? '—'}</div>
                </dd>
              </div>
            ) : null}
          </dl>
        </Section>

        {/* 2 — Platform Variant + shared/override model */}
        <Section title="Platform Variant" hint="Shared creative core vs platform-specific override">
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${isShared ? 'bg-emerald-100 text-emerald-800' : 'bg-purple-100 text-purple-800'}`}>
                {isShared ? 'Shared creative core' : 'Platform-native (unique)'}
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                {classification.replace(/_/g, ' ')}
              </span>
              {task.adaptation_context.shared_core_id && (
                <span className="truncate rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500" title={task.adaptation_context.shared_core_id}>
                  core: {task.adaptation_context.shared_core_id.slice(0, 24)}…
                </span>
              )}
            </div>
            {overrideKeys.length > 0 && (
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-2 text-xs text-purple-800">
                Hybrid override on this platform: <strong>{overrideKeys.join(', ')}</strong>
              </div>
            )}
            <Field label="Adaptation note (editable)" value={adaptationNote} onChange={setAdaptationNote} textarea />
            <div className="text-xs text-gray-500">
              Hook angle: {task.platform_context.hook_angle || '—'} • Pacing: {task.platform_context.pacing || '—'}
            </div>
          </div>
        </Section>

        {/* 5 — Packaging / Metadata (editable) */}
        <Section title="Packaging & Metadata" hint="Marketing copy — persisted via the scheduler-safe re-projection">
          <div className="space-y-3">
            <Field label="Caption" value={caption} onChange={setCaption} textarea />
            <Field label="Hashtags (comma-separated)" value={hashtags} onChange={setHashtags} />
            <Field label="Keywords (comma-separated)" value={keywords} onChange={setKeywords} />
            <Field label="CTA" value={cta} onChange={setCta} />
          </div>
        </Section>

        {/* 3 — Production Guidance */}
        <Section title="Production Guidance" hint="What the creator/editor produces externally">
          <div className="space-y-3">
            {task.production_context.pacing_guidance && (
              <p className="rounded-lg bg-gray-50 p-2 text-xs text-gray-700">
                <strong>Pacing:</strong> {task.production_context.pacing_guidance}
              </p>
            )}
            {task.production_context.scene_direction && (
              <p className="rounded-lg bg-gray-50 p-2 text-xs text-gray-700 whitespace-pre-wrap">
                <strong>Scene direction:</strong> {task.production_context.scene_direction}
              </p>
            )}
            <Field label="Production notes (one per line)" value={productionNotes} onChange={setProductionNotes} textarea />
            <Field label="Creator notes (one per line)" value={creatorNotes} onChange={setCreatorNotes} textarea />
            <Field label="Overlay copy (one per line)" value={overlays} onChange={setOverlays} textarea />
          </div>
        </Section>
      </div>

      {/* 4 — Storyboard / Scene Flow (reel = shot list; carousel = slides; image = frame) */}
      <Section
        title={isReel ? 'Scene Flow (production shot list)' : task.asset_family === 'carousel' ? 'Slide Flow' : 'Visual Frame'}
        hint="Production guidance only — NOT a render/preview surface"
      >
        {isReel && bp ? (
          <div className="space-y-3">
            {bp.thumbnail_concept && (
              <p className="rounded-lg bg-indigo-50 p-2 text-xs text-indigo-800">
                <strong>Thumbnail concept:</strong> {bp.thumbnail_concept}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-gray-500">
                  <tr>
                    <th className="px-2 py-1">#</th><th className="px-2 py-1">Timing</th>
                    <th className="px-2 py-1">Objective</th><th className="px-2 py-1">Visual</th>
                    <th className="px-2 py-1">Talking point</th><th className="px-2 py-1">Overlay</th>
                    <th className="px-2 py-1">Transition</th>
                  </tr>
                </thead>
                <tbody className="text-gray-800">
                  {(bp.scene_sequence ?? storyboard).map((s: any, i: number) => (
                    <tr key={i} className="border-t border-gray-100 align-top">
                      <td className="px-2 py-1">{s.scene_index ?? i}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{s.duration_guidance ?? '—'}</td>
                      <td className="px-2 py-1">{s.scene_objective ?? '—'}</td>
                      <td className="px-2 py-1">{s.visual_direction ?? '—'}</td>
                      <td className="px-2 py-1">{s.talking_point ?? '—'}</td>
                      <td className="px-2 py-1">{s.overlay_text ?? '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{s.transition_style ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Array.isArray(bp.talking_points) && bp.talking_points.length > 0 && (
              <p className="text-xs text-gray-500">Talking points: {bp.talking_points.join(' · ')}</p>
            )}
          </div>
        ) : storyboard.length > 0 ? (
          <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {storyboard.map((s: any, i: number) => (
              <li key={i} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                <div className="mb-1 font-semibold text-gray-900">
                  {task.asset_family === 'carousel' ? `Slide ${s.index ?? i}` : `Frame ${i + 1}`}
                  {s.role ? <span className="ml-1 text-gray-500">({s.role})</span> : null}
                </div>
                <div className="whitespace-pre-wrap">
                  {s.headline ? <div><strong>{s.headline}</strong></div> : null}
                  {s.body ?? s.subject ?? s.style ?? JSON.stringify(s)}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-gray-500">No storyboard skeleton on this row (card-derived / flag off).</p>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 6 — Human Production lane */}
        <Section title="Human Production Status" hint="External production tracking — no rendering performed here">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_ORDER.map((st, i) => (
                <span
                  key={st}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    i < statusIdx ? 'bg-emerald-100 text-emerald-700'
                      : i === statusIdx ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {st.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <span className="inline-flex items-center gap-1">
                {task.requires_human_production ? <Clock className="h-3.5 w-3.5 text-amber-600" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                {task.requires_human_production ? 'Requires human production' : 'Auto-producible (image/carousel)'}
              </span>
              <span>•</span>
              <span>{task.scheduler_eligible ? 'Scheduler-eligible' : 'Not yet scheduler-eligible'}</span>
            </div>
            {task.requires_human_production && (
              <div className="flex items-center gap-2">
                <UploadCloud className="h-4 w-4 text-gray-500" />
                <input
                  value={uploadRef}
                  onChange={(e) => setUploadRef(e.target.value)}
                  placeholder="External uploaded asset URL/ref"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {(LEGAL_NEXT[task.production_status] || []).map((to) => (
                <button
                  key={to}
                  onClick={() => onAdvance(to)}
                  disabled={!canPersist || advancing !== null || (to === 'asset_uploaded' && !uploadRef.trim())}
                  className="flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                  title={to === 'asset_uploaded' && !uploadRef.trim() ? 'Provide an uploaded asset ref first' : undefined}
                >
                  {advancing === to ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  → {to.replace(/_/g, ' ')}
                </button>
              ))}
              {(LEGAL_NEXT[task.production_status] || []).length === 0 && (
                <span className="text-xs text-gray-400">Terminal state — no further transitions.</span>
              )}
            </div>
          </div>
        </Section>

        {/* 7 — Scheduling Readiness (scheduler_row read-only) */}
        <Section title="Scheduling Readiness" hint="Scheduler-bound projection — READ-ONLY (boundary enforced server-side)">
          <div className="space-y-2 text-xs">
            <div className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${task.scheduler_eligible ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>
              {task.scheduler_eligible ? <CheckCircle2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              {task.scheduler_eligible ? 'Eligible for scheduling' : 'Not scheduler-eligible'}
            </div>
            <pre className="max-h-56 overflow-auto rounded-lg bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">
{JSON.stringify({
  intent_type: task.scheduler_row.intent_type,
  asset_type: task.scheduler_row.asset_type,
  packaging: task.scheduler_row.packaging,
  asset_payload_keys: Object.keys(task.scheduler_row.asset_payload || {}),
}, null, 2)}
            </pre>
            <p className="text-gray-500">
              Edits above re-project safely into this row on Save (strategic context never crosses the boundary).
            </p>
          </div>
        </Section>
      </div>

      {/* Shared media inheritance (media-only; additive, hides if N/A) */}
      {rowId && task.asset_family === 'video'
        ? <ExternalVideoPanel rowId={rowId} notify={d.notify} /> : null}
      {rowId ? <SharedMediaPanel rowId={rowId} notify={d.notify} /> : null}
    </div>
  );
}
