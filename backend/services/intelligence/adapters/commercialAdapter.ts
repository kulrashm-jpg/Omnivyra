/**
 * Canonical Commercial Adapter  (BETA-REPORT-EXEC-006)
 *
 * Wires the canonical `commercial` provider (BETA-PROVIDER-008) into Pipeline A's provider registry so that
 * MEASURED commercial evidence (revenue / conversions) can drive the report's ROI determinability. It REUSES
 * the Evidence-Platform commercial bridge (`consolidateCommercialSources`) — NO duplicate commercial
 * calculation, NO new commercial intelligence. Fail-safe: returns `unavailable` (ROI stays "Not Quantifiable")
 * unless CRM_ENABLED / COMMERCIAL_EVIDENCE_ENABLED is set AND a commercial-source loader yields real rows.
 * Deterministic; NEVER fabricates revenue, conversions, or ROI.
 *
 * The default loader reads the EXISTING `canonical_revenue_events` table (already populated by
 * `crmIngestionService`) — no new ingestion pipeline is built. Guarded: a missing table / no rows → null →
 * the report honestly stays Not Quantifiable.
 */
import type { CommercialProvider, CommercialResult } from '../providerInterfaces';
import { unavailableResult } from '../providerInterfaces';
import {
  isCommercialProviderConfigured, consolidateCommercialSources, type CommercialSourcePayload,
} from '../../commercialProviderBridge';
import { freshnessFromTimestamp, logProviderCall } from '../productionPrimitives';
import { supabase } from '../../../db/supabaseClient';
import type { EvidenceTrace } from '../../canonicalReport/canonicalReportTypes';

/** A point-in-time set of authenticated commercial source payloads for one company. */
export interface CommercialSourceSnapshot {
  sources: CommercialSourcePayload[];
  observedAt: string;
}

/** The ingestion seam: reads a company's persisted commercial evidence into payloads. Default reads the
 *  existing `canonical_revenue_events` table; operators may override for CRM/GA4/lead consolidation. */
export type CommercialSourceLoader = (params: { companyId: string }) => Promise<CommercialSourceSnapshot | null>;

let configuredLoader: CommercialSourceLoader | null = null;
export function registerCommercialSourceLoader(impl: CommercialSourceLoader | null): void {
  configuredLoader = impl;
}

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export class CommercialAdapter implements CommercialProvider {
  public readonly id = 'commercial';

  async isAvailable(): Promise<boolean> {
    return isCommercialProviderConfigured();
  }

  async lookup(params: { companyId: string }): Promise<CommercialResult> {
    // BETA-PHASE4-EXEC-001: structured provider-call telemetry parity with the other adapters —
    // one logProviderCall at the lookup boundary (console.info observability only; no report/score change).
    const result = await this.resolveCommercial(params);
    logProviderCall({
      providerId: this.id,
      operation: 'lookup',
      status: result.state === 'measured' ? 'ok' : 'unavailable',
      reason: result.reason_unavailable ?? undefined,
    });
    return result;
  }

  private async resolveCommercial(params: { companyId: string }): Promise<CommercialResult> {
    if (!isCommercialProviderConfigured()) {
      return unavailableResult<CommercialResult>({
        quantified: null, measuredRevenue: false,
        reason: 'Commercial provider not connected. Set CRM_ENABLED / COMMERCIAL_EVIDENCE_ENABLED and connect a commercial source.',
      });
    }
    const loader = configuredLoader;
    if (!loader) {
      return unavailableResult<CommercialResult>({
        quantified: null, measuredRevenue: false,
        reason: 'No commercial-source loader is registered.',
      });
    }

    const snapshot = await loader(params);
    if (!snapshot || snapshot.sources.length === 0) {
      return unavailableResult<CommercialResult>({
        quantified: null, measuredRevenue: false,
        reason: 'Commercial provider is connected but returned no commercial rows.',
      });
    }

    // Reuse the canonical bridge consolidation — no parallel commercial calculation.
    const consolidated = consolidateCommercialSources(snapshot.sources, snapshot.observedAt);
    const revenue = num(consolidated.revenue) ?? num(consolidated.conversionValueTotal);
    const conversions = num(consolidated.conversions);
    const measuredRevenue = revenue != null;

    if (revenue == null && conversions == null) {
      return unavailableResult<CommercialResult>({
        quantified: null, measuredRevenue: false,
        reason: 'Commercial sources present but no measured revenue or conversions.',
      });
    }

    // Measured revenue → currency-native quantity; else conversions → native units. Never fabricated.
    const quantified = measuredRevenue
      ? { value: revenue as number, unit: 'revenue' }
      : { value: conversions as number, unit: 'conversions' };

    const observedAt = consolidated.observedAt ?? snapshot.observedAt;
    const evidence: EvidenceTrace = {
      count: consolidated.contributingSources.length,
      sources: ['unspecified'],
      freshness: freshnessFromTimestamp(observedAt),
      observations: [{
        signal: `commercial: revenue=${revenue ?? '—'} conversions=${conversions ?? '—'} sources=${consolidated.contributingSources.join(',') || '—'}`,
        source: 'unspecified',
        observed_at: observedAt,
      }],
    };

    return { state: 'measured', quantified, measuredRevenue, evidence, reason_unavailable: null };
  }
}

/**
 * Default commercial-source loader: a GUARDED reader over the EXISTING `canonical_revenue_events` table
 * (populated by `crmIngestionService`). Never throws; a missing table / no rows / no created_at → null, so
 * the report honestly stays Not Quantifiable. Deterministic (observation time = latest event time; no clock).
 */
export function createCanonicalRevenueLoader(): CommercialSourceLoader {
  return async ({ companyId }) => {
    if (!companyId) return null;
    try {
      const { data, error } = await supabase
        .from('canonical_revenue_events')
        .select('revenue_amount, conversion_type, created_at')
        .eq('company_id', companyId);
      if (error || !data || data.length === 0) return null;
      const rows = data as Array<{ revenue_amount: number | null; conversion_type: string | null; created_at: string | null }>;
      let revenue = 0;
      let conversions = 0;
      let latest: string | null = null;
      for (const r of rows) {
        const amt = num(r.revenue_amount);
        if (amt != null) revenue += amt;
        conversions += 1; // each recorded revenue event is one measured conversion
        if (r.created_at && (latest == null || r.created_at > latest)) latest = r.created_at;
      }
      if (!latest) return null; // no observation time → cannot present deterministically
      return { sources: [{ source: 'crm_revenue', revenue, conversions }], observedAt: latest };
    } catch {
      return null;
    }
  };
}
