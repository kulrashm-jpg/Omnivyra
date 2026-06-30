/**
 * Attribution integrity diagnostics (READ-ONLY).
 *
 * Phase 6D — the read + aggregation now live in the Canonical Lead Intelligence
 * Repository (attributionRepository). This module no longer queries leads /
 * lead_attributions / visitor_sessions directly; it delegates entirely to the
 * repository and re-exports the channel classifier + report type for back-compat.
 * Contract (AttributionDiagnosticsReport) is byte-identical.
 */

import { getAttributionDiagnostics, type AttributionDiagnosticsReport } from '../leadIntelligence/attributionRepository';

// Channel classification is repository-owned (single source of truth); re-exported here
// so existing importers of the classifier keep working without duplication.
export { classifyReferrer, type ReferrerClass } from '../../../lib/leadIntelligence';
export type { AttributionDiagnosticsReport } from '../leadIntelligence/attributionRepository';

export async function buildAttributionDiagnostics(
  companyId: string,
  windowDays = 30,
): Promise<AttributionDiagnosticsReport> {
  return getAttributionDiagnostics(companyId, windowDays);
}
