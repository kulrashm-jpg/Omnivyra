/**
 * SharedMediaPanel — Phase-8 media-inheritance controls (additive).
 * ──────────────────────────────────────────────────────────────────────────
 * Renders the resolved per-platform media inheritance for a Creator row
 * and lets the user: toggle "use across supported platforms", disable a
 * platform's inherited media, or revert an override (lossless).
 *
 * MEDIA ONLY — it shows/edits which platforms reuse the SHARED asset.
 * It never displays or edits captions/hashtags/CTA (platform-native text
 * is produced elsewhere and untouched). Gracefully renders nothing when
 * the endpoint is unavailable / no asset attached (backward compatible).
 */

import React, { useEffect, useState } from 'react';
import { Loader2, Image as ImageIcon, Ban, RotateCcw, Layers } from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';

type Resolution = {
  platform: string;
  source: 'inherited' | 'overridden_replaced' | 'overridden_disabled' | 'not_inherited' | 'incompatible';
  asset_id: string | null;
  reason?: string;
};
type SharedMedia = {
  content_core_id: string;
  attached: boolean;
  asset_id?: string;
  override_policy?: string;
  is_default_selected?: boolean;
  resolutions?: Resolution[];
  inherited_platforms?: string[];
};

const SOURCE_STYLE: Record<Resolution['source'], string> = {
  inherited: 'bg-emerald-100 text-emerald-700',
  overridden_replaced: 'bg-purple-100 text-purple-700',
  overridden_disabled: 'bg-gray-200 text-gray-600',
  not_inherited: 'bg-gray-100 text-gray-500',
  incompatible: 'bg-red-100 text-red-700',
};

export default function SharedMediaPanel({ rowId, notify }: {
  rowId: string;
  notify?: (t: 'success' | 'error' | 'info', m: string) => void;
}) {
  const endpoint = rowId ? `/api/activity-workspace/${encodeURIComponent(rowId)}/shared-media` : '';
  const [sm, setSm] = useState<SharedMedia | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  const load = async () => {
    if (!endpoint) return;
    setLoading(true);
    try {
      const r = await apiFetch(endpoint, { method: 'GET' });
      const j = await r.json();
      if (r.ok) setSm(j.shared_media);
      else setSm(null);
    } catch { setSm(null); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [rowId]);

  const patch = async (body: Record<string, unknown>, label: string) => {
    if (!endpoint || busy) return;
    setBusy(label);
    try {
      const r = await apiFetch(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'failed');
      setSm(j.shared_media);
      notify?.('success', `Media inheritance updated (${label})`);
    } catch (e) {
      notify?.('error', e instanceof Error ? e.message : 'update failed');
    } finally { setBusy(''); }
  };

  // Backward compatible: hide entirely if unavailable / not attached.
  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading shared media…
      </div>
    );
  }
  if (!sm) return null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-900">
          <Layers className="h-4 w-4" />
          <h2 className="text-base font-semibold">Shared Media Inheritance</h2>
          <span className="text-xs text-gray-500">(media only — captions stay platform-native)</span>
        </div>
        {sm.attached && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={!!sm.is_default_selected}
              disabled={busy !== ''}
              onChange={(e) => patch(
                { action: 'policy', override_policy: e.target.checked ? 'inherit_all' : 'manual',
                  is_default_selected: e.target.checked },
                'default',
              )}
            />
            Use this media across supported platforms
          </label>
        )}
      </div>

      {!sm.attached ? (
        <p className="text-sm text-gray-500">
          No shared media asset attached to this content core yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(sm.resolutions ?? []).map((r) => (
            <div
              key={r.platform}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${SOURCE_STYLE[r.source]}`}
              title={r.reason || r.source}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              <span className="capitalize">{r.platform}</span>
              <span className="opacity-70">· {r.source.replace(/_/g, ' ')}</span>
              {r.source === 'inherited' && (
                <button
                  className="ml-1 rounded p-0.5 hover:bg-white/60"
                  title="Disable inherited media for this platform"
                  disabled={busy !== ''}
                  onClick={() => patch({ action: 'override', platform: r.platform, kind: 'disabled' }, `disable:${r.platform}`)}
                >
                  <Ban className="h-3.5 w-3.5" />
                </button>
              )}
              {(r.source === 'overridden_disabled' || r.source === 'overridden_replaced') && (
                <button
                  className="ml-1 rounded p-0.5 hover:bg-white/60"
                  title="Revert to inherited media"
                  disabled={busy !== ''}
                  onClick={() => patch({ action: 'revert', platform: r.platform }, `revert:${r.platform}`)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-gray-400">
        One media asset propagates across compatible platforms; each platform still gets its own
        caption, hashtags, and CTA.
      </p>
    </section>
  );
}
