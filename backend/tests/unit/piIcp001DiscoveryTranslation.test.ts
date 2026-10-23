/**
 * PI-ICP-DISCOVERY-001 — ratified ICP criteria → discovery filters.
 *
 * Two halves, deliberately:
 *
 *   TRANSLATION   the pure translator's contract — what maps, what refuses,
 *                 and that a refusal is never an empty filter set.
 *   INTEGRATION   that a refusal PREVENTS the discovery execution, proven by
 *                 the real `createDiscoveryExecution` with its ports injected
 *                 and a spy adapter that must never be reached. An error object
 *                 on its own would prove nothing: the thing that costs a tenant
 *                 money is the provider call, so the assertion is on the call.
 *
 * No provider is contacted, no credential is read, no database is touched.
 */

import {
  translateRatifiedIcpToDiscoveryFilters,
  ICP_TO_DISCOVERY_FILTER,
  TRANSLATABLE_FILTER_KEYS,
  UNMAPPED_ATTRIBUTE_NOTES,
  SHARED_SENIORITY_VALUES,
} from '../../services/prospectDiscovery/icpTranslation';
// The root tsconfig sets `strict: false`, so `ok === false` does not narrow the
// union; refusal-side assertions read the failure arm through this type.
import type { IcpTranslationFailure } from '../../services/prospectDiscovery/icpTranslation';
import { EMPLOYEE_BANDS, SENIORITY_VALUES } from '../../services/prospectIdentity/attributes';
import { APOLLO_DISCOVERY_FILTERS } from '../../services/prospectDiscovery/adapters/apolloDiscovery';
import type { IcpCriterion, RatifiedIcp } from '../../services/prospectIcp/types';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';

const criterion = (over: Partial<IcpCriterion> & { id: string }): IcpCriterion => ({
  kind: 'mandatory',
  subject: 'person',
  attribute: 'job_title',
  predicate: { op: 'one_of', values: ['Head of Platform'] },
  ...over,
} as IcpCriterion);

const ratified = (criteria: IcpCriterion[], organizationId = ORG_A): RatifiedIcp => ({
  organizationId,
  icpId: 'icp-1',
  icpKey: 'primary',
  version: 3,
  criteria,
  ratifiedAt: '2026-05-01T00:00:00.000Z',
  ratifiedBy: 'user-1',
} as RatifiedIcp);

const translate = (
  criteria: IcpCriterion[],
  organizationId = ORG_A,
  icpOrg = ORG_A,
  acknowledgeOmissions?: unknown,
) =>
  translateRatifiedIcpToDiscoveryFilters({
    organizationId,
    ratifiedIcp: ratified(criteria, icpOrg),
    ...(acknowledgeOmissions === undefined ? {} : { acknowledgeOmissions: acknowledgeOmissions as boolean }),
  });

/** Acknowledging, for the many cases where soft criteria are present by design. */
const translateAck = (criteria: IcpCriterion[], organizationId = ORG_A, icpOrg = ORG_A) =>
  translate(criteria, organizationId, icpOrg, true);

describe('PI-ICP-DISCOVERY-001 — what translates', () => {
  it('1. a supported criterion maps to the expected neutral filter', () => {
    const r = translate([criterion({ id: 'c1', predicate: { op: 'one_of', values: ['Head of Platform'] } })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters).toEqual({ titles: ['Head of Platform'] });
    expect(r.translated).toEqual([{ criterionId: 'c1', filterKey: 'titles' }]);
    expect(r.icp).toEqual({ icpId: 'icp-1', version: 3 });
  });

  it('2. multiple supported criteria UNION, preserving meaning', () => {
    // ICP contract 10: selected titles form ONE union. A later criterion must
    // widen the filter, not silently replace the earlier one.
    const r = translate([
      criterion({ id: 'c1', predicate: { op: 'one_of', values: ['Head of Platform', 'CTO'] } }),
      criterion({ id: 'c2', predicate: { op: 'one_of', values: ['CTO', 'VP Engineering'] } }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters.titles).toEqual(['Head of Platform', 'CTO', 'VP Engineering']);
    expect(r.translated).toHaveLength(2);
  });

  it('3. values are trimmed and de-duplicated, blanks dropped', () => {
    const r = translate([criterion({
      id: 'c1', predicate: { op: 'one_of', values: ['  CTO  ', 'CTO', '', '   '] },
    })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters.titles).toEqual(['CTO']);
  });

  it('4. an OPTIONAL criterion is reported and NOT applied - acknowledgement required', () => {
    const criteria = [
      criterion({ id: 'c1' }),                                     // mappable, mandatory
      criterion({ id: 'c2', kind: 'optional', attribute: 'city', predicate: { op: 'one_of', values: ['London'] } }),
    ];
    // Unacknowledged this is now a refusal (PI-ICP-DISCOVERY-002).
    const refused = translate(criteria);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect((refused as IcpTranslationFailure).refusal).toBe('omissions_unacknowledged');

    const r = translateAck(criteria);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters).toEqual({ titles: ['Head of Platform'] });
    expect(r.omitted).toHaveLength(1);
    expect(r.omitted[0]).toMatchObject({ criterionId: 'c2', attribute: 'city', kind: 'optional' });
    expect(r.omissionsAcknowledged).toBe(true);
  });

  it('5. the translator only ever emits keys the adapters accept', () => {
    // The guard against the translator inventing a filter the provider layer
    // would have to ignore or, worse, pass through.
    for (const key of TRANSLATABLE_FILTER_KEYS) {
      expect(Object.keys(APOLLO_DISCOVERY_FILTERS)).toContain(key);
    }
    for (const mapping of Object.values(ICP_TO_DISCOVERY_FILTER)) {
      expect(Object.keys(APOLLO_DISCOVERY_FILTERS)).toContain(mapping.filterKey);
    }
  });
});

describe('PI-ICP-DISCOVERY-001 — what fails closed', () => {
  it('6. a MANDATORY unmappable criterion refuses the whole translation', () => {
    // RETARGETED in PI-ICP-DISCOVERY-005: `seniority` is now mapped on
    // documented evidence, so the canonical unmappable example is headcount —
    // which remains unmapped deliberately. The guarantee is unchanged.
    const r = translate([criterion({
      id: 'c1', subject: 'account', attribute: 'employee_band',
      predicate: { op: 'one_of', values: ['11-50'] },
    })]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r as IcpTranslationFailure).refusal).toBe('unsupported_mandatory_criterion');
    expect((r as IcpTranslationFailure).blocking).toHaveLength(1);
    expect((r as IcpTranslationFailure).blocking[0].reason).toBe(UNMAPPED_ATTRIBUTE_NOTES['account.employee_band']);
  });

  it('7. a REQUIRED criterion is a SCORING input, never a hard filter', () => {
    // CORRECTED in PI-ICP-DISCOVERY-002. `required` used to block here, which
    // was stricter than evaluate.ts:246, where only `mandatory` gates.
    const r = translateAck([
      criterion({ id: 'c1' }),
      criterion({ id: 'c2', kind: 'required', subject: 'account', attribute: 'employee_band', predicate: { op: 'one_of', values: ['11-50'] } }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // It did NOT become a filter, and the result says so explicitly.
    expect(r.filters).toEqual({ titles: ['Head of Platform'] });
    expect(r.omitted.map((o) => o.criterionId)).toEqual(['c2']);
    expect(r.omitted[0].reason).toMatch(/scoring inputs, not discovery filters/);
  });

  it('8. a mapped attribute with the WRONG predicate is refused, never coerced', () => {
    const r = translate([criterion({
      id: 'c1', predicate: { op: 'at_least', value: 3 } as never,
    })]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r as IcpTranslationFailure).refusal).toBe('unsupported_predicate');
    expect((r as IcpTranslationFailure).blocking[0].reason).toMatch(/can only be translated with the `one_of` predicate/);
  });

  it('9. an unsupported predicate on a MANDATORY criterion is blocking', () => {
    // The attribute IS expressible; the criterion asked for something else, and
    // it is the ICP hard gate. Treating that as an omission would quietly
    // answer a different question.
    const r = translate([criterion({
      id: 'c1', kind: 'mandatory', predicate: { op: 'includes_any', values: ['CTO'] } as never,
    })]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r as IcpTranslationFailure).refusal).toBe('unsupported_predicate');

    // A SOFT criterion with the same predicate never reaches that check - it is
    // not a filter at all - so it is an omission, not a block.
    const soft = translateAck([
      criterion({ id: 'c1' }),
      criterion({ id: 'c2', kind: 'optional', predicate: { op: 'includes_any', values: ['CTO'] } as never }),
    ]);
    expect(soft.ok).toBe(true);
    if (soft.ok) expect(soft.omitted.map((o) => o.criterionId)).toEqual(['c2']);
  });

  it('10. a mapped criterion with no usable values is refused', () => {
    for (const values of [[], ['', '  '], 'CTO' as never, null as never]) {
      const r = translate([criterion({ id: 'c1', predicate: { op: 'one_of', values } as never })]);
      expect(r.ok).toBe(false);
    }
  });

  it('11. EMPTY criteria cannot become an unrestricted search', () => {
    // The single most dangerous failure mode: "we cannot express your target"
    // turning into "fetch everyone".
    const r = translate([]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r as IcpTranslationFailure).refusal).toBe('no_translatable_criteria');
    expect((r as IcpTranslationFailure).detail).toMatch(/unrestricted search/);
  });

  it('12. an all-OPTIONAL unmappable ICP refuses rather than returning {}', () => {
    const criteria = [
      criterion({ id: 'c1', kind: 'optional', attribute: 'city', predicate: { op: 'one_of', values: ['London'] } }),
      criterion({ id: 'c2', kind: 'optional', subject: 'account', attribute: 'industry', predicate: { op: 'one_of', values: ['SaaS'] } }),
    ];
    const r = translate(criteria);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r as IcpTranslationFailure).refusal).toBe('no_translatable_criteria');
    expect((r as IcpTranslationFailure).blocking).toHaveLength(2);

    // Acknowledging does NOT make an empty filter set acceptable: the
    // unrestricted-search guard is checked first and is not waivable.
    const acked = translateAck(criteria);
    expect(acked.ok).toBe(false);
    if (!acked.ok) expect((acked as IcpTranslationFailure).refusal).toBe('no_translatable_criteria');
  });

  it('13. a malformed criterion is refused, not skipped', () => {
    expect(translate([{ id: 'c1', kind: 'mandatory', subject: 'nope', attribute: 'job_title', predicate: { op: 'one_of', values: ['x'] } } as never]).ok).toBe(false);
    expect(translate([{ id: 'c2', kind: 'mandatory', subject: 'person', attribute: '', predicate: { op: 'one_of', values: ['x'] } } as never]).ok).toBe(false);
    expect(translate([{ id: 'c3', kind: 'bogus', subject: 'person', attribute: 'job_title', predicate: { op: 'one_of', values: ['x'] } } as never]).ok).toBe(false);
  });
});

describe('PI-ICP-DISCOVERY-001 — ratification and tenant boundaries', () => {
  it('14. tenant A’s ICP cannot build tenant B’s discovery request', () => {
    const r = translateRatifiedIcpToDiscoveryFilters({
      organizationId: ORG_B,                        // the VERIFIED request tenant
      ratifiedIcp: ratified([criterion({ id: 'c1' })], ORG_A),   // someone else's ICP
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r as IcpTranslationFailure).refusal).toBe('tenant_mismatch');
    // Nothing from the foreign ICP leaked into the refusal.
    expect(JSON.stringify(r)).not.toContain('Head of Platform');
    expect(JSON.stringify(r)).not.toContain('icp-1');
  });

  it('15. a tenant-less translation is refused before any criterion is read', () => {
    const r = translateRatifiedIcpToDiscoveryFilters({
      organizationId: '   ',
      ratifiedIcp: ratified([criterion({ id: 'c1' })]),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r as IcpTranslationFailure).refusal).toBe('tenant_mismatch');
    expect((r as IcpTranslationFailure).blocking).toEqual([]);
  });

  it('16. the ratification contract is enforced by the TYPE, not a runtime guess', () => {
    // `RatifiedIcp` is the narrowed type the evaluator already requires, so a
    // draft or proposed version cannot be passed without a deliberate cast.
    // This pins the shape the translator depends on rather than re-checking a
    // status string the document does not carry.
    const icp = ratified([criterion({ id: 'c1' })]);
    expect(Object.keys(icp)).toEqual(expect.arrayContaining([
      'organizationId', 'icpId', 'version', 'criteria', 'ratifiedAt', 'ratifiedBy',
    ]));
    expect('status' in icp).toBe(false);
  });

  it('17. the translator is PURE — no clock, no I/O, repeatable', () => {
    const criteria = [criterion({ id: 'c1' })];
    const a = translateAck(criteria);
    const b = translateAck(criteria);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // ...and it did not mutate its input.
    expect(criteria[0].predicate).toEqual({ op: 'one_of', values: ['Head of Platform'] });
  });

  it('18. the module imports no HTTP primitive and no credential reader', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/prospectDiscovery/icpTranslation.ts'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['fetch(', 'axios', 'ownedDbTable', 'resolveCredential', 'process.env']) {
      expect(src).not.toContain(forbidden);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION — a refusal must PREVENT the execution, not merely report one.
// ─────────────────────────────────────────────────────────────────────────────

describe('PI-ICP-DISCOVERY-001 — a refusal prevents the discovery execution', () => {
  const BOUNDS = { maxPages: 1, maxResults: 10, maxProviderCalls: 1 };
  const NOW = '2026-06-01T00:00:00.000Z';

  /** Records every port the executor reaches, so "never called" is assertable. */
  const spyPorts = () => {
    const seen: string[] = [];
    const adapter = { provider: 'synthetic', discover: jest.fn(async () => ({ records: [], continuation: null })) };
    return {
      seen,
      adapter,
      ports: {
        now: () => NOW,
        gate: jest.fn(async () => { seen.push('gate'); return { allowed: true, reason: 'test' }; }),
        hasTranslator: () => true,
        hasProvider: () => true,
        getProvider: () => { seen.push('getProvider'); return adapter as never; },
        credential: {
          resolveCredential: jest.fn(async () => { seen.push('credential'); return 'test-credential'; }),
        } as never,
        authorizeCost: jest.fn(async () => { seen.push('authorizeCost'); return { authorized: true } as never; }),
        nextAttemptNumber: jest.fn(async () => { seen.push('nextAttemptNumber'); return 1; }),
        claim: jest.fn(async () => { seen.push('claim'); return { claimed: true, id: 'exec-1', attemptNumber: 1, reclaimed: false } as never; }),
        complete: jest.fn(async () => { seen.push('complete'); }),
      },
    };
  };

  it('19. an unsupported ICP never reaches the ledger, the credential or the adapter', async () => {
    const { seen, adapter, ports } = spyPorts();
    const { createDiscoveryExecution } = require('../../services/prospectDiscovery/discoveryExecutor');

    const translation = translate([criterion({
      id: 'c1', subject: 'account', attribute: 'employee_band',
      predicate: { op: 'one_of', values: ['11-50'] },
    })]);
    expect(translation.ok).toBe(false);

    // The caller MUST NOT proceed. This is the guarantee, expressed the only way
    // that matters: the execution is never created.
    if (!translation.ok) {
      expect(seen).toEqual([]);
      expect(adapter.discover).not.toHaveBeenCalled();
      expect(ports.claim).not.toHaveBeenCalled();
      expect((ports.credential as unknown as { resolveCredential: jest.Mock }).resolveCredential).not.toHaveBeenCalled();
      return;
    }
    // Unreachable: a defect in the translator would land here and fail loudly
    // rather than quietly creating an execution.
    await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: translation.filters, bounds: BOUNDS, correlationId: 'c' },
      ports,
    );
    throw new Error('an unsupported ICP must not have produced filters');
  });

  it('20. a SUPPORTED translation produces an execution, and no provider call', async () => {
    const { seen, adapter, ports } = spyPorts();
    const { createDiscoveryExecution } = require('../../services/prospectDiscovery/discoveryExecutor');

    const translation = translate([criterion({ id: 'c1' })]);
    expect(translation.ok).toBe(true);
    if (!translation.ok) return;

    const r = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: translation.filters, bounds: BOUNDS, correlationId: 'c' },
      ports,
    );

    expect(r.created).toBe(true);
    expect(seen).toContain('claim');
    expect(r.refusal).toBeNull();
    // Ready means "a provider call COULD now be made" — reported, never acted
    // upon. Creating an execution is NOT a provider call.
    expect(r.readyForProviderExecution).toBe(true);
    expect(adapter.discover).not.toHaveBeenCalled();
    // The filters the ledger recorded are the TRANSLATED ones, unaltered.
    expect(ports.claim).toHaveBeenCalledWith(expect.objectContaining({
      canonicalFilters: { titles: ['Head of Platform'] },
    }));
  });

  it('21. a MISSING tenant credential keeps the existing fail-closed behaviour', async () => {
    const { adapter, ports } = spyPorts();
    const { createDiscoveryExecution } = require('../../services/prospectDiscovery/discoveryExecutor');
    const noCredential = {
      ...ports,
      credential: { resolveCredential: jest.fn(async () => null) } as never,
    };

    const translation = translate([criterion({ id: 'c1' })]);
    expect(translation.ok).toBe(true);
    if (!translation.ok) return;

    const r = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: translation.filters, bounds: BOUNDS, correlationId: 'c' },
      noCredential,
    );

    // The EXISTING lifecycle: the refusal is RECORDED as evidence rather than
    // thrown away — the execution exists, is closed `refused_pre_call`, and
    // states that transport never happened.
    expect(r.created).toBe(true);
    expect(r.refusal).toBe('credential_missing');
    expect(r.readyForProviderExecution).toBe(false);
    expect(noCredential.complete).toHaveBeenCalledWith(expect.objectContaining({
      executionStatus: 'refused_pre_call',
      providerCallState: 'not_called',
      outcome: 'credential_missing',
    }));
    expect(adapter.discover).not.toHaveBeenCalled();
  });

  it('22. existing discovery behaviour is unchanged for explicit filters', async () => {
    // The pre-existing path — caller-supplied neutral filters, no ICP involved —
    // must behave exactly as before. This batch adds a producer of filters; it
    // does not change the consumer.
    const { adapter, ports } = spyPorts();
    const { createDiscoveryExecution } = require('../../services/prospectDiscovery/discoveryExecutor');

    const r = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: { titles: ['CTO'] }, bounds: BOUNDS, correlationId: 'c' },
      ports,
    );
    expect(r.created).toBe(true);
    expect(adapter.discover).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PI-ICP-DISCOVERY-002 — only mandatory criteria filter; omissions need consent
// ─────────────────────────────────────────────────────────────────────────────

describe('PI-ICP-DISCOVERY-002 - hard-filter semantics by criterion kind', () => {
  it('23. a MANDATORY job_title still translates, with no omissions to acknowledge', () => {
    const r = translate([criterion({ id: 'c1', kind: 'mandatory' })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters).toEqual({ titles: ['Head of Platform'] });
    expect(r.omitted).toEqual([]);
    // No omissions, so no acknowledgement was needed or claimed.
    expect(r.omissionsAcknowledged).toBe(false);
  });

  it('24. a REQUIRED job_title does NOT become a hard filter', () => {
    const r = translateAck([
      criterion({ id: 'c1', kind: 'mandatory' }),
      criterion({ id: 'c2', kind: 'required', predicate: { op: 'one_of', values: ['CFO'] } }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // CFO must NOT appear: a required criterion is a scoring input.
    expect(r.filters).toEqual({ titles: ['Head of Platform'] });
    expect(JSON.stringify(r.filters)).not.toContain('CFO');
    expect(r.omitted.map((o) => o.criterionId)).toEqual(['c2']);
  });

  it('25. an OPTIONAL job_title does NOT become a hard filter', () => {
    const r = translateAck([
      criterion({ id: 'c1', kind: 'mandatory' }),
      criterion({ id: 'c2', kind: 'optional', predicate: { op: 'one_of', values: ['COO'] } }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters).toEqual({ titles: ['Head of Platform'] });
    expect(JSON.stringify(r.filters)).not.toContain('COO');
  });

  it('26. an ICP of ONLY soft criteria refuses - never an unrestricted search', () => {
    for (const kind of ['required', 'optional'] as const) {
      const r = translate([criterion({ id: 'c1', kind })]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect((r as IcpTranslationFailure).refusal).toBe('no_translatable_criteria');
    }
  });

  it('27. an unmappable MANDATORY criterion blocks even when another one maps', () => {
    const r = translateAck([
      criterion({ id: 'c1', kind: 'mandatory' }),                               // maps
      criterion({ id: 'c2', kind: 'mandatory', subject: 'account', attribute: 'employee_band', predicate: { op: 'one_of', values: ['11-50'] } }),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r as IcpTranslationFailure).refusal).toBe('unsupported_mandatory_criterion');
    expect((r as IcpTranslationFailure).blocking.map((b) => b.criterionId)).toEqual(['c2']);
    // Acknowledgement cannot waive a mandatory block.
    expect(JSON.stringify(r)).not.toContain('titles');
  });

  it('28. soft criteria cannot override, weaken or replace a mandatory filter', () => {
    const r = translateAck([
      criterion({ id: 'mand', kind: 'mandatory', predicate: { op: 'one_of', values: ['Head of Platform'] } }),
      criterion({ id: 'soft', kind: 'required', predicate: { op: 'one_of', values: ['Intern'] } }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters.titles).toEqual(['Head of Platform']);
    expect(r.translated.map((t) => t.criterionId)).toEqual(['mand']);
  });
});

describe('PI-ICP-DISCOVERY-002 - the omission acknowledgement', () => {
  const withSoft = () => [
    criterion({ id: 'c1', kind: 'mandatory' }),
    criterion({ id: 'c2', kind: 'optional', attribute: 'city', predicate: { op: 'one_of', values: ['London'] } }),
  ];

  it('29. omissions WITHOUT acknowledgement refuse, listing every omission', () => {
    const r = translate(withSoft());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r as IcpTranslationFailure).refusal).toBe('omissions_unacknowledged');
    expect((r as IcpTranslationFailure).blocking.map((b) => b.criterionId)).toEqual(['c2']);
    expect((r as IcpTranslationFailure).detail).toMatch(/narrower than the ICP/);
  });

  it('30. acknowledgement permits it, and the omission list survives in full', () => {
    const r = translateAck(withSoft());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.omitted).toHaveLength(1);
    expect(r.omitted[0]).toMatchObject({
      criterionId: 'c2', subject: 'person', attribute: 'city', kind: 'optional',
    });
    expect(r.omitted[0].reason.length).toBeGreaterThan(10);
    expect(r.omissionsAcknowledged).toBe(true);
  });

  it('31. INVALID acknowledgement values fail closed - strict `true` only', () => {
    for (const bogus of [false, 'true', 'yes', 1, 0, null, {}, [], 'TRUE']) {
      const r = translate(withSoft(), ORG_A, ORG_A, bogus);
      expect(r.ok).toBe(false);
      if (!r.ok) expect((r as IcpTranslationFailure).refusal).toBe('omissions_unacknowledged');
    }
  });

  it('32. acknowledgement cannot manufacture a result from nothing', () => {
    // No mandatory filter remains, so there is nothing to acknowledge INTO.
    expect(translateAck([]).ok).toBe(false);
    const r = translateAck([criterion({ id: 'c1', kind: 'optional' })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r as IcpTranslationFailure).refusal).toBe('no_translatable_criteria');
  });
});

describe('PI-ICP-DISCOVERY-002 - location stays UNMAPPED pending provider evidence', () => {
  it('33. a MANDATORY location criterion blocks, citing ITS OWN evidence gap', () => {
    // PI-ICP-DISCOVERY-006. The three attributes no longer share one note. The
    // provider documents a bare city, so city is blocked by its MATCHING
    // semantics; region is blocked by its unconstrained vocabulary; and
    // country_code by the unproven acceptance of a two-letter code. Comparing
    // against the exported constant keeps this assertion wording-independent —
    // the positive assertions in 33a are what prove the reasons are distinct.
    for (const attribute of ['city', 'region', 'country_code']) {
      const r = translate([criterion({ id: 'c1', kind: 'mandatory', attribute, predicate: { op: 'one_of', values: ['London'] } })]);
      expect(r.ok).toBe(false);
      if (r.ok === false) {
        expect((r as IcpTranslationFailure).refusal).toBe('unsupported_mandatory_criterion');
        expect((r as IcpTranslationFailure).blocking).toHaveLength(1);
        expect((r as IcpTranslationFailure).blocking[0].reason).toBe(UNMAPPED_ATTRIBUTE_NOTES[`person.${attribute}`]);
        // Substantive, and never the generic fallback.
        expect((r as IcpTranslationFailure).blocking[0].reason.length).toBeGreaterThan(10);
        expect((r as IcpTranslationFailure).blocking[0].reason).not.toBe('no provider-neutral discovery filter expresses this attribute');
        // The old note embedded a place name. A static example value inside a
        // refusal is echoed back to whichever tenant submitted that very
        // value, so no location note may carry one.
        expect((r as IcpTranslationFailure).blocking[0].reason).not.toContain('London');
      }
    }
  });

  it('33a. each person-location reason names ITS OWN blocker', () => {
    expect(UNMAPPED_ATTRIBUTE_NOTES['person.city']).toMatch(/exact and case-sensitive/);
    expect(UNMAPPED_ATTRIBUTE_NOTES['person.region']).toMatch(/UNCONSTRAINED text/);
    expect(UNMAPPED_ATTRIBUTE_NOTES['person.country_code']).toMatch(/standalone two-letter code is accepted/);
    // Three strings, not one repeated three times.
    expect(new Set([
      UNMAPPED_ATTRIBUTE_NOTES['person.city'],
      UNMAPPED_ATTRIBUTE_NOTES['person.region'],
      UNMAPPED_ATTRIBUTE_NOTES['person.country_code'],
    ]).size).toBe(3);
    // None of them promises that a mapping is coming.
    for (const attribute of ['city', 'region', 'country_code']) {
      expect(UNMAPPED_ATTRIBUTE_NOTES[`person.${attribute}`]).not.toMatch(/approved in principle/);
    }
  });

  it('34. no location key can reach the filters by any route', () => {
    const r = translateAck([
      criterion({ id: 'c1', kind: 'mandatory' }),
      criterion({ id: 'c2', kind: 'optional', attribute: 'city', predicate: { op: 'one_of', values: ['London'] } }),
      criterion({ id: 'c3', kind: 'required', attribute: 'country_code', predicate: { op: 'one_of', values: ['GB'] } }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.filters)).toEqual(['titles']);
    expect(r.filters).not.toHaveProperty('locations');
    expect(JSON.stringify(r.filters)).not.toContain('London');
    expect(JSON.stringify(r.filters)).not.toContain('GB');
  });

  it('35. the mapping table still emits only keys the adapter accepts', () => {
    expect(Object.keys(ICP_TO_DISCOVERY_FILTER).sort())
      .toEqual(['person.job_title', 'person.seniority']);
    for (const m of Object.values(ICP_TO_DISCOVERY_FILTER)) {
      expect(Object.keys(APOLLO_DISCOVERY_FILTERS)).toContain(m.filterKey);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PI-ICP-DISCOVERY-005 — the evidenced seniority mapping
// ─────────────────────────────────────────────────────────────────────────────

const seniority = (values: string[], kind: IcpCriterion['kind'] = 'mandatory', id = 'c-sen'): IcpCriterion =>
  criterion({ id, kind, subject: 'person', attribute: 'seniority', predicate: { op: 'one_of', values } });

describe('PI-ICP-005 - the 11 shared seniority tokens', () => {
  it('36. the shared list is exactly what the provider documents', () => {
    expect([...SHARED_SENIORITY_VALUES]).toEqual([
      'owner', 'founder', 'c_suite', 'partner', 'vp', 'head',
      'director', 'manager', 'senior', 'entry', 'intern',
    ]);
    // ...and it is the ICP vocabulary MINUS `other`, nothing else.
    const icpMinusOther = [...SENIORITY_VALUES].filter((v) => v !== 'other').sort();
    expect([...SHARED_SENIORITY_VALUES].sort()).toEqual(icpMinusOther);
  });

  it('37. EVERY shared token maps by identity, one at a time', () => {
    for (const token of SHARED_SENIORITY_VALUES) {
      const r = translate([seniority([token])]);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      // Identity: the value Apollo receives is the value the ICP stated.
      expect(r.filters).toEqual({ seniorities: [token] });
    }
  });

  it('38. multiple values preserve OR semantics as one union', () => {
    const r = translate([seniority(['director', 'vp', 'c_suite'])]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters.seniorities).toEqual(['director', 'vp', 'c_suite']);
  });

  it('39. two seniority criteria UNION rather than the later one winning', () => {
    const r = translate([
      seniority(['director'], 'mandatory', 'c1'),
      seniority(['vp', 'director'], 'mandatory', 'c2'),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters.seniorities).toEqual(['director', 'vp']);
  });

  it('40. seniority and titles coexist as two independent filters', () => {
    const r = translate([criterion({ id: 'c-title' }), seniority(['head'])]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters).toEqual({ titles: ['Head of Platform'], seniorities: ['head'] });
  });
});

describe('PI-ICP-005 - `other` and unknown values refuse the WHOLE criterion', () => {
  it('41. a criterion containing `other` is refused, not trimmed', () => {
    const r = translate([seniority(['director', 'other'])]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r as IcpTranslationFailure).refusal).toBe('unsupported_criterion_value');
    expect((r as IcpTranslationFailure).blocking.map((b) => b.criterionId)).toEqual(['c-sen']);
    // The decisive assertion: `director` did NOT survive on its own. Dropping an
    // alternative from a disjunction narrows the search.
    expect(JSON.stringify(r)).not.toContain('seniorities');
  });

  it('42. `other` alone is refused', () => {
    const r = translate([seniority(['other'])]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r as IcpTranslationFailure).refusal).toBe('unsupported_criterion_value');
  });

  it('43. an UNKNOWN token is refused, with no partial filter emitted', () => {
    for (const bogus of ['chief', 'svp', 'Director ', 'DIRECTOR_OF_THINGS', 'c-suite']) {
      const r = translate([seniority(['director', bogus])]);
      // `Director ` trims to `director` and IS valid; the rest are not.
      if (bogus.trim().toLowerCase() === 'director') {
        expect(r.ok).toBe(true);
        continue;
      }
      expect(r.ok).toBe(false);
      if (!r.ok) expect((r as IcpTranslationFailure).refusal).toBe('unsupported_criterion_value');
    }
  });

  it('44. casing is tolerated because the value contract is case-insensitive', () => {
    const r = translate([seniority(['Director', 'VP'])]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Passed through as the ICP wrote them; the CHECK was case-insensitive.
    expect(r.filters.seniorities).toEqual(['Director', 'VP']);
  });

  it('45. a refusal never leaks the rejected values themselves', () => {
    const r = translate([seniority(['top_brass_secret'])]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(JSON.stringify(r)).not.toContain('top_brass_secret');
    expect((r as IcpTranslationFailure).blocking[0].reason).toMatch(/does not document/);
  });

  it('46. an unsupported PREDICATE on seniority refuses', () => {
    const r = translate([criterion({
      id: 'c-sen', subject: 'person', attribute: 'seniority',
      predicate: { op: 'includes_any', values: ['director'] } as never,
    })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r as IcpTranslationFailure).refusal).toBe('unsupported_predicate');
  });

  it('47. no usable values refuses', () => {
    expect(translate([seniority([])]).ok).toBe(false);
    expect(translate([seniority(['', '  '])]).ok).toBe(false);
  });
});

describe('PI-ICP-005 - soft seniority criteria are still not filters', () => {
  it('48. a REQUIRED seniority criterion never becomes a hard filter', () => {
    const r = translateAck([criterion({ id: 'c-title' }), seniority(['director'], 'required')]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters).toEqual({ titles: ['Head of Platform'] });
    expect(r.filters).not.toHaveProperty('seniorities');
    expect(r.omitted.map((o) => o.criterionId)).toEqual(['c-sen']);
  });

  it('49. an OPTIONAL seniority criterion never becomes a hard filter', () => {
    const r = translateAck([criterion({ id: 'c-title' }), seniority(['vp'], 'optional')]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters).not.toHaveProperty('seniorities');
  });

  it('50. a soft seniority criterion containing `other` is an omission, not a refusal', () => {
    // It never reaches the value contract, because it is not a filter at all.
    const r = translateAck([criterion({ id: 'c-title' }), seniority(['other'], 'optional')]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.omitted.map((o) => o.criterionId)).toEqual(['c-sen']);
  });

  it('51. an all-soft seniority ICP still cannot become an unrestricted search', () => {
    const r = translate([seniority(['director'], 'optional')]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r as IcpTranslationFailure).refusal).toBe('no_translatable_criteria');
  });

  it('52. a mandatory TITLE criterion is unchanged by soft seniority noise', () => {
    const r = translateAck([
      criterion({ id: 'c-title', predicate: { op: 'one_of', values: ['Head of Platform', 'CTO'] } }),
      seniority(['intern'], 'optional', 's1'),
      seniority(['entry'], 'required', 's2'),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters).toEqual({ titles: ['Head of Platform', 'CTO'] });
    expect(r.translated.map((t) => t.criterionId)).toEqual(['c-title']);
  });
});

describe('PI-ICP-DISCOVERY-006 - a refusal explains the REAL blocker', () => {
  // These notes are tenant-facing verbatim: the discovery route returns each
  // one as `blocking[].reason`. A reason that names a difficulty which does not
  // exist is wrong information handed to a tenant about their own ICP, so the
  // text is part of the contract and is asserted here.

  it('57. a MANDATORY headcount-count criterion blocks on EVERY legal predicate', () => {
    // `employee_count` is `numeric`, so these three are the whole legal surface
    // (criteria.ts OPS_BY_KIND). One note has to be true of all three.
    const predicates: IcpCriterion['predicate'][] = [
      { op: 'between', min: 40, max: 90 },
      { op: 'at_least', value: 40 },
      { op: 'at_most', value: 90 },
    ];
    for (const predicate of predicates) {
      const r = translate([criterion({
        id: 'c1', kind: 'mandatory', subject: 'account', attribute: 'employee_count', predicate,
      })]);
      expect(r.ok).toBe(false);
      if (r.ok === false) {
        expect((r as IcpTranslationFailure).refusal).toBe('unsupported_mandatory_criterion');
        expect((r as IcpTranslationFailure).blocking).toHaveLength(1);
        expect((r as IcpTranslationFailure).blocking[0].reason).toBe(UNMAPPED_ATTRIBUTE_NOTES['account.employee_count']);
        expect((r as IcpTranslationFailure).blocking[0].reason).not.toBe('no provider-neutral discovery filter expresses this attribute');
      }
    }
  });

  it('58. the headcount-count reason names all three unresolved issues', () => {
    const note = UNMAPPED_ATTRIBUTE_NOTES['account.employee_count'];
    // 1. endpoint inclusivity, stated about OUR semantics and left open about theirs.
    expect(note).toMatch(/include their own bounds/);
    // 2. the unknown-headcount divergence against this evaluator's abstention.
    expect(note).toMatch(/abstains on a missing value/);
    // 3. open-ended predicates have no established equivalent at all.
    expect(note).toMatch(/open-ended minimum or maximum/);
    // And the correction itself: the old text claimed a numeric range must
    // become provider BANDS, which the provider's documented range form shows
    // is not so. Structural compatibility is not approval.
    expect(note).not.toMatch(/re-expressed as provider bands/);
    expect(note).toMatch(/Mapping stays refused/);
  });

  it('59. the headcount-BAND reason is deliberately untouched', () => {
    // A-2 was excluded from this batch: the band note was assessed accurate.
    expect(UNMAPPED_ATTRIBUTE_NOTES['account.employee_band'])
      .toBe('the band FORM differs from the provider’s and no provider call has ever confirmed the accepted ranges');
  });

  it('60. a MANDATORY ACCOUNT-location criterion blocks on the SUBJECT, not the format', () => {
    for (const attribute of ['city', 'region', 'country_code']) {
      const r = translate([criterion({
        id: 'c1', kind: 'mandatory', subject: 'account', attribute,
        predicate: { op: 'one_of', values: ['Sentinelborough'] },
      })]);
      expect(r.ok).toBe(false);
      if (r.ok === false) {
        expect((r as IcpTranslationFailure).refusal).toBe('unsupported_mandatory_criterion');
        expect((r as IcpTranslationFailure).blocking[0].reason).toBe(UNMAPPED_ATTRIBUTE_NOTES[`account.${attribute}`]);
        // Specifically NOT the generic fallback, which claimed no neutral
        // filter expresses the attribute. One does — it is a person's.
        expect((r as IcpTranslationFailure).blocking[0].reason).not.toBe('no provider-neutral discovery filter expresses this attribute');
        // And it is not the person-side reason for the same attribute name.
        expect((r as IcpTranslationFailure).blocking[0].reason).not.toBe(UNMAPPED_ATTRIBUTE_NOTES[`person.${attribute}`]);
        expect((r as IcpTranslationFailure).blocking[0].reason).not.toContain('Sentinelborough');
      }
    }
  });

  it('61. the account-location reason names the subject mismatch and the HQ-only limit', () => {
    const notes = ['city', 'region', 'country_code']
      .map((a) => UNMAPPED_ATTRIBUTE_NOTES[`account.${a}`]);
    // One shared message, deliberately: the blocker is identical for all three.
    expect(new Set(notes).size).toBe(1);
    const note = notes[0];
    expect(note).toMatch(/where a PERSON lives/);
    expect(note).toMatch(/wrong subject/);
    expect(note).toMatch(/headquarters only/);
    expect(note).toMatch(/not available here/);
  });

  it('62. an ACCOUNT-location criterion can never reach the person locations filter', () => {
    const r = translateAck([
      criterion({ id: 'c1', kind: 'mandatory' }),
      criterion({ id: 'c2', kind: 'optional', subject: 'account', attribute: 'city', predicate: { op: 'one_of', values: ['Sentinelborough'] } }),
      criterion({ id: 'c3', kind: 'required', subject: 'account', attribute: 'country_code', predicate: { op: 'one_of', values: ['ZZ'] } }),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    expect(Object.keys(r.filters)).toEqual(['titles']);
    expect(r.filters).not.toHaveProperty('locations');
    expect(JSON.stringify(r.filters)).not.toContain('Sentinelborough');
    expect(JSON.stringify(r.filters)).not.toContain('ZZ');
    // Reported, never silently dropped.
    expect(r.omitted.map((o) => o.criterionId).sort()).toEqual(['c2', 'c3']);
  });

  it('63. no note promises a mapping, and none carries an example value', () => {
    for (const [key, note] of Object.entries(UNMAPPED_ATTRIBUTE_NOTES)) {
      expect(note.length).toBeGreaterThan(10);
      expect(note).not.toMatch(/approved in principle/);
      // A static example value inside a refusal is echoed to whichever tenant
      // submitted that very value. None of these may carry one.
      expect(note).not.toMatch(/London|United Kingdom/);
      for (const band of EMPLOYEE_BANDS) expect(note).not.toContain(band);
      expect(key).toMatch(/^(account|person)\./);
    }
    expect(Object.keys(UNMAPPED_ATTRIBUTE_NOTES).sort()).toEqual([
      'account.city', 'account.country_code', 'account.employee_band',
      'account.employee_count', 'account.region',
      'person.city', 'person.country_code', 'person.region',
    ]);
  });
});

describe('PI-ICP-005 - the rest of the contract is untouched', () => {
  it('53. headcount and location remain UNMAPPED', () => {
    expect(Object.keys(ICP_TO_DISCOVERY_FILTER).sort()).toEqual(['person.job_title', 'person.seniority']);
    for (const attribute of ['employee_band', 'employee_count']) {
      const r = translate([criterion({ id: 'c1', subject: 'account', attribute, predicate: { op: 'one_of', values: ['11-50'] } })]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect((r as IcpTranslationFailure).refusal).toBe('unsupported_mandatory_criterion');
    }
    for (const attribute of ['city', 'region', 'country_code']) {
      const r = translate([criterion({ id: 'c1', attribute, predicate: { op: 'one_of', values: ['London'] } })]);
      expect(r.ok).toBe(false);
      if (r.ok === false) {
        expect((r as IcpTranslationFailure).refusal).toBe('unsupported_mandatory_criterion');
        expect((r as IcpTranslationFailure).blocking[0].reason).toBe(UNMAPPED_ATTRIBUTE_NOTES[`person.${attribute}`]);
      }
    }
    expect(Object.keys(UNMAPPED_ATTRIBUTE_NOTES)).not.toContain('person.seniority');
  });

  it('54. every emitted key is still one the adapter accepts', () => {
    expect([...TRANSLATABLE_FILTER_KEYS]).toEqual(['titles', 'seniorities']);
    for (const key of TRANSLATABLE_FILTER_KEYS) {
      expect(Object.keys(APOLLO_DISCOVERY_FILTERS)).toContain(key);
    }
  });

  it('55. tenant mismatch still refuses before any value is read', () => {
    const r = translateRatifiedIcpToDiscoveryFilters({
      organizationId: ORG_B,
      ratifiedIcp: ratified([seniority(['c_suite'])], ORG_A),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r as IcpTranslationFailure).refusal).toBe('tenant_mismatch');
    expect(JSON.stringify(r)).not.toContain('c_suite');
    expect(JSON.stringify(r)).not.toContain('icp-1');
  });

  it('56. omission acknowledgement is still strict with seniority present', () => {
    const criteria = [criterion({ id: 'c-title' }), seniority(['director'], 'optional')];
    expect(translate(criteria).ok).toBe(false);
    expect(translate(criteria, ORG_A, ORG_A, 'true').ok).toBe(false);
    expect(translateAck(criteria).ok).toBe(true);
  });
});
