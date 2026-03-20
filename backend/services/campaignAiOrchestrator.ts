import { supabase } from '../db/supabaseClient';
import { generateCampaignPlan } from './aiGateway';
import { generateCampaignPlanAI } from './aiPlanningService';
import { computeCampaignPlanningQAState } from '../chatGovernance';
import { assessVirality } from './viralityAdvisorService';
import { buildCampaignSnapshotWithHash, canonicalJsonStringify } from './viralitySnapshotBuilder';
import { DecisionResult } from './omnivyreClient';
import { parseAiRefinedDay, parseAiPlatformCustomization } from './campaignPlanParser';
import { parseAndValidateCampaignPlan } from './campaignPlanCore';
import { getPlatformStrategies } from './externalApiService';
import { saveStructuredCampaignPlan, saveStructuredCampaignPlanDayUpdate, savePlatformCustomizedContent } from '../db/campaignPlanStore';
import { evaluateAndPersistCampaignHealth } from '../jobs/campaignHealthEvaluationJob';
import { getLatestCampaignVersionByCampaignId } from '../db/campaignVersionStore';
import { getCampaignById } from '../db/campaignStore';
import { getLatestSnapshotsPerPlatform } from '../db/platformMetricsSnapshotStore';
import { getProfile } from './companyProfileService';
import { getAvailablePlatformsFromProfile } from '../utils/platformEligibility';
import { buildDeterministicWeeklySkeleton, DeterministicWeeklySkeletonError } from './deterministicWeeklySkeleton';
import { mapStrategyToSkeleton, type MappedWeeklySkeleton } from './strategyMapper';
import { validateCampaignPlan, type CampaignValidation } from '../lib/validation/campaignValidator';
import { generatePaidRecommendation, type PaidRecommendation } from '../lib/ads/paidAmplificationEngine';
import {
  validateCapacityAndFrequency,
  type CapacityValidationResult,
} from './capacityFrequencyValidationGateway';
import { validateWeeklyNarrativeFlow } from './weeklyNarrativeValidator';
import { balanceWeeklyExecutionLoad } from './weeklyLoadBalancer';
import { runExecutionPressureBalancer } from './executionPressureBalancer';
import { analyzeExecutionMomentum } from './executionMomentumTracker';
import { generateMomentumRecoverySuggestions } from './momentumRecoveryAdvisor';
import { refineLanguageOutput } from './languageRefinementService';
import {
  buildCompanyContext,
  buildForcedCompanyContext,
  formatForcedContextForPrompt,
} from './companyContextService';
import { buildCompanyStrategyDNA } from './companyStrategyDNAService';
import { getPrimaryCampaignType, BACKWARD_COMPAT_DEFAULTS } from './campaignContextConfig';
import { computeExpectedBaseline, classifyBaseline } from './baselineClassificationService';
import { attachGenerationPipelineToDailyItems } from './contentGenerationPipeline';
import { runAutopilotForPlan } from './autopilotExecutionPipeline';
import {
  determineDistributionStrategy,
  type DistributionStrategy,
} from './planningIntelligenceService';
import { adjustCampaignMomentum, recoverNarrativeMomentum } from './momentumAdjustmentService';
import { inferExecutionMode, type ExecutionMode, isExecutionMode } from './executionModeInference';
import { buildCreatorInstruction } from './buildCreatorInstruction';
import { assignWeeklySchedule } from './weeklyScheduleAllocator';
import { getEnrichedDistributionInsights } from './contentDistributionIntelligence';
import { getWeeklyStrategyIntelligence } from './weeklyStrategyIntelligenceService';
import { computeStrategyBias } from './strategyBiasService';
import { generatePerformanceInsights } from './performanceInsightGenerator';
import { refreshAccountContext } from './accountContextRefreshService';
import { getStrategyMemory } from './campaignStrategyMemoryService';
import { getCachedStrategyProfile } from './strategyProfileCache';
import { normalizeStrategyContext } from './strategyContextService';
import {
  buildCampaignContext,
  setCampaignContext,
  formatStrategyProfileForPrompt,
  type CampaignContext,
} from './contextCompressionService';
import type { StrategyProfile } from './campaignStrategyLearner';
import {
  GATHER_ORDER,
  REQUIRED_EXECUTION_FIELDS,
  ARCHIVED_GATHER_ITEMS,
} from '../constants/campaignPlanningGatherOrder';

export type CampaignAiMode = 'generate_plan' | 'refine_day' | 'platform_customize';

export interface RecommendationContext {
  target_regions?: string[] | null;
  context_payload?: Record<string, unknown> | null;
  source_opportunity_id?: string | null;
}

export interface ConversationMessage {
  type: 'user' | 'ai';
  message: string;
}

export interface OptimizationContext {
  roiScore: number;
  headlines: string[];
}

export interface CampaignAiPlanInput {
  campaignId: string;
  mode: CampaignAiMode;
  message: string;
  durationWeeks?: number;
  targetDay?: string;
  platforms?: string[];
  conversationHistory?: ConversationMessage[];
  recommendationContext?: RecommendationContext | null;
  /** Stage 35: ROI + optimization headlines for AI context injection */
  optimizationContext?: OptimizationContext | null;
  /** When refining an existing plan, pass the current plan so AI can apply changes */
  currentPlan?: { weeks: any[] };
  /** Scope to specific weeks (1-based) — only modify these weeks; null/empty = all weeks */
  scopeWeeks?: number[] | null;
  /** Chat context (e.g. campaign-recommendations) for consultation-style flows */
  chatContext?: string;
  /** Pre-selected weeks and areas when opening from recommendations page */
  vetScope?: { selectedWeeks: number[]; areasByWeek?: Record<number, string[]> };
  /** Client-collected planning context (form state, pre-planning result) — merged with prefilled to avoid re-asking */
  collectedPlanningContext?: Record<string, unknown>;
  /** Optional one-click orchestration: generation + adaptation + scheduling */
  autopilot?: boolean;
  /** For bolt pipeline observability: correlate AI calls to bolt_execution_runs */
  bolt_run_id?: string | null;
  /** Account context for planning influence (maturity, performance, recommendations) */
  account_context?: import('./../types/accountContext').AccountContext | null;
  /** Performance learnings from a previous campaign — fed forward into the AI prompt so each campaign improves on the last. */
  previous_performance_insights?: import('./../lib/performance/performanceAnalyzer').PerformanceInsight | null;
  /**
   * Full context record from the most recent completed campaign.
   * Richer than previous_performance_insights alone — includes validation + paid decision + execution results.
   */
  previous_campaign_context?: {
    validation?: import('./../lib/validation/campaignValidator').CampaignValidation | null;
    paid_recommendation?: import('./../lib/ads/paidAmplificationEngine').PaidRecommendation | null;
    performance_insights?: import('./../lib/performance/performanceAnalyzer').PerformanceInsight | null;
    captured_at?: string | null;
  } | null;
}

export interface CampaignAiPlanResult {
  mode: CampaignAiMode;
  snapshot_hash: string;
  omnivyre_decision: DecisionResult;
  validation_result?: CapacityValidationResult | null;
  plan?: {
    weeks: Array<{
      week: number;
      theme: string;
      daily: Array<{
        day: string;
        objective: string;
        content: string;
        platforms: Record<string, string>;
        hashtags?: string[];
        seo_keywords?: string[];
        meta_title?: string;
        meta_description?: string;
        hook?: string;
        cta?: string;
        best_time?: string;
        effort_score?: number;
        success_projection?: number;
      }>;
    }>;
  };
  day?: {
    week: number;
    day: string;
    objective: string;
    content: string;
    platforms: Record<string, string>;
    hashtags?: string[];
    seo_keywords?: string[];
    meta_title?: string;
    meta_description?: string;
    hook?: string;
    cta?: string;
    best_time?: string;
    effort_score?: number;
    success_projection?: number;
  };
  platform_content?: {
    day: string;
    platforms: Record<string, string>;
  };
  conversationalResponse?: string;
  raw_plan_text: string;
  /** Deterministic plan quality gate: confidence score, risk, outcomes, issues, suggestions. */
  campaign_validation?: CampaignValidation | null;
  /** Deterministic paid amplification decision: should we run ads, when, how much, why. */
  paid_recommendation?: PaidRecommendation | null;
  autopilot_result?: {
    total_items: number;
    generated_masters: number;
    generated_variants: number;
    scheduled_items: number;
    skipped_locked: number;
    skipped_missing_media: number;
  };
}

type DeliverableType = 'post' | 'video' | 'blog' | 'carousel' | 'story' | 'thread' | 'short';
type PlanDeliverables = {
  videos: number;
  posts: number;
  blogs: number;
  stories?: number;
};
type PlanSkeleton = {
  durationWeeks: number;
  weeklySlots: Array<{
    weekNumber: number;
    requiredDeliverables: PlanDeliverables;
  }>;
};

type AlignmentSuggestion = {
  weekNumber: number;
  suggestion: string;
};

type AlignmentEvaluation = {
  alignmentScore: number;
  progressionScore: number;
  diversityScore: number;
  platformAlignmentScore: number;
  psychologicalFitScore: number;
  issues: string[];
  suggestedAdjustments: AlignmentSuggestion[];
  parseFailed?: boolean;
};

const ALIGNMENT_ACCEPT_THRESHOLD = 70;

type WeeklyAlignmentProfile = {
  score: number;
  progressionWeak: boolean;
  diversityWeak: boolean;
  platformWeak: boolean;
  psychologicalWeak: boolean;
};

export type StructuredCapacityCounts = {
  post: number;
  video: number;
  blog: number;
  story: number;
  thread: number;
};

export type StructuredCapacityBreakdown = Record<string, number>;
export type StructuredCapacityCountsWithBreakdown = StructuredCapacityCounts & {
  breakdown?: StructuredCapacityBreakdown;
  /** True when the user explicitly said "none/no/zero" for this question. */
  _declared_none?: boolean;
};

const EMPTY_CAPACITY_COUNTS: StructuredCapacityCounts = {
  post: 0,
  video: 0,
  blog: 0,
  story: 0,
  thread: 0,
};

function clampInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/** Parse Trend page frequency string (e.g. "1/w", "5/w", "Daily") to posts per week. */
function parseFrequencyPerWeek(s: string): number {
  const t = String(s || '').trim().toLowerCase();
  const m = t.match(/^(\d+)\s*\/?\s*w/);
  if (m) return clampInt(parseInt(m[1] || '0', 10));
  if (/^daily$/i.test(t) || /^daily\b/.test(t)) return 5; // ~5 weekdays
  const n = parseInt(t, 10);
  if (Number.isFinite(n) && n >= 0) return clampInt(n);
  return 0;
}

function parseCountsFromText(text: string): StructuredCapacityCounts {
  const t = String(text || '').toLowerCase();
  const out: StructuredCapacityCounts = { ...EMPTY_CAPACITY_COUNTS };
  const isNo =
    /\b(no|none|zero|don'?t have|do not have|not yet|n\/a)\b/.test(t) && !/\b\d+\b/.test(t);
  if (isNo) return out;

  const addMatches = (re: RegExp, key: keyof StructuredCapacityCounts) => {
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(t)) !== null) {
      const n = clampInt(parseInt(m[1] || '0', 10));
      if (n > 0) out[key] += n;
    }
  };

  addMatches(/\b(\d{1,3})\s*(?:posts?|feed\s*posts?)\b/g, 'post');
  addMatches(/\b(\d{1,3})\s*videos?\b/g, 'video');
  addMatches(/\b(\d{1,3})\s*(?:blogs?|articles?)\b/g, 'blog');
  addMatches(/\b(\d{1,3})\s*white\s*papers?\b/g, 'blog');
  addMatches(/\b(\d{1,3})\s*stories?\b/g, 'story');
  addMatches(/\b(\d{1,3})\s*threads?\b/g, 'thread');

  return out;
}

function parseCountsWithBreakdownFromText(text: string): { counts: StructuredCapacityCounts; breakdown: StructuredCapacityBreakdown } {
  const t = String(text || '').toLowerCase();
  const breakdown: StructuredCapacityBreakdown = {};
  const counts: StructuredCapacityCounts = parseCountsFromText(text);

  const addBreakdown = (key: string, n: number) => {
    const k = String(key || '').trim().toLowerCase();
    if (!k) return;
    const v = clampInt(n);
    if (v <= 0) return;
    breakdown[k] = (breakdown[k] ?? 0) + v;
  };

  const addMatchesBreakdown = (re: RegExp, breakdownKey: string, rollup: keyof StructuredCapacityCounts) => {
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(t)) !== null) {
      const n = clampInt(parseInt(m[1] || '0', 10));
      if (n <= 0) continue;
      addBreakdown(breakdownKey, n);
      counts[rollup] += n;
    }
  };
  const addMatchesBreakdownOnly = (re: RegExp, breakdownKey: string) => {
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(t)) !== null) {
      const n = clampInt(parseInt(m[1] || '0', 10));
      if (n <= 0) continue;
      addBreakdown(breakdownKey, n);
    }
  };

  // Standalone terms
  addMatchesBreakdown(/\b(\d{1,3})\s*reels?\b/g, 'reels', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*shorts?\b/g, 'shorts', 'video');
  // Only match explicit long-form mentions like "2 long videos" (do NOT match plain "2 videos").
  addMatchesBreakdown(/\b(\d{1,3})\s*(?:long[-\s]?form|long)\s*videos?\b/g, 'long_videos', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*carousels?\b/g, 'carousels', 'post');
  addMatchesBreakdown(/\b(\d{1,3})\s*images?\b/g, 'images', 'post');
  addMatchesBreakdownOnly(/\b(\d{1,3})\s*white\s*papers?\b/g, 'white_papers');
  addMatchesBreakdown(/\b(\d{1,3})\s*lives?\b/g, 'lives', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*spaces?\b/g, 'spaces', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*(?:songs?|audio)\b/g, 'audio', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*podcasts?\b/g, 'podcasts', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*newsletters?\b/g, 'newsletters', 'blog');
  addMatchesBreakdown(/\b(\d{1,3})\s*webinars?\b/g, 'webinars', 'blog');
  addMatchesBreakdown(/\b(\d{1,3})\s*(?:slides?|slideware)\b/g, 'slides', 'blog');

  // Tagged variants emitted by UI like: "2 videos/week (reels)"
  const tagToKey = (tag: string): string | null => {
    const n = String(tag || '').toLowerCase();
    if (n.includes('reel')) return 'reels';
    if (n.includes('short')) return 'shorts';
    if (n.includes('long')) return 'long_videos';
    if (n.includes('carousel')) return 'carousels';
    if (n.includes('image')) return 'images';
    if (n.includes('live')) return 'lives';
    if (n.includes('space')) return 'spaces';
    if (n.includes('podcast')) return 'podcasts';
    if (n.includes('audio') || n.includes('song')) return 'audio';
    if (n.includes('newsletter')) return 'newsletters';
    if (n.includes('webinar')) return 'webinars';
    if (n.includes('slide')) return 'slides';
    if (n.includes('article')) return 'articles';
    if (n.includes('white')) return 'white_papers';
    return null;
  };
  const taggedVideo = /\b(\d{1,3})\s*videos?(?:\s*\/\s*week)?\s*\(([^)]+)\)/g;
  let m: RegExpExecArray | null = null;
  while ((m = taggedVideo.exec(t)) !== null) {
    const n = clampInt(parseInt(m[1] || '0', 10));
    const key = tagToKey(String(m[2] || ''));
    if (n > 0 && key) addBreakdown(key, n);
  }
  const taggedPost = /\b(\d{1,3})\s*(?:posts?|feed\s*posts?)(?:\s*\/\s*week)?\s*\(([^)]+)\)/g;
  while ((m = taggedPost.exec(t)) !== null) {
    const n = clampInt(parseInt(m[1] || '0', 10));
    const key = tagToKey(String(m[2] || ''));
    if (n > 0 && key) addBreakdown(key, n);
  }
  const taggedBlog = /\b(\d{1,3})\s*(?:blogs?|articles?)(?:\s*\/\s*week)?\s*\(([^)]+)\)/g;
  while ((m = taggedBlog.exec(t)) !== null) {
    const n = clampInt(parseInt(m[1] || '0', 10));
    const key = tagToKey(String(m[2] || ''));
    if (n > 0 && key) addBreakdown(key, n);
  }

  return { counts, breakdown };
}

export function normalizeCapacityCountsWithBreakdown(value: unknown): StructuredCapacityCountsWithBreakdown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const counts = normalizeCapacityCounts(obj);
    const breakdownRaw = obj.breakdown && typeof obj.breakdown === 'object' && !Array.isArray(obj.breakdown)
      ? (obj.breakdown as Record<string, unknown>)
      : null;
    const breakdown: StructuredCapacityBreakdown = {};
    if (breakdownRaw) {
      for (const [k, v] of Object.entries(breakdownRaw)) {
        const n = clampInt(typeof v === 'number' ? v : Number(v));
        if (n > 0) breakdown[String(k).toLowerCase()] = n;
      }
    }
    const declaredNone = Boolean((obj as any)._declared_none || (obj as any).declared_none || (obj as any).declaredNone);
    const withMeta = declaredNone ? ({ ...counts, _declared_none: true } as StructuredCapacityCountsWithBreakdown) : counts;
    return Object.keys(breakdown).length > 0
      ? ({ ...withMeta, breakdown } as StructuredCapacityCountsWithBreakdown)
      : (withMeta as StructuredCapacityCountsWithBreakdown);
  }
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    const isNo =
      /\b(no|none|zero|don'?t have|do not have|no content|not yet|n\/a)\b/.test(t) &&
      !/\b\d+\b/.test(t) &&
      !/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\b/i.test(value);
    const parsed = parseCountsWithBreakdownFromText(value);
    const base: StructuredCapacityCountsWithBreakdown = isNo
      ? ({ ...parsed.counts, _declared_none: true } as StructuredCapacityCountsWithBreakdown)
      : (parsed.counts as StructuredCapacityCountsWithBreakdown);
    return Object.keys(parsed.breakdown).length > 0
      ? ({ ...base, breakdown: parsed.breakdown } as StructuredCapacityCountsWithBreakdown)
      : base;
  }
  return { ...EMPTY_CAPACITY_COUNTS };
}

/** Planning UI labels (from content capacity form) map to internal capacity keys. */
const PLANNING_LABEL_TO_KEY: Record<string, keyof StructuredCapacityCounts> = {
  Posts: 'post',
  'Text posts': 'post',
  'Text post': 'post',
  Post: 'post',
  posts: 'post',
  Videos: 'video',
  Video: 'video',
  'Long Videos': 'video',
  Reels: 'video',
  Shorts: 'video',
  Songs: 'video',
  Audio: 'video',
  Podcasts: 'video',
  Spaces: 'video',
  Carousels: 'post',
  Images: 'post',
  Image: 'post',
  Blogs: 'blog',
  Blog: 'blog',
  Articles: 'blog',
  Article: 'blog',
  'White Papers': 'blog',
  Newsletters: 'blog',
  Webinars: 'blog',
  Slides: 'blog',
  Slideware: 'blog',
  Stories: 'story',
  Story: 'story',
  Threads: 'thread',
  Thread: 'thread',
};

export function normalizeCapacityCounts(value: unknown): StructuredCapacityCounts {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const out: StructuredCapacityCounts = { ...EMPTY_CAPACITY_COUNTS };
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'breakdown' || k === '_declared_none' || k === 'declared_none' || k === 'declaredNone') continue;
      const n = clampInt(typeof v === 'number' ? v : Number(v));
      if (n <= 0) continue;
      const key = PLANNING_LABEL_TO_KEY[k] ?? (k.toLowerCase() as keyof StructuredCapacityCounts);
      if (key && key in out) {
        out[key] += n;
      } else if (['post', 'video', 'blog', 'story', 'thread'].includes(String(k).toLowerCase())) {
        out[k.toLowerCase() as keyof StructuredCapacityCounts] += n;
      } else {
        out.post += n;
      }
    }
    return out;
  }
  if (typeof value === 'string') return parseCountsFromText(value);
  return { ...EMPTY_CAPACITY_COUNTS };
}

function toValidWeeks(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.floor(value);
    return n >= 1 && n <= 52 ? n : null;
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = text.match(/\b(\d{1,2})\s*(?:week|weeks)\b/i) ?? text.match(/\b(\d{1,2})\b/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 1 && n <= 52 ? n : null;
}

/** Returns next Monday in YYYY-MM-DD (or today if already Monday). Used when skipping tentative_start for Trend execution config. */
function getNextMondayISO(): string {
  const d = new Date();
  const dow = d.getUTCDay();
  const daysToAdd = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
  const target = new Date(d);
  target.setUTCDate(d.getUTCDate() + daysToAdd);
  return target.toISOString().slice(0, 10);
}

function recommendationDurationSeed(ctx: RecommendationContext | null | undefined): number | null {
  const payload = (ctx?.context_payload ?? {}) as Record<string, unknown>;
  return (
    toValidWeeks(payload.duration_weeks) ??
    toValidWeeks(payload.campaign_duration) ??
    toValidWeeks(payload.recommended_duration_weeks)
  );
}

/** Detect which gather key an AI question is asking for (must stay in sync with CampaignPlanningQAState.detectAskedKey). */
function detectAskedKeyFromAiMessage(aiMessage: string): string | null {
  const n = String(aiMessage ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!n) return null;
  if (n.includes('target audience') || n.includes('who will see your content')) return 'target_audience';
  if ((n.includes('which professionals') && n.includes('mainly speaking')) || n.includes('which group fits')) return 'audience_professional_segment';
  if (n.includes('how do you want your content to sound') || n.includes('how should your posts sound')) return 'communication_style';
  if ((n.includes('after reading your content') && n.includes('what should people do')) || n.includes('what do you want people to do after')) return 'action_expectation';
  if (
    n.includes('same content across all platforms') ||
    (n.includes('shared') && n.includes('unique')) ||
    n.includes('unique content for each platform') ||
    (n.includes('shared') && n.includes('platform')) ||
    (n.includes('unique') && n.includes('platform'))
  )
    return 'cross_platform_sharing';
  if (n.includes('short easy reads') || (n.includes('detailed insights') && n.includes('short')) || n.includes('short reads or longer') || n.includes('longer pieces')) return 'content_depth';
  if (n.includes('connected series') && n.includes('mostly independent')) return 'topic_continuity';
  if (n.includes('ongoing story') || n.includes('different topics each time')) return 'topic_continuity';
  if (n.includes('existing content') || n.includes('do you have any existing content')) return 'available_content';
  if (n.includes('which category') || n.includes('which specific week') || n.includes('should it serve')) return 'available_content_allocation';
  if ((n.includes('start') && n.includes('campaign')) || n.includes('yy-mm-dd') || (n.includes('start') && n.includes('date')) || n.includes('when do you want to start')) return 'tentative_start';
  if (n.includes('campaign types') || n.includes("what's the main goal")) return 'campaign_types';
  if (
    n.includes('produce per week') ||
    n.includes('produce each week') ||
    n.includes('production capacity') ||
    n.includes('weekly production capacity') ||
    n.includes('content capacity') ||
    n.includes('how much content') ||
    n.includes('how will you create') ||
    n.includes('how many pieces per week') ||
    (n.includes('how many') && n.includes('per week') && (n.includes('posts') || n.includes('videos') || n.includes('blogs'))) ||
    n.includes('how many can you create per week') ||
    n.includes('how many can you and your team create every week')
  )
    return 'content_capacity';
  if (
    (n.includes('duration') && n.includes('campaign')) ||
    (n.includes('how many') && n.includes('week')) ||
    n.includes('campaign run') ||
    n.includes('duration') ||
    n.includes('how many weeks') ||
    /2[, ]*4[, ]*6[, ]*8[, ]*12\s*weeks/i.test(n)
  )
    return 'campaign_duration';
  if (n.includes('which platforms') || n.includes('platforms will you focus') || n.includes('where will you post')) return 'platforms';
  if (n.includes('platform-exclusive campaigns') || n.includes('only for one platform') || n.includes('anything only for one platform')) return 'exclusive_campaigns';
  if (n.includes('content types') && n.includes('count per week')) return 'platform_content_requests';
  if (n.includes('how many of each type per week')) return 'platform_content_requests';
  if (n.includes('set how often') || n.includes('same topic across platforms') || n.includes('publish same day on all platforms') || n.includes('let AI decide')) return 'platform_content_requests';
  if (n.includes('content types') && n.includes('platform')) return 'platform_content_types';
  if (n.includes('what will you post on each') || n.includes('which content types will you use') || n.includes('for each platform you selected')) return 'platform_content_types';
  if (n.includes('key messages') || n.includes('pain points') || n.includes('one thing you want people to remember') || n.includes('core message') || n.includes('audience to remember')) return 'key_messages';
  if (n.includes('success metrics') || (n.includes('metrics') && n.includes('track')) || n.includes('like to see improve')) return 'success_metrics';
  return null;
}

/** Extract planning context from conversation so we never re-ask already-answered questions. */
function extractPlanningContextFromHistory(
  conversationHistory: Array<{ type: string; message: string }>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const history = Array.isArray(conversationHistory) ? conversationHistory : [];
  const pairs: Array<{ ai: string; user: string }> = [];
  for (let i = 0; i < history.length - 1; i += 1) {
    const curr = history[i];
    const next = history[i + 1];
    if (curr?.type === 'ai' && next?.type === 'user') {
      pairs.push({ ai: String(curr?.message ?? ''), user: String(next?.message ?? '').trim() });
    }
  }
  for (const pair of pairs) {
    const key = detectAskedKeyFromAiMessage(pair.ai);
    if (!key || !pair.user) continue;
    out[key] = pair.user;
  }
  return out;
}

function mapRecommendationContextToGatherKeys(
  recommendationContext: RecommendationContext | null | undefined
): Record<string, unknown> {
  const payload = (recommendationContext?.context_payload ?? {}) as Record<string, unknown>;
  const mapped: Record<string, unknown> = {};

  const audience =
    payload.target_audience ??
    payload.audience ??
    payload.ideal_customer_profile ??
    payload.icp;
  if (typeof audience === 'string' && audience.trim()) {
    mapped.target_audience = audience.trim();
  }

  const keyMessages =
    payload.key_messages ??
    payload.problem ??
    payload.problem_statement ??
    payload.angle ??
    payload.transformation ??
    payload.positioning;
  if (typeof keyMessages === 'string' && keyMessages.trim()) {
    mapped.key_messages = keyMessages.trim();
  }

  const suggestedPlatforms = payload.platforms;
  if (Array.isArray(suggestedPlatforms) && suggestedPlatforms.length > 0) {
    mapped.platforms = suggestedPlatforms.map((p) => String(p).trim()).filter(Boolean).join(', ');
  }

  // Strategic theme card (from Build Campaign Blueprint): feed themes, progression, duration into prefilledPlanning so week plan aligns
  const strategicThemes = payload.strategic_themes ?? payload.themes;
  if (Array.isArray(strategicThemes) && strategicThemes.length > 0) {
    mapped.strategic_themes = strategicThemes.map((t) => String(t ?? '').trim()).filter(Boolean);
  }
  const progressionSummary = payload.progression_summary ?? payload.progressionSummary;
  if (typeof progressionSummary === 'string' && progressionSummary.trim()) {
    mapped.strategic_theme_progression = progressionSummary.trim();
  }
  const themeDurationWeeks = payload.duration_weeks ?? payload.durationWeeks;
  if (typeof themeDurationWeeks === 'number' && Number.isFinite(themeDurationWeeks)) {
    mapped.strategic_theme_duration_weeks = themeDurationWeeks;
  }
  const themeIntelligence = payload.intelligence ?? payload.recommendation_intelligence;
  if (themeIntelligence && typeof themeIntelligence === 'object' && !Array.isArray(themeIntelligence)) {
    mapped.strategic_theme_intelligence = themeIntelligence;
  }

  return mapped;
}

function normalizeDeliverableType(raw: string): DeliverableType | null {
  const n = raw.toLowerCase().trim();
  if (!n) return null;
  if (/(^|\b)(video|videos|reel|reels)(\b|$)/.test(n)) return 'video';
  if (/(^|\b)(blog|blogs|article|articles|white\s*papers?|white_papers?)(\b|$)/.test(n)) return 'blog';
  if (/(^|\b)(carousel|carousels)(\b|$)/.test(n)) return 'carousel';
  if (/(^|\b)(story|stories)(\b|$)/.test(n)) return 'story';
  if (/(^|\b)(thread|threads)(\b|$)/.test(n)) return 'thread';
  if (/(^|\b)(short|shorts)(\b|$)/.test(n)) return 'short';
  if (/(^|\b)(post|posts)(\b|$)/.test(n)) return 'post';
  return null;
}

function parseContentCapacityToDeliverables(contentCapacity: unknown): PlanDeliverables {
  const emptyDeliverables: PlanDeliverables = { videos: 0, posts: 0, blogs: 0, stories: 0 };
  const text = String(contentCapacity ?? '').trim();
  if (!text) {
    return { videos: 2, posts: 5, blogs: 1, stories: 0 };
  }

  const counters = new Map<DeliverableType, number>();
  const patterns: RegExp[] = [
    /([a-zA-Z_ ]+)\s*:\s*(\d{1,2})\s*\/\s*week/gi,
    /(\d{1,2})\s*([a-zA-Z_ ]+?)(?:\s*\/\s*week|\s+per\s+week|\b)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(text)) !== null) {
      const a = match[1] ?? '';
      const b = match[2] ?? '';
      const maybeCount = Number(a);
      const count = Number.isFinite(maybeCount) ? maybeCount : Number(b);
      const label = Number.isFinite(maybeCount) ? b : a;
      const type = normalizeDeliverableType(label);
      if (!type || !Number.isFinite(count) || count <= 0) continue;
      counters.set(type, (counters.get(type) ?? 0) + count);
    }
  }

  if (counters.size === 0) {
    return { videos: 2, posts: 5, blogs: 1, stories: 0 };
  }
  const out = { ...emptyDeliverables };
  out.videos = counters.get('video') ?? 0;
  out.posts = counters.get('post') ?? 0;
  out.blogs = counters.get('blog') ?? 0;
  out.stories = counters.get('story') ?? 0;
  return out;
}

function buildDeterministicPlanSkeleton(params: {
  durationWeeks: number;
  contentCapacity?: unknown;
}): PlanSkeleton {
  const requiredDeliverables = parseContentCapacityToDeliverables(params.contentCapacity);
  const weeklySlots = Array.from({ length: params.durationWeeks }, (_, idx) => ({
    weekNumber: idx + 1,
    requiredDeliverables,
  }));
  return {
    durationWeeks: params.durationWeeks,
    weeklySlots,
  };
}

function sumSkeletonDeliverables(deliverables: PlanDeliverables): number {
  return (
    (Number(deliverables.videos) || 0) +
    (Number(deliverables.posts) || 0) +
    (Number(deliverables.blogs) || 0) +
    (Number(deliverables.stories) || 0)
  );
}

function deliverablesToArray(deliverables: PlanDeliverables): Array<{ type: DeliverableType; count: number }> {
  const arr: Array<{ type: DeliverableType; count: number }> = [];
  if ((deliverables.videos ?? 0) > 0) arr.push({ type: 'video', count: deliverables.videos });
  if ((deliverables.posts ?? 0) > 0) arr.push({ type: 'post', count: deliverables.posts });
  if ((deliverables.blogs ?? 0) > 0) arr.push({ type: 'blog', count: deliverables.blogs });
  if ((deliverables.stories ?? 0) > 0) arr.push({ type: 'story', count: deliverables.stories ?? 0 });
  return arr;
}

function normalizeDeliverableCountsBySkeletonTypes(counts: Record<string, number>): PlanDeliverables {
  return {
    videos: counts.video ?? 0,
    posts: counts.post ?? 0,
    blogs: counts.blog ?? 0,
    stories: counts.story ?? 0,
  };
}

function hasMatchingDeliverables(actual: PlanDeliverables, expected: PlanDeliverables): boolean {
  return (
    (actual.videos ?? 0) === (expected.videos ?? 0) &&
    (actual.posts ?? 0) === (expected.posts ?? 0) &&
    (actual.blogs ?? 0) === (expected.blogs ?? 0) &&
    (actual.stories ?? 0) === (expected.stories ?? 0)
  );
}

function extractWeekDeliverableCounts(week: any): Record<string, number> {
  const out: Record<string, number> = {};
  const breakdown = week?.platform_content_breakdown as Record<string, Array<{ type?: string; count?: number }>> | undefined;
  if (breakdown && typeof breakdown === 'object') {
    Object.values(breakdown).forEach((items) => {
      if (!Array.isArray(items)) return;
      items.forEach((item) => {
        const type = normalizeDeliverableType(String(item?.type ?? ''));
        const count = Number(item?.count ?? 0);
        if (!type || !Number.isFinite(count) || count <= 0) return;
        out[type] = (out[type] ?? 0) + count;
      });
    });
  }
  return out;
}

function validatePlanAgainstSkeleton(plan: { weeks: any[] }, skeleton: PlanSkeleton): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!Array.isArray(plan?.weeks)) {
    return { ok: false, reasons: ['Plan has no weeks array'] };
  }

  if (plan.weeks.length !== skeleton.durationWeeks) {
    reasons.push(`Expected ${skeleton.durationWeeks} weeks, got ${plan.weeks.length}`);
  }

  const weekNumbers = new Set(plan.weeks.map((w) => Number(w?.week)));
  for (let i = 1; i <= skeleton.durationWeeks; i++) {
    if (!weekNumbers.has(i)) reasons.push(`Missing week ${i}`);
  }

  const slotByWeek = new Map(skeleton.weeklySlots.map((s) => [s.weekNumber, s]));
  for (const week of plan.weeks) {
    const weekNo = Number(week?.week);
    const slot = slotByWeek.get(weekNo);
    if (!slot) {
      reasons.push(`Unexpected week ${weekNo}`);
      continue;
    }
    const expectedTotal = sumSkeletonDeliverables(slot.requiredDeliverables);
    const actualTotal = Number(week?.total_weekly_content_count ?? 0);
    if (actualTotal !== expectedTotal) {
      reasons.push(`Week ${weekNo}: expected total ${expectedTotal}, got ${actualTotal}`);
    }

    const actualByType = normalizeDeliverableCountsBySkeletonTypes(extractWeekDeliverableCounts(week));
    if ((week?.primary_objective ?? '').toString().trim().length === 0) {
      reasons.push(`Week ${weekNo}: missing objective`);
    }
    if ((week?.theme ?? '').toString().trim().length === 0) {
      reasons.push(`Week ${weekNo}: missing topic focus`);
    }
    if (!week?.platform_allocation || typeof week.platform_allocation !== 'object' || Object.keys(week.platform_allocation).length === 0) {
      reasons.push(`Week ${weekNo}: missing platform hints`);
    }
    if (week?.platform_content_breakdown && typeof week.platform_content_breakdown === 'object') {
      if (!hasMatchingDeliverables(actualByType, slot.requiredDeliverables)) {
        reasons.push(
          `Week ${weekNo}: deliverables mismatch expected=${JSON.stringify(slot.requiredDeliverables)} actual=${JSON.stringify(actualByType)}`
        );
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}

function buildPlaceholderPlanFromSkeleton(params: {
  skeleton: PlanSkeleton;
  prefilledPlanning?: Record<string, unknown> | null;
}): { weeks: any[] } {
  const platformHints =
    String(params.prefilledPlanning?.platforms ?? '')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean) || [];

  const normalizeList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  };
  const recommendedTopics = normalizeList(params.prefilledPlanning?.recommended_topics);
  const strategicThemes = normalizeList(params.prefilledPlanning?.strategic_themes);
  const keyMessages = String(params.prefilledPlanning?.key_messages ?? '').trim();
  const audience = String(params.prefilledPlanning?.target_audience ?? '').trim();
  const campaignTypes = String(params.prefilledPlanning?.campaign_types ?? '').trim();
  const primaryIntent = campaignTypes || 'campaign objective';
  const fallbackThemeSeed =
    strategicThemes[0] ||
    recommendedTopics[0] ||
    String(params.prefilledPlanning?.theme_or_description ?? '').trim() ||
    (keyMessages ? `Address ${keyMessages}` : '');

  const buildWeekTopicSet = (weekNo: number): string[] => {
    const pickedTopic = recommendedTopics[(weekNo - 1) % Math.max(1, recommendedTopics.length)] || '';
    const pickedTheme = strategicThemes[(weekNo - 1) % Math.max(1, strategicThemes.length)] || '';
    const seed = pickedTopic || pickedTheme || fallbackThemeSeed || `Week ${weekNo} focus`;
    const topics = [
      seed,
      keyMessages ? `Problem focus: ${keyMessages}` : `Problem focus for week ${weekNo}`,
      audience ? `Audience angle: ${audience}` : `Audience angle for week ${weekNo}`,
    ].filter(Boolean);
    return topics;
  };

  return {
    weeks: params.skeleton.weeklySlots.map((slot) => {
      const total = sumSkeletonDeliverables(slot.requiredDeliverables);
      const allocation: Record<string, number> = {};
      if (platformHints.length > 0) {
        const base = Math.floor(total / platformHints.length);
        let rem = total % platformHints.length;
        for (const p of platformHints) {
          allocation[p] = base + (rem > 0 ? 1 : 0);
          if (rem > 0) rem -= 1;
        }
      } else {
        allocation.linkedin = total;
      }

      const deliverablesArray = deliverablesToArray(slot.requiredDeliverables);
      const contentMix = deliverablesArray.map((d) => `${d.count} ${d.type}`);
      const weekTopics = buildWeekTopicSet(slot.weekNumber);
      const weekTheme = weekTopics[0] || `Week ${slot.weekNumber} focus`;
      const weekObjective =
        `Advance ${primaryIntent}` +
        (audience ? ` for ${audience}` : '') +
        ` using week ${slot.weekNumber} deliverables.`;
      const breakdownForPrimary = deliverablesArray.map((d) => ({
        type: d.type,
        count: d.count,
        topics: Array.from({ length: d.count }, (_, idx) => weekTopics[idx % weekTopics.length]),
      }));
      const primaryPlatform = Object.keys(allocation)[0] || 'linkedin';

      return {
        week: slot.weekNumber,
        phase_label: 'Audience Activation',
        primary_objective: weekObjective,
        platform_allocation: allocation,
        content_type_mix: contentMix,
        cta_type: 'Soft CTA',
        total_weekly_content_count: total,
        weekly_kpi_focus: 'Reach growth',
        theme: weekTheme,
        topics_to_cover: weekTopics,
        platform_content_breakdown: {
          [primaryPlatform]: breakdownForPrimary,
        },
        week_extras: {
          objective: weekObjective,
          topic_focus: weekTheme,
          deliverables_list: deliverablesArray,
          platform_hints: Object.keys(allocation),
          weekNumber: slot.weekNumber,
          deliverables: slot.requiredDeliverables,
        },
      };
    }),
  };
}

function clampScore(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1));
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseAlignmentEvaluation(raw: string): AlignmentEvaluation {
  const parsedObj = tryParseJsonObject(raw);
  const obj = parsedObj ?? {};
  const parseFailed = parsedObj == null;
  const suggestionsRaw = Array.isArray(obj.suggestedAdjustments) ? obj.suggestedAdjustments : [];
  const suggestions: AlignmentSuggestion[] = suggestionsRaw
    .map((s: any) => ({
      weekNumber: Number(s?.weekNumber || 0),
      suggestion: String(s?.suggestion || '').trim(),
    }))
    .filter((s) => s.weekNumber > 0 && s.suggestion.length > 0);
  const issuesRaw = Array.isArray(obj.issues) ? obj.issues : [];
  const issues = issuesRaw.map((i) => String(i).trim()).filter(Boolean);

  return {
    alignmentScore: clampScore(obj.alignmentScore),
    progressionScore: clampScore(obj.progressionScore),
    diversityScore: clampScore(obj.diversityScore),
    platformAlignmentScore: clampScore(obj.platformAlignmentScore),
    psychologicalFitScore: clampScore(obj.psychologicalFitScore),
    issues,
    suggestedAdjustments: suggestions,
    parseFailed,
  };
}

function buildAlignmentProfile(evaluation: AlignmentEvaluation | null | undefined): WeeklyAlignmentProfile {
  if (!evaluation || evaluation.parseFailed) {
    return {
      score: 50,
      progressionWeak: true,
      diversityWeak: true,
      platformWeak: true,
      psychologicalWeak: true,
    };
  }

  return {
    score: evaluation.alignmentScore,
    progressionWeak: evaluation.progressionScore < ALIGNMENT_ACCEPT_THRESHOLD,
    diversityWeak: evaluation.diversityScore < ALIGNMENT_ACCEPT_THRESHOLD,
    platformWeak: evaluation.platformAlignmentScore < ALIGNMENT_ACCEPT_THRESHOLD,
    psychologicalWeak: evaluation.psychologicalFitScore < ALIGNMENT_ACCEPT_THRESHOLD,
  };
}

type WeeklyWritingContextInput = {
  structured: { weeks: any[] };
  recommendationContext?: RecommendationContext | null;
  prefilledPlanning?: Record<string, unknown> | null;
  campaignStage?: string | null;
  psychologicalGoal?: string | null;
  momentum?: string | null;
  alignment?: AlignmentEvaluation | null;
};

function readContextText(source: Record<string, unknown> | null | undefined, keys: string[]): string {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizePlatformKey(platform: string): string {
  const p = String(platform || '').trim().toLowerCase();
  if (p === 'twitter') return 'x';
  return p;
}

function getPlatformWordLimit(platform: string): number {
  const normalized = normalizePlatformKey(platform);
  const limits: Record<string, number> = {
    blog: 1800,
    linkedin: 1300,
    facebook: 1000,
    youtube: 1200,
    instagram: 700,
    x: 500,
    tiktok: 350,
  };
  return limits[normalized] ?? 800;
}

function ctaToDesiredAction(ctaType: string): string {
  const cta = String(ctaType || '').toLowerCase();
  if (cta.includes('direct conversion')) return 'Take the conversion step now (book, sign up, or request demo).';
  if (cta.includes('engagement')) return 'Engage with the post (comment, reply, or share a perspective).';
  if (cta.includes('authority')) return 'Acknowledge expertise and continue following the framework.';
  if (cta.includes('soft')) return 'Take a low-friction next step (follow, save, or share).';
  return 'Consume the insight and stay engaged with the campaign.';
}

function actionExpectationToDesiredAction(value: unknown): string | null {
  const n = String(value ?? '').trim().toLowerCase();
  if (!n) return null;
  if (n.includes('follow')) return 'Follow us for more.';
  if (n.includes('contact')) return 'Contact us to continue the conversation.';
  if (n.includes('visit')) return 'Visit our website to learn more.';
  if (n.includes('understand')) return 'Understand the topic better and take notes.';
  return null;
}

function communicationStyleToTone(value: unknown): string | null {
  const n = String(value ?? '').trim().toLowerCase();
  if (!n) return null;
  if (n.includes('simple')) return 'simple, easy to understand';
  if (n.includes('professional') || n.includes('expert')) return 'professional, expert';
  if (n.includes('friendly') || n.includes('conversational')) return 'friendly, conversational';
  if (n.includes('deep') || n.includes('thoughtful')) return 'deep, thoughtful';
  return null;
}

function contentDepthScale(value: unknown): number {
  const n = String(value ?? '').trim().toLowerCase();
  if (!n) return 1;
  if (n.includes('short')) return 0.65;
  if (n.includes('medium')) return 1;
  if (n.includes('deep')) return 1.25;
  return 1;
}

function platformToPrimaryFormat(platform: string): string {
  const normalized = normalizePlatformKey(platform);
  if (normalized === 'blog') return 'long-form article';
  if (normalized === 'youtube' || normalized === 'tiktok') return 'video script';
  if (normalized === 'linkedin') return 'long-form social post';
  if (normalized === 'instagram') return 'carousel + caption';
  if (normalized === 'x') return 'thread';
  return 'social post';
}

function approximateDepthForTarget(wordTarget: number): string {
  if (wordTarget >= 1500) return 'Deep-dive';
  if (wordTarget >= 1000) return 'Comprehensive';
  if (wordTarget >= 700) return 'Standard';
  return 'Concise';
}

type DeterministicWriterContentBrief = {
  title: string;
  tone: string;
  intent_type: string;
  core_message: string;
  key_points: string[];
  must_include: string[];
  avoid: string[];
  cta_instruction: string;
  structure_hint: string;
  progression_note: string;
  format_requirements?: {
    format_family: string;
    required_assets: string[];
    structure_template: string[];
    platform_considerations: string[];
    production_notes: string[];
  };
};

function deterministicFormatRequirements(contentTypeRaw: string): {
  format_family: string;
  required_assets: string[];
  structure_template: string[];
  platform_considerations: string[];
  production_notes: string[];
} {
  const ct = String(contentTypeRaw || '').toLowerCase().trim();

  // Normalize common aliases
  const isThread = ct.includes('thread');
  const isLongForm =
    ct.includes('article') || ct.includes('blog') || ct.includes('long_form') || ct.includes('longform');
  const isWhitepaper = ct.includes('white') || ct.includes('whitepaper') || ct.includes('white_paper');
  const isVideo = ct.includes('video') || ct.includes('reel') || ct.includes('short');
  const isCarousel =
    ct.includes('carousel') || ct.includes('slide') || ct.includes('slides') || ct.includes('slideware');
  const isImage = ct.includes('image') || ct.includes('banner') || ct.includes('visual');
  const isPost =
    ct.includes('post') || ct.includes('feed_post') || ct.includes('tweet') || ct === 'post';

  if (isThread) {
    return {
      format_family: 'thread',
      required_assets: [],
      structure_template: ['Hook', 'Point 1', 'Point 2', 'Point 3', 'CTA'],
      platform_considerations: ['platform tone adaptation required'],
      production_notes: ['progressive flow between parts'],
    };
  }
  if (isWhitepaper) {
    return {
      format_family: 'authority_long_form',
      required_assets: [],
      structure_template: ['Executive Summary', 'Problem', 'Analysis', 'Framework', 'Conclusion'],
      platform_considerations: ['platform tone adaptation required'],
      production_notes: ['data-backed tone', 'high authority language'],
    };
  }
  if (isLongForm) {
    return {
      format_family: 'long_form',
      required_assets: [],
      structure_template: ['Intro', 'Problem', 'Insight', 'Application', 'CTA'],
      platform_considerations: ['platform tone adaptation required'],
      production_notes: ['clear section transitions', 'depth expected'],
    };
  }
  if (isVideo) {
    return {
      format_family: 'video',
      required_assets: ['script'],
      structure_template: ['Opening Hook', 'Core Explanation', 'Example', 'CTA'],
      platform_considerations: ['duration adapted later at daily layer'],
      production_notes: ['visual storytelling required'],
    };
  }
  if (isCarousel) {
    return {
      format_family: 'visual_sequence',
      required_assets: ['slides'],
      structure_template: ['Slide 1 Hook', 'Problem', 'Insight', 'Framework', 'CTA'],
      platform_considerations: ['platform tone adaptation required'],
      production_notes: ['each slide must stand alone visually'],
    };
  }
  if (isImage) {
    return {
      format_family: 'visual_single',
      required_assets: ['image'],
      structure_template: ['Visual Hook', 'Caption Insight', 'CTA'],
      platform_considerations: ['platform tone adaptation required'],
      production_notes: ['caption supports visual'],
    };
  }
  if (isPost) {
    return {
      format_family: 'short_text',
      required_assets: [],
      structure_template: ['Hook', 'Insight', 'Value', 'CTA'],
      platform_considerations: ['platform tone adaptation required'],
      production_notes: ['keep concise'],
    };
  }
  return {
    format_family: 'generic',
    required_assets: [],
    structure_template: ['Problem', 'Insight', 'Action'],
    platform_considerations: ['platform tone adaptation required'],
    production_notes: ['manual review recommended'],
  };
}

function validateContentTypeFormatPlatform(input: {
  content_type: unknown;
  platform: unknown;
  format_family: unknown;
}): { content_type: string; format_family: string; format_validation_warning: boolean } {
  const content_type = String(input.content_type ?? '').trim().toLowerCase() || 'post';
  const providedFormat = String(input.format_family ?? '').trim().toLowerCase();

  const isArticle = content_type.includes('article') || content_type.includes('blog');
  const isThreadLike = content_type.includes('thread') || content_type.includes('tweet');
  const isVideoLike = content_type.includes('video') || content_type.includes('reel') || content_type.includes('short');
  const isCarouselLike =
    content_type.includes('carousel') || content_type.includes('slide') || content_type.includes('slides') || content_type.includes('slideware');

  const inferred = deterministicFormatRequirements(content_type).format_family || 'short_text';
  const allowedFamilies = (() => {
    if (isArticle) return new Set(['long_form', 'authority_long_form']);
    if (isThreadLike) return new Set(['short_text', 'thread']);
    if (isVideoLike) return new Set(['video']);
    if (isCarouselLike) return new Set(['visual_sequence']);
    if (content_type.includes('image') || content_type.includes('visual')) return new Set(['visual_single']);
    return new Set(['short_text', 'thread', 'visual_single']);
  })();

  // Explicit hard mismatches from stability patch requirements.
  const hardMismatch =
    (isVideoLike && providedFormat === 'visual_sequence') ||
    (isArticle && providedFormat === 'thread');

  if (!providedFormat) {
    const corrected = allowedFamilies.has(inferred) ? inferred : Array.from(allowedFamilies)[0] || 'short_text';
    return { content_type, format_family: corrected, format_validation_warning: false };
  }
  if (hardMismatch) {
    if (allowedFamilies.has(inferred)) {
      return { content_type, format_family: inferred, format_validation_warning: false };
    }
    return { content_type, format_family: providedFormat, format_validation_warning: true };
  }
  if (allowedFamilies.has(providedFormat)) {
    return { content_type, format_family: providedFormat, format_validation_warning: false };
  }

  if (allowedFamilies.has(inferred)) {
    return { content_type, format_family: inferred, format_validation_warning: false };
  }
  return { content_type, format_family: providedFormat, format_validation_warning: true };
}

function narrativePositionFromIndex(globalIndex: number, total: number): 'start' | 'middle' | 'conversion' {
  const safeTotal = Math.max(1, Number.isFinite(total) ? Math.floor(total) : 1);
  const safeIndex = Math.min(safeTotal, Math.max(1, Number.isFinite(globalIndex) ? Math.floor(globalIndex) : 1));
  const startCutoff = Math.max(1, Math.ceil(safeTotal * 0.25));
  const conversionStart = Math.max(startCutoff + 1, Math.floor(safeTotal * 0.75) + 1);
  if (safeIndex <= startCutoff) return 'start';
  if (safeIndex >= conversionStart) return 'conversion';
  return 'middle';
}

function narrativeRoleFromPosition(position: unknown): 'awareness' | 'education' | 'action' {
  const p = String(position ?? '').toLowerCase().trim();
  if (p === 'start') return 'awareness';
  if (p === 'conversion') return 'action';
  return 'education';
}

function hasNumericAlignmentScore(posting: any): boolean {
  const candidates = [posting?.alignment_score, posting?.alignmentScore, posting?.final_alignment_score, posting?.finalAlignmentScore];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return true;
  }
  return false;
}

function deterministicAlignmentReasonDefaults(): string[] {
  return [
    'Matches weekly objective',
    'Supports audience pain point',
    'Aligns with campaign theme',
  ];
}

function ensureWriterFormatRequirements(brief: any, contentType: unknown, correctedFormatFamily: unknown): void {
  if (!brief || typeof brief !== 'object') return;
  const defaults = deterministicFormatRequirements(String(contentType ?? ''));
  const fallbackFamily = String(correctedFormatFamily ?? defaults.format_family ?? 'short_text').trim() || 'short_text';
  if (!brief.format_requirements || typeof brief.format_requirements !== 'object') {
    brief.format_requirements = {
      ...defaults,
      format_family: fallbackFamily,
    };
    return;
  }
  const req = brief.format_requirements as any;
  if (!req.format_family || typeof req.format_family !== 'string') req.format_family = fallbackFamily;
  if (!Array.isArray(req.required_assets)) req.required_assets = defaults.required_assets;
  if (!Array.isArray(req.structure_template)) req.structure_template = defaults.structure_template;
  if (!Array.isArray(req.production_notes)) req.production_notes = defaults.production_notes;
}

function buildDeterministicWriterBrief(input: {
  slot: any;
  week: any;
  content_type: string;
}): DeterministicWriterContentBrief {
  const ensureNonEmpty = (v: unknown): string => {
    const t = String(v ?? '').trim();
    return t;
  };
  const oneSentence = (text: string): string => {
    const t = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return '';
    const m = t.match(/^(.+?[.!?])\s+/);
    const s = (m?.[1] ?? t).trim();
    const clipped = s.length > 220 ? `${s.slice(0, 217).trimEnd()}...` : s;
    return clipped.endsWith('.') || clipped.endsWith('!') || clipped.endsWith('?') ? clipped : `${clipped}.`;
  };
  const uniq = (arr: string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of arr) {
      const t = String(raw ?? '').trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  };

  const slot = input.slot ?? {};
  const week = input.week ?? {};
  const intent = (slot?.intent && typeof slot.intent === 'object') ? slot.intent : {};

  const title = ensureNonEmpty(slot?.topic) || 'Topic';

  const tone =
    ensureNonEmpty(week?.week_extras?.writer_brief?.tone_guidance) ||
    ensureNonEmpty(week?.weeklyContextCapsule?.toneGuidance) ||
    'professional + clarity';

  const rawRole = ensureNonEmpty(intent?.strategic_role);
  const rawAngle = ensureNonEmpty(intent?.writing_angle);
  const roleOrAngle = (rawRole || rawAngle).toLowerCase();
  const intent_type =
    roleOrAngle.includes('demand') || roleOrAngle.includes('conversion')
      ? 'conversion'
      : roleOrAngle.includes('authority')
        ? 'authority'
        : roleOrAngle.includes('audience expansion') || roleOrAngle.includes('awareness')
          ? 'awareness'
          : roleOrAngle.includes('community') || roleOrAngle.includes('engagement')
            ? 'engagement'
            : roleOrAngle.includes('education')
              ? 'educational'
              : 'educational';

  const briefSummary = ensureNonEmpty(intent?.brief_summary ?? intent?.briefSummary);
  const outcomePromise = ensureNonEmpty(intent?.outcome_promise ?? intent?.outcomePromise);
  const core_message = oneSentence([briefSummary, outcomePromise].filter(Boolean).join(' ')) || oneSentence(outcomePromise || briefSummary || title);

  const alignmentSourceValue = ensureNonEmpty(intent?.recommendation_alignment?.source_value ?? intent?.recommendation_alignment?.sourceValue);
  const painPoint = ensureNonEmpty(intent?.pain_point ?? intent?.painPoint);
  const key_points = uniq([painPoint, outcomePromise, alignmentSourceValue]);

  const targetAudience = ensureNonEmpty(intent?.target_audience ?? intent?.targetAudience);
  const objective = ensureNonEmpty(intent?.objective);
  const theme =
    ensureNonEmpty(week?.theme) ||
    ensureNonEmpty(week?.weeklyContextCapsule?.campaignTheme) ||
    ensureNonEmpty(week?.week_extras?.writer_brief?.theme);

  const must_include = uniq([
    targetAudience ? `Address audience: ${targetAudience}` : '',
    theme ? `Align with weekly theme: ${theme}` : 'Align with weekly theme',
    objective ? `Support objective: ${objective}` : 'Support objective alignment',
  ]);

  const avoid = ['generic marketing claims', 'unrelated topics', 'breaking progression flow'];

  const ctaType = ensureNonEmpty(intent?.cta_type ?? intent?.ctaType);
  const cta_instruction =
    ctaType === 'Direct Conversion CTA'
      ? 'Include a direct action request (book, sign up, or request demo).'
      : ctaType === 'Authority CTA'
        ? 'Reinforce expertise; invite the reader to follow the framework.'
        : ctaType === 'Engagement CTA'
          ? 'Prompt interaction (comment, reply, share a perspective).'
          : ctaType === 'Soft CTA'
            ? 'Invite the reader to continue learning (low-friction next step).'
            : 'No explicit CTA required; end with a clear takeaway.';

  const ct = String(input.content_type || '').toLowerCase().trim();
  const structure_hint =
    ct.includes('article') || ct.includes('blog')
      ? 'Intro → Problem → Insight → Action → CTA'
      : ct.includes('video') || ct.includes('reel') || ct.includes('short')
        ? 'Hook → Explanation → Example → CTA'
        : ct.includes('post') || ct.includes('feed_post') || ct.includes('tweet') || ct.includes('thread')
          ? 'Hook → Insight → Value → CTA'
          : 'Problem → Insight → Action';

  const audienceStage =
    ensureNonEmpty(intent?.audience_stage ?? intent?.audienceStage) ||
    ensureNonEmpty(week?.audience_awareness_target);
  const stepRaw = Number(slot?.global_progression_index ?? slot?.progression_step);
  const step = Number.isFinite(stepRaw) && stepRaw > 0 ? Math.floor(stepRaw) : 0;
  const progression_note = `Step ${step || '?'} in narrative progression. Supports audience stage: ${audienceStage || 'unknown'}.`;

  return {
    title,
    tone,
    intent_type,
    core_message,
    key_points,
    must_include,
    avoid,
    cta_instruction,
    structure_hint,
    progression_note,
    format_requirements: deterministicFormatRequirements(input.content_type),
  };
}

function attachDeterministicWriterBriefsToExecutionSlots(weeks: any[]): void {
  if (!Array.isArray(weeks) || weeks.length === 0) return;
  for (const week of weeks) {
    const execItems: any[] = Array.isArray((week as any)?.execution_items) ? (week as any).execution_items : [];
    if (execItems.length === 0) continue;
    for (const exec of execItems) {
      const content_type = String(exec?.content_type ?? exec?.contentType ?? '').trim() || 'post';
      const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
      for (const slot of slots) {
        if (!slot || typeof slot !== 'object') continue;
        if (!(slot as any).writer_content_brief || typeof (slot as any).writer_content_brief !== 'object') {
          (slot as any).writer_content_brief = buildDeterministicWriterBrief({ slot, week, content_type });
        } else {
          // Additive extension: do not overwrite existing brief; attach format_requirements if missing.
          const brief = (slot as any).writer_content_brief as any;
          if (!brief.format_requirements || typeof brief.format_requirements !== 'object') {
            brief.format_requirements = deterministicFormatRequirements(content_type);
          }
        }
      }
    }
  }

  // Lightweight validation: warn if any slot still missing a writer_content_brief.
  for (const week of weeks) {
    const execItems: any[] = Array.isArray((week as any)?.execution_items) ? (week as any).execution_items : [];
    if (execItems.length === 0) continue;
    let totalSlots = 0;
    let missing = 0;
    let missingFormat = 0;
    for (const exec of execItems) {
      const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
      for (const slot of slots) {
        totalSlots += 1;
        if (!slot || typeof slot !== 'object') {
          missing += 1;
          missingFormat += 1;
          continue;
        }
        const has = (slot as any).writer_content_brief && typeof (slot as any).writer_content_brief === 'object';
        if (!has) missing += 1;
        const hasFormat =
          has &&
          (slot as any).writer_content_brief.format_requirements &&
          typeof (slot as any).writer_content_brief.format_requirements === 'object';
        if (!hasFormat) missingFormat += 1;
      }
    }
    if (missing > 0) {
      const weekNo = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
      console.warn('[weekly-writer-brief][missing]', { week: weekNo || null, missing, totalSlots });
    }
    if (missingFormat > 0) {
      const weekNo = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
      console.warn('[weekly-writer-brief][missing-format-requirements]', { week: weekNo || null, missingFormat, totalSlots });
    }
  }
}

function buildPostingExecutionMapForWeek(week: any): any[] {
  const normalizePlatform = (p: unknown): string => normalizePlatformKey(String(p ?? ''));
  const normalizeType = (t: unknown): string =>
    String(t ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'post';
  const toInt = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : 0;
  };
  const uniq = (arr: string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of arr) {
      const t = String(raw ?? '').trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  };

  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  if (execItems.length === 0) return [];

  const weekNo = toInt(week?.week ?? week?.week_number ?? week?.weekNumber) || 0;
  const entries: any[] = [];

  for (let execution_index = 0; execution_index < execItems.length; execution_index += 1) {
    const exec = execItems[execution_index];
    const content_type = normalizeType(exec?.content_type ?? exec?.contentType ?? 'post');
    const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];

    const selectedPlatformsRaw: string[] = Array.isArray(exec?.selected_platforms)
      ? exec.selected_platforms.map(normalizePlatform).filter(Boolean)
      : [];
    const platformOptionsRaw: string[] = Array.isArray(exec?.platform_options)
      ? exec.platform_options.map(normalizePlatform).filter(Boolean)
      : [];
    const defaultPlatforms = selectedPlatformsRaw.length > 0 ? selectedPlatformsRaw : platformOptionsRaw;

    const slotPlatformsRaw: string[][] = Array.isArray(exec?.slot_platforms)
      ? (exec.slot_platforms as any[]).map((arr) =>
          Array.isArray(arr) ? arr.map(normalizePlatform).filter(Boolean) : []
        )
      : [];

    for (let slot_index = 0; slot_index < slots.length; slot_index += 1) {
      const slot = slots[slot_index];
      const global_progression_index = toInt(slot?.global_progression_index ?? 0);
      const platformsForSlot = uniq(
        (slotPlatformsRaw[slot_index] && slotPlatformsRaw[slot_index]!.length > 0
          ? slotPlatformsRaw[slot_index]!
          : defaultPlatforms
        )
      ).sort((a, b) => a.localeCompare(b));

      // Rule A: create one posting per platform for this slot.
      for (const platform of platformsForSlot) {
        entries.push({
          posting_id: '', // filled after sort
          platform,
          content_type,
          topic_slot_ref: {
            execution_index,
            slot_index,
            global_progression_index,
          },
          posting_order: 0, // filled after sort
          __sort: {
            g: global_progression_index > 0 ? global_progression_index : Number.MAX_SAFE_INTEGER,
            p: platform,
            t: content_type,
          },
          __wk: weekNo,
        });
      }
    }
  }

  // Rule C: deterministic ordering
  entries.sort((a, b) => {
    const ga = Number(a?.__sort?.g ?? Number.MAX_SAFE_INTEGER);
    const gb = Number(b?.__sort?.g ?? Number.MAX_SAFE_INTEGER);
    if (ga !== gb) return ga - gb;
    const pa = String(a?.__sort?.p ?? '');
    const pb = String(b?.__sort?.p ?? '');
    if (pa !== pb) return pa.localeCompare(pb);
    const ta = String(a?.__sort?.t ?? '');
    const tb = String(b?.__sort?.t ?? '');
    return ta.localeCompare(tb);
  });

  // Rule D: deterministic IDs + posting_order
  const wk = weekNo > 0 ? weekNo : toInt(week?.week ?? week?.week_number ?? week?.weekNumber) || 0;
  for (let i = 0; i < entries.length; i += 1) {
    const idx = i + 1;
    const platform = String(entries[i]?.platform ?? '').trim().toLowerCase();
    const ct = String(entries[i]?.content_type ?? '').trim().toLowerCase();
    entries[i].posting_order = idx;
    entries[i].posting_id = `wk${wk}-p${idx}-${platform}-${ct}`;
    delete entries[i].__sort;
    delete entries[i].__wk;
  }

  return entries;
}

function attachPostingExecutionMapsToWeeks(weeks: any[]): void {
  if (!Array.isArray(weeks) || weeks.length === 0) return;

  for (const week of weeks) {
    const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
    if (execItems.length === 0) {
      if (week && typeof week === 'object' && (week as any).posting_execution_map == null) {
        (week as any).posting_execution_map = [];
      }
      continue;
    }

    // Only set when missing or empty to remain future-safe (do not overwrite).
    const existing = (week as any)?.posting_execution_map;
    if (Array.isArray(existing) && existing.length > 0) continue;

    (week as any).posting_execution_map = buildPostingExecutionMapForWeek(week);
  }

  // Validation: warn only (no throw).
  for (const week of weeks) {
    const weekNo = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
    const map: any[] = Array.isArray((week as any)?.posting_execution_map) ? (week as any).posting_execution_map : [];
    if (map.length === 0) continue;

    const execItems: any[] = Array.isArray((week as any)?.execution_items) ? (week as any).execution_items : [];
    const seen = new Set<string>();
    let duplicates = 0;
    let invalidRefs = 0;

    for (const entry of map) {
      const posting_id = String(entry?.posting_id ?? '').trim();
      if (posting_id) {
        if (seen.has(posting_id)) duplicates += 1;
        seen.add(posting_id);
      }
      const ref = entry?.topic_slot_ref ?? {};
      const execution_index = Number(ref?.execution_index);
      const slot_index = Number(ref?.slot_index);
      if (!Number.isFinite(execution_index) || execution_index < 0 || execution_index >= execItems.length) {
        invalidRefs += 1;
        continue;
      }
      const slots: any[] = Array.isArray(execItems[execution_index]?.topic_slots) ? execItems[execution_index].topic_slots : [];
      if (!Number.isFinite(slot_index) || slot_index < 0 || slot_index >= slots.length) {
        invalidRefs += 1;
        continue;
      }
    }

    if (duplicates > 0 || invalidRefs > 0) {
      console.warn('[weekly-posting-execution-map][validation]', {
        week: weekNo || null,
        entries: map.length,
        duplicates,
        invalidRefs,
      });
    }
  }
}

type DailyExecutionSourceType = 'planned' | 'manual';

type DailyExecutionItem = {
  execution_id: string;
  source_type: DailyExecutionSourceType;
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
  status: 'draft';
  scheduled_time?: string;
  /** Stable id for one logical content piece (optional, backward compatible). */
  master_content_id?: string;
  /** Execution ownership (enrichment-only). Frozen type prevents accidental values like "CREATOR" or "AUTO". */
  execution_mode?: ExecutionMode;
  /** When CREATOR_REQUIRED or CONDITIONAL_AI: structured guidance for creator (title, objective, formatHint, etc.). */
  creator_instruction?: Record<string, unknown>;
  master_content?: {
    id: string;
    generated_at: string;
    content: string;
    generation_status: 'pending' | 'generated' | 'failed';
    generation_source: 'ai';
  };
  platform_variants?: Array<{
    platform: string;
    content_type: string;
    generated_content: string;
    generation_status: 'pending' | 'generated' | 'failed';
    locked_variant: boolean;
    generation_overrides?: Record<string, unknown>;
  }>;
};

function warnDailyExecutionNormalization(input: Partial<DailyExecutionItem>, context: string): void {
  if (!String(input.execution_id ?? '').trim()) {
    console.warn('[daily-normalization][missing-execution-id]', { context });
  }
  if (!String(input.platform ?? '').trim()) {
    console.warn('[daily-normalization][missing-platform]', { context, execution_id: input.execution_id ?? null });
  }
  if (!String(input.content_type ?? '').trim()) {
    console.warn('[daily-normalization][missing-content-type]', { context, execution_id: input.execution_id ?? null });
  }
}

function normalizeToDailyExecutionItem(input: Partial<DailyExecutionItem>): DailyExecutionItem {
  const normalized: DailyExecutionItem = {
    execution_id: String(input.execution_id ?? '').trim(),
    source_type: input.source_type === 'planned' ? 'planned' : 'manual',
    campaign_id: input.campaign_id ? String(input.campaign_id) : undefined,
    week_number: Number.isFinite(Number(input.week_number)) ? Number(input.week_number) : undefined,
    platform: String(input.platform ?? '').trim().toLowerCase(),
    content_type: String(input.content_type ?? '').trim().toLowerCase(),
    topic: typeof input.topic === 'string' ? input.topic : undefined,
    title: typeof input.title === 'string' ? input.title : undefined,
    content: typeof input.content === 'string' ? input.content : undefined,
    intent: input.intent && typeof input.intent === 'object' ? input.intent : undefined,
    writer_content_brief:
      input.writer_content_brief && typeof input.writer_content_brief === 'object'
        ? input.writer_content_brief
        : undefined,
    narrative_role: typeof input.narrative_role === 'string' ? input.narrative_role : undefined,
    progression_step: Number.isFinite(Number(input.progression_step)) ? Number(input.progression_step) : undefined,
    global_progression_index: Number.isFinite(Number(input.global_progression_index))
      ? Number(input.global_progression_index)
      : undefined,
    status: 'draft',
    scheduled_time: typeof input.scheduled_time === 'string' ? input.scheduled_time : undefined,
    master_content_id: typeof input.master_content_id === 'string' ? input.master_content_id : undefined,
    execution_mode: isExecutionMode(input.execution_mode) ? input.execution_mode : undefined,
    creator_instruction:
      input.creator_instruction && typeof input.creator_instruction === 'object' ? input.creator_instruction : undefined,
  };
  warnDailyExecutionNormalization(normalized, 'normalizeToDailyExecutionItem');
  return normalized;
}

/** Pass through execution_mode from resolved posting; never recompute (SOURCE OF TRUTH from weekly enrichment). */
function normalizeResolvedPostingToDailyItem(
  posting: any,
  meta: { campaign_id?: string; week_number?: number } = {}
): DailyExecutionItem {
  const weeklyIntent =
    posting?.intent && typeof posting.intent === 'object'
      ? posting.intent
      : (posting?.topic_slot_ref?.intent && typeof posting.topic_slot_ref.intent === 'object'
          ? posting.topic_slot_ref.intent
          : undefined);
  return normalizeToDailyExecutionItem({
    execution_id: String(posting?.execution_id ?? posting?.posting_id ?? '').trim(),
    source_type: 'planned',
    campaign_id: meta.campaign_id,
    week_number: meta.week_number,
    platform: String(posting?.platform ?? '').trim(),
    content_type: String(posting?.content_type ?? '').trim(),
    topic: typeof posting?.topic === 'string' ? posting.topic : undefined,
    title: typeof posting?.topic === 'string' ? posting.topic : undefined,
    content: typeof posting?.content === 'string' ? posting.content : undefined,
    intent: weeklyIntent,
    writer_content_brief:
      posting?.writer_content_brief && typeof posting.writer_content_brief === 'object'
        ? posting.writer_content_brief
        : undefined,
    narrative_role: typeof posting?.narrative_role === 'string' ? posting.narrative_role : undefined,
    progression_step: Number(posting?.progression_step),
    global_progression_index: Number(posting?.global_progression_index),
    execution_mode: isExecutionMode(posting?.execution_mode) ? posting.execution_mode : undefined,
    creator_instruction:
      posting?.creator_instruction && typeof posting.creator_instruction === 'object'
        ? posting.creator_instruction
        : undefined,
    status: 'draft',
    scheduled_time: typeof posting?.scheduled_time === 'string' ? posting.scheduled_time : undefined,
    master_content_id: typeof posting?.master_content_id === 'string' ? posting.master_content_id : undefined,
  });
}

function alignDailyExecutionItemsAsSingleSource(args: {
  weeks: any[];
  campaignId: string;
  currentPlanWeeks?: any[];
}): void {
  const weeks = Array.isArray(args.weeks) ? args.weeks : [];
  const existingDailyByWeek = new Map<number, any[]>();
  const currentWeeks = Array.isArray(args.currentPlanWeeks) ? args.currentPlanWeeks : [];
  for (const week of currentWeeks) {
    const weekNo = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
    if (weekNo <= 0) continue;
    if (Array.isArray((week as any)?.daily)) {
      existingDailyByWeek.set(weekNo, (week as any).daily);
    }
  }

  for (const week of weeks) {
    const weekNo = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
    const resolvedPostings: any[] = Array.isArray((week as any)?.resolved_postings) ? (week as any).resolved_postings : [];
    (week as any).daily_execution_items = resolvedPostings.map((posting: any) =>
      normalizeResolvedPostingToDailyItem(posting, { campaign_id: args.campaignId, week_number: weekNo || undefined })
    );

    // Backward compatibility: keep existing legacy daily[] if it already existed; otherwise suppress AI-authored daily[].
    if (existingDailyByWeek.has(weekNo)) {
      (week as any).daily = existingDailyByWeek.get(weekNo);
    } else if (Array.isArray((week as any)?.daily)) {
      (week as any).daily = [];
    }

    const dailyItems: any[] = Array.isArray((week as any)?.daily_execution_items) ? (week as any).daily_execution_items : [];
    for (const item of dailyItems) {
      if (!String(item?.execution_id ?? '').trim()) {
        console.warn('[daily-normalization][missing-execution-id]', { context: 'alignDailyExecutionItemsAsSingleSource', week: weekNo || null });
      }
      if (!String(item?.source_type ?? '').trim()) {
        console.warn('[daily-normalization][missing-source-type]', {
          context: 'alignDailyExecutionItemsAsSingleSource',
          week: weekNo || null,
          execution_id: item?.execution_id ?? null,
        });
      }
    }
  }
}

function attachResolvedPostingsToWeeks(weeks: any[]): void {
  if (!Array.isArray(weeks) || weeks.length === 0) return;

  for (const week of weeks) {
    const map: any[] = Array.isArray((week as any)?.posting_execution_map) ? (week as any).posting_execution_map : [];
    if (map.length === 0) {
      if (week && typeof week === 'object' && (week as any).resolved_postings == null) {
        (week as any).resolved_postings = [];
      }
      if (week && typeof week === 'object' && (week as any).daily_execution_items == null) {
        (week as any).daily_execution_items = [];
      }
      continue;
    }

    // Do not overwrite non-empty (future-safe).
    const existing = (week as any)?.resolved_postings;
    if (Array.isArray(existing) && existing.length > 0) {
      if (!Array.isArray((week as any)?.daily_execution_items) || (week as any).daily_execution_items.length === 0) {
        const weekNoExisting = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
        (week as any).daily_execution_items = existing.map((posting: any) =>
          normalizeResolvedPostingToDailyItem(posting, { week_number: weekNoExisting || undefined })
        );
      }
      continue;
    }

    const execItems: any[] = Array.isArray((week as any)?.execution_items) ? (week as any).execution_items : [];
    const resolved: any[] = [];
    let invalid = 0;
    const weekNo = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
    const safeWeekNo = weekNo > 0 ? weekNo : 1;
    const totalPostings = map.length;

    for (const entry of map) {
      const ref = entry?.topic_slot_ref ?? {};
      const execution_index = Number(ref?.execution_index);
      const slot_index = Number(ref?.slot_index);
      if (!Number.isFinite(execution_index) || execution_index < 0 || execution_index >= execItems.length) {
        invalid += 1;
        continue;
      }
      const exec = execItems[execution_index];
      const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
      if (!Number.isFinite(slot_index) || slot_index < 0 || slot_index >= slots.length) {
        invalid += 1;
        continue;
      }
      const slot = slots[slot_index];
      if (!slot || typeof slot !== 'object') {
        invalid += 1;
        continue;
      }

      // Shallow reuse existing objects (no deep clone).
      const postingOrderRaw = Number(entry?.posting_order);
      const postingOrder = Number.isFinite(postingOrderRaw) && postingOrderRaw > 0
        ? Math.floor(postingOrderRaw)
        : (resolved.length + 1);
      const progression_step_raw = Number(slot?.progression_step);
      const progression_step = Number.isFinite(progression_step_raw) && progression_step_raw > 0
        ? Math.floor(progression_step_raw)
        : postingOrder;
      const global_index_raw = Number(slot?.global_progression_index);
      const global_progression_index = Number.isFinite(global_index_raw) && global_index_raw > 0
        ? Math.floor(global_index_raw)
        : progression_step;
      const narrative_position = narrativePositionFromIndex(global_progression_index, totalPostings);
      const narrative_role = narrativeRoleFromPosition(narrative_position);
      const writerBrief = (slot as any)?.writer_content_brief && typeof (slot as any).writer_content_brief === 'object'
        ? (slot as any).writer_content_brief
        : null;
      const incomingFormat = writerBrief?.format_requirements?.format_family;
      const validated = validateContentTypeFormatPlatform({
        content_type: entry?.content_type,
        platform: entry?.platform,
        format_family: incomingFormat,
      });
      if (writerBrief) {
        ensureWriterFormatRequirements(writerBrief, validated.content_type, validated.format_family);
      }
      // SOURCE OF TRUTH: Use slot.execution_mode only; never recompute downstream (calendar/UI trust weekly intelligence).
      const execution_mode =
        (slot as any)?.execution_mode ?? inferExecutionMode(validated.content_type);
      resolved.push({
        posting_id: entry?.posting_id,
        posting_order: postingOrder,
        execution_id: `wk${safeWeekNo}-exec-${postingOrder}`,
        platform: entry?.platform,
        content_type: validated.content_type,
        format_validation_warning: validated.format_validation_warning,

        topic: slot?.topic,
        progression_step,
        global_progression_index,
        narrative_position,
        narrative_role,

        intent: slot?.intent,
        writer_content_brief: writerBrief,
        execution_mode,
        ...(typeof (slot as any)?.master_content_id === 'string'
          ? { master_content_id: (slot as any).master_content_id }
          : {}),
        ...(typeof (slot as any)?.creator_instruction === 'object' && (slot as any).creator_instruction != null
          ? { creator_instruction: (slot as any).creator_instruction }
          : {}),
      });
      const current = resolved[resolved.length - 1];
      if (hasNumericAlignmentScore(current)) {
        const alignmentReason = Array.isArray(current?.alignment_reason)
          ? current.alignment_reason.map((v: unknown) => String(v ?? '').trim()).filter(Boolean)
          : [];
        if (alignmentReason.length === 0) current.alignment_reason = deterministicAlignmentReasonDefaults();
      }
    }

    // Preserve posting_order only (no extra sorting)
    resolved.sort((a, b) => {
      const oa = Number(a?.posting_order);
      const ob = Number(b?.posting_order);
      const na = Number.isFinite(oa) ? oa : Number.MAX_SAFE_INTEGER;
      const nb = Number.isFinite(ob) ? ob : Number.MAX_SAFE_INTEGER;
      return na - nb;
    });

    (week as any).resolved_postings = resolved;
    (week as any).daily_execution_items = resolved.map((posting: any) =>
      normalizeResolvedPostingToDailyItem(posting, { week_number: weekNo || undefined })
    );
    for (let i = 0; i < resolved.length; i += 1) {
      const post = resolved[i];
      const postingOrderRaw = Number(post?.posting_order);
      const postingOrder = Number.isFinite(postingOrderRaw) && postingOrderRaw > 0 ? Math.floor(postingOrderRaw) : i + 1;
      if (!post.execution_id || typeof post.execution_id !== 'string') {
        post.execution_id = `wk${safeWeekNo}-exec-${postingOrder}`;
      }
      if (!post.progression_step || !Number.isFinite(Number(post.progression_step))) {
        post.progression_step = postingOrder;
      }
      if (!post.global_progression_index || !Number.isFinite(Number(post.global_progression_index))) {
        post.global_progression_index = Number(post.progression_step) || postingOrder;
      }
      if (!post.narrative_position || typeof post.narrative_position !== 'string') {
        post.narrative_position = narrativePositionFromIndex(Number(post.global_progression_index), Math.max(1, resolved.length));
      }
      if (!post.narrative_role || typeof post.narrative_role !== 'string') {
        post.narrative_role = narrativeRoleFromPosition(post.narrative_position);
      }
      const brief = post?.writer_content_brief && typeof post.writer_content_brief === 'object' ? post.writer_content_brief : null;
      const validated = validateContentTypeFormatPlatform({
        content_type: post?.content_type,
        platform: post?.platform,
        format_family: brief?.format_requirements?.format_family,
      });
      post.content_type = validated.content_type;
      if (post.format_validation_warning == null) post.format_validation_warning = validated.format_validation_warning;
      if (brief) ensureWriterFormatRequirements(brief, validated.content_type, validated.format_family);
      if (hasNumericAlignmentScore(post)) {
        const alignmentReason = Array.isArray(post?.alignment_reason)
          ? post.alignment_reason.map((v: unknown) => String(v ?? '').trim()).filter(Boolean)
          : [];
        if (alignmentReason.length === 0) post.alignment_reason = deterministicAlignmentReasonDefaults();
      }
    }

    // Validation warnings only.
    if (resolved.length !== map.length) {
      console.warn('[weekly-resolved-postings][mismatch]', {
        week: weekNo || null,
        mapEntries: map.length,
        resolvedEntries: resolved.length,
        invalidRefs: invalid,
      });
    }

    // Stability validation pass (warn-only): required daily-ready metadata.
    let missingExecutionId = 0;
    let missingProgression = 0;
    let missingFormatRequirements = 0;
    let undefinedContentType = 0;
    for (const post of resolved) {
      if (!String(post?.execution_id ?? '').trim()) missingExecutionId += 1;
      const hasProgression =
        Number.isFinite(Number(post?.progression_step)) &&
        Number.isFinite(Number(post?.global_progression_index)) &&
        String(post?.narrative_position ?? '').trim().length > 0;
      if (!hasProgression) missingProgression += 1;
      const hasFormatReq =
        post?.writer_content_brief &&
        typeof post.writer_content_brief === 'object' &&
        post.writer_content_brief.format_requirements &&
        typeof post.writer_content_brief.format_requirements === 'object' &&
        String(post.writer_content_brief.format_requirements.format_family ?? '').trim().length > 0;
      if (!hasFormatReq) missingFormatRequirements += 1;
      if (!String(post?.content_type ?? '').trim()) undefinedContentType += 1;
    }
    if (missingExecutionId > 0 || missingProgression > 0 || missingFormatRequirements > 0 || undefinedContentType > 0) {
      console.warn('[weekly-resolved-postings][stability-validation]', {
        week: weekNo || null,
        resolvedEntries: resolved.length,
        missingExecutionId,
        missingProgression,
        missingFormatRequirements,
        undefinedContentType,
      });
    }
  }
}

function enrichWeeklyWritingContext(input: WeeklyWritingContextInput): { weeks: any[] } {
  const recommendationPayload = (input.recommendationContext?.context_payload ?? {}) as Record<string, unknown>;
  const prefilled = (input.prefilledPlanning ?? {}) as Record<string, unknown>;
  const alignmentProfile = buildAlignmentProfile(input.alignment ?? null);

  const globalAudienceProfile =
    readContextText(prefilled, ['audience_professional_segment']) ||
    readContextText(prefilled, ['target_audience']) ||
    readContextText(recommendationPayload, ['target_audience', 'audience', 'ideal_customer_profile', 'icp']) ||
    'Target audience from campaign context';
  const globalPainPoint =
    readContextText(prefilled, ['key_messages']) ||
    readContextText(recommendationPayload, ['problem', 'problem_statement', 'pain_point']) ||
    'Primary audience pain point';
  const globalTransformation =
    readContextText(recommendationPayload, ['desired_transformation', 'transformation']) ||
    readContextText(prefilled, ['theme_or_description']) ||
    'Desired transformation outcome';
  const campaignTheme =
    readContextText(recommendationPayload, ['campaign_theme', 'angle']) ||
    readContextText(prefilled, ['theme_or_description']) ||
    'Campaign theme';
  const toneGuidanceBase =
    communicationStyleToTone(readContextText(prefilled, ['communication_style'])) ||
    readContextText(recommendationPayload, ['tone', 'tone_guidance']) ||
    readContextText(prefilled, ['brand_voice']) ||
    'clear, practical, outcome-driven';
  const desiredActionOverride = actionExpectationToDesiredAction(readContextText(prefilled, ['action_expectation']));
  const depthScale = contentDepthScale(readContextText(prefilled, ['content_depth']));
  const continuity = readContextText(prefilled, ['topic_continuity']);

  const weeks = (input.structured.weeks || []).map((week: any) => {
    const topics = Array.isArray(week?.topics_to_cover)
      ? week.topics_to_cover.map((t: unknown) => String(t ?? '').trim()).filter(Boolean)
      : [];
    const topicTitles = topics.length > 0 ? topics : [String(week?.theme ?? '').trim() || `Week ${week?.week ?? 1} topic`];
    const allocation = week?.platform_allocation && typeof week.platform_allocation === 'object'
      ? (week.platform_allocation as Record<string, number>)
      : {};
    const sortedPlatforms = Object.entries(allocation)
      .map(([platform, count]) => ({ platform: normalizePlatformKey(platform), count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count);
    const highestCapacityPlatform = sortedPlatforms[0]?.platform || 'linkedin';
    const baseWordTarget = getPlatformWordLimit(highestCapacityPlatform);
    const maxWordTarget = Math.max(250, Math.min(2400, Math.floor(baseWordTarget * depthScale)));
    const recommendedContentTypes = Array.isArray(week?.content_type_mix)
      ? week.content_type_mix.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
      : [];
    const weeklyIntent = String(week?.primary_objective ?? week?.objective ?? '').trim() || `Execute week ${week?.week ?? 1} objective.`;
    const weekTheme = String(week?.theme ?? '').trim() || topicTitles[0];
    const successOutcome = String(week?.weekly_kpi_focus ?? '').trim() || 'Reach growth';

    const weeklyContextCapsule = {
      campaignTheme: campaignTheme || weekTheme,
      primaryPainPoint: globalPainPoint,
      desiredTransformation: globalTransformation,
      campaignStage: String(input.campaignStage ?? recommendationPayload.campaign_stage ?? week.phase_label ?? '').trim() || 'Campaign execution',
      psychologicalGoal: String(input.psychologicalGoal ?? recommendationPayload.psychological_goal ?? '').trim() || 'Audience progression',
      momentum:
        String(input.momentum ?? recommendationPayload.momentum ?? week.phase_label ?? '').trim() ||
        (continuity ? `Series preference: ${continuity}` : 'Steady progression'),
      audienceProfile: globalAudienceProfile,
      weeklyIntent,
      toneGuidance: `${toneGuidanceBase}; alignment score ${alignmentProfile.score}/100`,
      successOutcome,
    };

    const topicBriefs = topicTitles.map((topicTitle: string) => {
      const topicContext = {
        topicTitle,
        topicGoal: weeklyIntent,
        audienceAngle: globalAudienceProfile,
        painPointFocus: globalPainPoint,
        transformationIntent: globalTransformation,
        messagingAngle: weekTheme,
        expectedOutcome: successOutcome,
        recommendedContentTypes: recommendedContentTypes.length > 0 ? recommendedContentTypes : ['post'],
        platformPriority: sortedPlatforms.map((item) => item.platform),
        writingIntent: `${weeklyIntent} through "${topicTitle}"`,
      };
      const contentTypeGuidance = {
        primaryFormat: platformToPrimaryFormat(highestCapacityPlatform),
        maxWordTarget,
        platformWithHighestLimit: highestCapacityPlatform,
        adaptationRequired: true as const,
      };
      return {
        topicTitle,
        topicContext,
        whoAreWeWritingFor: globalAudienceProfile,
        whatProblemAreWeAddressing: globalPainPoint,
        whatShouldReaderLearn: globalTransformation,
        desiredAction: desiredActionOverride || ctaToDesiredAction(String(week?.cta_type ?? 'None')),
        approximateDepth: approximateDepthForTarget(maxWordTarget),
        narrativeStyle: toneGuidanceBase,
        contentTypeGuidance,
      };
    });

    return {
      ...week,
      weeklyContextCapsule,
      topics: topicBriefs,
    };
  });

  return { ...input.structured, weeks };
}

function normalizeStructuredPlanForOutput(params: {
  structured: { weeks: any[] };
  planSkeleton?: PlanSkeleton | null;
}): { weeks: any[] } {
  const { structured, planSkeleton } = params;
  const normalizedWeeks = (structured.weeks || []).map((w: any) => {
    const weekNo = Number(w?.week || 0) || 1;
    const existingObjective = String(
      w?.primary_objective ?? w?.objective ?? w?.week_extras?.objective ?? ''
    ).trim();
    const existingTheme = String(w?.theme ?? '').trim();
    const existingTopicFocus = String(w?.topicFocus ?? w?.week_extras?.topic_focus ?? w?.week_extras?.topicFocus ?? '').trim();
    const existingTopics = Array.isArray(w?.topics_to_cover)
      ? w.topics_to_cover.map((t: unknown) => String(t ?? '').trim()).filter(Boolean)
      : [];
    const hasObjective = existingObjective.length > 0;
    const hasTheme = existingTheme.length > 0;
    const hasTopicFocus = existingTopicFocus.length > 0 || existingTopics.length > 0;
    const allIntelligenceMissing = !hasObjective && !hasTheme && !hasTopicFocus;

    const topicFocus = allIntelligenceMissing
      ? `Week ${weekNo} Topic Placeholder`
      : (existingTheme || existingTopicFocus || existingTopics[0] || '');
    const objective = allIntelligenceMissing
      ? `Execute week ${weekNo} campaign objective.`
      : existingObjective;
    const topics = existingTopics.length > 0
      ? existingTopics
      : (topicFocus ? [topicFocus] : []);
    const deliverables = planSkeleton?.weeklySlots.find((s) => s.weekNumber === weekNo)?.requiredDeliverables ?? {
      videos: 0,
      posts: 0,
      blogs: 0,
      stories: 0,
    };
    const total = sumSkeletonDeliverables(deliverables);
    const allocation = w?.platform_allocation && typeof w.platform_allocation === 'object'
      ? w.platform_allocation
      : { linkedin: total > 0 ? total : 1 };
    const platformHints = Object.keys(allocation);
    const deliverablesList = Array.isArray(w?.week_extras?.deliverables_list)
      ? w.week_extras.deliverables_list
      : deliverablesToArray(deliverables);

    return {
      ...w,
      week: weekNo,
      primary_objective: objective || w?.primary_objective || '',
      theme: topicFocus,
      topics_to_cover: topics,
      platform_allocation: allocation,
      weekNumber: weekNo,
      objective,
      topicFocus,
      deliverables,
      platformHints,
      week_extras: {
        ...(w?.week_extras || {}),
        weekNumber: weekNo,
        objective,
        topic_focus: topicFocus,
        topicFocus,
        deliverables,
        deliverables_list: deliverablesList,
        platform_hints: platformHints,
        platformHints,
      },
    };
  });
  return { ...structured, weeks: normalizedWeeks };
}

async function evaluateWeeklyAlignment(params: {
  campaignId?: string | null;
  recommendationContext?: RecommendationContext | null;
  campaignStage?: string | null;
  psychologicalGoal?: string | null;
  momentum?: string | null;
  normalizedWeeks: any[];
}): Promise<AlignmentEvaluation> {
  const evaluationPrompt = {
    recommendation_context: params.recommendationContext ?? null,
    campaign_stage: params.campaignStage ?? null,
    psychological_goal: params.psychologicalGoal ?? null,
    momentum: params.momentum ?? null,
    weekly_plan: params.normalizedWeeks,
  };

  const completion = await generateCampaignPlan({
    companyId: null,
    campaignId: params.campaignId ?? null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a campaign weekly-alignment evaluator. Evaluate alignment quality only. ' +
          'Do NOT rewrite plan structure, do NOT add/remove weeks, do NOT change deliverable counts.',
      },
      {
        role: 'user',
        content:
          'Evaluate the weekly plan and return JSON only with this shape:\n' +
          '{alignmentScore:number, progressionScore:number, diversityScore:number, platformAlignmentScore:number, psychologicalFitScore:number, issues:string[], suggestedAdjustments:[{weekNumber:number, suggestion:string}]}\n' +
          'Rules:\n' +
          '- Alignment only; suggestions must be intelligence-field adjustments.\n' +
          '- Do NOT propose structural or count changes.\n' +
          `Input:\n${canonicalJsonStringify(evaluationPrompt)}`,
      },
    ],
  });

  return parseAlignmentEvaluation(completion.output || '');
}

function isQuestionAligned(modelQuestion: string, expectedQuestion: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const a = normalize(modelQuestion);
  const b = normalize(expectedQuestion);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;

  const bTokens = b.split(' ').filter((t) => t.length >= 4);
  if (!bTokens.length) return false;
  const overlap = bTokens.filter((t) => a.includes(t)).length;
  return overlap >= Math.max(2, Math.floor(bTokens.length / 2));
}

/** Extract campaign_duration (weeks) from conversation when user answered the duration question. Uses most recent answer. */
function extractDurationFromConversation(history: Array<{ type: string; message: string }>): number | null {
  const qKeywords = ['weeks', 'week', 'how many', 'campaign run', 'duration', '6, 12'];
  let lastFound: number | null = null;
  for (let i = 0; i < (history?.length ?? 0) - 1; i++) {
    const aiMsg = (history[i]?.message ?? '').toLowerCase();
    const userMsg = (history[i + 1]?.message ?? '').trim();
    if (history[i]?.type !== 'ai' || history[i + 1]?.type !== 'user') continue;
    const aiAsksDuration = qKeywords.some((k) => aiMsg.includes(k));
    if (!aiAsksDuration || !userMsg) continue;
    const match = userMsg.match(/\b(\d{1,2})\s*(?:week|weeks)?\b/i) ?? userMsg.match(/\b(\d{1,2})\b/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n >= 1 && n <= 52) lastFound = n;
    }
  }
  return lastFound;
}

/** Campaign type → preferred platform (normalized) for dominant platform selection */
const PRIMARY_TYPE_PLATFORM_PREFERENCE: Record<string, string[]> = {
  lead_generation: ['linkedin'],
  authority_positioning: ['linkedin'],
  network_expansion: ['linkedin', 'facebook'],
  engagement_growth: ['instagram', 'tiktok'],
  product_promotion: ['instagram', 'linkedin'],
  brand_awareness: [], // broad; use first available or highest
};

export interface BaselineContext {
  stage: string;
  scope: string;
  expectedBaseline: number;
  actualFollowers: number;
  ratio: number;
  status: 'underdeveloped' | 'aligned' | 'strong';
  primaryPlatform: string;
}

export type BaselineContextResult = BaselineContext | { unavailable: true };

async function resolveBaselineContext(input: {
  companyId: string;
  companyStage: string | null;
  marketScope: string | null;
  baselineOverride: Record<string, unknown> | null;
  primaryType: string;
  platformStrategies: { name: string }[];
}): Promise<BaselineContextResult> {
  const stage = input.companyStage ?? 'early_stage';
  const scope = input.marketScope ?? 'niche';
  const expectedBaseline = computeExpectedBaseline(stage, scope);

  if (input.baselineOverride && typeof input.baselineOverride === 'object') {
    const override = input.baselineOverride as { platform?: string; followers?: number };
    const actualFollowers = Math.max(0, Number(override.followers) ?? 0);
    const platform = String(override.platform || 'unknown');
    const classification = classifyBaseline(actualFollowers, expectedBaseline);
    return {
      stage,
      scope,
      expectedBaseline,
      actualFollowers,
      ratio: classification.ratio,
      status: classification.status,
      primaryPlatform: platform,
    };
  }

  const snapshots = await getLatestSnapshotsPerPlatform(input.companyId);
  if (snapshots.length === 0) {
    return { unavailable: true };
  }

  const pref = PRIMARY_TYPE_PLATFORM_PREFERENCE[input.primaryType] ?? [];
  const byPlatform = new Map(snapshots.map((s) => [s.platform.toLowerCase(), s]));
  const alias = (p: string) => (p === 'x' ? 'twitter' : p);
  const strategyNames = (input.platformStrategies || []).map((p) => {
    const n = String(p.name || '')
      .toLowerCase()
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/^\s+|\s+$/g, '');
    return alias(n);
  });

  let chosen: { platform: string; followers: number } | null = null;
  for (const p of pref) {
    const snap = byPlatform.get(p) ?? byPlatform.get(p.replace(' ', ''));
    if (snap) {
      chosen = { platform: snap.platform, followers: snap.followers };
      break;
    }
  }
  if (!chosen) {
    for (const p of strategyNames) {
      const snap = byPlatform.get(p) ?? byPlatform.get(p.replace(' ', ''));
      if (snap) {
        chosen = { platform: snap.platform, followers: snap.followers };
        break;
      }
    }
  }
  if (!chosen) {
    const highest = snapshots.reduce((a, b) => (a.followers >= b.followers ? a : b));
    chosen = { platform: highest.platform, followers: highest.followers };
  }

  const classification = classifyBaseline(chosen.followers, expectedBaseline);
  return {
    stage,
    scope,
    expectedBaseline,
    actualFollowers: chosen.followers,
    ratio: classification.ratio,
    status: classification.status,
    primaryPlatform: chosen.platform,
  };
}

function buildCompanyContextBlock(
  profile: any,
  buildMode: string,
  contextScope: string[] | null
): string | null {
  if (!profile) return null;
  if (buildMode === 'no_context') return null;

  const sections: string[] = [];

  if (buildMode === 'full_context') {
    sections.push('commercial_strategy', 'marketing_intelligence', 'campaign_purpose', 'brand_positioning', 'competitive_advantages', 'growth_priorities');
  } else if (buildMode === 'focused_context' && contextScope && contextScope.length > 0) {
    sections.push(...contextScope);
  } else {
    return null;
  }

  const parts: string[] = [];
  const commercialFields = ['target_customer_segment', 'ideal_customer_profile', 'pricing_model', 'sales_motion', 'avg_deal_size', 'sales_cycle', 'key_metrics'];
  const marketingFields = ['marketing_channels', 'content_strategy', 'campaign_focus', 'key_messages', 'brand_positioning', 'competitive_advantages', 'growth_priorities'];

  if (sections.includes('commercial_strategy')) {
    const commercial = commercialFields
      .map((f) => (profile[f] ? `${f}: ${profile[f]}` : null))
      .filter(Boolean);
    if (commercial.length) parts.push(`Commercial Strategy:\n${commercial.join('\n')}`);
  }
  if (sections.includes('marketing_intelligence')) {
    const marketing = marketingFields
      .map((f) => (profile[f] ? `${f}: ${profile[f]}` : null))
      .filter(Boolean);
    if (marketing.length) parts.push(`Marketing Intelligence:\n${marketing.join('\n')}`);
  }
  if (sections.includes('campaign_purpose') && profile.campaign_purpose_intent) {
    parts.push(`Campaign Purpose:\n${JSON.stringify(profile.campaign_purpose_intent)}`);
  }
  if (sections.includes('brand_positioning') && profile.brand_positioning) {
    parts.push(`Brand Positioning: ${profile.brand_positioning}`);
  }
  if (sections.includes('competitive_advantages') && profile.competitive_advantages) {
    parts.push(`Competitive Advantages: ${profile.competitive_advantages}`);
  }
  if (sections.includes('growth_priorities') && profile.growth_priorities) {
    parts.push(`Growth Priorities: ${profile.growth_priorities}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

function buildPrefilledPlanning(input: {
  campaign: { start_date?: string | null; duration_weeks?: number | null; description?: string | null; name?: string } | null;
  versionRow: {
    campaign_types?: string[];
    campaign_weights?: Record<string, number>;
    campaign_snapshot?: { planning_context?: { content_capacity?: Record<string, { perWeek?: number; creationMethod?: string }> }; target_regions?: string[]; context_payload?: { formats?: string[]; platforms?: string[] } };
  } | null;
}): Record<string, unknown> {
  const prefilled: Record<string, unknown> = {};
  const c = input.campaign;
  const v = input.versionRow;
  if (c?.start_date) prefilled.tentative_start = c.start_date;
  if (c?.duration_weeks != null) prefilled.campaign_duration = c.duration_weeks;
  if (v?.campaign_types?.length) {
    prefilled.campaign_types = v.campaign_types.map((t) => t.replace(/_/g, ' ')).join(', ');
  }
  if (v?.campaign_snapshot?.planning_context?.content_capacity) {
    const cap = v.campaign_snapshot.planning_context.content_capacity;
    const parts: string[] = [];
    for (const [fmt, val] of Object.entries(cap)) {
      if (val && typeof val === 'object' && 'perWeek' in val) {
        const p = val as { perWeek?: number; creationMethod?: string };
        parts.push(`${fmt}: ${p.perWeek ?? 0}/week (${p.creationMethod ?? 'manual'})`);
      }
    }
    if (parts.length) prefilled.content_capacity = parts.join('; ');
  }
  const payload = v?.campaign_snapshot?.context_payload;
  if (payload?.formats?.length) prefilled.suggested_formats = payload.formats.join(', ');
  if (payload?.platforms?.length) prefilled.platforms = payload.platforms.join(', ');
  if (v?.campaign_snapshot?.target_regions?.length) {
    prefilled.target_regions = v.campaign_snapshot.target_regions.join(', ');
  }
  if (c?.description) prefilled.theme_or_description = c.description.slice(0, 300);
  const execConfig = (v?.campaign_snapshot as Record<string, unknown> | undefined)?.execution_config;
  if (execConfig != null && typeof execConfig === 'object' && !Array.isArray(execConfig)) {
    prefilled.execution_config = execConfig;
  }
  return prefilled;
}

const DEFAULT_PLATFORM_STRATEGIES = [
  { platform_type: 'social', supported_content_types: ['post', 'story', 'video'], name: 'LinkedIn' },
  { platform_type: 'social', supported_content_types: ['post', 'story', 'reel'], name: 'Instagram' },
  { platform_type: 'social', supported_content_types: ['post', 'thread'], name: 'X (Twitter)' },
  { platform_type: 'social', supported_content_types: ['video', 'short'], name: 'YouTube' },
  { platform_type: 'social', supported_content_types: ['post', 'video'], name: 'Facebook' },
  { platform_type: 'social', supported_content_types: ['video', 'post'], name: 'TikTok' },
];

type PlatformContentTypePrefs = Record<string, string[]>;

function normalizePlatformKeyStrict(raw: string): string | null {
  const n = String(raw || '').toLowerCase().trim();
  if (!n) return null;
  if (n === 'twitter') return 'x';
  if (n === 'x') return 'x';
  if (n === 'linkedin') return 'linkedin';
  if (n === 'facebook') return 'facebook';
  if (n === 'instagram') return 'instagram';
  if (n === 'youtube') return 'youtube';
  if (n === 'tiktok') return 'tiktok';
  return null;
}

function normalizeContentTypeToken(raw: string): string | null {
  const n = String(raw || '').toLowerCase().trim();
  if (!n) return null;
  if (n.includes('blog') || n.includes('article')) return 'article';
  if (n.includes('slide')) return 'slideware';
  if (n.includes('carousel')) return 'carousel';
  if (n.includes('image')) return 'image';
  if (n.includes('song') || n.includes('audio')) return 'song';
  if (n.includes('thread')) return 'thread';
  if (n.includes('space')) return 'space';
  if (n.includes('short')) return 'short';
  if (n.includes('live')) return 'live';
  if (n.includes('reel')) return 'reel';
  if (n.includes('story')) return 'story';
  if (n.includes('video')) return 'video';
  if (n.includes('post')) return 'post';
  return n.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || null;
}

function parsePlatformContentTypesValue(value: unknown): PlatformContentTypePrefs | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    // Prefer JSON form: {"linkedin":["post","video"],"facebook":["post"]}
    if (t.startsWith('{') && t.endsWith('}')) {
      try {
        const obj = JSON.parse(t) as unknown;
        if (obj && typeof obj === 'object') {
          const out: PlatformContentTypePrefs = {};
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            const pk = normalizePlatformKeyStrict(k);
            if (!pk || !Array.isArray(v)) continue;
            const items = Array.from(new Set(v.map((x) => normalizeContentTypeToken(String(x))).filter(Boolean) as string[]));
            if (items.length > 0) out[pk] = items;
          }
          return Object.keys(out).length > 0 ? out : null;
        }
      } catch {
        // fall through
      }
    }
    // Semi-structured: "LinkedIn: post, video; Facebook: video"
    const rx = /(linkedin|facebook|instagram|youtube|tiktok|twitter|x)\s*:\s*([^;]+)/gi;
    const out: PlatformContentTypePrefs = {};
    let m: RegExpExecArray | null = null;
    while ((m = rx.exec(t)) !== null) {
      const pk = normalizePlatformKeyStrict(m[1]);
      if (!pk) continue;
      const rhs = String(m[2] || '').trim();
      const tokens = rhs
        .split(/[,/|]+/)
        .map((s) => normalizeContentTypeToken(s))
        .filter(Boolean) as string[];
      const uniq = Array.from(new Set(tokens));
      if (uniq.length > 0) out[pk] = uniq;
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  if (typeof value === 'object') {
    const out: PlatformContentTypePrefs = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const pk = normalizePlatformKeyStrict(k);
      if (!pk || !Array.isArray(v)) continue;
      const items = Array.from(new Set(v.map((x) => normalizeContentTypeToken(String(x))).filter(Boolean) as string[]));
      if (items.length > 0) out[pk] = items;
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  return null;
}

function extractPlatformContentTypesFromConversation(
  history: Array<{ type: string; message: string }> | undefined
): PlatformContentTypePrefs | null {
  if (!Array.isArray(history) || history.length === 0) return null;
  const recent = [...history].slice(-60);
  // Prefer the most recent user message that looks like a per-platform mapping.
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    if (m?.type !== 'user') continue;
    const text = String(m.message ?? '').trim();
    if (!text) continue;
    if (!/:\s*/.test(text)) continue;
    if (!/(linkedin|facebook|instagram|youtube|tiktok|twitter|\bx\b)/i.test(text)) continue;
    const parsed = parsePlatformContentTypesValue(text);
    if (parsed) return parsed;
  }
  return null;
}

function applyPlatformContentTypePrefsToWeeks(
  weeks: any[],
  prefs: PlatformContentTypePrefs
): any[] {
  if (!Array.isArray(weeks) || weeks.length === 0) return weeks;
  if (!prefs || Object.keys(prefs).length === 0) return weeks;

  const unionTypes = Array.from(
    new Set(Object.values(prefs).flat().map((t) => normalizeContentTypeToken(t)).filter(Boolean) as string[])
  );

  const hasNonEmptyBreakdown = (w: any): boolean => {
    const b = w?.platform_content_breakdown;
    if (!b || typeof b !== 'object') return false;
    return Object.values(b).some((arr: any) => Array.isArray(arr) && arr.length > 0);
  };

  return weeks.map((w: any) => {
    const next = { ...w };

    // Fill content_type_mix when absent/empty so weekly cards can display it.
    const mix = Array.isArray(next.content_type_mix) ? next.content_type_mix.filter(Boolean) : [];
    if (mix.length === 0 && unionTypes.length > 0) {
      next.content_type_mix = unionTypes;
    }

    // Fill platform_content_breakdown only when missing (AI output takes priority).
    if (!hasNonEmptyBreakdown(next)) {
      const allocation: Record<string, number> =
        next.platform_allocation && typeof next.platform_allocation === 'object' ? next.platform_allocation : {};
      const breakdown: Record<string, Array<{ type: string; count: number }>> = {};
      for (const [platformKey, rawCount] of Object.entries(allocation)) {
        const count = Number(rawCount);
        if (!Number.isFinite(count) || count <= 0) continue;
        const normalizedPlatform = normalizePlatformKeyStrict(platformKey) ?? platformKey.toLowerCase().trim();
        const types = prefs[normalizedPlatform] ?? [];
        if (!Array.isArray(types) || types.length === 0) continue;
        const countsByType: Record<string, number> = {};
        for (let i = 0; i < count; i++) {
          const t = normalizeContentTypeToken(types[i % types.length]) ?? 'post';
          countsByType[t] = (countsByType[t] ?? 0) + 1;
        }
        breakdown[platformKey] = Object.entries(countsByType).map(([type, c]) => ({ type, count: c }));
      }
      if (Object.keys(breakdown).length > 0) {
        next.platform_content_breakdown = breakdown as any;
      }
    }

    next.week_extras = {
      ...(next.week_extras && typeof next.week_extras === 'object' ? next.week_extras : {}),
      platform_content_types_selected: prefs,
    };

    return next;
  });
}

async function runWithContext(
  input: CampaignAiPlanInput,
  ctx: {
    snapshot: any;
    snapshot_hash: string;
    diagnostics: any;
    omnivyreDecision: DecisionResult;
    platformStrategies: any[];
    companyContext?: string | null;
    forcedContextBlock?: string | null;
    strategyDNA?: ReturnType<typeof buildCompanyStrategyDNA> | null;
    campaignIntentSummary?: {
      types: string[];
      weights: Record<string, number>;
      primary_type: string;
    } | null;
    baselineContext?: BaselineContextResult;
    prefilledPlanning?: Record<string, unknown>;
    planSkeleton?: PlanSkeleton | null;
    campaignStage?: string | null;
    psychologicalGoal?: string | null;
    momentum?: string | null;
    qaState?: {
      answeredKeys: string[];
      userConfirmed: boolean;
      nextQuestion: { key: string; question: string } | null;
      readyToGenerate?: boolean;
      allRequiredAnswered?: boolean;
      missingRequiredKeys?: string[];
    };
    /** Planning intelligence: distribution strategy for weekly/daily layer. Default AI_OPTIMIZED. */
    distributionStrategy?: DistributionStrategy;
    /** Human-readable reason for the selected strategy (explanation only). */
    distributionReason?: string;
    /** When true, skip alignment regeneration to reduce latency. */
    fastPath?: boolean;
    strategyMemory?: { preferred_tone?: string | null; preferred_platforms?: string[] } | null;
    strategyLearningProfile?: StrategyProfile | null;
    strategyLearningFromCache?: boolean;
    campaignContext?: CampaignContext | null;
    companyId?: string | null;
  }
): Promise<CampaignAiPlanResult> {
  let didParseFail = false;
  let didValidationFail = false;
  let regenerationTriggered = false;
  let fallbackTriggered = false;
  let generationMode: 'llm-generated' | 'fallback-placeholder' = 'llm-generated';
  let validationReasons: string[] = [];
  let alignmentScoreForDebug: number | null = null;

  const prefilledPrefs =
    parsePlatformContentTypesValue((ctx.prefilledPlanning as any)?.platform_content_types) ??
    parsePlatformContentTypesValue((ctx.prefilledPlanning as any)?.platform_content_type_preferences);
  const historyPrefs = extractPlatformContentTypesFromConversation(input.conversationHistory);
  const platformContentTypePrefs = prefilledPrefs ?? historyPrefs;
  const effectivePrefilledPlanning =
    platformContentTypePrefs && !(ctx.prefilledPlanning as any)?.platform_content_types
      ? { ...(ctx.prefilledPlanning ?? {}), platform_content_types: JSON.stringify(platformContentTypePrefs) }
      : (ctx.prefilledPlanning ?? null);

  const validationResult: CapacityValidationResult | null =
    (effectivePrefilledPlanning as any)?.validation_result ?? null;
  if (
    input.mode === 'generate_plan' &&
    ctx.qaState?.readyToGenerate &&
    validationResult?.status === 'invalid' &&
    !validationResult.override_confirmed
  ) {
    const suggested = validationResult.suggested_requested_by_platform
      ? `\n\nSuggested weekly counts by platform (one possible adjustment):\n${JSON.stringify(
          validationResult.suggested_requested_by_platform,
          null,
          2
        )}`
      : '';
    return {
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyre_decision: ctx.omnivyreDecision,
      conversationalResponse: `Capacity validation failed.\n\n- requested_total: ${validationResult.requested_total}/week\n- available_content_total: ${validationResult.available_content_total}\n- weekly_capacity_total: ${validationResult.weekly_capacity_total}\n- exclusive_campaigns_total: ${validationResult.exclusive_campaigns_total}\n- effective_capacity_total: ${validationResult.effective_capacity_total}\n- supply_total (available + effective capacity): ${validationResult.supply_total}\n- deficit: ${validationResult.deficit}\n\n${validationResult.explanation}${suggested}\n\nReply with an updated request (reduce counts), or reply "override capacity" to proceed anyway.`,
      raw_plan_text: '',
      validation_result: validationResult,
    };
  }

  // QA short-circuit: do NOT call the LLM until we are ready to generate.
  if (input.mode === 'generate_plan' && ctx.qaState && !ctx.qaState.readyToGenerate) {
    const forcedNextQuestion = ctx.qaState?.nextQuestion?.question ?? null;
    const waitingForConfirmation = !!ctx.qaState?.allRequiredAnswered && !ctx.qaState?.userConfirmed;
    const confirmationQuestion = 'I have everything I need. Would you like me to create your week plan now?';
    const fallbackQuestion =
      forcedNextQuestion ??
      (waitingForConfirmation ? confirmationQuestion : 'I still need a few details to build your plan.');

    return {
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyre_decision: ctx.omnivyreDecision,
      conversationalResponse: fallbackQuestion,
      raw_plan_text: '',
    };
  }

  const deriveTopicWeights = (
    topicsToCover: unknown,
    weeklyContextCapsule: unknown
  ): Array<{ topic: string; weight: number }> => {
    const rawTopics = Array.isArray(topicsToCover)
      ? topicsToCover.map((t) => String(t ?? '').trim()).filter(Boolean)
      : [];
    const uniqueTopics: string[] = [];
    const seen = new Set<string>();
    for (const t of rawTopics) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueTopics.push(t);
    }

    const capsule = weeklyContextCapsule && typeof weeklyContextCapsule === 'object'
      ? (weeklyContextCapsule as Record<string, unknown>)
      : null;
    const explicitByTopic = new Map<string, number>();
    const explicitRaw = capsule ? (capsule as any)?.topic_priorities ?? (capsule as any)?.topic_importance ?? null : null;
    if (Array.isArray(explicitRaw)) {
      for (const row of explicitRaw) {
        const topic = String((row as any)?.topic ?? (row as any)?.title ?? '').trim();
        const weightRaw = (row as any)?.weight ?? (row as any)?.importance ?? (row as any)?.priority;
        const w = Number(weightRaw);
        if (!topic) continue;
        if (!Number.isFinite(w)) continue;
        explicitByTopic.set(topic.toLowerCase(), Math.max(1, Math.min(3, Math.floor(w))));
      }
    }

    const parseExplicitWeightFromText = (topic: string): number | null => {
      const n = topic.toLowerCase();
      if (/\b(weight|importance)\s*[:=]\s*(\d)\b/.test(n)) {
        const m = n.match(/\b(?:weight|importance)\s*[:=]\s*(\d)\b/);
        const w = m ? Number(m[1]) : NaN;
        if (Number.isFinite(w)) return Math.max(1, Math.min(3, Math.floor(w)));
      }
      if (/\b(priority)\s*[:=]\s*(high|p1|1)\b/.test(n) || /\b(high priority|p1)\b/.test(n)) return 3;
      if (/\b(priority)\s*[:=]\s*(medium|p2|2)\b/.test(n) || /\b(medium priority|p2)\b/.test(n)) return 2;
      if (/\b(priority)\s*[:=]\s*(low|p3|3)\b/.test(n) || /\b(low priority|p3)\b/.test(n)) return 1;
      return null;
    };

    return uniqueTopics.map((topic, idx) => {
      const explicit =
        explicitByTopic.get(topic.toLowerCase()) ??
        parseExplicitWeightFromText(topic);
      const fallback = idx === 0 ? 3 : idx === 1 ? 2 : 1;
      const weight = explicit != null ? explicit : fallback;
      return { topic, weight };
    });
  };

  const weightedAssignment = (
    topicsWithWeights: Array<{ topic: string; weight: number }>,
    slotsCount: number
  ): Array<string | null> => {
    const topics = (topicsWithWeights || []).filter((t) => t?.topic);
    const nSlots = Math.max(0, Math.floor(slotsCount));
    if (nSlots === 0) return [];
    if (topics.length === 0) return Array.from({ length: nSlots }, () => null);

    const expanded: string[] = [];
    for (const t of topics) {
      const w = Math.max(1, Math.floor(Number(t.weight) || 1));
      for (let i = 0; i < w; i += 1) expanded.push(t.topic);
    }
    if (expanded.length === 0) return Array.from({ length: nSlots }, () => null);

    const uniqueTopics = topics.map((t) => t.topic);

    // Guarantee coverage: every topic appears at least once if slots allow.
    if (nSlots >= uniqueTopics.length) {
      const slots: string[] = [...uniqueTopics];
      const remaining = nSlots - slots.length;

      // Reduce the expanded pool by one per topic already placed (best-effort).
      const reduced: string[] = [];
      const usedOnce = new Map<string, number>(uniqueTopics.map((t) => [t, 1]));
      for (const t of expanded) {
        const u = usedOnce.get(t) ?? 0;
        if (u > 0) {
          usedOnce.set(t, u - 1);
          continue;
        }
        reduced.push(t);
      }
      const pool = reduced.length > 0 ? reduced : expanded;
      for (let i = 0; i < remaining; i += 1) {
        slots.push(pool[i % pool.length]!);
      }
      return slots.slice(0, nSlots);
    }

    const slots: string[] = [];
    for (let i = 0; i < nSlots; i += 1) {
      slots.push(expanded[i % expanded.length]!);
    }
    return slots;
  };

  const deterministicPlanSkeleton = (effectivePrefilledPlanning as any)?.deterministic_plan_skeleton ?? null;
  const hasDeterministicPlanSkeleton = !!(deterministicPlanSkeleton && typeof deterministicPlanSkeleton === 'object');

  let weeklyStrategyIntelligence: import('./weeklyStrategyIntelligenceService').WeeklyStrategyIntelligence | null = null;
  let strategy_bias: import('./strategyBiasService').StrategyBiasResult | null = null;
  try {
    weeklyStrategyIntelligence = await getWeeklyStrategyIntelligence(input.campaignId);
  } catch (_) {
    // Optional enrichment; do not fail plan generation
  }
  try {
    strategy_bias = await computeStrategyBias(input.campaignId);
  } catch (_) {
    // Advisory only; do not fail plan generation
  }

  // Closed-loop guarantee: always inject performance insights from the most recent campaign.
  // Looks up the previous campaign for this company if campaignId has no feedback yet.
  {
    let lastCampaignId: string | null = input.campaignId ?? null;
    if (!lastCampaignId && ctx.companyId) {
      try {
        const { data: prev } = await supabase
          .from('campaigns')
          .select('id')
          .eq('company_id', ctx.companyId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        lastCampaignId = (prev as { id?: string } | null)?.id ?? null;
      } catch (_) { /* continue */ }
    }
    if (lastCampaignId) {
      try {
        (input as any).previous_performance_insights =
          await generatePerformanceInsights(lastCampaignId);
      } catch (_) { /* continue without insights */ }
    }
  }

  const execConfig = effectivePrefilledPlanning?.execution_config as Record<string, unknown> | null | undefined;
  const rawDuration =
    execConfig != null && typeof execConfig.campaign_duration === 'number'
      ? Math.floor(Number(execConfig.campaign_duration))
      : (effectivePrefilledPlanning?.campaign_duration as number) ?? 12;
  const durationFromPrefilled = Math.max(1, Math.min(52, Number.isFinite(rawDuration) ? rawDuration : 12));
  const platformNames = (ctx.platformStrategies ?? []).map((p: { name?: string }) => p?.name ?? 'linkedin').filter(Boolean);
  const platforms = platformNames.length > 0 ? platformNames : ['linkedin'];
  const postingFreq: Record<string, number> = {};
  for (const p of platforms) {
    postingFreq[p] = 3;
  }

  const baseDescription = [
    input.message,
    effectivePrefilledPlanning && Object.keys(effectivePrefilledPlanning).length > 0
      ? `Prefilled: ${JSON.stringify(effectivePrefilledPlanning)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const strategy_context = normalizeStrategyContext({
    duration_weeks: durationFromPrefilled,
    platforms,
    posting_frequency: postingFreq,
  });

  const planningInput = {
    companyId: ctx.companyId ?? '',
    idea_spine: {
      refined_title: 'Campaign plan',
      refined_description: baseDescription,
      selected_angle: input.message || null,
    },
    strategy_context,
    campaign_direction: input.message || 'Generate campaign plan',
    account_context: input.account_context || null,
    previous_performance_insights: input.previous_performance_insights ?? null,
    previous_campaign_context: input.previous_campaign_context ?? null,
  };

  // Refresh account context before planning so authority score and engagement trends are current
  if (ctx.companyId) {
    await refreshAccountContext(ctx.companyId).catch(() => { /* non-blocking */ });
  }

  const { rawOutput } = await generateCampaignPlanAI(planningInput);

  let raw = rawOutput || '';
  let hasPlanMarker = raw.includes('BEGIN_12WEEK_PLAN') && raw.includes('END_12WEEK_PLAN');

  if (input.mode === 'generate_plan' && input.conversationHistory?.length) {
    const forcedNextQuestion = ctx.qaState?.nextQuestion?.question;
    const waitingForConfirmation = !!ctx.qaState?.allRequiredAnswered && !ctx.qaState?.userConfirmed;
    const confirmationQuestion = 'I have everything I need. Would you like me to create your week plan now?';

    // Hard ready-to-generate gate: ignore plan marker unless backend says generation is allowed.
    if (hasPlanMarker && !ctx.qaState?.readyToGenerate) {
      const fallbackQuestion =
        forcedNextQuestion ??
        (waitingForConfirmation ? confirmationQuestion : 'I still need a few details to build your plan.');
      return {
        mode: input.mode,
        snapshot_hash: ctx.snapshot_hash,
        omnivyre_decision: ctx.omnivyreDecision,
        conversationalResponse: fallbackQuestion,
        raw_plan_text: raw,
      };
    }

    if (raw && !hasPlanMarker && !ctx.qaState?.readyToGenerate) {
      let authoritativeResponse = raw;
      if (waitingForConfirmation) {
        authoritativeResponse = confirmationQuestion;
      } else if (forcedNextQuestion) {
        // Server-side question authority: always use backend's exact question (includes profile-based examples).
        authoritativeResponse = forcedNextQuestion;
      }
      return {
        mode: input.mode,
        snapshot_hash: ctx.snapshot_hash,
        omnivyre_decision: ctx.omnivyreDecision,
        conversationalResponse: authoritativeResponse,
        raw_plan_text: raw,
      };
    }
  }

  const planMatch = raw.match(/BEGIN_12WEEK_PLAN([\s\S]*?)END_12WEEK_PLAN/);
  const planText = planMatch ? planMatch[1].trim() : raw;
  if (input.mode === 'generate_plan') {
    console.info('[campaign-ai][llm-raw-preview-extended]', {
      first3000: raw.slice(0, 3000),
    });
  }
  if (input.mode === 'refine_day') {
    const dayPlan = await parseAiRefinedDay(raw);

    await saveStructuredCampaignPlanDayUpdate({
      campaignId: input.campaignId,
      snapshot_hash: ctx.snapshot_hash,
      dayPlan,
      omnivyre_decision: ctx.omnivyreDecision,
      raw_plan_text: raw,
    });

    const companyIdForHealth = ctx.companyId ?? '';
    if (companyIdForHealth) {
      evaluateAndPersistCampaignHealth(input.campaignId, companyIdForHealth).catch((e) =>
        console.warn('[campaign-ai] health evaluation after day update:', e)
      );
    }

    return {
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyre_decision: ctx.omnivyreDecision,
      day: dayPlan,
      raw_plan_text: raw,
    };
  }

  if (input.mode === 'platform_customize') {
    const customization = await parseAiPlatformCustomization(raw);

    await savePlatformCustomizedContent({
      campaignId: input.campaignId,
      snapshot_hash: ctx.snapshot_hash,
      day: customization.day,
      platforms: customization.platforms,
      omnivyre_decision: ctx.omnivyreDecision,
      raw_plan_text: raw,
    });

    return {
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyre_decision: ctx.omnivyreDecision,
      platform_content: customization,
      raw_plan_text: raw,
    };
  }

  let structured;
  let autopilotResult: CampaignAiPlanResult['autopilot_result'] | undefined;
  try {
    structured = await parseAndValidateCampaignPlan({
      companyId: ctx.companyId ?? '',
      rawOutput: raw,
    });
  } catch (parseError) {
    didParseFail = true;
    const detectedWeeks = (planText.match(/(?:\*\*?\s*Week\s+\d+\s*\*\*?:?|(?:^|\n)\s*Week\s+\d+\s*:|(?:^|\n)\s*\d+\.\s*Week Number:\s*Week\s+\d+)/gim) || []).length;
    const missingSections: string[] = [];
    if (!/week/i.test(planText)) missingSections.push('week headers');
    if (!/objective/i.test(planText)) missingSections.push('objective');
    if (!/theme|topics?\s*to\s*cover/i.test(planText)) missingSections.push('theme/topic');
    console.warn('[campaign-ai][parse-debug]', {
      rawLength: planText.length,
      parserStage: 'parseAiPlanToWeeks-throw',
      detectedWeeks,
      parseError: parseError instanceof Error ? parseError.message : String(parseError),
      missingSections,
    });
    if (input.mode === 'generate_plan' && hasDeterministicPlanSkeleton) {
      throw parseError;
    }
    if (input.mode === 'generate_plan' && ctx.planSkeleton) {
      try {
        regenerationTriggered = true;
        const repairInstruction = 'Your previous output could not be parsed. Regenerate using the deterministic skeleton exactly. Keep BEGIN_12WEEK_PLAN/END_12WEEK_PLAN and output a strict weekly blueprint.\n' + `Skeleton JSON:\n${canonicalJsonStringify(ctx.planSkeleton)}`;
        const repairInput = {
          ...planningInput,
          repair_instruction: repairInstruction,
        };
        const { rawOutput: repairedRaw } = await generateCampaignPlanAI(repairInput);
        structured = await parseAndValidateCampaignPlan({
          companyId: ctx.companyId ?? '',
          rawOutput: repairedRaw,
        });
      } catch (regenParseErr) {
        console.warn('Plan parse + regeneration failed, using deterministic placeholder fallback:', regenParseErr);
        fallbackTriggered = true;
        generationMode = 'fallback-placeholder';
        structured = buildPlaceholderPlanFromSkeleton({
          skeleton: ctx.planSkeleton,
          prefilledPlanning: ctx.prefilledPlanning ?? null,
        }) as any;
      }
    } else {
      console.warn('Plan parse failed, treating as conversational:', parseError);
      return {
        mode: input.mode,
        snapshot_hash: ctx.snapshot_hash,
        omnivyre_decision: ctx.omnivyreDecision,
        conversationalResponse: planText || raw,
        raw_plan_text: raw,
      };
    }
  }

  if (input.mode === 'generate_plan' && ctx.planSkeleton) {
    const validation = validatePlanAgainstSkeleton(structured, ctx.planSkeleton);
    if (!validation.ok) {
      didValidationFail = true;
      validationReasons = validation.reasons;
      console.warn('[campaign-ai][validation-failed]', {
        reasons: validation.reasons,
      });
      const repairInstruction = `Your previous plan violated deterministic skeleton constraints: ${validation.reasons.join('; ')}.\nRegenerate the plan exactly with this skeleton and keep the same wrapper markers.\n` + `Skeleton JSON:\n${canonicalJsonStringify(ctx.planSkeleton)}`;
      try {
        regenerationTriggered = true;
        const repairInput = {
          ...planningInput,
          repair_instruction: repairInstruction,
        };
        const { rawOutput: repairedRaw } = await generateCampaignPlanAI(repairInput);
        structured = await parseAndValidateCampaignPlan({
          companyId: ctx.companyId ?? '',
          rawOutput: repairedRaw,
        });
        const repairedValidation = validatePlanAgainstSkeleton(structured, ctx.planSkeleton);
        if (!repairedValidation.ok) {
          validationReasons = repairedValidation.reasons;
          fallbackTriggered = true;
          generationMode = 'fallback-placeholder';
          structured = buildPlaceholderPlanFromSkeleton({
            skeleton: ctx.planSkeleton,
            prefilledPlanning: ctx.prefilledPlanning ?? null,
          }) as any;
        }
      } catch (regenErr) {
        console.warn('Deterministic regeneration failed, using placeholder skeleton:', regenErr);
        fallbackTriggered = true;
        generationMode = 'fallback-placeholder';
        structured = buildPlaceholderPlanFromSkeleton({
          skeleton: ctx.planSkeleton,
          prefilledPlanning: ctx.prefilledPlanning ?? null,
        }) as any;
      }
    }
  }

  if (input.mode === 'generate_plan') {
    structured = normalizeStructuredPlanForOutput({
      structured,
      planSkeleton: ctx.planSkeleton ?? null,
    });
  }

  let alignmentResult: AlignmentEvaluation | null = null;
  if (input.mode === 'generate_plan') {
    try {
      alignmentResult = await evaluateWeeklyAlignment({
        campaignId: input.campaignId,
        recommendationContext: input.recommendationContext ?? null,
        campaignStage: ctx.campaignStage ?? null,
        psychologicalGoal: ctx.psychologicalGoal ?? null,
        momentum: ctx.momentum ?? null,
        normalizedWeeks: structured.weeks || [],
      });
      alignmentScoreForDebug = alignmentResult.alignmentScore;
    } catch (e) {
      console.warn('Alignment evaluation failed, continuing with plan:', e);
    }

    if (
      !ctx.fastPath &&
      alignmentResult &&
      alignmentResult.alignmentScore < ALIGNMENT_ACCEPT_THRESHOLD &&
      ctx.planSkeleton
    ) {
      regenerationTriggered = true;
      const regenInstruction =
        'Alignment score is below threshold. Improve intelligence fields only based on issues below.\n' +
        'Do NOT change week count or required deliverable quantities.\n' +
        `Issues: ${alignmentResult.issues.join('; ') || 'General alignment improvement required'}\n` +
        `Suggested adjustments: ${canonicalJsonStringify(alignmentResult.suggestedAdjustments)}\n` +
        `Skeleton JSON:\n${canonicalJsonStringify(ctx.planSkeleton)}`;

      try {
        const regenInput = {
          ...planningInput,
          repair_instruction: regenInstruction,
        };
        const { rawOutput: regeneratedRaw } = await generateCampaignPlanAI(regenInput);
        let regeneratedStructured = await parseAndValidateCampaignPlan({
          companyId: ctx.companyId ?? '',
          rawOutput: regeneratedRaw,
        });
        const regenValidation = validatePlanAgainstSkeleton(regeneratedStructured, ctx.planSkeleton);
        if (regenValidation.ok) {
          regeneratedStructured = normalizeStructuredPlanForOutput({
            structured: regeneratedStructured as any,
            planSkeleton: ctx.planSkeleton,
          }) as any;
          try {
            const regeneratedAlignment = await evaluateWeeklyAlignment({
              campaignId: input.campaignId,
              recommendationContext: input.recommendationContext ?? null,
              campaignStage: ctx.campaignStage ?? null,
              psychologicalGoal: ctx.psychologicalGoal ?? null,
              momentum: ctx.momentum ?? null,
              normalizedWeeks: regeneratedStructured.weeks || [],
            });
            if (regeneratedAlignment.alignmentScore >= (alignmentResult?.alignmentScore ?? 0)) {
              structured = regeneratedStructured;
              alignmentResult = regeneratedAlignment;
              alignmentScoreForDebug = regeneratedAlignment.alignmentScore;
            }
          } catch (reEvalErr) {
            console.warn('Regenerated alignment evaluation failed, keeping best available plan:', reEvalErr);
          }
        }
      } catch (regenErr) {
        console.warn('Alignment regeneration failed, accepting best available plan:', regenErr);
      }
    }
  }

  if (input.mode === 'generate_plan') {
    structured = enrichWeeklyWritingContext({
      structured,
      recommendationContext: input.recommendationContext ?? null,
      prefilledPlanning: effectivePrefilledPlanning,
      campaignStage: ctx.campaignStage ?? null,
      psychologicalGoal: ctx.psychologicalGoal ?? null,
      momentum: ctx.momentum ?? null,
      alignment: alignmentResult,
    });
    if (platformContentTypePrefs) {
      structured = {
        ...structured,
        weeks: applyPlatformContentTypePrefsToWeeks(structured.weeks, platformContentTypePrefs),
      };
    }
    if (hasDeterministicPlanSkeleton && Array.isArray(structured?.weeks)) {
      const baseExecutionItems: any[] = Array.isArray((deterministicPlanSkeleton as any)?.execution_items)
        ? ((deterministicPlanSkeleton as any).execution_items as any[])
        : [];
      const normalizeTopics = (topics: unknown): string[] =>
        Array.isArray(topics) ? topics.map((t) => String(t ?? '').trim()).filter(Boolean) : [];

      const deriveWritingAngle = (input: { themeRaw: unknown; topicRaw: unknown }): string | null => {
        const t = String(input.themeRaw ?? '').toLowerCase();
        const topic = String(input.topicRaw ?? '').toLowerCase();
        if (!t.trim()) return null;
        if (topic.includes('how') || topic.includes('guide') || topic.includes('tutorial')) return 'education';
        if (topic.includes('case study') || topic.includes('proof') || topic.includes('results')) return 'authority';
        if (topic.includes('pricing') || topic.includes('demo') || topic.includes('book') || topic.includes('signup')) return 'conversion';
        if (topic.includes('why') || topic.includes('what is') || topic.includes('problem')) return 'awareness';
        if (t.includes('awareness')) return 'awareness';
        if (t.includes('authority') || t.includes('trust')) return 'authority';
        if (t.includes('conversion') || t.includes('lead') || t.includes('pipeline')) return 'conversion';
        if (t.includes('engage') || t.includes('community')) return 'engagement';
        if (t.includes('education') || t.includes('how-to')) return 'education';
        return null;
      };

      const deriveStrategicRole = (writingAngle: string | null): string => {
        if (writingAngle === 'education') return 'Authority Building';
        if (writingAngle === 'awareness') return 'Audience Expansion';
        if (writingAngle === 'conversion') return 'Demand Capture';
        if (writingAngle === 'engagement') return 'Community Interaction';
        return 'Strategic Support';
      };

      const normalizeText = (raw: unknown): string =>
        String(raw ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const tokenize = (raw: unknown): string[] => {
        const t = normalizeText(raw);
        if (!t) return [];
        const stop = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'their', 'into', 'within', 'why', 'what', 'how', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'by']);
        return t
          .split(' ')
          .map((w) => w.trim())
          .filter((w) => w.length >= 3 && !stop.has(w));
      };

      const matchScore = (topicRaw: unknown, candidateRaw: unknown): number => {
        const topic = normalizeText(topicRaw);
        const cand = normalizeText(candidateRaw);
        if (!topic || !cand) return 0;
        if (topic.includes(cand) || cand.includes(topic)) return 1.0;
        const a = tokenize(topic);
        const b = tokenize(cand);
        if (a.length === 0 || b.length === 0) return 0;
        const setB = new Set(b);
        let overlap = 0;
        for (const w of a) if (setB.has(w)) overlap += 1;
        const denom = Math.max(1, Math.min(a.length, b.length));
        const ratio = overlap / denom;
        if (overlap >= 2 && ratio >= 0.4) return ratio;
        return 0;
      };

      const pickBestMatch = (topic: string | null, candidates: string[]): { value: string | null; score: number } => {
        let best: { value: string | null; score: number } = { value: null, score: 0 };
        for (const c of candidates) {
          const s = matchScore(topic, c);
          if (s > best.score) best = { value: c, score: s };
        }
        return best;
      };

      const extractRecommendationAlignmentSources = (): {
        primary_topic: string | null;
        messaging_hooks: string[];
        campaign_angle: string | null;
        pain_symptoms: string[];
      } => {
        const payload = (input.recommendationContext?.context_payload ?? {}) as any;
        const intelligence = (payload?.intelligence ?? payload?.recommendation_intelligence ?? null) as any;
        const companySnap = (payload?.company_context_snapshot ?? payload?.companyContextSnapshot ?? null) as any;

        const primary_topic =
          String(payload?.polished_title ?? payload?.polishedTitle ?? payload?.trend_topic ?? payload?.trendTopic ?? payload?.topic ?? payload?.title ?? '')
            .trim() || null;

        const hooksRaw =
          payload?.messaging_hooks ??
          payload?.messagingHooks ??
          intelligence?.messaging_hooks ??
          intelligence?.messagingHooks ??
          null;
        const messaging_hooks = Array.isArray(hooksRaw)
          ? hooksRaw.map((h: any) => String(h ?? '').trim()).filter(Boolean)
          : typeof hooksRaw === 'string'
            ? hooksRaw
                .split(/\n|;|,|\u2022/g)
                .map((s: string) => s.trim())
                .filter(Boolean)
            : [];

        const campaign_angle =
          String(payload?.campaign_angle ?? payload?.campaignAngle ?? intelligence?.campaign_angle ?? intelligence?.campaignAngle ?? '').trim() ||
          null;

        const painRaw =
          companySnap?.pain_symptoms ??
          companySnap?.painSymptoms ??
          payload?.pain_symptoms ??
          payload?.painSymptoms ??
          intelligence?.problem_being_solved ??
          intelligence?.problemBeingSolved ??
          null;
        const pain_symptoms = Array.isArray(painRaw)
          ? painRaw.map((p: any) => String(p ?? '').trim()).filter(Boolean)
          : typeof painRaw === 'string'
            ? painRaw
                .split(/\n|;|\u2022/g)
                .map((s: string) => s.trim())
                .filter(Boolean)
            : [];

        return { primary_topic, messaging_hooks, campaign_angle, pain_symptoms };
      };

      const buildRecommendationAlignment = (params: {
        topic: string | null;
        sources: ReturnType<typeof extractRecommendationAlignmentSources>;
      }): { source_type: string; source_value: string; alignment_reason: string } => {
        const topic = String(params.topic ?? '').trim();
        const { primary_topic, messaging_hooks, campaign_angle, pain_symptoms } = params.sources;

        // A) messaging_hook
        const bestHook = pickBestMatch(topic, messaging_hooks);
        if (bestHook.value && bestHook.score > 0) {
          const source_type = 'messaging_hook';
          const source_value = bestHook.value;
          return {
            source_type,
            source_value,
            alignment_reason: `This topic supports ${source_type} by addressing ${topic} within the campaign theme.`,
          };
        }
        // B) campaign_angle
        if (campaign_angle && matchScore(topic, campaign_angle) > 0) {
          const source_type = 'campaign_angle';
          const source_value = campaign_angle;
          return {
            source_type,
            source_value,
            alignment_reason: `This topic supports ${source_type} by addressing ${topic} within the campaign theme.`,
          };
        }
        // C) pain_symptom
        const bestPain = pickBestMatch(topic, pain_symptoms);
        if (bestPain.value && bestPain.score > 0) {
          const source_type = 'pain_symptom';
          const source_value = bestPain.value;
          return {
            source_type,
            source_value,
            alignment_reason: `This topic supports ${source_type} by addressing ${topic} within the campaign theme.`,
          };
        }
        // D) primary_topic (required)
        const source_type = 'primary_topic';
        const source_value = primary_topic || topic || 'campaign topic';
        return {
          source_type,
          source_value,
          alignment_reason: `This topic supports ${source_type} by addressing ${topic || source_value} within the campaign theme.`,
        };
      };

      const derivePainPoint = (input: { keyMessages: unknown; topic: string | null }): string => {
        const km = String(input.keyMessages ?? '').trim();
        if (km) {
          const first = km
            .split(/\n|;|\.|\u2022|- /g)
            .map((s) => s.trim())
            .filter(Boolean)[0];
          if (first) return first.slice(0, 180);
        }
        const topic = String(input.topic ?? '').trim();
        const t = topic.toLowerCase();
        if (t.includes('pricing')) return 'Unclear value and pricing expectations';
        if (t.includes('onboarding')) return 'Slow onboarding and time-to-value';
        if (t.includes('trust') || t.includes('credibility')) return 'Low trust in the solution';
        if (t.includes('lead') || t.includes('pipeline')) return 'Inconsistent lead flow';
        if (topic) return `Uncertainty about ${topic}`;
        return 'Unclear next steps and priorities';
      };

      const deriveOutcomePromise = (topic: string | null): string => {
        const t = String(topic ?? '').trim();
        const safe = t || 'this topic';
        return `Reader understands ${safe} and why it matters.`;
      };

      const pickBriefSummary = (w: any, topicTitle: string): string | null => {
        const tt = String(topicTitle ?? '').trim();
        if (!tt) return null;
        const briefs: any[] = Array.isArray(w?.topics) ? w.topics : [];
        const match = briefs.find((b) => String(b?.topicTitle ?? b?.title ?? '').trim() === tt);
        const candidate = String(
          match?.brief_summary ??
            match?.briefSummary ??
            match?.topicContext?.writingIntent ??
            match?.topicContext?.brief_summary ??
            ''
        ).trim();
        return candidate || null;
      };

      const deriveCampaignStageForWeek = (weekOrdinal: number): string => {
        if (weekOrdinal <= 1) return 'awareness';
        if (weekOrdinal === 2) return 'education';
        if (weekOrdinal === 3) return 'consideration';
        return 'conversion';
      };

      const deriveAudienceAwarenessTarget = (campaign_stage: string): string => {
        if (campaign_stage === 'awareness') return 'problem_aware';
        if (campaign_stage === 'education') return 'solution_aware';
        if (campaign_stage === 'consideration') return 'product_aware';
        return 'most_aware';
      };

      const deriveWeekTheme = (w: any, weekOrdinal: number): string => {
        const direct = String(w?.theme ?? '').trim();
        if (direct) return direct;
        const fromPhase = String(w?.phase_label ?? w?.phaseLabel ?? '').trim();
        if (fromPhase) return fromPhase;
        const fromTopicFocus = String(w?.topic_focus ?? w?.topicFocus ?? w?.week_extras?.topic_focus ?? w?.week_extras?.topicFocus ?? '').trim();
        if (fromTopicFocus) return fromTopicFocus;
        const topicsToCover: any[] = Array.isArray(w?.topics_to_cover) ? w.topics_to_cover : Array.isArray(w?.topicsToCover) ? w.topicsToCover : [];
        const firstTopic = String(topicsToCover[0] ?? '').trim();
        if (firstTopic) return firstTopic;
        return `Week ${weekOrdinal} focus`;
      };

      const deriveWeeklyNarrativeSpine = (input: { campaign_stage: string; audience_awareness_target: string; theme: string; objective: string }): string => {
        return `Stage ${input.campaign_stage}: use "${input.theme}" to move the audience to ${input.audience_awareness_target} while advancing "${input.objective}".`;
      };

      const ensureNonEmptyString = (value: unknown): string | null => {
        const s = typeof value === 'string' ? value : String(value ?? '');
        const t = s.trim();
        return t ? t : null;
      };

      structured = {
        ...structured,
        weeks: (structured.weeks || []).map((w: any, idx: number) => {
          if (!Array.isArray(baseExecutionItems) || baseExecutionItems.length === 0) {
            throw new Error('DETERMINISTIC_TOPIC_SLOT_COUNT_MISMATCH');
          }

          const weekOrdinalRaw = Number((w as any)?.week ?? (w as any)?.week_number ?? (w as any)?.weekNumber ?? idx + 1);
          const weekOrdinal = Number.isFinite(weekOrdinalRaw) && weekOrdinalRaw > 0 ? Math.floor(weekOrdinalRaw) : idx + 1;
          const campaign_stage = deriveCampaignStageForWeek(weekOrdinal);
          const audience_awareness_target = deriveAudienceAwarenessTarget(campaign_stage);
          const theme = deriveWeekTheme(w, weekOrdinal);

          const objectiveRaw =
            ensureNonEmptyString((w as any)?.primary_objective ?? (w as any)?.objective) ??
            ensureNonEmptyString((effectivePrefilledPlanning as any)?.campaign_goal ?? (effectivePrefilledPlanning as any)?.key_messages) ??
            ensureNonEmptyString((effectivePrefilledPlanning as any)?.execution_config?.campaign_goal);
          if (!objectiveRaw) {
            throw new Error('DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');
          }
          const weekly_narrative_spine = deriveWeeklyNarrativeSpine({
            campaign_stage,
            audience_awareness_target,
            theme,
            objective: objectiveRaw,
          });

          const okWeekMeta =
            ensureNonEmptyString(theme) &&
            ensureNonEmptyString(campaign_stage) &&
            ensureNonEmptyString(weekly_narrative_spine) &&
            ensureNonEmptyString(audience_awareness_target);
          if (!okWeekMeta) {
            throw new Error('DETERMINISTIC_WEEK_META_REQUIRED');
          }

          const weeklyCapsule =
            (w as any)?.weeklyContextCapsule ??
            (w as any)?.week_extras?.weeklyContextCapsule ??
            (w as any)?.weekly_context_capsule ??
            null;
          const topicsWithWeights = deriveTopicWeights(w?.topics_to_cover ?? w?.topicsToCover ?? [], weeklyCapsule);
          const totalSlots = baseExecutionItems.reduce((sum, it) => sum + (Number(it?.count_per_week ?? 0) || 0), 0);
          const allSlots = weightedAssignment(topicsWithWeights, totalSlots);
          let cursor = 0;
            const campaignIdForMasterContent = String(input.campaignId ?? '').trim() || 'campaign';
          /** Deterministic day assignment in weekly plan — no daily distribution logic. Spread slots across Mon–Sun. */
          const spreadDaysForCount = (n: number, days = 7): number[] => {
            const c = Math.max(0, Math.floor(n));
            if (c <= 0) return [];
            if (c === 1) return [1];
            const out: number[] = [];
            for (let i = 0; i < c; i += 1) {
              const idx0 = Math.round(((i + 0.5) * days) / c - 0.5);
              const clamped = Math.min(days - 1, Math.max(0, idx0));
              out.push(clamped + 1);
            }
            return out;
          };
          const execution_items = baseExecutionItems.map((it, execIdx: number) => {
            const count = Number(it?.count_per_week ?? 0) || 0;
            const c = Math.max(0, Math.floor(count));
            if (c <= 0) {
              throw new Error('DETERMINISTIC_TOPIC_SLOT_COUNT_MISMATCH');
            }
            const slotTopics = allSlots.slice(cursor, cursor + c).map((t) => (t == null ? null : String(t)));
            cursor += c;
            if (slotTopics.length !== c) {
              throw new Error('DETERMINISTIC_TOPIC_SLOT_COUNT_MISMATCH');
            }
            const dayIndices = spreadDaysForCount(c, 7);

            const contentTypeForId = String(it?.content_type ?? 'post').toLowerCase().replace(/\s+/g, '_');
            const objective =
              ensureNonEmptyString(w?.primary_objective ?? w?.objective) ??
              ensureNonEmptyString((effectivePrefilledPlanning as any)?.campaign_goal ?? (effectivePrefilledPlanning as any)?.key_messages) ??
              ensureNonEmptyString((effectivePrefilledPlanning as any)?.execution_config?.campaign_goal);
            const cta_type =
              ensureNonEmptyString(w?.cta_type ?? w?.ctaType) ??
              ensureNonEmptyString((effectivePrefilledPlanning as any)?.action_expectation) ??
              ensureNonEmptyString((effectivePrefilledPlanning as any)?.execution_config?.action_expectation);
            const target_audience =
              ensureNonEmptyString(w?.target_audience ?? w?.targetAudience ?? (effectivePrefilledPlanning as any)?.target_audience) ??
              ensureNonEmptyString((effectivePrefilledPlanning as any)?.execution_config?.target_audience);
            if (!objective || !cta_type || !target_audience) {
              throw new Error('DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');
            }
            const keyMessages = (effectivePrefilledPlanning as any)?.key_messages ?? null;
            const alignmentSources = extractRecommendationAlignmentSources();
            return {
              ...it,
              topic_slots: slotTopics.map((topic, slotIndex: number) => {
                const topicString = ensureNonEmptyString(topic);
                if (!topicString) {
                  throw new Error('DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');
                }
                const writingAngle = deriveWritingAngle({
                  themeRaw: theme,
                  topicRaw: topicString,
                });
                const strategic_role = deriveStrategicRole(writingAngle);
                const pain_point = derivePainPoint({ keyMessages, topic: topicString });
                const outcome_promise = deriveOutcomePromise(topicString);

                const brief_summary =
                  pickBriefSummary(w, topicString) ??
                  `Address "${topicString}" within the "${theme}" narrative for ${target_audience}.`;

                const overrideAudienceStage = ensureNonEmptyString((it as any)?.audience_stage ?? null);
                const audience_stage = overrideAudienceStage || audience_awareness_target;

                const recAlign = buildRecommendationAlignment({ topic: topicString, sources: alignmentSources });

                const intent = {
                  objective,
                  cta_type,
                  target_audience,
                  writing_angle: topicString ? writingAngle : null,
                  brief_summary,
                  strategic_role,
                  pain_point,
                  outcome_promise,
                  audience_stage,
                  recommendation_alignment: {
                    source_type: recAlign.source_type,
                    source_value: recAlign.source_value,
                    alignment_reason: recAlign.alignment_reason,
                  },
                };

                const okIntent =
                  ensureNonEmptyString(intent.objective) &&
                  ensureNonEmptyString(intent.cta_type) &&
                  ensureNonEmptyString(intent.target_audience) &&
                  ensureNonEmptyString(intent.strategic_role) &&
                  ensureNonEmptyString(intent.pain_point) &&
                  ensureNonEmptyString(intent.outcome_promise) &&
                  ensureNonEmptyString(intent.audience_stage) &&
                  ensureNonEmptyString(intent.recommendation_alignment?.source_type) &&
                  ensureNonEmptyString(intent.recommendation_alignment?.source_value) &&
                  ensureNonEmptyString(intent.recommendation_alignment?.alignment_reason);
                if (!okIntent) {
                  throw new Error('DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');
                }

                const master_content_id = `${campaignIdForMasterContent}_w${weekOrdinal}_${contentTypeForId}_${execIdx}_${slotIndex}`;
                // Normalization (trim, lower, remove separators) is inside inferExecutionMode so video_short/short-video/Video map consistently.
                const execution_mode = inferExecutionMode(String(it?.content_type ?? 'post'));
                const creator_instruction =
                  execution_mode === 'CREATOR_REQUIRED' || execution_mode === 'CONDITIONAL_AI'
                    ? buildCreatorInstruction(topicString, intent, String(it?.content_type ?? 'post'), execution_mode)
                    : undefined;
                const day_index = dayIndices[slotIndex] ?? 1;
                return {
                  topic: topicString,
                  progression_step: slotIndex + 1,
                  global_progression_index: 0,
                  day_index,
                  // strategic enrichment (deterministic)
                  intent,
                  master_content_id,
                  execution_mode,
                  ...(creator_instruction ? { creator_instruction } : {}),
                };
              }),
            };
          });

          // Slot-level consistency: mismatch would confuse ownership coloring; log for diagnostics.
          for (const exec of execution_items) {
            const expected = Math.max(0, Math.floor(Number(exec?.count_per_week ?? 0)));
            const actual = Array.isArray(exec?.topic_slots) ? exec.topic_slots.length : 0;
            if (expected !== actual) {
              console.warn('[execution_mode] count_per_week !== topic_slots.length', {
                content_type: exec?.content_type,
                count_per_week: expected,
                topic_slots_length: actual,
              });
            }
          }

          // Global weekly progression: assign a deterministic narrative order across ALL execution items.
          // Ordering: progression_step asc, execution_item order asc, slot index asc.
          const globalSlots: Array<{ execIdx: number; slotIdx: number; progression_step: number; slot: any }> = [];
          for (let execIdx = 0; execIdx < execution_items.length; execIdx += 1) {
            const exec = execution_items[execIdx];
            const slots = Array.isArray(exec?.topic_slots) ? exec.topic_slots : null;
            if (!slots) throw new Error('DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');
            for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
              const slot = slots[slotIdx];
              const progression_step = Number(slot?.progression_step);
              if (!slot || !Number.isFinite(progression_step) || progression_step < 1 || !slot.intent) {
                throw new Error('DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');
              }
              globalSlots.push({ execIdx, slotIdx, progression_step, slot });
            }
          }
          globalSlots.sort((a, b) => a.progression_step - b.progression_step || a.execIdx - b.execIdx || a.slotIdx - b.slotIdx);
          for (let i = 0; i < globalSlots.length; i += 1) {
            globalSlots[i]!.slot.global_progression_index = i + 1;
          }
          for (const g of globalSlots) {
            const n = Number(g.slot?.global_progression_index);
            if (!Number.isFinite(n) || n < 1) {
              throw new Error('DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');
            }
          }

          for (const exec of execution_items) {
            const slots = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
            const expected = Math.max(0, Math.floor(Number(exec?.count_per_week ?? 0) || 0));
            if (!expected || slots.length !== expected) {
              throw new Error('DETERMINISTIC_TOPIC_SLOT_COUNT_MISMATCH');
            }
            for (const slot of slots) {
              const topic = ensureNonEmptyString(slot?.topic);
              if (!topic) throw new Error('DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');
              const progression_step = Number(slot?.progression_step);
              if (!Number.isFinite(progression_step) || progression_step < 1) {
                throw new Error('DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');
              }
              const intent = slot?.intent;
              const ok =
                intent &&
                typeof intent === 'object' &&
                ensureNonEmptyString(intent.objective) &&
                ensureNonEmptyString(intent.cta_type) &&
                ensureNonEmptyString(intent.target_audience) &&
                ensureNonEmptyString(intent.strategic_role) &&
                ensureNonEmptyString(intent.pain_point) &&
                ensureNonEmptyString(intent.outcome_promise) &&
                ensureNonEmptyString(intent.audience_stage) &&
                intent.recommendation_alignment &&
                typeof intent.recommendation_alignment === 'object' &&
                ensureNonEmptyString(intent.recommendation_alignment.source_type) &&
                ensureNonEmptyString(intent.recommendation_alignment.source_value) &&
                ensureNonEmptyString(intent.recommendation_alignment.alignment_reason);
              if (!ok) throw new Error('DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');
            }
            // progression_step must be sequential starting at 1
            for (let i = 0; i < slots.length; i += 1) {
              const step = Number((slots[i] as any)?.progression_step);
              if (step !== i + 1) throw new Error('DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');
            }
          }
          return {
            ...w,
            theme,
            campaign_stage,
            weekly_narrative_spine,
            audience_awareness_target,
            platform_allocation: (deterministicPlanSkeleton as any)?.platform_allocation ?? w?.platform_allocation,
            content_type_mix: (deterministicPlanSkeleton as any)?.content_type_mix ?? w?.content_type_mix,
            total_weekly_content_count:
              (deterministicPlanSkeleton as any)?.total_weekly_content_count ?? w?.total_weekly_content_count,
            execution_items,
          };
        }),
      };

      // Re-index global_progression_index across ALL weeks (campaign-wide, strictly increasing).
      const weeksArr: any[] = Array.isArray((structured as any)?.weeks) ? ((structured as any).weeks as any[]) : [];
      const orderedWeeks = weeksArr
        .map((w, idx) => {
          const n = Number((w as any)?.week ?? (w as any)?.week_number ?? (w as any)?.weekNumber ?? idx + 1);
          const ord = Number.isFinite(n) && n > 0 ? Math.floor(n) : idx + 1;
          return { w, idx, ord };
        })
        .sort((a, b) => a.ord - b.ord || a.idx - b.idx);

      let globalCounter = 0;
      for (const entry of orderedWeeks) {
        const week = entry.w as any;
        const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : null;
        if (!execItems) throw new Error('DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');

        const perWeekSlots: Array<{ execIdx: number; slotIdx: number; progression_step: number; slot: any }> = [];
        for (let execIdx = 0; execIdx < execItems.length; execIdx += 1) {
          const exec = execItems[execIdx];
          const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : null;
          if (!slots) throw new Error('DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');
          for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
            const slot = slots[slotIdx];
            const progression_step = Number(slot?.progression_step);
            if (!slot || !Number.isFinite(progression_step) || progression_step < 1 || !slot.intent) {
              throw new Error('DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');
            }
            perWeekSlots.push({ execIdx, slotIdx, progression_step, slot });
          }
        }
        perWeekSlots.sort(
          (a, b) => a.progression_step - b.progression_step || a.execIdx - b.execIdx || a.slotIdx - b.slotIdx
        );
        for (const s of perWeekSlots) {
          globalCounter += 1;
          s.slot.global_progression_index = globalCounter;
        }
      }

      // Assign schedule metadata (single source of truth). No other service should assign schedule.
      const weeksForSchedule = Array.isArray((structured as any)?.weeks) ? ((structured as any).weeks as any[]) : [];
      if (weeksForSchedule.length > 0) {
        const region =
          (effectivePrefilledPlanning as any)?.target_regions
            ? (Array.isArray((effectivePrefilledPlanning as any).target_regions)
                ? (effectivePrefilledPlanning as any).target_regions
                : String((effectivePrefilledPlanning as any).target_regions ?? '').split(/[,\s;]+/).map((s: string) => s.trim()).filter(Boolean))
            : (input.recommendationContext as any)?.target_regions ?? undefined;
        assignWeeklySchedule({
          weeklyActivities: weeksForSchedule,
          campaignStartDate: undefined,
          region,
        });
        const [versionForSignals, campaignForSignals] = await Promise.all([
          supabase.from('campaign_versions').select('company_id').eq('campaign_id', input.campaignId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          getCampaignById<{ start_date?: string }>(input.campaignId, 'start_date'),
        ]);
        const signalCompanyId = (versionForSignals.data as { company_id?: string } | null)?.company_id ?? null;
        const signalCampaignStart = campaignForSignals?.start_date ?? null;

        await Promise.all(
          weeksForSchedule.map(async (w) => {
            if (!w || typeof w !== 'object') return;
            const weekNum = Number((w as any).week ?? (w as any).week_number ?? 1);
            (w as any).distribution_insights = await getEnrichedDistributionInsights(w, {
              companyId: signalCompanyId ?? undefined,
              campaignStartDate: signalCampaignStart ?? undefined,
              weekNumber: weekNum,
            });
          })
        );
      }

      // Build writer-ready week details from deterministic execution_items.
      // This ensures plan output stays aligned to the requested weekly pool while providing concrete topics/briefs.
      const weeksForEnrichment: any[] = Array.isArray((structured as any)?.weeks) ? ((structured as any).weeks as any[]) : [];
      for (const week of weeksForEnrichment) {
        const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
        if (execItems.length === 0) continue;

        const weekCapsule =
          (week as any)?.weeklyContextCapsule ??
          (week as any)?.week_extras?.weeklyContextCapsule ??
          (week as any)?.weekly_context_capsule ??
          null;
        const toneGuidance =
          ensureNonEmptyString((weekCapsule as any)?.toneGuidance) ||
          ensureNonEmptyString((weekCapsule as any)?.tone_guidance) ||
          'clear, practical, outcome-driven';

        const theme = ensureNonEmptyString((week as any)?.theme) || `Week ${Number((week as any)?.week ?? 1) || 1} focus`;
        const objective = ensureNonEmptyString((week as any)?.primary_objective ?? (week as any)?.objective) || 'Execute weekly objective.';
        const cta_type = ensureNonEmptyString((week as any)?.cta_type ?? (week as any)?.ctaType) || 'Soft CTA';
        const weekly_kpi_focus =
          ensureNonEmptyString((week as any)?.weekly_kpi_focus ?? (week as any)?.weeklyKpiFocus) || 'Reach growth';
        const target_audience =
          ensureNonEmptyString((week as any)?.target_audience ?? (week as any)?.targetAudience ?? (effectivePrefilledPlanning as any)?.target_audience) ||
          'Target audience from campaign context';

        const platform_content_breakdown: Record<string, Array<{ type: string; count: number; topic?: string; topics?: string[]; platforms?: string[] }>> =
          {};
        const platform_topics: Record<string, string[]> = {};
        const topicBriefs: any[] = [];

        for (let execIdx = 0; execIdx < execItems.length; execIdx += 1) {
          const exec = execItems[execIdx];
          const selectedPlatformsRaw: string[] = Array.isArray(exec?.selected_platforms) ? exec.selected_platforms : [];
          const fallbackPlatform =
            (Array.isArray(exec?.platform_options) && exec.platform_options[0]) || 'linkedin';
          const selectedPlatforms = (selectedPlatformsRaw.length > 0 ? selectedPlatformsRaw : [fallbackPlatform])
            .map((p: any) => normalizePlatformKey(String(p)))
            .filter(Boolean);
          const primaryPlatform = selectedPlatforms[0] || normalizePlatformKey(String(fallbackPlatform));
          const wordTarget = getPlatformWordLimit(primaryPlatform);

          const rawType = String(exec?.content_type ?? '').trim();
          const normalizedType = normalizeDeliverableType(rawType) || rawType.toLowerCase() || 'post';
          const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
          const topics: string[] = slots
            .map((s) => ensureNonEmptyString(s?.topic))
            .filter(Boolean) as string[];

          const countRaw = Number(exec?.count_per_week ?? 0);
          const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : Math.max(1, topics.length);

          const platformCountsRaw = exec?.platform_counts && typeof exec.platform_counts === 'object' && !Array.isArray(exec.platform_counts)
            ? (exec.platform_counts as Record<string, unknown>)
            : null;
          const platformCounts: Record<string, number> = {};
          if (platformCountsRaw) {
            for (const [p, v] of Object.entries(platformCountsRaw)) {
              const n = Number(v);
              if (!p) continue;
              if (!Number.isFinite(n) || n <= 0) continue;
              platformCounts[normalizePlatformKey(p)] = Math.floor(n);
            }
          } else {
            platformCounts[primaryPlatform] = count;
          }

          const slotPlatforms: string[][] = Array.isArray(exec?.slot_platforms)
            ? (exec.slot_platforms as any[]).map((arr) => (Array.isArray(arr) ? arr.map((p) => normalizePlatformKey(String(p))).filter(Boolean) : []))
            : [];

          const topicsByPlatform: Record<string, string[]> = {};
          for (const p of selectedPlatforms) topicsByPlatform[p] = [];
          for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
            const topic = ensureNonEmptyString(slots[slotIdx]?.topic);
            if (!topic) continue;
            const platformsForSlot = slotPlatforms[slotIdx] && slotPlatforms[slotIdx]!.length > 0
              ? slotPlatforms[slotIdx]!
              : selectedPlatforms;
            for (const p of platformsForSlot) {
              topicsByPlatform[p] = topicsByPlatform[p] || [];
              topicsByPlatform[p]!.push(topic);
            }
          }

          for (const p of selectedPlatforms) {
            const cP = Number(platformCounts[p] ?? 0) || 0;
            if (cP <= 0) continue;
            platform_content_breakdown[p] = platform_content_breakdown[p] || [];
            const tP = topicsByPlatform[p] || [];
            platform_content_breakdown[p]!.push({
              type: normalizedType,
              count: cP,
              topic: tP[0] || topics[0] || undefined,
              topics: tP.length > 0 ? tP : (topics.length > 0 ? topics : undefined),
              platforms: selectedPlatforms.length > 1 ? selectedPlatforms : [p],
            });
            platform_topics[p] = Array.from(new Set([...(platform_topics[p] || []), ...tP]));
          }

          const contentTypeGuidance = {
            primaryFormat: platformToPrimaryFormat(primaryPlatform),
            maxWordTarget: wordTarget,
            platformWithHighestLimit: primaryPlatform,
            adaptationRequired: true as const,
          };
          for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
            const slot = slots[slotIdx];
            const topicTitle = ensureNonEmptyString(slot?.topic) || `Topic ${slotIdx + 1}`;
            const intent = slot?.intent ?? {};
            const brief_summary =
              ensureNonEmptyString(intent?.brief_summary ?? intent?.briefSummary ?? intent?.writing_intent) ||
              `Address "${topicTitle}" within the "${theme}" narrative for ${target_audience}.`;
            const pain_point = ensureNonEmptyString(intent?.pain_point ?? intent?.painPoint) || `Uncertainty about ${topicTitle}`;
            const outcome_promise =
              ensureNonEmptyString(intent?.outcome_promise ?? intent?.outcomePromise) || `Reader understands ${topicTitle} and why it matters.`;

            topicBriefs.push({
              topicTitle,
              topicContext: {
                topicTitle,
                topicGoal: objective,
                audienceAngle: target_audience,
                painPointFocus: pain_point,
                transformationIntent: outcome_promise,
                messagingAngle: theme,
                expectedOutcome: weekly_kpi_focus,
                recommendedContentTypes: [normalizedType],
                platformPriority: selectedPlatforms,
                writingIntent: brief_summary,
              },
              whoAreWeWritingFor: target_audience,
              whatProblemAreWeAddressing: pain_point,
              whatShouldReaderLearn: outcome_promise,
              desiredAction: ctaToDesiredAction(cta_type),
              approximateDepth: approximateDepthForTarget(wordTarget),
              narrativeStyle: toneGuidance,
              contentTypeGuidance,
              execution_meta: {
                primary_platform: primaryPlatform,
                platforms: (slotPlatforms[slotIdx] && slotPlatforms[slotIdx]!.length > 0) ? slotPlatforms[slotIdx]! : selectedPlatforms,
                content_type: normalizedType,
                progression_step: Number(slot?.progression_step ?? slotIdx + 1),
                global_progression_index: Number(slot?.global_progression_index ?? 0),
                exec_index: execIdx,
                slot_index: slotIdx,
              },
            });
          }
        }

        topicBriefs.sort((a, b) => {
          const ga = Number(a?.execution_meta?.global_progression_index ?? 0) || 0;
          const gb = Number(b?.execution_meta?.global_progression_index ?? 0) || 0;
          if (ga !== gb) return ga - gb;
          const wa = Number(a?.execution_meta?.exec_index ?? 0) || 0;
          const wb = Number(b?.execution_meta?.exec_index ?? 0) || 0;
          if (wa !== wb) return wa - wb;
          return (Number(a?.execution_meta?.slot_index ?? 0) || 0) - (Number(b?.execution_meta?.slot_index ?? 0) || 0);
        });

        const existingTopicsToCover: string[] = Array.isArray((week as any)?.topics_to_cover)
          ? ((week as any).topics_to_cover as any[]).map((t) => String(t ?? '').trim()).filter(Boolean)
          : [];
        const computedTopicsToCover =
          existingTopicsToCover.length > 0
            ? existingTopicsToCover
            : Array.from(new Set(topicBriefs.map((b) => String(b?.topicTitle ?? '').trim()).filter(Boolean))).slice(0, 8);

        (week as any).platform_content_breakdown = platform_content_breakdown;
        (week as any).platform_topics = platform_topics;
        (week as any).topics = topicBriefs;
        (week as any).topics_to_cover = computedTopicsToCover;
        (week as any).week_extras = {
          ...(typeof (week as any).week_extras === 'object' && (week as any).week_extras ? (week as any).week_extras : {}),
          writer_brief: {
            objective,
            theme,
            weekly_kpi_focus,
            target_audience,
            cta_type,
            narrative_spine: ensureNonEmptyString((week as any)?.weekly_narrative_spine) || null,
            campaign_stage: ensureNonEmptyString((week as any)?.campaign_stage) || null,
            audience_awareness_target: ensureNonEmptyString((week as any)?.audience_awareness_target) || null,
            tone_guidance: toneGuidance,
          },
        };
      }

      validateWeeklyNarrativeFlow((structured as any)?.weeks);
      (structured as any).weeks = balanceWeeklyExecutionLoad((structured as any)?.weeks);
      const executionConfig =
        (ctx.prefilledPlanning as any)?.execution_config ?? (ctx.snapshot as any)?.execution_config;
      const pressureResult = runExecutionPressureBalancer(
        (structured as any).weeks,
        executionConfig
      );
      (structured as any).weeks = pressureResult.weeks;
      (structured as any).executionPressureMetadata = {
        ...pressureResult.balanceReport,
        pressureLevel: pressureResult.pressureLevel,
      };
      const momentumResult = analyzeExecutionMomentum((structured as any).weeks);
      (structured as any).executionMomentumMetadata = {
        state: momentumResult.state,
        signals: momentumResult.signals,
        momentumScore: momentumResult.momentumScore,
        warnings: momentumResult.warnings,
      };
      const momentumRecovery =
        momentumResult.state === 'WEAK'
          ? generateMomentumRecoverySuggestions((structured as any).weeks, momentumResult)
          : null;
      (structured as any).momentumRecoveryMetadata =
        momentumRecovery && momentumRecovery.suggestions.length > 0
          ? { suggestions: momentumRecovery.suggestions, recommendedActions: momentumRecovery.recommendedActions }
          : undefined;
      attachDeterministicWriterBriefsToExecutionSlots((structured as any)?.weeks);
      attachPostingExecutionMapsToWeeks((structured as any)?.weeks);
      attachResolvedPostingsToWeeks((structured as any)?.weeks);
      alignDailyExecutionItemsAsSingleSource({
        weeks: (structured as any)?.weeks,
        campaignId: input.campaignId,
        currentPlanWeeks: input.currentPlan?.weeks,
      });
      await attachGenerationPipelineToDailyItems((structured as any)?.weeks);
      if (input.autopilot === true) {
        const autopilotRun = await runAutopilotForPlan(
          { weeks: (structured as any)?.weeks },
          { timezone: 'UTC' }
        );
        (structured as any).weeks = autopilotRun.plan.weeks;
        autopilotResult = autopilotRun.summary;
      }
    }
    try {
      console.log(
        '[weekly-debug][post-enrichment-week]',
        JSON.stringify((structured?.weeks || [])[0] ?? null, null, 2)
      );
    } catch {
      console.log('[weekly-debug][post-enrichment-week]', (structured?.weeks || [])[0] ?? null);
    }
  }

  // Apply strategy mapping, momentum recovery, and language refinement BEFORE save
  // so the database stores refined weekly plan text (Weekly Plan → refined → Daily Distribution → BOLT)
  if (input.mode === 'generate_plan' && Array.isArray(structured?.weeks) && structured.weeks.length > 0) {
    const strategy = ctx.distributionStrategy ?? 'AI_OPTIMIZED';
    const reason = ctx.distributionReason ?? undefined;
    const validationResult = (ctx.prefilledPlanning as any)?.validation_result ?? undefined;
    const planningAdjustmentReason = validationResult?.planning_adjustment_reason ?? undefined;
    const planningAdjustmentsSummary = validationResult?.planning_adjustments_summary ?? undefined;
    let weeks = structured.weeks.map((w: any) => ({
      ...w,
      distribution_strategy: w.distribution_strategy ?? strategy,
      ...(reason != null ? { distribution_reason: w.distribution_reason ?? reason } : {}),
      ...(planningAdjustmentReason != null ? { planning_adjustment_reason: w.planning_adjustment_reason ?? planningAdjustmentReason } : {}),
      ...(planningAdjustmentsSummary != null ? { planning_adjustments_summary: w.planning_adjustments_summary ?? planningAdjustmentsSummary } : {}),
    }));
    weeks = adjustCampaignMomentum({ weeks, validation_result: validationResult });
    structured = { ...structured, weeks };
    structured.weeks = recoverNarrativeMomentum(structured.weeks);

    const campaignTone =
      (effectivePrefilledPlanning as any)?.communication_style ??
      (ctx.prefilledPlanning as any)?.communication_style ??
      (ctx as any).strategyMemory?.preferred_tone;
    for (const week of structured.weeks as any[]) {
      if (typeof week.theme === 'string' && week.theme.trim()) {
        const r = await refineLanguageOutput({
          content: week.theme,
          card_type: 'weekly_plan',
          campaign_tone: campaignTone,
        });
        week.theme = (r.refined as string) || week.theme;
      }
      if (typeof week.primary_objective === 'string' && week.primary_objective.trim()) {
        const r = await refineLanguageOutput({
          content: week.primary_objective,
          card_type: 'weekly_plan',
          campaign_tone: campaignTone,
        });
        week.primary_objective = (r.refined as string) || week.primary_objective;
      }
      if (Array.isArray(week.topics_to_cover) && week.topics_to_cover.length > 0) {
        const r = await refineLanguageOutput({
          content: week.topics_to_cover.filter((t: unknown) => typeof t === 'string').map((t: unknown) => String(t).trim()).filter(Boolean),
          card_type: 'weekly_plan',
          campaign_tone: campaignTone,
        });
        if (Array.isArray(r.refined)) {
          week.topics_to_cover = r.refined;
        }
      }
    }
  }

  try {
    const executionPressureMetadata = (structured as any).executionPressureMetadata;
    const executionMomentumMetadata = (structured as any).executionMomentumMetadata;
    const momentumRecoveryMetadata = (structured as any).momentumRecoveryMetadata;
    await saveStructuredCampaignPlan({
      campaignId: input.campaignId,
      snapshot_hash: ctx.snapshot_hash,
      weeks: structured.weeks,
      omnivyre_decision: ctx.omnivyreDecision,
      raw_plan_text: planText,
      executionPressureMetadata:
        executionPressureMetadata && typeof executionPressureMetadata === 'object'
          ? executionPressureMetadata
          : undefined,
      executionMomentumMetadata:
        executionMomentumMetadata && typeof executionMomentumMetadata === 'object'
          ? executionMomentumMetadata
          : undefined,
      momentumRecoveryMetadata:
        momentumRecoveryMetadata && typeof momentumRecoveryMetadata === 'object'
          ? momentumRecoveryMetadata
          : undefined,
    });
  } catch (saveErr) {
    console.warn('saveStructuredCampaignPlan failed, returning plan anyway:', saveErr);
  }

  const companyIdForHealth = ctx.companyId ?? '';
  if (companyIdForHealth) {
    evaluateAndPersistCampaignHealth(input.campaignId, companyIdForHealth).catch((e) =>
      console.warn('[campaign-ai] health evaluation after plan save:', e)
    );
  }

  if (input.mode === 'generate_plan') {
    const weekOne = Array.isArray(structured.weeks) ? structured.weeks.find((w: any) => Number(w?.week) === 1) ?? structured.weeks[0] : null;
    const weekOneObjective = String(weekOne?.primary_objective ?? weekOne?.objective ?? '').trim();
    const weekOneTheme = String(weekOne?.theme ?? '').trim();
    const weekOneTopicFocus = String(weekOne?.topicFocus ?? weekOne?.week_extras?.topic_focus ?? weekOne?.week_extras?.topicFocus ?? '').trim();
    const usingPlaceholder =
      /topic placeholder/i.test(weekOneTheme) ||
      /topic placeholder/i.test(weekOneTopicFocus) ||
      /placeholder objective/i.test(weekOneObjective);
    console.info('[campaign-ai][weekly-intelligence-check]', {
      hasObjective: weekOneObjective.length > 0,
      hasTheme: weekOneTheme.length > 0,
      hasTopicFocus: weekOneTopicFocus.length > 0,
      usingPlaceholder,
      generationMode,
    });
    console.info('[campaign-ai][weekly-generation-debug]', {
      didParseFail,
      didValidationFail,
      alignmentScore: alignmentScoreForDebug,
      regenerationTriggered,
      fallbackTriggered,
      generationMode,
      validationReasons,
    });
  }

  return {
    mode: input.mode,
    snapshot_hash: ctx.snapshot_hash,
    omnivyre_decision: {
      ...ctx.omnivyreDecision,
      raw: {
        ...(typeof ctx.omnivyreDecision.raw === 'object' && ctx.omnivyreDecision.raw ? ctx.omnivyreDecision.raw : {}),
        alignment_evaluation: alignmentResult,
        alignment_profile: buildAlignmentProfile(alignmentResult),
        alignment_warning:
          alignmentResult && alignmentResult.alignmentScore < ALIGNMENT_ACCEPT_THRESHOLD
            ? `Alignment score below threshold (${alignmentResult.alignmentScore}/${ALIGNMENT_ACCEPT_THRESHOLD}); accepted best available plan.`
            : null,
      },
    },
    plan: structured,
    autopilot_result: autopilotResult,
    // When a structured plan exists, avoid returning raw text as a conversational response.
    conversationalResponse: undefined,
    raw_plan_text: raw,
  };
}

const LIGHTWEIGHT_SNAPSHOT_HASH = 'conversational-fallback';

function createLightweightContext(
  campaignId: string,
  companyContext: string | null,
  campaignIntentSummary: { types: string[]; weights: Record<string, number>; primary_type: string },
  forcedContextBlock?: string | null,
  strategyDNA?: ReturnType<typeof buildCompanyStrategyDNA> | null
): {
  snapshot: any;
  snapshot_hash: string;
  diagnostics: any;
  omnivyreDecision: DecisionResult;
  platformStrategies: any[];
  companyContext: string | null;
  forcedContextBlock?: string | null;
  strategyDNA?: ReturnType<typeof buildCompanyStrategyDNA> | null;
  campaignIntentSummary: { types: string[]; weights: Record<string, number>; primary_type: string };
} {
  return {
    snapshot: {
      campaign: { id: campaignId, status: null, timeframe: null, start_date: null, end_date: null, objective: null, goal_objectives: [] },
      weekly_plans: [],
      daily_plans: [],
      scheduled_posts: [],
      media_assets: [],
      platform_coverage: { platforms: [], daily_plan_counts: {}, scheduled_post_counts: {}, weekly_gaps: {} },
      asset_availability: { daily_plans_total: 0, daily_plans_with_content: 0, daily_plans_with_media_requirements: 0, daily_plans_with_media_attached: 0, media_assets_total: 0 },
    },
    snapshot_hash: LIGHTWEIGHT_SNAPSHOT_HASH,
    diagnostics: { overall_summary: 'Building campaign from conversation.' },
    omnivyreDecision: { status: 'ok', recommendation: 'proceed' },
    platformStrategies: DEFAULT_PLATFORM_STRATEGIES,
    companyContext,
    forcedContextBlock: forcedContextBlock ?? null,
    strategyDNA: strategyDNA ?? null,
    campaignIntentSummary,
  };
}

export async function runCampaignAiPlan(
  input: CampaignAiPlanInput
): Promise<CampaignAiPlanResult> {
  const isConversational = input.mode === 'generate_plan' && (input.conversationHistory?.length ?? 0) > 0;
  const [campaignResult, versionRow] = await Promise.all([
    supabase
      .from('campaigns')
      .select('duration_weeks, start_date, description, name')
      .eq('id', input.campaignId)
      .maybeSingle(),
    getLatestCampaignVersionByCampaignId(input.campaignId),
  ]);
  const { data: campaignRow } = campaignResult;

  // Fail fast: ensure required data exists before any heavy work (no loops, clear error).
  if (input.mode === 'generate_plan') {
    if (!campaignRow) {
      throw new Error('Campaign not found. Please save the campaign and try again.');
    }
    if (!versionRow) {
      throw new Error('Campaign version not found. Please save the campaign and try again.');
    }
  }

  const fromConversation = extractDurationFromConversation(input.conversationHistory ?? []);
  const dbDuration = toValidWeeks(campaignRow?.duration_weeks);
  const recommendationSeed = recommendationDurationSeed(input.recommendationContext);
  const explicitConversationDuration = toValidWeeks(fromConversation);
  const snapshot = versionRow?.campaign_snapshot as Record<string, unknown> | null | undefined;
  const execConfig = snapshot?.execution_config as Record<string, unknown> | null | undefined;
  const durationFromExecConfig =
    execConfig != null && typeof execConfig.campaign_duration === 'number'
      ? toValidWeeks(execConfig.campaign_duration)
      : null;

  // duration source of truth — explicit chat override wins over execution_config
  const sourcedDurationWeeks =
    explicitConversationDuration ??
    durationFromExecConfig ??
    dbDuration ??
    recommendationSeed ??
    toValidWeeks(input.durationWeeks);
  const resolvedDurationWeeks = Math.min(12, sourcedDurationWeeks ?? 12);

  const inputWithDuration = { ...input, durationWeeks: resolvedDurationWeeks };

  // Gather-phase fast path: fixed question order — skip full pipeline and LLM when we just need the next question.
  const isGatherPhase =
    input.mode === 'generate_plan' && (input.conversationHistory?.length ?? 0) > 0;
  if (isGatherPhase) {
    const fromHistory = extractPlanningContextFromHistory(input.conversationHistory ?? []);
    const minimalPrefilled = {
      ...buildPrefilledPlanning({ campaign: campaignRow, versionRow }),
      ...mapRecommendationContextToGatherKeys(input.recommendationContext ?? null),
      ...fromHistory,
    };
    const hasExplicitCapacityAnswer = (v: unknown) =>
      v != null && (typeof v === 'object' || (typeof v === 'string' && String(v).trim().length > 0));
    const fromHistoryHasAvailable =
      fromHistory?.available_content != null &&
      (hasExplicitCapacityAnswer(fromHistory.available_content) ||
        /^(no|none|zero|don'?t have|do not have|no content|not yet)\b/i.test(String(fromHistory.available_content).trim()));
    const fromHistoryHasCapacity =
      fromHistory?.content_capacity != null && hasExplicitCapacityAnswer(fromHistory.content_capacity);
    const minimalPrefilledKeys = Array.from(
      new Set(
        (REQUIRED_EXECUTION_FIELDS as unknown as string[]).filter((k) => {
          if (k === 'available_content') return fromHistoryHasAvailable;
          if (k === 'content_capacity' || k === 'weekly_capacity') return fromHistoryHasCapacity;
          const v = (minimalPrefilled as Record<string, unknown>)[k];
          return v != null && (typeof v !== 'string' || String(v).trim().length > 0);
        })
      )
    );
    const gatherOrderForQa = GATHER_ORDER.map((g) => ({
      key: g.key,
      question: g.question,
      contingentOn: (g as { contingentOn?: string }).contingentOn,
    }));
    const trustedUtcToday = new Date().toISOString().slice(0, 10);
    const qaState = computeCampaignPlanningQAState({
      gatherOrder: gatherOrderForQa,
      prefilledKeys: minimalPrefilledKeys,
      prefilledValues: minimalPrefilled,
      requiredKeys: REQUIRED_EXECUTION_FIELDS as unknown as string[],
      utcTodayISO: trustedUtcToday,
      conversationHistory: (input.conversationHistory ?? []).map((m: any) => ({
        type: m.type ?? 'user',
        message: m.message ?? '',
      })),
    });
    if (!qaState.readyToGenerate && qaState.nextQuestion) {
      const waitingForConfirmation = !!qaState.allRequiredAnswered && !qaState.userConfirmed;
      const response = waitingForConfirmation
        ? 'I have everything I need. Would you like me to create your week plan now?'
        : qaState.nextQuestion.question;
      return {
        mode: input.mode,
        snapshot_hash: 'gather-phase',
        omnivyre_decision: { status: 'ok', recommendation: 'proceed' as const },
        conversationalResponse: response,
        raw_plan_text: '',
      };
    }
  }

  const buildMode = versionRow?.build_mode ?? BACKWARD_COMPAT_DEFAULTS.build_mode;
  const contextScope = versionRow?.context_scope ?? null;
  const campaignTypes = versionRow?.campaign_types ?? BACKWARD_COMPAT_DEFAULTS.campaign_types;
  const campaignWeights = versionRow?.campaign_weights ?? BACKWARD_COMPAT_DEFAULTS.campaign_weights;
  const primaryType = getPrimaryCampaignType(campaignWeights);
  const campaignIntentSummary = {
    types: campaignTypes,
    weights: campaignWeights,
    primary_type: primaryType,
  };

  // Decide fast path before loading company profile — avoids getProfile when user said "Yes, proceed with N weeks".
  const lastUserMessage = (input.conversationHistory ?? []).filter((m: any) => m?.type === 'user').pop()?.message ?? '';
  const looksLikePlanConfirmation =
    input.mode === 'generate_plan' &&
    lastUserMessage.trim().length > 0 &&
    (/^\s*(yes|sure|ok|okay|please|yeah|yep)\s*$/i.test(lastUserMessage.trim()) ||
      /\b(proceed with|use)\s+\d{1,2}\s*weeks?\b/i.test(lastUserMessage) ||
      /^\s*\d{1,2}\s*weeks?\s*$/i.test(lastUserMessage.trim()) ||
      /\bcreate\b.*\bplan\b/i.test(lastUserMessage));
  const useFastPath = isConversational && looksLikePlanConfirmation;
  if (useFastPath) {
    console.info('[campaign-ai] Fast path: skipping profile/snapshot/assessVirality for plan confirmation', { campaignId: input.campaignId, lastUserMessage: lastUserMessage.slice(0, 80) });
  }

  let companyContext: string | null = null;
  let forcedContextBlock: string | null = null;
  let strategyDNA: ReturnType<typeof buildCompanyStrategyDNA> | null = null;
  if (!useFastPath && versionRow?.company_id && (buildMode === 'full_context' || buildMode === 'focused_context')) {
    try {
      const profile = await getProfile(versionRow.company_id, { autoRefine: false, languageRefine: true });
      companyContext = buildCompanyContextBlock(profile, buildMode, contextScope);
      strategyDNA = buildCompanyStrategyDNA(profile);
      if (profile?.forced_context_fields && Object.keys(profile.forced_context_fields).length > 0) {
        const canonical = buildCompanyContext(profile);
        const { forced_context } = buildForcedCompanyContext(canonical, profile.forced_context_fields);
        if (Object.keys(forced_context).length > 0) {
          forcedContextBlock = formatForcedContextForPrompt(forced_context);
        }
      }
    } catch (e) {
      console.warn('Failed to load company profile for context injection:', e);
    }
  }

  const tryFullPipeline = async (): Promise<{
    snapshot: any;
    snapshot_hash: string;
    diagnostics: any;
    omnivyreDecision: DecisionResult;
    platformStrategies: any[];
    companyContext: string | null;
    forcedContextBlock: string | null;
    strategyDNA: ReturnType<typeof buildCompanyStrategyDNA> | null;
    campaignIntentSummary: { types: string[]; weights: Record<string, number>; primary_type: string };
  }> => {
    const { snapshot, snapshot_hash } = await buildCampaignSnapshotWithHash(input.campaignId);
    const [viralityAssessment, platformStrategiesResult] = await Promise.all([
      assessVirality(input.campaignId, { snapshot, snapshot_hash }),
      getPlatformStrategies().catch((e) => {
        console.warn('getPlatformStrategies failed, using defaults:', e);
        return DEFAULT_PLATFORM_STRATEGIES;
      }),
    ]);
    const platformStrategies =
      Array.isArray(platformStrategiesResult) && platformStrategiesResult.length > 0
        ? platformStrategiesResult
        : DEFAULT_PLATFORM_STRATEGIES;
    const omnivyreDecision =
      viralityAssessment.omnivyre_decision ?? { status: 'ok', recommendation: 'proceed' as const };

    return {
      snapshot,
      snapshot_hash: viralityAssessment.snapshot_hash,
      diagnostics: viralityAssessment,
      omnivyreDecision,
      platformStrategies,
      companyContext,
      forcedContextBlock,
      strategyDNA,
      campaignIntentSummary,
    };
  };

  let ctx: {
    snapshot: any;
    snapshot_hash: string;
    diagnostics: any;
    omnivyreDecision: DecisionResult;
    platformStrategies: any[];
    companyContext: string | null;
    forcedContextBlock?: string | null;
    strategyDNA?: ReturnType<typeof buildCompanyStrategyDNA> | null;
    campaignIntentSummary: { types: string[]; weights: Record<string, number>; primary_type: string };
    baselineContext?: BaselineContextResult;
    campaignStage?: string | null;
    psychologicalGoal?: string | null;
    momentum?: string | null;
    /** When true, skip alignment regeneration to reduce latency (e.g. "Yes, proceed with N weeks"). */
    fastPath?: boolean;
  };

  let baselineContext: BaselineContextResult = { unavailable: true };

  if (useFastPath) {
    ctx = createLightweightContext(input.campaignId, companyContext, campaignIntentSummary, forcedContextBlock, strategyDNA);
    ctx.baselineContext = { unavailable: true };
    ctx.fastPath = true;
  } else {
    try {
      ctx = await tryFullPipeline();
    } catch (err) {
      console.warn('Campaign AI full pipeline failed, using lightweight path:', err);
      // Use lightweight context for conversational flows and BOLT (which has collectedPlanningContext
      // with all required data — the full snapshot pipeline is not needed for fresh BOLT campaigns).
      if (isConversational || input.bolt_run_id) {
        ctx = createLightweightContext(input.campaignId, companyContext, campaignIntentSummary, forcedContextBlock, strategyDNA);
      } else {
        throw err;
      }
    }

    baselineContext = { unavailable: true };
    if (versionRow?.company_id) {
      try {
        baselineContext = await resolveBaselineContext({
          companyId: versionRow.company_id,
          companyStage: versionRow.company_stage ?? null,
          marketScope: versionRow.market_scope ?? null,
          baselineOverride: versionRow.baseline_override ?? null,
          primaryType: campaignIntentSummary.primary_type,
          platformStrategies: ctx.platformStrategies || [],
        });
      } catch (e) {
        console.warn('Baseline context resolution failed, using unavailable:', e);
      }
    }
    ctx.baselineContext = baselineContext;
  }
  const recommendationPayload = (input.recommendationContext?.context_payload ?? {}) as Record<string, unknown>;
  const recommendationStage = String(recommendationPayload.campaign_stage ?? '').trim();
  const recommendationPsychological = String(
    recommendationPayload.psychological_goal ?? recommendationPayload.behavioral_goal ?? ''
  ).trim();
  const recommendationMomentum = String(
    recommendationPayload.momentum ?? recommendationPayload.momentum_goal ?? ''
  ).trim();
  ctx.campaignStage = versionRow?.company_stage ?? (recommendationStage || null);
  ctx.psychologicalGoal = recommendationPsychological || null;
  ctx.momentum = recommendationMomentum || null;

  let prefilledPlanning: Record<string, unknown> = buildPrefilledPlanning({
    campaign: campaignRow,
    versionRow,
  });
  const recommendationPrefilled = mapRecommendationContextToGatherKeys(input.recommendationContext);
  if (Object.keys(recommendationPrefilled).length > 0) {
    prefilledPlanning = { ...prefilledPlanning, ...recommendationPrefilled };
  }
  const incomingCollectedPlanningContext =
    input.collectedPlanningContext && typeof input.collectedPlanningContext === 'object'
      ? (input.collectedPlanningContext as Record<string, unknown>)
      : null;
  if (incomingCollectedPlanningContext && Object.keys(incomingCollectedPlanningContext).length > 0) {
    prefilledPlanning = { ...prefilledPlanning, ...incomingCollectedPlanningContext };
  }

  // Promote execution_config fields to top-level. Trend page now sends frequency_per_week (not capacity).
  // Backward compat: content_capacity in exec_config (legacy) still promoted. AI Chat overwrites all.
  const prefilledExecConfig = (prefilledPlanning as any)?.execution_config;
  if (prefilledExecConfig != null && typeof prefilledExecConfig === 'object' && !Array.isArray(prefilledExecConfig)) {
    const ec = prefilledExecConfig as Record<string, unknown>;
    const hasTopLevelAvailable = (prefilledPlanning as any)?.available_content != null;
    const execAvailable = ec.available_content;
    const hasExecAvailable =
      execAvailable != null &&
      (typeof execAvailable === 'string'
        ? String(execAvailable).trim().length > 0
        : typeof execAvailable === 'object');
    if (!hasTopLevelAvailable && hasExecAvailable) {
      prefilledPlanning = { ...prefilledPlanning, available_content: execAvailable };
    }
    // Legacy: some campaigns may still have content_capacity in execution_config
    const hasTopLevelCapacity =
      (prefilledPlanning as any)?.content_capacity != null || (prefilledPlanning as any)?.weekly_capacity != null;
    const execContentCapacity = ec.content_capacity;
    const hasExecCapacity =
      execContentCapacity != null &&
      (typeof execContentCapacity === 'string'
        ? String(execContentCapacity).trim().length > 0
        : typeof execContentCapacity === 'object' || typeof execContentCapacity === 'number');
    if (!hasTopLevelCapacity && hasExecCapacity) {
      prefilledPlanning = {
        ...prefilledPlanning,
        content_capacity: execContentCapacity,
        weekly_capacity: execContentCapacity,
      };
    }
    // When platform_content_requests is missing, derive from frequency_per_week (Trend page).
    const hasPlatformRequests =
      (prefilledPlanning as any)?.platform_content_requests != null &&
      (Array.isArray((prefilledPlanning as any).platform_content_requests)
        ? (prefilledPlanning as any).platform_content_requests.length > 0
        : Object.keys((prefilledPlanning as any).platform_content_requests || {}).length > 0);
    const freqRaw = ec.frequency_per_week;
    const hasFreq =
      freqRaw != null &&
      typeof freqRaw === 'string' &&
      String(freqRaw).trim().length > 0;
    if (!hasPlatformRequests && hasFreq) {
      const n = parseFrequencyPerWeek(String(freqRaw).trim());
      if (n > 0) {
        // Promote frequency_per_week to weekly_capacity so validation passes: user said they want n/week = they can produce n.
        const hasTopLevelCapacity =
          (prefilledPlanning as any)?.content_capacity != null || (prefilledPlanning as any)?.weekly_capacity != null;
        const capacityFromFreq = hasTopLevelCapacity ? undefined : { post: n };
        prefilledPlanning = {
          ...prefilledPlanning,
          platform_content_requests: [
            { platform: 'linkedin', content_type: 'post', count_per_week: n },
          ],
          ...(capacityFromFreq != null && {
            weekly_capacity: capacityFromFreq,
            content_capacity: capacityFromFreq,
          }),
        };
      }
    }
    // When Trend campaign execution config (platform_content_requests, content_capacity, or frequency_per_week) is present,
    // skip the "When do you want to start?" question: default tentative_start to next Monday for week plan creation.
    const hasPlatformRequestsNow =
      (prefilledPlanning as any)?.platform_content_requests != null &&
      (Array.isArray((prefilledPlanning as any).platform_content_requests)
        ? (prefilledPlanning as any).platform_content_requests.length > 0
        : Object.keys((prefilledPlanning as any).platform_content_requests || {}).length > 0);
    const hasExecConfig = hasPlatformRequestsNow || hasExecCapacity || (freqRaw != null && typeof freqRaw === 'string' && String(freqRaw).trim().length > 0);
    const noTentativeStart = !(prefilledPlanning as any)?.tentative_start && !ec?.tentative_start;
    if (hasExecConfig && noTentativeStart) {
      prefilledPlanning = { ...prefilledPlanning, tentative_start: getNextMondayISO() };
    }
  }

  // IMPORTANT: prefilledPlanning is later augmented with normalized defaults (e.g., empty capacity objects).
  // For Q&A gating, we must only treat keys as "answered" if they were truly provided (not injected defaults).
  const rawAvailableContent = (prefilledPlanning as any)?.available_content;
  const rawWeeklyCapacity = (prefilledPlanning as any)?.weekly_capacity ?? (prefilledPlanning as any)?.content_capacity;
  const incomingHasAvailableContent = Boolean(
    incomingCollectedPlanningContext &&
      Object.prototype.hasOwnProperty.call(incomingCollectedPlanningContext, 'available_content')
  );
  const incomingHasWeeklyCapacity = Boolean(
    incomingCollectedPlanningContext &&
      (Object.prototype.hasOwnProperty.call(incomingCollectedPlanningContext, 'weekly_capacity') ||
        Object.prototype.hasOwnProperty.call(incomingCollectedPlanningContext, 'content_capacity'))
  );
  const getTrustedUtcTodayISO = async (): Promise<string> => {
    // Prefer an internet-trusted "today" via HTTP Date header; fall back to system UTC date.
    // In tests, we avoid network to keep runs deterministic.
    if (process.env.NODE_ENV === 'test') return new Date().toISOString().slice(0, 10);
    try {
      const f = (globalThis as any)?.fetch as undefined | ((...args: any[]) => Promise<any>);
      if (typeof f === 'function') {
        const res = await f('https://www.google.com/generate_204', { method: 'HEAD' });
        const headerDate = res?.headers?.get?.('date');
        if (headerDate) {
          const d = new Date(String(headerDate));
          if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        }
      }
    } catch {
      // ignore
    }
    return new Date().toISOString().slice(0, 10);
  };
  const trustedUtcTodayISO = await getTrustedUtcTodayISO();
  const hasMeaningfulProvidedValue = (v: unknown): boolean => {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v === 'object' && !Array.isArray(v)) return Object.keys(v as Record<string, unknown>).length > 0;
    return false;
  };
  const isFutureIsoDate = (v: unknown): boolean => {
    const t = typeof v === 'string' ? v.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
    return t > trustedUtcTodayISO;
  };
  const hasExplicitCapacityAnswer = (v: unknown): boolean => {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      if (Boolean((obj as any)._declared_none || (obj as any).declared_none || (obj as any).declaredNone)) return true;
      const breakdown = obj.breakdown && typeof obj.breakdown === 'object' && !Array.isArray(obj.breakdown)
        ? (obj.breakdown as Record<string, unknown>)
        : null;
      if (breakdown && Object.values(breakdown).some((x) => Number(x) > 0)) return true;
      const counts = normalizeCapacityCounts(obj);
      return (counts.post + counts.video + counts.blog + counts.story + counts.thread) > 0;
    }
    return false;
  };
  // AI Chat frequency question is comprehensive (creation mode, counts, shared/unique). It overrides execution_config.
  // Only treat content_capacity as "answered" when the user explicitly provided it in chat (incoming or history), never from execution_config.
  const computeQaPrefilledKeys = (values: Record<string, unknown>) => {
    const ec = (values as any)?.execution_config as Record<string, unknown> | null | undefined;
    const tentativeStart = (values as any)?.tentative_start ?? ec?.tentative_start;
    // Include tentative_start when in execution_config (ensure previously captured is not repeated)
    const keysToCheck = new Set(Object.keys(values || {}));
    if (ec?.tentative_start != null) keysToCheck.add('tentative_start');
    return Array.from(keysToCheck).filter((k) => {
      if (k === 'available_content') return incomingHasAvailableContent || fromHistoryHasAvailableContent;
      if (k === 'weekly_capacity' || k === 'content_capacity')
        return incomingHasWeeklyCapacity || fromHistoryHasContentCapacity;
      if (k === 'tentative_start') {
        const t = typeof tentativeStart === 'string' ? tentativeStart.trim() : '';
        return /^\d{4}-\d{2}-\d{2}$/.test(t) && t >= trustedUtcTodayISO;
      }
      return (values as any)?.[k] != null;
    });
  };

  // Normalize capacity data. AI Chat overwrites all; no Trend ceiling.
  const normalizedAvailableContent = normalizeCapacityCountsWithBreakdown((prefilledPlanning as any)?.available_content);
  const normalizedWeeklyCapacity = normalizeCapacityCountsWithBreakdown(
    (prefilledPlanning as any)?.weekly_capacity ?? (prefilledPlanning as any)?.content_capacity
  );

  prefilledPlanning = {
    ...prefilledPlanning,
    available_content: normalizedAvailableContent,
    weekly_capacity: normalizedWeeklyCapacity,
    content_capacity: normalizedWeeklyCapacity,
  };

  // When execution_config exists (from Trend page), user-set capacity can be shared across platforms.
  // Default cross_platform_sharing to enabled so 5 pieces supports 5 postings per platform (e.g. same content on LinkedIn + Facebook).
  if (
    (prefilledPlanning as any)?.cross_platform_sharing == null &&
    prefilledExecConfig != null
  ) {
    prefilledPlanning = {
      ...prefilledPlanning,
      cross_platform_sharing: { enabled: true },
    };
  }

  const validation_result =
    input.mode === 'generate_plan'
      ? validateCapacityAndFrequency({
          weekly_capacity: (prefilledPlanning as any)?.weekly_capacity,
          available_content: (prefilledPlanning as any)?.available_content,
          exclusive_campaigns: (prefilledPlanning as any)?.exclusive_campaigns,
          platform_content_requests: (prefilledPlanning as any)?.platform_content_requests,
          cross_platform_sharing: (prefilledPlanning as any)?.cross_platform_sharing,
          content_repurposing: (prefilledPlanning as any)?.content_repurposing ?? { enabled: true },
          campaign_duration_weeks: (prefilledPlanning as any)?.campaign_duration ?? (prefilledPlanning as any)?.duration_weeks,
          message: input.message,
          override_confirmed: Boolean((prefilledPlanning as any)?.validation_result?.override_confirmed),
        })
      : null;
  if (validation_result) {
    prefilledPlanning = { ...prefilledPlanning, validation_result };
    if (incomingCollectedPlanningContext) (incomingCollectedPlanningContext as any).validation_result = validation_result;
    if ((validation_result as any)?.status === 'balanced' && Array.isArray((validation_result as any)?.balanced_requests)) {
      prefilledPlanning = {
        ...prefilledPlanning,
        platform_content_requests: (validation_result as any).balanced_requests,
      };
    }
  }

  let deterministicSkeleton: any = null;
  if (input.mode === 'generate_plan' && (prefilledPlanning as any)?.platform_content_requests) {
    const vr: any = (prefilledPlanning as any)?.validation_result ?? null;
    const shouldSkipSkeleton =
      vr && typeof vr === 'object' && vr.status === 'invalid' && !Boolean(vr.override_confirmed);
    if (!shouldSkipSkeleton) {
      try {
        deterministicSkeleton = await buildDeterministicWeeklySkeleton(prefilledPlanning as any);

        // Stage 2: Map strategy to skeleton — assigns weekly themes, funnel stages, content distribution
        let mappedWeeklySkeleton: MappedWeeklySkeleton | null = null;
        try {
          const pcr = (prefilledPlanning as any)?.platform_content_requests;
          const platformsForMapper = Array.isArray(pcr)
            ? [...new Set((pcr as any[]).map((r: any) => String(r?.platform ?? '')).filter(Boolean))]
            : typeof pcr === 'object' && pcr !== null
              ? Object.keys(pcr).filter(Boolean)
              : [];
          const postingFreqForMapper: Record<string, number> = {};
          for (const p of platformsForMapper) postingFreqForMapper[p] = 3;
          mappedWeeklySkeleton = mapStrategyToSkeleton(
            deterministicSkeleton,
            {
              duration_weeks: resolvedDurationWeeks,
              platforms: platformsForMapper,
              posting_frequency: postingFreqForMapper,
              campaign_goal: (prefilledPlanning as any)?.campaign_goal ?? null,
              target_audience: (prefilledPlanning as any)?.target_audience ?? null,
            },
            input.account_context ?? null
          );
        } catch (mapErr) {
          console.warn('[campaign-ai][strategy-mapper] Non-fatal: failed to map strategy to skeleton:', mapErr);
        }

        if (incomingCollectedPlanningContext) {
          (incomingCollectedPlanningContext as any).deterministic_plan_skeleton = deterministicSkeleton;
          if (mappedWeeklySkeleton) (incomingCollectedPlanningContext as any).mapped_weekly_skeleton = mappedWeeklySkeleton;
        }
        prefilledPlanning = {
          ...prefilledPlanning,
          deterministic_plan_skeleton: deterministicSkeleton,
          ...(mappedWeeklySkeleton && { mapped_weekly_skeleton: mappedWeeklySkeleton }),
        };
      } catch (err) {
        if (err instanceof DeterministicWeeklySkeletonError) {
          // Convert deterministic skeleton validation into the standard capacity validation shape.
          const details = (err.details ?? {}) as any;
          const requested_total = Number(details.requested) || 0;
          const available_content_total = Number(details.available_content_total) || 0;
          const weekly_capacity_total = Number(details.content_capacity_total) || 0;
          const exclusive_campaigns_total = Number(details.exclusive_campaigns_reduction) || 0;
          const effective_capacity_total =
            Number(details.effective_capacity_total) || Math.max(0, weekly_capacity_total - exclusive_campaigns_total);
          const supply_total = available_content_total + effective_capacity_total;
          const deficit = Math.max(0, requested_total - supply_total);
          const normalized: CapacityValidationResult = {
            status: deficit > 0 ? 'invalid' : 'valid',
            override_confirmed: false,
            requested_total,
            requested_platform_postings_total: Number(details.requested_platform_postings_total) || undefined,
            weekly_capacity_total,
            exclusive_campaigns_total,
            effective_capacity_total,
            available_content_total,
            supply_total,
            deficit,
            requested_by_platform: {},
            suggested_adjustments: deficit > 0 ? { reduce_total_by: deficit } : undefined,
            explanation:
              deficit > 0
                ? 'Requested weekly execution exceeds available_content + weekly_capacity (after exclusive_campaigns consume capacity first).'
                : 'Requested weekly execution is within available_content + weekly_capacity (after exclusive_campaigns consume capacity first).',
          };
          prefilledPlanning = { ...prefilledPlanning, validation_result: normalized };
          if (incomingCollectedPlanningContext) (incomingCollectedPlanningContext as any).validation_result = normalized;
          deterministicSkeleton = null;
        } else {
          throw err;
        }
      }
    }
  }
  // Ensure agreed duration is in prefilled — prevents AI from re-asking once user has provided it.
  if (sourcedDurationWeeks != null && sourcedDurationWeeks >= 1 && sourcedDurationWeeks <= 52) {
    prefilledPlanning = { ...prefilledPlanning, campaign_duration: resolvedDurationWeeks };
  }
  // Mark preplanning complete only when duration is actually resolved for this flow.
  if (sourcedDurationWeeks != null) {
    prefilledPlanning = { ...prefilledPlanning, preplanning_form_completed: true };
  }

  // Merge answers derived from conversation so we never re-ask already-answered questions.
  const fromHistory = extractPlanningContextFromHistory(input.conversationHistory ?? []);
  if (Object.keys(fromHistory).length > 0) {
    const merged = { ...fromHistory };
    // Convert cross_platform_sharing string (e.g. "Shared", "Unique") to { enabled: boolean } before merge.
    const rawCps = fromHistory.cross_platform_sharing;
    if (rawCps != null && typeof rawCps === 'string') {
      const t = String(rawCps).trim().toLowerCase();
      merged.cross_platform_sharing =
        /^(unique|different|per platform|unique per platform)/.test(t) || (t.includes('unique') && !t.includes('shared'))
          ? { enabled: false }
          : { enabled: true };
    }
    prefilledPlanning = { ...prefilledPlanning, ...merged };
  }

  // QA prefilled: ONLY treat available_content and content_capacity as "answered" when the USER provided them (incoming or fromHistory).
  // Never use campaign_snapshot/recommendation defaults — always ask BOTH in all scenarios (even when user says "none", they share capacity).
  const fromHistoryHasAvailableContent = Boolean(
    fromHistory?.available_content != null &&
      (hasExplicitCapacityAnswer(fromHistory.available_content) ||
        /^(no|none|zero|don'?t have|do not have|no content|not yet)\b/i.test(String(fromHistory.available_content).trim()))
  );
  const fromHistoryHasContentCapacity = Boolean(
    fromHistory?.content_capacity != null && hasExplicitCapacityAnswer(fromHistory.content_capacity)
  );

  const qaPrefilledKeys = computeQaPrefilledKeys(prefilledPlanning || {});

  // Build gatherOrder; for key_messages, inject company profile examples when available
  let gatherOrderForQa = GATHER_ORDER.map((g) => ({
    key: g.key,
    question: g.question,
    contingentOn: (g as { contingentOn?: string }).contingentOn,
  }));
  if (input.mode === 'generate_plan' && versionRow?.company_id) {
    try {
      const profileForExamples = await getProfile(versionRow.company_id, { autoRefine: false, languageRefine: true });
      const km = profileForExamples?.key_messages;
      const desiredTransformation = (profileForExamples as { desired_transformation?: string | null })?.desired_transformation;
      const lifeAfterSolution = (profileForExamples as { life_after_solution?: string | null })?.life_after_solution;
      let examplePart = '';
      if (typeof km === 'string' && km.trim()) {
        examplePart = ` (e.g. ${km.trim().slice(0, 120)}${km.length > 120 ? '…' : ''})`;
      } else if (Array.isArray(km) && km.length > 0 && typeof km[0] === 'string' && String(km[0]).trim()) {
        examplePart = ` (e.g. ${String(km[0]).trim().slice(0, 120)}${String(km[0]).length > 120 ? '…' : ''})`;
      } else if (typeof desiredTransformation === 'string' && desiredTransformation.trim()) {
        examplePart = ` (e.g. Desired Transformation: ${desiredTransformation.trim().slice(0, 100)}${desiredTransformation.length > 100 ? '…' : ''})`;
      } else if (typeof lifeAfterSolution === 'string' && lifeAfterSolution.trim()) {
        examplePart = ` (e.g. Life After Solution: ${lifeAfterSolution.trim().slice(0, 100)}${lifeAfterSolution.length > 100 ? '…' : ''})`;
      }
      if (examplePart) {
        gatherOrderForQa = gatherOrderForQa.map((g) =>
          g.key === 'key_messages'
            ? { ...g, question: g.question + examplePart }
            : g
        );
      }
    } catch {
      // keep base question without profile examples
    }
  }

  const qaState =
    input.mode === 'generate_plan'
      ? computeCampaignPlanningQAState({
          gatherOrder: gatherOrderForQa,
          prefilledKeys: qaPrefilledKeys,
          prefilledValues: prefilledPlanning || {},
          requiredKeys: REQUIRED_EXECUTION_FIELDS as unknown as string[],
          utcTodayISO: trustedUtcTodayISO,
          conversationHistory: (() => {
            const base = (input.conversationHistory ?? []).map((m) => ({
              type: m.type as 'user' | 'ai',
              message: m.message,
            }));
            // When callers suppress conversationHistory for determinism, we still need the current
            // user turn to detect explicit confirmation ("yes", "generate plan", etc.).
            if (base.length === 0) {
              const msg = String(input.message ?? '').trim();
              if (msg) return [{ type: 'user' as const, message: msg }];
            }
            return base;
          })(),
        })
      : undefined;

  let distributionStrategy: DistributionStrategy | undefined;
  let distributionReason: string | undefined;
  if (input.mode === 'generate_plan') {
    const vr = (prefilledPlanning as any)?.validation_result;
    const skeleton = (prefilledPlanning as any)?.deterministic_plan_skeleton;
    const platformAllocation =
      skeleton?.platform_allocation ?? (prefilledPlanning as any)?.platform_content_requests;
    const platformCount =
      typeof platformAllocation === 'object' && platformAllocation !== null && !Array.isArray(platformAllocation)
        ? Object.keys(platformAllocation).length
        : Array.isArray(platformAllocation)
          ? platformAllocation.length
          : 0;
    const requested_total =
      vr && typeof vr.requested_total === 'number'
        ? vr.requested_total
        : skeleton?.platform_postings_total ??
          skeleton?.total_weekly_content_count ??
          (skeleton?.execution_items as any[])?.reduce(
            (sum: number, it: any) => sum + (Number(it?.count_per_week) || 0),
            0
          );
    const weekly_capacity_total =
      vr && typeof vr.weekly_capacity_total === 'number'
        ? vr.weekly_capacity_total
        : (prefilledPlanning as any)?.weekly_capacity ?? (prefilledPlanning as any)?.content_capacity;
    const contentTypes =
      Array.isArray(skeleton?.content_type_mix)
        ? skeleton.content_type_mix
        : Array.isArray((prefilledPlanning as any)?.content_type_mix)
          ? (prefilledPlanning as any).content_type_mix
          : [];
    const strategyResult = determineDistributionStrategy({
      campaignDurationWeeks: resolvedDurationWeeks,
      weekly_capacity_total,
      requested_total: requested_total > 0 ? requested_total : undefined,
      platformCount: platformCount > 0 ? platformCount : undefined,
      contentTypes: contentTypes.length > 0 ? contentTypes : undefined,
      cross_platform_sharing:
        (prefilledPlanning as any)?.cross_platform_sharing != null
          ? Boolean((prefilledPlanning as any).cross_platform_sharing?.enabled ?? (prefilledPlanning as any).cross_platform_sharing)
          : undefined,
      campaignIntent: (prefilledPlanning as any)?.campaign_intent ?? undefined,
    });
    distributionStrategy = strategyResult.strategy;
    distributionReason = strategyResult.reason;
  }

  let strategyMemory: { preferred_tone?: string | null; preferred_platforms?: string[] } | null = null;
  let strategyLearningProfile: StrategyProfile | null = null;
  let strategyLearningFromCache = false;
  if (versionRow?.company_id) {
    try {
      strategyMemory = await getStrategyMemory(versionRow.company_id);
    } catch {
      // Optional; proceed without strategy memory
    }
    try {
      const { profile, fromCache } = await getCachedStrategyProfile(versionRow.company_id);
      strategyLearningProfile = profile;
      strategyLearningFromCache = fromCache;
    } catch {
      // Optional; proceed without strategy learning profile
    }
  }

  let campaignContext: CampaignContext | null = null;
  const strategicThemesRaw = (prefilledPlanning as any)?.strategic_themes ?? (prefilledPlanning as any)?.recommended_topics ?? [];
  const themeList = Array.isArray(strategicThemesRaw) ? strategicThemesRaw.map((t) => String(t ?? '').trim()).filter(Boolean) : [];
  const hasStrategicThemes = themeList.length > 0;
  const execConfigForCtx = (prefilledPlanning as any)?.execution_config as Record<string, unknown> | undefined;

  const shouldBuildCampaignContext =
    input.mode === 'generate_plan' && versionRow?.company_id
      ? true
      : !!(strategyMemory || strategyLearningProfile || hasStrategicThemes);

  if (shouldBuildCampaignContext) {
    let eligiblePlatforms: string[] | undefined =
      (prefilledPlanning as any)?.platforms
        ? String((prefilledPlanning as any).platforms).split(',').map((p: string) => p.trim()).filter(Boolean)
        : undefined;
    if (!eligiblePlatforms?.length && versionRow?.company_id) {
      try {
        const profile = await getProfile(versionRow.company_id, { autoRefine: false, languageRefine: true });
        eligiblePlatforms = getAvailablePlatformsFromProfile(profile);
      } catch {
        // Optional; proceed without company platforms
      }
    }
    const topicFallback =
      (prefilledPlanning as any)?.theme_or_description ??
      (prefilledPlanning as any)?.polished_title ??
      (prefilledPlanning as any)?.topic ??
      'Campaign';
    const effectiveThemes =
      themeList.length > 0
        ? themeList
        : typeof topicFallback === 'string' && topicFallback !== 'Campaign'
          ? [topicFallback]
          : undefined;
    campaignContext = buildCampaignContext({
      topic: typeof topicFallback === 'string' ? topicFallback : 'Campaign',
      tone: strategyMemory?.preferred_tone ?? undefined,
      themes: effectiveThemes,
      strategyMemory: strategyMemory
        ? {
            preferred_platforms: strategyMemory.preferred_platforms ?? [],
            preferred_content_types: (strategyMemory as { preferred_content_types?: string[] }).preferred_content_types ?? [],
          }
        : undefined,
      strategyLearningProfile: strategyLearningProfile ?? undefined,
      eligiblePlatforms,
      target_audience:
        typeof (prefilledPlanning as any)?.target_audience === 'string'
          ? (prefilledPlanning as any).target_audience
          : typeof execConfigForCtx?.target_audience === 'string'
            ? execConfigForCtx.target_audience
            : undefined,
      content_depth:
        typeof (prefilledPlanning as any)?.content_depth === 'string'
          ? (prefilledPlanning as any).content_depth
          : typeof execConfigForCtx?.content_depth === 'string'
            ? execConfigForCtx.content_depth
            : undefined,
      campaign_goal:
        typeof (prefilledPlanning as any)?.campaign_goal === 'string'
          ? (prefilledPlanning as any).campaign_goal
          : typeof execConfigForCtx?.campaign_goal === 'string'
            ? execConfigForCtx.campaign_goal
            : undefined,
    });
    // Augment for weekly planning: strategic theme progression, duration, learning profile
    campaignContext.strategic_themes = effectiveThemes ?? undefined;
    campaignContext.campaign_duration_weeks = resolvedDurationWeeks;
    campaignContext.strategy_learning_profile =
      strategyLearningProfile != null ? formatStrategyProfileForPrompt(strategyLearningProfile) : undefined;
    setCampaignContext(input.campaignId, campaignContext);
  }

  let result: CampaignAiPlanResult;
  try {
    result = await runWithContext(inputWithDuration, {
      ...ctx,
      companyId: versionRow?.company_id ?? null,
      fastPath: useFastPath,
      prefilledPlanning,
      strategyMemory,
      strategyLearningProfile,
      strategyLearningFromCache,
      campaignContext,
      distributionStrategy,
      distributionReason,
      planSkeleton:
        input.mode === 'generate_plan' && !deterministicSkeleton
          ? buildDeterministicPlanSkeleton({
              durationWeeks: resolvedDurationWeeks,
              contentCapacity: prefilledPlanning?.content_capacity,
            })
          : null,
      qaState: qaState
        ? {
            answeredKeys: qaState.answeredKeys,
            userConfirmed: qaState.userConfirmed,
            nextQuestion: qaState.nextQuestion,
            readyToGenerate: qaState.readyToGenerate,
            allRequiredAnswered: qaState.allRequiredAnswered,
            missingRequiredKeys: qaState.missingRequiredKeys,
          }
        : undefined,
    });
  } catch (aiErr) {
    // Failsafe: if AI generation fails and we have a mapped skeleton, return structure + themes without AI topics
    const mappedSkeleton = (prefilledPlanning as any)?.mapped_weekly_skeleton as MappedWeeklySkeleton | null | undefined;
    if (input.mode === 'generate_plan' && mappedSkeleton?.weekly_strategies?.length) {
      console.warn('[campaign-ai][failsafe] AI generation failed, returning mapped skeleton without AI topics:', aiErr);
      const fallbackWeeks = mappedSkeleton.weekly_strategies.map((ws) => ({
        week: ws.week,
        theme: ws.theme,
        funnel_stage: ws.funnel_stage,
        primary_objective: ws.primary_objective,
        daily: [],
      }));
      return {
        mode: input.mode,
        snapshot_hash: ctx.snapshot_hash,
        omnivyre_decision: ctx.omnivyreDecision,
        plan: { weeks: fallbackWeeks },
        raw_plan_text: JSON.stringify({ weeks: fallbackWeeks }),
        validation_result: (prefilledPlanning as any)?.validation_result ?? null,
      };
    }
    throw aiErr;
  }

  if (result.omnivyre_decision && baselineContext && !('unavailable' in baselineContext)) {
    result.omnivyre_decision = {
      ...result.omnivyre_decision,
      raw: {
        ...(typeof result.omnivyre_decision.raw === 'object' && result.omnivyre_decision.raw
          ? result.omnivyre_decision.raw
          : {}),
        baseline: {
          expectedBaseline: baselineContext.expectedBaseline,
          actualFollowers: baselineContext.actualFollowers,
          ratio: baselineContext.ratio,
          status: baselineContext.status,
        },
      },
    };
  }

  // Post-generation validation gate: deterministic, fast, no AI.
  let campaign_validation: CampaignValidation | null = null;
  if (input.mode === 'generate_plan' && Array.isArray(result.plan?.weeks) && result.plan!.weeks.length > 0) {
    try {
      const pcr = (prefilledPlanning as any)?.platform_content_requests;
      const platformsForValidation: string[] = Array.isArray(pcr)
        ? [...new Set((pcr as any[]).map((r: any) => String(r?.platform ?? '')).filter(Boolean))]
        : typeof pcr === 'object' && pcr !== null
          ? Object.keys(pcr).filter(Boolean)
          : (prefilledPlanning as any)?.platforms ?? [];
      const postingFreqForValidation: Record<string, number> = {};
      for (const p of platformsForValidation) postingFreqForValidation[p] = 3;
      // Use posting_frequency from prefilled if available
      const rawFreq = (prefilledPlanning as any)?.posting_frequency;
      const effectiveFreq = (rawFreq && typeof rawFreq === 'object' && !Array.isArray(rawFreq))
        ? rawFreq as Record<string, number>
        : postingFreqForValidation;

      campaign_validation = validateCampaignPlan({
        plan: result.plan!,
        strategy_context: {
          duration_weeks: resolvedDurationWeeks,
          platforms: platformsForValidation,
          posting_frequency: effectiveFreq,
          content_mix: (prefilledPlanning as any)?.content_mix ?? null,
          campaign_goal: (prefilledPlanning as any)?.campaign_goal ?? null,
          target_audience: (prefilledPlanning as any)?.target_audience ?? null,
        },
        account_context: input.account_context ?? null,
        execution_items: deterministicSkeleton?.execution_items ?? null,
      });
    } catch (validationErr) {
      console.warn('[PLANNER][VALIDATION][WARN] Non-fatal: validation failed:', validationErr);
    }
  }

  // Paid amplification decision: runs only when validation succeeded.
  let paid_recommendation: PaidRecommendation | null = null;
  if (campaign_validation) {
    try {
      const platformsForPaid: string[] = Array.isArray(campaign_validation)
        ? []
        : ((prefilledPlanning as any)?.platforms ?? []);
      paid_recommendation = generatePaidRecommendation({
        plan: result.plan!,
        campaign_validation,
        account_context: input.account_context ?? null,
        strategy_context: {
          duration_weeks: resolvedDurationWeeks,
          platforms: platformsForPaid,
          posting_frequency: (prefilledPlanning as any)?.posting_frequency ?? {},
          campaign_goal: (prefilledPlanning as any)?.campaign_goal ?? null,
        },
      });
    } catch (paidErr) {
      console.warn('[PLANNER][ADS][WARN] Non-fatal: paid amplification engine failed:', paidErr);
    }
  }

  return {
    ...result,
    validation_result: (prefilledPlanning as any)?.validation_result ?? null,
    campaign_validation,
    paid_recommendation,
  };
}
