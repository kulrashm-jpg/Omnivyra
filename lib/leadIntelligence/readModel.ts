/**
 * Canonical Lead Intelligence read model — the ONE shape every consumer reads.
 *
 * `toCanonicalLeadView` projects an ingested canonical lead; `projectExistingRow`
 * BRIDGES a legacy source row into the same view via the adapters (read-time
 * compatibility — no data is migrated or copied). Consumers (dashboard, analytics,
 * Active Leads, CRM, exports, future modules) read this view, never the raw spines.
 */

import type { CanonicalLead, CanonicalLeadInput, CanonicalLeadView, CanonicalLeadSource } from './types';
import { CANONICAL_LEAD_SOURCE_LABELS } from './sourceTaxonomy';
import { routeToCanonicalInput } from './adapters';

function viewFromInput(input: CanonicalLeadInput, unifiedPersonId: string | null): CanonicalLeadView {
  return {
    organizationId: input.organizationId,
    source: input.source,
    sourceLabel: CANONICAL_LEAD_SOURCE_LABELS[input.source],
    unifiedPersonId,
    identity: input.identity,
    scores: input.scores ?? {},
    status: input.status ?? null,
    campaign: input.attribution.campaign,
    content: input.attribution.content,
    referrer: input.attribution.referrer,
    utm: input.attribution.utm,
    occurredAt: input.occurredAt ?? null,
    sourceRef: input.sourceRef ?? null,
    attribution: input.attribution,
  };
}

export function toCanonicalLeadView(lead: CanonicalLead): CanonicalLeadView {
  return viewFromInput(lead, lead.unifiedPersonId);
}

/** Bridge: project a legacy source row into the canonical view (no DB identity call). */
export function projectExistingRow(source: CanonicalLeadSource, row: Record<string, unknown>): CanonicalLeadView {
  const input = routeToCanonicalInput(source, row);
  return viewFromInput(input, input.identity.unifiedPersonId ?? null);
}

/** In-memory read store — a real reference reader (tests + buffering); durable reader is a port. */
export class InMemoryLeadIntelligenceReader {
  private readonly views: CanonicalLeadView[] = [];
  add(view: CanonicalLeadView): void { this.views.push(view); }
  addLead(lead: CanonicalLead): void { this.views.push(toCanonicalLeadView(lead)); }
  list(filter?: { organizationId?: string; source?: CanonicalLeadSource }): CanonicalLeadView[] {
    return this.views.filter((v) =>
      (!filter?.organizationId || v.organizationId === filter.organizationId) &&
      (!filter?.source || v.source === filter.source));
  }
}
