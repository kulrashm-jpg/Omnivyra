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
import type { EditorialDiagnosticReport } from '../content/editorialDiagnosticObserver';
import type {
  BlogFormatType,
  ArticleFormatType,
  WhitepaperFormatType,
  NewsletterFormatType,
  StoryFormatType,
  GuideFormatType,
} from './blogStructureTemplates';
import type { StrategyProfile } from '../../backend/services/companyProfile/types';

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
      editorial_diagnostics?: EditorialDiagnosticReport;
    };
