export type StandardCompetitorCategory =
  | 'mental_wellness_ai'
  | 'ai_companion'
  | 'journaling_self_reflection'
  | 'meditation_mindfulness'
  | 'therapy_marketplace'
  | 'coaching_consulting'
  | 'productivity_self_improvement'
  | 'crm_marketing_automation'
  | 'marketing_seo_software'
  | 'ai_platform'
  // COMPETITOR-TAXONOMY-P0-001 — explicit abstention. Produced only when the P0
  // flag is on and no category regex matches (previously these collapsed into a
  // false 'marketing_seo_software', causing cross-category Tier-1 leaks). 'unknown'
  // is deliberately NOT in STANDARD_COMPETITOR_CATEGORIES and never forms affinity;
  // qualification defers to evidence instead.
  | 'unknown';

/**
 * COMPETITOR-TAXONOMY-P0-001 — reversible hardening flag (default ON).
 * COMPETITOR_TAXONOMY_P0=0 (or 'false') restores the legacy default-category
 * collapse + affinity floor byte-for-byte.
 */
export function competitorTaxonomyP0Enabled(): boolean {
  const raw = process.env.COMPETITOR_TAXONOMY_P0;
  return raw !== '0' && raw !== 'false';
}

export type CompetitorSecondaryTag =
  | 'chatbot'
  | 'human-led'
  | 'content-based'
  | 'marketplace'
  | 'enterprise'
  | 'mobile-first';

export const STANDARD_COMPETITOR_CATEGORIES: StandardCompetitorCategory[] = [
  'mental_wellness_ai',
  'ai_companion',
  'journaling_self_reflection',
  'meditation_mindfulness',
  'therapy_marketplace',
  'coaching_consulting',
  'productivity_self_improvement',
  'crm_marketing_automation',
  'marketing_seo_software',
  'ai_platform',
];

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase();
}

export function normalizeCompetitorCategory(
  rawCategory?: string | null,
  contextText?: string | null,
): StandardCompetitorCategory {
  const raw = normalizeText(rawCategory);
  if ((STANDARD_COMPETITOR_CATEGORIES as string[]).includes(raw)) return raw as StandardCompetitorCategory;
  if (/\b(therapy|therapist|counselling|counseling|online therapy|therapy marketplace)\b/.test(raw)) return 'therapy_marketplace';
  if (/\b(meditation|mindfulness)\b/.test(raw)) return 'meditation_mindfulness';
  if (/\b(journaling|journal|self-reflection)\b/.test(raw)) return 'journaling_self_reflection';
  if (/\b(ai companion|companion)\b/.test(raw)) return 'ai_companion';
  if (/\b(coaching|consulting|coach|consultant|advisor)\b/.test(raw)) return 'coaching_consulting';
  if (/\b(mental wellness|mental wellbeing|mental health|wellness|ai clarity|clarity platform|guided clarity)\b/.test(raw)) return 'mental_wellness_ai';
  if (/\b(crm|marketing automation|sales automation|customer operations|campaign automation|social media management|social scheduling)\b/.test(raw)) return 'crm_marketing_automation';
  if (/\b(seo|content marketing|content generation|copywriting|ai writing|digital marketing|competitive research|marketing intelligence)\b/.test(raw)) return 'marketing_seo_software';
  if (/\b(ai platform|developer api|general-purpose ai|general purpose ai|foundation model)\b/.test(raw)) return 'ai_platform';
  if (/\b(virtual staffing|outsourcing|productivity|self improvement|self-improvement)\b/.test(raw)) return 'productivity_self_improvement';

  const text = normalizeText([rawCategory, contextText].filter(Boolean).join(' '));

  if (/\b(therapy|therapist|counselling|counseling|licensed therapist|online therapy|clinical)\b/.test(text)) {
    return 'therapy_marketplace';
  }
  if (/\b(meditation|mindfulness|sleep|breathwork|relaxation|calm)\b/.test(text)) {
    return 'meditation_mindfulness';
  }
  if (/\b(journal|journaling|diary|mood tracking|self-reflection|reflection)\b/.test(text)) {
    return 'journaling_self_reflection';
  }
  if (/\b(companion|friend|relationship|conversation partner|replika)\b/.test(text)) {
    return 'ai_companion';
  }
  if (/\b(coach|coaching|consultant|consulting|advisor|mentor|human-led|life direction|clarity consultant|spiritual|astrology|tarot)\b/.test(text)) {
    return 'coaching_consulting';
  }
  if (/\b(mental wellness|mental wellbeing|mental health|wellness chatbot|wellbeing chatbot|ai chatbot therapy|emotional wellbeing|emotional support|cbt|anxiety|stress|clarity ai|ai clarity|guided clarity)\b/.test(text)) {
    return 'mental_wellness_ai';
  }
  if (/\b(crm|marketing automation|sales automation|customer operations|campaign orchestration|lead nurturing|account-based marketing|revenue operations|social media management|social media scheduling)\b/.test(text)) {
    return 'crm_marketing_automation';
  }
  if (/\b(seo|content marketing|content generation|copywriting|ai writing|digital marketing|competitive research|search visibility|marketing intelligence|growth software)\b/.test(text)) {
    return 'marketing_seo_software';
  }
  if (/\b(ai platform|developer api|general-purpose ai|general purpose ai|foundation model|chatgpt|models)\b/.test(text)) {
    return 'ai_platform';
  }
  if (/\b(productivity|self improvement|self-improvement|habit|goal|focus|personal growth|virtual staffing|outsourcing)\b/.test(text)) {
    return 'productivity_self_improvement';
  }

  // COMPETITOR-TAXONOMY-P0-001 — inputs matching NO category above are genuinely
  // out-of-taxonomy. Legacy behavior asserted a false 'marketing_seo_software',
  // which collapsed unrelated companies into one bucket → spurious 'same' affinity
  // → Tier-1 leaks. With the P0 flag on we ABSTAIN ('unknown') and let evidence
  // decide downstream. Flag off = legacy default, byte-for-byte.
  return competitorTaxonomyP0Enabled() ? 'unknown' : 'marketing_seo_software';
}

export function normalizeCompetitorTags(params: {
  rawTags?: string[] | null;
  productType?: string | null;
  businessModel?: string | null;
  description?: string | null;
  category?: string | null;
  scaleText?: string | null;
}): CompetitorSecondaryTag[] {
  const text = normalizeText([
    ...(params.rawTags ?? []),
    params.productType,
    params.businessModel,
    params.description,
    params.category,
    params.scaleText,
  ].filter(Boolean).join(' '));
  const tags = new Set<CompetitorSecondaryTag>();

  if (/\b(chatbot|chat bot|conversational|ai companion|assistant)\b/.test(text)) tags.add('chatbot');
  if (/\b(human-led|coach|consultant|advisor|therapist|counsellor|counselor|mentor|service|services|agency)\b/.test(text)) tags.add('human-led');
  if (/\b(content|course|newsletter|meditation|mindfulness|journal|audio|article|community)\b/.test(text)) tags.add('content-based');
  if (/\b(marketplace|network|connects|directory)\b/.test(text)) tags.add('marketplace');
  if (/\b(enterprise|employer|workplace|b2b|business|companies|teams)\b/.test(text)) tags.add('enterprise');
  if (/\b(mobile|app|ios|android|app-store|installs)\b/.test(text)) tags.add('mobile-first');

  return Array.from(tags);
}

/**
 * COMPETITOR-TAXONOMY-P2 — taxonomy-coverage detection (additive; does NOT alter
 * `normalizeCompetitorCategory`).
 *
 * `normalizeCompetitorCategory` is TOTAL: it always returns a category, and for any
 * input that matches NONE of the known category vocabularies it silently returns the
 * default (`marketing_seo_software`). That makes an *unseen industry* (logistics,
 * legaltech, agritech, …) indistinguishable from a genuine marketing company, and
 * collapses every unseen-industry entity into ONE bucket — where `categoryAffinity`
 * then reports 'same' for utterly unrelated pairs. This is the taxonomy-coverage
 * dependency the multi-signal model removes.
 *
 * This detector reports whether the taxonomy actually has *evidence-backed coverage*
 * for a given input, i.e. whether the text matches any positive category signal, vs.
 * falling through to the default. It is the ONE place the "is this a known category?"
 * question is answered, so the bounded-prior model can down-weight / abstain the
 * taxonomy signal when coverage is absent.
 *
 * NOTE: the vocabulary below intentionally mirrors the positive signals inside
 * `normalizeCompetitorCategory`. Keep the two in sync when categories are added
 * (covered by competitorQualificationModel tests).
 */
const KNOWN_CATEGORY_SIGNAL_PATTERNS: RegExp[] = [
  /\b(therapy|therapist|counselling|counseling|licensed therapist|online therapy|clinical|therapeutic)\b/,
  /\b(meditation|mindfulness|sleep|breathwork|relaxation|calm)\b/,
  /\b(journal|journaling|diary|mood tracking|self-reflection|reflection)\b/,
  /\b(ai companion|companion|friend|relationship|conversation partner|replika)\b/,
  /\b(coach|coaching|consultant|consulting|advisor|mentor|human-led|life direction|clarity consultant|spiritual|astrology|tarot)\b/,
  /\b(mental wellness|mental wellbeing|mental health|wellness|wellbeing|emotional wellbeing|emotional support|cbt|anxiety|stress|clarity ai|ai clarity|guided clarity)\b/,
  /\b(crm|marketing automation|sales automation|customer operations|campaign orchestration|campaign automation|lead nurturing|account-based marketing|revenue operations|social media management|social media scheduling|social scheduling)\b/,
  /\b(seo|content marketing|content generation|copywriting|ai writing|digital marketing|competitive research|search visibility|marketing intelligence|growth software)\b/,
  /\b(ai platform|developer api|general-purpose ai|general purpose ai|foundation model|chatgpt|models)\b/,
  /\b(productivity|self improvement|self-improvement|habit|goal|focus|personal growth|virtual staffing|outsourcing)\b/,
];

export type CategoryCoverage = 'in_coverage' | 'out_of_coverage';

/**
 * True taxonomy coverage for an input. `in_coverage` iff the raw category is already a
 * canonical category OR the combined text matches a known category signal; otherwise
 * `out_of_coverage` (the input would fall to the default bucket — an unseen industry).
 */
export function classifyCategoryCoverage(
  rawCategory?: string | null,
  contextText?: string | null,
): CategoryCoverage {
  const raw = normalizeText(rawCategory);
  if ((STANDARD_COMPETITOR_CATEGORIES as string[]).includes(raw)) return 'in_coverage';
  const text = normalizeText([rawCategory, contextText].filter(Boolean).join(' '));
  if (!text.trim()) return 'out_of_coverage';
  return KNOWN_CATEGORY_SIGNAL_PATTERNS.some((pattern) => pattern.test(text))
    ? 'in_coverage'
    : 'out_of_coverage';
}

export type CategoryAffinity = 'same' | 'functional' | 'substitute' | 'unknown';

export function categoryAffinity(
  companyCategory: StandardCompetitorCategory,
  competitorCategory: StandardCompetitorCategory,
): CategoryAffinity {
  // COMPETITOR-TAXONOMY-P0-001 (refined) — 'unknown' is a FIRST-CLASS affinity state
  // meaning "category could not be determined", NOT a substitute. It carries no
  // adjacency judgement at all: callers must DEFER to evidence (hasStrictCategoryFit)
  // and MUST NOT let it seed the 'same'/'functional' overlap floors or a Tier boost.
  // Because it is never 'same'/'functional', the scoring floors stay inert and the
  // candidate is judged purely on measured evidence — the same numeric outcome the
  // interim 'substitute' overload produced, now represented honestly. 'unknown' is
  // only ever produced when the P0 flag is on, so this branch is inert in legacy mode.
  // (Checked before the equality test so two 'unknown' inputs do NOT collapse to 'same'.)
  if (companyCategory === 'unknown' || competitorCategory === 'unknown') return 'unknown';
  if (companyCategory === competitorCategory) return 'same';

  const functionalPairs = new Set([
    'mental_wellness_ai:ai_companion',
    'mental_wellness_ai:journaling_self_reflection',
    'mental_wellness_ai:coaching_consulting',
    'ai_companion:mental_wellness_ai',
    'journaling_self_reflection:mental_wellness_ai',
    'coaching_consulting:mental_wellness_ai',
    'productivity_self_improvement:coaching_consulting',
    'coaching_consulting:productivity_self_improvement',
    'productivity_self_improvement:crm_marketing_automation',
    'crm_marketing_automation:productivity_self_improvement',
    'productivity_self_improvement:marketing_seo_software',
    'marketing_seo_software:productivity_self_improvement',
    'crm_marketing_automation:marketing_seo_software',
    'marketing_seo_software:crm_marketing_automation',
    'crm_marketing_automation:ai_platform',
    'marketing_seo_software:ai_platform',
    'ai_platform:crm_marketing_automation',
    'ai_platform:marketing_seo_software',
  ]);

  return functionalPairs.has(`${companyCategory}:${competitorCategory}`) ? 'functional' : 'substitute';
}
