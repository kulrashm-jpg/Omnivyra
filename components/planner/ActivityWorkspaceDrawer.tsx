/**
 * Activity Workspace Drawer
 * Full-screen slide-over showing one content topic and per-platform repurpose areas.
 * Opened when the user clicks a content group in StrategicThemeCards week plan.
 */

import { useState } from 'react';
import { X, Send, Copy, Check, Sparkles, Loader2, RefreshCw } from 'lucide-react';
import PlatformIcon from '../ui/PlatformIcon';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';

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
  /** Company ID for content generation */
  companyId?: string | null;
}

interface Props {
  group: ContentGroup;
  onClose: () => void;
  /** Pre-filled content per platform (e.g. from generate-workspace-content). */
  initialVariants?: Record<string, string>;
}

export default function ActivityWorkspaceDrawer({ group, onClose, initialVariants }: Props) {
  const [topic, setTopic] = useState(group.title);
  const [variants, setVariants] = useState<Record<string, string>>(
    Object.fromEntries(group.platforms.map((p) => [p, initialVariants?.[p] ?? '']))
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const copyVariant = (platform: string, text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(platform);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleScheduleAll = () => {
    setScheduled(true);
    setTimeout(() => setScheduled(false), 2000);
  };

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetchWithAuth('/api/planner/generate-workspace-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: group.companyId,
          topic: topic.trim() || group.title,
          platforms: group.platforms,
          contentTypes: group.contentTypes,
          theme: group.theme,
          objective: group.objective,
          week: group.week,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Generation failed');
      const returned: Record<string, string> = data.variants ?? {};
      setVariants((prev) => {
        const next = { ...prev };
        for (const p of group.platforms) {
          const key = p.toLowerCase();
          if (returned[key]) next[p] = returned[key];
        }
        return next;
      });
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : 'Could not generate content');
    } finally {
      setGenerating(false);
    }
  };

  const hasContent = group.platforms.some((p) => variants[p]?.trim());

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
            <h2 className="text-base font-semibold text-gray-900">Activity Workspace</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Repurpose one topic across {group.platforms.length} platform{group.platforms.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Core topic */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-gray-100 bg-gray-50">
          <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
            Core Topic / Angle
          </label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={2}
            placeholder="Enter the core topic or angle for this content piece…"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          {group.objective && (
            <p className="text-xs text-gray-400 mt-1.5">Objective: {group.objective}</p>
          )}

          {/* Generate button */}
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
            >
              {generating
                ? <><Loader2 className="h-4 w-4 animate-spin" />Generating…</>
                : hasContent
                ? <><RefreshCw className="h-4 w-4" />Regenerate Content</>
                : <><Sparkles className="h-4 w-4" />Generate Content</>}
            </button>
            {generateError && (
              <p className="text-xs text-red-600">{generateError}</p>
            )}
            {!hasContent && !generating && (
              <p className="text-xs text-gray-400">
                AI will write platform-specific copy from your topic above.
              </p>
            )}
          </div>
        </div>

        {/* Platform variants — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Platform Variants</p>
          {group.platforms.map((platform) => {
            const hint = getPlatformHint(platform);
            const contentType = group.contentTypes[platform] ?? 'post';
            const variantText = variants[platform] ?? '';
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
                  </div>
                  <button
                    type="button"
                    onClick={() => copyVariant(platform, variantText || topic)}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
                  >
                    {isCopied
                      ? <Check className="h-3.5 w-3.5 text-green-500" />
                      : <Copy className="h-3.5 w-3.5" />}
                    {isCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                {/* Hints */}
                <div className="flex gap-4 px-4 py-1.5 bg-indigo-50/40 border-b border-gray-100 text-[10px] text-gray-500">
                  <span><strong>Limit:</strong> {hint.limit}</span>
                  <span><strong>Tone:</strong> {hint.tone}</span>
                  <span><strong>Format:</strong> {hint.format}</span>
                </div>
                {/* Editable variant */}
                <div className="px-4 pb-3 pt-2 bg-white">
                  {generating ? (
                    <div className="flex items-center gap-2 text-xs text-indigo-500 py-3">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Writing {platform} content…
                    </div>
                  ) : (
                    <textarea
                      value={variantText}
                      onChange={(e) => setVariants((v) => ({ ...v, [platform]: e.target.value }))}
                      placeholder={
                        hasContent
                          ? `Edit the ${platform} version here…`
                          : `Click "Generate Content" above, or write the ${platform} version here…`
                      }
                      rows={5}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 resize-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent focus:bg-white"
                    />
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
            <button
              type="button"
              onClick={handleScheduleAll}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-2"
            >
              {scheduled ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {scheduled ? 'Queued!' : 'Schedule All Platforms'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
