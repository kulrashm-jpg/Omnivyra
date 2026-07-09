/** Part 1/2 of DailyPlanView.tsx — verbatim split (barrel preserved; importers unchanged). */
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

export const getRetentionBadge = (item?: DailyExecutionItem): string | null => {
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

export const hasMasterGenerated = (item?: DailyExecutionItem): boolean => {
  return Boolean(item?.master_content && item.master_content.generation_status === 'generated');
};

export const hasAiGeneratedMasterContent = (item?: DailyExecutionItem): boolean => {
  const content = String(item?.master_content?.content || '').trim();
  if (!item?.master_content || item.master_content.generation_status !== 'generated') return false;
  if (!content) return false;
  if (content.includes('[MASTER CONTENT PLACEHOLDER]')) return false;
  if (content.includes('[MEDIA BLUEPRINT]')) return false;
  if (content.includes('[MASTER GENERATION FAILED')) return false;
  return true;
};

export const hasVariantsReady = (item?: DailyExecutionItem): boolean => {
  const variants = Array.isArray(item?.platform_variants) ? item?.platform_variants : [];
  if (variants.length === 0) return false;
  return variants.every((variant) => variant.generation_status === 'generated');
};

export const hasAiAdaptedVariant = (item?: DailyExecutionItem): boolean => {
  const variants = Array.isArray(item?.platform_variants) ? item?.platform_variants : [];
  return variants.some((variant) => variant.adapted_from_master === true);
};

export const hasDiscoverabilityOptimization = (item?: DailyExecutionItem): boolean => {
  const variants = Array.isArray(item?.platform_variants) ? item?.platform_variants : [];
  return variants.some((variant) => Boolean(variant?.discoverability_meta?.optimized));
};

export const hasAlgorithmicFormattingOptimization = (item?: DailyExecutionItem): boolean => {
  const variants = Array.isArray(item?.platform_variants) ? item?.platform_variants : [];
  return variants.some((variant) => Boolean(variant?.algorithmic_formatting_meta?.formatting_applied));
};

export const hasMediaSearchSuggestions = (item?: DailyExecutionItem): boolean => {
  const variants = Array.isArray(item?.platform_variants) ? item?.platform_variants : [];
  return variants.some((variant) => (variant?.media_search_intent?.media_requirements?.length || 0) > 0);
};

export const getMediaStatusBadge = (item?: DailyExecutionItem): string | null => {
  if (!item) return null;
  if (item.media_status === 'ready') return '🎞 Media Ready';
  if (item.media_status === 'missing') return '🎥 Media Required';
  return null;
};

export const getExecutionReadinessBadge = (
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

export const getExecutionJobPills = (item?: DailyExecutionItem): string[] => {
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

export const hasSchedulableExecutionJob = (item?: DailyExecutionItem): boolean => {
  const jobs = Array.isArray(item?.execution_jobs) ? item!.execution_jobs! : [];
  return jobs.some((job) => job.status === 'ready');
};

export const countStrategicFactors = (activities: DailyActivity[]): number => {
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

import type { useDailyPlanning } from '../hooks/useDailyPlanning';
