/**
 * A1 — the AI ICP Generator.
 *
 * The model is doubled, so what is proven here is the GENERATOR'S BEHAVIOUR:
 * what it lets through, what it refuses, and what it writes. A clever fake that
 * re-implemented the contracts would prove only that the fake works, so the
 * REAL `validateCriteria` and `validateProposalTargets` run in every test —
 * only the profile read, the model call and the writer are doubled.
 *
 * The load-bearing tests are the union criterion (§8 of the brief — five titles
 * as five criteria would score a match at 0.2), the refusal of attributes
 * nothing can populate, and the two unrepresentable concepts, which must never
 * become invented criteria.
 */

import {
  generateIcpProposal, TITLE_UNION_CRITERION_ID, DEPARTMENT_CRITERION_ID,
  extractProfileEvidence, hasSufficientEvidence,
  type GenerateIcpPorts, type GenerateIcpResult,
} from '../../services/prospectIcp/generator';
import { ensureIcp, createIcpVersion } from '../../services/prospectIcp';
import type { IcpCriterion } from '../../services/prospectIcp';

const ORG = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const OTHER_ORG = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const ICP_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-09-05T00:00:00.000Z';

/** A realistic, buyer-relevant Company Profile row. */
const PROFILE: Record<string, unknown> = {
  industry: 'Marketing Technology',
  category: 'Analytics software for clearer performance insights',
  unique_value: 'A unified AI-driven platform that provides clarity for modern marketing.',
  products_services_list: ['SEO and website health analysis', 'Campaign planning and execution'],
  target_audience_list: ['Marketing managers', 'Digital marketers', 'Small to medium businesses'],
  target_customer_segment: 'Startups, micro, SMB, and later enterprises.',
  ideal_customer_profile: 'Businesses facing challenges managing marketing with limited teams.',
  avg_deal_size: '$5 to $499 per month per person.',
  sales_cycle: '1 week to 4 months.',
  sales_motion: 'Heavily reliant on social media and email campaigns.',
  core_problem_statement: 'Businesses face challenges with disjointed marketing tools.',
  pain_symptoms: ['Overwhelmed marketing teams lacking integrated tools for execution'],
  geography_list: ['Global', 'India'],
  field_confidence: { target_audience: 'High', industry: 'High' },
  overall_confidence: 83,
  user_locked_fields: ['target_customer_segment', 'ideal_customer_profile'],
};

/** A well-formed model response against the prompt's declared schema. */
const MODEL_OUTPUT = {
  account: [{
    attribute: 'industry',
    op: 'one_of',
    values: ['Marketing Technology'],
    kind: 'optional',
    confidence: 'high',
    derivation: 'directly_evidenced',
    evidenceFields: ['industry'],
    evidenceQuotes: ['Marketing Technology'],
    rationale: 'The tenant sells marketing technology.',
  }],
  department: { values: ['Marketing'], evidenceFields: ['target_audience_list'], confidence: 'high' },
  targets: [
    {
      rank: 1, title: 'Marketing Manager', roleTypes: ['user', 'evaluator'],
      derivation: 'directly_evidenced', confidence: 'high',
      evidenceFields: ['target_audience_list'], evidenceQuotes: ['Marketing managers'],
      orgAssumption: 'A marketing function exists at SMB scale.',
      factors: { e: 2, p: 2, b: 1, f: 2, r: 2 },
    },
    {
      rank: 2, title: 'Head of Marketing', roleTypes: ['economic_buyer', 'decision_maker'],
      derivation: 'inferred', confidence: 'medium',
      evidenceFields: ['target_customer_segment'], evidenceQuotes: [],
      orgAssumption: 'Senior-most marketer at SMB scale holds the budget.',
      factors: { e: 1, p: 2, b: 2, f: 2, r: 2 },
    },
    {
      rank: 3, title: 'Founder', roleTypes: ['decision_maker', 'sponsor'],
      derivation: 'inferred', confidence: 'medium',
      evidenceFields: ['ideal_customer_profile'], evidenceQuotes: [],
      orgAssumption: 'At micro scale the founder is the marketing decision maker.',
      factors: { e: 1, p: 1, b: 2, f: 2, r: 1 },
    },
  ],
  rejected: [{ title: 'CMO', reason: 'Above the authority ceiling implied by a $5-499/month price point.' }],
  stageAssumption: {
    stage: 'smb',
    evidenceFields: ['target_customer_segment'],
    rationale: 'Segment spans startups through SMB.',
  },
  unrepresentable: [
    { concept: 'problem_relevance', finding: 'Buyers feel tool fragmentation acutely.', evidenceFields: ['pain_symptoms'] },
    { concept: 'product_service_alignment', finding: 'SEO products align to the SMB marketer.', evidenceFields: ['products_services_list'] },
  ],
};

interface Written { organizationId: string; criteria: IcpCriterion[]; status: string; proposal: Record<string, unknown>; proposedByModel: string | null }

function makePorts(over: Partial<GenerateIcpPorts> & { written?: Written[] } = {}): GenerateIcpPorts {
  const written = over.written ?? [];
  return {
    loadCompanyProfile: over.loadCompanyProfile ?? (async () => PROFILE),
    runCompletion: over.runCompletion ?? (async () => ({
      output: JSON.stringify(MODEL_OUTPUT),
      model: 'test-model-1', provider: 'direct-openai', reasoningTraceId: 'trace-1',
    })),
    ensureIcp: over.ensureIcp ?? (async () => ({ icpId: ICP_ID, outcome: 'created' } as never)),
    createIcpVersion: over.createIcpVersion ?? (async (input) => {
      written.push(input as unknown as Written);
      return { versionId: 'ver-1', version: 1, outcome: 'created' };
    }),
    now: over.now ?? (() => NOW),
  };
}

/**
 * The root tsconfig sets `strict: false`, which disables discriminated-union
 * narrowing on a negated boolean discriminant — `if (!r.ok)` leaves `r` wide.
 * The `in` operator narrows regardless, so both helpers use it.
 */
type Success = Extract<GenerateIcpResult, { ok: true }>;
type Failure = Extract<GenerateIcpResult, { ok: false }>;

const ok = (r: GenerateIcpResult): Success => {
  if ('reason' in r) throw new Error(`expected success, got ${r.reason}: ${r.detail}`);
  return r;
};

const failed = (r: GenerateIcpResult): Failure => {
  if (!('reason' in r)) throw new Error('expected a refusal, but generation succeeded');
  return r;
};

describe('A1 — happy path', () => {
  it('generates company criteria, person criteria, ranked targets, evidence and confidence', async () => {
    const written: Written[] = [];
    const r = ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'first-cut' }, makePorts({ written })));

    expect(r.version).toBe(1);
    expect(r.targetCount).toBe(3);
    expect(written).toHaveLength(1);

    const row = written[0];
    expect(row.organizationId).toBe(ORG);
    expect(row.status).toBe('proposed');
    expect(row.proposedByModel).toBe('test-model-1');

    // Company ICP present.
    const account = row.criteria.filter((c) => c.subject === 'account');
    expect(account.map((c) => c.attribute)).toEqual(['industry']);

    // Person ICP present: the union plus the optional department check.
    const person = row.criteria.filter((c) => c.subject === 'person');
    expect(person.map((c) => c.id).sort()).toEqual([DEPARTMENT_CRITERION_ID, TITLE_UNION_CRITERION_ID].sort());

    // Provenance survived to the proposal.
    const targets = row.proposal.targets as Array<Record<string, unknown>>;
    expect(targets).toHaveLength(3);
    expect(targets[0].evidenceFields).toEqual(['target_audience_list']);
    expect(String(row.proposal.ai_value)).toContain('direct-openai/test-model-1');
    expect(String(row.proposal.ai_value)).toContain('trace-1');
    expect(row.proposal.status).toBe('ai_suggested');
  });

  it('records the stage assumption and the rejected candidate', async () => {
    const written: Written[] = [];
    ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'first-cut' }, makePorts({ written })));
    expect((written[0].proposal.stageAssumption as Record<string, unknown>).stage).toBe('smb');
    const rejected = written[0].proposal.rejected as Array<Record<string, string>>;
    expect(rejected).toHaveLength(1);
    expect(rejected[0].title).toBe('CMO');
    expect(rejected[0].reason).toContain('authority ceiling');
  });
});

describe('A1 — the title shortlist is ONE union criterion', () => {
  it('emits a single job_title one_of carrying every title, not one criterion per title', async () => {
    const written: Written[] = [];
    ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'first-cut' }, makePorts({ written })));

    const titleCriteria = written[0].criteria.filter((c) => c.attribute === 'job_title');
    // The whole point: three targets, ONE criterion.
    expect(titleCriteria).toHaveLength(1);
    expect(titleCriteria[0].id).toBe(TITLE_UNION_CRITERION_ID);
    expect(titleCriteria[0].predicate).toEqual({
      op: 'one_of',
      values: ['Founder', 'Head of Marketing', 'Marketing Manager'],   // validator sorts
    });
    expect((written[0].proposal.targets as unknown[]).length).toBe(3);
  });
});

describe('A1 — attributes nothing can populate are refused', () => {
  it.each(['seniority', 'authority', 'influence', 'buying_role'])(
    'refuses a person criterion naming %s, and records why', async (attribute) => {
      const written: Written[] = [];
      const r = ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
        written,
        runCompletion: async () => ({
          output: JSON.stringify({ ...MODEL_OUTPUT, person: [{ attribute, op: 'one_of', values: ['x'] }] }),
          model: 'm', provider: 'p', reasoningTraceId: 't',
        }),
      })));
      expect(written[0].criteria.some((c) => c.attribute === attribute)).toBe(false);
      expect(r.diagnostics.dropped.join(' ')).toContain(attribute);
    });

  it('refuses an account attribute the platform does not store', async () => {
    const written: Written[] = [];
    const r = ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
      written,
      runCompletion: async () => ({
        output: JSON.stringify({
          ...MODEL_OUTPUT,
          account: [...MODEL_OUTPUT.account, {
            attribute: 'mrr', op: 'one_of', values: ['high'],
            evidenceFields: ['industry'], confidence: 'high', derivation: 'inferred',
          }],
        }),
        model: 'm', provider: 'p', reasoningTraceId: 't',
      }),
    })));
    expect(written[0].criteria.some((c) => c.attribute === 'mrr')).toBe(false);
    expect(r.diagnostics.dropped.join(' ')).toContain('account.mrr');
  });
});

describe('A1 — GAP-1 / GAP-2 are recorded, never invented', () => {
  it('creates no criterion for problem relevance or product/service alignment', async () => {
    const written: Written[] = [];
    const r = ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({ written })));

    for (const c of written[0].criteria) {
      expect(c.attribute).not.toMatch(/problem|relevance|alignment|product_service/i);
    }
    // Preserved for the reviewer in frozen proposal metadata instead.
    expect(r.diagnostics.unrepresentable.map((u) => u.concept).sort())
      .toEqual(['problem_relevance', 'product_service_alignment']);
    expect(String(written[0].proposal.guidance)).toContain('problem_relevance');
  });
});

describe('A1 — evidence discipline', () => {
  it('gives every generated criterion traceable evidence', async () => {
    const written: Written[] = [];
    ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({ written })));
    for (const c of written[0].criteria) {
      if (c.id === TITLE_UNION_CRITERION_ID) continue;   // its evidence lives on the targets
      expect(c.description).toMatch(/evidence:/);
    }
    for (const t of written[0].proposal.targets as Array<Record<string, unknown>>) {
      expect((t.evidenceFields as string[]).length).toBeGreaterThan(0);
    }
  });

  it('discards a quote that does not appear verbatim, and downgrades the claim', async () => {
    const written: Written[] = [];
    const r = ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
      written,
      runCompletion: async () => ({
        output: JSON.stringify({
          ...MODEL_OUTPUT,
          targets: [{
            ...MODEL_OUTPUT.targets[0],
            evidenceQuotes: ['a sentence the profile never contained'],
          }],
        }),
        model: 'm', provider: 'p', reasoningTraceId: 't',
      }),
    })));
    const target = (written[0].proposal.targets as Array<Record<string, unknown>>)[0];
    expect(target.evidenceQuotes).toEqual([]);
    expect(target.derivation).toBe('inferred');          // not directly_evidenced
    expect(r.diagnostics.dropped.join(' ')).toContain('not found verbatim');
  });

  it('drops a target citing a field that carries no value on this profile', async () => {
    const written: Written[] = [];
    const r = ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
      written,
      runCompletion: async () => ({
        output: JSON.stringify({
          ...MODEL_OUTPUT,
          targets: [MODEL_OUTPUT.targets[0], {
            ...MODEL_OUTPUT.targets[1], title: 'Ghost Role', evidenceFields: ['growth_priorities'],
          }],
        }),
        model: 'm', provider: 'p', reasoningTraceId: 't',
      }),
    })));
    const titles = (written[0].proposal.targets as Array<Record<string, unknown>>).map((t) => t.title);
    expect(titles).not.toContain('Ghost Role');
    expect(r.diagnostics.dropped.join(' ')).toContain('Ghost Role');
  });
});

describe('A1 — confidence cannot contradict itself', () => {
  it('derives factors.c from confidence and ignores any multiplier the model sends', async () => {
    const written: Written[] = [];
    ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
      written,
      runCompletion: async () => ({
        output: JSON.stringify({
          ...MODEL_OUTPUT,
          targets: [{
            ...MODEL_OUTPUT.targets[0], confidence: 'low',
            factors: { e: 2, p: 2, b: 1, f: 2, r: 2, c: 1 },   // contradictory: low with x1.0
          }],
        }),
        model: 'm', provider: 'p', reasoningTraceId: 't',
      }),
    })));
    const t = (written[0].proposal.targets as Array<Record<string, unknown>>)[0];
    expect(t.confidence).toBe('low');
    expect((t.factors as Record<string, number>).c).toBe(0.5);   // derived, not the model's 1
  });

  it('drops a target whose evidence factor is 0', async () => {
    const written: Written[] = [];
    const r = ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
      written,
      runCompletion: async () => ({
        output: JSON.stringify({
          ...MODEL_OUTPUT,
          targets: [MODEL_OUTPUT.targets[0], {
            ...MODEL_OUTPUT.targets[1], title: 'Unevidenced Role', factors: { e: 0, p: 1, b: 1, f: 1, r: 1 },
          }],
        }),
        model: 'm', provider: 'p', reasoningTraceId: 't',
      }),
    })));
    expect(r.diagnostics.dropped.join(' ')).toContain('hard exclusion');
    expect((written[0].proposal.targets as unknown[]).length).toBe(1);
  });
});

describe('A1 — sparse and missing profiles', () => {
  it('abstains rather than proposing when the profile has no company_profiles row', async () => {
    const written: Written[] = [];
    const r = await generateIcpProposal({ organizationId: ORG, icpKey: 'k' },
      makePorts({ written, loadCompanyProfile: async () => null }));
    expect(r.ok).toBe(false);
    expect(failed(r).reason).toBe('no_company_profile');
    expect(written).toHaveLength(0);
  });

  it('abstains when the profile carries too few buyer signals', async () => {
    const written: Written[] = [];
    const r = await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
      written,
      loadCompanyProfile: async () => ({ industry: 'Software', category: 'Tools' }),
    }));
    expect(r.ok).toBe(false);
    expect(failed(r).reason).toBe('insufficient_evidence');
    expect(written).toHaveLength(0);
  });

  it('produces a valid partial proposal from a thin but sufficient profile', async () => {
    const written: Written[] = [];
    const thin = {
      target_audience_list: ['Marketing managers'],
      ideal_customer_profile: 'Small teams with limited budget.',
    };
    ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
      written,
      loadCompanyProfile: async () => thin,
      runCompletion: async () => ({
        output: JSON.stringify({
          account: [],
          targets: [{
            rank: 1, title: 'Marketing Manager', roleTypes: ['user'],
            derivation: 'directly_evidenced', confidence: 'medium',
            evidenceFields: ['target_audience_list'], evidenceQuotes: ['Marketing managers'],
            orgAssumption: 'Assumed from the stated audience.',
            factors: { e: 2, p: 1, b: 1, f: 1, r: 1 },
          }],
          stageAssumption: { stage: 'smb', evidenceFields: ['ideal_customer_profile'], rationale: 'Small teams.' },
        }),
        model: 'm', provider: 'p', reasoningTraceId: 't',
      }),
    })));
    // No account criteria is a legitimate partial answer, not a failure.
    expect(written[0].criteria.filter((c) => c.subject === 'account')).toHaveLength(0);
    expect(written[0].criteria.filter((c) => c.id === TITLE_UNION_CRITERION_ID)).toHaveLength(1);
  });
});

describe('A1 — AI failure is fail-safe', () => {
  it('writes nothing when the model call throws', async () => {
    const written: Written[] = [];
    const r = await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
      written, runCompletion: async () => { throw new Error('provider timeout'); },
    }));
    expect(r.ok).toBe(false);
    { const f = failed(r); expect(f.reason).toBe('model_failed'); expect(f.detail).toContain('provider timeout'); }
    expect(written).toHaveLength(0);
  });

  it('writes nothing when the model returns unparseable output', async () => {
    const written: Written[] = [];
    const r = await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
      written,
      runCompletion: async () => ({ output: 'not json at all', model: 'm', provider: 'p', reasoningTraceId: 't' }),
    }));
    expect(r.ok).toBe(false);
    expect(failed(r).reason).toBe('model_output_unusable');
    expect(written).toHaveLength(0);
  });

  it('does NOT downgrade a fully-refused generation into an empty proposal', async () => {
    const written: Written[] = [];
    const r = await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
      written,
      runCompletion: async () => ({
        output: JSON.stringify({ account: [{ attribute: 'mrr', op: 'one_of', values: ['x'], evidenceFields: ['industry'] }], targets: [] }),
        model: 'm', provider: 'p', reasoningTraceId: 't',
      }),
    }));
    expect(r.ok).toBe(false);
    expect(failed(r).reason).toBe('no_usable_criteria');
    expect(written).toHaveLength(0);          // an empty ICP is a claim nobody made
  });

  it('writes nothing when persistence rejects the proposal', async () => {
    const r = await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
      createIcpVersion: async () => { throw new Error('23503 cross tenant'); },
    }));
    expect(r.ok).toBe(false);
    expect(failed(r).reason).toBe('persist_failed');
  });
});

describe('A1 — ratification boundary', () => {
  it('always writes status "proposed", never ratified, and names the model', async () => {
    const written: Written[] = [];
    ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({ written })));
    expect(written[0].status).toBe('proposed');
    expect(written[0].status).not.toBe('ratified');
    expect(written[0].proposedByModel).toBe('test-model-1');
    expect(written[0].proposal).not.toHaveProperty('ratified_by');
    expect(written[0].proposal).not.toHaveProperty('ratifiedAt');
  });

  it('uses the canonical writer rather than touching a table directly', () => {
    const source = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../services/prospectIcp/generator/generate.ts'), 'utf8');
    // The only table it may name is the profile it reads.
    expect(source).toContain("ownedDbTable('company_profiles')");
    expect(source).not.toContain("ownedDbTable('prospect_icp_versions')");
    expect(source).not.toContain("ownedDbTable('prospect_icps')");
    expect(typeof createIcpVersion).toBe('function');
    expect(typeof ensureIcp).toBe('function');
  });
});

describe('A1 — tenant isolation', () => {
  it('reads and writes only the verified tenant, whatever the model says', async () => {
    const written: Written[] = [];
    const read: string[] = [];
    ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
      written,
      loadCompanyProfile: async (id) => { read.push(id); return PROFILE; },
      runCompletion: async () => ({
        // The model tries to name another tenant. It must have no effect.
        output: JSON.stringify({ ...MODEL_OUTPUT, organizationId: OTHER_ORG, company_id: OTHER_ORG }),
        model: 'm', provider: 'p', reasoningTraceId: 't',
      }),
    })));
    expect(read).toEqual([ORG]);
    expect(written[0].organizationId).toBe(ORG);
    expect(JSON.stringify(written[0])).not.toContain(OTHER_ORG);
  });

  it('refuses a blank tenant outright', async () => {
    const r = await generateIcpProposal({ organizationId: '  ', icpKey: 'k' }, makePorts());
    expect(r.ok).toBe(false);
    expect(failed(r).reason).toBe('contract_violation');
  });

  it('never puts the tenant id in the prompt', async () => {
    let userPrompt = '';
    ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, makePorts({
      runCompletion: async ({ system, user }) => {
        userPrompt = `${system}\n${user}`;
        return { output: JSON.stringify(MODEL_OUTPUT), model: 'm', provider: 'p', reasoningTraceId: 't' };
      },
    })));
    expect(userPrompt).not.toContain(ORG);
  });
});

describe('A1 — repeat generation', () => {
  it('creates a NEW version rather than mutating the previous one', async () => {
    const written: Written[] = [];
    let n = 0;
    const ports = makePorts({
      written,
      createIcpVersion: async (input) => {
        written.push(input as unknown as Written);
        n += 1;
        return { versionId: `ver-${n}`, version: n, outcome: 'created' };
      },
    });
    const a = ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, ports));
    const b = ok(await generateIcpProposal({ organizationId: ORG, icpKey: 'k' }, ports));

    expect(a.version).toBe(1);
    expect(b.version).toBe(2);
    expect(written).toHaveLength(2);
    // Both are proposals; regeneration never ratifies and never supersedes.
    expect(written.every((w) => w.status === 'proposed')).toBe(true);
  });
});

describe('A1 — evidence extraction', () => {
  it('reports an empty field as ABSENT rather than omitting it', () => {
    const e = extractProfileEvidence({ industry: 'X', category: '   ', products_services_list: [] });
    expect(e.present).toHaveProperty('industry');
    expect(e.absent).toContain('category');
    expect(e.absent).toContain('products_services_list');
  });

  it('requires at least two buyer signals before reasoning at all', () => {
    expect(hasSufficientEvidence(extractProfileEvidence({ industry: 'X' }))).toBe(false);
    expect(hasSufficientEvidence(extractProfileEvidence({
      target_audience_list: ['a'], core_problem_statement: 'b',
    }))).toBe(true);
  });

  it('never exposes publishing configuration to the model', () => {
    const e = extractProfileEvidence({
      ...PROFILE, report_settings: { secret: true }, platform_content_type_prefs: { x: 1 },
      linkedin_url: 'https://example.invalid',
    });
    expect(Object.keys(e.present)).not.toContain('report_settings');
    expect(Object.keys(e.present)).not.toContain('platform_content_type_prefs');
    expect(Object.keys(e.present)).not.toContain('linkedin_url');
  });
});
