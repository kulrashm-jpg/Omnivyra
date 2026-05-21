import type { OmnivyraEditorialDoctrine, OmnivyraPovArchetypeId } from './omnivyraEditorialDoctrine';
import { getOmnivyraEditorialDoctrine } from './omnivyraEditorialDoctrine';

type StrategyProfileLike = {
  worldview?: string;
  contrarianBeliefs?: readonly string[];
  primaryFocus?: readonly string[];
  differentiation?: readonly string[];
  typicalAngles?: readonly string[];
};

export interface CompanyAssimilationInput {
  companyName?: string;
  name?: string;
  brand_voice?: string;
  audience?: string;
  target_audience?: string;
  ideal_customer_profile?: string;
  industry?: string;
  category?: string;
  uniqueValue?: string;
  unique_value?: string;
  competitiveAdvantages?: string;
  competitive_advantages?: string;
  productsServices?: string;
  products_services?: string;
  coreProblemStatement?: string;
  core_problem_statement?: string;
  painSymptoms?: readonly string[];
  pain_symptoms?: readonly string[];
  authorityDomains?: readonly string[];
  authority_domains?: readonly string[];
  desiredTransformation?: string;
  desired_transformation?: string;
  keyMessages?: string;
  key_messages?: string;
  goals?: string;
  growthPriorities?: string;
  growth_priorities?: string;
  campaignFocus?: string;
  campaign_focus?: string;
  contentThemes?: string;
  content_themes?: string;
  geography?: string;
  strategyProfile?: StrategyProfileLike;
}

export interface AssimilatedEditorialPrimitives {
  buyerTension: {
    statement: string;
    audience: string;
    sourceSignals: readonly string[];
  };
  operatingPain: {
    primary: string;
    supporting: readonly string[];
  };
  transformationMechanism: {
    from: string;
    to: string;
    mechanism: string;
  };
  authorityClaim: {
    claim: string;
    basis: readonly string[];
  };
  differentiatorLogic: {
    primary: string;
    supporting: readonly string[];
    logic: string;
  };
  approvedPovAngles: readonly {
    id: string;
    doctrinePovId: OmnivyraPovArchetypeId;
    angle: string;
    rationale: string;
  }[];
  proofExpectations: readonly string[];
  marketPositioning: {
    category: string;
    audience: string;
    position: string;
  };
  strategicPosture: {
    stance: string;
    beliefs: readonly string[];
  };
  implementationPhilosophy: readonly string[];
  completeness: {
    level: 'sparse' | 'partial' | 'usable';
    missing: readonly string[];
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function splitPhrases(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.map(clean).filter(Boolean));
  return unique(clean(value).split(/[;,\n|]+/).map((item) => item.trim()).filter(Boolean));
}

function unique(values: readonly string[], limit = 12): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

function first(...values: unknown[]): string {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return '';
}

function listFrom(...values: unknown[]): string[] {
  return unique(values.flatMap(splitPhrases));
}

function inferCompleteness(input: {
  audience: string;
  operatingPain: string;
  uniqueValue: string;
  products: string;
  authorityDomains: readonly string[];
  differentiators: readonly string[];
}): AssimilatedEditorialPrimitives['completeness'] {
  const missing: string[] = [];
  if (!input.audience) missing.push('audience');
  if (!input.operatingPain) missing.push('operating pain');
  if (!input.uniqueValue) missing.push('unique value');
  if (!input.products) missing.push('products/services');
  if (input.authorityDomains.length === 0) missing.push('authority domains');
  if (input.differentiators.length === 0) missing.push('differentiators');

  return {
    level: missing.length >= 4 ? 'sparse' : missing.length >= 2 ? 'partial' : 'usable',
    missing,
  };
}

function selectDoctrinePovIds(input: {
  pain: string;
  products: string;
  authorityDomains: readonly string[];
  differentiators: readonly string[];
  strategyBeliefs: readonly string[];
}): OmnivyraPovArchetypeId[] {
  const haystack = [
    input.pain,
    input.products,
    ...input.authorityDomains,
    ...input.differentiators,
    ...input.strategyBeliefs,
  ].join(' ').toLowerCase();
  const ids: OmnivyraPovArchetypeId[] = [];
  ids.push('operator_first');
  if (/system|workflow|process|operation|execution|governance|automation/.test(haystack)) ids.push('systems_over_outputs');
  if (/intelligence|insight|ai|data|signal|recommendation|planning/.test(haystack)) ids.push('intelligence_to_execution');
  if (input.authorityDomains.length > 0 || /proof|trust|authority|evidence|case/.test(haystack)) ids.push('authority_with_proof');
  ids.push('workflow_realism');
  return Array.from(new Set(ids)).slice(0, 5);
}

export function assimilateCompanyEditorialPrimitives(
  input: CompanyAssimilationInput | null | undefined,
  doctrine: OmnivyraEditorialDoctrine = getOmnivyraEditorialDoctrine(),
): AssimilatedEditorialPrimitives {
  const source = input || {};
  const companyName = first(source.companyName, source.name) || 'the company';
  const audience = first(source.audience, source.target_audience, source.ideal_customer_profile) || 'the target audience';
  const industry = first(source.industry, source.category) || doctrine.categoryNarrative.category;
  const uniqueValue = first(source.uniqueValue, source.unique_value);
  const products = first(source.productsServices, source.products_services);
  const coreProblem = first(source.coreProblemStatement, source.core_problem_statement);
  const desiredTransformation = first(source.desiredTransformation, source.desired_transformation);
  const painPoints = listFrom(source.painSymptoms, source.pain_symptoms, coreProblem);
  const differentiators = listFrom(
    source.competitiveAdvantages,
    source.competitive_advantages,
    uniqueValue,
    source.strategyProfile?.differentiation,
  );
  const authorityDomains = listFrom(source.authorityDomains, source.authority_domains);
  const strategyBeliefs = listFrom(
    source.strategyProfile?.worldview,
    source.strategyProfile?.contrarianBeliefs,
    source.strategyProfile?.primaryFocus,
    source.strategyProfile?.typicalAngles,
    source.keyMessages,
    source.key_messages,
  );
  const growthSignals = listFrom(source.growthPriorities, source.growth_priorities, source.campaignFocus, source.campaign_focus, source.goals);
  const primaryPain = painPoints[0] || 'unclear operating priorities that make content and growth execution harder to trust';
  const primaryDifferentiator = differentiators[0] || uniqueValue || 'a more governed connection between intelligence and execution';
  const authorityBasis = unique([
    ...authorityDomains,
    products,
    primaryDifferentiator,
    ...strategyBeliefs.slice(0, 2),
  ].filter(Boolean));
  const transformationTo = desiredTransformation || `a more governed, evidence-led operating model for ${audience}`;
  const mechanism = products
    ? `through ${products}, applied with ${primaryDifferentiator}`
    : `by connecting diagnosis, execution, proof, and iteration around ${primaryPain}`;
  const completeness = inferCompleteness({
    audience,
    operatingPain: primaryPain,
    uniqueValue,
    products,
    authorityDomains,
    differentiators,
  });
  const doctrinePovIds = selectDoctrinePovIds({
    pain: primaryPain,
    products,
    authorityDomains,
    differentiators,
    strategyBeliefs,
  });
  const doctrinePovs = doctrine.approvedPovArchetypes.filter((pov) => doctrinePovIds.includes(pov.id));

  return deepFreeze({
    buyerTension: {
      statement: `${audience} faces pressure to solve ${primaryPain} without adding more disconnected activity.`,
      audience,
      sourceSignals: unique([coreProblem, ...painPoints, ...growthSignals].filter(Boolean), 8),
    },
    operatingPain: {
      primary: primaryPain,
      supporting: painPoints.slice(1, 6),
    },
    transformationMechanism: {
      from: primaryPain,
      to: transformationTo,
      mechanism,
    },
    authorityClaim: {
      claim: `${companyName} has authority to discuss ${industry} through ${authorityBasis[0] || primaryDifferentiator}.`,
      basis: authorityBasis.slice(0, 6),
    },
    differentiatorLogic: {
      primary: primaryDifferentiator,
      supporting: differentiators.slice(1, 6),
      logic: `${companyName}'s differentiation should be framed as a practical mechanism for moving ${audience} from ${primaryPain} to ${transformationTo}.`,
    },
    approvedPovAngles: doctrinePovs.map((pov) => ({
      id: `${pov.id}_company_angle`,
      doctrinePovId: pov.id,
      angle: `${pov.label} applied to ${primaryPain}`,
      rationale: pov.editorialMove,
    })),
    proofExpectations: unique([
      ...doctrine.proofStandards.slice(0, 3),
      authorityDomains.length ? `Show proof through ${authorityDomains.slice(0, 3).join(', ')} expertise.` : '',
      products ? `Tie claims back to how ${products} changes the workflow.` : '',
      'Qualify claims when company-specific proof is not supplied.',
    ].filter(Boolean), 8),
    marketPositioning: {
      category: industry,
      audience,
      position: `${companyName} should be positioned around ${primaryDifferentiator} for ${audience}.`,
    },
    strategicPosture: {
      stance: strategyBeliefs[0] || doctrine.worldview.thesis,
      beliefs: unique([...strategyBeliefs, ...doctrine.strategicBeliefs.slice(0, 3)], 8),
    },
    implementationPhilosophy: unique([
      ...doctrine.operationalPhilosophy.slice(0, 4),
      products ? `Make ${products} visible as an execution path, not a promotional detour.` : '',
      `Treat ${primaryPain} as the operating constraint every recommendation must respect.`,
    ].filter(Boolean), 8),
    completeness,
  });
}

