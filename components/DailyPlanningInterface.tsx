import React, { useState, useEffect } from 'react';
import { 
  Calendar, 
  Clock, 
  Users, 
  Target, 
  Plus, 
  Edit3, 
  Trash2, 
  Save, 
  Sparkles,
  CheckCircle,
  AlertCircle,
  Brain,
  Eye,
  Lock,
  Unlock,
  Loader2,
  Mic,
  FileText,
  Video,
  Image,
  X,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import ContentCreationPanel from './ContentCreationPanel';
import VoiceNotesComponent from './VoiceNotesComponent';
import PlatformIcon from './ui/PlatformIcon';
import AIGenerationProgress from './AIGenerationProgress';
import { parseDailyExecutionMetadata } from '../lib/dailyExecutionMetadata';

interface DailyActivity {
  id: string;
  executionId: string;
  sourceType: 'planned' | 'manual';
  day: string;
  date: string;
  time: string;
  platform: string;
  contentType: string;
  title: string;
  description: string;
  status: 'planned' | 'in-progress' | 'completed' | 'committed' | 'scheduled';
  aiSuggested: boolean;
  aiEdited: boolean;
  topic?: string;
  objective?: string;
  platforms?: string[];
  summary?: string;
  cta?: string;
  content?: any;
  voiceNotes?: any[];
  dailyExecutionItem?: DailyExecutionItem;
}

interface DailyExecutionItem {
  execution_id: string;
  source_type: 'planned' | 'manual';
  campaign_id?: string;
  week_number?: number;
  platform: string;
  content_type: string;
  topic?: string;
  title?: string;
  content?: string;
  intent?: Record<string, unknown>;
  writer_content_brief?: Record<string, unknown>;
  narrative_role?: string;
  progression_step?: number;
  global_progression_index?: number;
  status: 'draft' | 'scheduled';
  scheduled_time?: string;
  retention_state?: 'temporary' | 'saved' | 'archived';
  expires_at?: string | null;
  archived_at?: string | null;
  content_visibility?: boolean;
  retention_reminders?: Array<{
    days_before: 30 | 15 | 7 | 1;
    remind_at: string;
    sent: boolean;
  }>;
  created_at?: string | null;
  master_content?: {
    id: string;
    generated_at: string;
    content: string;
    generation_status: 'pending' | 'generated' | 'failed';
    generation_source: 'ai';
    content_type_mode?: 'text' | 'media_blueprint';
    required_media?: boolean;
    media_status?: 'missing' | 'ready';
    decision_trace?: {
      source_topic: string;
      objective: string;
      pain_point: string;
      outcome_promise: string;
      writing_angle: string;
      tone_used: string;
      narrative_role: string;
      progression_step: number | null;
    };
  };
  platform_variants?: Array<{
    platform: string;
    content_type: string;
    generated_content: string;
    generation_status: 'pending' | 'generated' | 'failed';
    locked_variant: boolean;
    adapted_from_master?: boolean;
    adaptation_style?: 'platform_specific';
    requires_media?: boolean;
    generation_overrides?: Record<string, unknown>;
    adaptation_trace?: {
      platform: string;
      style_strategy: string;
      character_limit_used: number | null;
      format_family: string;
      media_constraints_applied: boolean;
      adaptation_reason: string;
    };
    discoverability_meta?: {
      optimized: boolean;
      strategy_source: 'ai' | 'deterministic';
      platform: string;
      content_type: string;
      hashtag_target: { min: number; max: number; recommended: number };
      keyword_clusters: {
        primary: string[];
        secondary: string[];
        intent_outcome: string[];
      };
      hashtags: string[];
      youtube_tags?: string[];
      generated_at: string;
    };
    algorithmic_formatting_meta?: {
      platform: string;
      formatting_applied: true;
    };
    media_search_intent?: {
      media_requirements: Array<{
        role: string;
        media_type: 'image' | 'video' | 'thumbnail' | 'illustration';
        required: boolean;
        orientation: 'portrait' | 'landscape' | 'square';
        primary_query: string;
        alternative_queries: string[];
        style_tags: string[];
        platform_reason: string;
      }>;
    };
  }>;
  media_assets?: Array<{
    id?: string;
    type: string;
    source_url: string;
    status: 'attached';
  }>;
  media_status?: 'missing' | 'ready';
  execution_readiness?: {
    text_ready: boolean;
    media_ready: boolean;
    platform_ready: boolean;
    discoverability_ready: boolean;
    algorithm_ready: boolean;
    ready_to_schedule: boolean;
    blocking_reasons: string[];
  };
  execution_jobs?: Array<{
    job_id: string;
    platform: string;
    content_type: string;
    variant_ref: string;
    ready_to_schedule: boolean;
    status: 'ready' | 'blocked';
    blocking_reasons: string[];
  }>;
}

interface DailyPlanningInterfaceProps {
  week: any;
  onSave: (weekData: any) => void;
  campaignId: string | null;
  campaignData: any;
  initialDay?: string | null;
}

const warnDailyNormalizationIssue = (item: Partial<DailyExecutionItem>, context: string) => {
  if (!String(item.execution_id || '').trim()) {
    console.warn('[daily-normalization][missing-execution-id]', { context });
  }
  if (!String(item.source_type || '').trim()) {
    console.warn('[daily-normalization][missing-source-type]', { context, execution_id: item.execution_id || null });
  }
  if (!String(item.platform || '').trim()) {
    console.warn('[daily-normalization][missing-platform]', { context, execution_id: item.execution_id || null });
  }
  if (!String(item.content_type || '').trim()) {
    console.warn('[daily-normalization][missing-content-type]', { context, execution_id: item.execution_id || null });
  }
};

const RETENTION_DEFAULT_MONTHS = 12;

const computeDefaultExpiryDateLocal = (createdAt?: string | null) => {
  const base = createdAt ? new Date(createdAt) : new Date();
  const seed = Number.isFinite(base.getTime()) ? base : new Date();
  const expiry = new Date(seed);
  expiry.setMonth(expiry.getMonth() + RETENTION_DEFAULT_MONTHS);
  return expiry.toISOString();
};

const buildRetentionReminderScheduleLocal = (expiresAt?: string | null) => {
  const expires = expiresAt ? new Date(expiresAt) : null;
  if (!expires || !Number.isFinite(expires.getTime())) return [];
  return [30, 15, 7, 1].map((daysBefore) => {
    const remindAt = new Date(expires);
    remindAt.setDate(remindAt.getDate() - daysBefore);
    return {
      days_before: daysBefore as 30 | 15 | 7 | 1,
      remind_at: remindAt.toISOString(),
      sent: false,
    };
  });
};

const applyDefaultRetentionLocal = (item: DailyExecutionItem): DailyExecutionItem => {
  const state = item.retention_state || 'temporary';
  const createdAt = item.created_at || new Date().toISOString();
  if (state === 'saved') {
    if (item.expires_at) {
      console.warn('[content-retention][saved-has-expires-at]', { context: 'DailyPlanningInterface', execution_id: item.execution_id });
    }
    return {
      ...item,
      retention_state: 'saved',
      expires_at: null,
      archived_at: item.archived_at ?? null,
      content_visibility: typeof item.content_visibility === 'boolean' ? item.content_visibility : true,
      retention_reminders: Array.isArray(item.retention_reminders) ? item.retention_reminders : [],
      created_at: createdAt,
    };
  }
  if (state === 'archived') {
    if (!item.archived_at) {
      console.warn('[content-retention][archived-missing-archived-at]', { context: 'DailyPlanningInterface', execution_id: item.execution_id });
    }
    return {
      ...item,
      retention_state: 'archived',
      archived_at: item.archived_at || new Date().toISOString(),
      content_visibility: false,
      expires_at: item.expires_at ?? null,
      retention_reminders: Array.isArray(item.retention_reminders)
        ? item.retention_reminders
        : (item.expires_at ? buildRetentionReminderScheduleLocal(item.expires_at) : []),
      created_at: createdAt,
    };
  }
  const expiresAt = item.expires_at || computeDefaultExpiryDateLocal(createdAt);
  if (!expiresAt) {
    console.warn('[content-retention][temporary-missing-expires-at]', { context: 'DailyPlanningInterface', execution_id: item.execution_id });
  }
  return {
    ...item,
    retention_state: 'temporary',
    expires_at: expiresAt,
    archived_at: item.archived_at ?? null,
    content_visibility: typeof item.content_visibility === 'boolean' ? item.content_visibility : true,
    retention_reminders: Array.isArray(item.retention_reminders)
      ? item.retention_reminders
      : buildRetentionReminderScheduleLocal(expiresAt),
    created_at: createdAt,
  };
};

const getRetentionBadge = (item?: DailyExecutionItem): string | null => {
  if (!item) return null;
  if (item.retention_state === 'saved') return '🗂 Saved';
  if (item.retention_state === 'archived') return '📦 Archived';
  const expiresRaw = String(item.expires_at || '').trim();
  if (!expiresRaw) return null;
  const expiresAt = new Date(expiresRaw);
  if (!Number.isFinite(expiresAt.getTime())) return null;
  const msRemaining = expiresAt.getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
  return `⏳ Expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
};

const hasMasterGenerated = (item?: DailyExecutionItem): boolean => {
  return Boolean(item?.master_content && item.master_content.generation_status === 'generated');
};

const hasAiGeneratedMasterContent = (item?: DailyExecutionItem): boolean => {
  const content = String(item?.master_content?.content || '').trim();
  if (!item?.master_content || item.master_content.generation_status !== 'generated') return false;
  if (!content) return false;
  if (content.includes('[MASTER CONTENT PLACEHOLDER]')) return false;
  if (content.includes('[MEDIA BLUEPRINT]')) return false;
  if (content.includes('[MASTER GENERATION FAILED')) return false;
  return true;
};

const hasVariantsReady = (item?: DailyExecutionItem): boolean => {
  const variants = Array.isArray(item?.platform_variants) ? item?.platform_variants : [];
  if (variants.length === 0) return false;
  return variants.every((variant) => variant.generation_status === 'generated');
};

const hasAiAdaptedVariant = (item?: DailyExecutionItem): boolean => {
  const variants = Array.isArray(item?.platform_variants) ? item?.platform_variants : [];
  return variants.some((variant) => variant.adapted_from_master === true);
};

const hasDiscoverabilityOptimization = (item?: DailyExecutionItem): boolean => {
  const variants = Array.isArray(item?.platform_variants) ? item?.platform_variants : [];
  return variants.some((variant) => Boolean(variant?.discoverability_meta?.optimized));
};

const hasAlgorithmicFormattingOptimization = (item?: DailyExecutionItem): boolean => {
  const variants = Array.isArray(item?.platform_variants) ? item?.platform_variants : [];
  return variants.some((variant) => Boolean(variant?.algorithmic_formatting_meta?.formatting_applied));
};

const hasMediaSearchSuggestions = (item?: DailyExecutionItem): boolean => {
  const variants = Array.isArray(item?.platform_variants) ? item?.platform_variants : [];
  return variants.some((variant) => (variant?.media_search_intent?.media_requirements?.length || 0) > 0);
};

const getMediaStatusBadge = (item?: DailyExecutionItem): string | null => {
  if (!item) return null;
  if (item.media_status === 'ready') return '🎞 Media Ready';
  if (item.media_status === 'missing') return '🎥 Media Required';
  return null;
};

const getExecutionReadinessBadge = (
  item?: DailyExecutionItem
): { label: string; className: string } | null => {
  const readiness = item?.execution_readiness;
  if (!readiness) return null;
  if (readiness.ready_to_schedule) {
    return {
      label: '🟢 Ready to Schedule',
      className: 'bg-emerald-100 text-emerald-700',
    };
  }
  if (!readiness.media_ready || readiness.blocking_reasons.includes('missing_required_media')) {
    return {
      label: '🟡 Missing Media',
      className: 'bg-amber-100 text-amber-700',
    };
  }
  return {
    label: '🔴 Incomplete',
    className: 'bg-rose-100 text-rose-700',
  };
};

const getExecutionJobPills = (item?: DailyExecutionItem): string[] => {
  const jobs = Array.isArray(item?.execution_jobs) ? item!.execution_jobs! : [];
  if (jobs.length === 0) return [];
  const normalizePlatformLabel = (platform: string): string => {
    const p = String(platform || '').trim().toLowerCase();
    if (p === 'x' || p === 'twitter') return 'X';
    if (!p) return 'Unknown';
    return p.charAt(0).toUpperCase() + p.slice(1);
  };
  return jobs.map((job) => `[${normalizePlatformLabel(job.platform)} ${job.ready_to_schedule ? '🟢' : '🔴'}]`);
};

const hasSchedulableExecutionJob = (item?: DailyExecutionItem): boolean => {
  const jobs = Array.isArray(item?.execution_jobs) ? item!.execution_jobs! : [];
  return jobs.some((job) => job.status === 'ready');
};

const countStrategicFactors = (activities: DailyActivity[]): number => {
  const factors = new Set<string>();
  for (const activity of activities) {
    const trace = activity.dailyExecutionItem?.master_content?.decision_trace;
    if (!trace) continue;
    [trace.objective, trace.pain_point, trace.writing_angle, trace.tone_used].forEach((value) => {
      const normalized = String(value || '').trim();
      if (normalized) factors.add(normalized);
    });
  }
  return factors.size;
};

const normalizeManualActivityToDailyItem = (
  activity: Partial<DailyActivity>,
  campaignId?: string | null,
  weekNumber?: number
): DailyExecutionItem => {
  const execution_id = String(activity.executionId || '').trim() || `manual-${Date.now()}`;
  const normalized: DailyExecutionItem = {
    execution_id,
    source_type: 'manual',
    campaign_id: campaignId || undefined,
    week_number: Number.isFinite(Number(weekNumber)) ? Number(weekNumber) : undefined,
    platform: String(activity.platform || 'linkedin').toLowerCase(),
    content_type: String(activity.contentType || 'post').toLowerCase(),
    topic: activity.title || undefined,
    title: activity.title || undefined,
    content: activity.description || undefined,
    status: 'draft',
    scheduled_time: activity.time || undefined,
    master_content: activity.dailyExecutionItem?.master_content,
    platform_variants: Array.isArray(activity.dailyExecutionItem?.platform_variants)
      ? activity.dailyExecutionItem?.platform_variants
      : undefined,
    media_assets: Array.isArray(activity.dailyExecutionItem?.media_assets)
      ? activity.dailyExecutionItem?.media_assets
      : undefined,
    media_status: activity.dailyExecutionItem?.media_status,
    execution_readiness: activity.dailyExecutionItem?.execution_readiness,
    execution_jobs: Array.isArray(activity.dailyExecutionItem?.execution_jobs)
      ? activity.dailyExecutionItem?.execution_jobs
      : undefined,
  };
  const withRetention = applyDefaultRetentionLocal(normalized);
  warnDailyNormalizationIssue(withRetention, 'normalizeManualActivityToDailyItem');
  return withRetention;
};

const normalizeActivityToDailyItem = (
  activity: Partial<DailyActivity>,
  campaignId?: string | null,
  weekNumber?: number
): DailyExecutionItem => {
  const source_type: 'planned' | 'manual' =
    activity.sourceType === 'planned'
      ? 'planned'
      : (activity.dailyExecutionItem?.source_type === 'planned' ? 'planned' : 'manual');
  const execution_id =
    String(activity.executionId || activity.dailyExecutionItem?.execution_id || '').trim() ||
    `${source_type === 'manual' ? 'manual' : 'planned'}-${Date.now()}`;
  const normalized: DailyExecutionItem = {
    execution_id,
    source_type,
    campaign_id: campaignId || activity.dailyExecutionItem?.campaign_id || undefined,
    week_number: Number.isFinite(Number(weekNumber))
      ? Number(weekNumber)
      : (Number.isFinite(Number(activity.dailyExecutionItem?.week_number)) ? Number(activity.dailyExecutionItem?.week_number) : undefined),
    platform: String(activity.platform || activity.dailyExecutionItem?.platform || 'linkedin').toLowerCase(),
    content_type: String(activity.contentType || activity.dailyExecutionItem?.content_type || 'post').toLowerCase(),
    topic: activity.dailyExecutionItem?.topic || activity.title || undefined,
    title: activity.title || activity.dailyExecutionItem?.title || undefined,
    content: activity.description || activity.dailyExecutionItem?.content || undefined,
    intent: activity.dailyExecutionItem?.intent,
    writer_content_brief: activity.dailyExecutionItem?.writer_content_brief,
    narrative_role: activity.dailyExecutionItem?.narrative_role,
    progression_step: activity.dailyExecutionItem?.progression_step,
    global_progression_index: activity.dailyExecutionItem?.global_progression_index,
    status: 'draft',
    scheduled_time: activity.time || activity.dailyExecutionItem?.scheduled_time || undefined,
    master_content: activity.dailyExecutionItem?.master_content,
    platform_variants: Array.isArray(activity.dailyExecutionItem?.platform_variants)
      ? activity.dailyExecutionItem?.platform_variants
      : undefined,
    media_assets: Array.isArray(activity.dailyExecutionItem?.media_assets)
      ? activity.dailyExecutionItem?.media_assets
      : undefined,
    media_status: activity.dailyExecutionItem?.media_status,
    execution_readiness: activity.dailyExecutionItem?.execution_readiness,
    execution_jobs: Array.isArray(activity.dailyExecutionItem?.execution_jobs)
      ? activity.dailyExecutionItem?.execution_jobs
      : undefined,
  };
  const withRetention = applyDefaultRetentionLocal(normalized);
  warnDailyNormalizationIssue(withRetention, 'normalizeActivityToDailyItem');
  return withRetention;
};

const normalizeStatusForActivity = (status: unknown): DailyActivity['status'] => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'scheduled') return 'scheduled';
  if (normalized === 'committed') return 'committed';
  if (normalized === 'completed') return 'completed';
  if (normalized === 'in-progress') return 'in-progress';
  return 'planned';
};

export default function DailyPlanningInterface({ week, onSave, campaignId, campaignData, initialDay }: DailyPlanningInterfaceProps) {
  const [dailyActivities, setDailyActivities] = useState<DailyActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [legacyDailyDetected, setLegacyDailyDetected] = useState(false);
  const [executionModeActive, setExecutionModeActive] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<any[]>([]);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);
  const [aiEditPermission, setAiEditPermission] = useState(false);
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false);
  const [activeTab, setActiveTab] = useState<'planning' | 'content' | 'voice'>('planning');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showDayActivitiesView, setShowDayActivitiesView] = useState(false);
  const [isDayActivitiesMinimized, setIsDayActivitiesMinimized] = useState(false);
  const [isDayActivitiesMaximized, setIsDayActivitiesMaximized] = useState(false);
  const [selectedActivityIdForDetail, setSelectedActivityIdForDetail] = useState<string | null>(null);
  const [showContentPanel, setShowContentPanel] = useState(false);
  const [platformCatalogPlatforms, setPlatformCatalogPlatforms] = useState<any[]>([]);
  const [autopilotSummary, setAutopilotSummary] = useState<{ scheduled: number; skipped: number } | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [pendingDeleteActivityId, setPendingDeleteActivityId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const [expandedDayCards, setExpandedDayCards] = useState<Set<string>>(() => new Set(daysOfWeek));
  const asObject = (value: unknown): Record<string, any> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
  const fallbackPlatforms = ['linkedin', 'facebook', 'instagram', 'x', 'youtube', 'tiktok'];
  const fallbackPlatformContentTypes: Record<string, string[]> = {
    linkedin: ['post', 'article', 'video'],
    facebook: ['post', 'video', 'story', 'reel', 'event'],
    instagram: ['feed_post', 'story', 'reel'],
    x: ['tweet', 'thread', 'video'],
    youtube: ['video', 'short', 'live'],
    tiktok: ['video', 'live', 'post'],
  };

  useEffect(() => {
    let cancelled = false;
    const loadCatalog = async () => {
      try {
        const res = await fetch('/api/platform-intelligence/catalog');
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const platforms = Array.isArray(data?.platforms) ? data.platforms : [];
        if (!cancelled) setPlatformCatalogPlatforms(platforms);
      } catch {
        // ignore; fall back
      }
    };
    loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const platforms = React.useMemo(() => {
    if (!platformCatalogPlatforms || platformCatalogPlatforms.length === 0) return fallbackPlatforms;
    const keys = platformCatalogPlatforms
      .map((p) => String(p?.canonical_key || '').toLowerCase().trim())
      .filter(Boolean);
    return keys.length > 0 ? keys : fallbackPlatforms;
  }, [platformCatalogPlatforms]);

  const platformContentTypes = React.useMemo(() => {
    if (!platformCatalogPlatforms || platformCatalogPlatforms.length === 0) return fallbackPlatformContentTypes;
    const next: Record<string, string[]> = {};
    platformCatalogPlatforms.forEach((p) => {
      const key = String(p?.canonical_key || '').toLowerCase().trim();
      const raw = Array.isArray(p?.supported_content_types) ? p.supported_content_types : [];
      const types = raw.map((t: any) => String(t || '').toLowerCase().trim()).filter(Boolean);
      if (key && types.length > 0) next[key] = Array.from(new Set(types));
    });
    return Object.keys(next).length > 0 ? next : fallbackPlatformContentTypes;
  }, [platformCatalogPlatforms]);

  const getAllContentTypes = () => {
    return [...new Set(Object.values(platformContentTypes).flat())];
  };

  const notify = (type: 'success' | 'error' | 'info', message: string) => {
    setNotice({ type, message });
  };

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let cancelled = false;
    const initializeFromPrioritySources = async () => {
      setIsLoading(true);
      try {
        initializeDailyActivities();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void initializeFromPrioritySources();
    return () => {
      cancelled = true;
    };
  }, [campaignId, week?.weekNumber, week?.daily_execution_items, week?.daily, week?.content]);

  useEffect(() => {
    if (!initialDay) return;
    const normalized = String(initialDay).trim();
    if (!daysOfWeek.includes(normalized)) return;
    setSelectedDay(normalized);
    setActiveTab('planning');
  }, [initialDay]);

  const mapDailyExecutionItemToActivity = (item: any, index: number): DailyActivity => {
    if (!String(item?.source_type || '').trim()) {
      console.warn('[daily-normalization][missing-source-type]', {
        context: 'mapDailyExecutionItemToActivity',
        execution_id: item?.execution_id ?? null,
      });
    }
    const sourceType: 'planned' | 'manual' = String(item?.source_type || '').trim() === 'planned' ? 'planned' : 'manual';
    const executionId = String(item?.execution_id || '').trim() || `${sourceType}-${Date.now()}-${index}`;
    const progressionIndexRaw = Number(item?.global_progression_index);
    const normalizedDay = String(item?.day || item?.day_of_week || '').trim();
    const hasExplicitDay = daysOfWeek.includes(normalizedDay);
    const fallbackDayIndex = Number.isFinite(progressionIndexRaw)
      ? ((Math.floor(progressionIndexRaw) % daysOfWeek.length) + daysOfWeek.length) % daysOfWeek.length
      : (index % daysOfWeek.length);
    const day = hasExplicitDay ? normalizedDay : daysOfWeek[fallbackDayIndex];
    const dayIndex = hasExplicitDay ? daysOfWeek.indexOf(normalizedDay) : fallbackDayIndex;
    const dateObj = new Date(week.dates?.start || new Date());
    dateObj.setDate(dateObj.getDate() + dayIndex);
    const scheduledRaw = String(item?.scheduled_time || '').trim();
    const normalizedTime = scheduledRaw ? scheduledRaw.split(':').slice(0, 2).join(':') : `${9 + (index % 3)}:00`;
    const intent = item?.intent && typeof item.intent === 'object' ? item.intent : undefined;
    const writerBrief =
      item?.writer_content_brief && typeof item.writer_content_brief === 'object'
        ? item.writer_content_brief
        : undefined;
    const variants = Array.isArray(item?.platform_variants) ? item.platform_variants : [];
    const variantPlatforms: string[] = variants
      .map((variant: any) => String(variant?.platform || '').trim().toLowerCase())
      .filter((platform: string): platform is string => Boolean(platform));
    const uniquePlatforms: string[] = Array.from(new Set<string>(variantPlatforms));
    const dailyExecutionItem: DailyExecutionItem = {
      execution_id: executionId,
      source_type: sourceType,
      campaign_id: campaignId || undefined,
      week_number: Number.isFinite(Number(week.weekNumber)) ? Number(week.weekNumber) : undefined,
      platform: String(item?.platform || uniquePlatforms[0] || 'linkedin').toLowerCase(),
      content_type: String(item?.content_type || 'post').toLowerCase(),
      topic: typeof item?.topic === 'string' ? item.topic : undefined,
      title: typeof item?.title === 'string' ? item.title : undefined,
      content: typeof item?.content === 'string' ? item.content : undefined,
      intent,
      writer_content_brief: writerBrief,
      narrative_role: typeof item?.narrative_role === 'string' ? item.narrative_role : undefined,
      progression_step: Number.isFinite(Number(item?.progression_step)) ? Number(item.progression_step) : undefined,
      global_progression_index: Number.isFinite(Number(item?.global_progression_index))
        ? Number(item.global_progression_index)
        : undefined,
      status: normalizeStatusForActivity(item?.status) === 'scheduled' ? 'scheduled' : 'draft',
      scheduled_time: normalizedTime,
      master_content:
        item?.master_content && typeof item.master_content === 'object' ? item.master_content : undefined,
      platform_variants: Array.isArray(item?.platform_variants) ? item.platform_variants : undefined,
      media_assets: Array.isArray(item?.media_assets) ? item.media_assets : undefined,
      media_status: item?.media_status === 'ready' || item?.media_status === 'missing' ? item.media_status : undefined,
      execution_readiness:
        item?.execution_readiness && typeof item.execution_readiness === 'object'
          ? item.execution_readiness
          : undefined,
      execution_jobs: Array.isArray(item?.execution_jobs) ? item.execution_jobs : undefined,
    };
    const normalizedDailyExecutionItem = applyDefaultRetentionLocal(dailyExecutionItem);
    warnDailyNormalizationIssue(normalizedDailyExecutionItem, 'mapDailyExecutionItemToActivity');
    return {
      id: executionId,
      executionId,
      sourceType,
      day,
      date: dateObj.toISOString().split('T')[0],
      time: normalizedTime,
      platform: normalizedDailyExecutionItem.platform,
      contentType: normalizedDailyExecutionItem.content_type,
      title: normalizedDailyExecutionItem.title || normalizedDailyExecutionItem.topic || `${day} ${normalizedDailyExecutionItem.content_type}`,
      description: normalizedDailyExecutionItem.content || `Content for ${day}`,
      status: normalizeStatusForActivity(item?.status),
      aiSuggested: false,
      aiEdited: false,
      topic: String(item?.topic || normalizedDailyExecutionItem.topic || '').trim() || undefined,
      objective: String((intent as any)?.objective || '').trim() || undefined,
      platforms: uniquePlatforms,
      summary: String((writerBrief as any)?.core_message || '').trim() || undefined,
      cta: String((intent as any)?.cta_type || '').trim() || undefined,
      dailyExecutionItem: normalizedDailyExecutionItem,
    };
  };

  const loadCommittedDailyActivities = async (): Promise<DailyActivity[] | null> => {
    if (!campaignId || !week?.weekNumber) return [];
    try {
      const response = await fetch(`/api/campaigns/daily-plans?campaignId=${encodeURIComponent(campaignId)}`);
      if (!response.ok) return [];
      const payload = await response.json();
      const plans = Array.isArray(payload) ? payload : [];
      const currentWeekPlans = plans.filter((plan: any) => Number(plan?.weekNumber) === Number(week.weekNumber));
      if (currentWeekPlans.length === 0) return [];

      const weeklyItems: any[] = Array.isArray(week?.daily_execution_items) ? week.daily_execution_items : [];
      const committedActivities: DailyActivity[] = currentWeekPlans.map((plan: any, idx: number) => {
        const meta = parseDailyExecutionMetadata(plan?.formatNotes);
        const executionId = String(meta.execution_id || `committed-${plan?.id || idx}`).trim();
        const sourceType: 'planned' | 'manual' = meta.source_type === 'planned' ? 'planned' : 'manual';
        const timeRaw = String(plan?.scheduledTime || '').trim();
        const normalizedTime = timeRaw ? timeRaw.split(':').slice(0, 2).join(':') : '09:00';
        const committedRaw = asObject(plan?.dailyObject) || {};
        const planTopic = String(plan?.topic || plan?.title || committedRaw.topic || committedRaw.topicTitle || '').trim().toLowerCase();
        const planPlatform = String(plan?.platform || committedRaw.platform || '').trim().toLowerCase();
        const matchedWeeklyItem =
          weeklyItems.find((item: any) => String(item?.execution_id || '').trim() === executionId) ||
          weeklyItems.find((item: any) => {
            const itemTopic = String(item?.topic || item?.title || '').trim().toLowerCase();
            const itemPlatform = String(item?.platform || '').trim().toLowerCase();
            return !!planTopic && itemTopic === planTopic && (!planPlatform || itemPlatform === planPlatform);
          }) ||
          null;
        const matchedIntent = asObject((committedRaw as any)?.intent) || asObject(matchedWeeklyItem?.intent);
        const matchedWriterBrief =
          asObject((committedRaw as any)?.writer_content_brief) || asObject(matchedWeeklyItem?.writer_content_brief);
        const matchedMasterContent =
          asObject((committedRaw as any)?.master_content) || asObject(matchedWeeklyItem?.master_content);
        const matchedVariants = Array.isArray((committedRaw as any)?.platform_variants)
          ? (committedRaw as any).platform_variants
          : (Array.isArray(matchedWeeklyItem?.platform_variants) ? matchedWeeklyItem.platform_variants : undefined);
        const matchedMediaAssets = Array.isArray((committedRaw as any)?.media_assets)
          ? (committedRaw as any).media_assets
          : (Array.isArray(matchedWeeklyItem?.media_assets) ? matchedWeeklyItem.media_assets : undefined);
        const matchedMediaStatus =
          (committedRaw as any)?.media_status === 'ready' || (committedRaw as any)?.media_status === 'missing'
            ? (committedRaw as any).media_status
            : (matchedWeeklyItem?.media_status === 'ready' || matchedWeeklyItem?.media_status === 'missing'
              ? matchedWeeklyItem.media_status
              : undefined);
        const dailyExecutionItem: DailyExecutionItem = {
          execution_id: executionId,
          source_type: sourceType,
          campaign_id: campaignId,
          week_number: Number(week.weekNumber),
          platform: String(plan?.platform || 'linkedin').toLowerCase(),
          content_type: String(plan?.contentType || 'post').toLowerCase(),
          topic:
            plan?.topic ||
            plan?.title ||
            (committedRaw as any)?.topic ||
            (committedRaw as any)?.topicTitle ||
            matchedWeeklyItem?.topic ||
            matchedWeeklyItem?.title ||
            undefined,
          title:
            plan?.title ||
            (committedRaw as any)?.title ||
            (committedRaw as any)?.topicTitle ||
            matchedWeeklyItem?.title ||
            undefined,
          content:
            plan?.content ||
            (committedRaw as any)?.content ||
            (committedRaw as any)?.dailyObjective ||
            matchedWeeklyItem?.content ||
            undefined,
          intent: matchedIntent || undefined,
          writer_content_brief: matchedWriterBrief || undefined,
          narrative_role:
            String((committedRaw as any)?.narrative_role || '').trim() ||
            (typeof matchedWeeklyItem?.narrative_role === 'string' ? matchedWeeklyItem.narrative_role : undefined),
          progression_step: Number.isFinite(Number((committedRaw as any)?.progression_step))
            ? Number((committedRaw as any).progression_step)
            : (Number.isFinite(Number(matchedWeeklyItem?.progression_step)) ? Number(matchedWeeklyItem.progression_step) : undefined),
          global_progression_index: Number.isFinite(Number((committedRaw as any)?.global_progression_index))
            ? Number((committedRaw as any).global_progression_index)
            : (Number.isFinite(Number(matchedWeeklyItem?.global_progression_index)) ? Number(matchedWeeklyItem.global_progression_index) : undefined),
          status: 'draft',
          scheduled_time: normalizedTime,
          retention_state: meta.retention_state,
          expires_at: meta.expires_at,
          archived_at: meta.archived_at,
          content_visibility: meta.content_visibility,
          retention_reminders: meta.retention_reminders,
          created_at: typeof plan?.created_at === 'string' ? plan.created_at : undefined,
          master_content: (matchedMasterContent as any) || undefined,
          platform_variants: matchedVariants,
          media_assets: matchedMediaAssets,
          media_status: matchedMediaStatus,
          execution_readiness:
            (committedRaw as any)?.execution_readiness && typeof (committedRaw as any).execution_readiness === 'object'
              ? (committedRaw as any).execution_readiness
              : (matchedWeeklyItem?.execution_readiness && typeof matchedWeeklyItem.execution_readiness === 'object'
                ? matchedWeeklyItem.execution_readiness
                : undefined),
          execution_jobs:
            Array.isArray((committedRaw as any)?.execution_jobs)
              ? (committedRaw as any).execution_jobs
              : (Array.isArray(matchedWeeklyItem?.execution_jobs) ? matchedWeeklyItem.execution_jobs : undefined),
        };
        const normalizedDailyExecutionItem = applyDefaultRetentionLocal(dailyExecutionItem);
        warnDailyNormalizationIssue(normalizedDailyExecutionItem, 'loadCommittedDailyActivities');
        return {
          id: String(plan?.id || `${week.weekNumber}-${executionId}-${idx}`),
          executionId,
          sourceType,
          day: daysOfWeek.includes(String(plan?.dayOfWeek || '').trim())
            ? String(plan.dayOfWeek).trim()
            : daysOfWeek[idx % daysOfWeek.length],
          date: String(plan?.date || new Date().toISOString().split('T')[0]),
          time: normalizedTime,
          platform: normalizedDailyExecutionItem.platform,
          contentType: normalizedDailyExecutionItem.content_type,
          title: String(plan?.title || normalizedDailyExecutionItem.topic || 'Submitted Activity'),
          description: String(plan?.content || ''),
          status: 'committed',
          aiSuggested: false,
          aiEdited: false,
          dailyExecutionItem: normalizedDailyExecutionItem,
        };
      });

      const draftIds = new Set(
        (Array.isArray(week?.daily_execution_items) ? week.daily_execution_items : [])
          .map((item: any) => String(item?.execution_id || '').trim())
          .filter(Boolean)
      );
      const committedIds = committedActivities.map((a) => String(a.executionId || '').trim()).filter(Boolean);
      const overlaps = committedIds.filter((id) => draftIds.has(id));
      if (overlaps.length > 0) {
        console.warn('[daily-normalization][duplicate-execution-id-draft-vs-committed]', {
          week: week.weekNumber,
          overlaps,
        });
      }

      return committedActivities;
    } catch (error) {
      console.warn('[daily-normalization][db-load-failed]', { week: week?.weekNumber, error: String(error) });
      return null;
    }
  };

  const initializeDailyActivities = () => {
    const dailyExecutionItems = Array.isArray(week?.daily_execution_items) ? week.daily_execution_items : [];
    if (dailyExecutionItems.length > 0) {
      const activities = dailyExecutionItems.map((item: any, index: number) => mapDailyExecutionItemToActivity(item, index));
      setDailyActivities(activities);
      setExecutionModeActive(true);
      setLegacyDailyDetected(false);
      return;
    }
    setExecutionModeActive(false);
    setDailyActivities([]);
    const hasLegacyDaily = Array.isArray(week?.daily) && week.daily.length > 0;
    const hasLegacyContent = Array.isArray(week?.content) && week.content.length > 0;
    setLegacyDailyDetected(hasLegacyDaily || hasLegacyContent);
  };

  const warnExecutionIntegrity = (activities: DailyActivity[], context: string) => {
    const issues = activities
      .map((activity) => {
        const item = normalizeActivityToDailyItem(activity, campaignId, week.weekNumber);
        const missingExecutionId = !String(item.execution_id || '').trim();
        const missingExecutionJobs = !Array.isArray(item.execution_jobs) || item.execution_jobs.length === 0;
        if (!missingExecutionId && !missingExecutionJobs) return null;
        return {
          activityId: activity.id,
          day: activity.day,
          missingExecutionId,
          missingExecutionJobs,
        };
      })
      .filter(Boolean);
    if (issues.length > 0) {
      console.warn('[daily-execution-guard][missing-required-fields]', { context, issues });
    }
  };

  const generateAISuggestions = async () => {
    setIsGeneratingSuggestions(true);
    try {
      const response = await fetch('/api/ai/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber: week.weekNumber,
          weekData: week,
          campaignData,
          campaignGoals: campaignData.goals || [],
          brandVoice: 'DrishiQ - clarity engine that solves life miseries',
          useAI: true,
          requestType: 'daily-suggestions'
        })
      });

      if (response.ok) {
        const result = await response.json();
        setAiSuggestions(result.suggestions || []);
        setShowAiSuggestions(true);
      }
    } catch (error) {
      console.error('Error generating AI suggestions:', error);
    } finally {
      setIsGeneratingSuggestions(false);
    }
  };

  const improveDailyPlan = async (day: string) => {
    try {
      const response = await fetch('/api/ai/daily-amendment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber: week.weekNumber,
          day,
          currentDailyActivities: dailyActivities.filter(activity => activity.day === day),
          campaignData,
          weekData: week
        })
      });

      if (response.ok) {
        const result = await response.json();

        // Apply AI improvements directly, then let user review/edit before submit.
        const improvedActivities = (result.improvedActivities || []).map((activity: any, index: number) => {
          const seeded: DailyActivity = {
            id: String(activity.id || `${week.weekNumber}-${day}-${Date.now()}-${index}`),
            executionId: String(activity.executionId || ''),
            sourceType: activity.sourceType === 'planned' ? 'planned' : 'manual',
            day: String(activity.day || day),
            date: String(activity.date || new Date().toISOString().split('T')[0]),
            time: String(activity.time || '09:00'),
            platform: String(activity.platform || 'linkedin'),
            contentType: String(activity.contentType || 'post'),
            title: String(activity.title || 'Improved Activity'),
            description: String(activity.description || activity.content || ''),
            status: activity.status || 'planned',
            aiSuggested: Boolean(activity.aiSuggested),
            aiEdited: true,
          };
          const dailyExecutionItem = normalizeManualActivityToDailyItem(seeded, campaignId, week.weekNumber);
          return {
            ...seeded,
            executionId: dailyExecutionItem.execution_id,
            dailyExecutionItem,
          };
        });
        setDailyActivities(prev =>
          prev.filter(activity => activity.day !== day).concat(improvedActivities)
        );
        notify('success', `${day} plan updated by AI. Review and submit when ready.`);
      }
    } catch (error) {
      console.error('Error improving daily plan:', error);
      notify('error', 'Failed to improve daily plan. Please try again.');
    }
  };

  const commitDailyPlan = async (day: string) => {
    const dayActivities = dailyActivities
      .filter(activity => activity.day === day)
      .map((activity) => {
        const dailyExecutionItem = normalizeActivityToDailyItem(activity, campaignId, week.weekNumber);
        return {
          ...activity,
          executionId: dailyExecutionItem.execution_id,
          sourceType: dailyExecutionItem.source_type,
          dailyExecutionItem,
        };
      });
    warnExecutionIntegrity(dayActivities, 'commitDailyPlan');
    
    try {
      const response = await fetch('/api/campaigns/commit-daily-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber: week.weekNumber,
          day,
          activities: dayActivities,
          commitType: 'finalize'
        })
      });

      if (response.ok) {
        notify('success', `${day} plan submitted successfully.`);
        setDailyActivities(prev =>
          prev.map(activity =>
            activity.day === day
              ? { ...activity, status: 'committed' }
              : activity
          )
        );
      } else {
        throw new Error('Failed to commit plan');
      }
    } catch (error) {
      console.error('Error committing daily plan:', error);
      notify('error', 'Failed to submit daily plan. Please try again.');
    }
  };

  const applyAISuggestion = (suggestion: any) => {
    const activitySeed: DailyActivity = {
      id: `${week.weekNumber}-${Date.now()}`,
      executionId: '',
      sourceType: 'manual',
      day: suggestion.day || 'Monday',
      date: suggestion.date || new Date().toISOString().split('T')[0],
      time: suggestion.time || '09:00',
      platform: suggestion.platform || 'linkedin',
      contentType: suggestion.contentType || 'post',
      title: suggestion.title || 'AI Suggested Content',
      description: suggestion.description || suggestion.content || '',
      status: 'planned',
      aiSuggested: true,
      aiEdited: false
    };
    const dailyExecutionItem = normalizeManualActivityToDailyItem(activitySeed, campaignId, week.weekNumber);
    const newActivity: DailyActivity = {
      ...activitySeed,
      executionId: dailyExecutionItem.execution_id,
      dailyExecutionItem,
    };

    setDailyActivities(prev => [...prev, newActivity]);
  };

  const updateActivity = (id: string, updates: Partial<DailyActivity>) => {
    setDailyActivities(prev => 
      prev.map(activity => 
        activity.id === id
          ? (() => {
              const merged = { ...activity, ...updates };
              const dailyExecutionItem = normalizeActivityToDailyItem(merged, campaignId, week.weekNumber);
              return {
                ...merged,
                executionId: dailyExecutionItem.execution_id,
                sourceType: dailyExecutionItem.source_type,
                dailyExecutionItem,
              };
            })()
          : activity
      )
    );
  };

  const deleteActivity = async (id: string) => {
    try {
      const response = await fetch('/api/admin/check-super-admin');
      const result = await response.json();
      if (!result.isSuperAdmin) {
        notify('error', 'Access denied. Only super admins can delete activities.');
        return;
      }
      setPendingDeleteActivityId(id);
      setDeleteReason('');
    } catch (error) {
      console.error('Error checking super admin status:', error);
      notify('error', 'Error verifying permissions. Please try again.');
    }
  };

  const confirmDeleteActivity = async () => {
    if (!pendingDeleteActivityId) return;
    const id = pendingDeleteActivityId;
    setPendingDeleteActivityId(null);
    try {
      const deleteResponse = await fetch('/api/admin/delete-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId: id,
          reason: deleteReason.trim() || 'No reason provided',
          ipAddress: '127.0.0.1',
          userAgent: navigator.userAgent
        })
      });
      if (deleteResponse.ok) {
        const deleteResult = await deleteResponse.json();
        if (deleteResult.success) {
          setDailyActivities(prev => prev.filter(activity => activity.id !== id));
          notify('success', 'Activity deleted successfully.');
        } else {
          notify('error', `Delete failed: ${deleteResult.error}`);
        }
      } else {
        notify('error', 'Failed to delete activity.');
      }
    } catch (error) {
      console.error('Error deleting activity:', error);
      notify('error', 'Failed to delete activity. Please try again.');
    }
  };

  const addNewActivity = (day: string) => {
    const date = new Date(week.dates?.start || new Date());
    const dayIndex = daysOfWeek.indexOf(day);
    date.setDate(date.getDate() + dayIndex);

    const activitySeed: DailyActivity = {
      id: `${week.weekNumber}-${Date.now()}`,
      executionId: '',
      sourceType: 'manual',
      day: day,
      date: date.toISOString().split('T')[0],
      time: '09:00',
      platform: 'linkedin',
      contentType: 'post',
      title: 'New Activity',
      description: '',
      status: 'planned',
      aiSuggested: false,
      aiEdited: false,
      content: null,
      voiceNotes: []
    };
    const dailyExecutionItem = normalizeManualActivityToDailyItem(activitySeed, campaignId, week.weekNumber);
    const newActivity: DailyActivity = {
      ...activitySeed,
      executionId: dailyExecutionItem.execution_id,
      dailyExecutionItem,
    };

    setDailyActivities(prev => [...prev, newActivity]);
  };

  const openContentPanel = (day: string) => {
    setSelectedDay(day);
    setShowContentPanel(true);
    setActiveTab('content');
  };

  const openVoiceNotes = (day: string) => {
    setSelectedDay(day);
    setActiveTab('voice');
  };

  const handleContentSave = (content: any[]) => {
    if (selectedDay) {
      setDailyActivities(prev => 
        prev.map(activity => 
          activity.day === selectedDay 
            ? { ...activity, content: content }
            : activity
        )
      );
    }
  };

  const handleVoiceTranscription = (transcription: any) => {
    if (selectedDay) {
      setDailyActivities(prev => 
        prev.map(activity => 
          activity.day === selectedDay 
            ? { 
                ...activity, 
                voiceNotes: [...(activity.voiceNotes || []), transcription],
                description: activity.description + '\n\nVoice Note: ' + transcription.text
              }
            : activity
        )
      );
    }
  };

  const saveDailyPlan = () => {
    warnExecutionIntegrity(dailyActivities, 'saveDailyPlan');
    const weekData = {
      ...week,
      dailyActivities: dailyActivities,
      dailyPlanned: true
    };
    onSave(weekData);
  };

  const getActivitiesForDay = (day: string) => {
    return dailyActivities.filter(activity => activity.day === day);
  };

  const normalizeComparableText = (value: unknown): string =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

  const getActivityScheduleGroup = (activityId: string): DailyActivity[] => {
    const anchor = dailyActivities.find((a) => a.id === activityId);
    if (!anchor) return [];
    const normalizedTitle = normalizeComparableText(anchor.title || anchor.topic || '');
    if (!normalizedTitle) return [anchor];
    return dailyActivities
      .filter((a) => a.day === anchor.day && normalizeComparableText(a.title || a.topic || '') === normalizedTitle)
      .sort((a, b) => (a.platform || '').localeCompare(b.platform || ''));
  };

  const openActivityWorkspace = (activityId: string) => {
    const anchor = dailyActivities.find((a) => a.id === activityId);
    if (!anchor) return;
    const schedules = getActivityScheduleGroup(activityId);
    const payload = {
      campaignId,
      weekNumber: week?.weekNumber,
      day: anchor.day,
      activityId: anchor.id,
      title: anchor.title,
      topic: anchor.topic,
      description: anchor.description,
      dailyExecutionItem: anchor.dailyExecutionItem || null,
      source: 'daily' as const,
      schedules: schedules.map((item) => ({
        id: item.id,
        platform: item.platform,
        contentType: item.contentType,
        date: item.date,
        time: item.time,
        status: item.status,
        description: item.description,
        title: item.title,
      })),
    };

    const workspaceKey = `activity-workspace-${campaignId ?? 'campaign'}-${String(anchor.id || `w${week?.weekNumber}-${anchor.day}-${(anchor.title || anchor.topic || '').toString().trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40)}`)}`;
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(workspaceKey, JSON.stringify(payload));
      }
      window.open(`/activity-workspace?workspaceKey=${encodeURIComponent(workspaceKey)}`, '_blank');
    } catch (error) {
      console.error('Failed to open activity workspace:', error);
      notify('error', 'Unable to open activity workspace. Please try again.');
    }
  };

  const selectedActivityScheduleGroup = selectedActivityIdForDetail
    ? getActivityScheduleGroup(selectedActivityIdForDetail)
    : [];
  const selectedActivityAnchor = selectedActivityIdForDetail
    ? dailyActivities.find((a) => a.id === selectedActivityIdForDetail) || null
    : null;

  useEffect(() => {
    const handleWorkspaceMessage = (event: MessageEvent) => {
      if (typeof window === 'undefined') return;
      if (event.origin !== window.location.origin) return;
      const payload = event.data as {
        type?: string;
        schedules?: Array<{ id: string; date?: string; time?: string; description?: string; title?: string }>;
        dailyExecutionItem?: Record<string, unknown> | null;
      };
      if (!payload || payload.type !== 'ACTIVITY_WORKSPACE_SAVE' || !Array.isArray(payload.schedules)) return;
      const updatesById = new Map(payload.schedules.map((s) => [String(s.id), s]));
      const workspaceDailyExecutionItem =
        payload.dailyExecutionItem && typeof payload.dailyExecutionItem === 'object'
          ? payload.dailyExecutionItem
          : null;
      setDailyActivities((prev) =>
        prev.map((activity) => {
          const update = updatesById.get(String(activity.id));
          if (!update) return activity;
          const merged = {
            ...activity,
            date: typeof update.date === 'string' ? update.date : activity.date,
            time: typeof update.time === 'string' ? update.time : activity.time,
            description: typeof update.description === 'string' ? update.description : activity.description,
            title: typeof update.title === 'string' ? update.title : activity.title,
            dailyExecutionItem: workspaceDailyExecutionItem
              ? ({ ...(activity.dailyExecutionItem || {}), ...workspaceDailyExecutionItem } as any)
              : activity.dailyExecutionItem,
          };
          const dailyExecutionItem = normalizeActivityToDailyItem(merged, campaignId, week.weekNumber);
          return {
            ...merged,
            executionId: dailyExecutionItem.execution_id,
            sourceType: dailyExecutionItem.source_type,
            dailyExecutionItem,
          };
        })
      );
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('message', handleWorkspaceMessage);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('message', handleWorkspaceMessage);
      }
    };
  }, [campaignId, week?.weekNumber]);

  const openDayActivitiesView = (day: string) => {
    setSelectedDay(day);
    setIsDayActivitiesMinimized(false);
    setIsDayActivitiesMaximized(false);
    setShowDayActivitiesView(true);
    setActiveTab('planning');
  };

  const toggleDayCardSize = (day: string) => {
    setExpandedDayCards((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  };

  const runAutopilotWeek = async () => {
    try {
      const weekPayload = {
        ...week,
        daily_execution_items: dailyActivities.map((activity) => normalizeActivityToDailyItem(activity, campaignId, week.weekNumber)),
      };
      const response = await fetch('/api/campaigns/autopilot-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          week: weekPayload,
          options: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          },
        }),
      });
      if (!response.ok) throw new Error('Failed to run autopilot');
      const payload = await response.json();
      const updatedItems: any[] = Array.isArray(payload?.week?.daily_execution_items)
        ? payload.week.daily_execution_items
        : [];
      const byExecutionId = new Map<string, any>(
        updatedItems
          .map((item) => [String(item?.execution_id || '').trim(), item] as const)
          .filter(([id]) => Boolean(id))
      );
      setDailyActivities((prev) =>
        prev.map((activity) => {
          const id = String(activity.executionId || activity.dailyExecutionItem?.execution_id || '').trim();
          const nextItem = id ? byExecutionId.get(id) : null;
          if (!nextItem) return activity;
          const nextTime = String(nextItem?.scheduled_time || '').trim();
          const nextStatus =
            String(nextItem?.status || '').toLowerCase() === 'scheduled'
              ? 'scheduled'
              : activity.status;
          return {
            ...activity,
            time: nextTime || activity.time,
            status: nextStatus,
            dailyExecutionItem: nextItem,
          };
        })
      );
      setAutopilotSummary({
        scheduled: Number(payload?.summary?.scheduled_items) || 0,
        skipped: Number(payload?.summary?.skipped_missing_media) || 0,
      });
    } catch (error) {
      console.error('Autopilot week failed:', error);
      notify('error', 'Failed to run autopilot for this week.');
    }
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            notice.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : notice.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-indigo-200 bg-indigo-50 text-indigo-800'
          }`}
          role="status"
          aria-live="polite"
        >
          {notice.message}
        </div>
      )}
      {pendingDeleteActivityId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm flex flex-wrap items-center gap-2">
          <span className="text-amber-900">Delete this activity? (Super admin only)</span>
          <input
            type="text"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            placeholder="Reason (optional)"
            className="flex-1 min-w-[120px] rounded border border-amber-300 px-2 py-1 text-gray-800"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setPendingDeleteActivityId(null); setDeleteReason(''); }} className="px-3 py-1.5 rounded border border-amber-300 bg-white hover:bg-amber-100">Cancel</button>
            <button type="button" onClick={confirmDeleteActivity} className="px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
          </div>
        </div>
      )}
      {/* Header with Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-lg">
              <Calendar className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Week {week.weekNumber} Daily Planning</h3>
              <p className="text-sm text-gray-600">Plan your daily activities and content</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={runAutopilotWeek}
              className="bg-amber-100 text-amber-700 hover:bg-amber-200 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              ⚡ Autopilot Week
            </button>
            <button
              onClick={() => setAiEditPermission(!aiEditPermission)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                aiEditPermission 
                  ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {aiEditPermission ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {aiEditPermission ? 'AI Can Edit' : 'AI Read Only'}
            </button>
            <button
              onClick={generateAISuggestions}
              disabled={isGeneratingSuggestions}
              className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
            >
              {isGeneratingSuggestions ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Get AI Suggestions
                </>
              )}
            </button>
          </div>
        </div>
        {isGeneratingSuggestions && (
          <div className="mt-3">
            <AIGenerationProgress
              isActive={true}
              message="Generating AI suggestions…"
              expectedSeconds={35}
            />
          </div>
        )}
        {autopilotSummary && (
          <div className="mt-3 text-xs text-gray-700 flex items-center gap-3">
            <span>✔ Scheduled {autopilotSummary.scheduled} items</span>
            <span>⚠ Skipped {autopilotSummary.skipped} (missing media)</span>
          </div>
        )}
        {executionModeActive && (
          <div className="mt-1 text-xs text-indigo-700">
            ⚡ Execution Mode
          </div>
        )}
        {legacyDailyDetected && (
          <div className="mt-2 text-xs text-amber-800 bg-amber-100 border border-amber-200 rounded px-2 py-1 inline-block">
            Legacy daily plan detected — please regenerate weekly plan.
          </div>
        )}
        {week?.autopilot_result && (
          <div className="mt-1 text-xs text-gray-600">
            AI used {countStrategicFactors(dailyActivities)} strategic factors.
          </div>
        )}
        
        {/* Navigation Tabs */}
        <div className="flex space-x-1 bg-gray-100 rounded-lg p-1">
          {[
            { id: 'planning', label: 'Daily Planning', icon: Calendar },
            { id: 'content', label: 'Content Creation', icon: FileText },
            { id: 'voice', label: 'Voice Notes', icon: Mic }
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-white text-purple-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* AI Suggestions Panel */}
      {showAiSuggestions && aiSuggestions.length > 0 && activeTab === 'planning' && (
        <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl p-4 border border-blue-200">
          <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600" />
            AI Suggestions for Week {week.weekNumber}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {aiSuggestions.map((suggestion, index) => (
              <div key={index} className="bg-white rounded-lg p-3 border border-blue-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">{suggestion.day}</span>
                  <button
                    onClick={() => applyAISuggestion(suggestion)}
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    Apply
                  </button>
                </div>
                <p className="text-sm text-gray-600">{suggestion.description}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                    {suggestion.platform}
                  </span>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                    {suggestion.contentType}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content Creation Panel */}
      {activeTab === 'content' && (
        <ContentCreationPanel
          context="daily"
          campaignId={campaignId}
          weekNumber={week.weekNumber}
          dayNumber={selectedDay ? daysOfWeek.indexOf(selectedDay) + 1 : undefined}
          onContentSave={handleContentSave}
        />
      )}

      {/* Voice Notes Panel */}
      {activeTab === 'voice' && (
        <VoiceNotesComponent
          context="daily"
          campaignId={campaignId}
          weekNumber={week.weekNumber}
          dayNumber={selectedDay ? daysOfWeek.indexOf(selectedDay) + 1 : undefined}
          onTranscriptionComplete={handleVoiceTranscription}
        />
      )}

      {/* Daily Activities Grid */}
      {activeTab === 'planning' && (
        <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
          {daysOfWeek.map((day, dayIndex) => {
            const dayActivities = getActivitiesForDay(day);
            const isExpanded = expandedDayCards.has(day);
            const date = new Date(week.dates?.start || new Date());
            date.setDate(date.getDate() + dayIndex);
            
            return (
              <div
                key={day}
                className={`bg-gray-50 rounded-xl p-4 border transition-colors ${
                  selectedDay === day ? 'border-indigo-400 ring-1 ring-indigo-300' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => openDayActivitiesView(day)}
                    className="text-left hover:text-indigo-700 transition-colors"
                    title={`Open ${day} daily view`}
                  >
                    <h4 className="font-semibold text-gray-900">{day}</h4>
                    <p className="text-xs text-gray-500">{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDayCardSize(day);
                      }}
                      className="p-1 hover:bg-indigo-100 rounded text-indigo-600"
                      title={isExpanded ? 'Minimize card' : 'Maximize card'}
                    >
                      {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => improveDailyPlan(day)}
                      className="p-1 hover:bg-purple-100 rounded text-purple-600"
                      title="AI Improve Day Plan"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => openContentPanel(day)}
                      className="p-1 hover:bg-blue-100 rounded text-blue-600"
                      title="Add Content"
                    >
                      <FileText className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => openVoiceNotes(day)}
                      className="p-1 hover:bg-purple-100 rounded text-purple-600"
                      title="Voice Notes"
                    >
                      <Mic className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => addNewActivity(day)}
                      className="p-1 hover:bg-gray-200 rounded text-gray-600"
                      title="Add Activity"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    {dayActivities.length > 0 && dayActivities.some(a => a.status !== 'committed') && (
                      <button
                        onClick={() => commitDailyPlan(day)}
                        className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium hover:bg-green-200"
                        title="Submit Day Plan"
                      >
                        Submit
                      </button>
                    )}
                  </div>
                </div>

              {!isExpanded ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-white/70 p-3 text-center text-xs text-gray-600">
                  {dayActivities.length} activit{dayActivities.length === 1 ? 'y' : 'ies'} hidden
                </div>
              ) : (
                <div className="space-y-2">
                  {dayActivities.map((activity) => (
                    <div key={activity.id} className="bg-white rounded-lg p-3 border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-700">{activity.time}</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            activity.status === 'committed'
                              ? 'bg-emerald-100 text-emerald-700'
                              : activity.status === 'scheduled'
                                ? 'bg-blue-100 text-blue-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                          title={`Status: ${activity.status === 'committed' ? 'submitted' : activity.status === 'scheduled' ? 'scheduled' : 'draft'}`}
                        >
                          {activity.status === 'committed' ? 'submitted' : activity.status === 'scheduled' ? 'scheduled' : 'draft'}
                        </span>
                        {activity.aiSuggested && (
                          <div title="AI Suggested">
                            <Sparkles className="h-3 w-3 text-purple-500" />
                          </div>
                        )}
                        {activity.aiEdited && (
                          <div title="AI Edited">
                            <Brain className="h-3 w-3 text-blue-500" />
                          </div>
                        )}
                        {activity.content && (
                          <div title="Has Content">
                            <FileText className="h-3 w-3 text-green-500" />
                          </div>
                        )}
                        {activity.voiceNotes && activity.voiceNotes.length > 0 && (
                          <div title="Has Voice Notes">
                            <Mic className="h-3 w-3 text-purple-500" />
                          </div>
                        )}
                        {hasMasterGenerated(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-700">
                            🧠 Master Generated
                          </span>
                        )}
                        {hasAiGeneratedMasterContent(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                            ✨ AI Generated Master
                          </span>
                        )}
                        {hasVariantsReady(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-cyan-100 text-cyan-700">
                            ⚙️ Variants Ready
                          </span>
                        )}
                        {hasAiAdaptedVariant(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-sky-100 text-sky-700">
                            🌐 AI Adapted
                          </span>
                        )}
                        {hasDiscoverabilityOptimization(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-lime-100 text-lime-700">
                            📈 Discoverability Optimized
                          </span>
                        )}
                        {hasAlgorithmicFormattingOptimization(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
                            🧠 Algorithm Optimized
                          </span>
                        )}
                        {hasMediaSearchSuggestions(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-cyan-100 text-cyan-700">
                            🔍 Media Suggestions Ready
                          </span>
                        )}
                        {getExecutionReadinessBadge(activity.dailyExecutionItem) && (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${getExecutionReadinessBadge(activity.dailyExecutionItem)?.className}`}
                          >
                            {getExecutionReadinessBadge(activity.dailyExecutionItem)?.label}
                          </span>
                        )}
                        {getExecutionJobPills(activity.dailyExecutionItem).length > 0 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-700">
                            {getExecutionJobPills(activity.dailyExecutionItem).join(' ')}
                          </span>
                        )}
                        {hasSchedulableExecutionJob(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-teal-100 text-teal-700">
                            🗓 Schedulable
                          </span>
                        )}
                        {getMediaStatusBadge(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700">
                            {getMediaStatusBadge(activity.dailyExecutionItem)}
                          </span>
                        )}
                        {getRetentionBadge(activity.dailyExecutionItem) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-700">
                            {getRetentionBadge(activity.dailyExecutionItem)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updateActivity(activity.id, { status: 'completed' })}
                          className="p-1 hover:bg-green-100 rounded text-green-600"
                        >
                          <CheckCircle className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => deleteActivity(activity.id)}
                          className="p-1 hover:bg-red-100 rounded text-red-600"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => openActivityWorkspace(activity.id)}
                        className="w-full text-left text-sm font-semibold text-indigo-700 hover:text-indigo-800 hover:underline"
                        title="Open activity workspace"
                      >
                        {activity.title || activity.topic || 'Open activity workspace'}
                      </button>
                      <input
                        type="text"
                        value={activity.title}
                        onChange={(e) => updateActivity(activity.id, { title: e.target.value })}
                        className="w-full text-sm font-medium border-none bg-transparent focus:outline-none"
                        placeholder="Activity title"
                      />
                      
                      <div className="flex gap-2">
                        <select
                          value={activity.platform}
                          onChange={(e) => updateActivity(activity.id, { platform: e.target.value })}
                          className="text-xs border border-gray-200 rounded px-2 py-1"
                        >
                          {platforms.map(platform => (
                            <option key={platform} value={platform}>{platform}</option>
                          ))}
                        </select>
                        <select
                          value={activity.contentType}
                          onChange={(e) => updateActivity(activity.id, { contentType: e.target.value })}
                          className="text-xs border border-gray-200 rounded px-2 py-1"
                        >
                          {(platformContentTypes[activity.platform as keyof typeof platformContentTypes] || getAllContentTypes()).map(type => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </div>

                      <textarea
                        value={activity.description}
                        onChange={(e) => updateActivity(activity.id, { description: e.target.value })}
                        className="w-full text-xs border border-gray-200 rounded px-2 py-1 h-16 resize-none"
                        placeholder="Activity description..."
                      />
                      {(activity.dailyExecutionItem?.master_content?.decision_trace ||
                        activity.dailyExecutionItem?.writer_content_brief ||
                        activity.dailyExecutionItem?.master_content ||
                        (Array.isArray(activity.dailyExecutionItem?.platform_variants) &&
                          activity.dailyExecutionItem?.platform_variants.some((v) => v?.adaptation_trace))) && (
                        <details className="text-xs border border-gray-200 rounded px-2 py-2 bg-gray-50">
                          <summary className="cursor-pointer font-medium text-gray-700">AI Decision</summary>
                          <div className="mt-2 space-y-1 text-gray-600">
                            {activity.dailyExecutionItem?.writer_content_brief && (
                              <div>
                                <span className="font-medium">Writer brief:</span>{' '}
                                {String((activity.dailyExecutionItem.writer_content_brief as any)?.core_message || 'available')}
                              </div>
                            )}
                            {activity.dailyExecutionItem?.master_content && (
                              <div>
                                <span className="font-medium">Master content:</span>{' '}
                                {activity.dailyExecutionItem.master_content.generation_status}
                              </div>
                            )}
                            {Array.isArray(activity.dailyExecutionItem?.platform_variants) && (
                              <div>
                                <span className="font-medium">Variants:</span>{' '}
                                {activity.dailyExecutionItem.platform_variants.length}
                              </div>
                            )}
                            {activity.dailyExecutionItem?.master_content?.decision_trace && (
                              <>
                                <div>
                                  <span className="font-medium">Objective:</span>{' '}
                                  {activity.dailyExecutionItem.master_content.decision_trace.objective}
                                </div>
                                <div>
                                  <span className="font-medium">Pain point:</span>{' '}
                                  {activity.dailyExecutionItem.master_content.decision_trace.pain_point}
                                </div>
                                <div>
                                  <span className="font-medium">Tone:</span>{' '}
                                  {activity.dailyExecutionItem.master_content.decision_trace.tone_used}
                                </div>
                                <div>
                                  <span className="font-medium">Narrative role:</span>{' '}
                                  {activity.dailyExecutionItem.master_content.decision_trace.narrative_role}
                                </div>
                              </>
                            )}
                            {(() => {
                              const variants = Array.isArray(activity.dailyExecutionItem?.platform_variants)
                                ? activity.dailyExecutionItem!.platform_variants!
                                : [];
                              const selectedVariant =
                                variants.find((v) => String(v?.platform || '').toLowerCase() === String(activity.platform || '').toLowerCase()) ||
                                variants[0];
                              const trace = selectedVariant?.adaptation_trace;
                              if (!trace) return null;
                              return (
                                <>
                                  <div>
                                    <span className="font-medium">Platform strategy:</span> {trace.style_strategy}
                                  </div>
                                  <div>
                                    <span className="font-medium">Character limit:</span>{' '}
                                    {trace.character_limit_used ?? 'none'}
                                  </div>
                                  <div>
                                    <span className="font-medium">Format used:</span> {trace.format_family}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </details>
                      )}
                      {(() => {
                        const variants = Array.isArray(activity.dailyExecutionItem?.platform_variants)
                          ? activity.dailyExecutionItem!.platform_variants!
                          : [];
                        const selectedVariant =
                          variants.find((v) => String(v?.platform || '').toLowerCase() === String(activity.platform || '').toLowerCase()) ||
                          variants[0];
                        const mediaSearchIntent = selectedVariant?.media_search_intent;
                        const requirements = Array.isArray(mediaSearchIntent?.media_requirements)
                          ? mediaSearchIntent.media_requirements
                          : [];
                        if (requirements.length === 0) return null;
                        const requiredItems = requirements.filter((r) => r.required);
                        const optionalItems = requirements.filter((r) => !r.required);
                        const mediaIcon = (mediaType: string) =>
                          mediaType === 'video' ? '🎥' : '🖼';
                        const copyPrimary = (query: string) => {
                          if (typeof navigator !== 'undefined' && navigator.clipboard) {
                            navigator.clipboard.writeText(query).catch(() => undefined);
                          }
                        };
                        return (
                          <details className="text-xs border border-cyan-200 rounded px-2 py-2 bg-cyan-50">
                            <summary className="cursor-pointer font-medium text-cyan-800">Media Search Suggestions</summary>
                            <div className="mt-2 space-y-1 text-cyan-900">
                              {requiredItems.length > 0 && (
                                <div>
                                  <span className="font-medium">Required</span>
                                  <div className="mt-1 space-y-2">
                                    {requiredItems.map((item, idx) => (
                                      <div key={`${item.role}-required-${idx}`} className="rounded border border-cyan-200 bg-white px-2 py-1">
                                        <div className="font-medium">
                                          {mediaIcon(item.media_type)} {item.role.replace(/_/g, ' ')} Required
                                        </div>
                                        <div><span className="font-medium">Primary Search:</span> {item.primary_query}</div>
                                        {item.alternative_queries.length > 0 && (
                                          <div>
                                            <span className="font-medium">Alternatives:</span>{' '}
                                            {item.alternative_queries.join(' | ')}
                                          </div>
                                        )}
                                        <div><span className="font-medium">Orientation:</span> {item.orientation}</div>
                                        <button
                                          type="button"
                                          onClick={() => copyPrimary(item.primary_query)}
                                          className="mt-1 text-[11px] px-2 py-0.5 rounded bg-cyan-100 hover:bg-cyan-200"
                                        >
                                          Copy
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {optionalItems.length > 0 && (
                                <div>
                                  <span className="font-medium">Optional</span>
                                  <div className="mt-1 space-y-2">
                                    {optionalItems.map((item, idx) => (
                                      <div key={`${item.role}-optional-${idx}`} className="rounded border border-cyan-200 bg-white px-2 py-1">
                                        <div className="font-medium">
                                          {mediaIcon(item.media_type)} {item.role.replace(/_/g, ' ')} Optional
                                        </div>
                                        <div><span className="font-medium">Primary Search:</span> {item.primary_query}</div>
                                        <div><span className="font-medium">Orientation:</span> {item.orientation}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </details>
                        );
                      })()}
                    </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        </div>
      )}

      {/* Focused Daily View */}
      {showDayActivitiesView && selectedDay && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div
            className={`w-full overflow-hidden bg-white shadow-2xl transition-all duration-200 ${
              isDayActivitiesMaximized
                ? 'h-full max-h-full rounded-none'
                : 'max-w-3xl max-h-[85vh] rounded-2xl'
            }`}
          >
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {selectedDay} - Activities
                </h3>
                <p className="text-sm text-gray-500">
                  {getActivitiesForDay(selectedDay).length} item{getActivitiesForDay(selectedDay).length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsDayActivitiesMinimized((prev) => !prev)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  title={isDayActivitiesMinimized ? 'Expand' : 'Minimize'}
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setIsDayActivitiesMaximized((prev) => !prev)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  title={isDayActivitiesMaximized ? 'Restore' : 'Maximize'}
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setShowDayActivitiesView(false);
                    setIsDayActivitiesMinimized(false);
                    setIsDayActivitiesMaximized(false);
                  }}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            {!isDayActivitiesMinimized && (
              <div
                className={`overflow-y-auto p-4 space-y-3 ${
                  isDayActivitiesMaximized ? 'max-h-[calc(100vh-76px)]' : 'max-h-[calc(85vh-76px)]'
                }`}
              >
                {getActivitiesForDay(selectedDay).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                    No activities planned for {selectedDay}.
                  </div>
                ) : (
                  getActivitiesForDay(selectedDay).map((activity) => (
                    <div
                      key={`day-view-${activity.id}`}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-gray-900">{activity.title}</div>
                        <div className="text-xs text-gray-500">{activity.time}</div>
                      </div>
                      <div className="mt-1 text-xs text-gray-600 flex items-center gap-1.5 flex-wrap">
                        <PlatformIcon platform={activity.platform} size={12} showLabel /> • {activity.contentType} • {activity.status}
                      </div>

                      {activity.description && (
                        <button
                          type="button"
                          onClick={() => openActivityWorkspace(activity.id)}
                          className="mt-2 w-full rounded border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-left text-sm text-gray-700 whitespace-pre-wrap hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                          title="Open activity workspace"
                        >
                          {activity.description}
                        </button>
                      )}

                      <div className="mt-2 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setSelectedActivityIdForDetail(activity.id)}
                          className="text-[11px] text-indigo-600 hover:text-indigo-700"
                        >
                          Schedule by platform
                        </button>
                        <button
                          type="button"
                          onClick={() => openActivityWorkspace(activity.id)}
                          className="text-[11px] text-indigo-600 hover:text-indigo-700"
                        >
                          Open activity workspace
                        </button>
                      </div>

                      <div className="mt-3 border-t border-gray-200 pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="text-xs text-gray-600">
                          Date
                          <input
                            type="date"
                            value={activity.date || ''}
                            min={campaignData?.start_date || new Date().toISOString().split('T')[0]}
                            onChange={(e) => updateActivity(activity.id, { date: e.target.value })}
                            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                          />
                        </label>
                        <label className="text-xs text-gray-600">
                          Time
                          <input
                            type="time"
                            value={activity.time || '09:00'}
                            onChange={(e) => updateActivity(activity.id, { time: e.target.value })}
                            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                          />
                        </label>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Activity-specific scheduler view */}
      {selectedActivityAnchor && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{selectedActivityAnchor.title}</h3>
                <p className="text-sm text-gray-500">
                  {selectedActivityScheduleGroup.length} platform schedule
                  {selectedActivityScheduleGroup.length === 1 ? '' : 's'} • {selectedActivityAnchor.day}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openActivityWorkspace(selectedActivityAnchor.id)}
                  className="px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 text-sm hover:bg-indigo-50"
                >
                  Open Activity Workspace
                </button>
                <button
                  onClick={() => setSelectedActivityIdForDetail(null)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-3 max-h-[75vh] overflow-y-auto">
              {selectedActivityScheduleGroup.map((item) => (
                <div key={`activity-schedule-${item.id}`} className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-gray-900"><PlatformIcon platform={item.platform} size={14} showLabel /></div>
                    <div className="text-xs text-gray-500">{item.contentType}</div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="text-xs text-gray-600">
                      Date
                      <input
                        type="date"
                        value={item.date || ''}
                        min={campaignData?.start_date || new Date().toISOString().split('T')[0]}
                        onChange={(e) => updateActivity(item.id, { date: e.target.value })}
                        className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                      />
                    </label>
                    <label className="text-xs text-gray-600">
                      Time
                      <input
                        type="time"
                        value={item.time || '09:00'}
                        onChange={(e) => updateActivity(item.id, { time: e.target.value })}
                        className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={saveDailyPlan}
          className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
        >
          <Save className="h-5 w-5" />
          Save Daily Plan
        </button>
      </div>
    </div>
  );
}




