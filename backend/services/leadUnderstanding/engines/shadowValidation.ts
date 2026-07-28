/**
 * LI-C210 — Shadow Validation (pure; report-only). Runs the full assembly per lead in SHADOW and
 * measures parity vs legacy scores + intelligence quality. Produces reports only — no production
 * behavior change, authoritative mode stays OFF. Consumers still read the legacy layer.
 */

import type { CanonicalLeadScores } from '../../../../lib/leadIntelligence/types';
import type { LeadIntelligenceContext } from './engineTypes';
import { assembleLeadUnderstanding } from './assembly';
import { compareToLegacy } from '../shadowRuntime';
import { assessQuality, type QualityScorecard } from './quality';
import type { ShadowComparison } from '../types';

export interface LeadShadowValidation { leadKey: string; comparison: ShadowComparison; quality: QualityScorecard; engineAbstentions: Record<string, boolean>; }
export interface ShadowValidationReport {
  leads: number;
  meanParity: number;
  divergentLeads: number;                 // parity < 1
  meanCompleteness: number;
  meanConfidenceCalibration: number;
  totalUnsupportedConclusions: number;
  engineAbstentionRate: Record<string, number>;
  perLead: LeadShadowValidation[];
}

export function validateShadowBatch(cases: Array<{ ctx: LeadIntelligenceContext; legacy: CanonicalLeadScores }>, opts: { tolerance?: number } = {}): ShadowValidationReport {
  const perLead: LeadShadowValidation[] = [];
  const engineAbstain: Record<string, number> = {};
  let engineRuns = 0;

  for (const { ctx, legacy } of cases) {
    const { understanding, engines } = assembleLeadUnderstanding(ctx);
    const comparison = compareToLegacy(understanding, legacy, { tolerance: opts.tolerance });
    const quality = assessQuality(understanding);
    const engineAbstentions: Record<string, boolean> = {};
    for (const e of engines) { engineAbstentions[e.engine] = e.abstained; engineAbstain[e.engine] = (engineAbstain[e.engine] ?? 0) + (e.abstained ? 1 : 0); engineRuns++; }
    perLead.push({ leadKey: ctx.key.leadKey, comparison, quality, engineAbstentions });
  }

  const n = perLead.length || 1;
  const engineAbstentionRate: Record<string, number> = {};
  for (const [eng, count] of Object.entries(engineAbstain)) engineAbstentionRate[eng] = Number((count / (perLead.length || 1)).toFixed(4));

  return {
    leads: perLead.length,
    meanParity: Number((perLead.reduce((a, p) => a + p.comparison.parity, 0) / n).toFixed(4)),
    divergentLeads: perLead.filter((p) => p.comparison.parity < 1).length,
    meanCompleteness: Number((perLead.reduce((a, p) => a + p.quality.completeness, 0) / n).toFixed(4)),
    meanConfidenceCalibration: Number((perLead.reduce((a, p) => a + p.quality.confidenceCalibration, 0) / n).toFixed(4)),
    totalUnsupportedConclusions: perLead.reduce((a, p) => a + p.quality.unsupportedConclusions, 0),
    engineAbstentionRate,
    perLead,
  };
}
