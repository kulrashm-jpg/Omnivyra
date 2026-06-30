/**
 * Lead Intelligence ingestion facade — the single runtime entry that wires the
 * canonical pipeline to real infrastructure (reused identity resolver) and a
 * caller-supplied sink. Existing source modules are NOT modified by this phase;
 * they (and future modules) adopt this facade going forward. The durable sink is
 * provided by the caller — there is no hidden default that silently drops leads.
 */

import {
  ingestCanonicalLead,
  ingestFromSource,
  type CanonicalLead,
  type CanonicalLeadInput,
  type CanonicalLeadSource,
  type IdentityResolverPort,
  type IngestionPorts,
  type LeadIntelligenceSink,
} from '../../../lib/leadIntelligence';
import { createUnifiedPersonIdentityPort } from './leadIntelligencePorts';

export interface LeadIntelligenceIngestorOptions {
  /** Where canonical leads are emitted (durable store / queue). Caller-owned. */
  sink: LeadIntelligenceSink;
  /** Override identity resolution (defaults to the reused unified-person resolver). */
  identity?: IdentityResolverPort;
  now?: () => string;
}

export interface LeadIntelligenceIngestor {
  /** Adapt a raw source row and ingest it (the canonical entry for every source). */
  ingestFromSource(source: CanonicalLeadSource, row: Record<string, unknown>): Promise<CanonicalLead>;
  /** Ingest an already-adapted canonical input. */
  ingestInput(input: CanonicalLeadInput): Promise<CanonicalLead>;
  ports: IngestionPorts;
}

export function createLeadIntelligenceIngestor(opts: LeadIntelligenceIngestorOptions): LeadIntelligenceIngestor {
  const ports: IngestionPorts = {
    identity: opts.identity ?? createUnifiedPersonIdentityPort(),
    sink: opts.sink,
    now: opts.now,
  };
  return {
    ingestFromSource: (source, row) => ingestFromSource(source, row, ports),
    ingestInput: (input) => ingestCanonicalLead(input, ports),
    ports,
  };
}
