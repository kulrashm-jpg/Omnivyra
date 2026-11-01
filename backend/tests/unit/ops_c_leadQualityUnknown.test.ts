/**
 * OPS-C — an unscored lead carries an explicit UNKNOWN quality, never the
 * fabricated 35 (`qualification_score ?? 35`) that turned every unscored lead
 * into a "low quality" decision.
 *
 * Cases: unscored (NULL), legacy-default bare 0 (pre-20270109000002 column
 * default), genuine zero (0 + closure-C marker), genuinely scored, and a
 * partially scored source. No network, no database.
 */

const leadsRows: Array<Record<string, unknown>> = [];
const selects: string[] = [];

jest.mock('../../db/supabaseClient', () => {
  const builder = (table: string) => {
    const b: any = {
      select: (cols: string) => { selects.push(`${table}:${cols}`); return b; },
      eq: () => b, gte: () => b, in: () => b, order: () => b,
      limit: async () => ({ data: table === 'canonical_leads' ? leadsRows : [], error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
    };
    return b;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});
jest.mock('../../services/decisionObjectService', () => ({
  archiveDecisionSourceEntityType: jest.fn(async () => undefined),
  createDecisionObjects: jest.fn(async (d: unknown[]) => d),
}));
jest.mock('../../services/intelligenceExecutionContext', () => ({ assertBackgroundJobContext: () => undefined }));

import { generateLeadIntelligenceDecisions, inferLeadQuality } from '../../services/leadIntelligenceService';

const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
const MARK = { qualificationScoring: true };

function lead(id: string, source: string, score: number | null, extra: Record<string, unknown> = {}, createdAt = recent) {
  return { id, source, qualification_score: score, created_at: createdAt, ...extra };
}

async function run(rows: Array<Record<string, unknown>>) {
  leadsRows.length = 0;
  leadsRows.push(...rows);
  return (await generateLeadIntelligenceDecisions('co-1')) as Array<Record<string, any>>;
}

beforeEach(() => { selects.length = 0; });

describe('inferLeadQuality', () => {
  it('unscored (NULL) is unknown, not 35', () => {
    expect(inferLeadQuality({ qualification_score: null })).toEqual({ state: 'unscored', value: null });
  });
  it('a bare 0 without the scoring marker is the legacy default, unknown', () => {
    expect(inferLeadQuality({ qualification_score: 0 })).toEqual({ state: 'legacy_default', value: null });
  });
  it('a MARKED 0 is a genuine zero', () => {
    expect(inferLeadQuality({ qualification_score: 0, qualificationScoring: true })).toEqual({ state: 'scored', value: 0 });
  });
  it('a positive score is measured', () => {
    expect(inferLeadQuality({ qualification_score: 72.4 })).toEqual({ state: 'scored', value: 72 });
  });
});

describe('generateLeadIntelligenceDecisions', () => {
  it('reads the closure-C marker with the lead row', async () => {
    await run([]);
    expect(selects.find((s) => s.startsWith('canonical_leads:'))).toContain('qualificationScoring:lead_metadata->qualificationScoring');
  });

  it('unscored leads produce NO quality-threshold decisions (old code: low_quality_lead "scored 35/100")', async () => {
    const out = await run([lead('u1', 'web', null), lead('u2', 'web', null, {}, old), lead('u3', 'web', null)]);
    const types = out.map((d) => d.issue_type);
    expect(types).not.toContain('low_quality_lead');
    expect(types).not.toContain('high_dropoff_lead');
    expect(types).not.toContain('unqualified_lead_source');
  });

  it('legacy-default 0 leads are unknown too (excluded from source averages)', async () => {
    const out = await run([lead('z1', 'csv', 0), lead('z2', 'csv', 0), lead('z3', 'csv', 0)]);
    expect(out.map((d) => d.issue_type)).not.toContain('low_quality_lead');
    const low = out.find((d) => d.issue_type === 'low_conversion_source');
    expect(low?.evidence.avg_qualification_score).toBeNull();
  });

  it('a genuine (marked) zero IS low quality, and says so with its state', async () => {
    const out = await run([lead('g0', 'crm', 0, MARK)]);
    const d = out.find((x) => x.issue_type === 'low_quality_lead');
    expect(d).toBeDefined();
    expect(d!.evidence).toMatchObject({ inferred_quality_score: 0, qualification_score: 0, qualification_score_state: 'scored' });
  });

  it('a genuinely scored low lead is flagged; a scored high lead is not', async () => {
    const out = await run([lead('s1', 'ads', 20), lead('s2', 'ads', 90)]);
    const flagged = out.filter((d) => d.issue_type === 'low_quality_lead').map((d) => d.entity_id);
    expect(flagged).toEqual(['s1']);
    expect(out.find((d) => d.entity_id === 's1')!.evidence.inferred_quality_score).toBe(20);
  });

  it('a partially scored source averages only its scored leads and reports the unscored count', async () => {
    // 3 scored (30, 30, 30) + 4 unscored. Old code averaged (90 + 4*35)/7 ≈ 32.9.
    const out = await run([
      lead('p1', 'event', 30), lead('p2', 'event', 30), lead('p3', 'event', 30),
      lead('p4', 'event', null), lead('p5', 'event', null), lead('p6', 'event', null), lead('p7', 'event', null),
    ]);
    const src = out.filter((d) => d.issue_type === 'unqualified_lead_source');
    expect(src.length).toBeGreaterThan(0);
    expect(src[0].evidence).toMatchObject({ source_lead_count: 3, source_unscored_lead_count: 4, source_avg_quality: 30 });
  });

  it('a source with unscored leads only is never called low quality', async () => {
    const out = await run([lead('n1', 'partner', null), lead('n2', 'partner', null), lead('n3', 'partner', 0)]);
    expect(out.map((d) => d.issue_type)).not.toContain('unqualified_lead_source');
  });
});
