/**
 * Canonical Commercial Evidence Ingestion (BETA-PHASE2)
 * -----------------------------------------------------
 * ONE entry that ingests commercial evidence through the EXISTING canonical
 * services — it adds no ingestion logic, no store, no scheduler, and NEVER
 * synthesizes revenue. It delegates to the single canonical scheduler
 * (`runIngestionForCompany`), whose `crm` + `ga4` sources already populate the
 * canonical commercial tables:
 *
 *   runIngestionForCompany(['crm','ga4'])
 *     ├─ runCrmSource → crmIngestionService  → canonical_revenue_events / leads / users
 *     └─ runGa4Source → ga4IngestionService  → canonical_conversions / sessions
 *
 * Both ingestion services are already governor-wired (Phase-1) and telemetered.
 * Downstream commercial consumers (revenue attribution, customer value,
 * commercialProviderBridge/adapter) read those canonical tables — they are NOT
 * touched here, and neither Decision Intelligence nor ROI synthesis is modified.
 *
 * Honest: with no CRM/GA4 connection the canonical tables stay empty and the
 * commercial provider remains Not-Quantifiable; nothing is fabricated.
 */

import { runIngestionForCompany } from '../ingestionScheduler';
import { getProviderSyncHealth, type ProviderSyncHealth } from '../providers/providerSyncHealth';
import { isCommercialProviderConfigured } from '../commercialProviderBridge';

export interface CommercialEvidenceResult {
  triggered: boolean;
  sources: string[];
  reason?: string;
}

/**
 * Ingest commercial evidence for a tenant via the canonical CRM + GA4 sources.
 * `manual` forces a fresh run; otherwise the scheduler's idempotency applies.
 * Never throws.
 */
export async function ingestCommercialEvidence(
  companyId: string,
  opts?: { manual?: boolean },
): Promise<CommercialEvidenceResult> {
  try {
    await runIngestionForCompany({
      companyId,
      sources: ['crm', 'ga4'],
      force: opts?.manual === true,
      reason: opts?.manual ? 'commercial_evidence_manual' : 'commercial_evidence_scheduled',
    });
    return { triggered: true, sources: ['crm', 'ga4'] };
  } catch (err) {
    return { triggered: false, sources: [], reason: err instanceof Error ? err.message : 'commercial_ingestion_failed' };
  }
}

export interface CommercialEvidenceStatus {
  /** Commercial provider gated on (CRM_ENABLED | COMMERCIAL_EVIDENCE_ENABLED). */
  enabled: boolean;
  /** Canonical per-tenant sync health for the commercial source. */
  health: ProviderSyncHealth | null;
}

/** Canonical commercial-evidence status for a tenant. Never throws. */
export async function getCommercialEvidenceStatus(companyId: string): Promise<CommercialEvidenceStatus> {
  let health: ProviderSyncHealth | null = null;
  try {
    health = await getProviderSyncHealth(companyId, 'commercial');
  } catch {
    health = null;
  }
  return { enabled: isCommercialProviderConfigured(), health };
}
