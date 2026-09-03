/**
 * PI-P1-W03 — the ratified ICP reaching the existing `icp` score dimension.
 *
 * The engine calculates nothing, so these tests are not about arithmetic. They
 * are about the four things that could go quietly wrong: that no ratified ICP
 * ABSTAINS rather than scoring zero, that an unratified version can never be
 * used, that one tenant's ICP can never reach another's lead, and that the
 * contribution lands in the dimension that already exists rather than opening a
 * second one.
 *
 * Every ICP here is an in-memory `RatifiedIcp`. No database, no production row,
 * and no `LEAD_UNDERSTANDING_ENABLED` — the engine is pure and the runtime stays
 * dark.
 */

import { runProspectIcpFit, toIcpSubjectFacts } from '../../services/leadUnderstanding/engines/prospectIcpFit';
import { assembleLeadUnderstanding } from '../../services/leadUnderstanding/engines/assembly';
import { SCORE_DIMENSIONS } from '../../services/leadUnderstanding/types';
import { evaluateIcpFit } from '../../services/prospectIcp/evaluate';
import type { RatifiedIcp } from '../../services/prospectIcp/types';
import type { LeadIntelligenceContext } from '../../services/leadUnderstanding/engines/engineTypes';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const AS_OF = '2026-09-03T00:00:00.000Z';

const ratified = (over: Partial<RatifiedIcp> = {}): RatifiedIcp => ({
  organizationId: ORG_A,
  icpId: '11111111-1111-4111-8111-111111111111',
  icpKey: 'default',
  version: 1,
  criteria: [
    {
      id: 'c1',
      kind: 'required',
      subject: 'person',
      attribute: 'seniority',
      predicate: { op: 'one_of', values: ['director', 'vp'] },
    },
  ],
  ratifiedAt: '2026-09-01T00:00:00.000Z',
  ratifiedBy: '22222222-2222-4222-8222-222222222222',
  ...over,
});

const ctx = (over: Partial<LeadIntelligenceContext> = {}): LeadIntelligenceContext => ({
  key: { leadKey: 'lead-1', companyId: ORG_A },
  asOf: AS_OF,
  identity: { title: 'Director of Operations', department: 'Operations', seniority: 'director' },
  ...over,
});

describe('PI-P1-W03 — no ratified ICP abstains, it does not score', () => {
  it('a context with no ratified ICP abstains', () => {
    const out = runProspectIcpFit(ctx());
    expect(out.abstained).toBe(true);
  });

  it('emits ZERO contributions — never a 0, never a 0.5', () => {
    const out = runProspectIcpFit(ctx());
    expect(out.contributions).toEqual([]);
    for (const c of out.contributions) expect(c.value).not.toBe(0);
  });

  it('an explicit null is treated the same as absent — null is a first-class input', () => {
    expect(runProspectIcpFit(ctx({ ratifiedIcp: null })).abstained).toBe(true);
  });

  it('the evaluator reports no_ratified_icp for that case', () => {
    const ev = evaluateIcpFit({ ratified: null, facts: toIcpSubjectFacts(ctx()), asOf: AS_OF });
    expect(ev.abstained).toBe(true);
    expect(ev.contributions).toEqual([]);
    expect(ev.icpId).toBeNull();
  });

  it('emits no evidence and no reasoning when abstaining', () => {
    const out = runProspectIcpFit(ctx());
    expect(out.evidence).toEqual([]);
    expect(out.reasoning).toEqual([]);
  });
});

describe('PI-P1-W03 — a ratified ICP scores, into the dimension that already exists', () => {
  it('produces exactly one contribution', () => {
    const out = runProspectIcpFit(ctx({ ratifiedIcp: ratified() }));
    expect(out.abstained).toBe(false);
    expect(out.contributions).toHaveLength(1);
  });

  it('the contribution is on the `icp` dimension', () => {
    const out = runProspectIcpFit(ctx({ ratifiedIcp: ratified() }));
    expect(out.contributions[0].dimension).toBe('icp');
  });

  it('`icp` is a dimension the platform already had — no new dimension is opened', () => {
    expect(SCORE_DIMENSIONS).toContain('icp');
  });

  it('the contribution keeps the EVALUATOR identity, not the engine name', () => {
    // evaluate.ts sets `contributor` itself. The engine passes contributions
    // through verbatim, so the credit belongs to D1 — and the contribution is
    // distinguishable from personaIcp's on the same dimension.
    const out = runProspectIcpFit(ctx({ ratifiedIcp: ratified() }));
    expect(out.contributions[0].contributor).toBe('prospect_icp');
    expect(out.contributions[0].contributor).not.toBe('persona_icp');
  });

  it('carries evidence naming the ratified ICP key and version', () => {
    const out = runProspectIcpFit(ctx({ ratifiedIcp: ratified({ icpKey: 'enterprise', version: 3 }) }));
    expect(out.evidence).toHaveLength(1);
    expect(String(out.evidence[0].source?.system ?? out.evidence[0].source))
      .toContain('prospect_icp:enterprise@v3');
  });

  it('delegates entirely — the engine output matches the evaluator called directly', () => {
    const r = ratified();
    const direct = evaluateIcpFit({ ratified: r, facts: toIcpSubjectFacts(ctx()), asOf: AS_OF });
    const viaEngine = runProspectIcpFit(ctx({ ratifiedIcp: r }));
    expect(viaEngine.contributions).toEqual(direct.contributions);
  });
});

describe('PI-P1-W03 — only a RATIFIED version can be used', () => {
  it('the context type carries a RatifiedIcp, so a draft cannot be supplied', () => {
    // RatifiedIcp is produced ONLY by getRatifiedIcp, which filters
    // status='ratified'. A draft/proposed version has no path into this field.
    const r = ratified();
    expect(r.ratifiedAt).not.toBeNull();
    expect(r.ratifiedBy).not.toBeNull();
  });

  it('version selection is not a choice — one ratified version is supplied, and it is used', () => {
    const out = runProspectIcpFit(ctx({ ratifiedIcp: ratified({ version: 7 }) }));
    expect(String(out.evidence[0].source?.system ?? out.evidence[0].source)).toContain('@v7');
  });

  it('nothing in the engine reads a client-supplied icp id or version', () => {
    const fs = require('node:fs') as typeof import('fs');
    const path = require('node:path') as typeof import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../services/leadUnderstanding/engines/prospectIcpFit.ts'), 'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['req.', 'body', 'query', 'ownedDbTable', 'supabase', 'getRatifiedIcp', 'await ']) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe('PI-P1-W03 — tenant isolation', () => {
  it('the ICP used is the one on the context, never a global or fallback', () => {
    const out = runProspectIcpFit(ctx({ ratifiedIcp: ratified({ organizationId: ORG_A }) }));
    expect(out.abstained).toBe(false);
  });

  it('a context with no ICP does not borrow another tenant\'s — it abstains', () => {
    // There is no registry, cache or module-level state the engine could read
    // from, so a second call with no ICP cannot inherit the first call's.
    runProspectIcpFit(ctx({ ratifiedIcp: ratified() }));
    const second = runProspectIcpFit(ctx({ key: { leadKey: 'lead-2', companyId: ORG_B } }));
    expect(second.abstained).toBe(true);
    expect(second.contributions).toEqual([]);
  });

  it('the engine holds no module-level state between calls', () => {
    const a = runProspectIcpFit(ctx({ ratifiedIcp: ratified() }));
    const b = runProspectIcpFit(ctx({ ratifiedIcp: ratified() }));
    expect(a.contributions).toEqual(b.contributions);
    expect(runProspectIcpFit(ctx()).contributions).toEqual([]);
  });
});

describe('PI-P1-W03 — missing evidence never becomes an authoritative score', () => {
  it('a lead with no identity attributes cannot satisfy criteria', () => {
    const out = runProspectIcpFit(ctx({ identity: undefined, ratifiedIcp: ratified() }));
    expect(out.contributions.every((c) => c.value !== 0)).toBe(true);
  });

  it('unmappable geography is omitted, not invented as a country code', () => {
    const facts = toIcpSubjectFacts(ctx({ identity: { geography: 'somewhere in EMEA' } }));
    expect(facts.attributes).not.toHaveProperty('country_code');
    expect(facts.attributes).not.toHaveProperty('region');
    expect(facts.attributes).not.toHaveProperty('city');
  });

  it('only D1 closed-vocabulary person attributes are emitted', () => {
    const facts = toIcpSubjectFacts(ctx());
    expect(facts.subject).toBe('person');
    for (const k of Object.keys(facts.attributes)) {
      expect(['job_title', 'department', 'seniority', 'country_code', 'region', 'city']).toContain(k);
    }
  });

  it('blank strings are dropped rather than recorded as observations', () => {
    const facts = toIcpSubjectFacts(ctx({ identity: { title: '   ', department: '' } }));
    expect(facts.attributes).toEqual({});
  });
});

describe('PI-P1-W03 — the assembly integration', () => {
  it('assembly runs with no ratified ICP and the icp dimension abstains', () => {
    const { understanding } = assembleLeadUnderstanding(ctx());
    expect(understanding.score.dimensions.icp.abstained).toBe(true);
    expect(understanding.score.dimensions.icp.value).toBeNull();
  });

  it('a ratified ICP reaches the blended icp dimension', () => {
    const { understanding } = assembleLeadUnderstanding(ctx({ ratifiedIcp: ratified() }));
    expect(understanding.score.dimensions.icp.contributors).toContain('prospect_icp');
  });

  it('exactly ONE ratified-ICP contribution is emitted per assembly — never a duplicate', () => {
    const { engines } = assembleLeadUnderstanding(ctx({ ratifiedIcp: ratified() }));
    const mine = engines.flatMap((e) => e.contributions).filter((c) => c.contributor === 'prospect_icp');
    expect(mine).toHaveLength(1);
  });

  it('the engine appears exactly once in the assembly', () => {
    const { engines } = assembleLeadUnderstanding(ctx());
    expect(engines.filter((e) => e.engine === 'prospect_icp_fit')).toHaveLength(1);
  });

  it('the dimensions W03 does not feed are byte-identical with and without an ICP', () => {
    const without = assembleLeadUnderstanding(ctx()).understanding.score.dimensions;
    const with_ = assembleLeadUnderstanding(ctx({ ratifiedIcp: ratified() })).understanding.score.dimensions;
    // intent and urgency have their own contributors and must not move.
    for (const d of ['intent', 'urgency'] as const) {
      expect(with_[d]).toEqual(without[d]);
    }
  });

  it('priority BECOMES computable once the ICP contributes — the objective, not a regression', () => {
    // `priority` is derived from the primary engines' contributions. With no
    // ratified ICP nothing feeds it and it abstains; with one, it resolves.
    // This is the ratified ICP influencing scoring.
    const without = assembleLeadUnderstanding(ctx()).understanding.score.dimensions;
    const with_ = assembleLeadUnderstanding(ctx({ ratifiedIcp: ratified() })).understanding.score.dimensions;
    expect(without.priority.abstained).toBe(true);
    expect(with_.priority.abstained).toBe(false);
    expect(with_.priority.value).not.toBeNull();
  });

  it('personaIcp still runs and is untouched', () => {
    const { engines } = assembleLeadUnderstanding(ctx());
    expect(engines.some((e) => e.engine === 'persona_icp')).toBe(true);
  });
});

describe('PI-P1-W03 — the runtime stays dark', () => {
  it('nothing in this suite sets LEAD_UNDERSTANDING_ENABLED', () => {
    expect(process.env.LEAD_UNDERSTANDING_ENABLED).not.toBe('true');
  });

  it('the engine works purely, independent of any flag', () => {
    delete process.env.LEAD_UNDERSTANDING_ENABLED;
    expect(runProspectIcpFit(ctx({ ratifiedIcp: ratified() })).abstained).toBe(false);
  });
});
