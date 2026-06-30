/**
 * Customer identity continuity — DETERMINISTIC stitching across signals.
 *
 * Phase 6G — the data-acquisition layer and the (unchanged) Union-Find identity-graph
 * analysis now live in the Canonical Lead Intelligence Repository
 * (customerIdentityRepository). This module no longer queries visitor_sessions /
 * leads / tracking_events / campaign_touchpoints / audit_events directly; it delegates
 * entirely to the repository and re-exports the contract types for back-compat.
 * Identity-resolution behaviour is byte-identical (six edge rules, salted email
 * hashes, cluster confidence, drift flags, the best-effort compliance snapshot).
 */

import {
  getCustomerIdentityContinuity,
  type IdentityContinuityReport,
} from '../leadIntelligence/customerIdentityRepository';

export type {
  IdentityEdgeKind,
  IdentityEdge,
  IdentityCluster,
  IdentityContinuityReport,
} from '../leadIntelligence/customerIdentityRepository';

export async function buildIdentityContinuityReport(companyId: string): Promise<IdentityContinuityReport> {
  return getCustomerIdentityContinuity(companyId);
}
