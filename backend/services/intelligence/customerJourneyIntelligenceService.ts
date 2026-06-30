/**
 * Customer journey intelligence — DETERMINISTIC multi-touch attribution.
 *
 * Phase 6F — the data-acquisition layer and the (unchanged) four-model attribution
 * analysis now live in the Canonical Lead Intelligence Repository
 * (customerJourneyRepository). This module no longer queries leads /
 * visitor_sessions / campaign_touchpoints / lead_attributions / tracking_events
 * directly; it delegates entirely to the repository and re-exports the contract
 * types for back-compat. Attribution behaviour is byte-identical.
 */

import {
  getCustomerJourneyIntelligence,
  type CustomerJourneyReport,
} from '../leadIntelligence/customerJourneyRepository';

export type {
  AttributionModel,
  Touchpoint,
  JourneyCredit,
  CustomerJourney,
  CustomerJourneyReport,
} from '../leadIntelligence/customerJourneyRepository';

export async function buildCustomerJourneyReport(
  companyId: string,
  limit = 100,
): Promise<CustomerJourneyReport> {
  return getCustomerJourneyIntelligence(companyId, limit);
}
