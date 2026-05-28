/**
 * Phase 3 — Hallucination suppression governor.
 *
 * Eight pattern types. Each can fire at low/medium/high/critical severity.
 *
 *   INVENTED_STATISTIC                  e.g. "75% of teams" without attribution
 *   UNSUPPORTED_AUTHORITY               e.g. "studies show", "research proves"
 *   FAKE_RESEARCH_REFERENCE             e.g. "Gartner reports", "Forrester research"
 *   FABRICATED_OPERATIONAL_CERTAINTY    e.g. "this always works", "guaranteed"
 *   UNVERIFIABLE_FACT_AS_TRUTH          e.g. "the most reliable", "the only"
 *   FAKE_CUSTOMER_EXAMPLE               e.g. "ACME Corp saved 40%" without sourcing
 *   FAKE_BENCHMARK                      e.g. "X% faster than competitors"
 *   FAKE_INDUSTRY_STANDARD              e.g. "the industry standard is"
 *
 * Severity bands:
 *   critical → ANY occurrence hard-blocks (forces recovery before pass).
 *   high     → hard-block when ≥ 1 (governor) OR ≥ 2 medium-severity.
 *   medium   → contributes to pressure, eligible for recovery action.
 *   low      → diagnostic only.
 */

import type {
  HallucinationDetection,
  HallucinationPatternType,
  HallucinationSuppressionResult,
} from './longFormRecommendationTypes';

interface PatternRule {
  type: HallucinationPatternType;
  pattern: RegExp;
  severity: 'low' | 'medium' | 'high' | 'critical';
  penalty: number;
  /** When defined, the detection is downgraded if the surrounding sentence contains the bypass marker. */
  bypassWhen?: RegExp;
}

const ATTRIBUTION_BYPASS = /\b(according to|per (?:the )?|as reported by|cited by|from a study by|in our (?:experience|deployment|practice|customer base))\b/i;

const RULES: PatternRule[] = [
  // INVENTED_STATISTIC — percentages, multipliers, dollar-figures stated as facts.
  { type: 'INVENTED_STATISTIC', pattern: /\b\d+(?:\.\d+)?\s*%\s+of\b/i, severity: 'high', penalty: 22, bypassWhen: ATTRIBUTION_BYPASS },
  { type: 'INVENTED_STATISTIC', pattern: /\b(?:companies|teams|organizations|users) save \d+(?:\.\d+)?\s*%/i, severity: 'critical', penalty: 30 },
  { type: 'INVENTED_STATISTIC', pattern: /\b\d+x\s+(?:faster|cheaper|more|better)\b/i, severity: 'high', penalty: 20, bypassWhen: ATTRIBUTION_BYPASS },
  { type: 'INVENTED_STATISTIC', pattern: /\b\$\d+(?:[.,]\d+)?[bmk]?\s+(?:saved|generated|delivered|reduced)\b/i, severity: 'critical', penalty: 28 },

  // UNSUPPORTED_AUTHORITY — generic appeals without attribution.
  { type: 'UNSUPPORTED_AUTHORITY', pattern: /\b(studies show|research (?:proves|shows|indicates)|experts (?:agree|say|warn)|science says)\b/i, severity: 'high', penalty: 22, bypassWhen: ATTRIBUTION_BYPASS },
  { type: 'UNSUPPORTED_AUTHORITY', pattern: /\b(it is (?:widely|well) (?:known|documented|established) that)\b/i, severity: 'medium', penalty: 12 },

  // FAKE_RESEARCH_REFERENCE — named research firms / publications without citation context.
  { type: 'FAKE_RESEARCH_REFERENCE', pattern: /\b(?:Gartner|Forrester|McKinsey|Bain|Deloitte|IDC|Harvard Business Review|HBR)\s+(?:reports?|study|research|analyst|survey|finds?)\b/i, severity: 'critical', penalty: 32 },
  { type: 'FAKE_RESEARCH_REFERENCE', pattern: /\b(?:a recent (?:report|study|paper)|industry analysts)\s+(?:found|showed|reported|conclude)\b/i, severity: 'high', penalty: 22, bypassWhen: ATTRIBUTION_BYPASS },

  // FABRICATED_OPERATIONAL_CERTAINTY — overconfident operational guarantees.
  { type: 'FABRICATED_OPERATIONAL_CERTAINTY', pattern: /\b(this always works|guaranteed (?:results?|outcome|success)|never fails?|100% reliable|works every time)\b/i, severity: 'critical', penalty: 30 },
  { type: 'FABRICATED_OPERATIONAL_CERTAINTY', pattern: /\b(?:eliminates? all|completely solves?|fully automates?|removes? every)\b/i, severity: 'high', penalty: 20 },

  // UNVERIFIABLE_FACT_AS_TRUTH — unqualified superlatives.
  { type: 'UNVERIFIABLE_FACT_AS_TRUTH', pattern: /\bthe (?:most|only|best|fastest|cheapest|safest|most secure)\s+(?:reliable|trusted|effective|scalable|powerful)?\b/i, severity: 'medium', penalty: 10 },
  { type: 'UNVERIFIABLE_FACT_AS_TRUTH', pattern: /\b(without (?:exception|fail|peer)|undisputed (?:leader|standard))\b/i, severity: 'high', penalty: 18 },

  // FAKE_CUSTOMER_EXAMPLE — named-company anecdotes that don't trace to an attribution.
  { type: 'FAKE_CUSTOMER_EXAMPLE', pattern: /\b(?:[A-Z][a-zA-Z0-9-]+(?:\s+[A-Z][a-zA-Z0-9-]+)?(?:\s+(?:Corp|Inc|Co|Ltd|Group|Bank|Capital)))\s+(?:saved|reduced|achieved|cut|delivered)\s+\d/i, severity: 'critical', penalty: 30 },
  { type: 'FAKE_CUSTOMER_EXAMPLE', pattern: /\ba Fortune (?:50|100|500|1000) (?:client|customer|company)\s+(?:saved|achieved|cut|delivered)\b/i, severity: 'high', penalty: 22 },

  // FAKE_BENCHMARK — competitor-comparison numbers without basis.
  { type: 'FAKE_BENCHMARK', pattern: /\b\d+(?:\.\d+)?\s*%\s+(?:faster|cheaper|more efficient|better)\s+than\b/i, severity: 'critical', penalty: 28, bypassWhen: ATTRIBUTION_BYPASS },
  { type: 'FAKE_BENCHMARK', pattern: /\b(?:beats|outperforms)\s+(?:competitors|the (?:next|nearest) (?:competitor|alternative))/i, severity: 'high', penalty: 20 },

  // FAKE_INDUSTRY_STANDARD — appeals to a non-existent standard.
  { type: 'FAKE_INDUSTRY_STANDARD', pattern: /\bthe industry (?:standard|consensus|practice) is\b/i, severity: 'high', penalty: 20 },
  { type: 'FAKE_INDUSTRY_STANDARD', pattern: /\bindustry[- ]wide best practice\b/i, severity: 'medium', penalty: 10 },
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

function sentenceAround(text: string, position: number): string {
  // Return ~120 chars around the position for bypass-context checks.
  const start = Math.max(0, position - 80);
  const end = Math.min(text.length, position + 120);
  return text.slice(start, end);
}

export interface SuppressHallucinationsInput {
  sectionText: string;
  /** When < 1, lower the severity of soft detections (used for low_sensitivity sections). */
  sensitivityFactor?: number;
  /** Override the hard-block ceiling. Default 50. */
  pressureCeiling?: number;
}

export function suppressHallucinations(input: SuppressHallucinationsInput): HallucinationSuppressionResult {
  const plain = stripHtml(input.sectionText);
  const textLength = Math.max(plain.length, 1);
  const sensitivityFactor = input.sensitivityFactor ?? 1.0;
  const ceiling = input.pressureCeiling ?? 50;

  const detections: HallucinationDetection[] = [];
  let pressure = 0;
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;

  for (const rule of RULES) {
    const matches = findAllOccurrences(plain, rule.pattern);
    for (const match of matches) {
      const around = sentenceAround(plain, match.index);
      // If a bypass marker is in the surrounding sentence, downgrade severity by one tier.
      const bypassed = rule.bypassWhen && rule.bypassWhen.test(around);
      let severity: HallucinationDetection['severity'] = rule.severity;
      let penalty = rule.penalty;
      if (bypassed) {
        severity = severity === 'critical' ? 'high'
          : severity === 'high' ? 'medium'
          : severity === 'medium' ? 'low'
          : 'low';
        penalty = Math.round(penalty * 0.5);
      }
      // Apply sensitivity factor to non-critical detections.
      if (severity !== 'critical') {
        penalty = Math.round(penalty * sensitivityFactor);
      }
      detections.push({
        type: rule.type,
        span: match.span,
        positionPercent: Math.round((match.index / textLength) * 100),
        severity,
      });
      pressure += penalty;
      if (severity === 'critical') criticalCount += 1;
      else if (severity === 'high') highCount += 1;
      else if (severity === 'medium') mediumCount += 1;
    }
  }

  // Density correction: long sections naturally accumulate more matches.
  const density = Math.sqrt(textLength / 1000);
  const normalizedPressure = density > 0 ? pressure / Math.max(density, 1) : pressure;
  const hallucinationPressureScore = clamp100(normalizedPressure);

  const hardBlocked =
    criticalCount >= 1
    || highCount >= 2
    || hallucinationPressureScore >= ceiling
    || (highCount >= 1 && mediumCount >= 2);

  const hallucinationSeverity: HallucinationSuppressionResult['hallucinationSeverity'] =
    criticalCount >= 1 ? 'critical'
    : highCount >= 1 ? 'high'
    : mediumCount >= 1 ? 'medium'
    : detections.length > 0 ? 'low'
    : 'none';

  return {
    hallucinationDetections: detections,
    hallucinationSeverity,
    hallucinationPressureScore,
    hardBlocked,
  };
}
