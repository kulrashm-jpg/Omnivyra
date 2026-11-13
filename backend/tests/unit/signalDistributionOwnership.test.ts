/**
 * Signal distribution respects signal OWNERSHIP (e9 ruling, 2026-11-13; latent leak found by the embed sweep).
 *
 * intelligence_signals.company_id is set for signals fetched from ONE company's profile-driven trend queries; NULL means
 * global. processInsertedSignalsForCompany (the only writer path into company_intelligence_signals for distribution)
 * ignored the owner, so backend/scripts/activateCompanyIntelligence.ts - which distributes ALL signal ids - pushed
 * company B's headlines (topic + normalized_payload) into company A's intelligence views.
 *
 * The db fake is FAITHFUL for the two tables touched: `in` filters must match; the upsert records what was written.
 */
import fs from 'fs';
import path from 'path';

type Row = Record<string, any>;
const CO_A = 'c0a00000-0000-4000-8000-00000000000a';
const CO_B = 'c0b00000-0000-4000-8000-00000000000b';
const SIGNALS: Row[] = [
  { id: 'sig-global', company_id: null, topic: 'Global headline', relevance_score: 1, primary_category: 'x', tags: [], normalized_payload: {}, detected_at: null },
  { id: 'sig-a', company_id: CO_A, topic: 'A-only headline', relevance_score: 1, primary_category: 'x', tags: [], normalized_payload: {}, detected_at: null },
  { id: 'sig-b', company_id: CO_B, topic: 'B SECRET query headline', relevance_score: 1, primary_category: 'x', tags: [], normalized_payload: { q: 'B brand' }, detected_at: null },
];
const written: Array<{ company_id: string; signal_id: string }> = [];

function table(name: string) {
  const q: any = {};
  let ids: string[] | null = null;
  let cols: string[] | null = null;
  q.select = (c: string) => { cols = c.split(',').map((x) => x.trim()); return q; };
  q.in = (_c: string, v: string[]) => { ids = v; return q; };
  q.upsert = (rows: Row[]) => { for (const r of rows) written.push({ company_id: r.company_id, signal_id: r.signal_id }); return { select: async () => ({ data: rows.map((_, i) => ({ id: `w${i}` })), error: null }) }; };
  q.then = (ok: any, ko: any) => {
    if (name !== 'intelligence_signals') return Promise.resolve({ data: [], error: null }).then(ok, ko);
    // FAITHFUL projection: a column that is not selected is not returned.
    const rows = SIGNALS.filter((s) => !ids || ids.includes(s.id)).map((s) => (cols ? Object.fromEntries(cols.map((c) => [c, s[c]])) : s));
    return Promise.resolve({ data: rows, error: null }).then(ok, ko);
  };
  return q;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => table(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => table(t) } }));
jest.mock('../../services/companySignalFilteringEngine', () => ({ filterSignalsForCompany: async (_c: string, s: Row[]) => s }));
jest.mock('../../services/companySignalRankingEngine', () => ({
  computeSignalPriority: () => 'medium',
  rankSignalsForCompany: async (_c: string, s: Row[]) => s.map((x) => ({ signal_id: x.id, signal_score: 1, momentum_score: 1, topic_match: 1, matched_topics: [], matched_competitors: [], matched_regions: [] })),
}));
jest.mock('../../services/companyIntelligenceCache', () => ({ invalidateCompanyCache: async () => undefined }));

/* eslint-disable @typescript-eslint/no-var-requires */
const { processInsertedSignalsForCompany } = require('../../services/companyIntelligenceStore');
/* eslint-enable @typescript-eslint/no-var-requires */

beforeEach(() => { written.length = 0; });
const ALL = SIGNALS.map((s) => s.id);
const toCompany = (c: string) => written.filter((w) => w.company_id === c).map((w) => w.signal_id).sort();

describe('processInsertedSignalsForCompany: a company receives only GLOBAL signals and its OWN', () => {
  it("CRITICAL: distributing ALL ids to A never writes B's company-scoped signal", async () => {
    await processInsertedSignalsForCompany(CO_A, ALL);
    expect(toCompany(CO_A)).toEqual(['sig-a', 'sig-global']);
  });

  it('B receives its own signal and the global one, never A’s', async () => {
    await processInsertedSignalsForCompany(CO_B, ALL);
    expect(toCompany(CO_B)).toEqual(['sig-b', 'sig-global']);
  });

  it('CONTROL: global signals still reach every company', async () => {
    await processInsertedSignalsForCompany(CO_A, ['sig-global']);
    await processInsertedSignalsForCompany(CO_B, ['sig-global']);
    expect(written).toEqual([{ company_id: CO_A, signal_id: 'sig-global' }, { company_id: CO_B, signal_id: 'sig-global' }]);
  });
});

describe('activateCompanyIntelligence.ts only distributes through the ownership-checked path', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../scripts/activateCompanyIntelligence.ts'), 'utf8');
  it('it calls distributeSignalsToCompanies (POSITIVE CONTROL: the call is seen)', () => {
    expect(/distributeSignalsToCompanies\(/.test(src)).toBe(true);
  });
  it('it never writes company_intelligence_signals directly (no bypass of the ownership filter)', () => {
    const direct = /(from|ownedDbTable)\(\s*['"]company_intelligence_signals['"]\s*\)[\s\S]{0,200}?\.(insert|upsert|update)\(/.test(src);
    expect(direct).toBe(false);
  });
});
