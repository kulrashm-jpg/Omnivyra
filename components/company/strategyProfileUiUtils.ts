/**
 * UI-ONLY UTILITY
 *
 * This file must remain:
 * - lightweight
 * - deterministic
 * - explainable
 *
 * DO NOT:
 * - add scoring systems
 * - add confidence levels
 * - add ML-like heuristics
 * - replicate backend intelligence logic
 *
 * If logic becomes complex -> simplify or remove.
 */
import type { CompanyProfile } from '../../pages/company-profile.types';

export type StrategyProfile = NonNullable<CompanyProfile['strategy_profile']>;

const GENERIC_TERMS = [
  'growth',
  'optimize',
  'optimization',
  'solutions',
  'solution',
  'businesses',
  'results',
  'efficiency',
  'innovation',
  'value',
];

export function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemToken(token: string): string {
  const lower = String(token || '').toLowerCase().trim();
  if (lower.length <= 4) return lower;
  if (lower.endsWith('ational')) return `${lower.slice(0, -7)}ate`;
  if (lower.endsWith('ization')) return `${lower.slice(0, -7)}ize`;
  if (lower.endsWith('isation')) return `${lower.slice(0, -7)}ize`;
  if (lower.endsWith('izations')) return `${lower.slice(0, -8)}ize`;
  if (lower.endsWith('isations')) return `${lower.slice(0, -8)}ize`;
  if (lower.endsWith('izing')) return `${lower.slice(0, -5)}ize`;
  if (lower.endsWith('ising')) return `${lower.slice(0, -5)}ize`;
  if (lower.endsWith('izer')) return `${lower.slice(0, -4)}ize`;
  if (lower.endsWith('izers')) return `${lower.slice(0, -5)}ize`;
  if (lower.endsWith('ized')) return `${lower.slice(0, -4)}ize`;
  if (lower.endsWith('ised')) return `${lower.slice(0, -4)}ize`;
  if (lower.endsWith('izing')) return `${lower.slice(0, -5)}ize`;
  if (lower.endsWith('ing') && lower.length > 6) return lower.slice(0, -3);
  if (lower.endsWith('ed') && lower.length > 5) return lower.slice(0, -2);
  if (lower.endsWith('ation')) return lower.slice(0, -5);
  if (lower.endsWith('ations')) return lower.slice(0, -6);
  if (lower.endsWith('tion') && lower.length > 6) return lower.slice(0, -4);
  if (lower.endsWith('tions') && lower.length > 7) return lower.slice(0, -5);
  if (lower.endsWith('ment') && lower.length > 6) return lower.slice(0, -4);
  if (lower.endsWith('ments') && lower.length > 7) return lower.slice(0, -5);
  if (lower.endsWith('ers')) return lower.slice(0, -1);
  if (lower.endsWith('ies') && lower.length > 5) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith('es') && lower.length > 4) return lower.slice(0, -2);
  if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 4) return lower.slice(0, -1);
  return lower;
}

function toTokenSet(value: string): Set<string> {
  return new Set(tokenizeText(value));
}

function tokenizeText(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => stemToken(token.trim()))
    .filter(Boolean);
}

export function normalizeStrategyProfile(profile: CompanyProfile): StrategyProfile {
  return {
    worldview: profile.strategy_profile?.worldview ?? profile.strategyProfile?.worldview ?? '',
    contrarianBeliefs: profile.strategy_profile?.contrarianBeliefs ?? profile.strategyProfile?.contrarianBeliefs ?? [],
    primaryFocus: profile.strategy_profile?.primaryFocus ?? profile.strategyProfile?.primaryFocus ?? [],
    differentiation: profile.strategy_profile?.differentiation ?? profile.strategyProfile?.differentiation ?? [],
    typicalAngles: profile.strategy_profile?.typicalAngles ?? profile.strategyProfile?.typicalAngles ?? [],
  };
}

export function toCleanList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function getFieldWarning(text: string): string | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const hasGenericLanguage = GENERIC_TERMS.some((term) => normalized.includes(term));
  const hasSpecificSignal =
    /\d/.test(normalized) ||
    normalized.includes('saas') ||
    normalized.includes('seo') ||
    normalized.includes('pipeline') ||
    normalized.includes('distribution') ||
    normalized.includes('b2b') ||
    normalized.includes('product') ||
    normalized.includes('content cluster') ||
    normalized.split(/\s+/).length >= 8;
  return hasGenericLanguage && !hasSpecificSignal
    ? 'Warning: This sounds generic. Try making it more specific to your domain or product.'
    : null;
}

function flattenStrategyText(strategy: StrategyProfile | null | undefined): string {
  if (!strategy) return '';
  return [
    strategy.worldview || '',
    ...(strategy.contrarianBeliefs || []),
    ...(strategy.primaryFocus || []),
    ...(strategy.differentiation || []),
    ...(strategy.typicalAngles || []),
  ].join(' ');
}

function countGenericTerms(text: string): number {
  const normalized = normalizeText(text);
  return GENERIC_TERMS.reduce((count, term) => count + (normalized.includes(term) ? 1 : 0), 0);
}

function buildSpecificTerms(profile: CompanyProfile): string[] {
  const raw = [
    profile.ideal_customer_profile,
    profile.target_audience,
    profile.products_services,
    profile.industry,
    profile.core_problem_statement,
    ...(profile.authority_domains || []),
    ...(profile.pain_symptoms || []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');

  return Array.from(
    new Set(
      normalizeText(raw)
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length >= 4),
    ),
  );
}

function countSpecificTerms(text: string, profile: CompanyProfile): number {
  const normalized = normalizeText(text);
  const stemmedText = tokenizeText(text).join(' ');
  return buildSpecificTerms(profile).filter((term) => {
    const stemmedTerm = stemToken(term);
    return normalized.includes(term) || stemmedText.includes(stemmedTerm);
  }).length;
}

function countConcreteSignals(text: string): number {
  const normalized = normalizeText(text);
  const scenarioSignals = ['for example', 'for instance', 'if your', 'when teams', 'compared to', 'instead of', 'case study'];
  let count = /\d/.test(text) ? 1 : 0;
  count += scenarioSignals.filter((signal) => normalized.includes(signal)).length;
  return count;
}

function summarizeStrategy(strategy: StrategyProfile | null | undefined): string {
  if (!strategy) return '';
  const firstSignal =
    strategy.worldview ||
    strategy.contrarianBeliefs?.[0] ||
    strategy.primaryFocus?.[0] ||
    strategy.differentiation?.[0] ||
    strategy.typicalAngles?.[0] ||
    '';
  return firstSignal.trim();
}

function measureTokenSimilarity(previousText: string, nextText: string): number {
  const previousTokens = toTokenSet(previousText);
  const nextTokens = toTokenSet(nextText);
  const union = new Set([...Array.from(previousTokens), ...Array.from(nextTokens)]).size || 1;
  const intersection = Array.from(previousTokens).filter((token) => nextTokens.has(token)).length;
  return intersection / union;
}

function getImprovementReason(args: {
  differentiationImproved: boolean;
  specificityIncreased: boolean;
  genericReduced: boolean;
  concreteIncreased: boolean;
}): string | null {
  if (args.differentiationImproved) return 'Clearer differentiation added';
  if (args.specificityIncreased) return 'More specific audience or domain defined';
  if (args.genericReduced) return 'Reduced generic language';
  if (args.concreteIncreased) return 'More concrete and actionable detail';
  return null;
}

export function buildImprovementSummary(args: {
  previous: StrategyProfile | null;
  next: StrategyProfile | null;
  profile: CompanyProfile;
}): { improved: boolean; reason: string; before?: string; after?: string } | null {
  const previousText = flattenStrategyText(args.previous);
  const nextText = flattenStrategyText(args.next);
  if (!previousText.trim() || !nextText.trim() || previousText.trim() === nextText.trim()) {
    return null;
  }

  const previousGeneric = countGenericTerms(previousText);
  const nextGeneric = countGenericTerms(nextText);
  const previousSpecific = countSpecificTerms(previousText, args.profile);
  const nextSpecific = countSpecificTerms(nextText, args.profile);
  const previousConcrete = countConcreteSignals(previousText);
  const nextConcrete = countConcreteSignals(nextText);
  const previousLength = normalizeText(previousText).split(' ').filter(Boolean).length;
  const nextLength = normalizeText(nextText).split(' ').filter(Boolean).length;
  const previousDifferentiationLength = args.previous?.differentiation?.filter(Boolean).length ?? 0;
  const nextDifferentiationLength = args.next?.differentiation?.filter(Boolean).length ?? 0;

  const genericReduced = nextGeneric < previousGeneric;
  const specificityIncreased = nextSpecific > previousSpecific;
  const concreteIncreased = nextConcrete > previousConcrete;
  const specificityRegressed = nextSpecific < previousSpecific;
  const longerButNotMoreSpecific = nextLength > previousLength && nextSpecific <= previousSpecific;
  const differentiationImproved = nextDifferentiationLength > previousDifferentiationLength;
  const similarity = measureTokenSimilarity(previousText, nextText);

  if (specificityRegressed || longerButNotMoreSpecific || (similarity > 0.9 && !specificityIncreased)) {
    return null;
  }
  if (!genericReduced && !specificityIncreased && !concreteIncreased && !differentiationImproved) {
    return null;
  }

  const reason = getImprovementReason({
    differentiationImproved,
    specificityIncreased,
    genericReduced,
    concreteIncreased,
  });
  if (!reason) {
    return null;
  }

  return {
    improved: true,
    reason,
    before: summarizeStrategy(args.previous),
    after: summarizeStrategy(args.next),
  };
}

export function getHighlightCandidates(strategy: StrategyProfile): string[] {
  return Array.from(
    new Set(
      [
        ...(strategy.contrarianBeliefs || []),
        ...(strategy.primaryFocus || []),
        ...(strategy.differentiation || []),
      ]
        .map((item) => item.trim())
        .filter((item) => normalizeText(item).split(' ').length >= 3)
        .map((item) => normalizeText(item)),
    ),
  );
}

function phraseAppearsContiguously(tokens: string[], phraseTokens: string[], start: number, end: number): boolean {
  if (phraseTokens.length === 0) return false;
  for (let index = start; index <= end - phraseTokens.length; index += 1) {
    if (tokens.slice(index, index + phraseTokens.length).join(' ') === phraseTokens.join(' ')) {
      return true;
    }
  }
  return false;
}

function findHighlightMatches(content: string, candidates: string[]): string[] {
  const originalTokens = String(content || '').match(/\b[\w%+-]+\b/g) || [];
  const normalizedTokens = tokenizeText(content);
  if (candidates.length === 0 || normalizedTokens.length === 0) return [];

  return candidates
    .map((candidate): { matchText: string; tokenLength: number } | null => {
      const phraseTokens = tokenizeText(candidate);
      if (phraseTokens.length < 3) return null;

      const windowSize = Math.max(5, Math.ceil(phraseTokens.length * 1.5));
      const exactPhrase = phraseTokens.join(' ');
      const joinedTokens = normalizedTokens.join(' ');

      for (let start = 0; start <= normalizedTokens.length - Math.min(phraseTokens.length, windowSize); start += 1) {
        const windowTokens = normalizedTokens.slice(start, start + windowSize);
        const overlap = Array.from(new Set(phraseTokens.filter((token) => windowTokens.includes(token)))).length;
        const overlapRatio = overlap / phraseTokens.length;
        const exactInWindow = phraseAppearsContiguously(normalizedTokens, phraseTokens, start, start + windowSize);

        if (!exactInWindow && (overlap < 3 || overlapRatio < 0.7)) {
          continue;
        }

        const snippet = originalTokens.slice(start, start + windowSize).join(' ');
        const normalizedSnippet = tokenizeText(snippet).join(' ');
        if (!snippet.trim() || (!exactInWindow && normalizedSnippet === exactPhrase)) {
          continue;
        }

        return {
          matchText: snippet,
          tokenLength: phraseTokens.length,
        };
      }

      if (joinedTokens.includes(exactPhrase)) {
        return {
          matchText: candidate,
          tokenLength: phraseTokens.length,
        };
      }

      return null;
    })
    .filter((item): item is { matchText: string; tokenLength: number } => Boolean(item))
    .sort((a, b) => b.tokenLength - a.tokenLength)
    .slice(0, 3)
    .map((item) => item.matchText);
}

export function matchHighlights(content: string, candidates: string[]): string[] {
  return findHighlightMatches(content, candidates);
}
