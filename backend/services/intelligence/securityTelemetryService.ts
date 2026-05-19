/**
 * Security telemetry & trust scoring — REAL SIGNALS ONLY (READ-ONLY analysis).
 *
 * Every signal derives from real telemetry already in the system:
 *   - audit_events (ops actions, replay_job volume, dead_letter volume,
 *     oauth_refresh attempts, compliance failures)
 *   - website_connections (health_status, last_error)
 * No fabricated scores. When an anomaly threshold is crossed it emits an
 * append-only `security_event` via the existing compliance audit (no new
 * table). It does NOT auto-rotate credentials or auto-mutate integrations
 * (unsafe) — it produces advisories + an optional caller-driven remediation
 * hook. Honest: credential rotation itself is still not implemented.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';

export interface ConnectionTrust {
  connectionId: string;
  provider: string;
  trustScore: number; // 0..100 (100 = fully trusted)
  signals: string[];
  healthStatus: string | null;
}

export interface SecurityTelemetryReport {
  companyId: string;
  generatedAt: string;
  windowHours: number;
  authFailureEvents: number;
  replayVolume: number;
  deadLetterVolume: number;
  replayAbuseSuspected: boolean;
  connections: ConnectionTrust[];
  anomalies: Array<{ kind: string; severity: 'low' | 'medium' | 'high'; detail: string }>;
  advisories: string[];
  capabilityNote: string;
}

const WINDOW_H = 24;
const REPLAY_ABUSE_THRESHOLD = 25; // replay_job rows / company / window

async function countAudit(companyId: string, sinceIso: string, opts: { resourceType?: string; actionLike?: string }): Promise<number> {
  try {
    let q = ownedDbTable('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('created_at', sinceIso);
    if (opts.resourceType) q = q.eq('resource_type', opts.resourceType);
    if (opts.actionLike) q = q.like('action', opts.actionLike);
    const { count, error } = await q;
    return !error && typeof count === 'number' ? count : 0;
  } catch {
    return 0;
  }
}

export async function buildSecurityTelemetry(companyId: string): Promise<SecurityTelemetryReport> {
  const sinceIso = new Date(Date.now() - WINDOW_H * 3600_000).toISOString();
  const anomalies: SecurityTelemetryReport['anomalies'] = [];
  const advisories: string[] = [];

  const replayVolume = await countAudit(companyId, sinceIso, { resourceType: 'replay_job' });
  const deadLetterVolume = await countAudit(companyId, sinceIso, { resourceType: 'dead_letter' });
  // Compliance audit rows whose action denotes a failure/auth issue.
  const authFailureEvents =
    (await countAudit(companyId, sinceIso, { actionLike: '%fail%' })) +
    (await countAudit(companyId, sinceIso, { actionLike: 'oauth_refresh.%' }));

  const replayAbuseSuspected = replayVolume > REPLAY_ABUSE_THRESHOLD;
  if (replayAbuseSuspected) {
    anomalies.push({ kind: 'replay_abuse', severity: 'high', detail: `${replayVolume} replay jobs in ${WINDOW_H}h (> ${REPLAY_ABUSE_THRESHOLD}).` });
    advisories.push('Investigate the replay source — possible loop or abuse; replays are lock-throttled but volume is abnormal.');
  }
  if (deadLetterVolume > 0) {
    advisories.push(`${deadLetterVolume} dead-letter records in window — review the Replay & Recovery console.`);
  }

  // Per-connection trust from REAL connection telemetry.
  const connections: ConnectionTrust[] = [];
  try {
    const { data: ints } = await ownedDbTable('company_integrations')
      .select('website_connection_id')
      .eq('company_id', companyId);
    const ids = ((ints ?? []) as Array<{ website_connection_id: string | null }>)
      .map((i) => i.website_connection_id)
      .filter((v): v is string => Boolean(v));
    if (ids.length > 0) {
      const { data } = await ownedDbTable('website_connections')
        .select('id, provider, health_status, last_error')
        .in('id', ids);
      for (const c of (data ?? []) as any[]) {
        const signals: string[] = [];
        let score = 100;
        if (c.health_status === 'failed') { score -= 50; signals.push('connection health failed'); }
        else if (c.health_status === 'degraded') { score -= 25; signals.push('connection degraded'); }
        if (/401|403|unauthor|invalid_grant|expired|token/i.test(String(c.last_error ?? ''))) {
          score -= 30; signals.push('auth-related last_error');
        }
        if (replayAbuseSuspected) { score -= 10; signals.push('elevated replay volume for tenant'); }
        score = Math.max(0, Math.min(100, score));
        if (score < 50) {
          anomalies.push({ kind: 'low_trust_connection', severity: score < 30 ? 'high' : 'medium', detail: `connection ${c.id} trust ${score}` });
        }
        connections.push({ connectionId: c.id, provider: c.provider, trustScore: score, signals, healthStatus: c.health_status });
      }
    }
  } catch {
    /* connection telemetry unavailable → report what we have */
  }

  // Emit an append-only security_event when something material was found.
  if (anomalies.some((a) => a.severity === 'high')) {
    await recordComplianceAudit({
      companyId,
      actor: { userId: null, type: 'system', label: 'security-telemetry' },
      action: 'security_event.anomaly_detected',
      resourceType: 'security_event',
      resourceId: companyId,
      severity: 'critical',
      entityLineage: ['company', 'security_event'],
      detail: { anomalies },
    }).catch(() => undefined);
  }

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    windowHours: WINDOW_H,
    authFailureEvents,
    replayVolume,
    deadLetterVolume,
    replayAbuseSuspected,
    connections,
    anomalies,
    advisories,
    capabilityNote:
      'Trust/anomaly signals are derived from real audit + connection telemetry. Automated credential rotation and automated permission-drift remediation are NOT implemented — advisories only.',
  };
}
