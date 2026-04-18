import type { AlignmentEvaluation, AlignmentSuggestion, WeeklyAlignmentProfile } from './types';
import { ALIGNMENT_ACCEPT_THRESHOLD } from './types';
import { normalizeDeliverableType } from './planSkeletonHelpers';

export function clampScore(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function tryParseJsonObject(raw: string): Record<string, unknown> | null {
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

export function parseAlignmentEvaluation(raw: string): AlignmentEvaluation {
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

export function buildAlignmentProfile(evaluation: AlignmentEvaluation | null | undefined): WeeklyAlignmentProfile {
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

export function readContextText(source: Record<string, unknown> | null | undefined, keys: string[]): string {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function normalizePlatformKey(platform: string): string {
  const p = String(platform || '').trim().toLowerCase();
  if (p === 'twitter') return 'x';
  return p;
}

export function getPlatformWordLimit(platform: string): number {
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

export function ctaToDesiredAction(ctaType: string): string {
  const cta = String(ctaType || '').toLowerCase();
  if (cta.includes('direct conversion')) return 'Take the conversion step now (book, sign up, or request demo).';
  if (cta.includes('engagement')) return 'Engage with the post (comment, reply, or share a perspective).';
  if (cta.includes('authority')) return 'Acknowledge expertise and continue following the framework.';
  if (cta.includes('soft')) return 'Take a low-friction next step (follow, save, or share).';
  return 'Consume the insight and stay engaged with the campaign.';
}

export function actionExpectationToDesiredAction(value: unknown): string | null {
  const n = String(value ?? '').trim().toLowerCase();
  if (!n) return null;
  if (n.includes('follow')) return 'Follow us for more.';
  if (n.includes('contact')) return 'Contact us to continue the conversation.';
  if (n.includes('visit')) return 'Visit our website to learn more.';
  if (n.includes('understand')) return 'Understand the topic better and take notes.';
  return null;
}

export function communicationStyleToTone(value: unknown): string | null {
  const n = String(value ?? '').trim().toLowerCase();
  if (!n) return null;
  if (n.includes('simple')) return 'simple, easy to understand';
  if (n.includes('professional') || n.includes('expert')) return 'professional, expert';
  if (n.includes('friendly') || n.includes('conversational')) return 'friendly, conversational';
  if (n.includes('deep') || n.includes('thoughtful')) return 'deep, thoughtful';
  return null;
}

export function contentDepthScale(value: unknown): number {
  const n = String(value ?? '').trim().toLowerCase();
  if (!n) return 1;
  if (n.includes('short')) return 0.65;
  if (n.includes('medium')) return 1;
  if (n.includes('deep')) return 1.25;
  return 1;
}

export function platformToPrimaryFormat(platform: string): string {
  const normalized = normalizePlatformKey(platform);
  if (normalized === 'blog') return 'long-form article';
  if (normalized === 'youtube' || normalized === 'tiktok') return 'video script';
  if (normalized === 'linkedin') return 'long-form social post';
  if (normalized === 'instagram') return 'carousel + caption';
  if (normalized === 'x') return 'thread';
  return 'social post';
}

export function approximateDepthForTarget(wordTarget: number): string {
  if (wordTarget >= 1500) return 'Deep-dive';
  if (wordTarget >= 1000) return 'Comprehensive';
  if (wordTarget >= 700) return 'Standard';
  return 'Concise';
}

export function deterministicFormatRequirements(contentTypeRaw: string): {
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

export function validateContentTypeFormatPlatform(input: {
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

export function narrativePositionFromIndex(globalIndex: number, total: number): 'start' | 'middle' | 'conversion' {
  const safeTotal = Math.max(1, Number.isFinite(total) ? Math.floor(total) : 1);
  const safeIndex = Math.min(safeTotal, Math.max(1, Number.isFinite(globalIndex) ? Math.floor(globalIndex) : 1));
  const startCutoff = Math.max(1, Math.ceil(safeTotal * 0.25));
  const conversionStart = Math.max(startCutoff + 1, Math.floor(safeTotal * 0.75) + 1);
  if (safeIndex <= startCutoff) return 'start';
  if (safeIndex >= conversionStart) return 'conversion';
  return 'middle';
}

export function narrativeRoleFromPosition(position: unknown): 'awareness' | 'education' | 'action' {
  const p = String(position ?? '').toLowerCase().trim();
  if (p === 'start') return 'awareness';
  if (p === 'conversion') return 'action';
  return 'education';
}

export function hasNumericAlignmentScore(posting: any): boolean {
  const candidates = [posting?.alignment_score, posting?.alignmentScore, posting?.final_alignment_score, posting?.finalAlignmentScore];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return true;
  }
  return false;
}

export function deterministicAlignmentReasonDefaults(): string[] {
  return [
    'Matches weekly objective',
    'Supports audience pain point',
    'Aligns with campaign theme',
  ];
}

export function ensureWriterFormatRequirements(brief: any, contentType: unknown, correctedFormatFamily: unknown): void {
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
