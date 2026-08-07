/**
 * WS-4 Phase-2 — Company Enrichment public surface and the seam into the
 * certified evidence pipeline.
 *
 * ─── WHERE THIS PLUGS IN ───────────────────────────────────────────────────
 *     providers  →  orchestrator  →  toFirmographicInputs()
 *                →  EvidenceSources.firmographics
 *                →  ingestCompanyEvidence()      (existing, unchanged)
 *                →  buildCompanyUnderstandingFromEvidence()
 *                →  resolveCompanyProjection()   (existing, parity-gated)
 *
 * There is exactly ONE new edge: the aggregate becomes `FirmographicInput[]`.
 * Everything downstream is the pipeline that COMPANY-PROFILE-ONTOLOGY-001
 * already certified, including its fail-safe parity gate — so a bad enrichment
 * degrades to the legacy projection instead of corrupting a company profile.
 * Both rollout flags remain default OFF and this module does not read them.
 *
 * ─── REGISTRATION IS CALLER-DRIVEN ─────────────────────────────────────────
 * Importing this file registers nothing. `registerDefaultProviders()` is an
 * explicit act, following WS-3's transport-registry precedent, so a module
 * import can never make external egress reachable.
 */

export * from './contract';
export * from './registry';
export * from './orchestrator';
export {
  cacheKey,
  cachedFetch,
  costSummary,
  createMemoryStore,
  readLedger,
  __resetLedgerForTests,
  type CacheEntry,
  type EnrichmentCacheStore,
  type LedgerEntry,
} from './cache';
export { VENDOR_PROVIDERS } from './adapters';

import { VENDOR_PROVIDERS } from './adapters';
import { registerProvider } from './registry';
import type { EnrichmentAggregate } from './orchestrator';
import type { FirmographicInput } from '../evidence/adapters';

/**
 * Register the six vendor adapters.
 *
 * Registration makes a provider ROUTABLE, not LIVE — every adapter is dark
 * without its credential and performs no network call in that state. This is
 * the same distinction WS-3 draws between a registered and an enabled
 * transport.
 */
export function registerDefaultProviders(): void {
  for (const provider of VENDOR_PROVIDERS) registerProvider(provider);
}

/**
 * Map an aggregate onto the evidence contract.
 *
 * ONE INPUT PER CONTRIBUTING PROVIDER, not one merged blob. The evidence layer
 * records `system` per fact, and collapsing four vendors into a single
 * synthetic system would destroy exactly the provenance that makes a contested
 * value explainable later. A field whose winner was Clearbit is attributed to
 * Clearbit, and the losers are still visible on the aggregate.
 */
export function toFirmographicInputs(aggregate: EnrichmentAggregate): FirmographicInput[] {
  const byProvider = new Map<string, FirmographicInput>();

  for (const field of aggregate.fields) {
    const input = byProvider.get(field.provider) ?? {
      companyId: aggregate.companyId,
      observedAt: field.observedAt,
      system: field.provider,
      sourceRef: aggregate.domain ?? undefined,
    };

    switch (field.key) {
      case 'foundedYear':       input.foundedYear = field.value; break;
      case 'headcount':         input.headcount = field.value; break;
      case 'size':              input.size = field.value; break;
      case 'revenueBand':       input.revenueBand = field.value; break;
      case 'fundingStage':      input.fundingStage = field.value; break;
      case 'hq':                input.hq = field.value; break;
      case 'country':           input.country = field.value; break;
      case 'industry':          input.industry = field.value; break;
      case 'technologies':      input.technologies = field.value; break;
      case 'totalRaised':       input.totalRaised = field.value; break;
      case 'lastFundingAt':     input.lastFundingAt = field.value; break;
      case 'openRoles':         input.openRoles = field.value; break;
      case 'hiringDepartments': input.hiringDepartments = field.value; break;
      case 'legalName':         input.legalName = field.value; break;
      case 'linkedinHandle':    input.linkedinHandle = field.value; break;
      // An unmapped key is dropped rather than guessed into a field. A silent
      // remap is how a vendor's `employee_count` ends up recorded as revenue.
      default: break;
    }

    byProvider.set(field.provider, input);
  }

  // Sorted so identical aggregates yield byte-identical evidence input.
  return [...byProvider.values()].sort((a, b) => a.system.localeCompare(b.system));
}
