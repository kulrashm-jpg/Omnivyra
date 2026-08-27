/**
 * P3-B — the per-slot content package review panel.
 *
 * Renders what the scheduler will actually attempt for ONE campaign slot: the
 * approved text alongside the assets assigned to it, plus a derived readiness
 * verdict. Before this, the Content Workspace showed text and an "asset
 * assigned" badge — a reviewer could approve copy without ever seeing the
 * image, or the missing image, that would ship with it.
 *
 * Read-only by design. Every mutation (edit, approve, regenerate, assist,
 * assign) stays with the surfaces that already own it — this panel changes no
 * action and persists nothing. `readiness` is DERIVED on each render from
 * lib/campaign/slotReadiness; it is never stored.
 *
 * Assets are resolved from the company-scoped library the Alignment workspace
 * and Finalize already use, so ownership is enforced server-side by the
 * existing endpoint rather than by anything here.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, FileVideo, HelpCircle, ImageOff, Layers } from 'lucide-react';
import type { SlotReviewPackage, SlotReadinessCode, ReviewAsset } from '../../lib/campaign/slotReadiness';

const VERDICT: Record<SlotReadinessCode, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ready:             { label: 'Ready',            cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  blocked_text:      { label: 'Content not ready', cls: 'bg-gray-100 text-gray-600 border-gray-200',        Icon: Clock },
  blocked_asset:     { label: 'Asset not ready',   cls: 'bg-amber-50 text-amber-800 border-amber-200',      Icon: AlertTriangle },
  blocked_execution: { label: 'Cannot publish media', cls: 'bg-red-50 text-red-700 border-red-200',         Icon: AlertTriangle },
  execution_unknown: { label: 'Approved',          cls: 'bg-sky-50 text-sky-700 border-sky-200',            Icon: HelpCircle },
};

/** One asset — a single image, an ordered carousel, or a video reference. */
function AssetReview({ asset }: { asset: ReviewAsset }) {
  const isCarousel = asset.slides.length > 1;

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-200">
        {isCarousel ? <Layers className="h-3.5 w-3.5 text-gray-500" />
          : asset.is_video ? <FileVideo className="h-3.5 w-3.5 text-gray-500" />
          : null}
        <span className="text-xs font-medium text-gray-800 truncate">
          {asset.title ?? asset.asset_id}
        </span>
        {asset.creator_type && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 capitalize shrink-0">
            {asset.creator_type}
          </span>
        )}
        {isCarousel && (
          <span className="text-[10px] text-gray-500 shrink-0">{asset.slides.length} slides</span>
        )}
        {asset.slot_role && (
          <span className="text-[10px] text-gray-400 shrink-0">· {asset.slot_role}</span>
        )}
        {asset.approval !== 'not_required' && (
          <span
            className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
              asset.approval === 'approved' ? 'bg-emerald-50 text-emerald-700'
                : asset.approval === 'rejected' ? 'bg-red-50 text-red-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            {asset.approval}
          </span>
        )}
      </div>

      {asset.missing ? (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-amber-800 bg-amber-50/50">
          <ImageOff className="h-4 w-4 shrink-0" />
          This asset is assigned to the slot but was not found in the library. It will not publish.
        </div>
      ) : asset.is_video ? (
        <div className="px-3 py-3 space-y-1">
          {asset.slides[0]?.available ? (
            <>
              <p className="text-[11px] text-gray-500">Video reference</p>
              <a
                href={asset.slides[0].url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-600 hover:text-indigo-800 break-all"
              >
                {asset.slides[0].url}
              </a>
              <p className="text-[10px] text-gray-400">
                Hosted externally — Omnivyra does not guarantee its availability at publish time.
              </p>
            </>
          ) : (
            <p className="text-xs text-amber-800">No usable video URL on this asset.</p>
          )}
        </div>
      ) : (
        // Image or carousel: every slide is rendered, in order, including the
        // unavailable ones — omitting a slide would let 4-of-5 read as whole.
        <div className={isCarousel ? 'flex gap-2 overflow-x-auto p-3' : 'p-3'}>
          {asset.slides.map((slide) => (
            <figure
              key={slide.index}
              className={isCarousel ? 'shrink-0 w-28' : 'w-full max-w-xs'}
            >
              {slide.available ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={slide.url ?? ''}
                  alt={isCarousel ? `Slide ${slide.index}` : (asset.title ?? 'Assigned asset')}
                  className="w-full rounded border border-gray-200 object-contain bg-gray-50"
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-1 h-24 rounded border border-dashed border-amber-300 bg-amber-50 text-amber-700">
                  <ImageOff className="h-4 w-4" />
                  <span className="text-[10px]">Unavailable</span>
                </div>
              )}
              {isCarousel && (
                <figcaption className="mt-1 text-[10px] text-gray-500 text-center">
                  Slide {slide.index}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

export function SlotReviewPanel({ pkg }: { pkg: SlotReviewPackage }) {
  const verdict = VERDICT[pkg.readiness.code];
  const { Icon } = verdict;

  return (
    <div className="space-y-2">
      {/* Derived readiness — never a persisted status. */}
      <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${verdict.cls}`}>
        <Icon className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-semibold">{verdict.label}</p>
          <p className="text-[11px] opacity-90">{pkg.readiness.reason}</p>
        </div>
        <span className="ml-auto text-[10px] uppercase tracking-wide opacity-70 shrink-0">
          {pkg.slot.platform ?? '—'} · {pkg.slot.content_type ?? '—'}
        </span>
      </div>

      {pkg.assets.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            Assets in this post ({pkg.assets.length})
          </p>
          {pkg.assets.map((a) => <AssetReview key={a.assignment_id} asset={a} />)}
          <p className="text-[10px] text-gray-400">
            Assets are assigned in Alignment. This is the package that would publish for
            week {pkg.slot.week ?? '—'} · {pkg.slot.day ?? '—'}.
          </p>
        </div>
      )}
    </div>
  );
}

export default SlotReviewPanel;
