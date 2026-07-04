/**
 * Provider Health Dashboard  (BETA-RELEASE-001, Phase 6)
 *
 * A read-only, HONEST live health view for every implemented provider — activation status + real
 * `provider_evidence` table health + persisted evidence counts + freshness. It fires NO live provider
 * fetch (never a paid probe just to check health) and fabricates nothing: a provider with no credential
 * reports `awaiting_credentials`, an unreachable persistence table reports `migration_pending`. Guarded —
 * never throws.
 */
import { buildProviderActivationMatrix, type ProviderActivation } from './providerActivationMatrix';
import { loadProviderEvidence, providerEvidenceTableHealthy } from '../ingestion/providerEvidenceRepository';

export type ProviderHealthStatus = 'connected' | 'awaiting_credentials' | 'disabled' | 'not_implemented';

export interface ProviderHealthEntry {
  providerId: string;
  domain: string;
  status: ProviderHealthStatus;
  configured: boolean;
  reliability: number;
  /** ISO of the most recent persisted fetch for this provider, or null. */
  lastSync: string | null;
  /** Count of persisted canonical evidence rows for this provider (real, from the store). */
  evidenceCount: number;
  migrationStatus: 'applied' | 'pending';
  requiredEnvKeys: string[];
}

export interface ProviderHealthDashboard {
  tableHealthy: boolean;
  tableError: string | null;
  migrationStatus: 'applied' | 'pending';
  providers: ProviderHealthEntry[];
  summary: { implemented: number; connected: number; awaitingCredentials: number; persistedRecords: number };
}

function healthStatus(a: ProviderActivation): ProviderHealthStatus {
  if (!a.implemented) return 'not_implemented';
  if (a.status === 'active') return 'connected';
  return 'awaiting_credentials';
}

/**
 * Build the live provider-health dashboard for a company. Consults the real `provider_evidence` table
 * (guarded) for last-sync + evidence counts. `nowIso` is passed in (deterministic display).
 */
export async function buildProviderHealthDashboard(companyId: string): Promise<ProviderHealthDashboard> {
  const health = await providerEvidenceTableHealthy();
  const migrationStatus: 'applied' | 'pending' = health.healthy ? 'applied' : 'pending';
  const matrix = buildProviderActivationMatrix({ migrationApplied: health.healthy });

  // Real persisted evidence for this company (empty when the table is unapplied — honest).
  const loaded = health.healthy ? await loadProviderEvidence(companyId) : { records: [], error: health.error };
  const byProvider = new Map<string, { count: number; lastSync: string | null }>();
  for (const rec of loaded.records) {
    const cur = byProvider.get(rec.providerId) ?? { count: 0, lastSync: null };
    cur.count += rec.evidence.filter((e) => e.maturity !== 'UNAVAILABLE' && e.value != null).length;
    cur.lastSync = cur.lastSync && cur.lastSync > rec.fetchedAt ? cur.lastSync : rec.fetchedAt;
    byProvider.set(rec.providerId, cur);
  }

  const providers: ProviderHealthEntry[] = matrix.filter((a) => a.implemented).map((a) => {
    const p = byProvider.get(a.providerId);
    return {
      providerId: a.providerId, domain: a.domain, status: healthStatus(a), configured: a.configured,
      reliability: a.reliability, lastSync: p?.lastSync ?? null, evidenceCount: p?.count ?? 0,
      migrationStatus, requiredEnvKeys: a.requiredEnvKeys,
    };
  });

  return {
    tableHealthy: health.healthy,
    tableError: health.error,
    migrationStatus,
    providers,
    summary: {
      implemented: providers.length,
      connected: providers.filter((p) => p.status === 'connected').length,
      awaitingCredentials: providers.filter((p) => p.status === 'awaiting_credentials').length,
      persistedRecords: loaded.records.length,
    },
  };
}
