import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { AlertCircle, ArrowLeft, Bookmark, ChevronDown, ChevronUp, CheckCircle2, ExternalLink, Loader2, MessageSquare, Plus, Save, Send, Sparkles, UserPlus, X } from 'lucide-react';
import { getAiLookingAheadMessage } from '@/lib/aiLookingAheadMessage';
import { getAiStrategicConfidence } from '@/lib/aiStrategicConfidence';
import { getViewMode } from '@/utils/getViewMode';
import { VIEW_RULES } from '@/utils/viewVisibilityMatrix';
import { inferExecutionMode } from '@/backend/services/executionModeInference';
import { executeMasterContentPipeline, executeVariantImprovement, executeVariantImprovementAll } from '@/lib/planning/executeMasterContentPipeline';
import CreatorContentPanel from '@/components/activity-workspace/CreatorContentPanel';
import ActivityDiscussionTab from '@/components/activity-workspace/ActivityDiscussionTab';
import { useCompanyContext } from '@/components/CompanyContext';
import { computeVariantIntelligence } from '@/lib/intelligence/executionIntelligence';
import PlatformIcon from '@/components/ui/PlatformIcon';
import ContentRenderer from '@/components/ContentRenderer';
import RichTextEditor, { htmlToPlainText, markdownToHtml } from '@/components/RichTextEditor';

type ScheduleItem = {
  id: string;
  platform: string;
  contentType: string;
  date?: string;
  time?: string;
  status?: string;
  description?: string;
  title?: string;
  /** Execution ID — may differ from primary when cross-week platforms are included */
  executionId?: string;
  /** Week number this schedule belongs to */
  weekNumber?: number;
  /** Whether this is the primary (current) execution */
  isPrimary?: boolean;
  /** Scheduled datetime from scheduled_posts */
  scheduledFor?: string | null;
  /** 1-based index in the distribution list for this topic */
  sequence_index?: number;
  /** Total number of distributions for this topic */
  total_distributions?: number;
};

/** Align with lib/planning/masterContentDocument so pipeline and payload stay type-safe. */
type MasterContentDocumentPayload = {
  master_title: string;
  source_execution_id: string;
  platforms: string[];
  platform_variants: Record<string, { execution_id: string; status: 'PENDING' | 'GENERATED'; content?: string }>;
};

/** Week-like fields used by getAiStrategicConfidence / getAiLookingAheadMessage when payload is used as week context. */
type WorkspacePayloadWeekLike = {
  planning_adjustments_summary?: unknown;
  momentum_adjustments?: {
    momentum_transfer_strength?: string;
    narrative_recovery?: boolean;
    absorbed_from_week?: unknown;
    [key: string]: unknown;
  } | null;
  distribution_strategy?: string | null;
  week_extras?: { recovered_topics?: unknown[] } | null;
};

type WorkspacePayload = WorkspacePayloadWeekLike & {
  campaignId?: string | null;
  companyId?: string | null;
  weekNumber?: number;
  day?: string;
  activityId?: string;
  title?: string;
  topic?: string;
  description?: string;
  dailyExecutionItem?: Record<string, unknown> | null;
  /** When 'daily', opened from daily view topic click: no delete, show add platform. */
  source?: 'daily' | 'weekly';
  schedules?: ScheduleItem[];
  repurposing_context?: unknown;
  master_content_document?: MasterContentDocumentPayload | null;
};

type RefineChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Build a compact image search query from topic + description. */
function buildImageQuery(topic: string, description: string): string {
  const STOPWORDS = new Set([
    'the','a','an','is','are','was','were','be','been','being','have','has','had',
    'do','does','did','will','would','could','should','may','might','shall','can',
    'to','of','in','for','on','with','at','by','from','as','into','through',
    'but','or','and','not','no','so','yet','if','while','when','where','who',
    'which','how','this','that','these','those','i','me','my','we','our','you',
    'your','he','she','it','they','them','their','its','we','about','just','also',
    'than','then','so','up','out','more','very','what','there','their','all',
  ]);

  // Extract 2 meaningful keywords from description
  const descWords = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));

  const unique = [...new Set(descWords)].slice(0, 2);
  const base = topic.trim().slice(0, 50);
  return unique.length > 0 ? `${base} ${unique.join(' ')}` : base;
}

/**
 * Strip hashtag blocks baked into generated_content by older pipeline versions.
 * Hashtags now live exclusively in discoverability_meta.hashtags and are rendered
 * by PlatformContentPreview separately — they must not appear in the content string.
 */
function stripBakedHashtags(content: string): string {
  if (!content) return content;
  // Remove one or more lines that consist entirely of #word tokens (leading or trailing)
  const hashtagLine = /^(#\w+\s*)+$/;
  const lines = content.split('\n');
  // Strip from end
  while (lines.length > 0 && hashtagLine.test(lines[lines.length - 1].trim())) lines.pop();
  // Strip from start
  while (lines.length > 0 && hashtagLine.test(lines[0].trim())) lines.shift();
  return lines.join('\n').trim();
}

/** Inline stock image picker — searches Unsplash/Pexels/Pixabay via /api/images/search. */
function ImagePicker({
  topic,
  description,
  onSelect,
  selectedUrl,
}: {
  topic: string;
  description?: string;
  onSelect: (img: { url: string; thumb: string; attribution: string } | null) => void;
  selectedUrl?: string;
}) {
  const autoQuery = buildImageQuery(topic, description ?? '');
  const [query, setQuery] = React.useState(autoQuery);
  const [results, setResults] = React.useState<Array<{ id: string; thumb: string; full: string; alt: string; attribution: string }>>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [searched, setSearched] = React.useState(false);

  const search = async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/images/search?q=${encodeURIComponent(q.trim())}&per_page=4`);
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? 'Search failed'); return; }
      setResults(data.results ?? []);
      setSearched(true);
    } catch {
      setError('Failed to fetch images');
    } finally {
      setLoading(false);
    }
  };

  // Auto-search on mount using topic + description keywords
  React.useEffect(() => {
    if (autoQuery.trim()) search(autoQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search(query)}
          placeholder="Search images…"
          className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 focus:outline-none focus:border-indigo-400"
        />
        <button
          type="button"
          onClick={() => search(query)}
          disabled={loading}
          className="px-2.5 py-1 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? '…' : 'Search'}
        </button>
        {selectedUrl && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="px-2 py-1 rounded border border-red-200 text-red-600 text-xs hover:bg-red-50"
            title="Remove selected image"
          >
            ✕
          </button>
        )}
      </div>

      {error && <p className="text-[11px] text-red-500 mb-2">{error}</p>}

      {results.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {results.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => onSelect({ url: img.full, thumb: img.thumb, attribution: img.attribution })}
              className={`relative rounded overflow-hidden aspect-video focus:outline-none ${
                selectedUrl === img.full ? 'ring-2 ring-indigo-500' : 'hover:ring-2 hover:ring-gray-400'
              }`}
              title={img.attribution}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.thumb} alt={img.alt} className="w-full h-full object-cover" loading="lazy" />
              {selectedUrl === img.full && (
                <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">
                  <span className="text-white text-lg">✓</span>
                </div>
              )}
            </button>
          ))}
        </div>
      ) : searched && !loading ? (
        <p className="text-[11px] text-gray-400 text-center py-3">No images found. Try different keywords.</p>
      ) : !searched && !loading ? (
        <p className="text-[11px] text-gray-400 text-center py-3">Searching for "{topic}"…</p>
      ) : null}

      {selectedUrl && (
        <p className="text-[9px] text-gray-400 mt-1.5 leading-tight">
          {results.find((r) => r.full === selectedUrl)?.attribution ?? 'Image selected'}
        </p>
      )}
    </div>
  );
}

/** Platform-specific post preview — minimal, shows content as it would appear on the platform. */
function PlatformContentPreview({
  platform,
  contentType,
  content,
  hashtags,
  imageUrl,
}: {
  platform: string;
  contentType: string;
  content: string;
  hashtags?: string[];
  imageUrl?: string;
}) {
  const plat = platform.toLowerCase();
  const lines = content.split('\n').filter((l) => l.trim() !== '');
  const firstLine = lines[0] ?? '';
  const rest = lines.slice(1);
  const hashtagStr = hashtags && hashtags.length > 0 ? hashtags.join(' ') : '';
  const charCount = content.length;

  const imgEl = imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl} alt="attached" className="w-full rounded-lg object-cover max-h-48 mt-2" />
  ) : null;

  // Twitter/X — compact bubble with char counter
  if (plat === 'twitter' || plat === 'x') {
    const limit = 280;
    const over = charCount > limit;
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm font-sans shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-gray-200 shrink-0" />
          <div>
            <div className="text-xs font-bold text-gray-900">Your Account</div>
            <div className="text-[10px] text-gray-400">@handle · now</div>
          </div>
        </div>
        <p className="text-[13px] text-gray-900 whitespace-pre-wrap leading-snug">{content}</p>
        {hashtagStr && <p className="text-[12px] text-sky-500 mt-1">{hashtagStr}</p>}
        {imgEl}
        <div className={`text-[10px] mt-2 text-right ${over ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
          {charCount}/{limit}
        </div>
      </div>
    );
  }

  // LinkedIn — card with bold opener, paragraph body
  if (plat === 'linkedin') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm font-sans shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-full bg-blue-100 shrink-0" />
          <div>
            <div className="text-xs font-semibold text-gray-900">Your Name</div>
            <div className="text-[10px] text-gray-400">Your Title · 1st · now</div>
          </div>
        </div>
        {firstLine && <p className="text-[13px] font-semibold text-gray-900 mb-1.5 leading-snug">{firstLine}</p>}
        {rest.map((l, i) => <p key={i} className="text-[13px] text-gray-700 mb-1 leading-relaxed">{l}</p>)}
        {hashtagStr && <p className="text-[12px] text-blue-600 mt-2">{hashtagStr}</p>}
        {imgEl}
        <div className="text-[10px] text-gray-400 mt-2">{charCount} chars</div>
      </div>
    );
  }

  // YouTube — title + description format
  if (plat === 'youtube') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm text-sm font-sans">
        {imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={imageUrl} alt="thumbnail" className="w-full object-cover max-h-36" />
          : <div className="bg-gray-100 h-28 flex items-center justify-center text-gray-400 text-xs">[Thumbnail]</div>
        }
        <div className="p-3">
          <div className="text-[13px] font-bold text-gray-900 mb-1 leading-snug">{firstLine || contentType}</div>
          <div className="text-[12px] text-gray-600 whitespace-pre-wrap leading-relaxed">{rest.join('\n') || content}</div>
          {hashtagStr && <p className="text-[11px] text-blue-500 mt-2">{hashtagStr}</p>}
        </div>
      </div>
    );
  }

  // Instagram / TikTok — image placeholder + caption
  if (plat === 'instagram' || plat === 'tiktok') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm text-sm font-sans">
        {imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={imageUrl} alt="visual" className="w-full object-cover max-h-40" />
          : <div className="bg-gray-100 h-24 flex items-center justify-center text-gray-400 text-xs">[{contentType} visual]</div>
        }
        <div className="p-3">
          <span className="text-[12px] font-semibold text-gray-900 mr-1">yourhandle</span>
          <span className="text-[12px] text-gray-700 whitespace-pre-wrap">{firstLine}</span>
          {rest.length > 0 && <p className="text-[12px] text-gray-600 mt-1">{rest.join(' ')}</p>}
          {hashtagStr && <p className="text-[11px] text-blue-500 mt-1">{hashtagStr}</p>}
        </div>
      </div>
    );
  }

  // Default (Reddit, Facebook, etc.) — clean card
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm font-sans shadow-sm">
      {firstLine && <p className="text-[13px] font-semibold text-gray-900 mb-1.5 leading-snug">{firstLine}</p>}
      {rest.map((l, i) => <p key={i} className="text-[13px] text-gray-700 mb-1 leading-relaxed">{l}</p>)}
      {hashtagStr && <p className="text-[12px] text-blue-500 mt-2">{hashtagStr}</p>}
      {imgEl}
      <div className="text-[10px] text-gray-400 mt-2">{charCount} chars</div>
    </div>
  );
}

import { apiFetch } from '@/lib/apiFetch';

export default function ActivityWorkspacePage() {
  const router = useRouter();
  const { user, selectedCompanyId } = useCompanyContext();
  const queryWorkspaceKey = useMemo(() => {
    const raw = Array.isArray(router.query.workspaceKey) ? router.query.workspaceKey[0] : router.query.workspaceKey;
    return String(raw || '').trim();
  }, [router.query.workspaceKey]);
  const queryCampaignId = useMemo(() => {
    const raw = Array.isArray(router.query.campaignId) ? router.query.campaignId[0] : router.query.campaignId;
    return String(raw || '').trim();
  }, [router.query.campaignId]);
  const queryExecutionId = useMemo(() => {
    const raw = Array.isArray(router.query.executionId) ? router.query.executionId[0] : router.query.executionId;
    return String(raw || '').trim();
  }, [router.query.executionId]);

  const workspaceKey = useMemo(() => {
    if (queryWorkspaceKey) return queryWorkspaceKey;
    if (queryCampaignId && queryExecutionId) return `activity-workspace-${queryCampaignId}-${queryExecutionId}`;
    return '';
  }, [queryWorkspaceKey, queryCampaignId, queryExecutionId]);

  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isGeneratingMaster, setIsGeneratingMaster] = useState(false);
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);
  const [latestMasterContent, setLatestMasterContent] = useState<Record<string, unknown> | null>(null);
  const [repurposingByScheduleId, setRepurposingByScheduleId] = useState<Record<string, boolean>>({});
  const [isHydratingContext, setIsHydratingContext] = useState(false);
  const [hasTriedHydration, setHasTriedHydration] = useState(false);
  const [showRefineByScheduleId, setShowRefineByScheduleId] = useState<Record<string, boolean>>({});
  const [isRefiningByScheduleId, setIsRefiningByScheduleId] = useState<Record<string, boolean>>({});
  const [refineInputByScheduleId, setRefineInputByScheduleId] = useState<Record<string, string>>({});
  const [refineMessagesByScheduleId, setRefineMessagesByScheduleId] = useState<Record<string, RefineChatMessage[]>>({});
  const [finalizedByScheduleId, setFinalizedByScheduleId] = useState<Record<string, boolean>>({});
  const [schedulingByScheduleId, setSchedulingByScheduleId] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [systemBlockExpanded, setSystemBlockExpanded] = useState(false);
  const [masterContentExpanded, setMasterContentExpanded] = useState(false);
  const [selectedVariantTab, setSelectedVariantTab] = useState<string>('');
  const [platformRulesByPlatform, setPlatformRulesByPlatform] = useState<Record<string, { guidelines: string[] }>>({});
  const [improvingSuggestionKey, setImprovingSuggestionKey] = useState<string | null>(null);
  const [improvedByScheduleId, setImprovedByScheduleId] = useState<Record<string, boolean>>({});
  const [isAutoImprovingByScheduleId, setIsAutoImprovingByScheduleId] = useState<Record<string, boolean>>({});
  const [autoAppliedByScheduleId, setAutoAppliedByScheduleId] = useState<Record<string, boolean>>({});
  // Image attachment per schedule slot: null = text-only, object = image selected
  const [imageByScheduleId, setImageByScheduleId] = useState<Record<string, { url: string; thumb: string; attribution: string } | null>>({});
  // Whether the image picker is open for a given slot
  const [showImagePickerByScheduleId, setShowImagePickerByScheduleId] = useState<Record<string, boolean>>({});
  const [strategicMemoryProfile, setStrategicMemoryProfile] = useState<{
    campaign_id: string;
    action_acceptance_rate: Record<string, number>;
    platform_confidence_average: Record<string, number>;
    total_events: number;
  } | null>(null);
  const [showAddVariantForm, setShowAddVariantForm] = useState(false);
  const [addVariantContentType, setAddVariantContentType] = useState('');
  // Platform connection status — keyed by platform key (e.g. 'linkedin'), true = connected
  const [connectedPlatforms, setConnectedPlatforms] = useState<Set<string>>(new Set());
  const [addVariantPlatform, setAddVariantPlatform] = useState('');
  const [activityTab, setActivityTab] = useState<'content' | 'community_responses' | 'discussion'>('content');
  const [communitySignals, setCommunitySignals] = useState<Array<{
    id: string;
    author?: string | null;
    content?: string | null;
    platform: string;
    signal_type: string;
    engagement_score: number;
    detected_at: string;
    conversation_url?: string | null;
  }>>([]);
  const [communitySignalsLoading, setCommunitySignalsLoading] = useState(false);
  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });
  const normalizeKey = (value: unknown) => String(value || '').trim().toLowerCase();

  type VariantIntelligenceStatus = 'pending' | 'generated' | 'adapted' | 'ready';
  const getVariantIntelligenceStatus = (variant: Record<string, unknown> | null | undefined, scheduleId: string): VariantIntelligenceStatus => {
    if (!variant || !String((variant as any)?.generated_content ?? '').trim()) return 'pending';
    if (finalizedByScheduleId[scheduleId]) return 'ready';
    if ((variant as any)?.adaptation_trace && typeof (variant as any).adaptation_trace === 'object') return 'adapted';
    return 'generated';
  };
  const variantStatusLabel: Record<VariantIntelligenceStatus, string> = {
    pending: 'Pending',
    generated: 'Generated',
    adapted: 'Adapted to platform rules',
    ready: 'Ready to publish',
  };
  const variantStatusDot: Record<VariantIntelligenceStatus, string> = {
    pending: '🟡',
    generated: '🟢',
    adapted: '🔵',
    ready: '🟣',
  };
  const fetchPlatformRules = (platform: string) => {
    const key = String(platform || '').trim().toLowerCase();
    if (!key || platformRulesByPlatform[key]?.guidelines?.length) return;
    fetch(`/api/content/platform-rules?platform=${encodeURIComponent(key)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.guidelines?.length) setPlatformRulesByPlatform((prev) => ({ ...prev, [key]: { guidelines: data.guidelines } }));
      })
      .catch(() => {});
  };

  const variantTabPlatforms = useMemo(() => {
    const set = new Set<string>();
    const nk = (v: unknown) => String(v ?? '').trim().toLowerCase();
    schedules.forEach((s) => set.add(nk(s.platform)));
    return Array.from(set);
  }, [schedules]);
  /** Selected variant tab is a schedule id (one tab per platform+contentType variant). */
  const selectedScheduleId = selectedVariantTab && schedules.some((s) => s.id === selectedVariantTab) ? selectedVariantTab : schedules[0]?.id ?? '';

  const platformVariants = useMemo(
    () =>
      Array.isArray(asObject(payload?.dailyExecutionItem)?.platform_variants)
        ? (asObject(payload?.dailyExecutionItem)?.platform_variants as Array<Record<string, unknown>>)
        : [],
    [payload?.dailyExecutionItem]
  );

  const confidenceByPlatform = useMemo(() => {
    const nk = (v: unknown) => String(v ?? '').trim().toLowerCase();
    const out: Record<string, number> = {};
    variantTabPlatforms.forEach((plat) => {
      const variantsForPlatform = platformVariants.filter((v) => nk((v as any)?.platform) === plat);
      let maxScore = 0;
      variantsForPlatform.forEach((v) => {
        const intelligence = computeVariantIntelligence(v, plat, strategicMemoryProfile);
        if (intelligence.confidence_score > maxScore) maxScore = intelligence.confidence_score;
      });
      if (variantsForPlatform.length > 0) out[plat] = maxScore;
    });
    return out;
  }, [variantTabPlatforms, platformVariants, strategicMemoryProfile]);

  useEffect(() => {
    if (schedules.length > 0 && !selectedScheduleId) {
      setSelectedVariantTab(schedules[0].id);
      if (schedules[0]) fetchPlatformRules(schedules[0].platform);
    }
  }, [schedules.length, selectedScheduleId, schedules]);
  useEffect(() => {
    if (schedules.length > 0 && selectedVariantTab && !schedules.some((s) => s.id === selectedVariantTab)) {
      setSelectedVariantTab(schedules[0].id);
      if (schedules[0]) fetchPlatformRules(schedules[0].platform);
    }
  }, [schedules, selectedVariantTab]);
  const schedulePlatformsKey = useMemo(() => [...new Set(schedules.map((s) => normalizeKey(s.platform)))].sort().join(','), [schedules]);
  useEffect(() => {
    schedules.forEach((s) => { fetchPlatformRules(s.platform); });
  }, [schedulePlatformsKey]);

  useEffect(() => {
    if (activityTab !== 'community_responses' || !payload?.campaignId) {
      setCommunitySignals([]);
      return;
    }
    const companyId = payload.companyId || payload.campaignId;
    const activityId = payload.activityId || queryExecutionId;
    if (!companyId) return;
    let cancelled = false;
    setCommunitySignalsLoading(true);
    const params = new URLSearchParams({ companyId });
    if (payload.campaignId) params.set('campaignId', payload.campaignId);
    if (activityId) params.set('activityId', activityId);
    fetch(`/api/engagement/campaign-signals?${params}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { signals: [] }))
      .then((data) => {
        if (!cancelled) setCommunitySignals(data?.signals ?? []);
      })
      .catch(() => { if (!cancelled) setCommunitySignals([]); })
      .finally(() => { if (!cancelled) setCommunitySignalsLoading(false); });
    return () => { cancelled = true; };
  }, [activityTab, payload?.campaignId, payload?.companyId, payload?.activityId, queryExecutionId]);

  // Load which platforms this user has connected accounts for — used to warn before scheduling
  useEffect(() => {
    const companyId = String(payload?.companyId || '').trim();
    if (!companyId) return;
    let cancelled = false;
    apiFetch(`/api/social-accounts/status?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.accounts) return;
        const connected = new Set<string>(
          (data.accounts as Array<{ platform_key: string; connected: boolean }>)
            .filter((a) => a.connected)
            .map((a) => a.platform_key)
        );
        setConnectedPlatforms(connected);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [payload?.companyId]);

  useEffect(() => {
    const campaignId = payload?.campaignId ?? '';
    if (!campaignId) {
      setStrategicMemoryProfile(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/intelligence/strategic-memory?campaignId=${encodeURIComponent(campaignId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((profile) => {
        if (!cancelled && profile) setStrategicMemoryProfile(profile);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [payload?.campaignId]);

  const aiPreviewMessage = useMemo(() => getAiLookingAheadMessage(payload ?? null), [payload]);
  const viewMode = getViewMode(user?.role);
  const aiConfidenceMessage = useMemo(() => getAiStrategicConfidence(payload ?? null), [payload]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!workspaceKey) {
      setIsLoaded(true);
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(workspaceKey) : null;
        if (raw) {
          const parsed = JSON.parse(raw) as WorkspacePayload;
          if (!cancelled) {
            setPayload(parsed);
            setSchedules(Array.isArray(parsed?.schedules) ? parsed.schedules : []);
          }
          if (!cancelled) setIsLoaded(true);
          return;
        }

        const canResolve =
          (queryCampaignId && queryExecutionId) ||
          (queryWorkspaceKey && String(queryWorkspaceKey).startsWith('activity-workspace-'));
        if (canResolve && typeof window !== 'undefined') {
          setHasTriedHydration(true);
          setIsHydratingContext(true);
          const params = new URLSearchParams();
          if (queryWorkspaceKey) params.set('workspaceKey', queryWorkspaceKey);
          else {
            params.set('campaignId', queryCampaignId);
            params.set('executionId', queryExecutionId);
          }
          const res = await fetch(`/api/activity-workspace/resolve?${params}`, { credentials: 'include' });
          if (!cancelled && res.ok) {
            const data = await res.json();
            const resolvedPayload = data?.payload;
            if (resolvedPayload && typeof resolvedPayload === 'object') {
              setPayload(resolvedPayload);
              setSchedules(Array.isArray(resolvedPayload?.schedules) ? resolvedPayload.schedules : []);
              const key = data?.workspaceKey || workspaceKey;
              try {
                window.sessionStorage.setItem(key, JSON.stringify(resolvedPayload));
              } catch (_) {}
            }
          }
        }
      } catch (error) {
        if (!cancelled) console.error('Failed to load workspace payload:', error);
      } finally {
        if (!cancelled) {
          setIsHydratingContext(false);
          setIsLoaded(true);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [router.isReady, workspaceKey, queryCampaignId, queryExecutionId, queryWorkspaceKey]);

  // Auto-persist payload + schedules to sessionStorage whenever they change so state
  // is never lost between sessions without requiring "Save Changes".
  const _didInitialLoad = useRef(false);
  useEffect(() => {
    if (!isLoaded || !workspaceKey) return;
    if (!_didInitialLoad.current) {
      // Skip the first fire (that's just the initial read from sessionStorage)
      _didInitialLoad.current = true;
      return;
    }
    try {
      window.sessionStorage.setItem(workspaceKey, JSON.stringify({ ...(payload || {}), schedules }));
    } catch (_) {}
  }, [payload, schedules, isLoaded, workspaceKey]);

  // Restore finalized/scheduled button state from persisted schedule statuses on load.
  // This ensures "Schedule" button re-appears after a page reload without user needing to re-finalize.
  useEffect(() => {
    if (!isLoaded || schedules.length === 0) return;
    const restored: Record<string, boolean> = {};
    schedules.forEach((s) => {
      if (s.status === 'finalized' || s.status === 'scheduled') {
        restored[s.id] = true;
      }
    });
    if (Object.keys(restored).length > 0) {
      setFinalizedByScheduleId(restored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  const dailyRaw = asObject(payload?.dailyExecutionItem);
  const nestedBrief = asObject(dailyRaw?.writer_content_brief);
  const nestedIntent = asObject(dailyRaw?.intent);
  // Derive Writer Context from flat week/daily details when nested writer_content_brief/intent are missing (e.g. from calendar daily-plans or v2 daily object)
  const topicText = String((payload?.topic || payload?.title || (dailyRaw?.topicTitle ?? dailyRaw?.topic)) ?? '').trim();
  const writerBrief = nestedBrief || (dailyRaw && (dailyRaw.topicTitle || dailyRaw.writingIntent || dailyRaw.whatShouldReaderLearn || dailyRaw.whatProblemAreWeAddressing || dailyRaw.desiredAction || dailyRaw.narrativeStyle || dailyRaw.introObjective || dailyRaw.summary || dailyRaw.objective || dailyRaw.cta || dailyRaw.brandVoice || dailyRaw.dailyObjective) ? {
    topicTitle: (dailyRaw.topicTitle ?? dailyRaw.topic ?? payload?.title ?? payload?.topic) as string,
    writingIntent: (dailyRaw.writingIntent ?? dailyRaw.description) as string,
    whatShouldReaderLearn: (dailyRaw.whatShouldReaderLearn ?? dailyRaw.introObjective) as string,
    whatProblemAreWeAddressing: (dailyRaw.whatProblemAreWeAddressing ?? dailyRaw.summary) as string,
    desiredAction: (dailyRaw.desiredAction ?? dailyRaw.cta) as string,
    narrativeStyle: (dailyRaw.narrativeStyle ?? dailyRaw.brandVoice) as string,
    topicGoal: (dailyRaw.dailyObjective ?? dailyRaw.objective) as string,
  } as Record<string, unknown> : null);
  const intent = nestedIntent || (dailyRaw && (dailyRaw.dailyObjective || dailyRaw.objective || dailyRaw.pain_point || dailyRaw.outcome_promise || dailyRaw.whatProblemAreWeAddressing || dailyRaw.whatShouldReaderLearn || dailyRaw.desiredAction || dailyRaw.cta) ? {
    objective: (dailyRaw.dailyObjective ?? dailyRaw.objective) as string,
    pain_point: (dailyRaw.whatProblemAreWeAddressing ?? dailyRaw.summary ?? dailyRaw.pain_point) as string,
    outcome_promise: (dailyRaw.whatShouldReaderLearn ?? dailyRaw.introObjective ?? dailyRaw.outcome_promise) as string,
    cta_type: (dailyRaw.desiredAction ?? dailyRaw.cta ?? dailyRaw.cta_type) as string,
  } as Record<string, unknown> : null);
  const effectiveWhatReaderLearns = String(writerBrief?.whatShouldReaderLearn || '').trim() || (topicText ? `Reader understands ${topicText} and why it matters.` : '—');
  const effectiveProblemAddressed = String(writerBrief?.whatProblemAreWeAddressing || intent?.pain_point || '').trim() || (topicText ? `Uncertainty about ${topicText}` : '—');
  const masterContentFromPayload = asObject(payload?.dailyExecutionItem && asObject(payload.dailyExecutionItem)?.master_content);
  const masterContent = latestMasterContent || masterContentFromPayload;
  const hasMasterGenerated =
    String(masterContent?.generation_status || '').toLowerCase() === 'generated' ||
    String(masterContent?.content || '').trim().length > 0;

  /** Creator activities: video, carousel, story, reel, image, short — require uploaded asset as master source. */
  const contentType = String((dailyRaw?.content_type ?? dailyRaw?.contentType ?? 'post') as string).trim().toLowerCase();
  const executionMode = String((dailyRaw?.execution_mode ?? '') as string).trim() || inferExecutionMode(contentType);
  // Show creator panel for CREATOR_REQUIRED (video/reel/short) AND CONDITIONAL_AI (carousel/image/infographic)
  const isCreatorActivity = executionMode === 'CREATOR_REQUIRED' || executionMode === 'CONDITIONAL_AI';
  const creatorAsset = asObject(dailyRaw?.creator_asset);
  const hasCreatorAsset = Boolean(
    creatorAsset &&
    (String(creatorAsset.url ?? '').trim() ||
      (Array.isArray(creatorAsset.files) && creatorAsset.files.length > 0) ||
      (creatorAsset.platformUploads && Object.values(creatorAsset.platformUploads as Record<string, { url?: string; externalLink?: string }>).some((u) => u?.url?.trim() || u?.externalLink?.trim())))
  );
  const creatorHasMasterSource = hasCreatorAsset && (
    String(creatorAsset?.description ?? '').trim() ||
    String(creatorAsset?.transcript ?? '').trim() ||
    String(creatorAsset?.theme ?? '').trim() ||
    String(payload?.topic ?? payload?.title ?? '').trim()
  );

  /** When opened from daily view topic click: no delete, show add platform only. */
  const isDailyTopicView = payload?.source === 'daily';

  const allPlatformOptions = ['linkedin', 'facebook', 'instagram', 'x', 'youtube', 'tiktok', 'reddit', 'pinterest'];
  /** Suggested social media platforms for this activity (from execution item + current schedules). Same list shown in Writer Context and used in Platform Schedules. */
  const suggestedPlatforms = (() => {
    const seen = new Set<string>();
    const add = (platform: unknown) => {
      const p = normalizeKey(platform);
      if (p && allPlatformOptions.includes(p)) seen.add(p);
    };
    const daily = asObject(payload?.dailyExecutionItem);
    if (daily) {
      (Array.isArray((daily as any)?.selected_platforms) ? (daily as any).selected_platforms : []).forEach(add);
      (Array.isArray((daily as any)?.planned_platform_targets) ? (daily as any).planned_platform_targets : []).forEach((t: any) => add(t?.platform));
      (Array.isArray((daily as any)?.active_platform_targets) ? (daily as any).active_platform_targets : []).forEach((t: any) => add(t?.platform));
      (Array.isArray((daily as any)?.platform_variants) ? (daily as any).platform_variants : []).forEach((v: any) => add(v?.platform));
      add((daily as any)?.platform);
    }
    (payload?.schedules || schedules || []).forEach((s: ScheduleItem) => add(s.platform));
    const list = Array.from(seen);
    return list.length > 0 ? list : allPlatformOptions;
  })();
  const platformOptions = suggestedPlatforms;
  const contentTypeOptionsByPlatform: Record<string, string[]> = {
    linkedin: ['feed_post', 'article', 'white_paper', 'case_study', 'carousel', 'video', 'newsletter'],
    facebook: ['post', 'carousel', 'video', 'story', 'reel'],
    instagram: ['feed_post', 'carousel', 'reel', 'story', 'video'],
    x: ['tweet', 'thread', 'video', 'carousel'],
    youtube: ['video', 'short', 'description', 'live'],
    tiktok: ['video', 'short', 'carousel'],
    reddit: ['post', 'discussion', 'carousel'],
    pinterest: ['pin', 'carousel', 'video'],
  };
  const getContentTypeOptions = (platform: string) => {
    const key = normalizeKey(platform);
    const defaults = ['post', 'article', 'white_paper', 'video', 'carousel'];
    return contentTypeOptionsByPlatform[key] || defaults;
  };
  /** Video-dominant content types: for these, X (Twitter) is excluded when adding. Text types: YouTube excluded when adding. */
  const videoContentTypes = new Set(['video', 'short', 'reel', 'story', 'live', 'description']);
  const isVideoContentType = (ct: string) => videoContentTypes.has(normalizeKey(ct));
  /** Platforms that can be added for a given content type (aligned to content type: text → no YouTube, video → no X). */
  const getAddablePlatformsForContentType = (contentType: string) => {
    const ct = normalizeKey(contentType);
    const isVideo = isVideoContentType(ct);
    return allPlatformOptions.filter((platform) => {
      const opts = getContentTypeOptions(platform);
      if (!opts.map(normalizeKey).includes(ct)) return false;
      if (isVideo && (platform === 'x' || platform === 'twitter')) return false;
      if (!isVideo && platform === 'youtube') return false;
      return true;
    });
  };
  /** All content types across platforms (for add-variant flow). */
  const allContentTypesForAdd = useMemo(() => {
    const set = new Set<string>();
    Object.values(contentTypeOptionsByPlatform).forEach((opts) => opts.forEach((c) => set.add(normalizeKey(c))));
    return Array.from(set).sort();
  }, []);
  const labelize = (value: string) =>
    String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
  const normalizeComparableText = (value: unknown) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

  const buildScheduleRowsFromExecutionItem = (item: Record<string, unknown>, existingSchedules: ScheduleItem[]) => {
    const existingByKey = new Map<string, ScheduleItem>();
    for (const row of existingSchedules) {
      const key = `${normalizeKey(row.platform)}::${normalizeKey(row.contentType)}`;
      existingByKey.set(key, row);
    }

    const targets: Array<{ platform: string; contentType: string }> = [];
    const addTarget = (platform: unknown, contentType: unknown) => {
      const p = normalizeKey(platform);
      const c = normalizeKey(contentType) || 'post';
      if (!p) return;
      if (!targets.some((t) => t.platform === p && t.contentType === c)) {
        targets.push({ platform: p, contentType: c });
      }
    };

    const variants = Array.isArray((item as any)?.platform_variants) ? (item as any).platform_variants : [];
    variants.forEach((v: any) => addTarget(v?.platform, v?.content_type));

    const activeTargets = Array.isArray((item as any)?.active_platform_targets) ? (item as any).active_platform_targets : [];
    activeTargets.forEach((t: any) => addTarget(t?.platform, t?.content_type));

    const plannedTargets = Array.isArray((item as any)?.planned_platform_targets) ? (item as any).planned_platform_targets : [];
    plannedTargets.forEach((t: any) => addTarget(t?.platform, t?.content_type));

    const selectedPlatforms = Array.isArray((item as any)?.selected_platforms) ? (item as any).selected_platforms : [];
    selectedPlatforms.forEach((platform: any) => addTarget(platform, (item as any)?.content_type));

    addTarget((item as any)?.platform, (item as any)?.content_type);

    if (targets.length === 0 && existingSchedules.length > 0) return existingSchedules;

    return targets.map((t, idx) => {
      const key = `${t.platform}::${t.contentType}`;
      const existing = existingByKey.get(key);
      return {
        id: existing?.id || `hydrated-${t.platform}-${t.contentType}-${idx}`,
        platform: t.platform,
        contentType: t.contentType,
        date: existing?.date || existingSchedules[0]?.date || '',
        time: existing?.time || existingSchedules[0]?.time || '09:00',
        status: existing?.status,
        description: existing?.description,
        title: existing?.title,
      };
    });
  };

  const findVariantForSchedule = (item: ScheduleItem) => {
    const targetPlatform = normalizeKey(item.platform);
    const targetType = normalizeKey(item.contentType);
    return (
      platformVariants.find(
        (variant) =>
          normalizeKey(variant.platform) === targetPlatform &&
          normalizeKey(variant.content_type) === targetType
      ) ||
      platformVariants.find((variant) => normalizeKey(variant.platform) === targetPlatform) ||
      null
    );
  };

  const buildMarketingSupport = (
    platform: string,
    contentType: string,
    content: string,
    variant?: Record<string, unknown> | null
  ) => {
    const cleaned = String(content || '').trim();
    const platformKey = normalizeKey(platform);
    const typeKey = normalizeKey(contentType);
    const variantTrace = asObject((variant as any)?.adaptation_trace);
    const variantLimit = Number((variantTrace as any)?.character_limit_used);
    const defaultContentLimits: Record<string, number> = {
      'x::tweet': 280,
      'x::thread': 1800,
      'twitter::tweet': 280,
      'linkedin::feed_post': 3000,
      'linkedin::post': 3000,
      'facebook::post': 2000,
      'instagram::caption': 2200,
      'instagram::feed_post': 2200,
      'youtube::description': 5000,
      'youtube::video': 5000,
    };
    const fallbackContentLimit =
      defaultContentLimits[`${platformKey}::${typeKey}`] ||
      defaultContentLimits[`${platformKey}::post`] ||
      1200;
    const contentMax = Number.isFinite(variantLimit) && variantLimit > 0 ? variantLimit : fallbackContentLimit;
    const titleMax = platformKey === 'youtube' ? 100 : 80;
    const metaTitleMax = 60;
    const metaDescriptionMax = 160;
    const hashtagsMax = platformKey === 'instagram' ? 30 : platformKey === 'x' || platformKey === 'twitter' ? 10 : 8;
    const keywordsMax = 10;
    const targetRatio = 0.9;

    const sourceWords = Array.from(
      new Set(
        cleaned
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .map((w) => w.trim())
          .filter((w) => w.length >= 4)
      )
    );
    const sourceSentence = cleaned.replace(/\s+/g, ' ').trim();
    const fillTextAtTarget = (seed: string, max: number) => {
      const target = Math.max(1, Math.floor(max * targetRatio));
      let out = String(seed || '').replace(/\s+/g, ' ').trim();
      const source = sourceSentence || String(payload?.title || payload?.topic || 'Campaign content').trim();
      if (!out) out = source;
      if (out.length >= target) return out.slice(0, max).trim();
      const sourceTokens = source.split(/\s+/).filter(Boolean);
      let idx = 0;
      while (out.length < target && sourceTokens.length > 0) {
        out = `${out} ${sourceTokens[idx % sourceTokens.length]}`.trim();
        idx += 1;
      }
      return out.slice(0, max).trim();
    };
    const fillListAtTarget = (
      seeds: string[],
      maxCount: number,
      formatter?: (v: string) => string
    ) => {
      const targetCount = Math.max(1, Math.ceil(maxCount * targetRatio));
      const cleanedSeeds = seeds
        .map((v) => normalizeKey(v).replace(/[^a-z0-9_]+/g, ''))
        .filter(Boolean);
      const values: string[] = [];
      for (const seed of cleanedSeeds) {
        if (!values.includes(seed)) values.push(seed);
      }
      for (const word of sourceWords) {
        if (values.length >= targetCount) break;
        if (!values.includes(word)) values.push(word);
      }
      const capped = values.slice(0, maxCount);
      return formatter ? capped.map(formatter) : capped;
    };

    const lines = cleaned
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const firstSentence =
      cleaned.split(/[.!?]/).map((p) => p.trim()).find(Boolean) ||
      lines[0] ||
      String(payload?.title || payload?.topic || 'Campaign content').trim();
    const title = fillTextAtTarget(firstSentence, titleMax);
    const metaTitle = fillTextAtTarget(`${title} | ${String(platform).toUpperCase()}`, metaTitleMax);
    const metaDescription = fillTextAtTarget(cleaned || title, metaDescriptionMax);
    const extractedHashtags = Array.from(
      new Set((cleaned.match(/#[A-Za-z0-9_]+/g) || []).map((tag) => tag.toLowerCase()))
    );
    const seededHashtags = [
      `#${normalizeKey(platform).replace(/[^a-z0-9]+/g, '') || 'social'}`,
      '#marketing',
      '#contentstrategy',
    ];
    const hashtags = fillListAtTarget(
      [...extractedHashtags, ...seededHashtags],
      hashtagsMax,
      (v) => (v.startsWith('#') ? v : `#${v}`)
    );
    const keywordSeed = `${payload?.topic || payload?.title || ''} ${title}`;
    const keywords = fillListAtTarget(
      keywordSeed
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 4),
      keywordsMax
    );
    const cta =
      normalizeKey(platform) === 'linkedin'
        ? 'Ask a professional question to drive comments.'
        : normalizeKey(platform) === 'x'
          ? 'End with a concise action line and a hashtag.'
          : 'Use a clear CTA to encourage engagement or clicks.';

    return {
      title,
      metaTitle,
      metaDescription,
      hashtags,
      keywords,
      cta,
      limits: {
        contentMax,
        titleMax,
        metaTitleMax,
        metaDescriptionMax,
        hashtagsMax,
        keywordsMax,
      },
      utilization: {
        contentPct: contentMax > 0 ? Math.round((cleaned.length / contentMax) * 100) : null,
        titlePct: titleMax > 0 ? Math.round((title.length / titleMax) * 100) : null,
        metaTitlePct: metaTitleMax > 0 ? Math.round((metaTitle.length / metaTitleMax) * 100) : null,
        metaDescriptionPct: metaDescriptionMax > 0 ? Math.round((metaDescription.length / metaDescriptionMax) * 100) : null,
        hashtagsPct: hashtagsMax > 0 ? Math.round((hashtags.length / hashtagsMax) * 100) : null,
        keywordsPct: keywordsMax > 0 ? Math.round((keywords.length / keywordsMax) * 100) : null,
      },
    };
  };

  useEffect(() => {
    if (!payload || hasTriedHydration || isHydratingContext) return;
    const campaignId = String(payload.campaignId || '').trim();
    const weekNumber = Number(payload.weekNumber);
    const currentTitle = normalizeComparableText(payload.title || payload.topic || '');
    if (!campaignId || !Number.isFinite(weekNumber) || !currentTitle) {
      setHasTriedHydration(true);
      return;
    }

    const currentDaily = asObject(payload.dailyExecutionItem) || {};
    const hasRichContext =
      Boolean(asObject(currentDaily.intent)) &&
      Boolean(asObject(currentDaily.writer_content_brief));
    if (hasRichContext && schedules.length > 1) {
      setHasTriedHydration(true);
      return;
    }

    let cancelled = false;
    const hydrate = async () => {
      try {
        setIsHydratingContext(true);
        const [weeklyRes, dailyRes] = await Promise.all([
          fetch(`/api/campaigns/get-weekly-plans?campaignId=${encodeURIComponent(campaignId)}`),
          fetch(`/api/campaigns/daily-plans?campaignId=${encodeURIComponent(campaignId)}`),
        ]);

        const weeklyData = weeklyRes.ok ? await weeklyRes.json().catch(() => []) : [];
        const dailyData = dailyRes.ok ? await dailyRes.json().catch(() => []) : [];
        if (cancelled) return;

        const weeks = Array.isArray(weeklyData) ? weeklyData : [];
        const weekMatch =
          weeks.find((w: any) => Number(w?.weekNumber) === weekNumber) ||
          weeks.find((w: any) => Number(w?.week_number) === weekNumber) ||
          null;
        const executionItems = Array.isArray((weekMatch as any)?.execution_items)
          ? (weekMatch as any).execution_items
          : [];

        const matchedExecution = executionItems.find((item: any) => {
          const t1 = normalizeComparableText(item?.title || '');
          const t2 = normalizeComparableText(item?.topic || '');
          return t1 === currentTitle || t2 === currentTitle;
        }) || null;

        const dailyPlans = Array.isArray(dailyData) ? dailyData : [];
        const matchedDailyRows = dailyPlans.filter((row: any) => {
          const rowWeek = Number(row?.weekNumber || row?.week_number);
          const rowTitle = normalizeComparableText(row?.title || row?.topic || '');
          return rowWeek === weekNumber && rowTitle === currentTitle;
        });

        if (!matchedExecution && matchedDailyRows.length === 0) {
          setHasTriedHydration(true);
          return;
        }

        const fromDailyRow = matchedDailyRows[0];
        const dailyRowBrief = fromDailyRow && (asObject((fromDailyRow as any)?.dailyObject) || fromDailyRow);
        const builtBriefFromRow = dailyRowBrief && !asObject((currentDaily as any)?.writer_content_brief) && !asObject((matchedExecution as any)?.writer_content_brief) ? {
          topicTitle: (dailyRowBrief.topicTitle ?? dailyRowBrief.topic ?? payload?.title ?? payload?.topic) as string,
          writingIntent: (dailyRowBrief.writingIntent ?? dailyRowBrief.description) as string,
          whatShouldReaderLearn: (dailyRowBrief.whatShouldReaderLearn ?? dailyRowBrief.introObjective) as string,
          whatProblemAreWeAddressing: (dailyRowBrief.whatProblemAreWeAddressing ?? dailyRowBrief.summary) as string,
          desiredAction: (dailyRowBrief.desiredAction ?? dailyRowBrief.cta) as string,
          narrativeStyle: (dailyRowBrief.narrativeStyle ?? dailyRowBrief.brandVoice) as string,
          topicGoal: (dailyRowBrief.dailyObjective ?? dailyRowBrief.objective) as string,
        } as Record<string, unknown> : null;
        const builtIntentFromRow = dailyRowBrief && !asObject((currentDaily as any)?.intent) && !asObject((matchedExecution as any)?.intent) ? {
          objective: (dailyRowBrief.dailyObjective ?? dailyRowBrief.objective) as string,
          pain_point: (dailyRowBrief.whatProblemAreWeAddressing ?? dailyRowBrief.summary ?? dailyRowBrief.pain_point) as string,
          outcome_promise: (dailyRowBrief.whatShouldReaderLearn ?? dailyRowBrief.introObjective ?? dailyRowBrief.outcome_promise) as string,
          cta_type: (dailyRowBrief.desiredAction ?? dailyRowBrief.cta ?? dailyRowBrief.cta_type) as string,
        } as Record<string, unknown> : null;

        const nextDailyExecution = {
          ...(matchedExecution || {}),
          ...currentDaily,
          intent: asObject((currentDaily as any)?.intent) || asObject((matchedExecution as any)?.intent) || builtIntentFromRow || undefined,
          writer_content_brief:
            asObject((currentDaily as any)?.writer_content_brief) ||
            asObject((matchedExecution as any)?.writer_content_brief) ||
            builtBriefFromRow ||
            undefined,
          master_content:
            asObject((currentDaily as any)?.master_content) ||
            asObject((matchedExecution as any)?.master_content) ||
            undefined,
          platform_variants:
            Array.isArray((currentDaily as any)?.platform_variants) && (currentDaily as any).platform_variants.length > 0
              ? (currentDaily as any).platform_variants
              : (Array.isArray((matchedExecution as any)?.platform_variants) ? (matchedExecution as any).platform_variants : undefined),
        };

        const hydratedSchedules = buildScheduleRowsFromExecutionItem(
          nextDailyExecution,
          schedules
        ).map((row) => {
          const matchingDaily = matchedDailyRows.find(
            (d: any) =>
              normalizeKey(d?.platform) === normalizeKey(row.platform) &&
              normalizeKey(d?.contentType) === normalizeKey(row.contentType)
          );
          const scheduledTime = String(matchingDaily?.scheduledTime || '').trim();
          const normalizedTime = scheduledTime ? scheduledTime.split(':').slice(0, 2).join(':') : row.time;
          return {
            ...row,
            time: normalizedTime || row.time || '09:00',
          };
        });

        setPayload((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            dailyExecutionItem: nextDailyExecution,
            ...((weekMatch as any)?.distribution_strategy != null
              ? { distribution_strategy: (weekMatch as any).distribution_strategy }
              : {}),
            ...((weekMatch as any)?.distribution_reason != null
              ? { distribution_reason: (weekMatch as any).distribution_reason }
              : {}),
            ...((weekMatch as any)?.planning_adjustment_reason != null
              ? { planning_adjustment_reason: (weekMatch as any).planning_adjustment_reason }
              : {}),
            ...((weekMatch as any)?.planning_adjustments_summary != null
              ? { planning_adjustments_summary: (weekMatch as any).planning_adjustments_summary }
              : {}),
            ...((weekMatch as any)?.momentum_adjustments != null
              ? { momentum_adjustments: (weekMatch as any).momentum_adjustments }
              : {}),
            ...((weekMatch as any)?.week_extras != null
              ? { week_extras: (weekMatch as any).week_extras }
              : {}),
          };
        });
        setSchedules(hydratedSchedules);
      } catch (error) {
        console.warn('Workspace hydration failed:', error);
      } finally {
        if (!cancelled) {
          setIsHydratingContext(false);
          setHasTriedHydration(true);
        }
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [payload, hasTriedHydration, isHydratingContext, schedules]);

  const updateSchedule = (id: string, updates: Partial<ScheduleItem>) => {
    setSchedules((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
    if (Object.prototype.hasOwnProperty.call(updates, 'platform') || Object.prototype.hasOwnProperty.call(updates, 'contentType')) {
      setFinalizedByScheduleId((prev) => ({ ...prev, [id]: false }));
    }
  };

  const addScheduleRow = () => {
    const first = schedules[0];
    const preferred = normalizeKey(first?.platform);
    const platform =
      (preferred && suggestedPlatforms.includes(preferred) ? preferred : null) ||
      suggestedPlatforms[0] ||
      'linkedin';
    const contentType = normalizeKey(first?.contentType) || getContentTypeOptions(platform)[0];
    const row: ScheduleItem = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      platform,
      contentType,
      date: first?.date || '',
      time: first?.time || '09:00',
      status: 'planned',
      title: payload?.title,
      description: payload?.description,
    };
    setSchedules((prev) => [...prev, row]);
  };

  const removeScheduleRow = (id: string) => {
    setSchedules((prev) => prev.filter((row) => row.id !== id));
  };

  const upsertVariantForSchedule = (schedule: ScheduleItem, updates: Record<string, unknown>) => {
    const next = [...platformVariants];
    const existingIndex = next.findIndex(
      (variant) =>
        normalizeKey((variant as any)?.platform) === normalizeKey(schedule.platform) &&
        normalizeKey((variant as any)?.content_type) === normalizeKey(schedule.contentType)
    );
    const base =
      existingIndex >= 0
        ? (next[existingIndex] as Record<string, unknown>)
        : ({
            platform: schedule.platform,
            content_type: schedule.contentType,
            generated_content: '',
            generation_status: 'generated',
            adapted_from_master: true,
            locked_variant: false,
          } as Record<string, unknown>);
    const merged = {
      ...base,
      platform: schedule.platform,
      content_type: schedule.contentType,
      ...updates,
    };
    if (existingIndex >= 0) {
      next[existingIndex] = merged;
    } else {
      next.push(merged);
    }
    const nextDaily = {
      ...(payload?.dailyExecutionItem || {}),
      platform_variants: next,
    };
    setPayload((prev) => (prev ? { ...prev, dailyExecutionItem: nextDaily } : prev));
  };

  const handleRefineWithAi = async (schedule: ScheduleItem) => {
    const prompt = String(refineInputByScheduleId[schedule.id] || '').trim();
    if (!prompt) {
      notify('info', 'Type refinement instruction first.');
      return;
    }
    const variant = findVariantForSchedule(schedule);
    const currentContent = String((variant as any)?.generated_content || '').trim();
    if (!currentContent) {
      notify('info', 'Generate repurposed content first.');
      return;
    }
    try {
      setIsRefiningByScheduleId((prev) => ({ ...prev, [schedule.id]: true }));
      const response = await apiFetch('/api/activity-workspace/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refine_variant',
          activity: buildActivityRequestPayload(),
          schedule,
          refinement_prompt: prompt,
          current_content: currentContent,
          dailyExecutionItem: payload?.dailyExecutionItem || null,
          companyId: selectedCompanyId || payload?.companyId || null,
          campaignId: payload?.campaignId || queryCampaignId || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.message || data?.error || 'Failed to refine content'));
      }
      const refinedContent = String(data?.refined_content || '').trim();
      if (!refinedContent) {
        throw new Error('AI returned empty refined content');
      }
      upsertVariantForSchedule(schedule, {
        generated_content: refinedContent,
        generation_status: 'generated',
        refinement_status: 'in_progress',
        refinement_finalized: false,
      });
      setRefineMessagesByScheduleId((prev) => ({
        ...prev,
        [schedule.id]: [
          ...(prev[schedule.id] || []),
          { role: 'user', content: prompt },
          { role: 'assistant', content: refinedContent },
        ],
      }));
      setRefineInputByScheduleId((prev) => ({ ...prev, [schedule.id]: '' }));
      setFinalizedByScheduleId((prev) => ({ ...prev, [schedule.id]: false }));
      updateSchedule(schedule.id, { status: 'in-progress' });
    } catch (error) {
      console.error('Refine with AI failed:', error);
      notify('error', `Failed to refine content: ${String((error as any)?.message || error)}`);
    } finally {
      setIsRefiningByScheduleId((prev) => ({ ...prev, [schedule.id]: false }));
    }
  };

  const finalizeRepurposeForSchedule = (schedule: ScheduleItem) => {
    const variant = findVariantForSchedule(schedule);
    const content = String((variant as any)?.generated_content || '').trim();
    if (!content) {
      notify('info', 'Generate content before finalizing.');
      return;
    }
    setFinalizedByScheduleId((prev) => ({ ...prev, [schedule.id]: true }));
    upsertVariantForSchedule(schedule, {
      refinement_status: 'finalized',
      refinement_finalized: true,
    });
    updateSchedule(schedule.id, { status: 'finalized' });
  };

  const scheduleFinalizedContent = async (schedule: ScheduleItem) => {
    const variant = findVariantForSchedule(schedule);
    // generated_content may be HTML (from RichTextEditor) or plain text — normalise to plain
    const rawContent = htmlToPlainText(String((variant as any)?.generated_content || '')).trim();

    if (!rawContent) {
      notify('info', 'Generate and finalize content before scheduling.');
      return;
    }
    if (!schedule.date) {
      notify('info', 'Set a date for this schedule item first.');
      return;
    }

    // Append hashtags from discoverability_meta (single source of truth)
    const hashtags: string[] = Array.isArray((variant as any)?.discoverability_meta?.hashtags)
      ? (variant as any).discoverability_meta.hashtags
      : [];
    const hashtagLine = hashtags.filter(Boolean).join(' ');
    const fullContent = hashtagLine ? `${rawContent}\n\n${hashtagLine}` : rawContent;

    const campaignId = String(payload?.campaignId || '').trim();
    const companyId = String(payload?.companyId || '').trim();
    // For cross-week platforms, use the schedule's own executionId; fall back to primary
    const executionId = String(
      schedule.executionId ||
      (payload?.dailyExecutionItem as any)?.execution_id ||
      ''
    ).trim();

    setSchedulingByScheduleId((prev) => ({ ...prev, [schedule.id]: true }));
    try {
      const r = await apiFetch('/api/activity-workspace/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          companyId,
          executionId,
          platform: schedule.platform,
          contentType: schedule.contentType,
          title: String(payload?.title || payload?.topic || schedule.title || '').trim(),
          content: fullContent,
          scheduledDate: schedule.date,
          scheduledTime: schedule.time || '09:00',
          repurposeIndex: schedule.sequence_index ?? 1,
          repurposeTotal: schedule.total_distributions ?? 1,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        const errMsg = String(err?.error || 'Failed to schedule post');
        notify('error', errMsg);
        // If no account found, refresh connection status so the warning badge appears
        if (r.status === 422) {
          const companyId = String(payload?.companyId || '').trim();
          if (companyId) {
            apiFetch(`/api/social-accounts/status?companyId=${encodeURIComponent(companyId)}`)
              .then((sr) => (sr.ok ? sr.json() : null))
              .then((data) => {
                if (!data?.accounts) return;
                const connected = new Set<string>(
                  (data.accounts as Array<{ platform_key: string; connected: boolean }>)
                    .filter((a) => a.connected)
                    .map((a) => a.platform_key)
                );
                setConnectedPlatforms(connected);
              })
              .catch(() => {});
          }
        }
        return;
      }
      updateSchedule(schedule.id, { status: 'scheduled' });
      notify('success', `Scheduled ${labelize(schedule.platform)} ${labelize(schedule.contentType)} for ${schedule.date} — visible on the dashboard calendar.`);
    } catch (e: any) {
      notify('error', String(e?.message || 'Failed to schedule post'));
    } finally {
      setSchedulingByScheduleId((prev) => ({ ...prev, [schedule.id]: false }));
    }
  };

  const saveAndSendBack = () => {
    if (workspaceKey) {
      try {
        const nextPayload = { ...(payload || {}), schedules };
        window.sessionStorage.setItem(workspaceKey, JSON.stringify(nextPayload));
      } catch (error) {
        console.warn('Failed to persist workspace payload:', error);
      }
    }
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        {
          type: 'ACTIVITY_WORKSPACE_SAVE',
          workspaceKey,
          schedules,
          dailyExecutionItem: payload?.dailyExecutionItem || null,
        },
        window.location.origin
      );
    }
    notify('success', 'Changes saved to daily planner.');
  };

  /** Build URL to campaign details (weekly/daily views); hierarchical planning screen removed. */
  const getBackToWeekPlanUrl = (): string | null => {
    const cid = String(payload?.campaignId || '').trim();
    if (!cid) return null;
    const params = new URLSearchParams();
    const companyId = payload?.companyId != null ? String(payload.companyId) : '';
    if (companyId) params.set('companyId', companyId);
    if (payload?.weekNumber != null && Number.isFinite(payload.weekNumber)) params.set('week', String(payload.weekNumber));
    const qs = params.toString();
    return `/campaign-details/${cid}${qs ? `?${qs}` : ''}`;
  };

  const handleBackToWeekPlan = () => {
    const url = getBackToWeekPlanUrl();
    if (url) {
      router.push(url);
    } else {
      router.back();
    }
  };

  const buildActivityRequestPayload = () => {
    const primary = schedules[0];
    return {
      id: payload?.activityId || primary?.id || `workspace-${Date.now()}`,
      platform: primary?.platform || 'linkedin',
      contentType: primary?.contentType || 'post',
      topic: payload?.topic || payload?.title || '',
      title: payload?.title || payload?.topic || '',
      description: payload?.description || '',
    };
  };

  const handleGenerateMasterContent = async () => {
    try {
      setIsGeneratingMaster(true);
      const response = await apiFetch('/api/activity-workspace/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_master',
          activity: buildActivityRequestPayload(),
          schedules,
          dailyExecutionItem: payload?.dailyExecutionItem || null,
          companyId: selectedCompanyId || payload?.companyId || null,
          campaignId: payload?.campaignId || queryCampaignId || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.message || data?.error || 'Failed to generate master content'));
      }
      const masterFromResponse =
        asObject(data?.master_content) ||
        asObject(data?.masterContent) ||
        asObject(data?.result && asObject(data.result)?.master_content) ||
        null;
      if (masterFromResponse) {
        setLatestMasterContent(masterFromResponse);
      }
      setPayload((prev) => {
        if (!prev) return prev;
        const current = asObject(prev.dailyExecutionItem) || {};
        return {
          ...prev,
          dailyExecutionItem: {
            ...current,
            master_content: masterFromResponse || data.master_content,
          },
        };
      });
      notify('success', 'Master content generated.');
    } catch (error) {
      console.error('Master generation failed:', error);
      notify('error', `Failed to generate master content: ${String((error as any)?.message || error)}`);
    } finally {
      setIsGeneratingMaster(false);
    }
  };

  const onGenerateVariants = async () => {
    const campaignId = String(payload?.campaignId ?? '').trim();
    const executionId = String(payload?.activityId ?? (payload?.dailyExecutionItem as any)?.execution_id ?? '').trim();
    const masterDoc = payload?.master_content_document ?? null;
    const dailyExecutionItem = payload?.dailyExecutionItem ?? null;
    if (!campaignId || !executionId) {
      notify('info', 'Campaign and activity context required.');
      return;
    }
    try {
      setIsGeneratingVariants(true);
      const result = await executeMasterContentPipeline({
        campaignId,
        executionId,
        masterDocument: masterDoc,
        dailyExecutionItem,
        schedules,
        companyId: selectedCompanyId || payload?.companyId || null,
      });
      const incomingVariants = Array.isArray(result.platform_variants) ? result.platform_variants : [];
      const normalizeKey = (v: unknown) => String(v ?? '').trim().toLowerCase();
      const mergedByKey = new Map<string, Record<string, unknown>>();
      const existingVariants = Array.isArray((dailyExecutionItem as any)?.platform_variants) ? (dailyExecutionItem as any).platform_variants : [];
      for (const v of existingVariants) {
        const key = `${normalizeKey((v as any)?.platform)}::${normalizeKey((v as any)?.content_type)}`;
        if (key !== '::') mergedByKey.set(key, v as Record<string, unknown>);
      }
      for (const v of incomingVariants) {
        const key = `${normalizeKey((v as any)?.platform)}::${normalizeKey((v as any)?.content_type)}`;
        if (key !== '::') {
          mergedByKey.set(key, {
            ...(v as Record<string, unknown>),
            generated_content: (v as any)?.generated_content ?? (v as any)?.content,
            generation_status: 'generated',
          });
        }
      }
      const mergedVariants = Array.from(mergedByKey.values());
      const nextPlatformVariantsRecord: Record<string, { execution_id: string; status: 'PENDING' | 'GENERATED'; content?: string }> = { ...(masterDoc?.platform_variants ?? {}) };
      for (const v of incomingVariants) {
        const platform = normalizeKey((v as any)?.platform);
        if (!platform) continue;
        const content = String((v as any)?.generated_content ?? (v as any)?.content ?? '').trim();
        const execution_id = (masterDoc?.platform_variants?.[platform] as any)?.execution_id ?? executionId;
        nextPlatformVariantsRecord[platform] = { execution_id, status: 'GENERATED' as const, content: content || undefined };
      }
      if (result.master_content) {
        setLatestMasterContent(result.master_content as Record<string, unknown>);
      }
      setPayload((prev) => {
        if (!prev) return prev;
        const current = asObject(prev.dailyExecutionItem) || {};
        return {
          ...prev,
          master_content_document: masterDoc
            ? { ...masterDoc, platform_variants: nextPlatformVariantsRecord }
            : prev.master_content_document,
          dailyExecutionItem: {
            ...current,
            ...(result.master_content ? { master_content: result.master_content } : {}),
            platform_variants: mergedVariants,
          },
        };
      });
      notify('success', 'Platform variants generated.');
    } catch (error) {
      console.error('Generate variants failed:', error);
      notify('error', `Failed to generate variants: ${String((error as any)?.message || error)}`);
    } finally {
      setIsGeneratingVariants(false);
    }
  };

  const handleRepurposeForPlatform = async (schedule: ScheduleItem) => {
    try {
      setRepurposingByScheduleId((prev) => ({ ...prev, [schedule.id]: true }));
      const currentDaily = asObject(payload?.dailyExecutionItem) || {};

      // Auto-generate master content if not yet available
      let activeMasterContent = masterContent || currentDaily.master_content || null;
      const masterReady = activeMasterContent && String((activeMasterContent as any)?.content || '').trim().length > 0;
      if (!masterReady) {
        setIsGeneratingMaster(true);
        try {
          const masterRes = await apiFetch('/api/activity-workspace/content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'generate_master',
              activity: buildActivityRequestPayload(),
              schedules,
              dailyExecutionItem: payload?.dailyExecutionItem || null,
              companyId: selectedCompanyId || payload?.companyId || null,
              campaignId: payload?.campaignId || queryCampaignId || null,
            }),
          });
          const masterData = await masterRes.json().catch(() => ({}));
          if (masterRes.ok) {
            const newMaster = asObject(masterData?.master_content) || asObject(masterData?.masterContent) || null;
            if (newMaster) {
              activeMasterContent = newMaster;
              setLatestMasterContent(newMaster);
              setPayload((prev) => {
                if (!prev) return prev;
                const cur = asObject(prev.dailyExecutionItem) || {};
                return { ...prev, dailyExecutionItem: { ...cur, master_content: newMaster } };
              });
            }
          }
        } finally {
          setIsGeneratingMaster(false);
        }
      }

      const response = await apiFetch('/api/activity-workspace/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_variants',
          activity: buildActivityRequestPayload(),
          schedules: [schedule],
          dailyExecutionItem: {
            ...currentDaily,
            master_content: activeMasterContent || currentDaily.master_content || null,
            platform_variants: platformVariants,
          },
          companyId: selectedCompanyId || payload?.companyId || null,
          campaignId: payload?.campaignId || queryCampaignId || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.message || data?.error || 'Failed to repurpose content'));
      }
      // If the API auto-generated a master (first repurpose press), capture it in state
      const returnedMaster = asObject(data?.master_content);
      if (returnedMaster && !activeMasterContent) {
        activeMasterContent = returnedMaster;
        setLatestMasterContent(returnedMaster);
      }
      const incoming = Array.isArray(data.platform_variants) ? data.platform_variants : [];
      const mergedByKey = new Map<string, Record<string, unknown>>();
      for (const variant of platformVariants) {
        const key = `${normalizeKey(variant.platform)}::${normalizeKey(variant.content_type)}`;
        mergedByKey.set(key, variant);
      }
      for (const variant of incoming) {
        const key = `${normalizeKey((variant as any)?.platform)}::${normalizeKey((variant as any)?.content_type)}`;
        if (key !== '::') {
          mergedByKey.set(key, variant as Record<string, unknown>);
        }
      }
      const mergedVariants = Array.from(mergedByKey.values());
      setPayload((prev) => {
        if (!prev) return prev;
        const current = asObject(prev.dailyExecutionItem) || {};
        return {
          ...prev,
          dailyExecutionItem: {
            ...current,
            platform_variants: mergedVariants,
            // Keep master in payload so page reload can recover it from state
            ...(returnedMaster && !current.master_content ? { master_content: returnedMaster } : {}),
          },
        };
      });
      setFinalizedByScheduleId((prev) => ({ ...prev, [schedule.id]: false }));
      setShowRefineByScheduleId((prev) => ({ ...prev, [schedule.id]: true }));
      updateSchedule(schedule.id, { status: 'in-progress' });
      notify('success', `Repurposed content generated for ${schedule.platform}.`);
    } catch (error) {
      console.error('Repurpose generation failed:', error);
      notify('error', `Failed to repurpose content: ${String((error as any)?.message || error)}`);
    } finally {
      setRepurposingByScheduleId((prev) => ({ ...prev, [schedule.id]: false }));
    }
  };

  const handleRepurposeAll = async () => {
    const pending = schedules.filter((s) => {
      const variant = findVariantForSchedule(s);
      return !String((variant as any)?.generated_content || '').trim();
    });
    if (pending.length === 0) {
      notify('info', 'All platforms already have generated content.');
      return;
    }
    // Generate sequentially to avoid rate limits
    for (const schedule of pending) {
      await handleRepurposeForPlatform(schedule);
    }
  };

  const handleCreatorAssetSaved = (asset: { type: string; url?: string; files?: string[]; description?: string; transcript?: string; theme?: string }) => {
    setPayload((prev) => {
      if (!prev) return prev;
      const current = asObject(prev.dailyExecutionItem) || {};
      return {
        ...prev,
        dailyExecutionItem: {
          ...current,
          creator_asset: asset,
          content_status: 'READY_FOR_PROMOTION',
        },
      };
    });
  };

  const handleGenerateCreatorPromotion = async () => {
    const campaignId = String(payload?.campaignId ?? '').trim();
    const executionId = String(payload?.activityId ?? (payload?.dailyExecutionItem as any)?.execution_id ?? '').trim();
    const currentDaily = asObject(payload?.dailyExecutionItem) || {};
    if (!campaignId || !executionId) {
      notify('info', 'Campaign and activity context required.');
      return;
    }
    try {
      setIsGeneratingVariants(true);
      const response = await apiFetch('/api/activity-workspace/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_variants',
          activity: buildActivityRequestPayload(),
          schedules: schedules.length > 0 ? schedules : [{ id: 'default', platform: 'linkedin', contentType: 'post' }],
          dailyExecutionItem: {
            ...currentDaily,
            creator_asset: creatorAsset,
            master_content: null,
            platform_variants: platformVariants,
          },
          companyId: selectedCompanyId || payload?.companyId || null,
          campaignId: payload?.campaignId || queryCampaignId || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.message || data?.error || 'Failed to generate promotion content'));
      }
      const incoming = Array.isArray(data.platform_variants) ? data.platform_variants : [];
      const mergedByKey = new Map<string, Record<string, unknown>>();
      for (const variant of platformVariants) {
        const key = `${normalizeKey(variant.platform)}::${normalizeKey(variant.content_type)}`;
        mergedByKey.set(key, variant);
      }
      for (const variant of incoming) {
        const key = `${normalizeKey((variant as any)?.platform)}::${normalizeKey((variant as any)?.content_type)}`;
        if (key !== '::') mergedByKey.set(key, variant as Record<string, unknown>);
      }
      const mergedVariants = Array.from(mergedByKey.values());
      setPayload((prev) => {
        if (!prev) return prev;
        const current = asObject(prev.dailyExecutionItem) || {};
        return {
          ...prev,
          dailyExecutionItem: {
            ...current,
            creator_asset: creatorAsset,
            platform_variants: mergedVariants,
          },
        };
      });
      notify('success', 'Promotion content generated.');
    } catch (error) {
      console.error('Generate creator promotion failed:', error);
      notify('error', `Failed to generate: ${String((error as any)?.message || error)}`);
    } finally {
      setIsGeneratingVariants(false);
    }
  };

  if (!isLoaded) {
    return <div className="p-6 text-gray-600">Loading activity workspace...</div>;
  }

  if (!payload) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold text-gray-900">Workspace not found</h1>
          <p className="text-sm text-gray-600 mt-2">
            This activity workspace is missing or expired. Please open it again from Daily Planning.
          </p>
          <button
            onClick={() => window.close()}
            className="mt-4 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {notice && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-indigo-200 bg-indigo-50 text-indigo-800'
            }`}
            role="status"
            aria-live="polite"
          >
            {notice.message}
          </div>
        )}
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Activity Content Workspace</h1>
            <p className="text-sm text-gray-600">
              Week {payload.weekNumber || '—'} • {payload.day || '—'} • {payload.title || 'Untitled activity'}
              {(payload as any).distribution_strategy && (
                <> • Distribution: {String((payload as any).distribution_strategy).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())}</>
              )}
            </p>
            {(payload as any).distribution_reason && (
              <p className="text-xs text-gray-500 mt-0.5">Why: {(payload as any).distribution_reason}</p>
            )}
            {(payload as any).planning_adjustment_reason && (
              <p className="text-xs text-gray-500 mt-0.5">{(payload as any).planning_adjustment_reason}</p>
            )}
            {(payload as any).planning_adjustments_summary?.text && (
              <p className="text-xs text-gray-500 mt-0.5">What changed: {(payload as any).planning_adjustments_summary.text}</p>
            )}
            {(payload as any).momentum_adjustments?.absorbed_from_week?.length ? (
              <p className="text-xs text-gray-500 mt-0.5">
                Momentum adjusted from Week {(payload as any).momentum_adjustments.absorbed_from_week.join(', ')}
                {(payload as any).momentum_adjustments?.momentum_transfer_strength ? (
                  <> · Momentum: {(payload as any).momentum_adjustments.momentum_transfer_strength.charAt(0).toUpperCase()}{(payload as any).momentum_adjustments.momentum_transfer_strength.slice(1)} adjustment</>
                ) : null}
              </p>
            ) : null}
            {(payload as any).week_extras?.recovered_topics?.length ? (
              <p className="text-xs text-gray-500 mt-0.5" title={((payload as any).week_extras.recovered_topics as Array<{ topic: string; recovered_from_week: number }>).map((r) => r.topic).join(', ')}>
                Narrative recovered from Week {((payload as any).week_extras.recovered_topics as Array<{ recovered_from_week: number }>).map((r) => r.recovered_from_week).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
              </p>
            ) : null}
            {aiPreviewMessage ? (
              <p className="text-xs text-slate-500 italic mt-0.5">AI Preview: {aiPreviewMessage}</p>
            ) : null}
            {aiConfidenceMessage ? (
              <p className="text-xs text-slate-400 italic mt-0.5">{aiConfidenceMessage}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBackToWeekPlan}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to week plan
            </button>
            <button
              onClick={saveAndSendBack}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              Save Changes
            </button>
            <button
              onClick={() => window.close()}
              className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex gap-1 border-b border-gray-200 mb-2">
          <button
            type="button"
            onClick={() => setActivityTab('content')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px ${
              activityTab === 'content' ? 'border-indigo-600 text-indigo-600 bg-white' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Content
          </button>
          <button
            type="button"
            onClick={() => setActivityTab('community_responses')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px flex items-center gap-1.5 ${
              activityTab === 'community_responses' ? 'border-indigo-600 text-indigo-600 bg-white' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            Community Responses
          </button>
          <button
            type="button"
            onClick={() => setActivityTab('discussion')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px flex items-center gap-1.5 ${
              activityTab === 'discussion' ? 'border-indigo-600 text-indigo-600 bg-white' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Discussion
          </button>
        </div>

        {activityTab === 'discussion' ? (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden min-h-[240px]">
            {payload?.campaignId && (queryExecutionId || payload?.activityId) ? (
              <ActivityDiscussionTab
                campaignId={payload.campaignId}
                activityId={queryExecutionId || payload.activityId || ''}
                currentUserId={user?.userId ?? ''}
                fetchWithAuth={async (input, init) => {
                  const { data } = await (await import('../utils/supabaseClient')).supabase.auth.getSession();
                  const token = data.session?.access_token;
                  return fetch(input, { ...init, headers: { ...(init?.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
                }}
              />
            ) : (
              <div className="p-6 text-sm text-gray-500">Open an activity to view discussion.</div>
            )}
          </div>
        ) : activityTab === 'community_responses' ? (
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Community Responses</h2>
            <p className="text-sm text-gray-600">
              Comments, mentions, and discussion threads linked to this campaign activity.
            </p>
            {communitySignalsLoading ? (
              <div className="flex items-center gap-2 py-8 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading signals...
              </div>
            ) : communitySignals.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-600">
                No community responses yet. Engagement signals appear when comments, mentions, or discussions are detected for this activity.
              </div>
            ) : (
              <div className="space-y-3">
                {communitySignals.map((sig) => (
                  <div
                    key={sig.id}
                    className="rounded-lg border border-gray-200 p-4 bg-gray-50/50 hover:bg-gray-50 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                          <span className="font-medium text-gray-900">{sig.author || 'Anonymous'}</span>
                          <span>·</span>
                          <PlatformIcon platform={sig.platform} size={12} showLabel />
                          <span className="capitalize">{sig.signal_type.replace(/_/g, ' ')}</span>
                          <span>·</span>
                          <span>Score: {(Number(sig.engagement_score) * 100).toFixed(0)}%</span>
                          <span>·</span>
                          <span>{sig.detected_at ? new Date(sig.detected_at).toLocaleDateString() : '—'}</span>
                        </div>
                        <p className="text-sm text-gray-800 line-clamp-3">{sig.content || '—'}</p>
                        {sig.conversation_url && (
                          <a
                            href={sig.conversation_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View thread
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          className="p-2 rounded border border-gray-300 text-gray-600 hover:bg-white hover:text-indigo-600"
                          title="Reply"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="p-2 rounded border border-gray-300 text-gray-600 hover:bg-white hover:text-amber-600"
                          title="Bookmark"
                        >
                          <Bookmark className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="p-2 rounded border border-gray-300 text-gray-600 hover:bg-white hover:text-emerald-600"
                          title="Mark as lead"
                        >
                          <UserPlus className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="p-2 rounded border border-gray-300 text-gray-600 hover:bg-white hover:text-blue-600"
                          title="Export to CRM"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
        <>
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Writer Context</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-500">Topic</div>
              <div className="text-gray-900">{payload.topic || payload.title || '—'}</div>
            </div>
            <div>
              <div className="text-gray-500">Objective</div>
              <div className="text-gray-900">{String(intent?.objective || writerBrief?.topicGoal || '—')}</div>
            </div>
            <div>
              <div className="text-gray-500">What reader should learn</div>
              <div className="text-gray-900">{effectiveWhatReaderLearns}</div>
            </div>
            <div>
              <div className="text-gray-500">Problem addressed</div>
              <div className="text-gray-900">{effectiveProblemAddressed}</div>
            </div>
            <div>
              <div className="text-gray-500">Desired action</div>
              <div className="text-gray-900">{String(writerBrief?.desiredAction || intent?.cta_type || '—')}</div>
            </div>
            <div>
              <div className="text-gray-500">Narrative style</div>
              <div className="text-gray-900">{String(writerBrief?.narrativeStyle || '—')}</div>
            </div>
            <div className="md:col-span-2">
              <div className="text-gray-500">Suggested social media platforms</div>
              <div className="text-gray-900">
                {suggestedPlatforms.length > 0
                  ? suggestedPlatforms.map((p) => labelize(p)).join(', ')
                  : '—'}
              </div>
            </div>
          </div>
          {payload.description && (
            <div>
              <div className="text-gray-500 text-sm">Current activity brief</div>
              <div className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{payload.description}</div>
            </div>
          )}
        </div>

        {isCreatorActivity && (
          <CreatorContentPanel
            theme={topicText || String(payload?.title ?? '')}
            productionBrief={String(writerBrief?.writingIntent ?? payload?.description ?? '')}
            talkingPoints={
              Array.isArray((writerBrief as any)?.key_points) ? (writerBrief as any).key_points
                : Array.isArray((writerBrief as any)?.keyPoints) ? (writerBrief as any).keyPoints
                : []
            }
            contentType={contentType}
            platforms={suggestedPlatforms}
            creatorInstructions={dailyRaw?.creator_instruction as Record<string, unknown> | undefined}
            creatorAsset={creatorAsset as { type: 'video' | 'image' | 'carousel'; url?: string; files?: string[]; platformUploads?: Record<string, { url?: string; externalLink?: string; caption?: string; slides?: string[] }>; description?: string; transcript?: string; theme?: string } | undefined}
            onAssetSaved={(asset) => {
              setPayload((prev) => {
                if (!prev) return prev;
                const current = asObject(prev.dailyExecutionItem) || {};
                return {
                  ...prev,
                  dailyExecutionItem: {
                    ...current,
                    creator_asset: asset,
                    content_status: 'READY_FOR_PROMOTION',
                  },
                };
              });
            }}
            onGeneratePromotion={async () => {
              const current = asObject(payload?.dailyExecutionItem) || {};
              const itemWithCreator = {
                ...current,
                creator_asset: creatorAsset,
                master_content: undefined,
              };
              try {
                setIsGeneratingVariants(true);
                const res = await apiFetch('/api/activity-workspace/content', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'generate_variants',
                    activity: buildActivityRequestPayload(),
                    schedules,
                    dailyExecutionItem: itemWithCreator,
                    companyId: selectedCompanyId || payload?.companyId || null,
                    campaignId: payload?.campaignId || queryCampaignId || null,
                  }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.error ?? data?.message ?? 'Failed to generate promotion content');
                const incoming = Array.isArray(data.platform_variants) ? data.platform_variants : [];
                const mergedByKey = new Map<string, Record<string, unknown>>();
                for (const v of platformVariants) {
                  const key = `${normalizeKey(v.platform)}::${normalizeKey(v.content_type)}`;
                  mergedByKey.set(key, v);
                }
                for (const v of incoming) {
                  const key = `${normalizeKey((v as any)?.platform)}::${normalizeKey((v as any)?.content_type)}`;
                  if (key !== '::') mergedByKey.set(key, v as Record<string, unknown>);
                }
                setPayload((prev) => {
                  if (!prev) return prev;
                  const cur = asObject(prev.dailyExecutionItem) || {};
                  return {
                    ...prev,
                    dailyExecutionItem: { ...cur, platform_variants: Array.from(mergedByKey.values()) },
                  };
                });
                notify('success', 'Promotion content generated.');
              } catch (err) {
                notify('error', String((err as Error)?.message ?? 'Failed'));
              } finally {
                setIsGeneratingVariants(false);
              }
            }}
            isGeneratingPromotion={isGeneratingVariants}
            campaignId={String(payload?.campaignId ?? '')}
            executionId={String(payload?.activityId ?? (dailyRaw?.execution_id ?? ''))}
            weekNumber={Number(payload?.weekNumber) || 1}
            day={String(payload?.day ?? 'Monday')}
            onNotice={notify}
          />
        )}

        {VIEW_RULES[viewMode].showCreatorBrief && dailyRaw?.creator_instruction && typeof dailyRaw.creator_instruction === 'object' && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Creator Brief</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {(dailyRaw.creator_instruction as Record<string, unknown>).objective != null && (
                <div>
                  <div className="text-gray-500">Objective</div>
                  <div className="text-gray-900">{String((dailyRaw.creator_instruction as Record<string, unknown>).objective ?? '—')}</div>
                </div>
              )}
              {(dailyRaw.creator_instruction as Record<string, unknown>).targetAudience != null && (
                <div>
                  <div className="text-gray-500">Audience</div>
                  <div className="text-gray-900">{String((dailyRaw.creator_instruction as Record<string, unknown>).targetAudience ?? '—')}</div>
                </div>
              )}
              {(dailyRaw.creator_instruction as Record<string, unknown>).keyMessage != null && (
                <div className="md:col-span-2">
                  <div className="text-gray-500">Key message</div>
                  <div className="text-gray-900">{String((dailyRaw.creator_instruction as Record<string, unknown>).keyMessage ?? '—')}</div>
                </div>
              )}
              {(dailyRaw.creator_instruction as Record<string, unknown>).expectedOutcome != null && (
                <div className="md:col-span-2">
                  <div className="text-gray-500">Expected outcome</div>
                  <div className="text-gray-900">{String((dailyRaw.creator_instruction as Record<string, unknown>).expectedOutcome ?? '—')}</div>
                </div>
              )}
              {(dailyRaw.creator_instruction as Record<string, unknown>).formatHint != null && (
                <div className="md:col-span-2">
                  <div className="text-gray-500">Format hint</div>
                  <div className="text-gray-900">{String((dailyRaw.creator_instruction as Record<string, unknown>).formatHint ?? '—')}</div>
                </div>
              )}
              {Array.isArray((dailyRaw.creator_instruction as Record<string, unknown>).executionChecklist) &&
                ((dailyRaw.creator_instruction as Record<string, unknown>).executionChecklist as string[]).length > 0 && (
                  <div className="md:col-span-2 space-y-1">
                    <div className="text-gray-500">Execution Checklist</div>
                    <ul className="text-gray-600 text-sm list-disc list-inside space-y-0.5">
                      {((dailyRaw.creator_instruction as Record<string, unknown>).executionChecklist as string[]).map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
          </div>
        )}

        {VIEW_RULES[viewMode].showSystemFields && dailyRaw && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setSystemBlockExpanded((v) => !v)}
              className="w-full px-5 py-3 flex items-center justify-between text-left text-sm font-medium text-gray-700 hover:bg-gray-50 border-b border-gray-100"
            >
              <span>System Execution Intelligence</span>
              {systemBlockExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {systemBlockExpanded && (
              <div className="p-5 space-y-2 text-xs text-gray-600 grid grid-cols-1 md:grid-cols-2 gap-2">
                {dailyRaw.execution_mode != null && <div><span className="font-medium text-gray-500">execution_mode:</span> {String(dailyRaw.execution_mode)}</div>}
                {dailyRaw.ai_generated != null && <div><span className="font-medium text-gray-500">ai_generated:</span> {String(dailyRaw.ai_generated)}</div>}
                {dailyRaw.master_content_id != null && <div className="md:col-span-2"><span className="font-medium text-gray-500">master_content_id:</span> {String(dailyRaw.master_content_id)}</div>}
                {dailyRaw.narrativeStyle != null && <div className="md:col-span-2"><span className="font-medium text-gray-500">narrativeStyle:</span> {String(dailyRaw.narrativeStyle)}</div>}
                {(dailyRaw.contentGuidance && typeof dailyRaw.contentGuidance === 'object') && <div className="md:col-span-2"><span className="font-medium text-gray-500">contentGuidance:</span> {JSON.stringify(dailyRaw.contentGuidance)}</div>}
                {dailyRaw.weeklyContextCapsule != null && typeof dailyRaw.weeklyContextCapsule === 'object' && <div className="md:col-span-2"><span className="font-medium text-gray-500">weeklyContextCapsule:</span> {JSON.stringify(dailyRaw.weeklyContextCapsule)}</div>}
              </div>
            )}
          </div>
        )}

        {/* Master Content panel — visible only to Content Architect */}
        {viewMode === 'CONTENT_ARCHITECT' && (
          <div className="bg-white border border-indigo-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setMasterContentExpanded((v) => !v)}
              className="w-full px-5 py-3 flex items-center justify-between text-left text-sm font-semibold text-indigo-800 hover:bg-indigo-50 border-b border-indigo-100"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                Master Content
                {hasMasterGenerated && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    <CheckCircle2 className="h-3 w-3" /> Ready
                  </span>
                )}
              </span>
              {masterContentExpanded ? <ChevronUp className="h-4 w-4 text-indigo-400" /> : <ChevronDown className="h-4 w-4 text-indigo-400" />}
            </button>
            {masterContentExpanded && (
              <div className="p-5 space-y-4">
                {masterContent ? (
                  <>
                    {String(masterContent?.title || masterContent?.master_title || '').trim() && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Title</p>
                        <p className="text-sm font-semibold text-gray-900">{String(masterContent.title || masterContent.master_title)}</p>
                      </div>
                    )}
                    {String(masterContent?.content || '').trim() && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Content</p>
                        <ContentRenderer
                          content={String(masterContent.content)}
                          platform="linkedin"
                          contentType="article"
                          renderMode="rich"
                        />
                      </div>
                    )}
                    {String(masterContent?.generation_status || '').trim() && (
                      <p className="text-xs text-gray-400">Status: {String(masterContent.generation_status)}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-500">Master content not yet generated. Click Repurpose on any platform to auto-generate it.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Platform Content — one card per platform, master content generated in background */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Platform Content</h2>
              <p className="text-sm text-gray-500 mt-0.5">Click Repurpose to generate rich content for each platform.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {schedules.length > 1 && (
                <button
                  type="button"
                  onClick={handleRepurposeAll}
                  disabled={isGeneratingMaster || schedules.some((s) => !!repurposingByScheduleId[s.id])}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isGeneratingMaster || schedules.some((s) => !!repurposingByScheduleId[s.id]) ? 'Generating…' : 'Repurpose All'}
                </button>
              )}
              {!showAddVariantForm ? (
                <button
                  type="button"
                  onClick={() => { setShowAddVariantForm(true); setAddVariantContentType(allContentTypesForAdd[0] || ''); setAddVariantPlatform(''); }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Platform
                </button>
              ) : (
                <div className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2">
                  <span className="text-xs text-gray-600">Content type:</span>
                  <select
                    value={addVariantContentType}
                    onChange={(e) => { setAddVariantContentType(e.target.value); setAddVariantPlatform(''); }}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                  >
                    {allContentTypesForAdd.map((ct) => (
                      <option key={ct} value={ct}>{labelize(ct)}</option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-600">Platform:</span>
                  <select
                    value={addVariantPlatform}
                    onChange={(e) => setAddVariantPlatform(e.target.value)}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                  >
                    <option value="">Select platform</option>
                    {getAddablePlatformsForContentType(addVariantContentType).map((p) => (
                      <option key={p} value={p}>{labelize(p)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (!addVariantPlatform) return;
                      const first = schedules[0];
                      const row: ScheduleItem = {
                        id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        platform: addVariantPlatform,
                        contentType: addVariantContentType,
                        date: first?.date || '',
                        time: first?.time || '09:00',
                        status: 'planned',
                        title: payload?.title,
                        description: payload?.description,
                      };
                      setSchedules((prev) => [...prev, row]);
                      setShowAddVariantForm(false);
                      setAddVariantContentType('');
                      setAddVariantPlatform('');
                    }}
                    disabled={!addVariantPlatform}
                    className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAddVariantForm(false); setAddVariantContentType(''); setAddVariantPlatform(''); }}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>

          {isHydratingContext && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              Syncing context for this activity…
            </div>
          )}

          {schedules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center">
              <p className="text-sm text-gray-500">No platforms yet. Click <strong className="text-gray-700">Add Platform</strong> to get started.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {schedules.map((item, idx) => {
                const matchedVariant = findVariantForSchedule(item);
                const hasContent = !!String((matchedVariant as any)?.generated_content || '').trim();
                const repurposeLabel = idx === 0 ? 'Repurpose' : `Repurpose ${idx + 1}`;
                const isRepurposing = !!repurposingByScheduleId[item.id];
                const isBusy = isRepurposing || isGeneratingMaster;
                const intelligence = matchedVariant
                  ? computeVariantIntelligence(matchedVariant as Record<string, unknown>, item.platform, strategicMemoryProfile)
                  : null;
                return (
                  <div key={item.id} className="rounded-xl border border-gray-200 overflow-hidden">
                    {/* Card header */}
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-50/80 border-b border-gray-100">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <PlatformIcon platform={item.platform} size={18} showLabel />
                        <span className="text-xs text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded">
                          {labelize(item.contentType)}
                        </span>
                        {item.weekNumber != null && !item.isPrimary && (
                          <span className="inline-flex items-center text-xs text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded font-medium">
                            Week {item.weekNumber}
                          </span>
                        )}
                        {(item.scheduledFor || item.date) && (
                          <span className="text-xs text-gray-400">
                            {item.scheduledFor
                              ? new Date(item.scheduledFor).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                              : item.date + (item.time ? ` ${item.time}` : '')}
                          </span>
                        )}
                        {item.status === 'scheduled' && (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                            <CheckCircle2 className="h-3 w-3" /> Scheduled
                          </span>
                        )}
                        {finalizedByScheduleId[item.id] && item.status !== 'scheduled' && (
                          <span className="text-xs text-amber-600 font-medium">Finalized</span>
                        )}
                        {hasContent && item.status !== 'scheduled' && !finalizedByScheduleId[item.id] && (
                          <span className="text-xs text-indigo-500 font-medium">Generated</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleRepurposeForPlatform(item)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          {isBusy ? (isGeneratingMaster && !isRepurposing ? 'Creating master…' : 'Repurposing…') : repurposeLabel}
                        </button>
                        {!isDailyTopicView && (
                          <button
                            type="button"
                            onClick={() => removeScheduleRow(item.id)}
                            className="p-1.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600"
                            title="Remove platform"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Card body */}
                    {hasContent ? (
                      <div className="divide-y divide-gray-100">

                        {/* Rich content preview */}
                        <div className="p-4 space-y-3">
                          {platformRulesByPlatform[normalizeKey(item.platform)]?.guidelines?.length > 0 && (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-800">
                              <span className="font-semibold">Platform rules applied: </span>
                              {platformRulesByPlatform[normalizeKey(item.platform)].guidelines.join(' · ')}
                            </div>
                          )}
                          <ContentRenderer
                            content={stripBakedHashtags(String((matchedVariant as any)?.generated_content || ''))}
                            platform={item.platform}
                            contentType={item.contentType}
                            renderMode="social"
                          />
                          {Array.isArray((matchedVariant as any)?.discoverability_meta?.hashtags) &&
                            ((matchedVariant as any).discoverability_meta.hashtags as string[]).length > 0 && (
                            <p className="text-sm text-blue-500">
                              {((matchedVariant as any).discoverability_meta.hashtags as string[]).join(' ')}
                            </p>
                          )}
                        </div>

                        {/* AI Suggestions */}
                        {intelligence && intelligence.strategist_suggestions.length > 0 && (
                          <div className="px-4 py-3 bg-slate-50/60 space-y-2">
                            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                              <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                              AI Suggestions
                              <span className="font-normal text-slate-400">· Confidence: {intelligence.confidence_score}%</span>
                            </div>
                            {intelligence.strategist_suggestions.map((s) => {
                              const suggestionKey = `${item.id}-${s.id}`;
                              const isImproving = improvingSuggestionKey === suggestionKey;
                              const showImproved = improvedByScheduleId[item.id];
                              return (
                                <div key={s.id} className="flex items-start justify-between gap-3">
                                  <div className="text-xs text-slate-600">
                                    <span className="font-medium text-slate-800">→ {s.label}:</span> {s.description}
                                  </div>
                                  <button
                                    type="button"
                                    disabled={isImproving || showImproved}
                                    onClick={async () => {
                                      setImprovingSuggestionKey(suggestionKey);
                                      try {
                                        const allActions = intelligence.strategist_suggestions.map((sg) => sg.action);
                                        const { improved_variant } = await executeVariantImprovementAll({
                                          campaignId: payload?.campaignId ?? undefined,
                                          executionId: String(payload?.activityId ?? (payload?.dailyExecutionItem as any)?.execution_id ?? ''),
                                          platform: item.platform,
                                          improvementTypes: allActions,
                                          variant: matchedVariant as Record<string, unknown>,
                                          dailyExecutionItem: payload?.dailyExecutionItem ?? undefined,
                                          companyId: selectedCompanyId || payload?.companyId || null,
                                        });
                                        const nextVariants = [...platformVariants];
                                        const vi = nextVariants.findIndex(
                                          (v) => normalizeKey((v as any)?.platform) === normalizeKey(item.platform) && normalizeKey((v as any)?.content_type) === normalizeKey(item.contentType)
                                        );
                                        if (vi >= 0) nextVariants[vi] = improved_variant as any;
                                        else nextVariants.push({ ...improved_variant, platform: item.platform, content_type: item.contentType });
                                        setPayload((prev) => prev ? { ...prev, dailyExecutionItem: { ...(prev.dailyExecutionItem || {}), platform_variants: nextVariants } } : prev);
                                        setImprovedByScheduleId((prev) => ({ ...prev, [item.id]: true }));
                                        const cid = payload?.campaignId ?? '';
                                        if (cid) {
                                          fetch('/api/intelligence/strategic-memory', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            credentials: 'include',
                                            body: JSON.stringify({
                                              campaign_id: cid,
                                              execution_id: payload?.activityId ?? (payload?.dailyExecutionItem as any)?.execution_id,
                                              platform: item.platform,
                                              action: s.action,
                                              accepted: true,
                                            }),
                                          })
                                            .then((r) => r.ok && fetch(`/api/intelligence/strategic-memory?campaignId=${encodeURIComponent(cid)}`, { credentials: 'include' }))
                                            .then((r) => (r && r.ok ? r.json() : null))
                                            .then((profile) => profile && setStrategicMemoryProfile(profile))
                                            .catch(() => {});
                                        }
                                        notify('success', 'Variant improved.');
                                      } catch (err) {
                                        notify('error', String((err as Error)?.message || 'Improvement failed'));
                                      } finally {
                                        setImprovingSuggestionKey(null);
                                      }
                                    }}
                                    className={`shrink-0 rounded border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 whitespace-nowrap ${showImproved ? 'border-emerald-300 bg-emerald-50 text-emerald-700 cursor-default' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}
                                  >
                                    {isImproving ? 'Improving…' : showImproved ? '✔ Applied' : 'Apply'}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Edit content */}
                        <div className="px-4 py-3 space-y-2">
                          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Edit Content</div>
                          <RichTextEditor
                            value={stripBakedHashtags(String((matchedVariant as any)?.generated_content || ''))}
                            finalized={!!finalizedByScheduleId[item.id]}
                            minHeight="120px"
                            onChange={(html) => {
                              if (finalizedByScheduleId[item.id]) {
                                setFinalizedByScheduleId((prev) => ({ ...prev, [item.id]: false }));
                                updateSchedule(item.id, { status: 'in-progress' });
                              }
                              const next = [...platformVariants];
                              const existingIndex = next.findIndex(
                                (variant) =>
                                  normalizeKey((variant as any)?.platform) === normalizeKey(item.platform) &&
                                  normalizeKey((variant as any)?.content_type) === normalizeKey(item.contentType)
                              );
                              const nextVariant = {
                                ...(matchedVariant as any),
                                platform: item.platform,
                                content_type: item.contentType,
                                // Store both HTML (for rich editor round-trip) and plain text (for posting)
                                generated_content: html,
                                generated_content_html: html,
                                refinement_finalized: false,
                                refinement_status: 'edited',
                              };
                              if (existingIndex >= 0) next[existingIndex] = nextVariant;
                              else next.push(nextVariant);
                              setPayload((prev) => (prev ? { ...prev, dailyExecutionItem: { ...(prev.dailyExecutionItem || {}), platform_variants: next } } : prev));
                            }}
                          />
                          {(matchedVariant as any)?.refinement_status === 'edited' && !finalizedByScheduleId[item.id] && (
                            <p className="text-[11px] text-amber-600">Content edited — finalize before scheduling.</p>
                          )}
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setShowRefineByScheduleId((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                              className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              {showRefineByScheduleId[item.id] ? 'Hide AI Refine' : 'Refine with AI'}
                            </button>
                          </div>
                          {showRefineByScheduleId[item.id] && (
                            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-2 mt-1">
                              {(refineMessagesByScheduleId[item.id] || []).length > 0 && (
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {(refineMessagesByScheduleId[item.id] || []).map((msg, msgIdx) => (
                                    <div
                                      key={`${item.id}-msg-${msgIdx}`}
                                      className={`rounded px-2 py-1 text-[11px] ${msg.role === 'user' ? 'bg-white border border-violet-200 text-violet-900' : 'bg-indigo-100 border border-indigo-200 text-indigo-900'}`}
                                    >
                                      <span className="font-semibold mr-1">{msg.role === 'user' ? 'You:' : 'AI:'}</span>
                                      {msg.content}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={refineInputByScheduleId[item.id] || ''}
                                  onChange={(e) => setRefineInputByScheduleId((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                  onKeyDown={(e) => e.key === 'Enter' && handleRefineWithAi(item)}
                                  placeholder="e.g., Make it sharper for executives…"
                                  className="flex-1 rounded-lg border border-violet-300 bg-white px-2 py-1 text-xs focus:outline-none focus:border-violet-400"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRefineWithAi(item)}
                                  disabled={!!isRefiningByScheduleId[item.id]}
                                  className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                                >
                                  {isRefiningByScheduleId[item.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                  Refine
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Image attachment */}
                        <div className="px-4 py-3 space-y-2">
                          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Image</div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => { setImageByScheduleId((prev) => ({ ...prev, [item.id]: null })); setShowImagePickerByScheduleId((prev) => ({ ...prev, [item.id]: false })); }}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${!imageByScheduleId[item.id] ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                            >
                              Text only
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowImagePickerByScheduleId((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${imageByScheduleId[item.id] ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                            >
                              {imageByScheduleId[item.id] ? '✓ Image attached' : '+ Add image'}
                            </button>
                          </div>
                          {showImagePickerByScheduleId[item.id] && (
                            <ImagePicker
                              topic={String(payload?.title ?? payload?.topic ?? item.platform)}
                              description={String(payload?.description ?? '')}
                              selectedUrl={imageByScheduleId[item.id]?.url}
                              onSelect={(img) => {
                                setImageByScheduleId((prev) => ({ ...prev, [item.id]: img }));
                                if (img) setShowImagePickerByScheduleId((prev) => ({ ...prev, [item.id]: false }));
                              }}
                            />
                          )}
                        </div>

                        {/* Scheduling */}
                        <div className="px-4 py-3 bg-gray-50/60 flex flex-wrap items-end gap-3">
                          <label className="text-xs text-gray-600 flex-1 min-w-[120px]">
                            Publish date
                            <input
                              type="date"
                              value={item.date || ''}
                              min={new Date().toISOString().split('T')[0]}
                              onChange={(e) => updateSchedule(item.id, { date: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-indigo-400"
                            />
                          </label>
                          <label className="text-xs text-gray-600 min-w-[90px]">
                            Time
                            <input
                              type="time"
                              value={item.time || '09:00'}
                              onChange={(e) => updateSchedule(item.id, { time: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-indigo-400"
                            />
                          </label>
                          <div className="flex items-center gap-2 mb-0.5">
                            {item.status === 'scheduled' ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 border border-emerald-300 px-2.5 py-1.5 text-xs font-medium text-emerald-700 cursor-default">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Scheduled
                              </span>
                            ) : finalizedByScheduleId[item.id] ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => scheduleFinalizedContent(item)}
                                  disabled={!!schedulingByScheduleId[item.id]}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {schedulingByScheduleId[item.id] ? 'Scheduling…' : 'Schedule'}
                                </button>
                                {!connectedPlatforms.has(normalizeKey(item.platform)) && connectedPlatforms.size > 0 && (
                                  <a
                                    href="/social-platforms"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-300 px-2 py-1.5 text-xs text-amber-700 hover:bg-amber-100"
                                  >
                                    <AlertCircle className="h-3 w-3" /> Connect {item.platform}
                                  </a>
                                )}
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => finalizeRepurposeForSchedule(item)}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" /> Finalize
                              </button>
                            )}
                          </div>
                        </div>

                      </div>
                    ) : (
                      <div className="px-4 py-10 text-center">
                        <p className="text-sm text-gray-400">
                          Click <strong className="text-indigo-600">{repurposeLabel}</strong> to generate {labelize(item.platform)} content.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {/* stub references to keep unused state vars from causing TS errors */}
        {false && <span className="hidden">{variantStatusDot['pending']}{variantStatusLabel['pending']}{String(selectedScheduleId)}{JSON.stringify(confidenceByPlatform)}</span>}
        </>
        )}
      </div>
    </div>
  );
}

/** Force server-side rendering so the page is not served from a static .html file (avoids ENOENT when the file is missing). */
export async function getServerSideProps() {
  return { props: {} };
}

