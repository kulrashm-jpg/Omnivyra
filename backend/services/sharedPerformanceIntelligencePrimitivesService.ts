import type { PerformanceBehaviorIntelligence } from './performanceBehaviorIntelligenceService';
import type { PerformanceSearchIntelligence, SearchOpportunityType } from './performanceSearchIntelligenceService';

export type SharedIntelligencePrimitiveType =
  | 'weak_landing_page'
  | 'high_opportunity_keyword'
  | 'declining_page'
  | 'rising_page'
  | 'strong_conversion_theme'
  | 'engagement_friction'
  | 'ctr_opportunity'
  | 'search_intent_mismatch';

export type SharedIntelligencePrimitive = {
  primitive_type: SharedIntelligencePrimitiveType;
  source: 'ga' | 'gsc' | 'ga_gsc_join';
  title: string;
  summary: string;
  confidence: 'none' | 'low' | 'medium' | 'high';
  severity: 'low' | 'medium' | 'high';
  page_url?: string | null;
  keyword?: string | null;
  intent_group?: string | null;
  recommended_creator_uses: Array<
    | 'seo_aware_generation'
    | 'search_demand_generation'
    | 'engagement_recommendation'
    | 'landing_page_optimization'
    | 'conversion_messaging'
    | 'content_refresh'
  >;
  evidence: Record<string, string | number | boolean | null>;
};

export type CreatorCompatibilityType =
  | 'blog'
  | 'article'
  | 'guide'
  | 'newsletter'
  | 'story'
  | 'whitepaper'
  | 'case-study'
  | 'post'
  | 'thread';

export type CreatorCompatibilityAssessment = {
  content_type: CreatorCompatibilityType;
  readiness: 'immediate' | 'minor_adapter' | 'later';
  easiest_primitives: SharedIntelligencePrimitiveType[];
  needs: string[];
  recommended_first_use: string;
};

export type CreatorIntelligenceBrief = {
  content_type: string;
  readiness: CreatorCompatibilityAssessment['readiness'] | 'unknown';
  prompt_block: string;
  primitives: SharedIntelligencePrimitive[];
  recommended_uses: SharedIntelligencePrimitive['recommended_creator_uses'];
  low_confidence_note: string | null;
  calibration_note: string;
};

function mapOpportunityUse(type: SearchOpportunityType): SharedIntelligencePrimitive['recommended_creator_uses'] {
  if (type === 'ctr_opportunity') return ['seo_aware_generation', 'conversion_messaging'];
  if (type === 'ranking_opportunity') return ['search_demand_generation', 'content_refresh'];
  if (type === 'organic_decline') return ['content_refresh', 'seo_aware_generation'];
  if (type === 'organic_rise') return ['search_demand_generation', 'landing_page_optimization'];
  if (type === 'visibility_engagement_gap' || type === 'landing_page_experience_gap') {
    return ['engagement_recommendation', 'landing_page_optimization', 'conversion_messaging'];
  }
  return ['landing_page_optimization', 'conversion_messaging'];
}

export function buildSharedPerformanceIntelligencePrimitives(input: {
  behavior?: PerformanceBehaviorIntelligence | null;
  search?: PerformanceSearchIntelligence | null;
}): SharedIntelligencePrimitive[] {
  const primitives: SharedIntelligencePrimitive[] = [];

  for (const opportunity of input.search?.opportunities ?? []) {
    const primitiveType: SharedIntelligencePrimitiveType =
      opportunity.type === 'ctr_opportunity'
        ? 'ctr_opportunity'
        : opportunity.type === 'organic_decline'
          ? 'declining_page'
          : opportunity.type === 'organic_rise'
            ? 'rising_page'
            : opportunity.type === 'visibility_engagement_gap' || opportunity.type === 'landing_page_experience_gap'
              ? 'search_intent_mismatch'
              : 'weak_landing_page';

    primitives.push({
      primitive_type: primitiveType,
      source: 'ga_gsc_join',
      title: opportunity.title,
      summary: opportunity.recommendation,
      confidence: opportunity.confidence,
      severity: opportunity.severity,
      page_url: opportunity.page_url,
      recommended_creator_uses: mapOpportunityUse(opportunity.type),
      evidence: opportunity.evidence,
    });
  }

  for (const keyword of input.search?.keyword_opportunities ?? []) {
    primitives.push({
      primitive_type: 'high_opportunity_keyword',
      source: 'gsc',
      title: `${keyword.keyword} has ${keyword.opportunity_type === 'ctr' ? 'CTR' : 'ranking'} upside`,
      summary: keyword.opportunity_type === 'ctr'
        ? 'Use this query to improve SERP promise, titles, and organic content angle.'
        : 'Use this query to deepen content and internal linking around a rankable topic.',
      confidence: keyword.confidence,
      severity: keyword.severity,
      page_url: keyword.page_url,
      keyword: keyword.keyword,
      intent_group: keyword.intent_group,
      recommended_creator_uses: keyword.opportunity_type === 'ctr'
        ? ['seo_aware_generation', 'conversion_messaging']
        : ['search_demand_generation', 'content_refresh'],
      evidence: {
        impressions: keyword.impressions,
        clicks: keyword.clicks,
        ctr: keyword.ctr,
        avg_position: keyword.avg_position,
        branded: keyword.branded,
        trend_direction: keyword.trend_direction,
      },
    });
  }

  for (const page of input.behavior?.landing_page_insights ?? []) {
    if (page.severity === 'low') continue;
    primitives.push({
      primitive_type: page.conversion_rate >= 0.03 ? 'strong_conversion_theme' : 'engagement_friction',
      source: 'ga',
      title: page.diagnosis,
      summary: page.conversion_rate >= 0.03
        ? 'This page has conversion patterns that can inform future creator messaging.'
        : 'This page has engagement or conversion friction that future content should address.',
      confidence: page.confidence,
      severity: page.severity,
      page_url: page.page_url,
      recommended_creator_uses: page.conversion_rate >= 0.03
        ? ['conversion_messaging', 'landing_page_optimization']
        : ['engagement_recommendation', 'landing_page_optimization', 'content_refresh'],
      evidence: {
        visits: page.visits,
        engagement_rate: page.engagement_rate,
        conversion_rate: page.conversion_rate,
        conversion_delta_pct: page.conversion_delta_pct,
      },
    });
  }

  const severityRank = { high: 3, medium: 2, low: 1 };
  const confidenceRank = { high: 4, medium: 3, low: 2, none: 1 };
  const seen = new Set<string>();
  return primitives
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || confidenceRank[b.confidence] - confidenceRank[a.confidence])
    .filter((item) => {
      if (item.confidence === 'none') return false;
      const key = [
        item.primitive_type,
        item.page_url ?? '',
        item.keyword ?? '',
        item.title.toLowerCase().replace(/\s+/g, ' ').slice(0, 80),
      ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

export function getCreatorIntelligenceCompatibility(): CreatorCompatibilityAssessment[] {
  return [
    {
      content_type: 'blog',
      readiness: 'immediate',
      easiest_primitives: ['high_opportunity_keyword', 'ctr_opportunity', 'declining_page'],
      needs: ['Inject primitives into long-form SEO planning context.'],
      recommended_first_use: 'Use high-opportunity keywords and declining pages to select/refresh blog topics.',
    },
    {
      content_type: 'guide',
      readiness: 'immediate',
      easiest_primitives: ['high_opportunity_keyword', 'search_intent_mismatch', 'weak_landing_page'],
      needs: ['Map query intent clusters to guide sections.'],
      recommended_first_use: 'Turn commercial/informational query clusters into deeper guide outlines.',
    },
    {
      content_type: 'article',
      readiness: 'immediate',
      easiest_primitives: ['high_opportunity_keyword', 'rising_page', 'ctr_opportunity'],
      needs: ['Add primitive-aware angle selection.'],
      recommended_first_use: 'Use rising organic themes and CTR gaps to shape opinionated article angles.',
    },
    {
      content_type: 'newsletter',
      readiness: 'minor_adapter',
      easiest_primitives: ['rising_page', 'declining_page', 'engagement_friction'],
      needs: ['Summarize primitives into editorial briefs rather than SEO instructions.'],
      recommended_first_use: 'Convert rising/declining topics into timely newsletter analysis.',
    },
    {
      content_type: 'whitepaper',
      readiness: 'minor_adapter',
      easiest_primitives: ['high_opportunity_keyword', 'strong_conversion_theme', 'search_intent_mismatch'],
      needs: ['Aggregate multiple primitives into a larger thesis.'],
      recommended_first_use: 'Use clusters and conversion themes as evidence for gated long-form topics.',
    },
    {
      content_type: 'story',
      readiness: 'later',
      easiest_primitives: ['engagement_friction', 'strong_conversion_theme'],
      needs: ['Translate analytics primitives into narrative prompts without over-SEOing the story format.'],
      recommended_first_use: 'Use friction indicators to pick customer pain moments for narrative content.',
    },
    {
      content_type: 'case-study',
      readiness: 'minor_adapter',
      easiest_primitives: ['strong_conversion_theme', 'weak_landing_page', 'search_intent_mismatch'],
      needs: ['Connect primitives to proof, outcome, and transformation fields.'],
      recommended_first_use: 'Use strong conversion themes as case-study proof angles.',
    },
    {
      content_type: 'post',
      readiness: 'minor_adapter',
      easiest_primitives: ['rising_page', 'engagement_friction', 'ctr_opportunity'],
      needs: ['Condense primitive into short-form hook/CTA guidance.'],
      recommended_first_use: 'Turn rising opportunities and friction patterns into social hooks.',
    },
    {
      content_type: 'thread',
      readiness: 'minor_adapter',
      easiest_primitives: ['high_opportunity_keyword', 'search_intent_mismatch', 'declining_page'],
      needs: ['Map primitive evidence into a multi-post sequence.'],
      recommended_first_use: 'Turn intent mismatches into educational thread structures.',
    },
  ];
}

function normalizeContentType(contentType: string): CreatorCompatibilityType | string {
  const normalized = String(contentType || '').trim().toLowerCase();
  if (normalized === 'case_study') return 'case-study';
  if (normalized === 'social' || normalized === 'social-post') return 'post';
  return normalized;
}

function targetUsesForContentType(contentType: string): SharedIntelligencePrimitive['recommended_creator_uses'] {
  const normalized = normalizeContentType(contentType);
  if (normalized === 'blog' || normalized === 'article' || normalized === 'guide') {
    return ['seo_aware_generation', 'search_demand_generation', 'content_refresh'];
  }
  if (normalized === 'whitepaper' || normalized === 'case-study') {
    return ['conversion_messaging', 'search_demand_generation', 'landing_page_optimization'];
  }
  if (normalized === 'newsletter' || normalized === 'story') {
    return ['engagement_recommendation', 'content_refresh'];
  }
  if (normalized === 'post' || normalized === 'thread') {
    return ['engagement_recommendation', 'conversion_messaging'];
  }
  return ['seo_aware_generation', 'engagement_recommendation', 'conversion_messaging'];
}

function isSeoSensitiveContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType);
  return normalized === 'blog' || normalized === 'article' || normalized === 'guide';
}

function primitiveLine(item: SharedIntelligencePrimitive): string {
  const evidence = [
    item.keyword ? `keyword="${item.keyword}"` : '',
    item.page_url ? `page="${item.page_url}"` : '',
    item.intent_group ? `intent=${item.intent_group}` : '',
    `confidence=${item.confidence}`,
    `severity=${item.severity}`,
  ].filter(Boolean).join(', ');
  return `- ${item.title} (${evidence}): ${item.summary}`;
}

function creatorSafeSummary(item: SharedIntelligencePrimitive, contentType: string): string {
  const normalized = normalizeContentType(contentType);
  if (normalized === 'blog' || normalized === 'article' || normalized === 'guide') {
    if (item.keyword) {
      return 'Use the intent behind this query to shape the reader problem, promise, and proof path. Do not repeat the keyword unnaturally.';
    }
    if (item.primitive_type === 'ctr_opportunity') {
      return 'Improve the title promise and opening angle so the reader can immediately see why this is worth clicking and reading.';
    }
    if (item.primitive_type === 'search_intent_mismatch') {
      return 'Clarify the audience problem, expected outcome, and next step so search demand becomes engaged readership.';
    }
    if (item.primitive_type === 'engagement_friction' || item.primitive_type === 'weak_landing_page') {
      return 'Use this as a readability and conversion-clarity signal: reduce ambiguity, strengthen proof, and make the next step obvious.';
    }
  }
  return item.summary;
}

function primitiveLineForCreator(item: SharedIntelligencePrimitive, contentType: string): string {
  const evidence = [
    item.keyword ? `query intent="${item.keyword}"` : '',
    item.page_url ? `related page="${item.page_url}"` : '',
    item.intent_group ? `intent=${item.intent_group}` : '',
    `confidence=${item.confidence}`,
    `severity=${item.severity}`,
  ].filter(Boolean).join(', ');
  return `- ${item.title} (${evidence}): ${creatorSafeSummary(item, contentType)}`;
}

export function buildCreatorIntelligenceBrief(input: {
  contentType: string;
  primitives: SharedIntelligencePrimitive[];
  maxItems?: number;
}): CreatorIntelligenceBrief {
  const normalized = normalizeContentType(input.contentType);
  const compatibility = getCreatorIntelligenceCompatibility().find((item) => item.content_type === normalized);
  const targetUses = targetUsesForContentType(String(normalized));
  const confidenceRank = { high: 4, medium: 3, low: 2, none: 1 };
  const severityRank = { high: 3, medium: 2, low: 1 };
  const strictSeoType = isSeoSensitiveContentType(String(normalized));
  let keywordLikeCount = 0;
  const selected = input.primitives
    .filter((item) => item.recommended_creator_uses.some((use) => targetUses.includes(use)))
    .filter((item) => item.confidence !== 'none')
    .filter((item) => {
      return !strictSeoType || item.confidence !== 'low';
    })
    .filter((item) => {
      if (!strictSeoType || item.primitive_type !== 'high_opportunity_keyword') return true;
      return item.evidence.branded !== true;
    })
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || confidenceRank[b.confidence] - confidenceRank[a.confidence])
    .filter((item) => {
      if (!strictSeoType) return true;
      const keywordLike = item.primitive_type === 'high_opportunity_keyword' || item.keyword;
      if (!keywordLike) return true;
      keywordLikeCount += 1;
      return keywordLikeCount <= 3;
    })
    .slice(0, input.maxItems ?? 5);

  const lowConfidence = selected.some((item) => item.confidence === 'low');
  // Pre-drill calibration: SEO-overreach suppression. For long-form SEO types
  // (blog/article/guide), append an explicit do/do-not block so the model
  // does not default to keyword density, robotic SEO instructions, or shallow
  // "optimize for SEO" guidance.
  const seoSuppressionBlock = strictSeoType
    ? [
        '',
        'CREATOR GUARDRAILS (apply strictly - these override any other SEO instinct):',
        '- Lead with reader intent and a clear problem-to-outcome promise. Do NOT lead with the keyword.',
        '- Mention the target query at most twice naturally; do NOT optimize for keyword density.',
        '- Define the audience segment, their current anxiety, and the promised practical outcome before outlining sections.',
        '- Do NOT include sections titled "SEO best practices", "keyword optimization", or "metadata strategy".',
        '- Do NOT promise traffic, ranking, or impression lifts inside the content body.',
        '- If a search-intent mismatch is flagged, prefer fixing the reader promise + opening over inserting more keywords.',
        '- Conversion clarity (CTA placement + offer specificity) is more valuable than length.',
        '- Use evidence as angle inspiration, not as a quoted analytics statistic in the prose.',
      ].join('\n')
    : '';
  const lowConfidenceBlock = lowConfidence
    ? [
        '',
        'LOW-CONFIDENCE SIGNAL WARNING:',
        '- Some performance signals are low confidence - use them as angle suggestions only.',
        '- Do NOT promise outcomes ("will increase", "guaranteed to convert").',
        '- Prefer hedged framing ("we believe", "early evidence suggests", "worth testing").',
      ].join('\n')
    : '';
  const promptBlock = selected.length > 0
    ? [
      'Performance intelligence signals to consider:',
      ...selected.map((item) => primitiveLineForCreator(item, String(normalized))),
      'Use these signals to improve audience fit, intent match, reader promise, proof, and conversion clarity. Do not keyword-stuff or claim analytics results inside the content unless evidence is explicitly explained.',
      seoSuppressionBlock,
      lowConfidenceBlock,
    ].filter(Boolean).join('\n')
    : 'Performance intelligence signals: none available yet. Use general brand and campaign context.';

  return {
    content_type: String(normalized || input.contentType || 'creator-content'),
    readiness: compatibility?.readiness ?? 'unknown',
    prompt_block: promptBlock,
    primitives: selected,
    recommended_uses: targetUses,
    low_confidence_note: lowConfidence ? 'Some signals are low confidence; use them as directional guidance only.' : null,
    calibration_note: strictSeoType
      ? 'Creator guidance is intentionally intent-focused. Treat signals as angle and reader-promise inputs - never as keyword-stuffing directives. Conversion clarity matters more than density.'
      : 'Creator guidance is intentionally intent-focused; analytics signals should shape angle and messaging, not force exact keyword repetition.',
  };
}
