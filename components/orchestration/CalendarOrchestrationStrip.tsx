/**
 * CalendarOrchestrationStrip — Phase-2 Step-15.
 * READ-ONLY, fail-soft calendar orchestration summary. Rendered as a
 * low-profile fixed overlay so it does NOT alter calendar layout/UX (no
 * redesign). Renders nothing when no data. No mutation.
 */

import { useCalendarOrchestrationView } from '../../hooks/orchestration/useCalendarOrchestrationView';
import { AIAssetPreview } from './assets';

function Pill({ label, tone }: { label: string; tone: string }) {
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tone}`}>{label}</span>;
}

export function CalendarOrchestrationStrip({ campaignId }: { campaignId?: string | null }) {
  const { items } = useCalendarOrchestrationView(campaignId);
  if (!campaignId || items.length === 0) return null;

  const blocked = items.filter((i) => i.orchestration_flags?.blocked).length;
  const pending = items.filter((i) => i.orchestration_flags?.pending_asset).length;
  const creator = items.filter((i) => i.creator_state && i.creator_state !== 'NONE').length;
  const owned = items.filter((i) => i.owned_content_state && i.owned_content_state !== 'NONE').length;
  const authoritative = items.filter((i) => i.orchestration_flags?.authoritative_generated).length;

  // Step-20: real AI-asset previews surfaced in the existing read-only
  // overlay zone (no legacy card redesign). Cap the rendered set so the
  // overlay stays low-profile.
  const aiItems = items.filter((i) => i.ai_asset);
  const aiReady = aiItems.filter((i) => i.ai_asset?.generated_preview?.preview_url).length;
  const aiPreviewItems = aiItems.slice(0, 8);

  return (
    <div
      className="fixed top-16 right-3 z-40 pointer-events-none flex flex-col items-end gap-1.5 max-w-[60vw]"
      aria-label="Calendar orchestration visibility (read-only)"
    >
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Pill label={`${items.length} activities`} tone="bg-white/90 border border-gray-200 text-gray-600 shadow-sm" />
        {blocked > 0 && <Pill label={`${blocked} blocked`} tone="bg-red-50 text-red-700 shadow-sm" />}
        {pending > 0 && <Pill label={`${pending} pending asset`} tone="bg-amber-50 text-amber-700 shadow-sm" />}
        {creator > 0 && <Pill label={`${creator} creator`} tone="bg-amber-50 text-amber-700 shadow-sm" />}
        {owned > 0 && <Pill label={`${owned} owned`} tone="bg-indigo-50 text-indigo-700 shadow-sm" />}
        {authoritative > 0 && <Pill label={`${authoritative} authoritative`} tone="bg-emerald-50 text-emerald-700 shadow-sm" />}
        {aiReady > 0 && <Pill label={`${aiReady} AI preview`} tone="bg-emerald-50 text-emerald-700 shadow-sm" />}
      </div>
      {aiPreviewItems.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-1 bg-white/90 border border-gray-200 rounded-md shadow-sm p-1.5">
          {aiPreviewItems.map((i) => (
            <AIAssetPreview
              key={i.execution_id}
              aiAsset={i.ai_asset}
              campaignId={campaignId}
              executionId={i.execution_id}
              size="sm"
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Optional per-activity read-only badge (activity_type + flags). Provided
 * for card renderers to opt-in WITHOUT redesigning them; not force-wired
 * into the legacy calendar card to preserve existing behaviour.
 */
export function CalendarActivityOrchestrationBadge({
  item,
}: {
  item: { activity_type: string; orchestration_flags?: { blocked?: boolean; pending_asset?: boolean } };
}) {
  if (!item?.activity_type) return null;
  const flagged = item.orchestration_flags?.blocked
    ? 'bg-red-50 text-red-700'
    : item.orchestration_flags?.pending_asset
      ? 'bg-amber-50 text-amber-700'
      : 'bg-gray-100 text-gray-500';
  return <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${flagged}`}>{item.activity_type}</span>;
}

/**
 * Opt-in per-activity AI-asset preview (Step-20). A legacy calendar/planner
 * card renderer MAY drop this into its existing content zone to show the
 * real generated preview WITHOUT any layout/structure change. Not
 * force-wired into legacy cards (those are not orchestration-aware →
 * wiring them would be a redesign, which the strict rules forbid).
 */
export function CalendarActivityAssetPreview({
  item,
  campaignId,
}: {
  item: { execution_id: string; ai_asset?: import('./assets').AIAssetProjectionLike | null };
  campaignId?: string | null;
}) {
  if (!item?.ai_asset) return null;
  return (
    <AIAssetPreview
      aiAsset={item.ai_asset}
      campaignId={campaignId}
      executionId={item.execution_id}
      size="sm"
    />
  );
}
