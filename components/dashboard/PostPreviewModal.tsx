import React, { useState } from 'react';
import { Calendar, ExternalLink, Send, Upload } from 'lucide-react';
import PlatformIcon from '../ui/PlatformIcon';
import {
  PLATFORM_CARD_CONFIG,
  DEFAULT_PLATFORM_CARD_CONFIG,
} from '../preview/platformCardPrimitives';
import PlatformPreview from '../preview/platforms';
import { buildPreviewPayloadFromActivityEvent } from '../../lib/preview/normalizedPreviewPayload';
import {
  resolveDisplayContentType,
  resolveDisplayContentTypeLabel,
} from '../../lib/calendar/assetTypeDisplay';
import {
  deriveCreatorStatusLabel,
  deriveWorkflowChecklist,
  isCreatorProduced,
} from '../../lib/shared/creatorStatusLabel';

export type ActivityEvent = {
  type: 'activity';
  date: string;
  platform: string;
  content?: string | null;
  title: string;
  repurpose_index: number;
  repurpose_total: number;
  campaign_id: string;
  /**
   * Platform-native content type as persisted on `scheduled_posts.content_type`
   * (e.g. `tweet`, `feed_post`, `post`, `pin`). Kept for downstream consumers
   * that care about platform-specific rendering. Calendar cards should display
   * `asset_type` instead so the user-selected format (poll/article/story/post)
   * is reflected in the UI.
   */
  content_type: string;
  /**
   * User-selected canonical asset type sourced from `daily_content_plans.content_type`
   * (e.g. `post`, `poll`, `article`, `story`, `carousel`, `reel`, `image`).
   * Optional because standalone (non-campaign) posts have no plan row to join.
   * The calendar prefers this field over `content_type` for display.
   */
  asset_type?: string;
  execution_id?: string;
  scheduled_post_id?: string;
  status?: string;
  scheduled_for?: string | null;
  is_overdue?: boolean;
  media_urls?: string[];
  media_types?: string[];
  // ── Creator unification (additive) ──
  /** True for WAITING_FOR_ASSET (video/reel/short) rows awaiting upload. */
  pending?: boolean;
  /** daily_content_plans row id — drives the "Upload media" deep-link. */
  daily_plan_id?: string | null;
  /** Short brief shown on the pending card (also surfaced via `content`). */
  cta?: string | null;
  canonical_state?: string;
  canonical_badge?: string;
  canonical_label?: string;
  canonical_group?: 'pending' | 'ready' | 'scheduled' | 'published' | 'failed' | 'draft';
  // ── Video creation brief (additive; only the pending/video branch of the
  //    calendar feed populates these — drawer renders the brief inline). ──
  /** theme/treatment block from daily_content_plans.content.theme_treatment. */
  theme_treatment?: Record<string, any> | null;
  /** creator guidance block (hook/scenes/talking points/visual guidance). */
  creator_guidance?: Record<string, any> | null;
  /** marketing package (caption/hashtags/promotion copy/publishing notes). */
  marketing_package?: Record<string, any> | null;
};

const PLATFORM_CONFIG = PLATFORM_CARD_CONFIG;
const DEFAULT_PLATFORM_CONFIG = DEFAULT_PLATFORM_CARD_CONFIG;

interface PostPreviewModalProps {
  event: ActivityEvent;
  onClose: () => void;
  onOpenWorkspace: (evt: ActivityEvent) => void;
  onPublish?: (postId: string) => Promise<{ success: boolean; error?: string }>;
  onReschedule?: (postId: string, newDate: string) => Promise<{ success: boolean; error?: string }>;
  /** Upload-video action for creator-produced (video/reel/short) items. */
  onUpload?: (evt: ActivityEvent) => void;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : String(x ?? ''))).filter(Boolean) : [];
const obj = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};

/** Workflow progression checklist (✓ / ⏳ / □) — visibility only. */
function WorkflowChecklist({ event }: { event: ActivityEvent }) {
  const steps = deriveWorkflowChecklist(event);
  return (
    <div className="px-4 py-3 border-t border-gray-100">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Progress</p>
      <ol className="space-y-1">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span
              className={
                s.done ? 'text-emerald-600' : s.current ? 'text-amber-500' : 'text-gray-300'
              }
            >
              {s.done ? '✓' : s.current ? '⏳' : '□'}
            </span>
            <span className={s.done ? 'text-gray-700' : s.current ? 'text-gray-900 font-medium' : 'text-gray-400'}>
              {s.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One labelled brief field; renders a string or a bulleted list. Skips empties. */
function BriefField({ label, value }: { label: string; value: string | string[] }) {
  const list = Array.isArray(value) ? value : [];
  const text = Array.isArray(value) ? '' : value;
  if (Array.isArray(value) ? list.length === 0 : !text) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-400">{label}</p>
      {Array.isArray(value) ? (
        <ul className="mt-0.5 list-disc list-inside text-xs text-gray-700 space-y-0.5">
          {list.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      ) : (
        <p className="mt-0.5 text-xs text-gray-700 whitespace-pre-line">{text}</p>
      )}
    </div>
  );
}

/**
 * VIDEO CREATION BRIEF — Omnivyra does NOT generate the video; it hands the
 * creator this brief. Rendered inline in the drawer for video/reel/short
 * items, sourced from the widened pending event (theme_treatment /
 * creator_guidance / marketing_package). Resilient to missing fields.
 */
function VideoBriefPanel({ event }: { event: ActivityEvent }) {
  const tt = obj(event.theme_treatment);
  const guidance = obj(event.creator_guidance);
  const marketing = obj(event.marketing_package);
  const hookScene = obj(tt.hook_scene);
  const ctaScene = obj(tt.cta_scene);

  const hook = str(hookScene.text) || str(hookScene.dialogue) || str(tt.hook);
  const scenes = Array.isArray(tt.scenes)
    ? (tt.scenes as any[]).map((s) => str(obj(s).text) || str(obj(s).dialogue) || str(obj(s).description) || str(obj(s).beat)).filter(Boolean)
    : [];
  const cta = str(ctaScene.platform_cta) || str(ctaScene.text) || str(marketing.cta) || str(event.cta);
  const visualGuidance = [str(guidance.production_notes), ...arr(guidance.b_roll_ideas).map((b) => `B-roll: ${b}`)]
    .filter(Boolean)
    .join('\n');
  const publishingNotes = [
    tt.aspect_ratio ? `Aspect ratio: ${str(tt.aspect_ratio)}` : '',
    tt.duration_seconds ? `Target duration: ${tt.duration_seconds}s` : '',
  ].filter(Boolean).join('\n');

  const hasAnything =
    hook || scenes.length || arr(guidance.talking_points).length || visualGuidance ||
    cta || str(marketing.caption) || arr(marketing.hashtags).length || str(event.content);

  return (
    <div className="px-4 py-3 bg-indigo-50/40 border-t border-indigo-100">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-indigo-600">🎬 Video Creation Brief</span>
      </div>
      {!hasAnything ? (
        <p className="text-xs text-gray-500">
          Brief is being prepared. Open the workspace for the full production guidance.
        </p>
      ) : (
        <div className="space-y-2.5">
          <BriefField label="Title" value={str(event.title)} />
          <BriefField label="Core Message / Objective" value={str(event.content)} />
          <BriefField label="Hook" value={hook} />
          <BriefField label="Scene Flow" value={scenes} />
          <BriefField label="Talking Points" value={arr(guidance.talking_points)} />
          <BriefField label="Visual Guidance" value={visualGuidance} />
          <BriefField label="CTA" value={cta} />
          <BriefField label="Caption" value={str(marketing.caption)} />
          <BriefField label="Hashtags" value={arr(marketing.hashtags).map((h) => (h.startsWith('#') ? h : `#${h}`))} />
          <BriefField label="Promotion Copy" value={str(marketing.meta_description)} />
          <BriefField label="Publishing Notes" value={publishingNotes} />
        </div>
      )}
    </div>
  );
}

export default function PostPreviewModal({
  event,
  onClose,
  onOpenWorkspace,
  onPublish,
  onReschedule,
  onUpload,
}: PostPreviewModalProps) {
  const [publishState, setPublishState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [publishError, setPublishError] = useState('');
  const [currentStatus, setCurrentStatus] = useState(event.status);
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(event.date || '');
  const [rescheduleState, setRescheduleState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [rescheduleError, setRescheduleError] = useState('');

  const canPublish = !!event.scheduled_post_id && !!onPublish && currentStatus !== 'published';
  const canReschedule = !!event.scheduled_post_id && !!onReschedule && currentStatus !== 'published';

  const handlePublish = async () => {
    if (!event.scheduled_post_id || !onPublish) return;
    setPublishState('loading');
    setPublishError('');
    const result = await onPublish(event.scheduled_post_id);
    if (result.success) { setPublishState('success'); setCurrentStatus('published'); }
    else { setPublishState('error'); setPublishError(result.error || 'Failed to publish'); }
  };

  const handleRescheduleConfirm = async () => {
    if (!event.scheduled_post_id || !onReschedule || !rescheduleDate) return;
    setRescheduleState('loading');
    setRescheduleError('');
    const result = await onReschedule(event.scheduled_post_id, rescheduleDate);
    if (result.success) { setRescheduleState('success'); setShowReschedule(false); }
    else { setRescheduleState('error'); setRescheduleError(result.error || 'Failed to reschedule'); }
  };

  const platform = (event.platform || '').toLowerCase().trim();
  // Renderer prefers asset_type (user-selected canonical format) so the
  // preview matches the format the user picked. Falls back to the
  // platform-native content_type for legacy / standalone events.
  // Centralized in lib/calendar/assetTypeDisplay so every calendar surface
  // (modal, week strip, day cell, day detail) shares the exact same rule.
  const contentType = resolveDisplayContentType(event);
  const cfg = PLATFORM_CONFIG[platform] ?? DEFAULT_PLATFORM_CONFIG;
  const platformLabel = platform === 'x' ? 'X (Twitter)' : platform.charAt(0).toUpperCase() + platform.slice(1);

  const hasMediaForLabel = (event.media_urls?.length ?? 0) > 0;
  const contentTypeLabel = (() => {
    const base = resolveDisplayContentTypeLabel(event);
    if (hasMediaForLabel && /^post$/i.test(base)) return 'Post with asset';
    return base;
  })();

  const isTikTok = platform === 'tiktok';

  // Phase 2 unification — per-platform JSX has been extracted to
  // components/preview/platforms/* and is dispatched via PlatformPreview.
  // The modal owns the surrounding chrome (header pill, footer action
  // bar) and delegates the platform-faithful body to the renderer.
  const previewPayload = buildPreviewPayloadFromActivityEvent({
    event,
    contentType,
    contentTypeLabel,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6"
      onClick={onClose}
    >
      <div
        className={`w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh] ${
          isTikTok ? 'max-w-xs bg-black rounded-3xl' : 'max-w-md bg-white rounded-2xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className={`flex items-center justify-between px-4 py-2.5 shrink-0 ${cfg.headerBg}`}>
          <div className="flex items-center gap-2">
            <PlatformIcon platform={platform} size={16} />
            <span className="font-semibold text-sm">{platformLabel}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/20 capitalize">
              {contentTypeLabel}
            </span>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-base leading-none p-1">✕</button>
        </div>

        {/* Platform Preview — extracted into per-platform renderers in
            components/preview/platforms/*. The dispatcher resolves the
            renderer from the payload's platform. */}
        <div className="flex-1 overflow-y-auto">
          {/* Lead with the platform-faithful preview — this is the "how it
              looks once posted on the social platform" view the user expects
              on click. Progress + brief follow as secondary context. */}
          <PlatformPreview payload={previewPayload} />
          {/* Workflow progression — makes "where is this in the pipeline" explicit. */}
          <WorkflowChecklist event={event} />
          {/* Video items: Omnivyra ships a brief, not the video. Show it inline. */}
          {isCreatorProduced(event) && <VideoBriefPanel event={event} />}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-4 py-3 border-t border-gray-200 bg-white shrink-0">
          {showReschedule && (
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <Calendar className="w-3.5 h-3.5 text-gray-500 shrink-0" />
              <input
                type="date"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
                className="flex-1 text-sm bg-transparent outline-none text-gray-800"
                min={new Date().toISOString().slice(0, 10)}
              />
              <button
                onClick={handleRescheduleConfirm}
                disabled={rescheduleState === 'loading' || !rescheduleDate}
                className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-md disabled:opacity-50"
              >
                {rescheduleState === 'loading' ? '…' : 'Move'}
              </button>
              <button onClick={() => { setShowReschedule(false); setRescheduleState('idle'); setRescheduleError(''); }} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
            </div>
          )}
          {rescheduleState === 'error' && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5">{rescheduleError}</p>
          )}
          {rescheduleState === 'success' && (
            <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5 font-medium">✓ Post moved to {rescheduleDate}</p>
          )}
          {publishState === 'error' && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5">{publishError}</p>
          )}
          {publishState === 'success' && (
            <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5 font-medium">✓ Post published successfully!</p>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap min-w-0">
              {event.repurpose_total > 1 && (
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">
                  {event.repurpose_index}/{event.repurpose_total}
                </span>
              )}
              {(() => {
                // Standardized creator status label (shared mapper). Publish
                // success inside the modal overrides to Published; overdue
                // still surfaces as a distinct warning.
                const derived = deriveCreatorStatusLabel(event);
                const isPublished = currentStatus === 'published' || publishState === 'success' || derived.key === 'PUBLISHED';
                const label = isPublished ? 'Published' : (event.is_overdue ? 'Overdue' : derived.label);
                const cls = isPublished ? 'bg-emerald-100 text-emerald-700'
                  : event.is_overdue ? 'bg-red-100 text-red-700'
                  : derived.group === 'scheduled' ? 'bg-purple-100 text-purple-700'
                  : derived.group === 'pending' ? 'bg-amber-100 text-amber-700'
                  : derived.group === 'failed' ? 'bg-red-100 text-red-700'
                  : derived.group === 'ready' ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-gray-100 text-gray-600';
                return <span className={`px-2 py-0.5 rounded-full shrink-0 ${cls}`}>{label}</span>;
              })()}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Creator video items awaiting upload — the system only shipped a
                  brief; the user produces & uploads the video here. */}
              {onUpload && isCreatorProduced(event) && event.canonical_group === 'pending' && publishState !== 'success' && (
                <button
                  onClick={() => onUpload(event)}
                  className="px-3 py-1.5 text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white rounded-lg flex items-center gap-1.5"
                  title="Upload your video to schedule this post"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Upload Video</span>
                </button>
              )}
              {canReschedule && publishState !== 'success' && (
                <button
                  onClick={() => { setShowReschedule((v) => !v); setRescheduleState('idle'); setRescheduleError(''); }}
                  className={`px-2.5 py-1.5 text-sm rounded-lg flex items-center gap-1 transition-colors ${
                    showReschedule ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                  title="Reschedule"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-xs">Reschedule</span>
                </button>
              )}
              {canPublish && publishState !== 'success' && (
                <button
                  onClick={handlePublish}
                  disabled={publishState === 'loading'}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-60 ${
                    event.is_overdue ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                >
                  {publishState === 'loading'
                    ? <><svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"/></svg>Posting...</>
                    : <><Send className="w-3.5 h-3.5" />Post Now</>}
                </button>
              )}
              {publishState !== 'success' && (
                <button
                  onClick={() => onOpenWorkspace(event)}
                  className="px-3 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Workspace</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
