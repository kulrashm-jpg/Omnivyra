/**
 * Persistent adaptive optimization evolution history.
 *
 * Captures a compact adaptive snapshot (overall effectiveness, per-category
 * scores, governed weights, decay) at most once per cooldown window. Persists
 * append-only via the existing audit substrate (`resource_type='adaptive_snapshot'`)
 * — no schema dependency. Reads back form a continuous evolution timeline.
 *
 * Low write amplification by construction: snapshots only on explicit
 * invocation OR scheduler tick guarded by `shouldCaptureAdaptive`.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';
import { buildEffectivenessReport } from './recommendationEffectivenessService';

export interface AdaptiveSnapshot {
  capturedAt: string;
  overallEffectiveness: number;
  acceptanceRate: number;
  byCategory: Record<string, number>; // category → effectivenessScore
  governedWeights: Record<string, number>;
  decayWeightedAcceptance: number;
}

const MIN_INTERVAL_MS = 6 * 60 * 60_000;

export async function shouldCaptureAdaptive(
  companyId: string,
  minIntervalMs = MIN_INTERVAL_MS,
): Promise<boolean> {
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'adaptive_snapshot')
      .order('created_at', { ascending: false })
      .limit(1);
    const last = (data ?? [])[0] as any;
    if (!last?.created_at) return true;
    return Date.now() - Date.parse(last.created_at) >= minIntervalMs;
  } catch {
    return false; // fail-closed
  }
}

export async function captureAdaptiveSnapshot(companyId: string): Promise<{ snapshot: AdaptiveSnapshot | null }> {
  const eff = await buildEffectivenessReport(companyId).catch(() => null);
  if (!eff?.available) return { snapshot: null };
  const snapshot: AdaptiveSnapshot = {
    capturedAt: new Date().toISOString(),
    overallEffectiveness: eff.overallEffectiveness,
    acceptanceRate: 0, // derived from feedback aggregate via decayWeightedAcceptance below
    byCategory: ((): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const c of eff.byCategory) out[c.category] = c.effectivenessScore;
      return out;
    })(),
    governedWeights: eff.volatilityGovernor?.governedCategoryWeights ?? {},
    decayWeightedAcceptance: eff.decay?.decayWeightedAcceptance ?? 0,
  };
  await recordComplianceAudit({
    companyId,
    actor: { userId: null, type: 'system', label: 'adaptive-history' },
    action: 'adaptive_snapshot.captured',
    resourceType: 'adaptive_snapshot',
    resourceId: companyId,
    severity: 'info',
    entityLineage: ['company', 'adaptive_snapshot'],
    detail: snapshot as unknown as Record<string, unknown>,
  }).catch(() => undefined);
  return { snapshot };
}

export interface AdaptiveEvolution {
  companyId: string;
  generatedAt: string;
  snapshots: AdaptiveSnapshot[];
  driftEffectiveness: number;
  trend: 'improving' | 'declining' | 'flat' | 'insufficient';
  /** Volatility = std-dev of overallEffectiveness across snapshots. */
  volatility: number;
}

export async function getAdaptiveEvolution(
  companyId: string,
  limit = 90,
): Promise<AdaptiveEvolution> {
  let snapshots: AdaptiveSnapshot[] = [];
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('metadata, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'adaptive_snapshot')
      .order('created_at', { ascending: true })
      .limit(limit);
    snapshots = ((data ?? []) as any[]).map((r) => ({
      capturedAt: r.created_at,
      overallEffectiveness: Number((r.metadata ?? {}).overallEffectiveness ?? 0),
      acceptanceRate: Number((r.metadata ?? {}).acceptanceRate ?? 0),
      byCategory: (r.metadata ?? {}).byCategory ?? {},
      governedWeights: (r.metadata ?? {}).governedWeights ?? {},
      decayWeightedAcceptance: Number((r.metadata ?? {}).decayWeightedAcceptance ?? 0),
    }));
  } catch {
    snapshots = [];
  }
  const first = snapshots[0]?.overallEffectiveness ?? 0;
  const last = snapshots[snapshots.length - 1]?.overallEffectiveness ?? 0;
  const drift = last - first;
  const trend: AdaptiveEvolution['trend'] =
    snapshots.length < 2 ? 'insufficient' : drift > 3 ? 'improving' : drift < -3 ? 'declining' : 'flat';
  const mean = snapshots.reduce((a, s) => a + s.overallEffectiveness, 0) / Math.max(1, snapshots.length);
  const variance = snapshots.reduce((a, s) => a + (s.overallEffectiveness - mean) ** 2, 0) / Math.max(1, snapshots.length);
  return {
    companyId,
    generatedAt: new Date().toISOString(),
    snapshots,
    driftEffectiveness: drift,
    trend,
    volatility: Number(Math.sqrt(variance).toFixed(2)),
  };
}
