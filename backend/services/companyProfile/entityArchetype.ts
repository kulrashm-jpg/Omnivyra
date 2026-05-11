import type { CompanyProfile, EntityArchetype, EntityArchetypeIntelligence, PreservedCompetitorIntelligence } from './types';

type EvidenceItem = { signal: string; weight: number; snippet: string };
type ScoreMap = Record<EntityArchetype, number>;

const ENTITY_ARCHETYPE_VERSION = 2;
const STANDARD_INFLUENTIAL_CONFIDENCE = 0.62;
const MIXED_AUDIENCE_INFLUENTIAL_CONFIDENCE = 0.52;
const AUDIENCE_LED_ARCHETYPES: EntityArchetype[] = [
  'PERSONAL_BRAND',
  'CREATOR_EDUCATOR',
  'COMMUNITY_LED',
  'THOUGHT_LEADER',
  'MEDIA_NEWSLETTER',
];
const BUSINESS_FIRST_ARCHETYPES: EntityArchetype[] = [
  'PRODUCT_COMPANY',
  'SERVICE_COMPANY',
  'ECOMMERCE_BRAND',
];

const ARCHETYPES: EntityArchetype[] = [
  'PRODUCT_COMPANY',
  'SERVICE_COMPANY',
  'ECOMMERCE_BRAND',
  'PERSONAL_BRAND',
  'CREATOR_EDUCATOR',
  'CONSULTANT_OPERATOR',
  'COMMUNITY_LED',
  'THOUGHT_LEADER',
  'MEDIA_NEWSLETTER',
  'HYBRID_ENTITY',
];

const emptyScores = (): ScoreMap =>
  ARCHETYPES.reduce((acc, key) => ({ ...acc, [key]: 0 }), {} as ScoreMap);

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function evidenceText(evidence: Array<{ label: string; url: string; summary: string }>): string {
  return evidence.map((entry) => `${entry.label} ${entry.url} ${entry.summary}`).join('\n').slice(0, 24000);
}

function snippetFor(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  if (!match || match.index == null) return text.slice(0, 180);
  const start = Math.max(0, match.index - 70);
  return text.slice(start, start + 220).replace(/\s+/g, ' ').trim();
}

function addScore(
  scores: ScoreMap,
  evidence: EvidenceItem[],
  archetype: EntityArchetype,
  signal: string,
  weight: number,
  text: string,
  pattern: RegExp,
) {
  if (!pattern.test(text)) return;
  scores[archetype] += weight;
  evidence.push({ signal, weight, snippet: snippetFor(text, pattern) });
}

function densityScore(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + ((text.match(pattern) || []).length), 0);
}

function hasSignal(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function countSignals(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function inferCommercialMode(text: string): string | null {
  if (/\b(shop|store|cart|checkout|buy now|apparel|clothing|clothes|merch|retail|collections?)\b/.test(text)) return 'retail commerce';
  if (/\b(advertis(ing|er|ers)|sponsor(ship)?s?|brand deals?|paid partnership|partner content)\b/.test(text)) return 'media sponsorships and advertising';
  if (/\bpaid newsletter|paid subscription|subscriber-only|premium newsletter|members-only|private slack|membership access\b/.test(text)) return 'paid media or membership';
  if (/\bsponsor(ship)?s?\b|\bbrand deals?\b|\bpaid partnership\b/.test(text)) return 'sponsorships and partnerships';
  if (/\bnewsletter\b|\bsubscribe\b/.test(text)) return 'newsletter/media audience';
  if (/\bcourse\b|\bcohort\b|\bworkshop\b|\bmasterclass\b|\btraining program\b|\bon-demand courses?\b|\blearning program\b/.test(text)) return 'education products';
  if (/\bconsult(ing|ant)?\b|\badvisory\b|\bfractional\b|\bretainer\b/.test(text)) return 'consulting or advisory';
  if (/\bpricing\b|\bplans?\b|\bdemo\b|\bbook a call\b|\bsales\b/.test(text)) return 'sales-led commercial offer';
  if (/\bplatform access\b|\bsoftware subscription\b|\bapp subscription\b|\bapi access\b/.test(text)) return 'software/platform access';
  return null;
}

function inferValueSurface(text: string): string | null {
  if (/\b(apparel|clothing|clothes|workout clothes|gym clothes|leggings|sports bras|shorts|shop|store|collections?)\b/.test(text)) return 'retail products and apparel commerce';
  if (/\b(saas|software|product development system|product tool|dashboard|api|automation|open app|pricing plans?|book a demo)\b/.test(text) && !/\b(newsletter|publication|podcast|editorial|journalism|readers?|subscribers?)\b/.test(text)) return 'product capability';
  if (/\bnewsletter\b|\bpublication\b|\bpodcast\b|\beditorial\b|\bjournalism\b|\breaders?\b|\bsubscribers?\b/.test(text)) return 'publishing and media';
  if (/\bpublic building|build(ing)? in public|founder journal|life map|system declaration|project log|writing to think|experimentation home|operating philosophy\b/.test(text)) return 'public-building narrative and operating system';
  if (/\bnewsletter\b|\bessay\b|\bpublication\b|\bmedia\b/.test(text)) return 'publishing and editorial perspective';
  if (/\bprivate slack|members-only|membership access|community access|discord|slack community|circle community\b/.test(text)) return 'community access and participation';
  if (/\bcourse\b|\bworkshop\b|\bcohort\b|\blearn\b|\beducation\b|\bon-demand courses?\b|\blearning platform\b|\bleaderful app\b/.test(text)) return 'education and skill development';
  if (/\bauthor\b|\bkeynote\b|\bspeaking\b|\bthought leadership\b|\bworldview\b|\bstart with why\b|\binfinite game\b|\bmanifesto\b|\bthesis\b/.test(text)) return 'ideas, authority, and narrative';
  if (/\bsoftware\b|\bplatform\b|\bapp\b|\btool\b|\bapi\b/.test(text)) return 'product capability';
  if (/\bservice\b|\bconsulting\b|\badvisory\b|\bagency\b/.test(text)) return 'expert service delivery';
  return null;
}

function inferAudienceRelationship(text: string): string | null {
  if (/\bsubscribers?\b|\breaders?\b|\bnewsletter\b/.test(text)) return 'subscribers/readers';
  if (/\bfollowers?\b|\bfans?\b|\baudience\b/.test(text)) return 'followers/audience';
  if (/\bmembers?\b|\bcommunity\b/.test(text)) return 'members/community';
  if (/\blearners?\b|\bstudents?\b|\bcohort\b/.test(text)) return 'learners/students';
  if (/\bcustomers?\b|\bclients?\b|\bbuyers?\b/.test(text)) return 'customers/clients';
  return null;
}

function inferIdentityOwner(profile: CompanyProfile, text: string): string | null {
  if (/\bfounder\b|\bby [a-z][a-z]+ [a-z][a-z]+|\bi write\b|\bi help\b|\bmy work\b|\bpersonal brand\b/.test(text)) {
    return 'person-led';
  }
  if (/\bour team\b|\bcompany\b|\bplatform\b|\bwe help\b/.test(text) || profile.business_classification) {
    return 'organization-led';
  }
  return null;
}

function scoreGroup(scores: ScoreMap, archetypes: EntityArchetype[]): number {
  return archetypes.reduce((sum, key) => sum + scores[key], 0);
}

function activeAudienceArchetypeCount(scores: ScoreMap): number {
  return AUDIENCE_LED_ARCHETYPES.filter((key) => scores[key] >= 4).length;
}

function normalizeScores(scores: ScoreMap, evidenceCount: number, hybridEligible: boolean): {
  ranked: Array<[EntityArchetype, number]>;
  confidence: number;
  isHybrid: boolean;
  audienceScore: number;
  businessScore: number;
  audienceSignalCount: number;
} {
  const total = Object.values(scores).reduce((sum, value) => sum + value, 0);
  const ranked = (Object.entries(scores) as Array<[EntityArchetype, number]>)
    .sort((a, b) => b[1] - a[1]);
  const audienceScore = scoreGroup(scores, AUDIENCE_LED_ARCHETYPES);
  const businessScore = scoreGroup(scores, BUSINESS_FIRST_ARCHETYPES);
  const audienceSignalCount = activeAudienceArchetypeCount(scores);
  const isHybrid = scores.HYBRID_ENTITY >= 4 || hybridEligible;
  if (total <= 0) {
    return {
      ranked: [['PRODUCT_COMPANY', 0]],
      confidence: 0.2,
      isHybrid: false,
      audienceScore: 0,
      businessScore: 0,
      audienceSignalCount: 0,
    };
  }

  const [top, second] = ranked;
  const margin = top[1] - (second?.[1] ?? 0);
  const evidenceFactor = Math.min(1, evidenceCount / 8);
  const topShareConfidence = (top[1] / total) * 0.55 + (margin / Math.max(top[1], 1)) * 0.25 + evidenceFactor * 0.2;

  const mixedAudienceConfidence = audienceSignalCount >= 2
    ? Math.min(0.9, 0.44 + Math.min(0.28, audienceScore / 45) + evidenceFactor * 0.14 + (isHybrid ? 0.08 : 0))
    : 0;
  const hybridConfidence = isHybrid
    ? Math.min(0.88, 0.46 + Math.min(0.18, scores.HYBRID_ENTITY / 35) + Math.min(0.14, Math.min(audienceScore, businessScore) / 45) + evidenceFactor * 0.1)
    : 0;
  const singleAudienceConfidence = audienceSignalCount === 1 && audienceScore >= 8 && businessScore === 0
    ? Math.min(0.72, 0.48 + Math.min(0.14, audienceScore / 45) + evidenceFactor * 0.1)
    : 0;
  const confidence = Math.max(
    0.25,
    Math.min(0.95, Math.max(topShareConfidence, mixedAudienceConfidence, hybridConfidence, singleAudienceConfidence)),
  );
  return {
    ranked,
    confidence: Number(confidence.toFixed(2)),
    isHybrid,
    audienceScore,
    businessScore,
    audienceSignalCount,
  };
}

function hasStrongAudiencePeerEvidence(competitorIntelligence?: PreservedCompetitorIntelligence[] | null): boolean {
  const text = (competitorIntelligence ?? [])
    .map((competitor) => [
      competitor.archetype_peer_category,
      competitor.audience_overlap,
      competitor.narrative_overlap,
      competitor.trust_model,
      competitor.publication_identity,
      competitor.ecosystem_role,
      competitor.creator_operator_identity,
      competitor.educational_role,
      competitor.worldview_adjacency,
      competitor.platform_native_context,
    ].filter(Boolean).join(' '))
    .join(' ')
    .toLowerCase();
  if (!text) return false;
  const strongSignals = [
    /\b(newsletter|publication|media|subscribers?|readers?|editorial)\b/,
    /\b(creator|operator|public[-\s]?building|writer|founder-led|personal brand)\b/,
    /\b(community|membership|learners?|students?|course|education)\b/,
    /\b(worldview|thesis|narrative|ecosystem|trust model|authority)\b/,
  ].filter((pattern) => pattern.test(text)).length;
  return strongSignals >= 2;
}

export function isArchetypeInfluential(
  archetype?: EntityArchetypeIntelligence | null,
  competitorIntelligence?: PreservedCompetitorIntelligence[] | null,
): boolean {
  if (!archetype) return false;
  if (archetype.version !== ENTITY_ARCHETYPE_VERSION) return false;
  if (archetype.stale_after && Number.isFinite(Date.parse(archetype.stale_after)) && Date.parse(archetype.stale_after) < Date.now()) {
    return false;
  }
  const competitorReinforced = hasStrongAudiencePeerEvidence(competitorIntelligence);
  if (archetype.primary_archetype === 'HYBRID_ENTITY') return archetype.confidence >= MIXED_AUDIENCE_INFLUENTIAL_CONFIDENCE;
  const audienceValues = [archetype.primary_archetype, ...(archetype.secondary_archetypes ?? [])]
    .filter((value) => AUDIENCE_LED_ARCHETYPES.includes(value));
  if (
    competitorReinforced &&
    (archetype.primary_archetype === 'CONSULTANT_OPERATOR' || audienceValues.length > 0) &&
    archetype.confidence >= 0.48
  ) return true;
  if (audienceValues.length >= 2) return archetype.confidence >= MIXED_AUDIENCE_INFLUENTIAL_CONFIDENCE;
  return archetype.confidence >= STANDARD_INFLUENTIAL_CONFIDENCE;
}

export function isAudienceLedArchetype(
  archetype?: EntityArchetypeIntelligence | null,
  competitorIntelligence?: PreservedCompetitorIntelligence[] | null,
): boolean {
  if (!isArchetypeInfluential(archetype, competitorIntelligence)) return false;
  const values = [archetype!.primary_archetype, ...(archetype!.secondary_archetypes ?? [])];
  return values.some((value) => AUDIENCE_LED_ARCHETYPES.includes(value)) ||
    (archetype!.primary_archetype === 'CONSULTANT_OPERATOR' && hasStrongAudiencePeerEvidence(competitorIntelligence));
}

export function isBusinessFirstOnlyArchetype(
  archetype?: EntityArchetypeIntelligence | null,
  competitorIntelligence?: PreservedCompetitorIntelligence[] | null,
): boolean {
  if (!isArchetypeInfluential(archetype, competitorIntelligence)) return false;
  const values = [archetype!.primary_archetype, ...(archetype!.secondary_archetypes ?? [])];
  return BUSINESS_FIRST_ARCHETYPES.includes(archetype!.primary_archetype)
    && values.every((value) => BUSINESS_FIRST_ARCHETYPES.includes(value));
}

export function buildArchetypePromptContext(archetype?: EntityArchetypeIntelligence | null): string {
  if (!isArchetypeInfluential(archetype)) return '';
  if (isBusinessFirstOnlyArchetype(archetype)) return '';
  return [
    `Entity archetype: ${archetype.primary_archetype}`,
    archetype.secondary_archetypes.length ? `Secondary archetypes: ${archetype.secondary_archetypes.join(', ')}` : null,
    archetype.commercial_mode ? `Commercial mode: ${archetype.commercial_mode}` : null,
    archetype.primary_value_surface ? `Primary value surface: ${archetype.primary_value_surface}` : null,
    archetype.audience_relationship ? `Audience relationship: ${archetype.audience_relationship}` : null,
    archetype.identity_owner ? `Identity owner: ${archetype.identity_owner}` : null,
  ].filter(Boolean).join('\n');
}

export function inferEntityArchetype(params: {
  profile: CompanyProfile;
  evidence: Array<{ label: string; url: string; summary: string }>;
}): EntityArchetypeIntelligence {
  const text = [
    params.profile.name,
    params.profile.website_url,
    params.profile.industry,
    params.profile.category,
    params.profile.products_services,
    params.profile.target_audience,
    params.profile.unique_value,
    params.profile.brand_positioning,
    params.profile.content_themes,
    params.profile.blog_url,
    evidenceText(params.evidence),
    ...(params.profile.social_profiles || []).map((entry) => `${entry.platform} ${entry.url}`),
  ].map(cleanText).filter(Boolean).join('\n').toLowerCase();

  const scores = emptyScores();
  const evidence: EvidenceItem[] = [];

  const strongProductSignal = /\b(saas|software|platform|app|tool|api|dashboard|automation|product development system|product tool|software subscription|api access|open app|sign up|pricing plans?|book a demo)\b/;
  const genericProductMediaSignal = /\b(product management|product leaders?|product growth|premium products?|product thinking|product advice|building product|product strategy|product newsletter)\b/;
  if (strongProductSignal.test(text) && !genericProductMediaSignal.test(text)) {
    addScore(scores, evidence, 'PRODUCT_COMPANY', 'software/platform ownership', 5, text, strongProductSignal);
  } else if (strongProductSignal.test(text)) {
    addScore(scores, evidence, 'PRODUCT_COMPANY', 'qualified software/platform signal', 2, text, strongProductSignal);
  }
  addScore(scores, evidence, 'SERVICE_COMPANY', 'service/agency density', 4, text, /\b(services?|agency|done[-\s]?for[-\s]?you|implementation|managed service)\b/);
  addScore(scores, evidence, 'ECOMMERCE_BRAND', 'commerce transaction signals', 5, text, /\b(shop|store|cart|checkout|buy now|e-?commerce|retail|collection)\b/);
  addScore(scores, evidence, 'ECOMMERCE_BRAND', 'retail/apparel product catalog', 5, text, /\b(apparel|clothing|clothes|workout clothes|gym clothes|leggings|sports bras|gym shorts|collections?|retail products?)\b/);
  addScore(scores, evidence, 'PERSONAL_BRAND', 'first-person identity', 5, text, /\b(i help|i write|my work|my mission|personal brand|founder story|by [a-z][a-z]+ [a-z][a-z]+)\b/);
  addScore(scores, evidence, 'PERSONAL_BRAND', 'author/speaker identity', 4, text, /\b(author|speaker|keynote|bestselling author|ted talk|start with why|curiosity chronicle|sahil bloom|ali abdaal|simon sinek)\b/);
  addScore(scores, evidence, 'CREATOR_EDUCATOR', 'creator/education surface', 5, text, /\b(creator|course|cohort|workshop|masterclass|teach|learners?|students?|youtube|podcast|video|on-demand courses?|learning platform|leaderful app)\b/);
  addScore(scores, evidence, 'CONSULTANT_OPERATOR', 'operator/advisory surface', 4, text, /\b(consultant|operator|advisor|advisory|fractional|mentor|coach|playbook|systems thinking)\b/);
  addScore(scores, evidence, 'CONSULTANT_OPERATOR', 'narrative operator surface', 4, text, /\b(public building|build(ing)? in public|founder journal|life map|system declaration|project log|writing to think|experimentation home|operating philosophy|systems-building|revenue generation engine)\b/);
  addScore(scores, evidence, 'COMMUNITY_LED', 'commercial community access', 5, text, /\b(private slack|slack community|discord community|members-only|membership access|community access|thriving private slack|cohort community)\b/);
  addScore(scores, evidence, 'COMMUNITY_LED', 'community/member surface', 2, text, /\b(community|members?|membership|join us|discord|slack|circle|network|ecosystem)\b/);
  addScore(scores, evidence, 'THOUGHT_LEADER', 'worldview/thesis surface', 5, text, /\b(thought leadership|worldview|thesis|essays?|manifesto|principles|contrarian|intellectual|philosophy|keynote speaking|narrative strategy|start with why|infinite game|operating philosophy)\b/);
  addScore(scores, evidence, 'MEDIA_NEWSLETTER', 'media/newsletter surface', 6, text, /\b(newsletter|publication|subscribe|subscribers?|readers?|editorial|media|podcast|show|episodes?|advice column)\b/);
  addScore(scores, evidence, 'MEDIA_NEWSLETTER', 'publication cadence', 4, text, /\b(weekly|daily|every week|each week|deeply researched|latest stories|articles|posts|essays|journalism)\b/);

  const firstPersonCount = densityScore(text, [/\bi\b/g, /\bmy\b/g, /\bme\b/g]);
  const orgCount = densityScore(text, [/\bwe\b/g, /\bour\b/g, /\bcompany\b/g]);
  if (firstPersonCount >= 6 && firstPersonCount > orgCount) {
    scores.PERSONAL_BRAND += 3;
    evidence.push({ signal: 'first-person narrative density', weight: 3, snippet: 'First-person language dominates available evidence.' });
  }
  const mediaOverrideEligible =
    scores.MEDIA_NEWSLETTER >= 6 &&
    countSignals(text, [
      /\b(newsletter|publication|advice column|editorial|media)\b/,
      /\b(subscribers?|readers?|subscribe)\b/,
      /\b(weekly|daily|each week|issues?|posts|articles|essays|podcast)\b/,
    ]) >= 2;
  if (mediaOverrideEligible) {
    scores.MEDIA_NEWSLETTER += 4;
    scores.PRODUCT_COMPANY = Math.min(scores.PRODUCT_COMPANY, 2);
    evidence.push({ signal: 'media/newsletter identity override', weight: 4, snippet: 'Publication, subscriber, and cadence signals outweigh generic product vocabulary.' });
  }
  const pureProductOwnership =
    scores.PRODUCT_COMPANY >= 5 &&
    scores.MEDIA_NEWSLETTER < 6 &&
    scores.CREATOR_EDUCATOR < 5 &&
    scores.COMMUNITY_LED < 5 &&
    scores.PERSONAL_BRAND < 4;
  if (pureProductOwnership) {
    scores.PRODUCT_COMPANY += 3;
    evidence.push({ signal: 'pure product ownership protection', weight: 3, snippet: 'Strong product/platform ownership without audience-led identity signals.' });
  }
  const thoughtLeaderEducationEligible =
    (scores.THOUGHT_LEADER >= 5 || scores.PERSONAL_BRAND >= 4) &&
    scores.CREATOR_EDUCATOR >= 5 &&
    countSignals(text, [
      /\b(author|speaker|keynote|ted talk|start with why|infinite game|worldview|thesis|principles)\b/,
      /\b(course|courses|learning|leadership lessons|leaderful app|workshop|on-demand)\b/,
    ]) >= 2;
  if (thoughtLeaderEducationEligible) {
    scores.THOUGHT_LEADER += 4;
    scores.HYBRID_ENTITY += 4;
    evidence.push({ signal: 'thought-leader education hybrid', weight: 4, snippet: 'Authority/thesis and education/productized learning signals both appear.' });
  }
  const narrativeOperatorEligible =
    scores.CONSULTANT_OPERATOR >= 4 &&
    countSignals(text, [
      /\b(public building|build(ing)? in public|founder journal|life map|system declaration|project log|writing to think|experimentation home|operating philosophy|systems-building)\b/,
      /\b(i am|i write|my journey|my work|my mission|for my .* clients|available for|open invitation)\b/,
    ]) >= 2;
  if (narrativeOperatorEligible) {
    scores.PERSONAL_BRAND += 4;
    scores.THOUGHT_LEADER += 3;
    scores.HYBRID_ENTITY += 4;
    evidence.push({ signal: 'narrative operator identity', weight: 4, snippet: 'First-person public-building and operator signals both appear.' });
  }
  const ecommerceRetailDominant =
    scores.ECOMMERCE_BRAND >= 8 &&
    countSignals(text, [
      /\b(apparel|clothing|clothes|workout clothes|gym clothes|leggings|sports bras|shorts|collections?)\b/,
      /\b(shop|store|cart|checkout|buy now|retail)\b/,
    ]) >= 1 &&
    !/\b(private slack|membership access|members-only|paid community|community access|creator-led|creator commerce)\b/.test(text);
  if (ecommerceRetailDominant) {
    scores.COMMUNITY_LED = Math.min(scores.COMMUNITY_LED, 2);
    scores.CREATOR_EDUCATOR = Math.min(scores.CREATOR_EDUCATOR, 2);
    scores.MEDIA_NEWSLETTER = Math.min(scores.MEDIA_NEWSLETTER, 2);
    evidence.push({ signal: 'ecommerce retail containment', weight: 3, snippet: 'Retail/catalog signals dominate non-commercial community language.' });
  }
  const productAudienceHybridEligible =
    scores.PRODUCT_COMPANY >= 4 &&
    (scores.PERSONAL_BRAND >= 4 || scores.CREATOR_EDUCATOR >= 4 || scores.COMMUNITY_LED >= 4 || scores.MEDIA_NEWSLETTER >= 4) &&
    /\b(creator|course|cohort|workshop|masterclass|youtube|video|paid subscription|membership access|founder story|personal brand|i write|i help|author|speaker|leaderful app)\b/.test(text);
  if (productAudienceHybridEligible) {
    scores.HYBRID_ENTITY += 5;
    evidence.push({ signal: 'mixed product and audience-led identity', weight: 5, snippet: 'Product/business and audience-led signals both appear in evidence.' });
  }
  const serviceAudienceHybridEligible =
    scores.SERVICE_COMPANY >= 4 &&
    (scores.THOUGHT_LEADER >= 4 || scores.MEDIA_NEWSLETTER >= 4 || scores.COMMUNITY_LED >= 4) &&
    /\b(founder story|personal brand|i write|i help|thought leadership|newsletter|publication|membership|community|keynote|speaking)\b/.test(text);
  if (serviceAudienceHybridEligible) {
    scores.HYBRID_ENTITY += 4;
    evidence.push({ signal: 'mixed service and narrative-led identity', weight: 4, snippet: 'Service/commercial and narrative/community signals both appear in evidence.' });
  }
  const ecommerceAudienceHybridEligible =
    !ecommerceRetailDominant &&
    scores.ECOMMERCE_BRAND >= 5 &&
    (scores.COMMUNITY_LED >= 5 || scores.CREATOR_EDUCATOR >= 5 || scores.MEDIA_NEWSLETTER >= 6) &&
    /\b(membership access|members-only|paid community|community access|creator-led|creator commerce|private slack|cohort community)\b/.test(text);
  if (ecommerceAudienceHybridEligible) {
    scores.HYBRID_ENTITY += 4;
    evidence.push({ signal: 'mixed commerce and community-led identity', weight: 4, snippet: 'Commerce and audience/community signals both appear in evidence.' });
  }

  const { ranked, confidence, isHybrid, audienceScore, businessScore, audienceSignalCount } = normalizeScores(
    scores,
    evidence.length,
    productAudienceHybridEligible || serviceAudienceHybridEligible || ecommerceAudienceHybridEligible || thoughtLeaderEducationEligible || narrativeOperatorEligible,
  );
  const primary = ranked[0]?.[0] ?? 'PRODUCT_COMPANY';
  const strongestAudience = ranked.find(([key, score]) => AUDIENCE_LED_ARCHETYPES.includes(key) && score > 0)?.[0];
  const strongestBusiness = ranked.find(([key, score]) => BUSINESS_FIRST_ARCHETYPES.includes(key) && score > 0)?.[0];
  const hasMeaningfulSignals = evidence.length >= 2 || audienceSignalCount >= 2 || (audienceScore >= 8 || businessScore >= 8);
  const shouldFallbackToProduct = confidence < 0.38 && !hasMeaningfulSignals;
  const businessProtected = Boolean(
    strongestBusiness &&
    businessScore >= 4 &&
    !isHybrid &&
    !mediaOverrideEligible &&
    !thoughtLeaderEducationEligible &&
    !narrativeOperatorEligible,
  );
  const primaryArchetype: EntityArchetype = shouldFallbackToProduct
    ? 'PRODUCT_COMPANY'
    : businessProtected
      ? strongestBusiness!
      : mediaOverrideEligible && !isHybrid
      ? 'MEDIA_NEWSLETTER'
      : thoughtLeaderEducationEligible && !isHybrid
      ? 'THOUGHT_LEADER'
      : isHybrid
      ? 'HYBRID_ENTITY'
      : primary;
  const secondary = ranked
    .slice(1)
    .filter(([key, score]) =>
      key !== primaryArchetype &&
      score > 0 &&
      score >= Math.max(3, (ranked[0]?.[1] ?? 0) * 0.35) &&
      (!businessProtected || BUSINESS_FIRST_ARCHETYPES.includes(key))
    )
    .map(([key]) => key)
    .slice(0, 4);
  const stabilizedSecondary = Array.from(new Set([
    ...secondary,
    isHybrid ? strongestAudience : null,
    isHybrid ? strongestBusiness : null,
  ].filter((value): value is EntityArchetype => Boolean(value) && value !== primaryArchetype))).slice(0, 5);

  return {
    primary_archetype: primaryArchetype,
    secondary_archetypes: shouldFallbackToProduct ? [] : stabilizedSecondary,
    confidence,
    evidence: evidence.sort((a, b) => b.weight - a.weight).slice(0, 8),
    commercial_mode: inferCommercialMode(text),
    primary_value_surface: inferValueSurface(text),
    audience_relationship: inferAudienceRelationship(text),
    identity_owner: inferIdentityOwner(params.profile, text),
    version: ENTITY_ARCHETYPE_VERSION,
    inferred_at: new Date().toISOString(),
    source: 'heuristic',
    evidence_count: params.evidence.length,
    stale_after: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  };
}
