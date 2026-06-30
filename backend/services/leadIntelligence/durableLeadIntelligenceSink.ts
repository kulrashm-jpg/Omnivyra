/**
 * Durable sink — persists the canonical lead + a provenance timeline event.
 * Replaces the Phase-3 observability-only sink. Fail-open via the repository.
 */

import type { CanonicalLead, LeadIntelligenceSink } from '../../../lib/leadIntelligence';
import { upsertCanonicalLead, appendLeadEvent } from './leadIntelligenceRepository';

export const durableLeadIntelligenceSink: LeadIntelligenceSink = {
  async emit(lead: CanonicalLead): Promise<void> {
    const res = await upsertCanonicalLead(lead);
    if (!res) return; // unapplied table / write failure → fail-open (adoption unaffected)
    await appendLeadEvent(lead.organizationId, res.id, {
      origin: lead.sourceRef?.table ?? 'ingest',
      source: lead.source,
      entityId: lead.sourceRef?.id ?? null,
      eventType: `lead.${lead.source}.ingested`,
      occurredAt: lead.occurredAt ?? lead.ingestedAt,
      metadata: { identityMatchedBy: lead.identityMatchedBy ?? null },
    });
  },
};
