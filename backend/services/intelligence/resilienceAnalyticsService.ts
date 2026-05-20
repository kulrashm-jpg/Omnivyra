/**
 * Deeper resilience analytics — DETERMINISTIC, READ-ONLY.
 *
 * Computes volatility/stability metrics over the existing append-only
 * telemetry (maturity snapshots, worker escalation events, replay outcomes).
 * Pure analysis — no mutation, no schema. Confidence is sample-size based.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { getMaturityHistory } from './maturitySnapshotService';
import { getAdaptiveEvolution } from './adaptiveHistoryService';

export interface ResilienceAnalyticsReport {
  companyId: string;
  generatedAt: string;
  resilience: {
    score: number;       // current maturity score
    volatility: number;  // std-dev of maturity history
    drift: number;
    samples: number;
  };
  orchestrationStability: {
    escalations7d: number;
    escalationsPrev7d: number;
    drift: 'up' | 'down' | 'flat';
  };
  replayIntegrity: {
    succeeded7d: number;
    failed7d: number;
    quarantine7d: number;
    failureRate: number; // 0..1
  };
  adaptiveOptimization: {
    overallEffectiveness: number;
    trend: string;
    volatility: number;
  };
  confidence: number; // 0..100 (sample-size)
  capabilityNote: string;
}

async function countAudit(companyId: string, type: string, sinceIso: string): Promise<number> {
  try {
    const { count } = await ownedDbTable('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('resource_type', type)
      .gte('created_at', sinceIso);
    return typeof count === 'number' ? count : 0;
  } catch { return 0; }
}

async function countAuditAction(companyId: string, actionLike: string, sinceIso: string): Promise<number> {
  try {
    const { count } = await ownedDbTable('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .like('action', actionLike)
      .gte('created_at', sinceIso);
    return typeof count === 'number' ? count : 0;
  } catch { return 0; }
}

export async function buildResilienceAnalytics(companyId: string): Promise<ResilienceAnalyticsReport> {
  const [maturity, adaptive] = await Promise.all([
    getMaturityHistory(companyId).catch(() => null),
    getAdaptiveEvolution(companyId).catch(() => null),
  ]);
  const scores = (maturity?.snapshots ?? []).map((s) => s.maturityScore);
  const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, scores.length);
  const resilience = {
    score: scores[scores.length - 1] ?? 0,
    volatility: Number(Math.sqrt(variance).toFixed(2)),
    drift: maturity?.drift ?? 0,
    samples: scores.length,
  };

  const now = Date.now();
  const d7 = new Date(now - 7 * 86_400_000).toISOString();
  const d14 = new Date(now - 14 * 86_400_000).toISOString();
  const escalations7d = await countAudit(companyId, 'worker_escalation', d7);
  const escalations14d = await countAudit(companyId, 'worker_escalation', d14);
  const orchestrationStability = {
    escalations7d,
    escalationsPrev7d: Math.max(0, escalations14d - escalations7d),
    drift: ((): 'up' | 'down' | 'flat' => {
      const prev = Math.max(0, escalations14d - escalations7d);
      return escalations7d > prev ? 'up' : escalations7d < prev ? 'down' : 'flat';
    })(),
  };

  const succeeded7d = await countAuditAction(companyId, 'replay_executed.%', d7);
  const failed7d =
    (await countAuditAction(companyId, 'replay_ingress.failed', d7)) +
    (await countAuditAction(companyId, 'replay_executor.failed', d7));
  const quarantine7d = await countAudit(companyId, 'quarantine_payload', d7);
  const total7d = succeeded7d + failed7d;
  const replayIntegrity = {
    succeeded7d,
    failed7d,
    quarantine7d,
    failureRate: total7d > 0 ? Number((failed7d / total7d).toFixed(3)) : 0,
  };

  const adaptiveOptimization = {
    overallEffectiveness: adaptive?.snapshots[adaptive.snapshots.length - 1]?.overallEffectiveness ?? 0,
    trend: adaptive?.trend ?? 'insufficient',
    volatility: adaptive?.volatility ?? 0,
  };

  const confidence = Math.max(
    0,
    Math.min(100, Math.round((1 - Math.exp(-(scores.length + (adaptive?.snapshots.length ?? 0)) / 10)) * 100)),
  );

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    resilience,
    orchestrationStability,
    replayIntegrity,
    adaptiveOptimization,
    confidence,
    capabilityNote:
      'Deterministic statistics over real append-only telemetry. No ML/learned model; confidence is sample-size only.',
  };
}
