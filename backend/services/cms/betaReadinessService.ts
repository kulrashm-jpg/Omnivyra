/**
 * Beta-readiness validation layer (READ-ONLY).
 *
 * Aggregates already-existing operational signals into one structured report
 * — it does NOT publish, mutate, normalize, or call providers. Safe to run in
 * prod and from an admin endpoint. It reflects the state the prior phases
 * built (canonical connection model, api_discovery persistence, provider
 * registry, degraded-state tracking) rather than introducing new behaviour.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { isCmsProvider, describeCmsProvider } from './registry';
import type { CmsProvider } from './types';
import { buildTrackingDiagnostics } from '../intelligence/trackingDiagnosticsService';
import { buildAttributionDiagnostics } from '../intelligence/attributionDiagnosticsService';
import { buildLeadIngestionDiagnostics } from '../intelligence/leadIngestionDiagnosticsService';

export type ReadinessAxis = 'ready' | 'partial' | 'not_ready';

export type BetaCheckStatus = 'pass' | 'warn' | 'fail' | 'not_applicable';
export type OperationalRisk = 'low' | 'medium' | 'high';

export interface BetaCheck {
  id: string;
  label: string;
  status: BetaCheckStatus;
  detail: string;
  /** Plain-language remediation when not passing. */
  remediation?: string;
}

export interface BetaReadinessReport {
  companyId: string;
  generatedAt: string;
  rolloutRecommendation: 'go' | 'go_with_caution' | 'hold';
  operationalRisk: OperationalRisk;
  checks: BetaCheck[];
  providerCoverage: Array<{
    provider: CmsProvider;
    label: string;
    enabled: boolean;
    connections: number;
    canonicalApiBasePersisted: number;
    degraded: number;
  }>;
  unresolvedBlockers: string[];
  degradedConnectionIds: string[];
  /** Additive 4-axis rollout classification (does not alter the legacy
   * rolloutRecommendation/operationalRisk fields above). */
  readiness?: {
    publishing: ReadinessAxis;
    attribution: ReadinessAxis;
    intelligence: ReadinessAxis;
    enterprise: ReadinessAxis;
    notes: string[];
  };
}

interface IntegrationRow {
  id: string;
  type: string;
  status: string;
  website_connection_id: string | null;
}
interface ConnectionRow {
  id: string;
  provider: string;
  status: string;
  health_status: string | null;
  non_secret_config: Record<string, unknown> | null;
}

function persistedApiBase(c: ConnectionRow): boolean {
  const block = (c.non_secret_config ?? {}) as any;
  return Boolean(block?.api_discovery?.canonical_api_base || block?.canonical_api_base);
}

/**
 * Build the beta-readiness report for one company (multi-tenant scoped — only
 * reads rows for the given companyId / its connections).
 */
export async function buildBetaReadinessReport(companyId: string): Promise<BetaReadinessReport> {
  const checks: BetaCheck[] = [];
  const unresolvedBlockers: string[] = [];
  const degradedConnectionIds: string[] = [];

  const { data: integrationsRaw } = await ownedDbTable('company_integrations')
    .select('id, type, status, website_connection_id')
    .eq('company_id', companyId);
  const integrations = ((integrationsRaw ?? []) as IntegrationRow[]).filter((i) =>
    isCmsProvider(i.type),
  );

  const connectionIds = integrations
    .map((i) => i.website_connection_id)
    .filter((v): v is string => Boolean(v));

  let connections: ConnectionRow[] = [];
  if (connectionIds.length > 0) {
    const { data: connRaw } = await ownedDbTable('website_connections')
      .select('id, provider, status, health_status, non_secret_config')
      .in('id', connectionIds);
    connections = (connRaw ?? []) as ConnectionRow[];
  }

  // 1. Legacy normalization — every CMS integration has a canonical connection.
  const orphanCount = integrations.filter((i) => !i.website_connection_id).length;
  checks.push({
    id: 'canonical_connection',
    label: 'Canonical connection coverage',
    status: integrations.length === 0 ? 'not_applicable' : orphanCount === 0 ? 'pass' : 'fail',
    detail:
      integrations.length === 0
        ? 'No CMS integrations for this company.'
        : `${integrations.length - orphanCount}/${integrations.length} integrations linked to a website_connection.`,
    remediation: orphanCount > 0 ? 'Run POST /api/integrations/normalize for this company.' : undefined,
  });
  if (orphanCount > 0) unresolvedBlockers.push(`${orphanCount} orphan CMS integration(s) without a canonical connection`);

  // 2. Canonical API base persisted (no runtime-only degraded path).
  const withBase = connections.filter(persistedApiBase).length;
  checks.push({
    id: 'api_base_persisted',
    label: 'Canonical API base persistence',
    status:
      connections.length === 0 ? 'not_applicable' : withBase === connections.length ? 'pass' : 'warn',
    detail: `${withBase}/${connections.length} connections have a persisted canonical API base.`,
    remediation:
      withBase < connections.length
        ? 'Re-run validation (Test / Re-detect API) or the normalization job to persist discovery.'
        : undefined,
  });

  // 3. Degraded-state tracking.
  for (const c of connections) {
    if (c.health_status === 'degraded' || c.health_status === 'failed') {
      degradedConnectionIds.push(c.id);
    }
  }
  checks.push({
    id: 'degraded_connections',
    label: 'Connection health',
    status:
      connections.length === 0
        ? 'not_applicable'
        : degradedConnectionIds.length === 0
          ? 'pass'
          : 'warn',
    detail: `${degradedConnectionIds.length} degraded/failed connection(s).`,
    remediation:
      degradedConnectionIds.length > 0
        ? 'Open Integrations → Test the affected connection and follow the diagnostics remediation.'
        : undefined,
  });

  // 4. Connected (validated) integrations.
  const connectedCount = integrations.filter((i) => i.status === 'connected').length;
  checks.push({
    id: 'connectivity',
    label: 'Provider connectivity',
    status:
      integrations.length === 0 ? 'not_applicable' : connectedCount > 0 ? 'pass' : 'warn',
    detail: `${connectedCount}/${integrations.length} CMS integrations in 'connected' state.`,
    remediation:
      integrations.length > 0 && connectedCount === 0
        ? 'Validate at least one website connection before beta.'
        : undefined,
  });

  // Provider coverage matrix.
  const providerCoverage = (
    ['wordpress', 'custom_blog_api', 'ghost', 'drupal', 'joomla', 'webflow', 'shopify', 'hubspot', 'wix', 'squarespace'] as CmsProvider[]
  ).map((provider) => {
    const desc = describeCmsProvider(provider);
    const conns = connections.filter((c) => c.provider === provider);
    return {
      provider,
      label: desc.label,
      enabled: desc.enabled,
      connections: conns.length,
      canonicalApiBasePersisted: conns.filter(persistedApiBase).length,
      degraded: conns.filter((c) => c.health_status === 'degraded' || c.health_status === 'failed').length,
    };
  });

  // ── Intelligence-layer expansion (additive, read-only, never 'fail' so the
  //    legacy rolloutRecommendation semantics cannot regress for existing
  //    companies — the 4-axis `readiness` carries the honest assessment).
  const readinessNotes: string[] = [];
  let attributionAxis: ReadinessAxis = 'not_ready';
  let intelligenceAxis: ReadinessAxis = 'not_ready';
  try {
    const [tracking, attribution, ingestion] = await Promise.all([
      buildTrackingDiagnostics(companyId),
      buildAttributionDiagnostics(companyId),
      buildLeadIngestionDiagnostics(companyId),
    ]);

    checks.push({
      id: 'tracking_integrity',
      label: 'Tracking integrity',
      status: tracking.overall === 'healthy' ? 'pass' : tracking.overall === 'no_data' ? 'not_applicable' : 'warn',
      detail: `Tracker overall: ${tracking.overall}; ingestion lag ${tracking.ingestionLagSeconds ?? 'n/a'}s.`,
      remediation: tracking.remediation[0],
    });
    checks.push({
      id: 'attribution_integrity',
      label: 'Attribution integrity',
      status: attribution.leads === 0 ? 'not_applicable' : attribution.attributionConfidence >= 70 ? 'pass' : 'warn',
      detail: `Attribution confidence ${attribution.attributionConfidence}% (${attribution.leadsWithAttribution}/${attribution.leads} leads).`,
      remediation: attribution.remediation[0],
    });
    checks.push({
      id: 'lead_ingestion_integrity',
      label: 'Lead ingestion integrity',
      status:
        ingestion.formSubmitEvents === 0 && ingestion.leadsCreated === 0
          ? 'not_applicable'
          : ingestion.deliveryConfidence >= 70
            ? 'pass'
            : 'warn',
      detail: `Delivery confidence ${ingestion.deliveryConfidence}%; ${ingestion.suspectedIngestionLoss} suspected losses.`,
      remediation: ingestion.remediation[0],
    });
    checks.push({
      id: 'observability_readiness',
      label: 'Observability readiness',
      status: 'pass',
      detail: 'Tracker / attribution / ingestion diagnostics endpoints available (read-only).',
    });

    const attrOk = attribution.leads === 0 ? false : attribution.attributionConfidence >= 70;
    const attrPartial = attribution.leads > 0 && attribution.attributionConfidence >= 40;
    attributionAxis = attrOk ? 'ready' : attrPartial ? 'partial' : 'not_ready';

    const trkOk = tracking.overall === 'healthy';
    const ingOk = ingestion.deliveryConfidence >= 70;
    intelligenceAxis = trkOk && ingOk ? 'ready' : trkOk || ingOk ? 'partial' : 'not_ready';

    readinessNotes.push(
      `tracking=${tracking.overall}`,
      `attributionConfidence=${attribution.attributionConfidence}%`,
      `ingestionConfidence=${ingestion.deliveryConfidence}%`,
    );
  } catch {
    readinessNotes.push('intelligence diagnostics unavailable (tables empty or unreachable)');
  }

  const failCount = checks.filter((c) => c.status === 'fail').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const operationalRisk: OperationalRisk = failCount > 0 ? 'high' : warnCount > 0 ? 'medium' : 'low';
  const rolloutRecommendation =
    failCount > 0 ? 'hold' : warnCount > 0 ? 'go_with_caution' : 'go';

  const publishingAxis: ReadinessAxis =
    failCount > 0 ? 'not_ready' : connectedCount > 0 ? 'ready' : integrations.length > 0 ? 'partial' : 'not_ready';

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    rolloutRecommendation,
    operationalRisk,
    checks,
    providerCoverage,
    unresolvedBlockers,
    degradedConnectionIds,
    readiness: {
      publishing: publishingAxis,
      attribution: attributionAxis,
      intelligence: intelligenceAxis,
      // Enterprise hardening (OAuth token lifecycle, webhook signature
      // verification, permission-drift) is NOT implemented — reported honestly.
      enterprise: 'not_ready',
      notes: readinessNotes,
    },
  };
}
