/**
 * Phase 5 — Bounded alert routing.
 *
 * In-app delivery ONLY. No email, no SMS, no WhatsApp, no autonomous
 * escalation. Per-org rate limits and dedup are enforced before insert.
 *
 *   raiseAlert(...)        — gated emitter; honours rules + dedup + severity
 *   listAlerts(...)        — paged reader
 *   acknowledgeAlert(...)
 *   upsertAlertRule(...)
 *   listAlertRules(...)
 *
 * The dedup_key is supplied by callers — examples in
 * AlertDedupKeyExamples.md (callers in pipeline use stable keys per
 * cluster/source/execution).
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import type {
  Alert,
  AlertRule,
  AlertSeverity,
  AlertType,
} from '../types/alert';
import { ALERT_TYPES, SEVERITY_RANK } from '../types/alert';

export type RaiseAlertInput = {
  organizationId: string;
  alertType: AlertType;
  severity: AlertSeverity;
  dedupKey: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
};

export type RaiseAlertResult =
  | { ok: true; alert: Alert; deduped: false }
  | { ok: true; alert: null; deduped: true; reason: 'rule_disabled' | 'severity_below_threshold' | 'rate_limited' };

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 24);
}

export async function raiseAlert(input: RaiseAlertInput): Promise<RaiseAlertResult> {
  // Load (or implicitly create) the rule. We do not auto-create — if the
  // org has no rule for this type, fall back to defaults but never persist.
  const { data: ruleRow } = await ownedDbTable('alert_rules')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('alert_type', input.alertType)
    .maybeSingle();
  const rule = (ruleRow as AlertRule | null) ?? null;
  const enabled = rule ? rule.enabled : true;
  const minSeverity: AlertSeverity = rule ? rule.min_severity : 'medium';
  const rateLimitMinutes = rule ? rule.rate_limit_minutes : 60;

  if (!enabled) {
    return { ok: true, alert: null, deduped: true, reason: 'rule_disabled' };
  }
  if (SEVERITY_RANK[input.severity] < SEVERITY_RANK[minSeverity]) {
    return { ok: true, alert: null, deduped: true, reason: 'severity_below_threshold' };
  }

  const dedupKey = shortHash(`${input.alertType}|${input.dedupKey}`);

  if (rateLimitMinutes > 0) {
    const cutoff = new Date(Date.now() - rateLimitMinutes * 60 * 1000).toISOString();
    const { data: recent } = await ownedDbTable('alerts')
      .select('id')
      .eq('organization_id', input.organizationId)
      .eq('alert_type', input.alertType)
      .eq('dedup_key', dedupKey)
      .gt('created_at', cutoff)
      .limit(1)
      .maybeSingle();
    if (recent) {
      return { ok: true, alert: null, deduped: true, reason: 'rate_limited' };
    }
  }

  const { data, error } = await ownedDbTable('alerts')
    .insert({
      organization_id: input.organizationId,
      alert_rule_id: rule?.id ?? null,
      alert_type: input.alertType,
      severity: input.severity,
      dedup_key: dedupKey,
      title: input.title,
      body: input.body,
      metadata: input.metadata ?? {},
      delivered_channels: ['in_app'],
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`alert_insert_failed:${error?.message ?? 'unknown'}`);
  return { ok: true, alert: data as Alert, deduped: false };
}

export async function listAlerts(
  organizationId: string,
  options?: { onlyUnacknowledged?: boolean; limit?: number },
): Promise<Alert[]> {
  let q = ownedDbTable('alerts')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.onlyUnacknowledged) q = q.is('acknowledged_at', null);
  const { data, error } = await q;
  if (error) throw new Error(`alerts_list_failed:${error.message}`);
  return (data as Alert[]) ?? [];
}

export async function acknowledgeAlert(
  organizationId: string,
  id: string,
  userId: string | null,
): Promise<Alert | null> {
  const { data, error } = await ownedDbTable('alerts')
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: userId,
    })
    .eq('organization_id', organizationId)
    .eq('id', id)
    .is('acknowledged_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`alert_ack_failed:${error.message}`);
  return (data as Alert | null) ?? null;
}

export async function upsertAlertRule(input: {
  organizationId: string;
  alertType: AlertType;
  enabled: boolean;
  minSeverity: AlertSeverity;
  rateLimitMinutes: number;
  scope?: Record<string, unknown>;
  createdBy: string | null;
}): Promise<AlertRule> {
  if (!ALERT_TYPES.includes(input.alertType)) {
    throw new Error(`unknown_alert_type:${input.alertType}`);
  }
  const payload = {
    organization_id: input.organizationId,
    alert_type: input.alertType,
    enabled: input.enabled,
    min_severity: input.minSeverity,
    rate_limit_minutes: Math.max(0, Math.min(1440, input.rateLimitMinutes)),
    scope: input.scope ?? {},
    created_by: input.createdBy,
  };
  const { data: existing } = await ownedDbTable('alert_rules')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('alert_type', input.alertType)
    .maybeSingle();
  if (existing && (existing as { id?: string }).id) {
    const { data, error } = await ownedDbTable('alert_rules')
      .update(payload)
      .eq('id', (existing as { id: string }).id)
      .select('*')
      .single();
    if (error || !data) throw new Error(`alert_rule_update_failed:${error?.message ?? 'unknown'}`);
    return data as AlertRule;
  }
  const { data, error } = await ownedDbTable('alert_rules')
    .insert(payload)
    .select('*')
    .single();
  if (error || !data) throw new Error(`alert_rule_insert_failed:${error?.message ?? 'unknown'}`);
  return data as AlertRule;
}

export async function listAlertRules(organizationId: string): Promise<AlertRule[]> {
  const { data, error } = await ownedDbTable('alert_rules')
    .select('*')
    .eq('organization_id', organizationId)
    .order('alert_type', { ascending: true });
  if (error) throw new Error(`alert_rules_list_failed:${error.message}`);
  return (data as AlertRule[]) ?? [];
}
