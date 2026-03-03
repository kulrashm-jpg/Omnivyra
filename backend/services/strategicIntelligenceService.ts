/**
 * Strategic Intelligence Service.
 * Generates dynamic strategic aspects and offering focus from company profile.
 * Data model: Strategic Aspect = problem domain company solves; Offering Focus = solution style inside domain.
 * Offerings are never stored independent from aspect (offerings_by_aspect only).
 *
 * Strategic Pillar Anchoring: aspect↔offering mapping is stable via intent tags (not token overlap).
 */

import type { CompanyProfile } from './companyProfileService';

/** Canonical intent tags — reusable across companies. Stable bridge between aspects and offerings. */
export const STRATEGIC_INTENT_TAGS = [
  'authority',
  'expertise',
  'leadership',
  'clarity',
  'decision',
  'growth',
  'engagement',
  'network',
  'conversion',
  'promotion',
  'education',
  'community',
  'performance',
  'transformation',
] as const;

export type StrategicIntentTag = (typeof STRATEGIC_INTENT_TAGS)[number];

/** Keyword/phrase → intent tags. Deterministic; same wording → same tags. */
const KEYWORD_TO_TAGS: Array<{ keywords: string[]; tags: StrategicIntentTag[] }> = [
  { keywords: ['authority', 'positioning', 'thought leadership', 'expert'], tags: ['authority', 'expertise', 'leadership'] },
  { keywords: ['expertise', 'specialist', 'professional'], tags: ['expertise', 'authority'] },
  { keywords: ['leadership', 'executive', 'c-suite'], tags: ['leadership', 'authority'] },
  { keywords: ['clarity', 'clear', 'focus', 'mental peace'], tags: ['clarity', 'decision'] },
  { keywords: ['decision', 'choice', 'transition', 'decision point'], tags: ['decision', 'clarity'] },
  { keywords: ['growth', 'scale', 'expansion', 'career'], tags: ['growth', 'performance'] },
  { keywords: ['engagement', 'audience', 'relationship', 'emotional'], tags: ['engagement', 'community'] },
  { keywords: ['network', 'connection', 'linkedin', 'professional network'], tags: ['network', 'growth', 'community'] },
  { keywords: ['conversion', 'lead', 'sales', 'revenue'], tags: ['conversion', 'promotion'] },
  { keywords: ['promotion', 'product', 'brand awareness'], tags: ['promotion', 'engagement'] },
  { keywords: ['education', 'learn', 'training', 'knowledge'], tags: ['education', 'expertise'] },
  { keywords: ['community', 'community building', 'belonging'], tags: ['community', 'engagement'] },
  { keywords: ['performance', 'result', 'outcome', 'metric'], tags: ['performance', 'growth'] },
  { keywords: ['transformation', 'change', 'discovery', 'self-discovery'], tags: ['transformation', 'growth'] },
  { keywords: ['crisis', 'immediate', 'urgent', 'problem solving'], tags: ['clarity', 'decision', 'performance'] },
  { keywords: ['personal', 'mental', 'peace', 'wellbeing'], tags: ['clarity', 'transformation'] },
  { keywords: ['emotional', 'relationship', 'challenge'], tags: ['engagement', 'community'] },
  { keywords: ['life transition', 'transition'], tags: ['decision', 'transformation'] },
];

/** Source → fallback intent tags when keyword mapping yields none. Deterministic; no randomness. */
const SOURCE_TO_FALLBACK_TAGS: Record<string, StrategicIntentTag[]> = {
  content_themes: ['education', 'engagement'],
  campaign_focus: ['growth', 'conversion'],
  key_messages: ['authority', 'clarity'],
  target_customer_segment: ['community', 'network'],
  products_services: ['promotion', 'conversion'],
  products_services_list: ['promotion', 'conversion'],
  authority_domains: ['authority', 'expertise'],
};

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

/** Normalize for matching: lowercase, collapse spaces. */
function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Derive intent tags from text by keyword mapping. Deterministic.
 * Tags remain stable even if wording changes slightly (same keywords → same tags).
 */
function deriveIntentTagsFromText(text: string): StrategicIntentTag[] {
  const normalized = normalizeForMatch(text);
  const tokens = tokenize(text);
  const tokenSet = new Set(tokens);
  const seen = new Set<StrategicIntentTag>();
  for (const { keywords, tags } of KEYWORD_TO_TAGS) {
    const matches = keywords.some(
      (kw) => tokenSet.has(kw) || normalized.includes(kw.toLowerCase())
    );
    if (matches) {
      tags.forEach((t) => seen.add(t));
    }
  }
  const result = [...seen];
  result.sort((a, b) => STRATEGIC_INTENT_TAGS.indexOf(a) - STRATEGIC_INTENT_TAGS.indexOf(b));
  return result;
}

/** Canonical order and dedupe. Same input → same tag order. */
function canonicalizeIntentTags(tags: string[]): StrategicIntentTag[] {
  const valid = tags.filter((t): t is StrategicIntentTag =>
    STRATEGIC_INTENT_TAGS.includes(t as StrategicIntentTag)
  );
  return [...new Set(valid)].sort(
    (a, b) => STRATEGIC_INTENT_TAGS.indexOf(a) - STRATEGIC_INTENT_TAGS.indexOf(b)
  );
}

export type StrategicAspectAnchor = {
  aspect: string;
  intent_tags: string[];
};

export type TaggedOffering = {
  id: string;
  label: string;
  source: string;
  intent_tags: string[];
};

export type StrategicIntelligence = {
  strategic_aspects: string[];
  offerings_by_aspect: Record<string, string[]>;
  ranked_aspects: string[];
  aspect_anchors: StrategicAspectAnchor[];
  offering_tags: TaggedOffering[];
};

const DEFAULT_STRATEGIC_ASPECTS = [
  'Personal Clarity & Mental Peace',
  'Career & Professional Direction',
  'Emotional & Relationship Challenges',
  'Life Transitions & Decision Points',
  'Self-Discovery & Growth',
  'Crisis & Immediate Problem Solving',
];

function normalizeList(value: string | string[] | null | undefined): string[] {
  if (value == null) return [];
  const parts = Array.isArray(value)
    ? value.map((v) => String(v).trim()).filter(Boolean)
    : String(value)
        .split(/[,;]|\s+and\s+/i)
        .map((s) => s.trim())
        .filter(Boolean);
  return [...new Set(parts)];
}

/** Normalize aspect for deduplication: lowercase, collapse spaces, trim. */
function normalizeAspectKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/\s*&\s*/g, ' and ').trim();
}

/**
 * Remove duplicate and near-duplicate strategic aspects.
 * - Same normalized form → keep one (longer label wins).
 * - If normalized key A is substring of key B, keep only the longer (B); and vice versa.
 */
function deduplicateStrategicAspects(aspects: string[]): string[] {
  if (aspects.length <= 1) return aspects;
  const byKey = new Map<string, string>();
  for (const a of aspects) {
    const key = normalizeAspectKey(a);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, a);
    } else if (a.length > existing.length) {
      byKey.set(key, a);
    }
  }
  const keys = [...byKey.keys()];
  const toDrop = new Set<string>();
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const ki = keys[i];
      const kj = keys[j];
      if (ki.includes(kj)) toDrop.add(kj);
      else if (kj.includes(ki)) toDrop.add(ki);
    }
  }
  const keyOrder = new Map<string, number>();
  let idx = 0;
  for (const a of aspects) {
    const key = normalizeAspectKey(a);
    if (key && !keyOrder.has(key)) keyOrder.set(key, idx++);
  }
  return [...byKey.entries()]
    .filter(([k]) => !toDrop.has(k))
    .sort(([, a], [, b]) => (keyOrder.get(normalizeAspectKey(a)) ?? 0) - (keyOrder.get(normalizeAspectKey(b)) ?? 0))
    .map(([, label]) => label);
}

/** Category-based fallback tags for aspects with no keyword-derived tags. First match wins; deterministic. */
const ASPECT_CATEGORY_FALLBACKS: Array<{
  keywords: string[];
  tags: StrategicIntentTag[];
}> = [
  {
    keywords: ['leadership', 'executive', 'authority', 'positioning'],
    tags: ['authority', 'leadership', 'expertise'],
  },
  {
    keywords: ['clarity', 'decision', 'mental', 'mindset', 'wellbeing', 'peace'],
    tags: ['clarity', 'decision', 'transformation'],
  },
  {
    keywords: ['growth', 'scale', 'expansion', 'performance', 'success'],
    tags: ['growth', 'performance', 'engagement'],
  },
  {
    keywords: ['community', 'network', 'relationship', 'collaboration'],
    tags: ['community', 'network', 'engagement'],
  },
  {
    keywords: ['learning', 'education', 'knowledge', 'training'],
    tags: ['education', 'expertise', 'engagement'],
  },
  {
    keywords: ['offer', 'service', 'product', 'sales', 'conversion'],
    tags: ['promotion', 'conversion', 'growth'],
  },
];

function getAspectFallbackTags(aspect: string): StrategicIntentTag[] {
  const text = normalizeAspectKey(aspect);
  for (const rule of ASPECT_CATEGORY_FALLBACKS) {
    if (rule.keywords.some((k) => text.includes(k))) {
      return rule.tags;
    }
  }
  return ['engagement', 'growth'];
}

/** Derive tagged offerings from profile. id = "source:label" for UI compatibility. */
function deriveTaggedOfferingsFromProfile(profile: CompanyProfile | null): TaggedOffering[] {
  if (!profile) return [];
  const seen = new Set<string>();
  const out: TaggedOffering[] = [];
  const add = (source: string, value: string | string[] | null | undefined) => {
    if (value == null) return;
    const parts = normalizeList(value);
    parts.forEach((p) => {
      const label = p.slice(0, 78) + (p.length > 78 ? '…' : '');
      if (!label.trim()) return;
      const id = `${source}:${label}`;
      if (seen.has(id)) return;
      seen.add(id);
      const keywordTags = deriveIntentTagsFromText(label);
      const rawTags = keywordTags.length > 0
        ? keywordTags
        : (SOURCE_TO_FALLBACK_TAGS[source] ?? []);
      const intent_tags = canonicalizeIntentTags(rawTags);
      if (intent_tags.length === 0) {
        console.debug('Offering has no tags after fallback', id);
      }
      out.push({ id, label, source, intent_tags });
    });
  };
  add('content_themes', profile.content_themes);
  add('campaign_focus', profile.campaign_focus);
  add('key_messages', profile.key_messages);
  add('target_customer_segment', profile.target_customer_segment);
  add('products_services', profile.products_services);
  if (Array.isArray(profile.products_services_list)) {
    profile.products_services_list.forEach((p) => add('products_services_list', String(p)));
  }
  return out;
}

/** Anchor each aspect with intent tags (from aspect meaning). Use category-aware fallback when no tags. */
function anchorStrategicAspects(aspects: string[]): StrategicAspectAnchor[] {
  return aspects.map((aspect) => {
    const fromText = deriveIntentTagsFromText(aspect);
    const rawTags = fromText.length > 0 ? fromText : getAspectFallbackTags(aspect);
    const intent_tags = canonicalizeIntentTags(rawTags);
    return { aspect, intent_tags };
  });
}

/**
 * Assign offerings to aspects by tag overlap (stable). If no match, assign to first ranked aspect.
 * Deterministic: same profile → same mapping.
 */
function assignOfferingsToAspectsByTags(
  ranked_aspects: string[],
  aspect_anchors: StrategicAspectAnchor[],
  offerings: TaggedOffering[]
): Record<string, string[]> {
  const aspectByAspect = new Map<string, StrategicAspectAnchor>();
  aspect_anchors.forEach((a) => aspectByAspect.set(a.aspect, a));

  const result: Record<string, string[]> = {};
  ranked_aspects.forEach((aspect) => {
    result[aspect] = [];
  });

  for (const offering of offerings) {
    const offeringTagSet = new Set(offering.intent_tags);
    let assigned = false;
    for (const aspect of ranked_aspects) {
      const anchor = aspectByAspect.get(aspect);
      const aspectTags = anchor?.intent_tags ?? [];
      const overlap = aspectTags.filter((t) => offeringTagSet.has(t));
      if (overlap.length > 0) {
        result[aspect].push(offering.id);
        assigned = true;
      }
    }
    if (!assigned && ranked_aspects.length > 0) {
      result[ranked_aspects[0]].push(offering.id);
    }
  }

  for (const aspect of ranked_aspects) {
    result[aspect].sort((a, b) => a.localeCompare(b, 'en'));
  }
  return result;
}

/** Score aspect by how much profile supports it. */
function scoreAspectRelevance(aspect: string, profile: CompanyProfile | null): number {
  if (!profile) return 0;
  const aspectTokens = new Set(tokenize(aspect));
  let score = 0;
  const sources = [
    profile.core_problem_statement,
    profile.campaign_focus,
    profile.content_themes,
    (profile.campaign_purpose_intent?.dominant_problem_domains ?? []).join(' '),
    (profile.pain_symptoms ?? []).join(' '),
    profile.desired_transformation,
    (profile.authority_domains ?? []).join(' '),
  ].filter(Boolean) as string[];
  for (const s of sources) {
    const tokens = tokenize(String(s));
    if (tokens.some((t) => aspectTokens.has(t))) score += 1;
  }
  return score;
}

/**
 * Generate strategic intelligence from company profile.
 * Uses intent-tag anchoring for stable aspect↔offering mapping (no token-overlap drift).
 */
export function generateStrategicIntelligence(
  profile: CompanyProfile | null
): StrategicIntelligence {
  if (!profile) {
    return {
      strategic_aspects: DEFAULT_STRATEGIC_ASPECTS,
      offerings_by_aspect: {},
      ranked_aspects: DEFAULT_STRATEGIC_ASPECTS,
      aspect_anchors: DEFAULT_STRATEGIC_ASPECTS.map((aspect) => ({
        aspect,
        intent_tags: deriveIntentTagsFromText(aspect),
      })),
      offering_tags: [],
    };
  }

  const cpi = profile.campaign_purpose_intent;
  const dominantDomains = Array.isArray(cpi?.dominant_problem_domains)
    ? cpi.dominant_problem_domains.filter((d): d is string => typeof d === 'string').map((d) => d.trim()).filter(Boolean)
    : [];

  const fromProfile: string[] = [];
  normalizeList(profile.content_themes).forEach((p) => fromProfile.push(p));
  normalizeList(profile.campaign_focus).forEach((p) => fromProfile.push(p));
  if (profile.core_problem_statement) {
    normalizeList(profile.core_problem_statement).forEach((p) => fromProfile.push(p));
  }
  (profile.authority_domains ?? []).forEach((d) => fromProfile.push(String(d).trim()));

  const combinedAspects = [...new Set([...dominantDomains, ...fromProfile])].filter(Boolean);
  const rawAspects = combinedAspects.length > 0 ? combinedAspects : DEFAULT_STRATEGIC_ASPECTS;
  const strategic_aspects = deduplicateStrategicAspects(rawAspects);

  const ranked_aspects = [...strategic_aspects].sort((a, b) => {
    const scoreA = scoreAspectRelevance(a, profile);
    const scoreB = scoreAspectRelevance(b, profile);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.localeCompare(b, 'en');
  });

  const aspect_anchors = anchorStrategicAspects(strategic_aspects);
  const taggedOfferings = deriveTaggedOfferingsFromProfile(profile);
  const offerings_by_aspect = assignOfferingsToAspectsByTags(
    ranked_aspects,
    aspect_anchors,
    taggedOfferings
  );

  const offering_tags = [...taggedOfferings].sort((a, b) => a.id.localeCompare(b.id, 'en'));

  return {
    strategic_aspects,
    offerings_by_aspect,
    ranked_aspects,
    aspect_anchors,
    offering_tags,
  };
}
