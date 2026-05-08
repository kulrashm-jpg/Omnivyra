// Canonical API surface.
//
// Single typed entrypoint for every Phase 7 capability. Next.js / Express /
// any framework wires this into HTTP handlers — the API layer itself is
// transport-agnostic. Every operation is tenant-aware and audit-integrated.
//
// All payloads are canonical.* only. No legacy report shapes are exposed.

import type { CanonicalReport, PillarKey } from '../canonicalReport/canonicalReportTypes';
import type { TenantContext } from './tenantGovernance';
import { loadTenantPolicy } from './tenantGovernance';
import { logAuditEvent } from './auditLog';
import {
  addAnnotation,
  resolveAnnotation,
  assignAction,
  pinFinding,
  getCollaborationStore,
} from './collaboration';
import {
  createOverride,
  reverseOverride,
  loadActiveOverrides,
  type OverrideKind,
  type OverrideRecord,
} from './manualOverrides';
import { enqueueScan, cancelScan, getScanQueueStore, type ScanQueueRecord } from './scanOrchestration';
import type { ScanProfile } from './snapshotWriter';
import { buildCanonicalExport, type CanonicalExportPayload, type ExportShape } from './canonicalExport';
import { buildPlatformOperationsView, type PlatformOperationsView } from './platformOperationsAggregator';
import type { ComparisonView } from './comparisonEngine';
import { buildComparisonView } from './comparisonEngine';
import type { Explanation } from './explainabilityEngine';
import { buildExplanationIndex } from './explainabilityEngine';
import { getHistoricalStore } from './historicalPersistence';

// ── Authorization helpers ─────────────────────────────────────────────────────

export class AuthorizationError extends Error {
  constructor(public readonly code: 'tenant_mismatch' | 'profile_not_allowed' | 'provider_not_allowed' | 'forbidden') {
    super(code);
    this.name = 'AuthorizationError';
  }
}

async function assertScanProfileAllowed(tenantContext: TenantContext, profile: ScanProfile): Promise<void> {
  const policy = await loadTenantPolicy(tenantContext.tenant_id);
  if (!policy.scan_budget.allowed_profiles.includes(profile)) {
    throw new AuthorizationError('profile_not_allowed');
  }
}

// ── Report generation / retrieval ─────────────────────────────────────────────

export type GenerateReportInput = {
  tenantContext: TenantContext;
  companyId: string;
  scanProfile: ScanProfile;
  /** Optional eager-mode runner that returns a CanonicalReport directly. */
  runner: (params: {
    tenantContext: TenantContext;
    companyId: string;
    scanProfile: ScanProfile;
  }) => Promise<CanonicalReport>;
};

export async function generateReport(input: GenerateReportInput): Promise<CanonicalReport> {
  await assertScanProfileAllowed(input.tenantContext, input.scanProfile);
  const report = await input.runner({
    tenantContext: input.tenantContext,
    companyId: input.companyId,
    scanProfile: input.scanProfile,
  });
  return report;
}

// ── Evidence & comparison retrieval ───────────────────────────────────────────

export async function getReportEvidence(params: {
  tenantContext: TenantContext;
  companyId: string;
  scope: { kind: 'overall' } | { kind: 'pillar'; pillar: PillarKey } | { kind: 'dimension'; dimension_key: string };
}): Promise<{ count: number; sources: string[]; observations: Array<{ signal: string; source: string; observed_at: string | null }> }> {
  const store = getHistoricalStore();
  const rows = await store.loadEvidenceHistory({
    company_id: params.companyId,
    limit: 500,
  });
  const matching = rows.filter((r) => {
    if (r.scope.kind !== params.scope.kind) return false;
    if (params.scope.kind === 'pillar' && r.scope.kind === 'pillar') return r.scope.pillar === params.scope.pillar;
    if (params.scope.kind === 'dimension' && r.scope.kind === 'dimension') return r.scope.dimension_key === params.scope.dimension_key;
    return true;
  });
  const totalCount = matching.reduce((sum, r) => sum + r.evidence_count, 0);
  const sources = new Set<string>();
  const observations: Array<{ signal: string; source: string; observed_at: string | null }> = [];
  for (const row of matching) {
    for (const s of row.evidence_sources) sources.add(s);
    for (const signal of row.signal_summary) {
      observations.push({ signal, source: row.evidence_sources[0] ?? 'unspecified', observed_at: row.observed_at });
    }
  }
  return { count: totalCount, sources: [...sources], observations };
}

export async function getComparisonView(params: {
  tenantContext: TenantContext;
  companyId: string;
  current: CanonicalReport;
}): Promise<ComparisonView> {
  return buildComparisonView({ companyId: params.companyId, current: params.current });
}

export function getExplanationsForReport(report: CanonicalReport): {
  authority_overall: Explanation;
  pillars: Array<{ pillar: PillarKey; explanation: Explanation }>;
  dimensions: Array<{ key: string; explanation: Explanation }>;
  recommendations: Array<{ id: string; explanation: Explanation }>;
  maturity_stage: Explanation;
  forecast: Explanation;
  benchmark: Explanation;
  change: Explanation;
} {
  return buildExplanationIndex(report);
}

// ── Export generation ─────────────────────────────────────────────────────────

export async function generateExport(params: {
  tenantContext: TenantContext;
  companyId: string;
  report: CanonicalReport;
  shape: ExportShape;
  comparison?: ComparisonView;
}): Promise<CanonicalExportPayload> {
  const payload = buildCanonicalExport({
    shape: params.shape,
    tenantId: params.tenantContext.tenant_id,
    companyId: params.companyId,
    report: params.report,
    comparison: params.comparison,
  });
  await logAuditEvent({
    tenantContext: params.tenantContext,
    kind: 'collaboration_event',
    payload: { kind: 'export_generated', shape: params.shape, company_id: params.companyId },
  });
  return payload;
}

// ── Collaboration ─────────────────────────────────────────────────────────────

export const collaborationApi = {
  addAnnotation,
  resolveAnnotation,
  assignAction,
  pinFinding,
  list: async (tenantContext: TenantContext, companyId: string) => {
    const store = getCollaborationStore();
    const [annotations, assignments, pinned, statuses] = await Promise.all([
      store.listAnnotations(tenantContext.tenant_id, companyId),
      store.listAssignments(tenantContext.tenant_id, companyId),
      store.listPinnedFindings(tenantContext.tenant_id, companyId),
      store.listRecommendationStatuses(tenantContext.tenant_id, companyId),
    ]);
    return { annotations, assignments, pinned_findings: pinned, recommendation_statuses: statuses };
  },
};

// ── Scan orchestration ────────────────────────────────────────────────────────

export const scanApi = {
  enqueue: async (params: {
    tenantContext: TenantContext;
    companyId: string;
    scanProfile: ScanProfile;
    origin: ScanQueueRecord['origin'];
    priority?: number;
    scopedProviders?: string[];
  }): Promise<ScanQueueRecord> => {
    await assertScanProfileAllowed(params.tenantContext, params.scanProfile);
    return enqueueScan(params);
  },
  cancel: cancelScan,
  list: async (tenantContext: TenantContext, companyId?: string): Promise<ScanQueueRecord[]> => {
    return getScanQueueStore().list({ tenantId: tenantContext.tenant_id, companyId, limit: 200 });
  },
};

// ── Override operations ───────────────────────────────────────────────────────

export const overrideApi = {
  list: loadActiveOverrides,
  create: async (params: {
    tenantContext: TenantContext;
    companyId: string;
    kind: OverrideKind;
    target: OverrideRecord['target'];
    reason: string;
  }): Promise<OverrideRecord> => createOverride(params),
  reverse: async (params: {
    tenantContext: TenantContext;
    companyId: string;
    overrideId: string;
  }): Promise<OverrideRecord | null> => reverseOverride(params),
};

// ── Admin / observability ─────────────────────────────────────────────────────

export const adminApi = {
  platformOperations: async (params: { windowHours?: number; tenantIds: string[] }): Promise<PlatformOperationsView> =>
    buildPlatformOperationsView(params),
};
