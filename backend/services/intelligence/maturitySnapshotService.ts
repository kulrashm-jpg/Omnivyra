/**
 * Operational maturity history (append-only, low write amplification).
 *
 * Captures a maturity snapshot ONLY on explicit invocation (endpoint/scheduled
 * job) — never per request. Persists to `maturity_snapshots` WHEN PRESENT,
 * else appends a `maturity_snapshot` audit_events row (fallback). Trend/drift
 * is computed read-only from the snapshot history. No mutation of existing
 * systems, tenant-safe, export-safe.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';
import { buildEnterpriseReadinessReport } from './enterpriseReadinessService';

let probe: boolean | null = null;
async function hasTable(): Promise<boolean> {
  if (probe !== null) return probe;
  try {
    const { error } = await ownedDbTable('maturity_snapshots')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    probe = !error;
  } catch {
    probe = false;
  }
  return probe;
}

export interface MaturitySnapshot {
  capturedAt: string;
  maturityScore: number;
  grades: Record<string, unknown>;
}

export async function captureMaturitySnapshot(
  companyId: string,
): Promise<{ stored: 'table' | 'audit'; snapshot: MaturitySnapshot }> {
  const readiness = await buildEnterpriseReadinessReport(companyId).catch(() => null);
  const snapshot: MaturitySnapshot = {
    capturedAt: new Date().toISOString(),
    maturityScore: readiness?.operationalMaturityScore ?? 0,
    grades: (readiness as any)?.grades ?? {},
  };

  if (await hasTable()) {
    await ownedDbTable('maturity_snapshots')
      .insert({
        company_id: companyId,
        maturity_score: snapshot.maturityScore,
        grades: snapshot.grades,
        signals: (readiness as any)?.signals ?? {},
      })
      .then(() => undefined, () => undefined);
    return { stored: 'table', snapshot };
  }
  await recordComplianceAudit({
    companyId,
    actor: { userId: null, type: 'system', label: 'maturity-snapshot' },
    action: 'maturity_snapshot.captured',
    resourceType: 'maturity_snapshot',
    resourceId: companyId,
    severity: 'info',
    entityLineage: ['company', 'maturity_snapshot'],
    detail: { maturityScore: snapshot.maturityScore, grades: snapshot.grades },
  }).catch(() => undefined);
  return { stored: 'audit', snapshot };
}

/**
 * Cooldown guard for continuous capture: true only if the newest snapshot is
 * older than minIntervalMs. Prevents per-tick / per-request amplification.
 */
export async function shouldCaptureSnapshot(
  companyId: string,
  minIntervalMs = 6 * 60 * 60_000,
): Promise<boolean> {
  try {
    if (await hasTable()) {
      const { data } = await ownedDbTable('maturity_snapshots')
        .select('captured_at')
        .eq('company_id', companyId)
        .order('captured_at', { ascending: false })
        .limit(1);
      const last = (data ?? [])[0] as any;
      if (!last?.captured_at) return true;
      return Date.now() - Date.parse(last.captured_at) >= minIntervalMs;
    }
    const { data } = await ownedDbTable('audit_events')
      .select('created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'maturity_snapshot')
      .order('created_at', { ascending: false })
      .limit(1);
    const last = (data ?? [])[0] as any;
    if (!last?.created_at) return true;
    return Date.now() - Date.parse(last.created_at) >= minIntervalMs;
  } catch {
    return false; // fail-closed: never amplify on error
  }
}

export interface MaturityHistory {
  companyId: string;
  generatedAt: string;
  source: 'table' | 'audit' | 'none';
  snapshots: MaturitySnapshot[];
  trend: 'improving' | 'declining' | 'flat' | 'insufficient';
  drift: number; // newest - oldest
}

export async function getMaturityHistory(
  companyId: string,
  limit = 90,
): Promise<MaturityHistory> {
  let snapshots: MaturitySnapshot[] = [];
  let source: MaturityHistory['source'] = 'none';

  try {
    if (await hasTable()) {
      const { data } = await ownedDbTable('maturity_snapshots')
        .select('maturity_score, grades, captured_at')
        .eq('company_id', companyId)
        .order('captured_at', { ascending: true })
        .limit(limit);
      snapshots = ((data ?? []) as any[]).map((r) => ({
        capturedAt: r.captured_at,
        maturityScore: Number(r.maturity_score ?? 0),
        grades: r.grades ?? {},
      }));
      if (snapshots.length) source = 'table';
    }
    if (snapshots.length === 0) {
      const { data } = await ownedDbTable('audit_events')
        .select('metadata, created_at')
        .eq('company_id', companyId)
        .eq('resource_type', 'maturity_snapshot')
        .order('created_at', { ascending: true })
        .limit(limit);
      snapshots = ((data ?? []) as any[]).map((r) => ({
        capturedAt: r.created_at,
        maturityScore: Number((r.metadata ?? {}).maturityScore ?? 0),
        grades: (r.metadata ?? {}).grades ?? {},
      }));
      if (snapshots.length) source = 'audit';
    }
  } catch {
    snapshots = [];
  }

  const first = snapshots[0]?.maturityScore ?? 0;
  const last = snapshots[snapshots.length - 1]?.maturityScore ?? 0;
  const drift = last - first;
  const trend: MaturityHistory['trend'] =
    snapshots.length < 2 ? 'insufficient' : drift > 3 ? 'improving' : drift < -3 ? 'declining' : 'flat';

  return { companyId, generatedAt: new Date().toISOString(), source, snapshots, trend, drift };
}
