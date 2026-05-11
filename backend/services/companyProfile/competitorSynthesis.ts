import type { CompanyProfile, EntityArchetypeIntelligence, PreservedCompetitorIntelligence, StrategyProfile } from './types';
import { isAudienceLedArchetype, isBusinessFirstOnlyArchetype } from './entityArchetype';

export type CompetitorStrategicDimensions = {
  trustModels: string[];
  audiencePromises: string[];
  publicationCadences: string[];
  worldviewPositions: string[];
  ecosystemRoles: string[];
  monetizationModes: string[];
  authorityMechanisms: string[];
  learningCommunityRoles: string[];
  narrativeTerritories: string[];
  commercialDifferentiators: string[];
};

function cleanText(value: unknown, max = 180): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max).trim() : null;
}

function pushUnique(target: string[], value: unknown) {
  const cleaned = cleanText(value);
  if (!cleaned) return;
  if (!target.some((item) => item.toLowerCase() === cleaned.toLowerCase())) target.push(cleaned);
}

export function buildCompetitorStrategicDimensions(
  competitors: PreservedCompetitorIntelligence[] | null | undefined,
): CompetitorStrategicDimensions {
  const dimensions: CompetitorStrategicDimensions = {
    trustModels: [],
    audiencePromises: [],
    publicationCadences: [],
    worldviewPositions: [],
    ecosystemRoles: [],
    monetizationModes: [],
    authorityMechanisms: [],
    learningCommunityRoles: [],
    narrativeTerritories: [],
    commercialDifferentiators: [],
  };

  for (const competitor of competitors ?? []) {
    pushUnique(dimensions.trustModels, competitor.trust_model);
    pushUnique(dimensions.audiencePromises, competitor.audience_overlap);
    pushUnique(dimensions.publicationCadences, competitor.publication_identity ?? competitor.platform_native_context);
    pushUnique(dimensions.worldviewPositions, competitor.worldview_adjacency);
    pushUnique(dimensions.ecosystemRoles, competitor.ecosystem_role);
    pushUnique(dimensions.monetizationModes, competitor.monetization_adjacency);
    pushUnique(dimensions.authorityMechanisms, competitor.creator_operator_identity ?? competitor.trust_model);
    pushUnique(dimensions.learningCommunityRoles, competitor.educational_role);
    pushUnique(dimensions.narrativeTerritories, competitor.narrative_overlap ?? competitor.reasoning);
    pushUnique(dimensions.commercialDifferentiators, competitor.monetization_adjacency ?? competitor.archetype_peer_category);
  }

  return dimensions;
}

export function hasCompetitorStrategicDimensions(dimensions: CompetitorStrategicDimensions): boolean {
  return Object.values(dimensions).some((values) => values.length > 0);
}

export function shouldUseAudienceLedSynthesis(
  archetype: EntityArchetypeIntelligence | null | undefined,
  competitorIntelligence?: PreservedCompetitorIntelligence[] | null,
): boolean {
  if (isBusinessFirstOnlyArchetype(archetype, competitorIntelligence)) return false;
  if (isAudienceLedArchetype(archetype, competitorIntelligence)) return true;
  const dimensions = buildCompetitorStrategicDimensions(competitorIntelligence);
  const strongOperatorOrMediaSignals =
    dimensions.narrativeTerritories.length >= 2 ||
    dimensions.ecosystemRoles.some((value) => /\b(operator|creator|publication|newsletter|community|thought|writer|builder)\b/i.test(value)) ||
    dimensions.publicationCadences.length >= 1;
  return strongOperatorOrMediaSignals && !isBusinessFirstOnlyArchetype(archetype);
}

export function buildStructuredCompetitorDimensionBlock(
  competitors: PreservedCompetitorIntelligence[] | null | undefined,
): string {
  const dimensions = buildCompetitorStrategicDimensions(competitors);
  if (!hasCompetitorStrategicDimensions(dimensions)) return '';
  const lines = [
    dimensions.trustModels.length ? `Trust models: ${dimensions.trustModels.slice(0, 3).join('; ')}` : null,
    dimensions.audiencePromises.length ? `Audience promises: ${dimensions.audiencePromises.slice(0, 3).join('; ')}` : null,
    dimensions.publicationCadences.length ? `Publication/media identity: ${dimensions.publicationCadences.slice(0, 3).join('; ')}` : null,
    dimensions.worldviewPositions.length ? `Worldview positions: ${dimensions.worldviewPositions.slice(0, 3).join('; ')}` : null,
    dimensions.ecosystemRoles.length ? `Ecosystem roles: ${dimensions.ecosystemRoles.slice(0, 3).join('; ')}` : null,
    dimensions.monetizationModes.length ? `Monetization modes: ${dimensions.monetizationModes.slice(0, 3).join('; ')}` : null,
    dimensions.authorityMechanisms.length ? `Authority mechanisms: ${dimensions.authorityMechanisms.slice(0, 3).join('; ')}` : null,
    dimensions.learningCommunityRoles.length ? `Learning/community roles: ${dimensions.learningCommunityRoles.slice(0, 3).join('; ')}` : null,
    dimensions.narrativeTerritories.length ? `Narrative territories: ${dimensions.narrativeTerritories.slice(0, 3).join('; ')}` : null,
    dimensions.commercialDifferentiators.length ? `Commercial differentiation: ${dimensions.commercialDifferentiators.slice(0, 3).join('; ')}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

export function buildGroundedDifferentiationSignal(
  competitors: PreservedCompetitorIntelligence[] | null | undefined,
): string | null {
  const dimensions = buildCompetitorStrategicDimensions(competitors);
  const trust = dimensions.trustModels[0];
  const audience = dimensions.audiencePromises[0];
  const ecosystem = dimensions.ecosystemRoles[0];
  const narrative = dimensions.narrativeTerritories[0] ?? dimensions.worldviewPositions[0];
  const monetization = dimensions.monetizationModes[0];
  if (!trust && !audience && !ecosystem && !narrative && !monetization) return null;
  return [
    trust ? `trust model: ${trust}` : null,
    audience ? `audience distinction: ${audience}` : null,
    ecosystem ? `ecosystem role: ${ecosystem}` : null,
    narrative ? `narrative territory: ${narrative}` : null,
    monetization ? `monetization distinction: ${monetization}` : null,
  ].filter(Boolean).join('; ');
}

export function hasGroundedDifferentiationSignal(value: unknown): boolean {
  const text = Array.isArray(value) ? value.join(' ') : String(value ?? '');
  return /\b(trust|audience|reader|subscriber|member|learner|publication|newsletter|media|worldview|narrative|ecosystem|community|operator|authority|monetization|cadence|commercial)\b/i.test(text);
}

export function enforceStrategyGrounding(
  strategy: StrategyProfile | null,
  profile: CompanyProfile,
  archetype?: EntityArchetypeIntelligence | null,
): StrategyProfile | null {
  if (!strategy) return strategy;
  const competitorIntelligence = profile.report_settings?.competitor_intelligence ?? null;
  if (!shouldUseAudienceLedSynthesis(archetype ?? profile.report_settings?.entity_archetype ?? null, competitorIntelligence)) return strategy;
  const signal = buildGroundedDifferentiationSignal(competitorIntelligence);
  if (!signal || hasGroundedDifferentiationSignal([strategy.worldview, ...(strategy.differentiation ?? []), ...(strategy.typicalAngles ?? [])])) {
    return strategy;
  }
  return {
    ...strategy,
    differentiation: [...(strategy.differentiation ?? []), `Differentiate through ${signal}.`].slice(0, 3),
  };
}

export function validateAudienceLedGrounding(
  values: unknown[],
  profile: CompanyProfile,
  archetype?: EntityArchetypeIntelligence | null,
): boolean {
  const competitorIntelligence = profile.report_settings?.competitor_intelligence ?? null;
  if (!shouldUseAudienceLedSynthesis(archetype ?? profile.report_settings?.entity_archetype ?? null, competitorIntelligence)) return true;
  if (!competitorIntelligence?.length) return true;
  return hasGroundedDifferentiationSignal(values);
}

export function hasBusinessFirstCommercialGrounding(values: unknown[]): boolean {
  const text = values.map((value) => Array.isArray(value) ? value.join(' ') : String(value ?? '')).join(' ');
  return /\b(customer|client|buyer|market|sales|pricing|subscription|retail|commerce|software|platform|service|consulting|enterprise|product|revenue|conversion|commercial)\b/i.test(text);
}

export function hasCreatorContamination(values: unknown[]): boolean {
  const text = values.map((value) => Array.isArray(value) ? value.join(' ') : String(value ?? '')).join(' ');
  return /\b(creator-led|influencer|followers|subscribers|newsletter|publication cadence|audience promise|public-building|worldview-led)\b/i.test(text);
}
