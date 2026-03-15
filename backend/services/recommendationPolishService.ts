/**
 * Polished Recommendation Layer.
 * Runs AFTER ranking and BEFORE recommendation card construction.
 * Deterministic only. No external API. No scoring changes.
 */

import type { CompanyProfile } from './companyProfileService';
import type { StrategicPayloadInput } from './recommendationEngineService';
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

/** Capitalize first letter for display (e.g. "stress" → "Stress"). Matches language refinement expectations. */
function capitalizeForDisplay(text: string): string {
  if (!text || typeof text !== 'string') return text;
  const t = text.trim();
  if (!t) return text;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

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

/**
 * Detect if topic is already an editorial headline (from themeAngleEngine or similar).
 * Avoids double-wrapping: "Why How X fails" / "Why What Most Teams Get Wrong About X fails".
 */
function isAlreadyTemplatedTitle(topic: string): boolean {
  const t = (topic ?? '').trim();
  if (!t || t.length < 10) return false;
  const first = t.split(/\s+/)[0]?.toLowerCase() ?? '';
  const prefixes = ['why', 'how', 'what', 'the', 'underserved', 'authority', 'opportunity'];
  if (prefixes.includes(first)) return true;
  if (/^The\s+\w+\s+(?:Impact|Future|Opportunity|Rise|Hidden|Growing)/i.test(t)) return true;
  if (/^A\s+\d+-Step\s+Framework\s+for\s+/i.test(t)) return true;
  return false;
}

/**
 * Sanitize low-quality market report titles (e.g. "X Business Report 2026: $42.81 Bn Market Trends").
 * Extracts a cleaner topic phrase for campaign-ready display.
 * Exported for use in recommendationIntelligenceService.
 */
export function sanitizeTopicForDisplay(topic: string): string {
  let t = (topic ?? '').trim();
  if (!t) return t;

  // Strip market report patterns: " Business Report 2026", " Business Report 2025", etc.
  t = t.replace(/\s+Business\s+Report\s+(?:20\d{2}|202[0-9])\b/gi, '').trim();

  // Strip dollar/market size suffixes: "$42.81 Bn", "$12+", ": $X Bn Market Trends, Opportunities"
  t = t.replace(/\s*[:\-]\s*\$[\d.]+(?:\s*[Bb]n|\s*\+)?(?:\s+Market\s+Trends[^.]*)?\.?$/gi, '').trim();
  t = t.replace(/\s+\$[\d.]+(?:\s*[Bb]n|\s*\+?)\b/g, '').trim();

  // Strip trailing fragments that look like report metadata
  t = t.replace(/\s+(?:Market\s+Trends|Opportunities|Growth\s+Analysis)[^.]*\.?$/gi, '').trim();

  // Strip trailing cruft: ":." ".," ":," ",." (e.g. "Smart Trash Bin.:")
  t = t.replace(/[.:,\s]+$/g, '').trim();

  // If we stripped too much and nothing sensible remains, fall back to truncated original
  if (!t || t.length < 3) return (topic ?? '').trim();

  // Limit length for template insertion; take first ~60 chars at word boundary
  const maxLen = 60;
  if (t.length > maxLen) {
    const cut = t.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(' ');
    t = lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
  }

  return t.trim();
}

function applyGenericReframe(topic: string): string {
  const base = capitalizeForDisplay(topic.trim());
  const template = REFRAME_GENERIC[Math.abs(hashCode(base)) % REFRAME_GENERIC.length];
  return template.replace('{topic}', base);
}

function applyOpportunityReframe(topic: string, isDiamond: boolean): string {
  const base = topic.trim();
  if (isDiamond) {
    return `Underserved opportunity: ${capitalizeForDisplay(base)}`;
  }
  const template = REFRAME_OPPORTUNITY[Math.abs(hashCode(base)) % REFRAME_OPPORTUNITY.length];
  return template.replace('{topic}', capitalizeForDisplay(base));
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
  profile: CompanyProfile | null,
  strategicPayload?: StrategicPayloadInput | null
): PolishedRecommendation[] {
  if (!recommendations || recommendations.length === 0) {
    return [];
  }

  try {
    const authorityTokens = getAuthorityTokens(profile);
    if (strategicPayload?.selected_offerings?.length) {
      strategicPayload.selected_offerings.forEach((o) =>
        tokenize(String(o)).forEach((t) => authorityTokens.add(t))
      );
    }
    if (strategicPayload?.selected_aspect) {
      tokenize(String(strategicPayload.selected_aspect)).forEach((t) => authorityTokens.add(t));
    }
    if (Array.isArray(strategicPayload?.selected_aspects)) {
      strategicPayload.selected_aspects.forEach((a) =>
        a && String(a).trim() && tokenize(String(a)).forEach((t) => authorityTokens.add(t))
      );
    }
    const weightedTokens =
      profile || strategicPayload
        ? buildWeightedAlignmentTokens(profile ?? ({} as any), strategicPayload)
        : new Map<string, number>();

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

      const sanitized = sanitizeTopicForDisplay(topic);
      const authOverlap = hasAuthorityOverlap(sanitized, authorityTokens);
      const generic = isGenericTopic(sanitized, authorityTokens);
      const isDiamond = alignment >= 0.5 && ((rec as any).volume ?? 0) < volumeMax * 0.3;

      let title: string;
      if (authOverlap) {
        flags.authority_elevated = true;
        title = `Authority Opportunity: ${capitalizeForDisplay(sanitized)}`;
      } else if (isAlreadyTemplatedTitle(sanitized)) {
        title = sanitized;
      } else if (generic) {
        flags.is_generic_reframed = true;
        title = applyGenericReframe(sanitized);
      } else if (isDiamond) {
        flags.diamond_candidate = true;
        title = `Underserved opportunity: ${capitalizeForDisplay(sanitized)}`;
      } else {
        title = applyOpportunityReframe(sanitized, false);
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
