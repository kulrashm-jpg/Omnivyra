/**
 * Coordination Intelligence Layer — in-memory store (the inert default).
 *
 * Process-local, tenant-scoped, deterministic. This is the safe default: the
 * foundation lands inert (no DB dependency) exactly like the PIP Null adapters.
 * A migration wave flips `COORDINATION_REGISTRY_PERSIST_ENABLED` to swap in the
 * Supabase store — with no change to the registry or any consumer.
 */
import type {
  CommunicationRecord,
  CoordinationQuery,
  CoordinationStore,
  PublicationStatus,
} from '../coordinationContracts';

export class InMemoryCoordinationStore implements CoordinationStore {
  // companyId → records (newest last)
  private readonly byCompany = new Map<string, CommunicationRecord[]>();

  async insert(record: CommunicationRecord): Promise<CommunicationRecord> {
    const list = this.byCompany.get(record.companyId) ?? [];
    list.push(record);
    this.byCompany.set(record.companyId, list);
    return record;
  }

  async findByRoot(companyId: string, semanticRootId: string): Promise<CommunicationRecord[]> {
    return (this.byCompany.get(companyId) ?? []).filter((r) => r.semanticRootId === semanticRootId);
  }

  async query(companyId: string, query: CoordinationQuery): Promise<CommunicationRecord[]> {
    let rows = (this.byCompany.get(companyId) ?? []).slice();
    if (query.campaignId !== undefined && query.campaignId !== null) rows = rows.filter((r) => r.campaignId === query.campaignId);
    if (query.platform) rows = rows.filter((r) => r.platform === query.platform);
    if (query.audience) rows = rows.filter((r) => r.audience === query.audience);
    if (query.communicationIntent) rows = rows.filter((r) => r.communicationIntent === query.communicationIntent);
    if (query.semanticRootId) rows = rows.filter((r) => r.semanticRootId === query.semanticRootId);
    if (query.since) rows = rows.filter((r) => r.observedAt >= query.since!);
    // newest first
    rows.sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : 0));
    if (query.limit && query.limit > 0) rows = rows.slice(0, query.limit);
    return rows;
  }

  async markStatus(companyId: string, id: string, status: PublicationStatus): Promise<void> {
    const list = this.byCompany.get(companyId) ?? [];
    const row = list.find((r) => r.id === id);
    if (row) row.publicationStatus = status;
  }

  /** Test/utility helper — clear all state. */
  reset(): void {
    this.byCompany.clear();
  }
}
