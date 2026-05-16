/**
 * ExternalVideoPanel — human-production external video (additive).
 * ──────────────────────────────────────────────────────────────────────────
 * Upload (paste URL) an EXTERNALLY produced video and attach it into the
 * shared-media lineage so it auto-inherits across compatible platforms,
 * with platform-native captions preserved (text never shared here).
 *
 * NO AI video rendering. Gracefully hides when the endpoint/flag is
 * unavailable. Storyboard/pacing/talking-points are already rendered by
 * the CreatorWorkspace video Scene-Flow section — this panel adds the
 * external-video attach + inheritance visibility + overrides only.
 */

import React, { useEffect, useState } from 'react';
import { Loader2, Film, LinkIcon, Ban, RotateCcw } from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';

type Res = { platform: string; source: string; asset_id: string | null; reason?: string };

const STYLE: Record<string, string> = {
  inherited: 'bg-emerald-100 text-emerald-700',
  overridden_replaced: 'bg-purple-100 text-purple-700',
  overridden_disabled: 'bg-gray-200 text-gray-600',
  not_inherited: 'bg-gray-100 text-gray-500',
  incompatible: 'bg-red-100 text-red-700',
};

export default function ExternalVideoPanel({ rowId, notify }: {
  rowId: string;
  notify?: (t: 'success' | 'error' | 'info', m: string) => void;
}) {
  const endpoint = rowId ? `/api/activity-workspace/${encodeURIComponent(rowId)}/shared-media` : '';
  const [sm, setSm] = useState<any>(null);
  const [url, setUrl] = useState('');
  const [aspect, setAspect] = useState('9:16');
  const [duration, setDuration] = useState('');
  const [busy, setBusy] = useState('');

  const load = async () => {
    if (!endpoint) return;
    try {
      const r = await apiFetch(endpoint, { method: 'GET' });
      const j = await r.json();
      setSm(r.ok ? j.shared_media : null);
    } catch { setSm(null); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [rowId]);

  const patch = async (body: any, label: string, finalize = false) => {
    if (!endpoint || busy) return;
    setBusy(label);
    try {
      const r = await apiFetch(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'failed');
      if (finalize) {
        await apiFetch(endpoint, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'finalize-video-publishing' }),
        });
      }
      notify?.('success', `External video: ${label}`);
      await load();
    } catch (e) {
      notify?.('error', e instanceof Error ? e.message : 'failed');
    } finally { setBusy(''); }
  };

  const attach = () => {
    const u = url.trim();
    if (!u) { notify?.('error', 'Paste a video URL first'); return; }
    patch({
      action: 'attach-external-video', external_video_url: u,
      aspect_ratio: aspect || null,
      duration_seconds: duration ? Number(duration) : null,
      provider_type: /youtube|youtu\.be/.test(u) ? 'youtube' : /vimeo/.test(u) ? 'vimeo' : /loom/.test(u) ? 'loom' : 'external_cdn',
    }, 'attached', true);
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center gap-2 text-gray-900">
        <Film className="h-4 w-4" />
        <h2 className="text-base font-semibold">External Video (human-production)</h2>
        <span className="text-xs text-gray-500">no AI rendering — captions stay platform-native</span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[260px]">
          <span className="mb-1 block text-xs font-medium text-gray-600">Upload / paste video URL</span>
          <div className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-gray-400" />
            <input
              value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… (upload, YouTube, Vimeo, Loom, CDN)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-gray-600">Aspect</span>
          <input value={aspect} onChange={(e) => setAspect(e.target.value)} className="w-24 rounded-lg border border-gray-300 px-2 py-2 text-sm" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-gray-600">Duration (s)</span>
          <input value={duration} onChange={(e) => setDuration(e.target.value)} className="w-24 rounded-lg border border-gray-300 px-2 py-2 text-sm" />
        </label>
        <button
          onClick={attach} disabled={busy !== ''}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy === 'attached' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
          Attach &amp; inherit
        </button>
      </div>

      {sm?.attached && (
        <div className="mt-4">
          <div className="mb-2 text-xs text-gray-500">
            Shared video: <span className="font-mono">{String(sm.asset_id).slice(0, 28)}…</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(sm.resolutions ?? []).map((r: Res) => (
              <div key={r.platform} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${STYLE[r.source] ?? 'bg-gray-100 text-gray-600'}`} title={r.reason || r.source}>
                <span className="capitalize">{r.platform}</span>
                <span className="opacity-70">· {r.source.replace(/_/g, ' ')}</span>
                {r.source === 'inherited' && (
                  <button title="Disable for this platform" disabled={busy !== ''}
                    onClick={() => patch({ action: 'override', platform: r.platform, kind: 'disabled' }, `disable:${r.platform}`, true)}>
                    <Ban className="h-3.5 w-3.5" />
                  </button>
                )}
                {(r.source === 'overridden_disabled' || r.source === 'overridden_replaced') && (
                  <button title="Revert to inherited video" disabled={busy !== ''}
                    onClick={() => patch({ action: 'revert', platform: r.platform }, `revert:${r.platform}`, true)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-[11px] text-gray-400">
        One external video propagates across compatible platforms; each platform keeps its own caption, hashtags and CTA.
      </p>
    </section>
  );
}
