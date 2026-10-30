/**
 * Closure C — score availability: NULL = unscored, 0 = genuinely scored zero,
 * missing never becomes 0. End to end over the pure readers: the scoring rule,
 * the canonical_leads adapter (score parts), stats bands, export, the lead
 * report plugin, audience intelligence, and the CRM scorer/writer.
 */
const getLeadStats = jest.fn();
jest.mock('../../services/leadIntelligence/leadIntelligenceReadService', () => ({ getLeadStats: (...a: unknown[]) => getLeadStats(...a) }));
jest.mock('../../services/activationReadinessService', () => ({
  buildActivationReadiness: jest.fn(async () => ({ companyId: 'co1', activated: true, generatedAt: '2026-10-30T00:00:00Z', checks: [
    { id: 'leads', label: 'Leads', done: true, detail: '', nextActionHref: '/', nextActionLabel: '' },
  ] })),
}));

import {
  readQualificationScore, effectiveQualificationScore, meanOfScored, hasQualificationScoreMarker, QUALIFICATION_SCORE_MARKER,
} from '../../../lib/prospectProvenance/scoreSemantics';
import { projectExistingRow } from '../../../lib/leadIntelligence/readModel';
import { computeLeadStats, type CanonicalLeadView } from '../../../lib/leadIntelligence';
import { toExportRow, EXPORT_NOT_SCORED } from '../../../lib/leadIntelligence/export';
import { leadPlugin } from '../../services/leadIntelligence/leadIntelligenceSnapshotAdapter';
import { buildAudienceIntelligence } from '../../services/audience/audienceService';
import { crmQualificationScore } from '../../services/crmIngestionService';

const ORG = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const crmRow = (over: Record<string, unknown>) => ({
  id: `l-${Math.random().toString(16).slice(2)}`, company_id: ORG, source: 'crm', created_at: '2026-10-01T00:00:00Z',
  lead_metadata: {}, ...over,
});
const view = (over: Record<string, unknown>): CanonicalLeadView => projectExistingRow('crm', crmRow(over), { readFrom: 'canonical_leads' });

describe('the rule (lib/prospectProvenance/scoreSemantics)', () => {
  it('NULL / undefined / blank / non-finite ⇒ unscored', () => {
    for (const v of [null, undefined, '', 'abc', Number.NaN]) {
      expect(readQualificationScore(v)).toEqual({ state: 'unscored', value: null });
    }
  });
  it('a bare 0 is the legacy column default ⇒ unscored; a MARKED 0 is a genuine zero', () => {
    expect(readQualificationScore(0)).toEqual({ state: 'legacy_default', value: null });
    expect(readQualificationScore('0.00', {})).toEqual({ state: 'legacy_default', value: null });
    const marked = { [QUALIFICATION_SCORE_MARKER]: { scoredBy: 'ws6', scoredAt: '2026-10-30T00:00:00Z', scale: 'percent' } };
    expect(hasQualificationScoreMarker(marked)).toBe(true);
    expect(readQualificationScore(0, marked)).toEqual({ state: 'scored', value: 0 });
  });
  it('any value > 0 is a score, marker or not (numeric strings from PostgREST too)', () => {
    expect(readQualificationScore(40)).toEqual({ state: 'scored', value: 40 });
    expect(readQualificationScore('12.50')).toEqual({ state: 'scored', value: 12.5 });
    expect(effectiveQualificationScore(null)).toBeNull();
  });
  it('the mean covers scored values only and is null — never 0 — when nothing is scored', () => {
    expect(meanOfScored([null, undefined])).toBeNull();
    expect(meanOfScored([0, null, 50])).toBe(25);
  });
});

const MARK = { [QUALIFICATION_SCORE_MARKER]: { scoredBy: 'test', scoredAt: '2026-10-30T00:00:00Z' } };

describe('reader: canonical_leads → view score parts (lib/leadIntelligence/adapters)', () => {
  it('NULL ⇒ total null and no source score; genuine (marked) 0 ⇒ total 0; 40 ⇒ 0.4', () => {
    expect(view({ qualification_score: null }).scores.total).toBeNull();
    expect(view({ qualification_score: null }).scores.sourceScores).toBeUndefined();
    expect(view({ qualification_score: 0 }).scores.total).toBeNull();                       // legacy default
    expect(view({ qualification_score: 0, lead_metadata: MARK }).scores.total).toBe(0);     // genuine zero
    expect(view({ qualification_score: '40.00' }).scores.total).toBeCloseTo(0.4);
  });
});

describe('stats bands, export, report plugin, audience — NULL vs 0', () => {
  const scoredZero = view({ qualification_score: 0, lead_metadata: MARK });
  const unscored = view({ qualification_score: null });
  const legacy = view({ qualification_score: 0 });
  const high = view({ qualification_score: 90 });

  it('stats: unscored (NULL and legacy 0) are their own band; a genuine 0 is LOW', () => {
    expect(computeLeadStats([scoredZero, unscored, legacy, high]).intentBands).toEqual({ high: 1, medium: 0, low: 1, unscored: 2 });
  });

  it('export: unscored ⇒ "not scored" (never "0%"); genuine 0 ⇒ "0%"', () => {
    expect(toExportRow(unscored).buying_intent).toBe(EXPORT_NOT_SCORED);
    expect(toExportRow(legacy).buying_intent).toBe(EXPORT_NOT_SCORED);
    expect(toExportRow(scoredZero).buying_intent).toBe('0%');
    expect(toExportRow(high).buying_intent).toBe('90%');
  });

  it('report plugin: Buying Intent is scored over SCORED leads; all-unscored ⇒ null score, "not scored" finding', async () => {
    getLeadStats.mockResolvedValueOnce({ ...computeLeadStats([unscored, legacy, unscored]), withIdentity: 0, withCampaign: 0 });
    let data = await leadPlugin.provide({ companyId: 'co1' } as never);
    let bi = data.modules.find((m) => m.key === 'buying_intent')!;
    expect(bi.score).toBeNull();
    expect(bi.available).toBe(false);
    expect(bi.findings).toEqual(['None of 3 leads is scored yet']);
    expect(data.recommendationInputs.map((r) => r.key)).not.toContain('low_buying_intent');

    getLeadStats.mockResolvedValueOnce({ ...computeLeadStats([high, unscored, unscored, unscored]), withIdentity: 0, withCampaign: 0 });
    data = await leadPlugin.provide({ companyId: 'co1' } as never);
    bi = data.modules.find((m) => m.key === 'buying_intent')!;
    expect(bi.score).toBe(100);                       // 1 high of 1 scored — not diluted by 3 unscored
    expect(bi.findings).toEqual(['1 high-intent of 1 scored leads', '3 lead(s) not scored']);

    getLeadStats.mockResolvedValueOnce({ ...computeLeadStats([scoredZero, unscored]), withIdentity: 0, withCampaign: 0 });
    data = await leadPlugin.provide({ companyId: 'co1' } as never);
    expect(data.modules.find((m) => m.key === 'buying_intent')!.score).toBe(20);   // the genuine 0 is a real LOW
  });

  it('audience: unscored members are excluded from avgIntent and bands', () => {
    const m = (v: CanonicalLeadView) => ({ entityId: 'e', view: v, matchedRules: [], evidence: [], confidence: 1 });
    const ai = buildAudienceIntelligence([m(high), m(unscored), m(legacy)] as never);
    expect(ai).toMatchObject({ members: 3, scoredMembers: 1, avgIntent: 0.9, intentBands: { high: 1, medium: 0, low: 0, unscored: 2 } });
    const zero = buildAudienceIntelligence([m(scoredZero), m(high)] as never);
    expect(zero).toMatchObject({ scoredMembers: 2, avgIntent: 0.45, intentBands: { high: 1, low: 1, unscored: 0 } });
    expect(buildAudienceIntelligence([m(unscored)] as never)).toMatchObject({ scoredMembers: 0, avgIntent: 0, intentBands: { unscored: 1 } });
  });
});

describe('writer: the CRM scorer', () => {
  it('no usable revenue ⇒ null (unscored), never a stamped 40 or 0', () => {
    for (const r of [null, undefined, '', '  ', 'n/a']) expect(crmQualificationScore(r)).toBeNull();
  });
  it('with revenue the existing rule is unchanged (floor 40, revenue/100, cap 100) — it never emits 0', () => {
    expect(crmQualificationScore(0)).toBe(40);
    expect(crmQualificationScore('5000')).toBe(50);
    expect(crmQualificationScore(1e9)).toBe(100);
  });
});
