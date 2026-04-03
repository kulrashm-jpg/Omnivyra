/**
 * UNIFIED CONTENT VALIDATION SERVICE
 *
 * Consolidates validation logic from:
 * - contentValidationService.ts
 * - aiOutputValidationService.ts
 *
 * Single source of truth for content validation across all types.
 * Provides: validation, auto-repair, quality scoring.
 */

import { ContentBlueprint, ContentType, AngleType } from '../services/unifiedContentGenerationEngine';
import { getValidationRules, VALIDATION_RULES } from '../prompts/contentGenerationPromptsV3';

export interface ValidationResult {
  pass: boolean;
  severity?: 'info' | 'warning' | 'blocking';
  issues?: string[];
  auto_repairs?: string[];
}

export interface ContentQualityScore {
  overall_score: number; // 0-100
  hook_quality: number;
  key_points_quality: number;
  cta_quality: number;
  structure_quality: number;
  tone_appropriateness?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN VALIDATION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

export function validateContentQuality(
  blueprint: ContentBlueprint,
  contentType: ContentType
): ValidationResult {
  const rules = getValidationRules(contentType);
  const issues: string[] = [];
  const autoRepairs: string[] = [];

  // Check hook
  if (rules.required_hook && !blueprint.hook?.trim()) {
    issues.push('Missing hook (opening statement)');
  } else if (blueprint.hook) {
    const hookLength = blueprint.hook.trim().length;
    if (hookLength < 10) {
      issues.push(`Hook too short (${hookLength} chars, need ≥10)`);
    }
    const hookWords = blueprint.hook.split(/\s+/).filter((w) => w.length > 0).length;
    if (hookWords < 3) {
      issues.push(`Hook has only ${hookWords} words (need ≥3)`);
    }
  }

  // Check key points
  const keyPoints = Array.isArray(blueprint.key_points)
    ? blueprint.key_points.filter((k) => k?.trim())
    : [];
  if (keyPoints.length < rules.min_key_points) {
    issues.push(
      `Not enough key points: have ${keyPoints.length}, need ${rules.min_key_points}`
    );
  }
  for (let i = 0; i < keyPoints.length; i++) {
    if ((keyPoints[i]?.length || 0) < 5) {
      issues.push(`Key point ${i + 1} too short`);
    }
  }

  // Check CTA
  if (rules.required_cta && !blueprint.cta?.trim()) {
    issues.push('Missing call-to-action');
  } else if (blueprint.cta) {
    const ctaLength = blueprint.cta.trim().length;
    if (ctaLength < 5) {
      issues.push(`CTA too short (${ctaLength} chars)`);
    }
  }

  // Check overall length
  const fullText = contentBlueprintToText(blueprint);
  if (fullText.length < rules.min_length) {
    issues.push(
      `Content too short: ${fullText.length} chars, need ≥${rules.min_length}`
    );
  }
  if (fullText.length > rules.max_length) {
    issues.push(
      `Content too long: ${fullText.length} chars, max ${rules.max_length}`
    );
  }

  // Check for quality markers
  if (contentType === 'blog' || contentType === 'whitepaper') {
    if (!fullText.includes('http') && rules.required_references) {
      issues.push('Missing references (no URLs found)');
    }
  }

  // Attempt auto-repairs for common issues
  if (!blueprint.hook?.trim() && rules.required_hook) {
    blueprint.hook = generateDefaultHook(blueprint, contentType);
    autoRepairs.push('Generated default hook');
  }

  if (!blueprint.cta?.trim() && rules.required_cta) {
    blueprint.cta = generateDefaultCTA(contentType);
    autoRepairs.push('Generated default CTA');
  }

  // Determine severity
  let severity: 'info' | 'warning' | 'blocking' = 'info';
  if (issues.length > 0) {
    // Blocking if missing required elements
    if (issues.some((i) => i.includes('Missing'))) {
      severity = 'blocking';
    } else if (issues.some((i) => i.includes('short'))) {
      severity = 'warning';
    }
  }

  return {
    pass: issues.length === 0,
    severity,
    issues: issues.length > 0 ? issues : undefined,
    auto_repairs: autoRepairs.length > 0 ? autoRepairs : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT QUALITY SCORING
// ─────────────────────────────────────────────────────────────────────────────

export function scoreContentQuality(
  blueprint: ContentBlueprint,
  contentType: ContentType
): ContentQualityScore {
  let hookScore = 0;
  let keyPointsScore = 0;
  let ctaScore = 0;
  let structureScore = 0;

  // Hook quality (0-20 points)
  if (blueprint.hook?.trim()) {
    hookScore = 10;
    const hookLength = blueprint.hook.trim().length;
    if (hookLength > 30 && hookLength < 200) hookScore += 5;
    if (!blueprint.hook.includes('?') && blueprint.hook.length > 20) hookScore += 5; // Statement, not question
  }

  // Key points quality (0-30 points)
  const keyPoints = Array.isArray(blueprint.key_points)
    ? blueprint.key_points.filter((k) => k?.trim())
    : [];
  const rules = getValidationRules(contentType);
  if (keyPoints.length >= rules.min_key_points) {
    keyPointsScore = 15;
    if (keyPoints.length >= rules.min_key_points + 2) keyPointsScore += 10;
    if (keyPoints.every((k) => (k?.length || 0) > 15)) keyPointsScore += 5;
  }

  // CTA quality (0-20 points)
  if (blueprint.cta?.trim()) {
    ctaScore = 10;
    const ctaText = blueprint.cta.toLowerCase();
    if (
      ctaText.includes('learn') ||
      ctaText.includes('discover') ||
      ctaText.includes('explore') ||
      ctaText.includes('read')
    ) {
      ctaScore += 10;
    } else {
      ctaScore += 5;
    }
  }

  // Structure quality (0-30 points)
  const fullText = contentBlueprintToText(blueprint);
  structureScore = 10; // Base score
  if (fullText.includes('\n\n')) structureScore += 10; // Has breaks
  if (fullText.length > 100) structureScore += 10; // Substantial content

  const overallScore = Math.round((hookScore + keyPointsScore + ctaScore + structureScore) / 2);

  return {
    overall_score: Math.min(100, overallScore),
    hook_quality: Math.min(20, hookScore),
    key_points_quality: Math.min(30, keyPointsScore),
    cta_quality: Math.min(20, ctaScore),
    structure_quality: Math.min(30, structureScore),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-REPAIR FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function generateDefaultHook(blueprint: ContentBlueprint, contentType: ContentType): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topic = (blueprint.metadata?.decision_trace as any)?.source_topic || 'Topic';

  const hooks: Record<ContentType, string> = {
    blog: `Here's what every professional should know about ${topic}.`,
    post: `Stop scrolling. This changes how you think about ${topic}.`,
    whitepaper: `Executive summary: ${topic} is more critical than most realize.`,
    story: `Let me tell you about ${topic}.`,
    newsletter: `This week: Deep dive into ${topic}.`,
    article: `Understanding ${topic} in 2025.`,
    thread: `Thread: What you need to know about ${topic}. 1/`,
    carousel: `The truth about ${topic}`,
    video_script: `[INTRO] Today we're talking about ${topic}.`,
    engagement_response: `Great question about ${topic}!`,
  };

  return hooks[contentType] || `Introducing: ${topic}`;
}

function generateDefaultCTA(contentType: ContentType): string {
  const ctas: Record<ContentType, string> = {
    blog: 'Ready to take action? Start with the recommendations above.',
    post: 'Drop a comment with your thoughts.',
    whitepaper: 'Download the full report for detailed methodology.',
    story: 'What would you have done differently?',
    newsletter: 'Reply with your biggest takeaway.',
    article: 'Share this with someone who needs to read it.',
    thread: 'What aspect resonates most with you? Reply in the thread.',
    carousel: 'Save this for later.',
    video_script: '[CLOSING] Like and subscribe for more insights.',
    engagement_response: 'Thanks for the engagement!',
  };

  return ctas[contentType] || 'Learn more and take action today.';
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

export function contentBlueprintToText(blueprint: ContentBlueprint): string {
  const parts = [
    blueprint.hook,
    ...(Array.isArray(blueprint.key_points) ? blueprint.key_points : []),
    blueprint.cta,
  ];
  return parts.filter(Boolean).join('\n\n');
}

export function validateContentBlueprint(blueprint: any): ContentBlueprint | null {
  if (!blueprint || typeof blueprint !== 'object') {
    return null;
  }

  const hook = typeof blueprint.hook === 'string' ? blueprint.hook.trim() : '';
  const cta = typeof blueprint.cta === 'string' ? blueprint.cta.trim() : '';
  const keyPoints = Array.isArray(blueprint.key_points)
    ? blueprint.key_points.filter((k: any) => typeof k === 'string' && k.trim())
    : [];

  // Minimal validation: must have at least hook or key points
  if (!hook && keyPoints.length === 0) {
    return null;
  }

  return {
    hook,
    key_points: keyPoints,
    cta,
    metadata: blueprint.metadata,
  };
}

export function validatePlatformVariants(variants: any[]): any[] {
  if (!Array.isArray(variants)) return [];

  return variants.filter((v) => {
    // Must have platform, content_type, and generated_content
    return (
      v.platform &&
      v.content_type &&
      (v.generated_content || v.generation_status === 'generated')
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TONE & SENTIMENT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

export function validateToneAppropriate(
  content: string,
  expectedTone: string
): { appropriate: boolean; confidence: number; feedback?: string } {
  const lower = content.toLowerCase();

  // Tone indicators
  const toneIndicators: Record<string, string[]> = {
    professional: ['hereby', 'accordingly', 'therefore', 'moreover', 'however', 'analysis'],
    casual: ['hey', 'cool', 'awesome', 'honestly', 'anyway', 'lol'],
    formal: ['respectfully', 'hereby', 'furthermore', 'notwithstanding', 'technical'],
    friendly: ['love', 'great', 'amazing', 'happy', 'thanks', 'looking forward'],
    analytical: ['data', 'evidence', 'findings', 'research', 'shows', 'indicates'],
    empathetic: ['understand', 'feel', 'appreciate', 'support', 'care', 'together'],
  };

  const indicators = toneIndicators[expectedTone] || [];
  const matches = indicators.filter((indicator) => lower.includes(indicator)).length;
  const confidence = Math.round((matches / Math.max(indicators.length, 1)) * 100);

  return {
    appropriate: confidence >= 30,
    confidence,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

