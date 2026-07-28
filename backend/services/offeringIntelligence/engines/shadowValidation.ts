/**
 * OI-C315 — Offering Shadow Validation (pure; report-only). Runs the full assembly per offering in
 * SHADOW and measures field parity vs the seed + completeness + per-engine abstention + unsupported
 * conclusions. Report only — no production behaviour change, authoritative OFF.
 */

import type { OfferingIntelligenceContext } from './engineTypes';
import type { OfferingSeedInput } from '../fromSeed';
import { assembleOfferingUnderstanding } from './assembly';
import { compareToLegacy } from '../shadowRuntime';
import { OFFERING_FACET_NAMES } from '../types';
import { validateReasoning } from '../../intelligence/canonical';

export interface OfferingShadowValidation { offeringId: string; parity: number; completeness: number; unsupportedConclusions: number; engineAbstentions: Record<string, boolean>; }
export interface OfferingShadowReport {
  offerings: number;
  meanParity: number;
  meanCompleteness: number;
  totalUnsupportedConclusions: number;
  engineAbstentionRate: Record<string, number>;
  perOffering: OfferingShadowValidation[];
}

export function validateOfferingShadowBatch(cases: Array<{ ctx: OfferingIntelligenceContext; legacy: OfferingSeedInput }>): OfferingShadowReport {
  const perOffering: OfferingShadowValidation[] = [];
  const abstain: Record<string, number> = {};

  for (const { ctx, legacy } of cases) {
    const { understanding, engines } = assembleOfferingUnderstanding(ctx);
    const parity = compareToLegacy(understanding, legacy).parity;
    const nonNull = OFFERING_FACET_NAMES.filter((n) => understanding.facets[n].value !== null).length;
    const unsupported = understanding.reasoning.filter((t) => !validateReasoning(t).valid).length;
    const engineAbstentions: Record<string, boolean> = {};
    for (const e of engines) { engineAbstentions[e.engine] = e.abstained; abstain[e.engine] = (abstain[e.engine] ?? 0) + (e.abstained ? 1 : 0); }
    perOffering.push({ offeringId: understanding.key.offeringId, parity, completeness: Number((nonNull / OFFERING_FACET_NAMES.length).toFixed(4)), unsupportedConclusions: unsupported, engineAbstentions });
  }

  const n = perOffering.length || 1;
  const engineAbstentionRate: Record<string, number> = {};
  for (const [eng, count] of Object.entries(abstain)) engineAbstentionRate[eng] = Number((count / (perOffering.length || 1)).toFixed(4));
  return {
    offerings: perOffering.length,
    meanParity: Number((perOffering.reduce((a, p) => a + p.parity, 0) / n).toFixed(4)),
    meanCompleteness: Number((perOffering.reduce((a, p) => a + p.completeness, 0) / n).toFixed(4)),
    totalUnsupportedConclusions: perOffering.reduce((a, p) => a + p.unsupportedConclusions, 0),
    engineAbstentionRate,
    perOffering,
  };
}
