/**
 * blogRunnerTypes.ts
 *
 * Types and interfaces used by runBlogGeneration and related runner modules.
 * Extracted from runBlogGeneration.ts to keep that file under 500 lines.
 */

import type { AngleType, BlogAngle, BlogGenerationOutput, SeriesSummary } from './blogGenerationEngine';
import type { ClarificationQuestion } from './blogClarificationEngine';
import type { AngleEffectivenessEntry } from './feedbackOptimizationEngine';
import type { SEOIntelligenceResult } from './seoIntelligenceEngine';
import type { TrendIntelligenceResult } from './trendIntelligenceEngine';
import type { HookAssessment } from './hookAssessment';
import type {
  BlogFormatType,
  ArticleFormatType,
  WhitepaperFormatType,
  NewsletterFormatType,
  StoryFormatType,
  GuideFormatType,
} from './blogStructureTemplates';
import type {
  StrategyProfile,
  RecommendationContext,
  CompanyProfile,
} from '../../backend/services/companyProfile/types';

/**
 * Phase 2.4 — Expanded strategic context surface.
 *
 * `CompanyContext` previously dropped ~30 of the 68 columns loaded by
 * `getProfile()`. The audit identified these as the primary driver of weak
 * company alignment in generated content. The expanded surface preserves
 * nested structures verbatim (no partial mapping) and adds two telemetry
 * fields so downstream consumers can detect sparse profiles.
 *
 * See lib/content/buildContentContext.ts for the population logic and
 * lib/content/companyContextCompleteness.ts for the scoring rules.
 */
export interface ContextCompletenessReport {
  /** 0–100 score: percentage of strategic fields populated. */
  score: number;
  /** Field keys that are absent OR empty on this profile. */
  missing_context_fields: string[];
  /** Field keys that are present AND non-empty. */
  populated_context_fields: string[];
  /** Field keys whose value the strategic critical fields. */
  critical_fields_missing: string[];
}

// ── Injectable data-access signatures ────────────────────────────────────────

export type FetchAngleDataFn = (
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
) => Promise<AngleType | null>;

export type FetchSeriesDataFn = (
  ids:       string[],
  companyId: string,
  blogTable: 'blogs' | 'public_blogs',
) => Promise<SeriesSummary[]>;

// ── Company context ───────────────────────────────────────────────────────────

export interface CompanyContext {
  // ── Original 17 fields (unchanged) ─────────────────────────────────────────
  brand_voice?: string;
  audience?:    string;
  industry?:    string;
  companyName?:            string;
  uniqueValue?:            string;
  competitiveAdvantages?:  string;
  productsServices?:       string;
  contentThemes?:          string;
  campaignFocus?:          string;
  growthPriorities?:       string;
  coreProblemStatement?:   string;
  painSymptoms?:           string[];
  authorityDomains?:       string[];
  desiredTransformation?:  string;
  keyMessages?:            string;
  goals?:                  string;
  geography?:              string;
  strategyProfile?:        StrategyProfile;
  /**
   * Pre-formatted writing style instructions block from WritingStyleEngine.
   */
  writingStyleInstructions?: string;

  // ── Phase 2.4 expansion: strategic fields previously dropped ──────────────
  // These were loaded by getProfile() but never mapped into CompanyContext.
  // The audit identified them as the primary cause of weak company alignment.
  // Nested structures are preserved verbatim — no partial mapping.

  /** Detailed ICP (Ideal Customer Profile). */
  idealCustomerProfile?: string;
  /** Cost/scope of the problem in business terms. */
  problemImpact?: string;
  /** Gap between current and ideal awareness state. */
  awarenessGap?: string;
  /** Concrete daily experience of living with the problem. */
  lifeWithProblem?: string;
  /** Concrete daily experience after the problem is solved. */
  lifeAfterSolution?: string;
  /** How the transformation is actually achieved (the mechanism). */
  transformationMechanism?: string;
  /** Strategic beliefs, key threats, contrarian angles, insights. */
  recommendationContext?: RecommendationContext | null;
  /** Channels actively used for marketing. */
  marketingChannels?: string;
  /** Documented content strategy. */
  contentStrategy?: string;
  /** Known/named competitors string. */
  competitors?: string;
  /** Sales motion (PLG, SLG, enterprise, etc.). */
  salesMotion?: string;
  /** Pricing model (subscription, one-time, freemium, etc.). */
  pricingModel?: string;
  /** Average deal size. */
  avgDealSize?: string;
  /** Sales cycle length. */
  salesCycle?: string;
  /**
   * Full report_settings JSON: entity_archetype, competitor_intelligence,
   * user_guidance, market_pulse, industry_review, default_inputs, etc.
   * Preserved as full nested shape — downstream identity extraction
   * (`extractCompanyIdentity`) reads multiple sub-keys.
   */
  reportSettings?: CompanyProfile['report_settings'] | null;
  /** Content Architect strategic inputs. */
  strategicInputs?: CompanyProfile['strategic_inputs'] | null;

  // ── Phase 2.4 telemetry: completeness scoring ─────────────────────────────
  /** 0–100 score of how many strategic fields are populated. */
  context_completeness_score?: number;
  /** Field names that are missing or empty on this profile. */
  missing_context_fields?: string[];
}

// ── Request ───────────────────────────────────────────────────────────────────

export interface BlogGenerationRequest {
  company_id:       string;
  mode?:            'angles' | 'full';
  topic:            string;
  cluster?:         string;
  intent?:          string;
  target_words?:    number;
  related_blogs?:   string[];
  series_blog_ids?: string[];
  series_context?:  string;
  answers?:         Record<string, string>;
  selected_angle?:  BlogAngle;
  tone?:            string;
  goal_type?:       string;
  blogTable?: 'blogs' | 'public_blogs';
  companyContext?: CompanyContext;
  /**
   * Phase 2.5 — Canonical company profile, passed through verbatim so
   * `extractCompanyIdentity(profile)` is the single identity extractor.
   * When provided this replaces the ad-hoc CompanyIdentity construction
   * that used to live at `runBlogGeneration.ts:710-724`.
   */
  companyProfile?: CompanyProfile | null;
  fetchAngleData?: FetchAngleDataFn;
  fetchSeriesData?: FetchSeriesDataFn;
  contentType?: 'blog' | 'article' | 'whitepaper' | 'newsletter' | 'story' | 'guide';
  formatType?: BlogFormatType | ArticleFormatType | WhitepaperFormatType | NewsletterFormatType | StoryFormatType | GuideFormatType;
  template_blocks?: import('./blockTypes').ContentBlock[];
  template_name?: string;
  cache_version?: string;
}

// ── Result discriminated union ────────────────────────────────────────────────

export type BlogGenerationResult =
  | {
      needs_clarification: true;
      questions:           ClarificationQuestion[];
    }
  | {
      needs_clarification: false;
      mode:                'angles';
      angles:              BlogAngle[];
      recommended_angle:   AngleType | null;
      angle_effectiveness?: Partial<Record<AngleType, AngleEffectivenessEntry>>;
      effectiveness_based?: boolean;
      seo_intelligence?: SEOIntelligenceResult;
      trend_intelligence?: TrendIntelligenceResult;
    }
  | {
      needs_clarification: false;
      mode:                'full';
      confidence:          'high' | 'medium';
      result:              BlogGenerationOutput & { content_blocks: unknown[] };
      hook_assessment:     HookAssessment;
      template_used?:      boolean;
      seo_intelligence?: SEOIntelligenceResult;
      trend_intelligence?: TrendIntelligenceResult;
      /**
       * Phase 1.2 — Lightweight operational metadata only.
       * Replaces the deleted validator/recovery/acceptance/regeneration
       * envelope cascade which produced metadata-only payloads.
       */
      editorial_diagnostics?: LightweightEditorialDiagnostics;
    };

/**
 * Lightweight editorial diagnostics — replaces the 30+-stage envelope chain
 * removed in Phase 1.2. See lib/blog/runBlogGeneration.ts.
 */
export interface LightweightEditorialDiagnostics {
  generation_engine: string;       // 'compatibility-core' | 'planned-sectionwise-v1'
  generation_mode: string;         // 'full' | 'angles' | ...
  fallback_triggered: boolean;
  generation_duration_ms: number;
  section_count?: number;
  retry_count?: number;
}
