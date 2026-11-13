/**
 * Anomalous-access detector (design 6f Rev 1-5; 05 reviewed; e9 approved 2026-11-13).
 * Positive control per rule, N-1 / N edges for every RATE rule, the C85-shaped negative control, identity rules
 * (R4 / R7), storm + cooldown with a frozen clock, loud source failure / truncation, a failing cooldown store never
 * hides a finding, the heartbeat fields, the synthetic trip, and the threshold discipline (basis + re-measure trigger,
 * identity == 1).
 */
import {
  evaluateRules, runAnomalousAccessScan, oldestThresholdBasisAgeDays, ALL_RULES,
  type AuditRow, type CapabilityRow, type AdminRow, type DetectorConfig, type ScanDeps,
} from '../../services/security/anomalousAccessDetector';
import {
  RATE_THRESHOLDS, IDENTITY_THRESHOLDS, COOLDOWN_SECONDS, SYNTHETIC_TRIP_ACTION, isPrivileged, R2_ACTIONS,
} from '../../services/security/anomalousAccessRules';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001';      // allowlisted
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';      // not allowlisted
const T = (i: number) => `cccccccc-0000-4000-8000-${String(i).padStart(12, '0')}`;
const CFG: DetectorConfig = { allowlist: new Set([ADMIN]), systemUserId: SYSTEM, systemExpected: {} };

const a = (actor: string | null, action: string, target: string | null = null): AuditRow => ({ actor_user_id: actor, action, target_user_id: target });
const rep = <X>(n: number, f: (i: number) => X): X[] => Array.from({ length: n }, (_, i) => f(i));
const run = (audit: AuditRow[] = [], capability: CapabilityRow[] = [], admin: AdminRow[] = [], cfg = CFG) =>
  evaluateRules({ audit, capability, admin }, cfg);
const rules = (r: ReturnType<typeof run>) => r.findings.map((f) => `${f.rule}:${f.actorUserId}`);

describe('threshold discipline', () => {
  it('every RATE threshold carries a dated basis and a re-measure trigger', () => {
    for (const [rule, t] of Object.entries(RATE_THRESHOLDS)) {
      expect([rule, /\b20\d\d-\d\d-\d\d\b/.test(t.basis)]).toEqual([rule, true]);
      expect([rule, /re-measure/i.test(t.basis)]).toEqual([rule, true]);
      expect([rule, /^\d{4}-\d{2}-\d{2}$/.test(t.basisDate)]).toEqual([rule, true]);
      expect(t.threshold).toBeGreaterThan(1);
    }
  });
  it('every IDENTITY threshold is exactly 1 (never "harmonised" upward) and the two groups do not overlap', () => {
    for (const t of Object.values(IDENTITY_THRESHOLDS)) expect(t.threshold).toBe(1);
    expect(Object.keys(RATE_THRESHOLDS).filter((k) => k in IDENTITY_THRESHOLDS)).toEqual([]);
  });
  it('approved values (e9 2026-11-13)', () => {
    expect(Object.fromEntries(Object.entries(RATE_THRESHOLDS).map(([k, v]) => [k, v.threshold]))).toEqual({
      R1a_bulk_membership_growth: 12, R1b_sensitive_privileged: 4, R2_denial_burst: 5, R3_stepup_failure_burst: 5, R5_target_fanout: 15,
    });
  });
});

describe('RATE rules - positive control and N-1 / N edges', () => {
  it.each([
    ['R1a_bulk_membership_growth', (n: number) => run(rep(n, () => a(ADMIN, 'INVITE_USER')))],
    ['R1b_sensitive_privileged', (n: number) => run(rep(n, () => a(ADMIN, 'UPDATE_USER_ROLE')))],
    ['R2_denial_burst', (n: number) => run(rep(n, () => a(OTHER, 'PERMISSION_DENIED')))],
    ['R3_stepup_failure_burst', (n: number) => run([], rep(n, () => ({ actor_user_id: OTHER, decision: 'totp_verification_failed' })))],
    ['R5_target_fanout', (n: number) => run(rep(n, (i) => a(ADMIN, 'INVITATION_ACCEPTED', T(i))))],
  ] as const)('%s fires at N and not at N-1', (rule, at) => {
    const n = RATE_THRESHOLDS[rule].threshold;
    expect(at(n - 1).findings.filter((f) => f.rule === rule)).toEqual([]);
    expect(at(n).findings.filter((f) => f.rule === rule)).toEqual([expect.objectContaining({ rule, count: n, threshold: n })]);
  });

  it('R1b counts super_admin_audit_logs credit actions and SUPER_ADMIN_* by prefix', () => {
    const admin = rep(2, () => ({ actor_user_id: ADMIN, action: 'SUPER_ADMIN_CREDITS_GRANT' }));
    const audit = [a(ADMIN, 'SUPER_ADMIN_USER_SUSPEND'), a(ADMIN, 'SUPER_ADMIN_COMPANY_DISABLE')];
    expect(rules(run(audit, [], admin))).toContain(`R1b_sensitive_privileged:${ADMIN}`);
  });

  it('R3 ignores step-up PROMPTS (normal flow)', () => {
    const prompts = rep(20, () => ({ actor_user_id: OTHER, decision: 'step_up_required' }));
    expect(run([], prompts).findings).toEqual([]);
  });

  it('R5 counts DISTINCT targets (the same target repeated is not fan-out)', () => {
    expect(run(rep(30, () => a(ADMIN, 'INVITATION_ACCEPTED', T(1)))).findings).toEqual([]);
  });

  it('INVITE_USER in bulk below R1a does NOT trip R1b (the split is the point)', () => {
    expect(rules(run(rep(11, () => a(ADMIN, 'INVITE_USER'))))).toEqual([]);
  });

  it('SUPER_ADMIN_INVITE_REJECTED is a denial (R2), never a privileged action', () => {
    expect(isPrivileged('SUPER_ADMIN_INVITE_REJECTED')).toBe(false);
    expect(R2_ACTIONS.has('SUPER_ADMIN_INVITE_REJECTED')).toBe(true);
  });
});

describe('NEGATIVE CONTROL - C85-shaped history produces no finding', () => {
  // C85/C87: 2877 rows all-time (2871 AI, NULL actor); the busiest 10-minute window ever held per actor: 1 privileged
  // action, 2 denials, 2 step-up failures, 1 distinct target. A window at the historical worst must be quiet.
  it('the historical WORST window (C87 per-window maxima) + a flood of AI calls -> 0 findings', () => {
    const audit = [
      ...rep(2871, () => a(null, 'AI_GATEWAY_CALL')),
      a(ADMIN, 'UPDATE_USER_ROLE', T(1)),
      a(OTHER, 'PERMISSION_DENIED'), a(OTHER, 'PERMISSION_DENIED'),
    ];
    const cap = rep(2, () => ({ actor_user_id: OTHER, decision: 'totp_verification_failed' }));
    const r = run(audit, cap);
    expect(r.findings).toEqual([]);
    expect(r.rulesDisabled).toEqual([]);
    expect(r.rulesFailed).toEqual([]);
  });

  it('stated, not hidden: if ALL six historical privileged/denial rows had happened in ONE window, R1b would fire', () => {
    const audit = [
      a(OTHER, 'PERMISSION_DENIED'), a(OTHER, 'PERMISSION_DENIED'),
      a(ADMIN, 'UPDATE_USER_ROLE', T(1)), a(ADMIN, 'UPDATE_USER_ROLE', T(2)),
      a(ADMIN, 'SUPER_ADMIN_INVITE'), a(ADMIN, 'SUPER_ADMIN_USER_UPDATE', T(3)),
    ];
    expect(rules(run(audit))).toEqual([`R1b_sensitive_privileged:${ADMIN}`]);
  });
});

describe('IDENTITY rules', () => {
  it('R4: ONE privileged action by a non-allowlisted actor fires; the allowlisted admin does not', () => {
    expect(rules(run([a(OTHER, 'UPDATE_USER_ROLE')]))).toEqual([`R4_privileged_actor_not_allowlisted:${OTHER}`]);
    expect(rules(run([a(ADMIN, 'UPDATE_USER_ROLE')]))).toEqual([]);
  });
  it('R4 also sees super_admin_audit_logs credit grants', () => {
    expect(rules(run([], [], [{ actor_user_id: OTHER, action: 'ADMIN_CREDITS_GRANT' }]))).toEqual([`R4_privileged_actor_not_allowlisted:${OTHER}`]);
  });
  it('R4: a denial is not a privileged action (no R4 for PERMISSION_DENIED)', () => {
    expect(rules(run([a(OTHER, 'PERMISSION_DENIED')]))).toEqual([]);
  });
  it('R4 is DISABLED (and reported) when no allowlist is configured - never a silent pass', () => {
    const r = run([a(OTHER, 'UPDATE_USER_ROLE')], [], [], { ...CFG, allowlist: null });
    expect(r.rulesDisabled).toEqual(['R4_privileged_actor_not_allowlisted']);
    expect(r.findings).toEqual([]);
  });
  it('SYSTEM is allowed for R4 (owner ruling) but a privileged SYSTEM action fires R7', () => {
    expect(rules(run([a(SYSTEM, 'REMOVE_USER')]))).toEqual([`R7_system_unexpected_action:${SYSTEM}`]);
  });
  it('R7 honours the expected set (config, with a reason per entry)', () => {
    const cfg = { ...CFG, systemExpected: { REMOVE_USER: 'retention job removes expired guests (test)' } };
    expect(rules(run([a(SYSTEM, 'REMOVE_USER')], [], [], cfg))).toEqual([]);
  });
});

describe('synthetic trip', () => {
  it('a marker row is a finding of its own (proves the chain to the inbox)', () => {
    expect(rules(run([a(ADMIN, SYNTHETIC_TRIP_ACTION)]))).toEqual([`synthetic_trip:${ADMIN}`]);
  });
});

// ── the scan ────────────────────────────────────────────────────────────────────────────────────────────────────

function harness(over: Partial<ScanDeps> = {}) {
  let now = Date.parse('2026-11-20T12:00:00Z');
  const cooldown = new Map<string, number>();
  const fires = new Map<string, number>();
  const logs: Array<[string, string, Record<string, unknown>]> = [];
  const counters: Array<[string, Record<string, string>]> = [];
  let audit: AuditRow[] = [];
  const deps: ScanDeps = {
    now: () => now,
    readAudit: async () => ({ rows: audit }),
    readCapability: async () => ({ rows: [] }),
    readAdmin: async () => ({ rows: [] }),
    claimCooldown: async (key, ttl) => {
      if ((cooldown.get(key) ?? 0) > now) return false;
      cooldown.set(key, now + ttl * 1000);
      return true;
    },
    recordFire: async (rule) => { fires.set(rule, (fires.get(rule) ?? 0) + 1); },
    firesLast7Days: async (rule) => fires.get(rule) ?? 0,
    config: CFG,
    log: {
      info: (m, f) => logs.push(['info', m, f]), warn: (m, f) => logs.push(['warn', m, f]), error: (m, f) => logs.push(['error', m, f]),
    },
    counter: (n, l) => counters.push([n, l]),
    ...over,
  };
  return {
    deps, logs, counters,
    setAudit: (r: AuditRow[]) => { audit = r; },
    advance: (ms: number) => { now += ms; },
    lines: (m: string) => logs.filter((l) => l[1] === m).map((l) => l[2]),
  };
}

describe('runAnomalousAccessScan', () => {
  it('a finding emits ONE anomalous_access line (no PII) + a rule-labelled counter', async () => {
    const h = harness();
    h.setAudit(rep(5, () => a(OTHER, 'PERMISSION_DENIED')));
    await runAnomalousAccessScan(h.deps);
    const lines = h.lines('anomalous_access');
    expect(lines).toEqual([{ event: 'anomalous_access', rule: 'R2_denial_burst', actor_user_id: OTHER, count: 5, threshold: 5, window_min: 10 }]);
    expect(h.counters).toContainEqual(['security.anomalous_access', { rule: 'R2_denial_burst' }]);
  });

  it('STORM: a burst alerts ONCE per rule+actor per cooldown, then again after it expires', async () => {
    const h = harness();
    h.setAudit(rep(40, () => a(ADMIN, 'UPDATE_USER_ROLE')));
    await runAnomalousAccessScan(h.deps);                 // alert
    h.advance(5 * 60_000); await runAnomalousAccessScan(h.deps);   // suppressed
    h.advance(5 * 60_000); const s = await runAnomalousAccessScan(h.deps); // suppressed
    expect(h.lines('anomalous_access')).toHaveLength(1);
    expect(s.suppressed).toBe(1);
    h.advance(COOLDOWN_SECONDS * 1000);
    await runAnomalousAccessScan(h.deps);                 // re-alert after the cooldown
    expect(h.lines('anomalous_access')).toHaveLength(2);
  });

  it('a failing cooldown store never HIDES a finding', async () => {
    const h = harness({ claimCooldown: async () => { throw new Error('redis down'); } });
    h.setAudit(rep(5, () => a(OTHER, 'PERMISSION_DENIED')));
    await runAnomalousAccessScan(h.deps);
    expect(h.lines('anomalous_access')).toHaveLength(1);
  });

  it('a failed source read is LOUD and its rules are FAILED, not quiet', async () => {
    const h = harness({ readCapability: async () => ({ rows: [], error: 'permission denied for table capability_audit_log' }) });
    const s = await runAnomalousAccessScan(h.deps);
    expect(s.rulesFailed).toEqual(['R3_stepup_failure_burst']);
    expect(h.lines('anomalous_access_source_failed')).toEqual([{ source: 'capability_audit_log', message: 'permission denied for table capability_audit_log' }]);
    expect(h.counters).toContainEqual(['security.anomalous_access_source_failed', { source: 'capability_audit_log' }]);
    expect(h.lines('anomalous_access_scan')[0]).toMatchObject({ rules_failed: ['R3_stepup_failure_burst'], sources_failed: ['capability_audit_log'] });
  });

  it('a THROWING source read is treated the same (never an unhandled rejection)', async () => {
    const h = harness({ readAdmin: async () => { throw new Error('socket hang up'); } });
    const s = await runAnomalousAccessScan(h.deps);
    expect(s.sourcesFailed).toEqual(['super_admin_audit_logs']);
    expect(s.rulesFailed.sort()).toEqual(['R1b_sensitive_privileged', 'R4_privileged_actor_not_allowlisted', 'R7_system_unexpected_action']);
  });

  it('a TRUNCATED read is loud and its rules are not trusted as quiet', async () => {
    const h = harness({ readAudit: async () => ({ rows: [], truncated: true }) });
    const s = await runAnomalousAccessScan(h.deps);
    expect(h.lines('anomalous_access_source_truncated')).toHaveLength(1);
    expect(s.rulesFailed).toContain('R2_denial_burst');
  });

  it('R4 disabled is SAID every run (warn), not skipped silently', async () => {
    const h = harness({ config: { ...CFG, allowlist: null } });
    await runAnomalousAccessScan(h.deps);
    expect(h.lines('anomalous_access_rule_disabled')).toEqual([{ rule: 'R4_privileged_actor_not_allowlisted', reason: 'AUDIT_PRIVILEGED_ACTOR_IDS not configured' }]);
  });

  it('HEARTBEAT every run: counts, staleness age and per-rule 7-day fires', async () => {
    const h = harness();
    h.setAudit(rep(5, () => a(OTHER, 'PERMISSION_DENIED')));
    await runAnomalousAccessScan(h.deps);
    const hb = h.lines('anomalous_access_scan')[0];
    expect(hb).toMatchObject({ event: 'anomalous_access_scan', rules_run: ALL_RULES.length, findings: 1, alerted: 1, suppressed: 0, rules_disabled: [], rules_failed: [] });
    expect(hb.oldest_threshold_basis_age_days).toBe(7); // basis 2026-11-13, frozen now 2026-11-20
    expect((hb.fires_7d as Record<string, number>).R2_denial_burst).toBe(1);
  });

  it('the window is the last 10 minutes (sinceIso passed to every source)', async () => {
    const seen: string[] = [];
    const h = harness({
      readAudit: async (s) => { seen.push(s); return { rows: [] }; },
      readCapability: async (s) => { seen.push(s); return { rows: [] }; },
      readAdmin: async (s) => { seen.push(s); return { rows: [] }; },
    });
    await runAnomalousAccessScan(h.deps);
    expect(new Set(seen)).toEqual(new Set(['2026-11-20T11:50:00.000Z']));
  });

  it('oldestThresholdBasisAgeDays is computed from the basis dates', () => {
    expect(oldestThresholdBasisAgeDays(Date.parse('2026-11-13T00:00:00Z'))).toBe(0);
    expect(oldestThresholdBasisAgeDays(Date.parse('2027-01-01T00:00:00Z'))).toBe(49);
  });
});
