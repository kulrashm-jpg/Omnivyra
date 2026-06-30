/**
 * Conversion prediction — DETERMINISTIC HEURISTIC (NOT ML).
 *
 * Phase 6E — the data-acquisition layer and the (unchanged) prediction now live in
 * the Canonical Lead Intelligence Repository (conversionPredictionRepository). This
 * module no longer queries leads / lead_attributions / tracking_events / lead_signals
 * directly; it delegates entirely to the repository and re-exports the contract types
 * for back-compat. Prediction behaviour is byte-identical.
 */

import {
  getMarketingConversionPrediction,
  type ConversionPredictionReport,
} from '../leadIntelligence/conversionPredictionRepository';

export type {
  ConversionTier,
  LeadPrediction,
  ConversionPredictionReport,
} from '../leadIntelligence/conversionPredictionRepository';

export async function buildConversionPredictions(
  companyId: string,
  limit = 200,
): Promise<ConversionPredictionReport> {
  return getMarketingConversionPrediction(companyId, limit);
}
