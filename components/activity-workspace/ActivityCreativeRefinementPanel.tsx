'use client';

/**
 * "Refine creative" — the AI creative this activity already produced.
 *
 * WHAT THIS IS
 * ------------
 * Campaign generation has always made a real image for an activity and
 * recorded it against that activity's row. This is the first screen to show it,
 * and the first place a person can do anything about it.
 *
 * It is DELIBERATELY not the "+ Add image" control next to it. That one picks a
 * stock photograph to accompany the post and is unchanged; this one is about
 * the generated creative itself — the user's own picture, how it should be
 * used, and a re-render. Two different promises, so two different actions,
 * rather than one button meaning whichever thing the user happened to expect.
 *
 * WHAT IT REUSES
 * --------------
 * Everything. The upload, the guided treatment proposal, the instruction field,
 * the acceptance flow and the disclosure all come from `CreatorImageAssetPanel`
 * exactly as Content Creator uses them. The only thing this supplies is
 * IDENTITY: which composition the references belong to — this activity's, which
 * is durable and server-derived, never the Creator's per-session token.
 */

import React from 'react';
import { Sparkles, ImageIcon, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import CreatorImageAssetPanel from '../creator/CreatorImageAssetPanel';

interface ActivityCreative {
  activity_id: string;
  creator_asset_id: string | null;
  asset_type: string | null;
  template_id: string | null;
  template_slots: unknown[] | null;
  urls: string[];
  content_status: string | null;
  current_version: number;
  is_refined: boolean;
  composition_type: string;
  composition_id: string;
  refinable: boolean;
}

/** The families whose renderers can actually consume a reference today. */
function assetFamily(assetType: string | null): 'image' | 'carousel' | 'infographic' {
  const t = String(assetType || '').toLowerCase();
  if (t.includes('infographic')) return 'infographic';
  if (t.includes('carousel')) return 'carousel';
  return 'image';
}

export default function ActivityCreativeRefinementPanel({
  companyId,
  activityId,
}: {
  companyId: string | null | undefined;
  activityId: string | null | undefined;
}) {
  const [creative, setCreative] = React.useState<ActivityCreative | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [refining, setRefining] = React.useState(false);
  const [refined, setRefined] = React.useState<
    { version: number; original_version: number; urls: string[] } | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);

  const ready = Boolean(companyId && activityId);

  /**
   * Render the refinement and record it as a new version.
   *
   * No references are sent: they already belong to this activity's composition
   * and the server resolves them. That is what keeps one answer in the codebase
   * about what a reference means.
   */
  const runRefinement = async () => {
    if (!ready || refining) return;
    setRefining(true); setError(null); setRefined(null);
    try {
      const res = await apiFetch('/api/activity-workspace/refine-creative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, activity_id: activityId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setError(data?.error || 'The refinement could not be completed. Your original is unchanged.');
        return;
      }
      setRefined({
        version: Number(data.version),
        original_version: Number(data.original_version),
        urls: Array.isArray(data.urls) ? data.urls : [],
      });
    } catch {
      setError('The refinement could not be completed. Your original is unchanged.');
    } finally {
      setRefining(false);
    }
  };

  React.useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch(
          `/api/activity-workspace/creative?company_id=${encodeURIComponent(String(companyId))}`
          + `&activity_id=${encodeURIComponent(String(activityId))}`,
        );
        const data = await res.json().catch(() => null);
        if (!cancelled) setCreative(res.ok && data ? data as ActivityCreative : null);
      } catch {
        /* transient — the card simply does not offer refinement this render */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, companyId, activityId]);

  if (!ready || loading) return null;
  // Nothing generated yet, or this activity has no creative of its own. Silence
  // is right here: the card already shows the activity's own status, and an
  // empty "refine" affordance would promise something that cannot happen yet.
  if (!creative || !creative.refinable) return null;

  const preview = creative.urls[0] ?? null;

  return (
    <div className="px-4 py-3 border-t border-gray-100 space-y-2">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
        Generated creative
      </div>

      <div className="flex items-start gap-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="The creative generated for this activity"
            className="h-20 w-20 rounded-lg border border-gray-200 object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
            <ImageIcon className="h-5 w-5 text-gray-300" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-600">
            {creative.is_refined
              ? `Your refined version ${creative.current_version}. The campaign original is still saved.`
              : 'This is the image we made for this activity.'}
          </p>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-800 hover:border-indigo-400"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {open ? 'Close' : 'Refine creative'}
          </button>
          {!open ? (
            <p className="mt-1 text-[11px] text-gray-400">
              Add your own picture and tell us how to use it. The original stays saved.
            </p>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-2">
          {/*
            * The SAME panel Content Creator uses — not a copy of it.
            *
            * `compositionId` is the only thing that differs, and it is the whole
            * point: references attach to THIS activity rather than to whatever
            * the browser session was last composing.
            */}
          <CreatorImageAssetPanel
            companyId={companyId}
            compositionId={creative.composition_id}
            /* What this design accepts. Without them the panel would offer
             * no usages and the upload would have nowhere to go. */
            templateSlots={(creative.template_slots ?? null) as never}
            creatorTypeLabel="this activity"
            assetFamily={assetFamily(creative.asset_type)}
          />
          <button
            type="button"
            disabled={refining}
            onClick={() => void runRefinement()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-indigo-500 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {refining ? 'Generating…' : 'Generate refined version'}
          </button>
          <p className="px-1 pb-1 pt-1 text-[11px] text-gray-500">
            Refining creates a new version. The original stays saved.
          </p>
          {/* Truthful either way: a refusal says the original is intact rather
            * than leaving the user to guess what happened to it. */}
          {error ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
              {error}
            </p>
          ) : null}
          {refined ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2">
              <p className="text-[11px] font-semibold text-emerald-900">
                Refined version {refined.version} is now current.
              </p>
              <p className="mt-0.5 text-[11px] text-emerald-800">
                Version {refined.original_version} is the original from your campaign, still saved.
              </p>
              {refined.urls[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={refined.urls[0]}
                  alt="The refined creative"
                  className="mt-2 h-20 w-20 rounded-lg border border-emerald-200 object-cover"
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
