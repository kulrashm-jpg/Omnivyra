/** Part 1/2 of BlogGenerateModal.tsx — verbatim split (barrel preserved; importers unchanged). */
/**
 * BlogGenerateModal
 *
 * Shared 4-step modal for AI long-form content generation.
 *
 * Step 1 — Theme Input:    topic, cluster, intent, series selection
 * Step 2 — Clarify:        targeted questions (only when signal is weak)
 * Step 3 — Pick Angle:     3 editorial directions + recommended badge from historical performance
 * Step 4 — Generating:     loading state while full post is constructed
 *
 * On completion, calls onGenerated(output, confidence, hookAssessment) so the parent
 * can pre-fill the editor, show a confidence badge, and warn about weak hooks.
 */

import React, { useState } from 'react';
import {
  X, Loader2, Sparkles, ChevronRight, ArrowLeft,
  Target, Layers, Lightbulb, BarChart2, Zap, TrendingUp,
  BookOpen, Check, AlertCircle, Star,
} from 'lucide-react';
import type { BlogGenerationOutput, BlogAngle, AngleType } from '../../lib/blog/blogGenerationEngine';
import type { ClarificationQuestion } from '../../lib/blog/blogClarificationEngine';
import type { HookAssessment } from '../../lib/blog/hookAssessment';
import type { AngleEffectivenessEntry } from '../../lib/blog/feedbackOptimizationEngine';
import type { SEOIntelligenceResult } from '../../lib/blog/seoIntelligenceEngine';
import type { TrendIntelligenceResult } from '../../lib/blog/trendIntelligenceEngine';
import { BLOG_FORMAT_OPTIONS, ARTICLE_FORMAT_OPTIONS, WHITEPAPER_FORMAT_OPTIONS, NEWSLETTER_FORMAT_OPTIONS, STORY_FORMAT_OPTIONS, GUIDE_FORMAT_OPTIONS, type BlogFormatType, type ArticleFormatType, type WhitepaperFormatType, type NewsletterFormatType, type StoryFormatType, type GuideFormatType } from '../../lib/blog/blogStructureTemplates';
import type { ContentBlock } from '../../lib/blog/blockTypes';
import { getRecommendedTemplateCards, getTemplateCards } from '../../lib/content/contentTemplateCards';
import type { ManagedContentType } from '../../lib/content/contentTemplateRegistry';

// ── Types ─────────────────────────────────────────────────────────────────────


interface SeriesBlog {
  id:         string;
  title:      string;
  slug:       string | null;
  angle_type?: string | null;
}

export interface IndustryAngle {
  angle_type:     AngleType;
  recommendation: 'best' | 'good' | 'avoid';
  prior_note:     string;
  confidence:     'data' | 'prior';
}

export interface Props {
  companyId:   string;
  clusters?:   string[];
  blogs?:      SeriesBlog[];
  industry?:   string | null;   // company industry — powers Angle × Industry Matrix
  initialTopic?: string;
  initialTargetWords?: string;
  initialIntent?: 'awareness' | 'authority' | 'conversion' | 'retention';
  initialTone?: string;
  initialRelatedBlogs?: string[];
  baseAnswers?: Record<string, string>;
  initialTemplateName?: string;
  initialTemplateBlocks?: ContentBlock[];
  /** 'blog' (default), 'article', 'whitepaper', 'newsletter', 'story', 'guide', or 'case-study' — changes API endpoint and prompt tone */
  contentType?: 'blog' | 'article' | 'whitepaper' | 'newsletter' | 'story' | 'guide' | 'case-study';
  /** Format type from briefing page. Default: 'standard'. */
  initialFormatType?: BlogFormatType | ArticleFormatType | WhitepaperFormatType | NewsletterFormatType | StoryFormatType | GuideFormatType;
  onClose:     () => void;
  onGenerated: (
    output:         BlogGenerationOutput & { content_blocks?: unknown[] },
    confidence:     'high' | 'medium',
    hookAssessment: HookAssessment,
    angleType:      AngleType | null,
  ) => void | Promise<void>;
}

export type Step = 'theme' | 'clarify' | 'angles' | 'generating';
export type GenerationKind = 'angles' | 'full';

export type QualityGateReport = {
  failures?: string[];
  companyPovScore?: number;
  strategicValueScore?: number;
  executiveRelevanceScore?: number;
  rebrandResistanceScore?: number;
  genericityScore?: number;
  editorialBodyScore?: number;
  duplicationScore?: number;
  frameworkPresence?: { passed?: boolean; score?: number };
  executiveAudience?: { issues?: string[]; businessImplicationSignals?: string[] };
  editorialBody?: { issues?: string[] };
  contentDuplication?: { issues?: string[] };
};

type GenerationTrackerStep = {
  label: string;
  detail: string;
  minProgress: number;
};

export const INTENT_OPTIONS = [
  { value: '',           label: 'Any — let AI decide' },
  { value: 'awareness',  label: 'Awareness — introduce a concept or problem' },
  { value: 'authority',  label: 'Authority — establish deep expertise' },
  { value: 'conversion', label: 'Conversion — move readers toward action' },
  { value: 'retention',  label: 'Retention — help practitioners go deeper' },
];

export const ANGLE_META: Record<AngleType, { icon: React.ReactNode; color: string; border: string; bg: string }> = {
  analytical: {
    icon:   <BarChart2 className="h-5 w-5" />,
    color:  'text-blue-600',
    border: 'border-blue-200',
    bg:     'bg-blue-50',
  },
  contrarian: {
    icon:   <Zap className="h-5 w-5" />,
    color:  'text-amber-600',
    border: 'border-amber-200',
    bg:     'bg-amber-50',
  },
  strategic: {
    icon:   <TrendingUp className="h-5 w-5" />,
    color:  'text-emerald-600',
    border: 'border-emerald-200',
    bg:     'bg-emerald-50',
  },
};

const STEPS: Step[] = ['theme', 'clarify', 'angles', 'generating'];

export const ANGLE_TRACKER_STEPS: GenerationTrackerStep[] = [
  { label: 'Read input', detail: 'Checking topic, intent, and company context.', minProgress: 5 },
  { label: 'Clarify signal', detail: 'Deciding whether more context is needed.', minProgress: 25 },
  { label: 'Build angles', detail: 'Creating distinct editorial directions.', minProgress: 55 },
  { label: 'Rank direction', detail: 'Applying market and performance signals.', minProgress: 78 },
];

export const FULL_TRACKER_STEPS: GenerationTrackerStep[] = [
  { label: 'Lock angle', detail: 'Applying the selected editorial direction.', minProgress: 5 },
  { label: 'Build organization POV', detail: 'Injecting company viewpoint and strategic recommendation.', minProgress: 18 },
  { label: 'Plan argument', detail: 'Creating executive thesis, framework, and section roles.', minProgress: 34 },
  { label: 'Write sections', detail: 'Drafting section-by-section with no repeated hooks.', minProgress: 52 },
  { label: 'Check duplication', detail: 'Removing repeated section substance and stale scaffolding.', minProgress: 70 },
  { label: 'Run quality gates', detail: 'Scoring strategic value, executive relevance, POV, and structure.', minProgress: 86 },
  { label: 'Prepare draft', detail: 'Assembling final HTML, metadata, and editor blocks.', minProgress: 96 },
];


export function stepProgress(step: Step, hasClarify: boolean): number {
  if (step === 'theme')      return 25;
  if (step === 'clarify')    return 50;
  if (step === 'angles')     return hasClarify ? 75 : 50;
  return 100;
}
