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
  | 'ai_platform';

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

  // Default for Omnivyra (a marketing platform). Was 'productivity_self_improvement' (Drishiq/wellness legacy).
  // Only affects inputs that match NO category above — order preserved so classified inputs are unchanged.
  return 'marketing_seo_software';
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

export function categoryAffinity(
  companyCategory: StandardCompetitorCategory,
  competitorCategory: StandardCompetitorCategory,
): 'same' | 'functional' | 'substitute' {
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
