/**
 * Lead Intelligence adoption runtime (Phase 3).
 *
 * The single process-wide ingestor every existing lead-producing module routes its
 * write path through. `adoptLead` is fire-and-forget and fail-open: it NEVER throws
 * and NEVER blocks the caller's existing behaviour — adoption is purely additive on
 * top of each module's unchanged persistence. Identity reuses the existing
 * unified-person resolver; the canonical lead is emitted to the existing audit/
 * observability infrastructure (no schema change). A durable canonical store is a
 * documented Phase-4 gap; this phase establishes the routing.
 */

import type { CanonicalLeadSource } from '../../../lib/leadIntelligence';
import { createLeadIntelligenceIngestor, type LeadIntelligenceIngestor } from './leadIntelligenceFacade';
import { createUnifiedPersonIdentityPort } from './leadIntelligencePorts';
import { durableLeadIntelligenceSink } from './durableLeadIntelligenceSink';

let ingestor: LeadIntelligenceIngestor | null = null;
export function getLeadIntelligenceIngestor(): LeadIntelligenceIngestor {
  if (!ingestor) {
    // Phase 4 — durable sink (canonical store + timeline) replaces the Phase-3
    // observability-only sink. Fail-open via the repository.
    ingestor = createLeadIntelligenceIngestor({ sink: durableLeadIntelligenceSink, identity: createUnifiedPersonIdentityPort() });
  }
  return ingestor;
}

/** Awaitable adoption — routes a source row through the facade. Fail-open. */
export async function adoptLeadAsync(
  source: CanonicalLeadSource,
  row: Record<string, unknown>,
  override?: LeadIntelligenceIngestor,
): Promise<void> {
  try {
    await (override ?? getLeadIntelligenceIngestor()).ingestFromSource(source, row);
  } catch {
    /* fail-open: adoption must never affect existing behaviour */
  }
}

/**
 * Fire-and-forget adoption — the call every module adds after its existing write.
 * Never throws, never awaited in the request path.
 */
export function adoptLead(
  source: CanonicalLeadSource,
  row: Record<string, unknown>,
  override?: LeadIntelligenceIngestor,
): void {
  void adoptLeadAsync(source, row, override);
}
