/**
 * Optimization memory & history (append-only, audit-substrate).
 *
 * Captures a compact NBA snapshot on explicit invocation (endpoint or
 * scheduler tick) gated by `shouldCaptureOptimization` (≥6h cooldown — low
 * write amplification). Persists `resource_type='optimization_snapshot'`
 * audit rows; reads back evolution timeline + recommendation lineage.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';
import { buildNextBestActions } from './marketingNbaEngineService';

const MIN_INTERVAL_MS = 6 * 60 * 60_000;

export interface OptimizationSnapshot {
  capturedAt: string;
  totalActions: number;
  criticalActions: number;
  highActions: number;
  topActionIds: string[];
  capabilityNote: string;
}

export async function shouldCaptureOptimization(companyId: string, minIntervalMs = MIN_INTERVAL_MS): Promise<boolean> {
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'optimization_snapshot')
      .order('created_at', { ascending: false })
      .limit(1);
    const last = (data ?? [])[0] as any;
    if (!last?.created_at) return true;
    return Date.now() - Date.parse(last.created_at) >= minIntervalMs;
  } catch {
    return false; // fail-closed
  }
}

export async function captureOptimizationSnapshot(companyId: string): Promise<{ snapshot: OptimizationSnapshot | null }> {
  const nba = await buildNextBestActions(companyId).catch(() => null);
  if (!nba) return { snapshot: null };
  const snapshot: OptimizationSnapshot = {
    capturedAt: new Date().toISOString(),
    totalActions: nba.summary.total,
    criticalActions: nba.summary.critical,
    highActions: nba.summary.high,
    topActionIds: nba.actions.slice(0, 5).map((a) => a.id),
    capabilityNote: nba.capabilityNote,
  };
  await recordComplianceAudit({
    companyId,
    actor: { userId: null, type: 'system', label: 'optimization-memory' },
    action: 'optimization_snapshot.captured',
    resourceType: 'optimization_snapshot',
    resourceId: companyId,
    severity: 'info',
    entityLineage: ['company', 'optimization_snapshot'],
    detail: snapshot as unknown as Record<string, unknown>,
  }).catch(() => undefined);
  return { snapshot };
}

export interface OptimizationHistory {
  companyId: string;
  generatedAt: string;
  snapshots: OptimizationSnapshot[];
  drift: { totalActions: number; criticalActions: number };
}

export async function getOptimizationHistory(companyId: string, limit = 90): Promise<OptimizationHistory> {
  let snapshots: OptimizationSnapshot[] = [];
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('metadata, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'optimization_snapshot')
      .order('created_at', { ascending: true })
      .limit(limit);
    snapshots = ((data ?? []) as any[]).map((r) => ({
      capturedAt: r.created_at,
      totalActions: Number((r.metadata ?? {}).totalActions ?? 0),
      criticalActions: Number((r.metadata ?? {}).criticalActions ?? 0),
      highActions: Number((r.metadata ?? {}).highActions ?? 0),
      topActionIds: Array.isArray((r.metadata ?? {}).topActionIds) ? (r.metadata as any).topActionIds : [],
      capabilityNote: String((r.metadata ?? {}).capabilityNote ?? ''),
    }));
  } catch {
    snapshots = [];
  }
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  return {
    companyId,
    generatedAt: new Date().toISOString(),
    snapshots,
    drift: {
      totalActions: (last?.totalActions ?? 0) - (first?.totalActions ?? 0),
      criticalActions: (last?.criticalActions ?? 0) - (first?.criticalActions ?? 0),
    },
  };
}
