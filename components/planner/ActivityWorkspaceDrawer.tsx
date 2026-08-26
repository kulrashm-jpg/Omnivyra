/**
 * Activity Preview Drawer
 * Full-screen slide-over showing one planned content topic and its per-platform
 * slots. Opened when the user clicks a content group in StrategicThemeCards.
 *
 * P0 HONESTY PASS — this drawer is READ-ONLY by design.
 *
 * It previously offered two controls that produced no persisted effect:
 *   1. "Schedule All Platforms" — set local state and rendered "Queued!"
 *      without any network call, campaign status change, or scheduled_posts
 *      row. Scheduling does not yet exist as a Strategic Mix capability; a
 *      control may not claim it.
 *   2. "Generate Content" + editable per-platform textareas — called the
 *      billed generation endpoint and held the result (and any manual edits)
 *      in React state only, discarding everything when the drawer closed.
 *
 * The canonical, persisted content surface is the Content Workspace
 * (components/planner/ContentWorkspace.tsx), which writes through the pure
 * ops in lib/campaign/campaignContentModel and rides the planner-state
 * persistence seam. This drawer therefore shows what is ALREADY persisted and
 * hands the user to that workspace to change it — no second generation path,
 * no second content model.
 */

import { useState } from 'react';
import { X, Copy, Check, FileText, ArrowRight } from 'lucide-react';
import PlatformIcon from '../ui/PlatformIcon';

const PLATFORM_HINTS: Record<string, { limit: string; tone: string; format: string }> = {
  linkedin:  { limit: '3000 chars',     tone: 'Professional, insight-led',   format: 'Hook → Value → CTA' },
  instagram: { limit: '2200 chars',     tone: 'Visual, aspirational',         format: 'Caption + hashtags' },
  twitter:   { limit: '280 chars',      tone: 'Punchy, conversational',       format: 'Thread or single tweet' },
  x:         { limit: '280 chars',      tone: 'Punchy, conversational',       format: 'Thread or single tweet' },
  facebook:  { limit: '63,206 chars',   tone: 'Community, friendly',          format: 'Story + engagement question' },
  youtube:   { limit: '5000 chars desc',tone: 'Educational, narrative',       format: 'Script outline or description' },
  tiktok:    { limit: '2200 chars',     tone: 'Casual, trend-aware',          format: 'Hook in first 3s + story' },
  pinterest: { limit: '500 chars',      tone: 'Inspirational, keyword-rich',  format: 'Idea pin description' },
  reddit:    { limit: 'No limit',       tone: 'Authentic, community-first',   format: 'Post + discussion starter' },
};

function getPlatformHint(platform: string) {
  return PLATFORM_HINTS[platform.toLowerCase()] ?? { limit: '—', tone: 'Platform-appropriate', format: 'Standard post' };
}

/** Planning-lifecycle badge styling — the SAME vocabulary the Content
 *  Workspace uses (draft → review → approved). No new statuses here. */
const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  draft:    { label: 'Draft',    cls: 'bg-gray-100 text-gray-600' },
  review:   { label: 'In review', cls: 'bg-amber-50 text-amber-700' },
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700' },
};

/** Persisted planning content for one platform slot, read from planner state. */
export interface GroupPlatformContent {
  body: string;
  /** 'draft' | 'review' | 'approved' — the canonical planning vocabulary. */
  status: string;
  manuallyEdited?: boolean;
}

export interface ContentGroup {
  /** The core topic/title of this piece */
  title: string;
  /** Day name e.g. "Monday" */
  day: string;
  /** Week number */
  week: number;
  /** All platforms that will use this content piece */
  platforms: string[];
  /** Content type per platform (may differ) */
  contentTypes: Record<string, string>;
  /** Theme/objective context */
  theme?: string;
  objective?: string;
  /** Company ID (kept for callers that key panels by company) */
  companyId?: string | null;
  /**
   * Already-persisted planning content per platform, lifted from the planner
   * session's calendar_plan activities. Read-only here — the Content
   * Workspace owns every mutation.
   */
  existingContent?: Record<string, GroupPlatformContent>;
}

interface Props {
  group: ContentGroup;
  onClose: () => void;
  /**
   * Navigate to the canonical Content Workspace for this week. When absent the
   * drawer simply omits the action rather than offering a dead control.
   */
  onOpenContentWorkspace?: (week: number) => void;
}

export default function ActivityWorkspaceDrawer({ group, onClose, onOpenContentWorkspace }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  const contentByPlatform = group.existingContent ?? {};
  const writtenCount = group.platforms.filter((p) => contentByPlatform[p]?.body?.trim()).length;

  const copyVariant = (platform: string, text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(platform);
    setTimeout(() => setCopied(null), 1500);
  };

  const openWorkspace = () => {
    onOpenContentWorkspace?.(group.week);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Drawer panel */}
      <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">
                Week {group.week} · {group.day}
              </span>
              {group.theme && group.theme !== group.title && (
                <span className="text-xs text-gray-400">· {group.theme}</span>
              )}
            </div>
            <h2 className="text-base font-semibold text-gray-900">Activity Preview</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              One topic across {group.platforms.length} platform{group.platforms.length !== 1 ? 's' : ''}
              {' · '}
              {writtenCount} of {group.platforms.length} written
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Core topic — read-only; the Skeleton owns the topic, the Content
            Workspace owns the copy. Editing here persisted nowhere. */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-gray-100 bg-gray-50">
          <p className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
            Core Topic / Angle
          </p>
          <p className="text-sm text-gray-800 bg-white border border-gray-200 rounded-lg px-3 py-2">
            {group.title}
          </p>
          {group.objective && (
            <p className="text-xs text-gray-400 mt-1.5">Objective: {group.objective}</p>
          )}
          <p className="text-xs text-gray-500 mt-3">
            Writing, AI generation, and approval happen in the Content Workspace, where every change
            is saved to the campaign.
          </p>
        </div>

        {/* Platform slots — scrollable, read-only */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Platform Slots</p>
          {group.platforms.map((platform) => {
            const hint = getPlatformHint(platform);
            const contentType = group.contentTypes[platform] ?? 'post';
            const persisted = contentByPlatform[platform];
            const body = persisted?.body?.trim() ?? '';
            const status = STATUS_STYLE[persisted?.status ?? 'draft'] ?? STATUS_STYLE.draft;
            const isCopied = copied === platform;

            return (
              <div key={platform} className="rounded-xl border border-gray-200 overflow-hidden">
                {/* Platform header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <PlatformIcon platform={platform} size={16} />
                    <span className="text-sm font-semibold text-gray-800 capitalize">{platform}</span>
                    <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full capitalize">
                      {contentType}
                    </span>
                    {body && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${status.cls}`}>
                        {status.label}
                      </span>
                    )}
                  </div>
                  {body && (
                    <button
                      type="button"
                      onClick={() => copyVariant(platform, body)}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
                    >
                      {isCopied
                        ? <Check className="h-3.5 w-3.5 text-green-500" />
                        : <Copy className="h-3.5 w-3.5" />}
                      {isCopied ? 'Copied to clipboard' : 'Copy'}
                    </button>
                  )}
                </div>
                {/* Hints */}
                <div className="flex gap-4 px-4 py-1.5 bg-indigo-50/40 border-b border-gray-100 text-[10px] text-gray-500">
                  <span><strong>Limit:</strong> {hint.limit}</span>
                  <span><strong>Tone:</strong> {hint.tone}</span>
                  <span><strong>Format:</strong> {hint.format}</span>
                </div>
                {/* Persisted copy, or an honest empty state */}
                <div className="px-4 pb-3 pt-2 bg-white">
                  {body ? (
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{body}</p>
                  ) : (
                    <p className="text-xs text-gray-400 py-2">
                      Nothing written for {platform} yet.
                      {onOpenContentWorkspace ? ' Open the Content Workspace to write or generate it.' : ''}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer actions */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400">
            {group.platforms.length} platform{group.platforms.length !== 1 ? 's' : ''} · Week {group.week} · {group.day}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Close
            </button>
            {onOpenContentWorkspace && (
              <button
                type="button"
                onClick={openWorkspace}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-2"
              >
                <FileText className="h-4 w-4" />
                Open in Content Workspace
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
