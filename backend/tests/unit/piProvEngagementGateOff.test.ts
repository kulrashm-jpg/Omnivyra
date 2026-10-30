/**
 * A4 — with the REAL PI ingestion gate (`resolveLeadIngestionGate`) and the real
 * bridge wiring, a closed gate means NO canonical write of any kind, while Lead
 * Intelligence adoption (`adoptLead…`) keeps running for both the community feed
 * and (after the D-1 fix) engagement signals.
 *
 * Production default: ENABLE_LEAD_INGESTION unset ⇒ kill switch off; tenant
 * `lead_ingestion` flag absent ⇒ off. Neither is changed by this work.
 */
import { makeFakeDb, ORG_A } from './piProvBridge.helpers';

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
jest.mock('../../events/listeningEvents', () => ({
  publishOpportunityDetectedEvent: jest.fn(async () => undefined),
  publishFeedUpdatedEvent: jest.fn(async () => undefined),
}));
jest.mock('../../services/intentClusteringService', () => ({
  upsertClusterForSignal: jest.fn(async () => ({ cluster: { id: 'cluster-1', cluster_key: 'k1' } })),
}));
jest.mock('../../services/prospectIdentity/socialContactResolution', () => ({
  resolveSocialContactIdentity: jest.fn(async () => ({ outcome: 'skipped' })),
}));
jest.mock('../../utils/leadSignalLogger', () => ({ logLeadSignalEvent: jest.fn(async () => undefined) }));

import { adoptLeadAsync } from '../../services/leadIntelligence/leadIntelligenceRuntime';
import { recordOpportunityFromSignal } from '../../services/opportunityFeedService';
import { writeLeadSignal } from '../../services/canonicalLeadSignalService';
import { getBridgeCounters, resetBridgeCounters, bridgeScheduledDetectionSignal } from '../../services/prospectProvenance/communityBridge';

const adopt = adoptLeadAsync as jest.Mock;
const CANONICAL_TABLES = ['canonical_leads', 'canonical_users', 'unified_persons', 'source_records', 'source_assertions', 'identity_claims', 'prospect_source_contributions'];

function db() {
  return makeFakeDb((op) => {
    if (op.table === 'opportunity_feed_items' && op.op === 'insert') {
      return { data: { ...(op.payload as object), id: 'feed-1', created_at: '2026-10-29T10:06:00.000Z' }, error: null };
    }
    if (op.table === 'contacts' && op.op === 'upsert') return { data: { id: 'contact-9', unified_person_id: null }, error: null };
    if (op.table === 'lead_signals' && op.op === 'upsert') return { data: { id: 'esig-1' }, error: null };
    return { data: null, error: null };
  });
}

const FLAG = 'ENABLE_LEAD_INGESTION';
const saved = process.env[FLAG];
afterAll(() => { if (saved === undefined) delete process.env[FLAG]; else process.env[FLAG] = saved; });
beforeEach(() => { adopt.mockClear(); resetBridgeCounters(); mockDbRef.current = db(); });

const raw = {
  upstream_id: 't3', platform: 'reddit', platform_user_id: 'u_alice', author_handle: 'alice',
  content_text: 'looking for an alternative tool', content_url: 'https://reddit.com/x', posted_at: '2026-10-29T09:00:00.000Z',
  detected_at: '2026-10-29T10:00:00.000Z', is_comment: false, metadata: {},
};
const engagement = {
  organization_id: ORG_A, source_type: 'engagement' as const, source_id: 'msg-1', thread_id: 'thread-1', platform: 'linkedin',
  platform_user_id: 'li_bob', total_score: 0.8, confidence_score: 0.7, detected_at: '2026-10-29T11:00:00.000Z', migration_source: 'native',
};

async function runBoth() {
  await recordOpportunityFromSignal({
    organizationId: ORG_A, signalId: 'sig-1', listeningExecutionId: 'exec-1', raw: raw as never,
    moderation: { outcome: 'approved', reasons: [] } as never,
    baseScores: { intent_score: 0.5, urgency_score: 0.2, icp_score: 0.5, confidence_score: 0.5, total_score: 0.5 },
  });
  await writeLeadSignal({ canonical: engagement });
  await bridgeScheduledDetectionSignal(ORG_A, 'sig-1');
}

describe.each([
  ['kill switch unset (production default)', undefined],
  ['kill switch on, tenant flag absent', 'true'],
])('gate closed — %s', (_label, value) => {
  beforeEach(() => { if (value === undefined) delete process.env[FLAG]; else process.env[FLAG] = value; });

  it('adoptLead still runs for community AND engagement, and nothing canonical is touched', async () => {
    await runBoth();
    expect(adopt.mock.calls.map((c) => c[0])).toEqual(['community', 'engagement']);
    const touched = mockDbRef.current!.ops.map((o) => o.table);
    for (const t of CANONICAL_TABLES) expect(touched).not.toContain(t);
    // the bridge did run, and was refused by the gate — observable, not silent
    const counters = getBridgeCounters();
    expect(counters['community_feed.skipped.gate_closed']).toBe(1);
    expect(counters['engagement_signal.skipped.gate_closed']).toBe(1);
    expect(counters['scheduled_detection.skipped.gate_closed']).toBe(1);
  });
});

it('with the kill switch unset the gate costs no database read at all', async () => {
  delete process.env[FLAG];
  await runBoth();
  expect(mockDbRef.current!.ops.map((o) => o.table)).not.toContain('feature_flags');
});
