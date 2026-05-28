/**
 * Phase 6 — Authority inflation detector.
 *
 * Seven inflation patterns. Each adds to `authorityInflationScore` (higher
 * = MORE inflated, which is bad). Score caps at 100.
 *
 *   EXAGGERATED_CERTAINTY                 absolutely, definitively, without question
 *   PSEUDO_EXPERT_LANGUAGE                "as a leading expert", "trust us, we've"
 *   FAKE_STRATEGIC_AUTHORITY              "we own this space", "we set the standard"
 *   UNSUPPORTED_INDUSTRY_CONSENSUS        "everyone agrees", "the industry has spoken"
 *   INFLATED_TRANSFORMATION_PROMISE       "transform your business overnight"
 *   UNREALISTIC_ROI                       "10x ROI", "100x improvement", "infinite scale"
 *   MANIPULATIVE_CERTAINTY_FRAMING        "you'll never X again", "say goodbye to X"
 */

import type {
  AuthorityInflationDetection,
  AuthorityInflationResult,
  AuthorityInflationType,
} from './longFormRecommendationTypes';

interface PatternRule {
  type: AuthorityInflationType;
  pattern: RegExp;
  severity: 'low' | 'medium' | 'high';
  penalty: number;
}

const RULES: PatternRule[] = [
  // EXAGGERATED_CERTAINTY
  { type: 'EXAGGERATED_CERTAINTY', pattern: /\b(absolutely|definitively|undeniably|without (?:question|exception)|unequivocally)\b/i, severity: 'medium', penalty: 12 },
  { type: 'EXAGGERATED_CERTAINTY', pattern: /\bthere is no (?:doubt|question) that\b/i, severity: 'high', penalty: 18 },

  // PSEUDO_EXPERT_LANGUAGE
  { type: 'PSEUDO_EXPERT_LANGUAGE', pattern: /\bas (?:a )?leading (?:experts? in|authority on)\b/i, severity: 'high', penalty: 20 },
  { type: 'PSEUDO_EXPERT_LANGUAGE', pattern: /\b(?:trust us|trust me) (?:on this|when (?:we|i) say)\b/i, severity: 'medium', penalty: 12 },
  { type: 'PSEUDO_EXPERT_LANGUAGE', pattern: /\bin our (?:expert|veteran|seasoned) (?:opinion|view)\b/i, severity: 'medium', penalty: 10 },

  // FAKE_STRATEGIC_AUTHORITY
  { type: 'FAKE_STRATEGIC_AUTHORITY', pattern: /\bwe (?:own|dominate|lead|define) this (?:space|category|market)\b/i, severity: 'high', penalty: 22 },
  { type: 'FAKE_STRATEGIC_AUTHORITY', pattern: /\bwe (?:wrote|set) the (?:book|standard|playbook) on\b/i, severity: 'high', penalty: 22 },

  // UNSUPPORTED_INDUSTRY_CONSENSUS
  { type: 'UNSUPPORTED_INDUSTRY_CONSENSUS', pattern: /\b(everyone|every (?:leader|engineer|team|cio)) (?:agrees|knows|understands)\b/i, severity: 'medium', penalty: 14 },
  { type: 'UNSUPPORTED_INDUSTRY_CONSENSUS', pattern: /\bthe (?:industry|community|market) has spoken\b/i, severity: 'medium', penalty: 12 },
  { type: 'UNSUPPORTED_INDUSTRY_CONSENSUS', pattern: /\bit is (?:universally|widely) accepted that\b/i, severity: 'medium', penalty: 10 },

  // INFLATED_TRANSFORMATION_PROMISE
  { type: 'INFLATED_TRANSFORMATION_PROMISE', pattern: /\btransform your (?:business|company|team|org) (?:overnight|in (?:days|weeks))\b/i, severity: 'high', penalty: 22 },
  { type: 'INFLATED_TRANSFORMATION_PROMISE', pattern: /\b(?:revolutionize|reinvent) (?:how|the way) (?:you|teams) (?:work|operate|build)\b/i, severity: 'medium', penalty: 12 },
  { type: 'INFLATED_TRANSFORMATION_PROMISE', pattern: /\b(?:unleash|unlock) (?:exponential|unprecedented)\b/i, severity: 'high', penalty: 18 },

  // UNREALISTIC_ROI
  { type: 'UNREALISTIC_ROI', pattern: /\b(?:10x|20x|50x|100x|1000x)\s+(?:ROI|return|improvement|efficiency|productivity)\b/i, severity: 'high', penalty: 20 },
  { type: 'UNREALISTIC_ROI', pattern: /\binfinite (?:scale|return|leverage)\b/i, severity: 'high', penalty: 22 },
  { type: 'UNREALISTIC_ROI', pattern: /\b(?:guaranteed|assured) (?:ROI|return on investment)\b/i, severity: 'high', penalty: 22 },

  // MANIPULATIVE_CERTAINTY_FRAMING
  { type: 'MANIPULATIVE_CERTAINTY_FRAMING', pattern: /\byou(?:'ll| will) never (?:[a-z]+ )?(?:again|need to)\b/i, severity: 'medium', penalty: 14 },
  { type: 'MANIPULATIVE_CERTAINTY_FRAMING', pattern: /\bsay (?:goodbye|so long) to\b/i, severity: 'medium', penalty: 12 },
  { type: 'MANIPULATIVE_CERTAINTY_FRAMING', pattern: /\bnever worry about\b/i, severity: 'low', penalty: 6 },
];

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function findAllOccurrences(text: string, pattern: RegExp): Array<{ span: string; index: number }> {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const g = new RegExp(pattern.source, flags);
  const out: Array<{ span: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null) {
    out.push({ span: m[0], index: m.index });
    if (g.lastIndex === m.index) g.lastIndex += 1;
  }
  return out;
}

export interface DetectAuthorityInflationInput {
  sectionText: string;
}

export function detectAuthorityInflation(input: DetectAuthorityInflationInput): AuthorityInflationResult {
  const plain = stripHtml(input.sectionText);
  const textLength = Math.max(plain.length, 1);
  const detections: AuthorityInflationDetection[] = [];
  let pressure = 0;

  for (const rule of RULES) {
    const matches = findAllOccurrences(plain, rule.pattern);
    for (const match of matches) {
      detections.push({
        type: rule.type,
        span: match.span,
        severity: rule.severity,
        positionPercent: Math.round((match.index / textLength) * 100),
      });
      pressure += rule.penalty;
    }
  }

  // Density correction.
  const density = Math.sqrt(textLength / 1000);
  const normalized = density > 0 ? pressure / Math.max(density, 1) : pressure;
  return { authorityInflationScore: clamp100(normalized), detections };
}
