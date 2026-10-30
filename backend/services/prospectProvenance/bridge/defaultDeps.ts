/**
 * Production wiring for the bridge: every dependency is an EXISTING PI service.
 *
 *   gate                    leadIngestion/orchestrator.resolveLeadIngestionGate
 *                           (ENABLE_LEAD_INGESTION kill switch AND tenant `lead_ingestion` flag)
 *   resolvePerson           identityResolutionService.resolveUnifiedPerson (W1, sole person authority)
 *   findProspectByKey       prospectIdentity/prospectResolution.resolveProspectShadow (read-only)
 *   resolveOrCreateProspect prospectIdentity/prospectResolution.resolveOrCreateProspect (WS-1)
 *   ingestSourceRecord      prospectIdentity/ingestionBoundary.ingestSourceRecord (LI-2, sole evidence store)
 *   recordContribution      prospectProvenance/contributionWriter.recordSourceContribution (sole provenance writer)
 *
 * Modules are loaded LAZILY (on first use), for two reasons:
 *   1. `canonicalLeadSignalService` and `opportunityFeedService` are imported by
 *      many modules; a static import of the ingestion orchestrator from them
 *      would drag the whole PI graph into every importer and risk a cycle.
 *   2. With the gate closed (production default) the bridge does no I/O beyond
 *      the free kill-switch check, and loads nothing else.
 *
 * The two reads below (`findProspectsForPerson`, `loadLeadSignal`) are
 * tenant-filtered reads, not writers. `findProspectsForPerson` is proposed for
 * `prospectResolution.ts` (owned by Agent 2) — see the A4 report.
 */
import type { BridgeDeps } from './types';

let cached: BridgeDeps | null = null;

export function defaultBridgeDeps(): BridgeDeps {
  if (cached) return cached;
  cached = {
    gate: async (organizationId) => {
      const { resolveLeadIngestionGate } = await import('../../leadIngestion/orchestrator');
      return resolveLeadIngestionGate(organizationId);
    },
    resolvePerson: async (input) => {
      const { resolveUnifiedPerson } = await import('../../identityResolutionService');
      return resolveUnifiedPerson(input);
    },
    findProspectByKey: async (organizationId, externalLeadKey, source) => {
      const { resolveProspectShadow } = await import('../../prospectIdentity/prospectResolution');
      const r = await resolveProspectShadow(organizationId, { externalLeadKey, source });
      return r.outcome === 'matched' ? r.prospectId : null;
    },
    findProspectsForPerson: async (organizationId, personId) => {
      const { ownedDbTable } = await import('../../../db/writeOwner');
      const { data, error } = await ownedDbTable('canonical_leads')
        .select('id')
        .eq('company_id', organizationId)       // tenant boundary — never optional
        .eq('unified_person_id', personId)
        .order('created_at', { ascending: true })
        .limit(2);
      if (error) throw new Error(`canonical_leads person lookup failed: ${error.message}`);
      return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    },
    resolveOrCreateProspect: async (organizationId, candidate, at) => {
      const { resolveOrCreateProspect } = await import('../../prospectIdentity/prospectResolution');
      return resolveOrCreateProspect(organizationId, candidate, at);
    },
    ingestSourceRecord: async (input, at) => {
      const { ingestSourceRecord } = await import('../../prospectIdentity/ingestionBoundary');
      return ingestSourceRecord(input, at);
    },
    recordContribution: async (input) => {
      const { recordSourceContribution } = await import('../contributionWriter');
      return recordSourceContribution(input);
    },
    loadLeadSignal: async (organizationId, leadSignalId) => {
      const { ownedDbTable } = await import('../../../db/writeOwner');
      const { data, error } = await ownedDbTable('lead_signals')
        .select('*')
        .eq('organization_id', organizationId)  // tenant boundary — never optional
        .eq('id', leadSignalId)
        .maybeSingle();
      if (error) throw new Error(`lead_signals read failed: ${error.message}`);
      return (data as Record<string, unknown> | null) ?? null;
    },
    now: () => new Date().toISOString(),
  };
  return cached;
}
