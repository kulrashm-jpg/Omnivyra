/**
 * LI-3C — Path B now consumes the canonical governance evaluator.
 *
 * These tests exercise the WIRING, not the rules: the rules belong to
 * `contactGovernance.mayContact` and are covered by its own suite. What matters
 * here is that Path B's suppression gate honours the canonical verdict, maps it
 * into Path B's existing vocabulary, and does not let the legacy booleans
 * override a canonical block.
 *
 * The two halves are tested separately because that is how they are built: the
 * gate is pure and takes a verdict; the repository is impure and produces the
 * records the verdict is computed from.
 */
import { evaluateSuppression, evaluateGovernance, type GovernanceEvaluationInput, type CanonicalGovernanceVerdict } from '../../services/leadOutreachExecution/governance';
import { mayContact, type GovernanceRecord, type GovernanceType } from '../../services/prospectIdentity/contactGovernance';
import { normalizeGovernanceTarget } from '../../services/prospectIdentity/contactGovernanceRepository';
import { GOVERNANCE_VERSION, TRANSLATION_VERSION, EXECUTION_RUNTIME_VERSION } from '../../services/leadOutreachExecution/runtimeVersion';

const NOW = '2026-06-15T12:00:00.000Z';
const ORG_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const ORG_B = 'bbbbbbbb-0000-0000-0000-00000000000b';

const task = (over: Record<string, unknown> = {}) => ({
  id: 't-1', companyId: ORG_A, leadId: 'L1', planTaskId: 'task-1-intro', taskOrder: 1,
  kind: 'outreach', action: 'Send intro', channel: 'email', dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.7, explanation: 'x', requiresApproval: true,
  status: 'approved', plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW, ...over,
}) as unknown as GovernanceEvaluationInput['task'];

const input = (over: Partial<GovernanceEvaluationInput> = {}): GovernanceEvaluationInput => ({
  task: task(),
  config: {
    companyId: ORG_A, configured: true, enabled: true, killSwitch: false,
    enabledChannels: ['email', 'phone', 'whatsapp', 'internal'], restrictedRegions: [],
    dailyLimitTenant: null, dailyLimitLead: null,
  },
  suppressions: { task: false, lead: false, channel: false, recipient: false },
  canonicalGovernance: null,
  usage: { tenantCount: 0, leadCount: 0, windowHours: 24, layer: 'db' },
  globalKillSwitch: false,
  region: null,
  evaluatedAt: NOW,
  ...over,
});

let seq = 0;
const rec = (over: Partial<GovernanceRecord> = {}): GovernanceRecord => ({
  id: `g-${++seq}`, organizationId: ORG_A, personId: 'p-1', targetNormalized: null,
  channel: 'email', governanceType: 'unsubscribe',
  effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveUntil: null, revokedAt: null, ...over,
});

/** Compute a canonical verdict the way governanceService does, then gate it. */
const gateWith = (records: GovernanceRecord[], over: Partial<GovernanceEvaluationInput> = {}, channel = 'email') => {
  const verdict = mayContact({ organizationId: ORG_A, personId: 'p-1', targetNormalized: 'x@y.test', channel, now: NOW, records });
  return evaluateSuppression(input({ canonicalGovernance: verdict as CanonicalGovernanceVerdict, task: task({ channel }), ...over }));
};

describe('LI-3C — Path B honours the canonical verdict', () => {
  it('A. allowed governance permits continuation', () => {
    const g = gateWith([]);
    expect(g.decision).toBe('allowed');
    expect(g.rule).toBe('suppression.none');
  });

  it.each([
    ['B. dnc_permanent', 'dnc_permanent' as GovernanceType, '*'],
    ['E. unsubscribe', 'unsubscribe' as GovernanceType, 'email'],
    ['F. complaint', 'complaint' as GovernanceType, 'email'],
    ['G. invalid_contact', 'invalid_contact' as GovernanceType, 'email'],
    ['H. bounce_hard', 'bounce_hard' as GovernanceType, 'email'],
  ])('%s blocks', (_label, type, ch) => {
    const g = gateWith([rec({ governanceType: type, channel: ch })]);
    expect(g.decision).toBe('blocked');
    expect(g.gate).toBe('suppression');
    expect(g.rule).toBe(`governance.${type}`);
    expect((g.evidence as any).canonical.governanceType).toBe(type);
  });

  it('C. dnc_channel on the matching channel blocks', () => {
    const g = gateWith([rec({ governanceType: 'dnc_channel', channel: 'email' })]);
    expect(g.decision).toBe('blocked');
    expect(g.rule).toBe('governance.dnc_channel');
  });

  it('D. dnc_channel on a different channel does not block', () => {
    const g = gateWith([rec({ governanceType: 'dnc_channel', channel: 'phone' })], {}, 'email');
    expect(g.decision).toBe('allowed');
  });

  it('I. an active deferment DEFERS rather than blocks', () => {
    const g = gateWith([rec({ governanceType: 'deferred', effectiveUntil: '2026-12-31T00:00:00.000Z' })]);
    expect(g.decision).toBe('deferred');
    expect(g.decision).not.toBe('blocked');
    expect((g.evidence as any).deferredUntil).toBe('2026-12-31T00:00:00.000Z');
  });

  it('an undated deferment defers with no end date', () => {
    const g = gateWith([rec({ governanceType: 'deferred', effectiveUntil: null })]);
    expect(g.decision).toBe('deferred');
    expect(g.reason).toMatch(/no stated end date/);
  });

  it('J. an expired deferment allows contact', () => {
    const g = gateWith([rec({ governanceType: 'deferred', effectiveUntil: '2026-02-01T00:00:00.000Z' })]);
    expect(g.decision).toBe('allowed');
  });

  it('K. DNC wins over a deferment', () => {
    const g = gateWith([
      rec({ governanceType: 'deferred', effectiveUntil: '2026-12-31T00:00:00.000Z' }),
      rec({ governanceType: 'dnc_permanent', channel: '*' }),
    ]);
    expect(g.decision).toBe('blocked');
    expect(g.rule).toBe('governance.dnc_permanent');
  });

  it('band 5 (bounce) wins over a deferment', () => {
    const g = gateWith([
      rec({ governanceType: 'deferred', effectiveUntil: '2026-12-31T00:00:00.000Z' }),
      rec({ governanceType: 'bounce_hard' }),
    ]);
    expect(g.decision).toBe('blocked');
    expect(g.rule).toBe('governance.bounce_hard');
  });

  it('O. campaign_exclusion remains inert', () => {
    const g = gateWith([rec({ governanceType: 'campaign_exclusion' })]);
    expect(g.decision).toBe('allowed');
  });
});

describe('LI-3C — tenant isolation through the gate', () => {
  it('L. tenant B governance cannot block tenant A', () => {
    const bRecord = rec({ organizationId: ORG_B, governanceType: 'dnc_permanent', channel: '*' });
    const verdict = mayContact({ organizationId: ORG_A, personId: 'p-1', channel: 'email', now: NOW, records: [bRecord] });
    expect(evaluateSuppression(input({ canonicalGovernance: verdict as CanonicalGovernanceVerdict })).decision).toBe('allowed');
  });

  it('M. the same target in two tenants yields independent results', () => {
    const shared = (org: string) => rec({ organizationId: org, personId: null, targetNormalized: 'shared@x.test', governanceType: 'unsubscribe' });
    const forA = mayContact({ organizationId: ORG_A, targetNormalized: 'shared@x.test', channel: 'email', now: NOW, records: [shared(ORG_A)] });
    const forB = mayContact({ organizationId: ORG_B, targetNormalized: 'shared@x.test', channel: 'email', now: NOW, records: [shared(ORG_A)] });
    expect(forA.decision).toBe('blocked');
    expect(forB.decision).toBe('allowed');   // A's record is invisible to B
  });

  it('N. a person-deleted record still governs by target', () => {
    const orphan = rec({ personId: null, targetNormalized: 'x@y.test', governanceType: 'dnc_permanent', channel: '*' });
    const verdict = mayContact({ organizationId: ORG_A, personId: 'p-NEW', targetNormalized: 'x@y.test', channel: 'email', now: NOW, records: [orphan] });
    const g = evaluateSuppression(input({ canonicalGovernance: verdict as CanonicalGovernanceVerdict }));
    expect(g.decision).toBe('blocked');
    expect((g.evidence as any).canonical.matchedBy).toBe('target');
  });
});

describe('LI-3C — canonical is authoritative, legacy still runs', () => {
  it('a canonical block wins even when every legacy boolean is false', () => {
    const g = gateWith([rec({ governanceType: 'unsubscribe' })], {
      suppressions: { task: false, lead: false, channel: false, recipient: false },
    });
    expect(g.decision).toBe('blocked');
    expect(g.rule).toBe('governance.unsubscribe');
  });

  it('a legacy suppression still blocks when canonical allows — legacy is not disabled', () => {
    const g = gateWith([], { suppressions: { task: false, lead: false, channel: false, recipient: true } });
    expect(g.decision).toBe('blocked');
    expect(g.rule).toBe('suppression.recipient');
  });

  it('a null canonical verdict preserves pre-LI-3C behaviour exactly', () => {
    expect(evaluateSuppression(input({ canonicalGovernance: null })).rule).toBe('suppression.none');
    expect(evaluateSuppression(input({
      canonicalGovernance: null,
      suppressions: { task: true, lead: false, channel: false, recipient: false },
    })).rule).toBe('suppression.task');
  });

  it('a fail-closed lookup blocks', () => {
    // The shape governanceService returns when the governance table is unreadable.
    const failClosed: CanonicalGovernanceVerdict = {
      decision: 'blocked', gate: null, governanceType: null, recordId: null,
      matchedBy: null, reason: 'governance_lookup_failed_failclosed', deferredUntil: null, version: 'li3c',
    };
    const g = evaluateSuppression(input({ canonicalGovernance: failClosed }));
    expect(g.decision).toBe('blocked');
    expect(g.reason).toMatch(/failclosed/);
  });
});

describe('LI-3C — ordering and full-pipeline placement', () => {
  it('kill switch still precedes governance', () => {
    const verdict = mayContact({ organizationId: ORG_A, personId: 'p-1', channel: 'email', now: NOW, records: [rec({ governanceType: 'dnc_permanent', channel: '*' })] });
    const r = evaluateGovernance(input({ globalKillSwitch: true, canonicalGovernance: verdict as CanonicalGovernanceVerdict }));
    expect(r.blockedBy).toBe('kill_switch');
  });

  it('a canonical block short-circuits before approval and rate limit', () => {
    const verdict = mayContact({ organizationId: ORG_A, personId: 'p-1', channel: 'email', now: NOW, records: [rec({ governanceType: 'dnc_permanent', channel: '*' })] });
    const r = evaluateGovernance(input({ canonicalGovernance: verdict as CanonicalGovernanceVerdict }));
    expect(r.blockedBy).toBe('suppression');
    // Quota must never be spent on a task another gate blocked.
    expect(r.gates.map((g) => g.gate)).not.toContain('rate_limit');
  });
});

describe('LI-3C — no duplicated governance logic', () => {
  it('Path B does not reimplement the governance vocabulary', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../services/leadOutreachExecution/governance.ts'), 'utf8');
    // The gate may NAME types in evidence, but must not re-derive banding.
    expect(src).not.toMatch(/GATE_BAND/);
    expect(src).not.toMatch(/dnc_permanent'\s*:/);
    expect(src).not.toMatch(/effectiveUntil/);
  });

  it('the pure evaluator is still the only place rules live', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../services/prospectIdentity/contactGovernance.ts'), 'utf8');
    for (const forbidden of [/ownedDbTable/, /supabase/, /\.insert\(/, /\.from\(/, /new Date\(\)/]) {
      expect(src).not.toMatch(forbidden);
    }
  });

  it('the repository contains no evaluation rules', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../services/prospectIdentity/contactGovernanceRepository.ts'), 'utf8');
    expect(src).not.toMatch(/GATE_BAND/);
    expect(src).not.toMatch(/dnc_permanent/);
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/\.update\(/);
    expect(src).not.toMatch(/\.upsert\(/);
  });
});

describe('LI-3C — target normalisation reuses the canonical normalisers', () => {
  it('normalises email and phone by channel', () => {
    expect(normalizeGovernanceTarget('email', '  Ada@Example.COM ')).toBe('ada@example.com');
    expect(normalizeGovernanceTarget('phone', '+44 20 7946 0000')).toMatch(/^\+?[0-9]+$/);
  });

  it('returns null for an absent target', () => {
    for (const v of [null, undefined, '', '   ']) expect(normalizeGovernanceTarget('email', v as string | null)).toBeNull();
  });

  it('casefolds an unknown future channel rather than guessing', () => {
    expect(normalizeGovernanceTarget('telegram', '  @AdaHandle ')).toBe('@adahandle');
  });
});
