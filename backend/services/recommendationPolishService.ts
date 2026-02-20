/**
 * Polished Recommendation Layer.
 * Runs AFTER ranking and BEFORE recommendation card construction.
 * Deterministic only. No external API. No scoring changes.
 */

import type { CompanyProfile } from './companyProfileService';
import {
  buildWeightedAlignmentTokens,
  computeAlignmentScore,
} from './recommendationEngineService';

export type PolishFlags = {
  is_generic_reframed: boolean;
  authority_elevated: boolean;
  diamond_candidate: boolean;
  duplicate_removed?: boolean;
};

export type PolishedRecommendation = {
  topic: string;
  source?: string;
  geo?: string;
  volume?: number;
  velocity?: number;
  sentiment?: number;
  sources?: string[];
  frequency?: number;
  platform_tag?: string;
  [key: string]: unknown;
} & {
  polish_flags: PolishFlags;
  polished_title: string;
  diamond_score?: number;
};

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);

const GENERIC_BLACKLIST = new Set(['tools', 'software', 'platform', 'strategies', 'tips']);
const DOWNWEIGHT = new Set(['marketing', 'growth', 'tech', 'engagement']);

const tokenOverlap = (a: string, b: string): number => {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0) return 0;
  let overlap = 0;
  setA.forEach((t) => {
    if (setB.has(t)) overlap++;
  });
  return overlap / setA.size;
};

const isGenericTopic = (
  topic: string,
  authorityTokens: Set<string>
): boolean => {
  const tokens = new Set(tokenize(topic));
  const strongNonGeneric = Array.from(tokens).filter(
    (t) => !GENERIC_BLACKLIST.has(t) && !DOWNWEIGHT.has(t)
  );
  if (strongNonGeneric.length > 2) return false;
  const mostlyDownweight = Array.from(tokens).filter((t) => DOWNWEIGHT.has(t)).length;
  if (mostlyDownweight < tokens.size / 2 && strongNonGeneric.length >= 1) return false;
  if (authorityTokens.size > 0) {
    const hasAuthorityOverlap = Array.from(tokens).some((t) => authorityTokens.has(t));
    if (hasAuthorityOverlap) return false;
  }
  return tokens.size <= 3 || strongNonGeneric.length <= 2;
};

const REFRAME_GENERIC = [
  'How companies fail at {topic} — and what actually works',
  'The hidden mistake in {topic} that costs teams',
  'Why {topic} backfires — and the fix',
];

const REFRAME_OPPORTUNITY = [
  'Why {topic} fails — and how teams actually gain focus',
  'The {topic} gap most companies miss',
  'Underserved opportunity: {topic}',
];

function applyGenericReframe(topic: string): string {
  const base = topic.trim();
  const template = REFRAME_GENERIC[Math.abs(hashCode(base)) % REFRAME_GENERIC.length];
  return template.replace('{topic}', base);
}

function applyOpportunityReframe(topic: string, isDiamond: boolean): string {
  const base = topic.trim();
  if (isDiamond) {
    return `Underserved opportunity: ${base}`;
  }
  const template = REFRAME_OPPORTUNITY[Math.abs(hashCode(base)) % REFRAME_OPPORTUNITY.length];
  return template.replace('{topic}', base);
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

function getAuthorityTokens(profile: CompanyProfile | null): Set<string> {
  if (!profile?.authority_domains) return new Set();
  const tokens = new Set<string>();
  (profile.authority_domains || []).forEach((d) =>
    tokenize(d).forEach((t) => tokens.add(t))
  );
  return tokens;
}

function hasAuthorityOverlap(topic: string, authorityTokens: Set<string>): boolean {
  if (authorityTokens.size === 0) return false;
  const topicTokens = new Set(tokenize(topic));
  return Array.from(authorityTokens).some((t) => topicTokens.has(t));
}

export function polishRecommendations(
  recommendations: Array<Record<string, unknown> & { topic: string }>,
  profile: CompanyProfile | null
): PolishedRecommendation[] {
  if (!recommendations || recommendations.length === 0) {
    return [];
  }

  try {
    const authorityTokens = getAuthorityTokens(profile);
    const weightedTokens = profile ? buildWeightedAlignmentTokens(profile) : new Map<string, number>();

    const volumeMax = Math.max(
      ...recommendations.map((r) => Number((r as any).volume ?? 0) || 0),
      1
    );
    const freqMax = Math.max(
      ...recommendations.map((r) => Number((r as any).frequency ?? 0) || 0),
      1
    );

    const withScores = recommendations.map((rec) => {
      const topic = String(rec.topic || '').trim();
      const alignment = weightedTokens.size > 0 ? computeAlignmentScore(topic, weightedTokens) : 0.5;
      const volume = Number((rec as any).volume ?? 0) || 0;
      const freq = Number((rec as any).frequency ?? 0) || 0;
      const popNorm = (volume / volumeMax) * 0.5 + (freq / freqMax) * 0.5;
      const diamondScore = Math.min(1, Math.max(0, alignment * (1 - popNorm * 0.5)));
      return { rec, topic, alignment, popNorm, diamondScore };
    });

    const seen = new Set<string>();
    const deduped: typeof withScores = [];
    for (const item of withScores) {
      const key = item.topic.toLowerCase();
      let isDup = false;
      for (const k of seen) {
        if (tokenOverlap(item.topic, k) > 0.7) {
          isDup = true;
          break;
        }
      }
      if (!isDup) {
        seen.add(key);
        deduped.push(item);
      }
    }

    const polished: PolishedRecommendation[] = deduped.map(({ rec, topic, alignment, diamondScore }) => {
      const flags: PolishFlags = {
        is_generic_reframed: false,
        authority_elevated: false,
        diamond_candidate: false,
      };

      const authOverlap = hasAuthorityOverlap(topic, authorityTokens);
      const generic = isGenericTopic(topic, authorityTokens);
      const isDiamond = alignment >= 0.5 && ((rec as any).volume ?? 0) < volumeMax * 0.3;

      let title: string;
      if (authOverlap) {
        flags.authority_elevated = true;
        title = `Authority Opportunity: ${topic}`;
      } else if (generic) {
        flags.is_generic_reframed = true;
        title = applyGenericReframe(topic);
      } else if (isDiamond) {
        flags.diamond_candidate = true;
        title = `Underserved opportunity: ${topic}`;
      } else {
        title = applyOpportunityReframe(topic, false);
      }

      return {
        ...rec,
        polish_flags: flags,
        polished_title: title,
        diamond_score: Math.min(1, Math.max(0, diamondScore)),
      } as PolishedRecommendation;
    });

    return polished;
  } catch {
    return recommendations.map((rec) => ({
      ...rec,
      polish_flags: {
        is_generic_reframed: false,
        authority_elevated: false,
        diamond_candidate: false,
      },
      polished_title: String(rec.topic || ''),
    })) as PolishedRecommendation[];
  }
}
