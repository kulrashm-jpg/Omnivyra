/**
 * INT-001 Phase 6 — canonical Lead Intelligence read service.
 *
 * THE one read surface for Lead Drawer / Lead Detail / Lead List / API
 * consumers. Strictly read-only: it calls ONLY the persistence port's `get`,
 * never generates, never enqueues, never writes, never touches the
 * orchestrator or any engine. Missing intelligence returns a
 * `never_generated` view — exactly the persisted absence.
 */

import { durableIntelligencePersistence } from '../leadIntelligenceOrchestration/persistence';
import type { IntelligencePersistencePort } from '../leadIntelligenceOrchestration/types';
import type { LeadIntelligenceListItemDTO, LeadIntelligenceViewDTO } from './dto';
import { toLeadIntelligenceView, toLeadIntelligenceListItem } from './mapper';

/** Bounded bulk-read size — list consumers page well below this. */
const MAX_BULK_LEADS = 200;

/** Read-only slice of the Phase 4 persistence port — `get` is all we accept. */
export type IntelligenceReadPort = Pick<IntelligencePersistencePort, 'get'>;

export interface LeadIntelligenceReadApi {
  /** Single lead (Drawer / Detail / API). Never null — absence is a DTO state. */
  getLeadIntelligenceView(companyId: string, leadId: string): Promise<LeadIntelligenceViewDTO>;
  /** Bulk detail views, one per requested lead, in input order (capped). */
  getLeadIntelligenceViews(companyId: string, leadIds: string[]): Promise<LeadIntelligenceViewDTO[]>;
  /** Compact list projections, one per requested lead, in input order (capped). */
  getLeadIntelligenceListItems(companyId: string, leadIds: string[]): Promise<LeadIntelligenceListItemDTO[]>;
}

export function createLeadIntelligenceReadApi(
  options: { persistence?: IntelligenceReadPort } = {},
): LeadIntelligenceReadApi {
  const persistence = options.persistence ?? durableIntelligencePersistence;

  async function getLeadIntelligenceView(companyId: string, leadId: string): Promise<LeadIntelligenceViewDTO> {
    if (!companyId || !leadId) {
      return toLeadIntelligenceView(null, { companyId: companyId ?? '', leadId: leadId ?? '' });
    }
    let record = null;
    try {
      record = await persistence.get(companyId, leadId);
    } catch {
      record = null; // fail-open: a read failure presents as never_generated
    }
    return toLeadIntelligenceView(record, { companyId, leadId });
  }

  async function getLeadIntelligenceViews(companyId: string, leadIds: string[]): Promise<LeadIntelligenceViewDTO[]> {
    const bounded = (Array.isArray(leadIds) ? leadIds : []).slice(0, MAX_BULK_LEADS);
    // Input order is the contract; reads run in parallel but results map 1:1.
    return Promise.all(bounded.map((leadId) => getLeadIntelligenceView(companyId, leadId)));
  }

  async function getLeadIntelligenceListItems(companyId: string, leadIds: string[]): Promise<LeadIntelligenceListItemDTO[]> {
    const views = await getLeadIntelligenceViews(companyId, leadIds);
    return views.map(toLeadIntelligenceListItem);
  }

  return { getLeadIntelligenceView, getLeadIntelligenceViews, getLeadIntelligenceListItems };
}
