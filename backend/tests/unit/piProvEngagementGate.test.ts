/**
 * Workstream B — engagement adoption gating and the new-prospect rule
 * (owner decision 3, 2026-10-30).
 *
 *   - adoptLead('engagement') + the engagement bridge run only when BOTH
 *     `ENABLE_LEAD_INGESTION` AND the tenant `lead_ingestion` flag are on (REAL
 *     `resolveLeadIngestionGate`, 4 combinations)
 *   - engagement ENRICHES an existing prospect (contributing)
 *   - unqualified engagement with nothing to enrich creates NO prospect and is not adopted
 *   - qualified engagement creates per the explicit rule
 */
import * as fs from 'fs';
import * as path from 'path';
import { makeWorld, makeFakeDb, engagementSignal, feedItem, ORG_A, ORG_B, type DbOp } from './piProvBridge.helpers';

const mockDbRef: { current: ReturnType<typeof makeFakeDb> | null } = { current: null };

jest.mock('../../services/leadIntelligence/leadIntelligenceRuntime', () => ({
  adoptLeadAsync: jest.fn(async () => undefined),
  adoptLead: jest.fn(),
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockDbRef.current!.table(t),
  ownedDbRpc: jest.fn(),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockDbRef.current!.table(t), rpc: jest.fn() },
}));
jest.mock('../../services/prospectIdentity/socialContactResolution', () => ({
  resolveSocialContactIdentity: jest.fn(async () => ({ outcome: 'skipped' })),
}));
jest.mock('../../utils/leadSignalLogger', () => ({ logLeadSignalEvent: jest.fn(async () => undefined) }));

import { adoptLeadAsync } from '../../services/leadIntelligence/leadIntelligenceRuntime';
import { writeLeadSignal } from '../../services/canonicalLeadSignalService';
import {
  admitEngagementSignal,
  bridgeCommunityFeedItem,
  bridgeEngagementSignal,
  qualifyEngagementForNewProspect,
  ENGAGEMENT_NEW_PROSPECT_MIN_INTENT,
  resetBridgeCounters,
} from '../../services/prospectProvenance/communityBridge';

const adopt = adoptLeadAsync as jest.Mock;
const FLAG = 'ENABLE_LEAD_INGESTION';
const saved = process.env[FLAG];
afterAll(() => { if (saved === undefined) delete process.env[FLAG]; else process.env[FLAG] = saved; });

const CANONICAL_WRITE_TABLES = ['canonical_leads', 'canonical_users', 'unified_persons', 'identity_claims', 'source_records', 'prospect_source_contributions'];
const canonicalWrites = (ops: DbOp[]) => ops.filter((o) => CANONICAL_WRITE_TABLES.includes(o.table) && o.op !== 'select');

function db(tenantFlagOn: boolean) {
  let seq = 0;
  return makeFakeDb((op, terminal) => {
    if (op.table === 'feature_flags' && op.op === 'select') {
      return tenantFlagOn
        ? { data: { flag_key: 'lead_ingestion', enabled: true, rollout_percent: 100, rollout_cohort: null }, error: null }
        : { data: null, error: null };
    }
    if (op.table === 'contacts' && op.op === 'upsert') return { data: { id: 'contact-9', unified_person_id: null }, error: null };
    if (op.table === 'lead_signals' && op.op === 'upsert') return { data: { id: 'esig-1' }, error: null };
    if (op.op === 'insert' || op.op === 'upsert') {
      const row = { ...(op.payload as object), id: `${op.table}-${++seq}` };
      return { data: terminal === 'many' ? [row] : row, error: null };
    }
    return { data: terminal === 'many' ? [] : null, error: null };
  });
}

const engagementInput = (over: Record<string, unknown> = {}) => ({
  organization_id: ORG_A, source_type: 'engagement' as const, source_id: 'msg-1', thread_id: 'thread-1', platform: 'linkedin',
  platform_user_id: 'li_bob', intent_score: 0.9, total_score: 0.9, confidence_score: 0.9,
  detected_at: '2026-10-29T11:00:00.000Z', migration_source: 'native' as const, metadata: { lead_intent: 'buying_intent' },
  ...over,
});

beforeEach(() => { adopt.mockClear(); resetBridgeCounters(); });

describe('engagement adoption respects BOTH controls (real resolveLeadIngestionGate)', () => {
  it.each([
    ['kill switch off, tenant flag off', undefined, false, false],
    ['kill switch off, tenant flag ON', undefined, true, false],
    ['kill switch ON, tenant flag off', 'true', false, false],
    ['kill switch ON, tenant flag ON', 'true', true, true],
  ])('%s', async (_label, killSwitch, tenantFlag, expectAdopt) => {
    if (killSwitch === undefined) delete process.env[FLAG]; else process.env[FLAG] = killSwitch;
    mockDbRef.current = db(tenantFlag);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeLeadSignal({ canonical: engagementInput() });
    warn.mockRestore();
    expect(adopt.mock.calls.map((c) => c[0])).toEqual(expectAdopt ? ['engagement'] : []);
    const ops = mockDbRef.current.ops;
    if (!expectAdopt) {
      expect(canonicalWrites(ops)).toEqual([]);
    } else {
      // Qualified + gate open: the bridge created the prospect — WITHOUT a person.
      const lead = ops.find((o) => o.table === 'canonical_leads' && o.op === 'insert');
      expect(lead?.payload).toMatchObject({ company_id: ORG_A, unified_person_id: null, external_lead_key: 'engagement:msg-1', source: 'engagement' });
    }
    for (const t of ['unified_persons', 'identity_claims']) expect(ops.filter((o) => o.table === t && o.op !== 'select')).toEqual([]);
    // the kill switch is checked before any flag read
    if (killSwitch === undefined) expect(ops.map((o) => o.table)).not.toContain('feature_flags');
  });

  it('gate evaluated once per signal and shared by bridge and adoption', async () => {
    const w = makeWorld();
    const gate = jest.fn(w.deps.gate);
    const res = await admitEngagementSignal(engagementSignal(ORG_A), { ...w.deps, gate });
    expect(gate).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ adopt: false, adoptReason: 'gate_closed', bridge: { status: 'skipped', reason: 'gate_closed:tenant_flag:flag_not_found' } });
    const err = await admitEngagementSignal(engagementSignal(ORG_A), { ...w.deps, gate: async () => { throw new Error('x'); } });
    expect(err).toMatchObject({ adopt: false, adoptReason: 'gate_closed' });
  });
});

describe('engagement enriches an existing prospect; creates only when qualified', () => {
  it('enriches the prospect a community item created for the same author (contributing), even when unqualified', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    const feed = await bridgeCommunityFeedItem(feedItem(ORG_A, { platform: 'linkedin', author_metadata: { platform_user_id: 'li_bob' } }), w.deps);
    const res = await admitEngagementSignal(engagementSignal(ORG_A, { intent_score: 0.3, total_score: 0.3 }), w.deps);
    expect(res.qualification.qualified).toBe(false);
    expect(res.bridge).toMatchObject({ status: 'bridged', prospectId: feed.prospectId, prospectPath: 'existing_handle', contributionRole: 'contributing', leadCreated: false });
    expect(res).toMatchObject({ adopt: true, adoptReason: 'bridged' });
    expect(w.prospects).toHaveLength(1);
    expect(w.contributions.map((c) => [c.source_category, c.contribution_role])).toEqual([['social_listening', 'originating'], ['engagement', 'contributing']]);
  });

  it('enriches the prospect of a VERIFIED person', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    w.claims.push({ org: ORG_A, platform: 'linkedin', value: 'li_bob', personId: 'p-bob' });
    w.prospects.push({ id: 'lead-apollo', org: ORG_A, key: 'apollo:1', personId: 'p-bob', source: 'apollo', metadata: {} });
    const res = await admitEngagementSignal(engagementSignal(ORG_A, { intent_score: 0.1 }), w.deps);
    expect(res.bridge).toMatchObject({ status: 'bridged', prospectId: 'lead-apollo', prospectPath: 'existing_person', identityStatus: 'verified', contributionRole: 'contributing' });
    expect(w.prospects).toHaveLength(1);
  });

  it('unqualified engagement with nothing to enrich creates NO prospect, writes nothing, and is not adopted', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    const res = await admitEngagementSignal(engagementSignal(ORG_A, { intent_score: 0.65, total_score: 0.65 }), w.deps);
    expect(res.bridge).toMatchObject({ status: 'skipped', reason: 'not_qualified_for_new_prospect:below_high_intent' });
    expect(res).toMatchObject({ adopt: false, adoptReason: 'not_qualified_no_existing_prospect' });
    expect([w.prospects.length, w.sourceRecords.length, w.contributions.length]).toEqual([0, 0, 0]);
    expect(w.calls).not.toContain('resolveOrCreateProspect');
    expect(w.calls).not.toContain('ingestSourceRecord');
  });

  it('qualified engagement creates a prospect (originating) under the rule, recorded as evidence', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    const res = await admitEngagementSignal(engagementSignal(ORG_A, { intent_score: 0.7 }), w.deps);
    expect(res.bridge).toMatchObject({ status: 'bridged', prospectPath: 'created', contributionRole: 'originating', personId: null });
    expect(res).toMatchObject({ adopt: true });
    expect(w.prospects[0]).toMatchObject({ key: 'engagement:msg-1', source: 'engagement', personId: null });
    expect(w.prospects[0].metadata).toMatchObject({ newProspectRule: 'engagement.high_intent.v1' });
    expect(w.contributions[0].evidence).toMatchObject({ newProspectRule: { rule: 'engagement.high_intent.v1', allowed: true, reason: 'high_intent' } });
  });

  it('a replay of a created engagement prospect converges on its own key even if the score is later lower', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    await bridgeEngagementSignal(engagementSignal(ORG_A, { intent_score: 0.9 }), w.deps);
    const again = await bridgeEngagementSignal(engagementSignal(ORG_A, { intent_score: 0.2 }), w.deps);
    expect(again).toMatchObject({ status: 'bridged', prospectPath: 'own_key', contribution: 'duplicate' });
    expect(w.prospects).toHaveLength(1);
  });

  it('per tenant: an existing prospect in tenant A is never enriched by tenant B engagement', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    w.gateOpen.add(ORG_B);
    await bridgeCommunityFeedItem(feedItem(ORG_A, { platform: 'linkedin', author_metadata: { platform_user_id: 'li_bob' } }), w.deps);
    const b = await admitEngagementSignal(engagementSignal(ORG_B, { intent_score: 0.3 }), w.deps);
    expect(b.bridge).toMatchObject({ status: 'skipped', reason: 'not_qualified_for_new_prospect:below_high_intent' });
    expect(w.contributions.every((c) => c.organization_id === ORG_A)).toBe(true);
  });
});

describe('the qualification predicate', () => {
  it.each([
    [{ intent_score: 0.7 }, true, 'high_intent'],
    [{ intent_score: 0.95 }, true, 'high_intent'],
    [{ intent_score: '0.8' }, true, 'high_intent'],
    [{ intent_score: 0.69 }, false, 'below_high_intent'],
    [{ intent_score: null, total_score: 0.9 }, false, 'no_intent_score'],
    [{ intent_score: 85 }, false, 'intent_score_out_of_unit_range'],
    [{ intent_score: 0.9, metadata: { risk_flag: true } }, false, 'risk_flagged'],
  ])('%j ⇒ %s (%s)', (row, qualified, reason) => {
    expect(qualifyEngagementForNewProspect(row as Record<string, unknown>)).toMatchObject({ qualified, reason, rule: 'engagement.high_intent.v1' });
  });

  it('the threshold is the existing HIGH-intent band boundary used by the Lead Intelligence read model', () => {
    expect(ENGAGEMENT_NEW_PROSPECT_MIN_INTENT).toBe(0.7);
    const root = path.join(__dirname, '../../../lib/leadIntelligence');
    expect(fs.readFileSync(path.join(root, 'recommendations.ts'), 'utf8')).toContain("if (intent >= 0.7) return 'Reach out now — high buying intent'");
    expect(fs.readFileSync(path.join(root, 'stats.ts'), 'utf8')).toContain('if (i >= 0.7) intentBands.high += 1');
  });
});
