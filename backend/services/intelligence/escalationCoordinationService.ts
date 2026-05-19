/**
 * Durable, distributed escalation coordination.
 *
 * Replaces the process-local consecutive-failure Map with state derived from
 * the existing append-only audit substrate (resource_type='worker_escalation')
 * — so escalation is consistent across instances, survives restarts, and is
 * append-only auditable. No new table (audit_events is the substrate; an
 * optional escalation_state table can be added later without code change).
 *
 * Decay/reset: only failures within DECAY_WINDOW_MS count toward the level;
 * a success records a reset marker so the window naturally clears.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';

const DECAY_WINDOW_MS = 60 * 60_000; // 1h sliding window
const ESCALATION_THRESHOLD = 3;

export interface EscalationState {
  companyId: string;
  scope: string;
  recentFailures: number;
  level: 0 | 1 | 2;
  escalated: boolean;
  windowMs: number;
}

function levelFor(failures: number): 0 | 1 | 2 {
  if (failures >= ESCALATION_THRESHOLD * 2) return 2;
  if (failures >= ESCALATION_THRESHOLD) return 1;
  return 0;
}

/** Read current escalation state for (company, scope) from durable history. */
export async function getEscalationState(companyId: string, scope: string): Promise<EscalationState> {
  const sinceIso = new Date(Date.now() - DECAY_WINDOW_MS).toISOString();
  let recentFailures = 0;
  let lastReset = 0;
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('action, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'worker_escalation')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(100);
    for (const r of (data ?? []) as any[]) {
      const action = String(r.action || '');
      if (action.endsWith(`.reset:${scope}`)) { lastReset = Math.max(lastReset, Date.parse(r.created_at) || 0); }
    }
    for (const r of (data ?? []) as any[]) {
      const action = String(r.action || '');
      const t = Date.parse(r.created_at) || 0;
      if (action.endsWith(`.failure:${scope}`) && t > lastReset) recentFailures += 1;
    }
  } catch {
    recentFailures = 0;
  }
  const level = levelFor(recentFailures);
  return { companyId, scope, recentFailures, level, escalated: level >= 1, windowMs: DECAY_WINDOW_MS };
}

/** Record a failure; returns the new (post-increment) durable state. */
export async function recordEscalationFailure(
  companyId: string,
  scope: string,
  detail: Record<string, unknown>,
): Promise<EscalationState> {
  await recordComplianceAudit({
    companyId,
    actor: { userId: null, type: 'system', label: 'escalation-coordination' },
    action: `worker_escalation.failure:${scope}`,
    resourceType: 'worker_escalation',
    resourceId: `${companyId}:${scope}`,
    severity: 'warning',
    entityLineage: ['company', 'worker_escalation', scope],
    detail,
  }).catch(() => undefined);
  const state = await getEscalationState(companyId, scope);
  if (state.level >= 1) {
    await recordComplianceAudit({
      companyId,
      actor: { userId: null, type: 'system', label: 'escalation-coordination' },
      action: `worker_escalation.escalated:${scope}`,
      resourceType: 'worker_escalation',
      resourceId: `${companyId}:${scope}`,
      severity: 'critical',
      entityLineage: ['company', 'worker_escalation', scope, `level_${state.level}`],
      detail: { recentFailures: state.recentFailures, level: state.level },
    }).catch(() => undefined);
  }
  return state;
}

/** Record a success → resets the sliding window for (company, scope). */
export async function recordEscalationReset(companyId: string, scope: string): Promise<void> {
  await recordComplianceAudit({
    companyId,
    actor: { userId: null, type: 'system', label: 'escalation-coordination' },
    action: `worker_escalation.reset:${scope}`,
    resourceType: 'worker_escalation',
    resourceId: `${companyId}:${scope}`,
    severity: 'info',
    entityLineage: ['company', 'worker_escalation', scope, 'reset'],
    detail: { resetAt: new Date().toISOString() },
  }).catch(() => undefined);
}
