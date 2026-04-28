import type { CompanyProfile, StrategyProfile } from '../../backend/services/companyProfile/types';

export type { StrategyProfile } from '../../backend/services/companyProfile/types';

type StrategyValidationInput = {
  strategyProfile?: StrategyProfile | null;
  uniqueValue?: string;
  competitiveAdvantages?: string;
  industry?: string;
  targetAudience?: string;
  idealCustomerProfile?: string;
  coreProblem?: string;
  painPoints?: string[] | null;
  productsServices?: string;
  authorityDomains?: string[] | null;
};

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values
      .map((value) => cleanText(value))
      .filter((value): value is string => Boolean(value)),
  ));
}

function toMeaningfulTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

export function normalizeStrategyProfile(strategyProfile: unknown): StrategyProfile | undefined {
  if (!strategyProfile || typeof strategyProfile !== 'object') return undefined;
  const source = strategyProfile as Record<string, unknown>;
  const normalized: StrategyProfile = {
    worldview: cleanText(source.worldview),
    contrarianBeliefs: cleanList(source.contrarianBeliefs),
    primaryFocus: cleanList(source.primaryFocus),
    differentiation: cleanList(source.differentiation),
    typicalAngles: cleanList(source.typicalAngles),
  };

  if (
    !normalized.worldview &&
    (!normalized.contrarianBeliefs || normalized.contrarianBeliefs.length === 0) &&
    (!normalized.primaryFocus || normalized.primaryFocus.length === 0) &&
    (!normalized.differentiation || normalized.differentiation.length === 0) &&
    (!normalized.typicalAngles || normalized.typicalAngles.length === 0)
  ) {
    return undefined;
  }

  return normalized;
}

export function extractStrategyProfile(profile: CompanyProfile | null | undefined): StrategyProfile | undefined {
  if (!profile) return undefined;
  return normalizeStrategyProfile({
    worldview: cleanText(profile.brand_positioning),
    primaryFocus: cleanList((profile.growth_priorities || '').split(/[\n;,]+/)),
    differentiation: cleanList((profile.competitive_advantages || '').split(/[\n;,]+/)),
    typicalAngles: cleanList((profile.key_messages || '').split(/[\n;,]+/)),
  });
}

export function buildStrategyInstructions(strategyProfile: StrategyProfile | null | undefined): string {
  const normalized = normalizeStrategyProfile(strategyProfile);
  if (!normalized) return '';

  const lines = [
    'STRATEGIC PERSPECTIVE (MANDATORY):',
    'You must reflect the company\'s perspective, beliefs, and differentiation in every section.',
    'The output is invalid if it could be published by another company without changes.',
  ];

  if (normalized.worldview) {
    lines.push(`- Anchor the argument in this worldview: ${normalized.worldview}`);
  }
  if (normalized.contrarianBeliefs?.length) {
    lines.push(`- Emphasize these beliefs: ${normalized.contrarianBeliefs.join('; ')}`);
    lines.push(`- Challenge assumptions such as: ${normalized.contrarianBeliefs.join('; ')}`);
  }
  if (normalized.primaryFocus?.length) {
    lines.push(`- Prioritize these focus areas: ${normalized.primaryFocus.join('; ')}`);
  }
  if (normalized.differentiation?.length) {
    lines.push(`- Reinforce these differentiators: ${normalized.differentiation.join('; ')}`);
  }
  if (normalized.typicalAngles?.length) {
    lines.push(`- Prefer these recurring angles: ${normalized.typicalAngles.join('; ')}`);
  }

  return lines.join('\n');
}

function buildStrategyAnchors(input: StrategyValidationInput): string[] {
  const normalized = normalizeStrategyProfile(input.strategyProfile);
  const anchors = [
    normalized?.worldview,
    ...(normalized?.contrarianBeliefs ?? []),
    ...(normalized?.primaryFocus ?? []),
    ...(normalized?.differentiation ?? []),
    ...(normalized?.typicalAngles ?? []),
    cleanText(input.uniqueValue),
    cleanText(input.competitiveAdvantages),
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(anchors));
}

function buildCompanyContextAnchors(input: StrategyValidationInput): string[] {
  const anchors = [
    cleanText(input.productsServices),
    cleanText(input.industry),
    cleanText(input.targetAudience),
    cleanText(input.idealCustomerProfile),
    cleanText(input.coreProblem),
    ...(cleanList(input.painPoints)),
    ...(cleanList(input.authorityDomains)),
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(anchors));
}

function hasAnchorCoverage(text: string, anchor: string): boolean {
  const normalizedText = text.toLowerCase();
  const lowerAnchor = anchor.toLowerCase();
  if (normalizedText.includes(lowerAnchor)) return true;

  const anchorTokens = Array.from(new Set(toMeaningfulTokens(anchor)));
  if (anchorTokens.length === 0) return false;
  const overlap = anchorTokens.filter((token) => normalizedText.includes(token)).length;
  return overlap >= Math.min(3, Math.max(2, Math.ceil(anchorTokens.length * 0.4)));
}

function hasContrarianSignal(text: string): boolean {
  return /\b(unlike|instead of|rather than|the real issue|the real advantage|most (teams|companies|brands|marketers)|conventional wisdom|the common assumption|not just|not enough)\b/i.test(text);
}

function hasGenericPerspective(text: string): boolean {
  return /\b(many companies|businesses should|organizations should|there are multiple approaches|a framework can be applied|teams can benefit|it is important to|success comes from)\b/i.test(text);
}

function splitIntoPerspectiveSegments(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 20);
}

export function validateStrategicPerspective(
  text: string,
  input: StrategyValidationInput,
): {
  perspectiveMismatch: boolean;
  strategicSignalPresent: boolean;
  genericPerspective: boolean;
  matchedAnchors: string[];
  issues: string[];
} {
  const anchors = buildStrategyAnchors(input);
  const companyContextAnchors = buildCompanyContextAnchors(input);
  if (anchors.length === 0) {
    return {
      perspectiveMismatch: false,
      strategicSignalPresent: false,
      genericPerspective: false,
      matchedAnchors: [],
      issues: [],
    };
  }

  const matchedAnchors = anchors.filter((anchor) => hasAnchorCoverage(text, anchor));
  const segments = splitIntoPerspectiveSegments(text);
  const segmentsWithPerspective = segments.filter(
    (segment) => hasContrarianSignal(segment) || anchors.some((anchor) => hasAnchorCoverage(segment, anchor)),
  );
  const companyContextMatched = companyContextAnchors.filter((anchor) => hasAnchorCoverage(text, anchor));
  const perspectiveCooccursWithContext = segmentsWithPerspective.some((segment) =>
    companyContextAnchors.some((anchor) => hasAnchorCoverage(segment, anchor)),
  );
  const strategicSignalPresent = matchedAnchors.length > 0 || hasContrarianSignal(text);
  const genericPerspective =
    (hasGenericPerspective(text) && matchedAnchors.length === 0) ||
    (strategicSignalPresent && companyContextAnchors.length > 0 && !perspectiveCooccursWithContext);
  const issues: string[] = [];

  if (!strategicSignalPresent) {
    issues.push('Missing contrarian insight or unique company angle');
  }
  if (genericPerspective) {
    issues.push(
      companyContextAnchors.length > 0 && companyContextMatched.length > 0
        ? 'Perspective is not tied tightly enough to the company product, domain, ICP, or pain point'
        : 'Perspective still reads as generic and interchangeable',
    );
  }

  return {
    perspectiveMismatch: !strategicSignalPresent || genericPerspective,
    strategicSignalPresent,
    genericPerspective,
    matchedAnchors,
    issues,
  };
}
