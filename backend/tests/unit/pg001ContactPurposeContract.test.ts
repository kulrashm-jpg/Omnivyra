/**
 * PG-001 — the approved purpose rule, and proof it is wired EXACTLY where it
 * was authorized and nowhere else.
 *
 * Three jobs:
 *   1. pin the applicability rule and the two conservative defaults, so the
 *      approved model is executable rather than prose;
 *   2. pin the WIRING to an exact allow-list, so a new caller fails here;
 *   3. prove the DR-1 invariant — that NOTHING narrows yet — behaviourally and
 *      by source inspection, because that is the whole safety argument for
 *      shipping a forward-only rollout before LQ-1 is answered.
 *
 * It asserts nothing about how EXISTING records classify. DR-A settled that:
 * forward-only, no backfill, every existing row stays NULL and therefore keeps
 * applying to every purpose.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  mayContact,
  type GovernanceRecord,
} from '../../services/prospectIdentity/contactGovernance';
import { planPersonErasure } from '../../services/prospectIdentity/erasurePlan';
import {
  CONTACT_PURPOSES,
  DEFAULT_CONTACT_PURPOSE,
  isContactPurpose,
  purposeApplies,
  restrictionScopeFromColumn,
  SCOPEABLE_GOVERNANCE_TYPES,
  STORABLE_PURPOSE_SCOPES,
  type ContactPurpose,
} from '../../services/prospectIdentity/contactPurpose';

describe('PG-001 — the approved vocabulary', () => {
  it('1. is exactly the three approved values', () => {
    expect([...CONTACT_PURPOSES]).toEqual(['outreach', 'account', 'all']);
  });

  it('2. defaults to the strictest value', () => {
    expect(DEFAULT_CONTACT_PURPOSE).toBe('all');
  });

  it('3. recognises only those three', () => {
    for (const v of CONTACT_PURPOSES) expect(isContactPurpose(v)).toBe(true);
    for (const v of ['Outreach', 'transactional', '', null, undefined, 0, {}]) {
      expect(isContactPurpose(v)).toBe(false);
    }
  });
});

describe('PG-001 — the applicability rule', () => {
  const SCOPES: ContactPurpose[] = ['outreach', 'account', 'all'];

  it('4. an `all` restriction applies to every attempt', () => {
    for (const attempt of SCOPES) expect(purposeApplies('all', attempt)).toBe(true);
    expect(purposeApplies('all', undefined)).toBe(true);
  });

  it('5. matching scope and purpose apply', () => {
    expect(purposeApplies('outreach', 'outreach')).toBe(true);
    expect(purposeApplies('account', 'account')).toBe(true);
  });

  it('6. a MISMATCH does not apply — the one new capability', () => {
    expect(purposeApplies('outreach', 'account')).toBe(false);
    expect(purposeApplies('account', 'outreach')).toBe(false);
  });

  it('7. an `all` ATTEMPT is subject to every restriction', () => {
    for (const scope of SCOPES) expect(purposeApplies(scope, 'all')).toBe(true);
  });

  it('8. DEFAULT 1 — an unlabelled restriction keeps covering everything', () => {
    for (const attempt of [...SCOPES, undefined, null, 'nonsense']) {
      expect(purposeApplies(null, attempt)).toBe(true);
      expect(purposeApplies(undefined, attempt)).toBe(true);
    }
  });

  it('9. DEFAULT 2 — an undeclared attempt stays subject to everything', () => {
    for (const scope of [...SCOPES, null, undefined, 'nonsense']) {
      expect(purposeApplies(scope, undefined)).toBe(true);
      expect(purposeApplies(scope, null)).toBe(true);
    }
  });

  it('10. an UNKNOWN value on either side can only make the rule stricter', () => {
    // A stale or future value collapses to `all`, so it never narrows.
    expect(purposeApplies('future_purpose', 'account')).toBe(true);
    expect(purposeApplies('outreach', 'future_purpose')).toBe(true);
    expect(purposeApplies('future_a', 'future_b')).toBe(true);
  });

  it('11. the ONLY input combination that does not apply is an explicit mismatch', () => {
    const inputs: unknown[] = ['outreach', 'account', 'all', null, undefined, '', 'nonsense', 7];
    const notApplying: string[] = [];
    for (const scope of inputs) {
      for (const attempt of inputs) {
        if (!purposeApplies(scope, attempt)) notApplying.push(`${String(scope)}->${String(attempt)}`);
      }
    }
    // Exhaustive over the input space: nothing but the two explicit mismatches
    // can ever stop a restriction applying.
    expect(notApplying.sort()).toEqual(['account->outreach', 'outreach->account']);
  });

  it('12. the rule is pure — repeated calls agree and nothing is mutated', () => {
    const before = [...CONTACT_PURPOSES];
    for (let i = 0; i < 3; i += 1) expect(purposeApplies('outreach', 'account')).toBe(false);
    expect([...CONTACT_PURPOSES]).toEqual(before);
  });

  it('13. the column reader treats NULL and anything unknown as `all`', () => {
    expect(restrictionScopeFromColumn(null)).toBe('all');
    expect(restrictionScopeFromColumn(undefined)).toBe('all');
    expect(restrictionScopeFromColumn('nonsense')).toBe('all');
    expect(restrictionScopeFromColumn('outreach')).toBe('outreach');
    expect(restrictionScopeFromColumn('account')).toBe('account');
  });
});

describe('PG-001 — WIRED, and wired EXACTLY where it was authorized', () => {
  const ROOT = join(__dirname, '..', '..', '..');
  const APP_DIRS = ['backend', 'lib', 'pages', 'hooks', 'components'];
  const EXCLUDED_SEGMENTS = ['node_modules', '.next', 'tests', '__tests__', '__mocks__'];

  const sourceFiles = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (abs: string): void => {
      let entries: string[];
      try { entries = readdirSync(abs); } catch { return; }
      for (const name of entries) {
        if (EXCLUDED_SEGMENTS.includes(name)) continue;
        const full = join(abs, name);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) { walk(full); continue; }
        if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
      }
    };
    walk(join(ROOT, dir));
    return out;
  };

  const code = (file: string): string =>
    readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const rel = (f: string): string => relative(ROOT, f).split(sep).join('/');

  const files = APP_DIRS.flatMap(sourceFiles);
  const SELF = 'backend/services/prospectIdentity/contactPurpose.ts';

  /**
   * REPLACES the former "nothing imports this" guard, which Batch B
   * deliberately falsified. STRICTLY STRONGER than what it replaces: it pins an
   * exact allow-list, so any NEW importer fails here just as a first importer
   * used to.
   */
  it('14. `contactPurpose` is imported by exactly the authorized modules', () => {
    expect(files.length).toBeGreaterThan(100);     // the scan is not vacuous

    const importers = files
      .filter((f) => /from\s+['"][^'"]*contactPurpose['"]/.test(code(f)))
      .map(rel)
      .filter((f) => f !== SELF)
      .sort();
    expect(importers).toEqual([
      'backend/services/prospectIdentity/contactGovernance.ts',
      'backend/services/prospectIdentity/contactGovernanceEvaluation.ts',
    ]);
  });

  it('15. the EVALUATOR decides; the shared edge only threads the value', () => {
    // One decision point. A second caller of `purposeApplies` would mean the
    // rule had been duplicated, and two copies can disagree.
    const callers = files
      .filter((f) => /purposeApplies\s*\(/.test(code(f)))
      .map(rel)
      .filter((f) => f !== SELF);
    expect(callers).toEqual(['backend/services/prospectIdentity/contactGovernance.ts']);

    const edge = code(join(ROOT, 'backend/services/prospectIdentity/contactGovernanceEvaluation.ts'));
    expect(edge).toMatch(/attemptPurpose/);
    expect(edge).not.toMatch(/purposeApplies\s*\(/);
  });

  it('16. the filter sits BEFORE the band filter — applicability, not severity', () => {
    // Order is load-bearing: folding purpose into the bands would make an
    // outreach-scoped record look weaker than it is.
    const src = code(join(ROOT, 'backend/services/prospectIdentity/contactGovernance.ts'));
    const purposeAt = src.indexOf('purposeApplies(');
    const bandAt = src.indexOf('GATE_BAND[x.record.governanceType] >= 3');
    expect(purposeAt).toBeGreaterThan(0);
    expect(bandAt).toBeGreaterThan(0);
    expect(purposeAt).toBeLessThan(bandAt);
  });

  it('17. writer, repository and erasure all CARRY the scope', () => {
    // Positive replacement for the former "nobody knows about purpose" guard.
    for (const f of [
      'backend/services/prospectIdentity/contactGovernanceWriter.ts',
      'backend/services/prospectIdentity/contactGovernanceRepository.ts',
      'backend/services/prospectIdentity/personErasure.ts',
      'backend/services/prospectIdentity/erasurePlan.ts',
    ]) {
      expect(code(join(ROOT, f))).toMatch(/purposeScope|purpose_scope/);
    }

    // Erasure must SELECT it, or it cannot carry it forward at all.
    expect(code(join(ROOT, 'backend/services/prospectIdentity/personErasure.ts')))
      .toMatch(/purpose_scope/);
  });

  /**
   * THE DR-1 INVARIANT, MADE EXECUTABLE. Until LQ-1 is resolved, no production
   * path may write a narrow scope. This is the tripwire, and it is the most
   * important assertion in this file.
   */
  it('18. NOTHING NARROWS: no production path writes a narrow scope literal', () => {
    const narrow = /(purposeScope|purpose_scope)\s*:\s*['"](outreach|account)['"]/;
    const offenders = files
      .filter((f) => rel(f) !== SELF)
      .filter((f) => narrow.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('19. the EXECUTION BOUNDARY declares a purpose; non-sending paths do not', () => {
    expect(code(join(ROOT, 'backend/services/leadOutreachExecution/governanceService.ts')))
      .toMatch(/attemptPurpose:\s*'outreach'/);

    // Planning, readiness, export and the Path A check declare nothing, so they
    // evaluate as `all` and stay subject to every restriction.
    for (const f of [
      'backend/services/prospectOutreach/readiness.ts',
      'backend/services/leadIntelligence/leadIntelligenceReadService.ts',
      'lib/leadIntelligence/export.ts',
      'backend/services/execution/suppressionService.ts',
    ]) {
      expect(code(join(ROOT, f))).not.toMatch(/attemptPurpose/);
    }
  });

  it('20. no email send path declares a purpose — E4/E2/E5 are untouched', () => {
    for (const f of [
      'backend/services/emailService.ts',
      'backend/services/domainReminderService.ts',
      'pages/api/cron/email-jobs.ts',
      'backend/services/activationOutreachService.ts',
      'backend/services/leadOutreachExecution/emailTransport.ts',
    ]) {
      expect(code(join(ROOT, f))).not.toMatch(/attemptPurpose|purposeApplies|purposeScope/);
    }
  });

  it('21. the TS vocabularies match the migration CHECKs exactly', () => {
    // A drift here would let code write a scope the database refuses.
    const sql = readFileSync(
      join(ROOT, 'supabase/migrations/20261126000000_pg001_contact_purpose_scope.sql'), 'utf8');

    const types = sql.match(/governance_type IN \(([^)]*)\)/);
    expect(types).not.toBeNull();
    const typesFromSql = (types as RegExpMatchArray)[1]
      .split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
    expect(typesFromSql).toEqual([...SCOPEABLE_GOVERNANCE_TYPES].sort());

    const vals = sql.match(/purpose_scope IN \(([^)]*)\)/);
    expect(vals).not.toBeNull();
    const valsFromSql = (vals as RegExpMatchArray)[1]
      .split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
    expect(valsFromSql).toEqual([...STORABLE_PURPOSE_SCOPES].sort());

    // `all` is never storable — NULL is its only spelling (DR-10).
    expect(valsFromSql).not.toContain('all');
  });

  it('22. the uniqueness key coalesces the scope — the NULL-DISTINCT trap', () => {
    // `IF NOT EXISTS` is OPTIONAL in these patterns but asserted separately
    // below. D-4: the repository's migration-quality gate requires the guard on
    // every CREATE INDEX, and this test previously pinned the unguarded
    // spelling, so correcting the SQL would have turned it red.
    const CREATE_IDX = /CREATE UNIQUE INDEX(?:\s+IF NOT EXISTS)?\s+uq_contact_governance_identity/;

    // A bare column in a UNIQUE index would make two unlabelled rows
    // non-colliding and destroy replay idempotency (ADR 13).
    const sql = readFileSync(
      join(ROOT, 'supabase/migrations/20261126000000_pg001_contact_purpose_scope.sql'), 'utf8');
    expect(sql).toMatch(CREATE_IDX);
    expect(sql).toMatch(/coalesce\(purpose_scope,\s*'all'\)/);

    // ...and the rollback restores the pre-PG-001 definition: same index name,
    // WITHOUT the purpose term.
    const back = readFileSync(
      join(ROOT, 'supabase/migrations/rollbacks/pg001_contact_purpose_scope_rollback.sql'), 'utf8');
    expect(back).toMatch(CREATE_IDX);
    expect(back).toMatch(/coalesce\(person_id::text,\s*target_normalized\)/);
    expect(back).not.toMatch(/coalesce\(purpose_scope/);

    // D-4 REGRESSION GUARD. Every CREATE INDEX in both files must carry the
    // guard, so the gate violation cannot come back unnoticed.
    for (const text of [sql, back]) {
      const creates = text.match(/CREATE\s+(?:UNIQUE\s+)?INDEX[^\n]*/g) ?? [];
      expect(creates.length).toBeGreaterThan(0);
      for (const c of creates) expect(c).toMatch(/IF NOT EXISTS/);
    }

    // The rollback must still refuse to discard recorded decisions.
    expect(back).toMatch(/purpose_scope IS NOT NULL/);
    expect(back).toMatch(/RAISE EXCEPTION/);
  });
});

describe('PG-001 — the evaluator filter, behaviourally', () => {
  const ORG = 'org-1';
  const TARGET = 'someone@example.test';
  const NOW = '2026-10-15T12:00:00.000Z';
  let n = 0;

  const rec = (
    over: Partial<GovernanceRecord> & Pick<GovernanceRecord, 'governanceType'>,
  ): GovernanceRecord => {
    n += 1;
    return {
      id: `r-${n}`,
      organizationId: ORG,
      personId: null,
      targetNormalized: TARGET,
      channel: 'email',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveUntil: null,
      revokedAt: null,
      ...over,
    };
  };

  const evaluate = (records: GovernanceRecord[], attemptPurpose?: ContactPurpose) =>
    mayContact({
      organizationId: ORG,
      targetNormalized: TARGET,
      channel: 'email',
      now: NOW,
      records,
      attemptPurpose,
    });

  it('23. an UNLABELLED restriction still blocks — the forward-only guarantee', () => {
    // This is the whole safety argument for DR-A: every existing row is NULL.
    const r = evaluate([rec({ governanceType: 'unsubscribe', purposeScope: null })], 'outreach');
    expect(r.decision).toBe('blocked');
    expect(r.governanceType).toBe('unsubscribe');
  });

  it('24. an absent (unselected) scope also still blocks', () => {
    expect(evaluate([rec({ governanceType: 'unsubscribe' })], 'outreach').decision).toBe('blocked');
  });

  it('25. an ACCOUNT-scoped restriction does NOT apply to an outreach attempt', () => {
    // The one new capability in the entire feature.
    expect(evaluate([rec({ governanceType: 'unsubscribe', purposeScope: 'account' })], 'outreach').decision)
      .toBe('allowed');
  });

  it('26. an OUTREACH-scoped restriction DOES apply to an outreach attempt', () => {
    expect(evaluate([rec({ governanceType: 'unsubscribe', purposeScope: 'outreach' })], 'outreach').decision)
      .toBe('blocked');
  });

  it('27. an UNDECLARED attempt remains subject to a narrow restriction', () => {
    // Conservative default on the attempt side: omitting the purpose can never
    // buy permission.
    expect(evaluate([rec({ governanceType: 'unsubscribe', purposeScope: 'account' })]).decision).toBe('blocked');
    expect(evaluate([rec({ governanceType: 'unsubscribe', purposeScope: 'outreach' })]).decision).toBe('blocked');
  });

  it('28. an UNRECOGNISED stored scope collapses to `all` and still blocks', () => {
    for (const bogus of ['ALL', 'Outreach', 'future_purpose', '', '  ']) {
      expect(evaluate([rec({ governanceType: 'unsubscribe', purposeScope: bogus })], 'outreach').decision)
        .toBe('blocked');
    }
  });

  it('29. BAND PRECEDENCE survives: removing band 4 lets band 5 decide', () => {
    // Proves the filter runs BEFORE the sort, and that it removes only the
    // record whose scope disagrees rather than collapsing the evaluation.
    //
    // Band 4 would normally win. With the account-scoped unsubscribe correctly
    // out of scope for an outreach attempt, the band-5 record decides instead —
    // and `bounce_hard` is not scopeable, so it cannot itself be dodged.
    const r = evaluate([
      rec({ governanceType: 'unsubscribe', purposeScope: 'account' }),
      rec({ governanceType: 'bounce_hard', purposeScope: null }),
    ], 'outreach');
    expect(r.decision).toBe('blocked');
    expect(r.governanceType).toBe('bounce_hard');
    expect(r.gate).toBe(5);

    // Sanity: with no purpose declared, band 4 wins as it always did.
    const undeclared = evaluate([
      rec({ governanceType: 'unsubscribe', purposeScope: 'account' }),
      rec({ governanceType: 'bounce_hard', purposeScope: null }),
    ]);
    expect(undeclared.governanceType).toBe('unsubscribe');
    expect(undeclared.gate).toBe(4);
  });

  it('30. purpose cannot rescue a record from another TENANT or CHANNEL', () => {
    // Purpose is orthogonal; it must never become a second way to match.
    expect(evaluate([rec({ governanceType: 'unsubscribe', organizationId: 'org-2', purposeScope: 'outreach' })], 'outreach').decision)
      .toBe('allowed');
    expect(evaluate([rec({ governanceType: 'unsubscribe', channel: 'phone', purposeScope: 'outreach' })], 'outreach').decision)
      .toBe('allowed');
  });

  it('31. a NON-SCOPEABLE type is unaffected even if a scope somehow reached it', () => {
    // The database refuses these, so this is defence in depth: an
    // endpoint-intrinsic or purpose-blind type must not become dodgeable by
    // declaring a purpose.
    expect(evaluate([rec({ governanceType: 'bounce_hard', purposeScope: 'account' })], 'outreach').decision)
      .toBe('blocked');
    expect(evaluate([rec({ governanceType: 'dnc_channel', purposeScope: 'account' })], 'outreach').decision)
      .toBe('blocked');
  });

  it('32. `campaign_exclusion` stays inert regardless of purpose', () => {
    expect(evaluate([rec({ governanceType: 'campaign_exclusion', purposeScope: null })], 'outreach').decision)
      .toBe('allowed');
    expect(evaluate([rec({ governanceType: 'campaign_exclusion', purposeScope: 'outreach' })], 'outreach').decision)
      .toBe('allowed');
  });

  it('33b. DR-7 — erasure CARRIES the scope forward, verbatim', () => {
    // Behavioural, not a text match: the planner is pure, so the guarantee can
    // be asserted directly. Dropping the field would WIDEN a narrow restriction
    // and inventing one would NARROW a broad one — either way the person's own
    // instruction would change meaning at the moment they exercised erasure.
    const plan = planPersonErasure({
      organizationId: ORG,
      personId: 'person-1',
      records: [
        rec({ governanceType: 'unsubscribe', personId: 'person-1', purposeScope: 'outreach' }),
        rec({ governanceType: 'complaint', personId: 'person-1', purposeScope: null }),
      ],
      contactPoints: [{ claimType: 'email', normalizedValue: TARGET }],
    });

    const carried = plan.actions.map((a) => a.purposeScope);
    expect(carried).toEqual(['outreach', null]);
    for (const a of plan.actions) expect(a.disposition).toBe('reanchored');
  });

  it('33. a revoked or not-yet-effective record is still ignored', () => {
    // Purpose must not resurrect a record the temporal rules excluded.
    expect(evaluate([rec({ governanceType: 'unsubscribe', purposeScope: 'outreach', revokedAt: NOW })], 'outreach').decision)
      .toBe('allowed');
    expect(evaluate([rec({ governanceType: 'unsubscribe', purposeScope: 'outreach', effectiveFrom: '2099-01-01T00:00:00.000Z' })], 'outreach').decision)
      .toBe('allowed');
  });
});
