/**
 * Safe remediation orchestration — ADVISORY-FIRST, operator-approval gated.
 *
 * Derives recommended remediation actions from existing diagnostics (worker
 * liveness, scheduler coordination, security telemetry, escalation state)
 * and persists them as durable, append-only advisories whose execution
 * requires an explicit operator approval. EVERY executable action maps to a
 * pre-existing reversible primitive (e.g. liftQuarantine, re-validate
 * connection) — NEVER terminates workers, NEVER interrupts leases, NEVER
 * destructive without explicit approval. Tenant-safe, RBAC-safe (enforced at
 * the endpoint), distributed-safe, rollback-safe.
 *
 * Persistence: append-only audit substrate (`resource_type='remediation'`,
 * `resource_id=advisoryId`). Each advisory progresses through states via
 * additional append-only rows: `advised → approved → executed | reverted |
 * dismissed`. Cooldown enforced per (companyId, advisoryKind).
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit, newCorrelationId } from '../audit/complianceAuditService';
import { probeWorkerLiveness } from './workerLivenessService';
import { buildSchedulerCoordination } from './schedulerCoordinationService';
import { buildSecurityTelemetry } from './securityTelemetryService';
import { getEscalationState } from './escalationCoordinationService';
import { liftQuarantine } from './securityResponseEngine';
import { validateIntegration } from '../integrationService';

export type AdvisoryKind =
  | 'wedged_worker_advisory'
  | 'scheduler_drift_advisory'
  | 'security_quarantine_lift_advisory'
  | 'escalation_review_advisory'
  | 'connection_revalidate_advisory';

export type AdvisoryState = 'advised' | 'approved' | 'executed' | 'reverted' | 'dismissed';

export interface Advisory {
  advisoryId: string;
  kind: AdvisoryKind;
  state: AdvisoryState;
  title: string;
  rationale: string;
  /** Whether an executable, REVERSIBLE remediation exists for this advisory. */
  executable: boolean;
  /** Target (e.g. connectionId, workerId) where the action would apply. */
  target?: string;
  createdAt: string;
}

export interface RemediationReport {
  companyId: string;
  generatedAt: string;
  advisories: Advisory[];
  queue: Advisory[]; // approved, awaiting execution
  capabilityNote: string;
}

const COOLDOWN_MS = 10 * 60_000;
const COOLDOWNS = new Map<string, number>();

function cooldownOk(companyId: string, kind: AdvisoryKind): boolean {
  const k = `${companyId}:${kind}`;
  const last = COOLDOWNS.get(k) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return false;
  COOLDOWNS.set(k, Date.now());
  return true;
}

async function persistAdvisory(
  companyId: string,
  a: Omit<Advisory, 'advisoryId' | 'createdAt'>,
): Promise<Advisory> {
  const { correlationId } = await recordComplianceAudit({
    companyId,
    actor: { userId: null, type: 'system', label: 'remediation' },
    action: `remediation.${a.kind}.advised`,
    resourceType: 'remediation',
    resourceId: newCorrelationId('adv'),
    entityLineage: ['company', 'remediation', a.kind, 'advised'],
    detail: { ...a, state: 'advised' },
  });
  return { ...a, advisoryId: correlationId, createdAt: new Date().toISOString() };
}

/** Generate advisories from real diagnostics. Read-only diagnostics + append-only advisories. */
export async function generateAdvisories(companyId: string): Promise<Advisory[]> {
  const advisories: Advisory[] = [];

  const [liveness, scheduler, security, escalation] = await Promise.all([
    probeWorkerLiveness(companyId).catch(() => null),
    buildSchedulerCoordination(companyId).catch(() => null),
    buildSecurityTelemetry(companyId).catch(() => null),
    getEscalationState(companyId, 'worker_scheduler').catch(() => null),
  ]);

  for (const w of liveness?.workers ?? []) {
    if (w.wedged && cooldownOk(companyId, 'wedged_worker_advisory')) {
      advisories.push(await persistAdvisory(companyId, {
        kind: 'wedged_worker_advisory',
        state: 'advised',
        title: `Wedged worker detected: ${w.workerType}`,
        rationale: `Heartbeat unchanged across probes, status=healthy, age=${w.ageMs}ms. Advisory only — NEVER auto-terminated; investigate logs/redeploy on operator approval.`,
        executable: false, // worker termination is NOT an executable action here
        target: w.workerId,
      }));
    }
  }

  if (scheduler?.driftDetected && cooldownOk(companyId, 'scheduler_drift_advisory')) {
    advisories.push(await persistAdvisory(companyId, {
      kind: 'scheduler_drift_advisory',
      state: 'advised',
      title: 'Scheduler cadence drift',
      rationale: scheduler.detail,
      executable: false, // existing lease handles failover automatically
    }));
  }

  for (const c of security?.connections ?? []) {
    if (c.healthStatus === 'failed' && cooldownOk(companyId, 'security_quarantine_lift_advisory')) {
      advisories.push(await persistAdvisory(companyId, {
        kind: 'security_quarantine_lift_advisory',
        state: 'advised',
        title: `Review quarantined ${c.provider} connection`,
        rationale: `Trust score ${c.trustScore}. Reversible lift available via operator approval.`,
        executable: true,
        target: c.connectionId,
      }));
    }
  }

  if ((escalation?.level ?? 0) >= 1 && cooldownOk(companyId, 'escalation_review_advisory')) {
    advisories.push(await persistAdvisory(companyId, {
      kind: 'escalation_review_advisory',
      state: 'advised',
      title: 'Worker scheduler escalation in window',
      rationale: `${escalation?.recentFailures ?? 0} recent failure(s) — review root cause; reset on operator approval.`,
      executable: false,
    }));
  }

  return advisories;
}

async function listRemediation(companyId: string, action?: string, limit = 200): Promise<any[]> {
  try {
    let q = ownedDbTable('audit_events')
      .select('action, resource_id, metadata, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'remediation')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (action) q = q.eq('action', action);
    const { data } = await q;
    return (data ?? []) as any[];
  } catch {
    return [];
  }
}

/** Read advisories + queued (approved, not-yet-executed). */
export async function buildRemediationReport(companyId: string): Promise<RemediationReport> {
  const rows = await listRemediation(companyId);
  const byId = new Map<string, Advisory>();
  // Reconstruct latest state per advisoryId by walking newest→oldest.
  for (const r of rows) {
    const m = (r.metadata ?? {}) as any;
    const id = String(m.correlationId ?? r.resource_id);
    if (!id || byId.has(id)) continue;
    const action = String(r.action ?? '');
    const stateMatch = action.match(/\.(advised|approved|executed|reverted|dismissed)$/);
    const state = (stateMatch?.[1] ?? m.state ?? 'advised') as AdvisoryState;
    byId.set(id, {
      advisoryId: id,
      kind: (m.kind ?? 'connection_revalidate_advisory') as AdvisoryKind,
      state,
      title: String(m.title ?? action),
      rationale: String(m.rationale ?? ''),
      executable: Boolean(m.executable),
      target: m.target,
      createdAt: r.created_at,
    });
  }
  const advisories = Array.from(byId.values());
  const queue = advisories.filter((a) => a.state === 'approved');
  return {
    companyId,
    generatedAt: new Date().toISOString(),
    advisories,
    queue,
    capabilityNote:
      'Advisory-first; every executable action is reversible and requires explicit operator approval. No automatic worker termination, no lease interruption, no destructive remediation.',
  };
}

/** Append-only state transition (operator approval / dismissal). */
export async function transitionAdvisory(args: {
  companyId: string;
  advisoryId: string;
  to: 'approved' | 'dismissed';
  actorUserId: string;
  note?: string;
}): Promise<{ ok: boolean }> {
  await recordComplianceAudit({
    companyId: args.companyId,
    actor: { userId: args.actorUserId, type: 'user', label: 'remediation' },
    action: `remediation.transition.${args.to}`,
    resourceType: 'remediation',
    resourceId: args.advisoryId,
    severity: 'info',
    entityLineage: ['company', 'remediation', args.to],
    detail: { advisoryId: args.advisoryId, to: args.to, note: args.note ?? null, correlationId: args.advisoryId, state: args.to },
  }).catch(() => undefined);
  return { ok: true };
}

/**
 * Execute an APPROVED advisory. ONLY reversible primitives are reachable; an
 * advisory that is not `executable` cannot be executed.
 */
export async function executeAdvisory(args: {
  companyId: string;
  advisoryId: string;
  actorUserId: string;
}): Promise<{ ok: boolean; detail: string }> {
  const report = await buildRemediationReport(args.companyId);
  const a = report.advisories.find((x) => x.advisoryId === args.advisoryId);
  if (!a) return { ok: false, detail: 'advisory not found' };
  if (a.state !== 'approved') return { ok: false, detail: `advisory is ${a.state}; must be approved first` };
  if (!a.executable) return { ok: false, detail: 'advisory is not executable (advisory-only)' };

  let detail = '';
  let ok = false;
  try {
    if (a.kind === 'security_quarantine_lift_advisory' && a.target) {
      const r = await liftQuarantine({ companyId: args.companyId, connectionId: a.target, actorUserId: args.actorUserId });
      ok = r.ok; detail = ok ? 'quarantine lifted (reversible)' : 'lift failed';
    } else if (a.kind === 'connection_revalidate_advisory' && a.target) {
      const r = await validateIntegration(a.target, args.companyId, { rediscover: true });
      ok = r.success; detail = r.message;
    } else {
      return { ok: false, detail: 'no reversible executor for this advisory' };
    }
  } catch (err) {
    ok = false;
    detail = err instanceof Error ? err.message : 'execution error';
  }

  await recordComplianceAudit({
    companyId: args.companyId,
    actor: { userId: args.actorUserId, type: 'user', label: 'remediation' },
    action: `remediation.${a.kind}.executed`,
    resourceType: 'remediation',
    resourceId: a.advisoryId,
    severity: ok ? 'info' : 'warning',
    outcome: ok ? 'success' : 'failure',
    entityLineage: ['company', 'remediation', a.kind, 'executed'],
    detail: { advisoryId: a.advisoryId, kind: a.kind, target: a.target, ok, detail, correlationId: a.advisoryId, state: 'executed' },
  }).catch(() => undefined);

  return { ok, detail };
}
