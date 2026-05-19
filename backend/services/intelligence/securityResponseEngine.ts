/**
 * Automated security response engine — SAFETY-GATED, append-only.
 *
 * Consumes the real signals from securityTelemetryService and orchestrates
 * remediations. NON-DESTRUCTIVE by default (advisories + telemetry). Any
 * state-changing action (integration quarantine) requires an explicit
 * `allowDestructive` operator gate AND is reversible. Every action is recorded
 * append-only as a security incident with lineage. No credential rotation is
 * auto-executed (no rotation infra) — it is advised, not performed.
 */
import { updateWebsiteConnection } from '../websiteService';
import { recordComplianceAudit } from '../audit/complianceAuditService';
import { buildSecurityTelemetry } from './securityTelemetryService';

export interface RemediationAction {
  kind: 'advisory' | 'quarantine_connection' | 'throttle_replay';
  target: string;
  applied: boolean;
  reversible: boolean;
  detail: string;
}

export interface SecurityResponseResult {
  companyId: string;
  generatedAt: string;
  mode: 'dry_run' | 'enforced';
  incidentId: string;
  anomalies: number;
  actions: RemediationAction[];
  /** Escalation chain (additive — does not alter existing fields). */
  escalationLevel?: 0 | 1 | 2 | 3;
  escalationLabel?: 'none' | 'advisory' | 'throttle' | 'quarantine_proposed' | 'quarantine_enforced';
  incidentLifecycle?: 'opened' | 'mitigated' | 'escalated' | 'resolved';
  capabilityNote: string;
}

export async function runSecurityResponse(args: {
  companyId: string;
  actorUserId?: string | null;
  /** Operator gate — without this, destructive actions are only proposed. */
  allowDestructive?: boolean;
}): Promise<SecurityResponseResult> {
  const { companyId, actorUserId } = args;
  const allowDestructive = args.allowDestructive === true;
  const telemetry = await buildSecurityTelemetry(companyId);
  const actions: RemediationAction[] = [];

  // Advisory is always emitted (non-destructive).
  for (const a of telemetry.anomalies) {
    actions.push({
      kind: 'advisory',
      target: a.kind,
      applied: true,
      reversible: true,
      detail: `[${a.severity}] ${a.detail}`,
    });
  }

  // Replay-abuse → throttle signal (non-destructive; the atomic replay lock
  // already rate-limits — this records intent + advisory, no forced stop).
  if (telemetry.replayAbuseSuspected) {
    actions.push({
      kind: 'throttle_replay',
      target: 'replay',
      applied: true,
      reversible: true,
      detail: 'Replay volume abnormal — replays remain lock-throttled; investigate source.',
    });
  }

  // Destructive: quarantine very-low-trust connections — GATED + reversible.
  const lowTrust = telemetry.connections.filter((c) => c.trustScore < 30);
  for (const c of lowTrust) {
    if (allowDestructive) {
      try {
        await updateWebsiteConnection(c.connectionId, {
          status: 'disabled',
          health_status: 'failed',
          last_error: 'quarantined by security response (low trust) — operator can re-enable',
        });
        actions.push({ kind: 'quarantine_connection', target: c.connectionId, applied: true, reversible: true, detail: `trust ${c.trustScore} → disabled (reversible)` });
      } catch (err) {
        actions.push({ kind: 'quarantine_connection', target: c.connectionId, applied: false, reversible: true, detail: `quarantine failed: ${err instanceof Error ? err.message : 'error'}` });
      }
    } else {
      actions.push({ kind: 'quarantine_connection', target: c.connectionId, applied: false, reversible: true, detail: `trust ${c.trustScore} — quarantine PROPOSED (set allowDestructive to enforce)` });
    }
  }

  const { correlationId } = await recordComplianceAudit({
    companyId,
    actor: { userId: actorUserId ?? null, type: actorUserId ? 'user' : 'system', label: 'security-response' },
    action: 'security_incident.response',
    resourceType: 'security_incident',
    resourceId: companyId,
    severity: actions.some((x) => x.kind === 'quarantine_connection' && x.applied) ? 'critical' : 'warning',
    entityLineage: ['company', 'security_incident'],
    detail: { mode: allowDestructive ? 'enforced' : 'dry_run', anomalies: telemetry.anomalies.length, actions },
  });

  // Escalation chain (all reversible/gated — no irreversible remediation).
  const highSev = telemetry.anomalies.some((a) => a.severity === 'high');
  const enforcedQuarantine = actions.some((x) => x.kind === 'quarantine_connection' && x.applied);
  const escalationLevel: 0 | 1 | 2 | 3 =
    enforcedQuarantine ? 3
    : actions.some((x) => x.kind === 'quarantine_connection') ? 2
    : actions.some((x) => x.kind === 'throttle_replay') || highSev ? 1
    : telemetry.anomalies.length > 0 ? 1 : 0;
  const escalationLabel =
    escalationLevel === 3 ? 'quarantine_enforced'
    : escalationLevel === 2 ? 'quarantine_proposed'
    : escalationLevel === 1 ? (actions.some((x) => x.kind === 'throttle_replay') ? 'throttle' : 'advisory')
    : 'none';
  const incidentLifecycle =
    escalationLevel === 3 ? 'escalated'
    : escalationLevel === 0 ? 'resolved'
    : allowDestructive ? 'mitigated' : 'opened';

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    mode: allowDestructive ? 'enforced' : 'dry_run',
    incidentId: correlationId,
    anomalies: telemetry.anomalies.length,
    actions,
    escalationLevel,
    escalationLabel,
    incidentLifecycle,
    capabilityNote:
      'Tiered, reversible, gated escalation (advisory→throttle→quarantine proposed→enforced). No irreversible remediation. Automated credential rotation is advised, not executed.',
  };
}

/** Operator override: lift a security quarantine (reversible by design). */
export async function liftQuarantine(args: {
  companyId: string;
  connectionId: string;
  actorUserId: string;
}): Promise<{ ok: boolean }> {
  try {
    await updateWebsiteConnection(args.connectionId, {
      status: 'pending',
      health_status: 'unknown',
      last_error: null,
    });
    await recordComplianceAudit({
      companyId: args.companyId,
      actor: { userId: args.actorUserId, type: 'user', label: 'security-response' },
      action: 'security_incident.quarantine_lifted',
      resourceType: 'security_incident',
      resourceId: args.connectionId,
      severity: 'warning',
      entityLineage: ['company', 'security_incident', 'lift'],
      detail: { connectionId: args.connectionId },
    }).catch(() => undefined);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
