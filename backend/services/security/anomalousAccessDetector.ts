/**
 * Anomalous-access detector (pre-launch, owner ruling; design 6f Rev 1-5, 05 reviewed, e9 approved 2026-11-13).
 *
 * Replaces auditLoggingService.detectAnomalousAccess, which NEVER had a caller and read the legacy columns
 * (user_id / operation / timestamp) that the canonical writer insertAuditLogStrict never writes - wired as it was it
 * would have run, heartbeat and found nothing forever.
 *
 * MULTI-SOURCE (e9): audit_logs (action / actor_user_id / target_user_id / created_at),
 * capability_audit_log (decision / actor_user_id / occurred_at - step-up and MFA failures live ONLY here),
 * super_admin_audit_logs (action / actor_user_id / created_at - credit grants live ONLY here).
 *
 * SIGNAL: one structured line per finding - logger.warn('anomalous_access', { rule, actor_user_id, count, threshold,
 * window_min }) - plus counter security.anomalous_access{rule} (rule-only label: bounded). No emails, no target ids,
 * no metadata payloads. Grafana alerts on the line via Loki (83).
 * HEARTBEAT: logger.info('anomalous_access_scan', { rules_run, rules_disabled, rules_failed, findings, suppressed,
 * sources_failed, oldest_threshold_basis_age_days, fires_7d }) every run, so an absence alert can tell "quiet" from
 * "not running", threshold staleness is visible (05), and "3 fires a week" (re-baseline trigger 3) is observable.
 * STORM CONTROL: cooldown per rule + actor (COOLDOWN_SECONDS); a burst alerts once per hour, not every run.
 * READ ERRORS ARE READ: a failed source read is logged + counted and its rules are reported FAILED - never a silent 0.
 *
 * KNOWN LIMITATIONS (stated, not hidden): AI_GATEWAY_CALL rows carry a NULL actor (F-a) - no per-actor AI rule; R6
 * (per-company AI spike) is post-launch. Rows written by logAuditEvent carry `operation`, not `action` (PL-12) - they
 * are not read here; re-baseline when they start landing.
 */
import {
  WINDOW_MINUTES, COOLDOWN_SECONDS, RATE_THRESHOLDS, IDENTITY_THRESHOLDS, R1A_ACTIONS, R2_ACTIONS, R3_DECISIONS,
  SYNTHETIC_TRIP_ACTION, isPrivileged, isSensitivePrivileged, type RuleId, type RateRuleId, type IdentityRuleId,
} from './anomalousAccessRules';

export interface AuditRow { actor_user_id: string | null; action: string | null; target_user_id: string | null }
export interface CapabilityRow { actor_user_id: string | null; decision: string | null }
export interface AdminRow { actor_user_id: string | null; action: string | null }

export interface DetectorConfig {
  /** R4 allowlist (actor UUIDs from config, never code). null = not configured -> R4 DISABLED (and says so). */
  allowlist: ReadonlySet<string> | null;
  systemUserId: string;
  systemExpected: Readonly<Record<string, string>>;
}

export interface Finding { rule: RuleId; actorUserId: string; count: number; threshold: number }

type Source = 'audit_logs' | 'capability_audit_log' | 'super_admin_audit_logs';

const RULE_SOURCES: Record<RuleId, Source[]> = {
  R1a_bulk_membership_growth: ['audit_logs'],
  R1b_sensitive_privileged: ['audit_logs', 'super_admin_audit_logs'],
  R2_denial_burst: ['audit_logs'],
  R3_stepup_failure_burst: ['capability_audit_log'],
  R5_target_fanout: ['audit_logs'],
  R4_privileged_actor_not_allowlisted: ['audit_logs', 'super_admin_audit_logs'],
  R7_system_unexpected_action: ['audit_logs', 'super_admin_audit_logs'],
  synthetic_trip: ['audit_logs'],
};
export const ALL_RULES = Object.keys(RULE_SOURCES) as RuleId[];

function bump(m: Map<string, number>, k: string, by = 1) { m.set(k, (m.get(k) ?? 0) + by); }

/**
 * PURE rule evaluation over one window's rows. `failedSources` makes every rule that depends on a failed source
 * FAILED (not evaluated on partial data).
 */
export function evaluateRules(
  input: { audit: AuditRow[]; capability: CapabilityRow[]; admin: AdminRow[] },
  cfg: DetectorConfig,
  failedSources: ReadonlySet<Source> = new Set(),
): { findings: Finding[]; rulesRun: RuleId[]; rulesDisabled: RuleId[]; rulesFailed: RuleId[] } {
  const rulesFailed = ALL_RULES.filter((r) => RULE_SOURCES[r].some((s) => failedSources.has(s)));
  const rulesDisabled: RuleId[] = cfg.allowlist === null && !rulesFailed.includes('R4_privileged_actor_not_allowlisted')
    ? ['R4_privileged_actor_not_allowlisted'] : [];
  const skip = new Set<RuleId>([...rulesFailed, ...rulesDisabled]);
  const rulesRun = ALL_RULES.filter((r) => !skip.has(r));

  const privilegedRows: Array<{ actor: string; action: string }> = [];
  for (const r of [...input.audit, ...input.admin]) {
    if (r.actor_user_id && r.action && isPrivileged(r.action)) privilegedRows.push({ actor: r.actor_user_id, action: r.action });
  }

  const r1a = new Map<string, number>(); const r1b = new Map<string, number>();
  const r2 = new Map<string, number>(); const r3 = new Map<string, number>();
  const r5 = new Map<string, Set<string>>(); const r4 = new Map<string, number>(); const r7 = new Map<string, number>();
  const synth = new Map<string, number>();

  for (const r of input.audit) {
    if (!r.actor_user_id || !r.action) continue;
    if (R1A_ACTIONS.has(r.action)) bump(r1a, r.actor_user_id);
    if (R2_ACTIONS.has(r.action)) bump(r2, r.actor_user_id);
    if (r.action === SYNTHETIC_TRIP_ACTION) bump(synth, r.actor_user_id);
    if (r.target_user_id) {
      const s = r5.get(r.actor_user_id) ?? new Set<string>();
      s.add(r.target_user_id);
      r5.set(r.actor_user_id, s);
    }
  }
  for (const r of [...input.audit, ...input.admin]) {
    if (r.actor_user_id && r.action && isSensitivePrivileged(r.action)) bump(r1b, r.actor_user_id);
  }
  for (const r of input.capability) {
    if (r.actor_user_id && r.decision && R3_DECISIONS.has(r.decision)) bump(r3, r.actor_user_id);
  }
  for (const { actor, action } of privilegedRows) {
    if (actor === cfg.systemUserId) {
      // SYSTEM is allowed for R4 (owner ruling, C86) and covered by the behaviour rule R7 instead (05).
      if (!(action in cfg.systemExpected)) bump(r7, actor);
    } else if (cfg.allowlist && !cfg.allowlist.has(actor)) {
      bump(r4, actor);
    }
  }

  const findings: Finding[] = [];
  const rate = (rule: RateRuleId, m: Map<string, number>) => {
    if (skip.has(rule)) return;
    const t = RATE_THRESHOLDS[rule].threshold;
    for (const [actor, n] of m) if (n >= t) findings.push({ rule, actorUserId: actor, count: n, threshold: t });
  };
  const ident = (rule: IdentityRuleId, m: Map<string, number>) => {
    if (skip.has(rule)) return;
    const t = IDENTITY_THRESHOLDS[rule].threshold;
    for (const [actor, n] of m) if (n >= t) findings.push({ rule, actorUserId: actor, count: n, threshold: t });
  };
  rate('R1a_bulk_membership_growth', r1a);
  rate('R1b_sensitive_privileged', r1b);
  rate('R2_denial_burst', r2);
  rate('R3_stepup_failure_burst', r3);
  rate('R5_target_fanout', new Map([...r5].map(([a, s]) => [a, s.size])));
  ident('R4_privileged_actor_not_allowlisted', r4);
  ident('R7_system_unexpected_action', r7);
  if (!skip.has('synthetic_trip')) {
    for (const [actor, n] of synth) findings.push({ rule: 'synthetic_trip', actorUserId: actor, count: n, threshold: 1 });
  }
  findings.sort((a, b) => (a.rule + a.actorUserId).localeCompare(b.rule + b.actorUserId));
  return { findings, rulesRun, rulesDisabled, rulesFailed };
}

// ── the scan (I/O injected) ─────────────────────────────────────────────────────────────────────────────────────

export interface SourceRead<T> { rows: T[]; error?: string | null; truncated?: boolean }

export interface ScanDeps {
  now: () => number;
  readAudit: (sinceIso: string) => Promise<SourceRead<AuditRow>>;
  readCapability: (sinceIso: string) => Promise<SourceRead<CapabilityRow>>;
  readAdmin: (sinceIso: string) => Promise<SourceRead<AdminRow>>;
  /** true = this rule+actor has not alerted within the cooldown (claim taken); false = suppressed. */
  claimCooldown: (key: string, ttlSeconds: number) => Promise<boolean>;
  recordFire: (rule: RuleId, nowMs: number) => Promise<void>;
  firesLast7Days: (rule: RuleId, nowMs: number) => Promise<number>;
  config: DetectorConfig;
  log: { info: (m: string, f: Record<string, unknown>) => void; warn: (m: string, f: Record<string, unknown>) => void; error: (m: string, f: Record<string, unknown>) => void };
  counter: (name: string, labels: Record<string, string>) => void;
}

export interface ScanSummary {
  rulesRun: RuleId[]; rulesDisabled: RuleId[]; rulesFailed: RuleId[];
  findings: Finding[]; alerted: Finding[]; suppressed: number; sourcesFailed: Source[];
}

export function oldestThresholdBasisAgeDays(nowMs: number): number {
  const dates = [...Object.values(RATE_THRESHOLDS), ...Object.values(IDENTITY_THRESHOLDS)].map((t) => Date.parse(`${t.basisDate}T00:00:00Z`));
  return Math.floor((nowMs - Math.min(...dates)) / 86_400_000);
}

async function safeRead<T>(source: Source, fn: () => Promise<SourceRead<T>>, deps: ScanDeps): Promise<{ rows: T[]; failed: boolean }> {
  let res: SourceRead<T>;
  try {
    res = await fn();
  } catch (err) {
    res = { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
  if (res.error) {
    deps.log.error('anomalous_access_source_failed', { source, message: res.error });
    try { deps.counter('security.anomalous_access_source_failed', { source }); } catch { /* never break the scan */ }
    return { rows: [], failed: true };
  }
  if (res.truncated) {
    // Too many rows in one window to evaluate completely - loud, and the rules on it are NOT trusted as "quiet".
    deps.log.error('anomalous_access_source_truncated', { source, rows: res.rows.length });
    try { deps.counter('security.anomalous_access_source_failed', { source }); } catch { /* never break the scan */ }
    return { rows: res.rows, failed: true };
  }
  return { rows: res.rows, failed: false };
}

export async function runAnomalousAccessScan(deps: ScanDeps): Promise<ScanSummary> {
  const nowMs = deps.now();
  const sinceIso = new Date(nowMs - WINDOW_MINUTES * 60_000).toISOString();
  const [audit, capability, admin] = await Promise.all([
    safeRead('audit_logs', () => deps.readAudit(sinceIso), deps),
    safeRead('capability_audit_log', () => deps.readCapability(sinceIso), deps),
    safeRead('super_admin_audit_logs', () => deps.readAdmin(sinceIso), deps),
  ]);
  const failed = new Set<Source>();
  if (audit.failed) failed.add('audit_logs');
  if (capability.failed) failed.add('capability_audit_log');
  if (admin.failed) failed.add('super_admin_audit_logs');

  const result = evaluateRules({ audit: audit.rows, capability: capability.rows, admin: admin.rows }, deps.config, failed);
  if (result.rulesDisabled.includes('R4_privileged_actor_not_allowlisted')) {
    deps.log.warn('anomalous_access_rule_disabled', { rule: 'R4_privileged_actor_not_allowlisted', reason: 'AUDIT_PRIVILEGED_ACTOR_IDS not configured' });
  }

  const alerted: Finding[] = [];
  let suppressed = 0;
  for (const f of result.findings) {
    let fresh = true;
    try {
      fresh = await deps.claimCooldown(`anomalous_access:cooldown:${f.rule}:${f.actorUserId}`, COOLDOWN_SECONDS);
    } catch {
      fresh = true; // a cooldown store failure must never HIDE a finding - alert (possibly twice) rather than not at all
    }
    if (!fresh) { suppressed += 1; continue; }
    deps.log.warn('anomalous_access', {
      event: 'anomalous_access', rule: f.rule, actor_user_id: f.actorUserId, count: f.count, threshold: f.threshold,
      window_min: WINDOW_MINUTES,
    });
    try { deps.counter('security.anomalous_access', { rule: f.rule }); } catch { /* never break the scan */ }
    try { await deps.recordFire(f.rule, nowMs); } catch { /* fire counts are advisory */ }
    alerted.push(f);
  }

  const fires7d: Record<string, number> = {};
  for (const rule of ALL_RULES) {
    try { fires7d[rule] = await deps.firesLast7Days(rule, nowMs); } catch { fires7d[rule] = -1; }
  }
  deps.log.info('anomalous_access_scan', {
    event: 'anomalous_access_scan',
    rules_run: result.rulesRun.length, rules_disabled: result.rulesDisabled, rules_failed: result.rulesFailed,
    findings: result.findings.length, alerted: alerted.length, suppressed, sources_failed: [...failed],
    oldest_threshold_basis_age_days: oldestThresholdBasisAgeDays(nowMs), fires_7d: fires7d,
  });
  return { ...result, alerted, suppressed, sourcesFailed: [...failed] };
}
