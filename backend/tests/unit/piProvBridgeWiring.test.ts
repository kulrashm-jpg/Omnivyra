/**
 * A4 — wiring of the provenance bridge into the live producers, with the PI
 * ingestion gate OPEN for the tenant (in-memory PI services injected through
 * the bridge's default-deps seam). Database writes of the producers themselves
 * go to a chainable double.
 *
 *   opportunityFeedService.recordOpportunityFromSignal → adoptLeadAsync('community') → bridge
 *   canonicalLeadSignalService.writeLeadSignal (engagement) → adoptLeadAsync('engagement') → bridge   (D-1)
 *   leadDetectionService.processMessageForLeads(campaign_context) → scheduled_post_id kept
 *   leadJobProcessor → bridgeScheduledDetectionSignal after writeLeadSignal
 */
import * as fs from 'fs';
import * as path from 'path';
import { makeWorld, makeFakeDb, listeningSignal, ORG_A, type FakeWorld, type DbOp } from './piProvBridge.helpers';

const mockWorldRef: { current: FakeWorld | null } = { current: null };
const mockDbRef: { current: ReturnType<typeof makeFakeDb> | null } = { current: null };
const mockOrder: string[] = [];

jest.mock('../../services/prospectProvenance/bridge/defaultDeps', () => ({
  defaultBridgeDeps: () => {
    const deps = mockWorldRef.current!.deps;
    return { ...deps, gate: async (org: string) => { mockOrder.push('bridge'); return deps.gate(org); } };
  },
}));
jest.mock('../../services/leadIntelligence/leadIntelligenceRuntime', () => ({
  adoptLeadAsync: jest.fn(async (source: string) => { mockOrder.push(`adopt:${source}`); }),
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
jest.mock('../../services/leadThreadScoring', () => ({ scheduleThreadScoreUpdate: jest.fn() }));
jest.mock('../../services/responsePerformanceService', () => ({ markLeadConversion: jest.fn(async () => undefined) }));

import { adoptLeadAsync } from '../../services/leadIntelligence/leadIntelligenceRuntime';
import { recordOpportunityFromSignal } from '../../services/opportunityFeedService';
import { writeLeadSignal } from '../../services/canonicalLeadSignalService';
import { processMessageForLeads } from '../../services/leadDetectionService';

const adopt = adoptLeadAsync as jest.Mock;
const has = (op: DbOp, k: string, v: unknown) => op.filters.some(([fk, fv]) => fk === k && fv === v);

/** Producer tables only; PI tables live in the injected world. */
function producerDb(state: { leadSignalExists?: { id: string; total_score: number; confidence_score: number } | null } = {}) {
  return makeFakeDb((op, terminal) => {
    if (op.table === 'opportunity_feed_items' && op.op === 'select') return { data: null, error: null };
    if (op.table === 'opportunity_feed_items' && op.op === 'insert') {
      return { data: { ...(op.payload as object), id: 'feed-1', created_at: '2026-10-29T10:06:00.000Z' }, error: null };
    }
    if (op.table === 'contacts' && op.op === 'upsert') return { data: { id: 'contact-9', unified_person_id: null }, error: null };
    if (op.table === 'lead_signals' && op.op === 'select' && terminal === 'maybeSingle') {
      if (has(op, 'id', 'sig-1')) {
        return { data: { id: 'sig-1', organization_id: ORG_A, source_type: 'listening', source_id: 't3', platform: 'reddit', contact_id: 'contact-1',
          detected_at: '2026-10-29T10:05:00.000Z', metadata: { content_url: 'https://reddit.com/r/saas/abc', posted_at: '2026-10-29T09:00:00.000Z' } }, error: null };
      }
      return { data: state.leadSignalExists ?? null, error: null };
    }
    if (op.table === 'lead_signals' && op.op === 'upsert') return { data: { id: 'esig-1' }, error: null };
    if (op.table === 'engagement_threads' && op.op === 'update') return { data: null, error: null };
    if (op.table === 'engagement_messages' && op.op === 'select' && terminal === 'maybeSingle') {
      return { data: { content: 'can we get a demo? pricing please', platform: 'linkedin', platform_created_at: '2026-10-29T08:30:00.000Z' }, error: null };
    }
    if (op.table === 'engagement_threads' && op.op === 'select') return { data: { platform: 'linkedin' }, error: null };
    if (op.table === 'engagement_authors' && op.op === 'select') return { data: { platform_user_id: 'li_bob' }, error: null };
    if (op.table === 'engagement_messages' && op.op === 'select') return { data: [], error: null };
    return { data: null, error: null };
  });
}

beforeEach(() => {
  mockOrder.length = 0;
  adopt.mockClear();
  mockWorldRef.current = makeWorld();
  mockWorldRef.current.gateOpen.add(ORG_A);
});

const rawSignal = {
  upstream_id: 't3', platform: 'reddit', platform_user_id: 'u_alice', author_handle: 'alice',
  content_text: 'We are looking for an alternative to our current CRM, any recommendations?',
  content_url: 'https://reddit.com/r/saas/abc', posted_at: '2026-10-29T09:00:00.000Z', detected_at: '2026-10-29T10:00:00.000Z',
  is_comment: false, metadata: { subreddit: 'saas', profile_company: 'Acme' },
};

describe('community feed: adoptLead keeps working, then the bridge runs', () => {
  it('adopts with the author id lifted to the top level, then bridges into the canonical model', async () => {
    mockDbRef.current = producerDb();
    // the lead_signals row the listening pipeline wrote (read by the bridge, tenant-scoped)
    mockWorldRef.current!.signals.push(listeningSignal(ORG_A, {
      source_id: 't3', metadata: { content_url: 'https://reddit.com/r/saas/abc', posted_at: '2026-10-29T09:00:00.000Z' },
    }));
    const res = await recordOpportunityFromSignal({
      organizationId: ORG_A, signalId: 'sig-1', listeningExecutionId: 'exec-1', raw: rawSignal as never,
      moderation: { outcome: 'approved', reasons: [] } as never,
      baseScores: { intent_score: 0.7, urgency_score: 0.3, icp_score: 0.5, confidence_score: 0.6, total_score: 0.7 },
    });
    expect(res?.created).toBe(true);

    expect(adopt).toHaveBeenCalledTimes(1);
    const [source, row] = adopt.mock.calls[0];
    expect(source).toBe('community');
    expect(row).toMatchObject({ id: 'feed-1', platform_user_id: 'u_alice', author_metadata: expect.objectContaining({ platform_user_id: 'u_alice' }) });
    expect(mockOrder).toEqual(['adopt:community', 'bridge']);

    const w = mockWorldRef.current!;
    expect(w.contributions).toHaveLength(1);
    expect(w.contributions[0]).toMatchObject({
      source_category: 'social_listening', external_ref: 'community:feed-1', opportunity_feed_item_id: 'feed-1',
      lead_signal_id: 'sig-1', contact_id: 'contact-1', source_url: 'https://reddit.com/r/saas/abc',
      observed_at: '2026-10-29T09:00:00.000Z', ingestion_run_id: 'exec-1', platform: 'reddit',
    });
  });

  it('a bridge failure never breaks the feed write', async () => {
    mockDbRef.current = producerDb();
    mockWorldRef.current!.failNext.resolvePerson = new Error('db down');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await recordOpportunityFromSignal({
      organizationId: ORG_A, signalId: 'sig-1', listeningExecutionId: 'exec-1', raw: rawSignal as never,
      moderation: { outcome: 'approved', reasons: [] } as never,
      baseScores: { intent_score: 0.7, urgency_score: 0.3, icp_score: 0.5, confidence_score: 0.6, total_score: 0.7 },
    });
    warn.mockRestore();
    expect(res?.feed_item.id).toBe('feed-1');
    expect(mockWorldRef.current!.contributions).toHaveLength(0);
  });
});

describe('D-1 regression: engagement signals now adopt (and bridge)', () => {
  const input = {
    organization_id: ORG_A, source_type: 'engagement' as const, source_id: 'msg-1', thread_id: 'thread-1',
    platform: 'LinkedIn', platform_user_id: 'li_bob', content_text: 'pricing?', intent_score: 0.8, total_score: 0.8,
    confidence_score: 0.7, detected_at: '2026-10-29T11:00:00.000Z', migration_source: 'native',
    metadata: { lead_intent: 'buying_intent', author_id: 'author-1', scheduled_post_id: 'sp-77' },
  };

  it('adopts the PERSISTED signal row (tenant, platform, user, contact, metadata) — not the write receipt', async () => {
    mockDbRef.current = producerDb();
    const out = await writeLeadSignal({ canonical: input });
    expect(out).toEqual({ mode: 'canonical_only', canonical: { id: 'esig-1', inserted: true } });
    expect(adopt).toHaveBeenCalledTimes(1);
    const [source, row] = adopt.mock.calls[0];
    expect(source).toBe('engagement');
    expect(row).toMatchObject({
      id: 'esig-1', organization_id: ORG_A, source_type: 'engagement', source_id: 'msg-1', platform: 'linkedin',
      platform_user_id: 'li_bob', contact_id: 'contact-9', thread_id: 'thread-1',
      metadata: expect.objectContaining({ scheduled_post_id: 'sp-77' }),
    });
    expect(mockOrder).toEqual(['adopt:engagement', 'bridge']);
    expect(mockWorldRef.current!.contributions[0]).toMatchObject({
      source_category: 'engagement', engagement_message_id: 'msg-1', lead_signal_id: 'esig-1', contact_id: 'contact-9',
    });
    expect(mockWorldRef.current!.contributions[0].evidence).toMatchObject({ scheduledPostId: 'sp-77' });
  });

  it('an unchanged re-detection does not adopt again, but the idempotent bridge still converges', async () => {
    mockDbRef.current = producerDb({ leadSignalExists: { id: 'esig-1', total_score: 0.9, confidence_score: 0.9 } });
    const out = await writeLeadSignal({ canonical: input });
    expect(out.canonical).toEqual({ id: 'esig-1', inserted: false });
    expect(adopt).not.toHaveBeenCalled();
    expect(mockOrder).toEqual(['bridge']);
    await writeLeadSignal({ canonical: input });
    expect(mockWorldRef.current!.contributions).toHaveLength(1);
  });

  it('listening signals are NOT adopted by the writer (they reach adoption through the feed)', async () => {
    mockDbRef.current = producerDb();
    await writeLeadSignal({ canonical: { ...input, source_type: 'listening' } });
    expect(adopt).not.toHaveBeenCalled();
    expect(mockOrder).toEqual([]);
  });
});

describe('campaign scheduled_post_id is preserved', () => {
  it('processMessageForLeads carries campaign_context and the platform message time into the signal metadata', async () => {
    mockDbRef.current = producerDb();
    const r = await processMessageForLeads({
      organization_id: ORG_A, message_id: 'msg-1', thread_id: 'thread-1', author_id: 'author-1',
      content: 'can we get a demo? pricing please', intent: 'buying', thread_context: 'ctx',
      campaign_context: { scheduled_post_id: 'sp-77' },
    });
    expect(r.detected).toBe(true);
    const upsert = mockDbRef.current.ops.find((o) => o.table === 'lead_signals' && o.op === 'upsert');
    expect((upsert?.payload as { metadata: Record<string, unknown> }).metadata).toMatchObject({
      scheduled_post_id: 'sp-77', message_created_at: '2026-10-29T08:30:00.000Z',
    });
    const contribution = mockWorldRef.current!.contributions[0];
    expect(contribution.evidence).toMatchObject({ scheduledPostId: 'sp-77', observedAtBasis: 'message_created_at' });
    expect(contribution.observed_at).toBe('2026-10-29T08:30:00.000Z');
  });

  it('engagementNormalizationService passes the scheduled_post_id it receives to lead detection', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../services/engagementNormalizationService.ts'), 'utf8');
    const call = src.slice(src.indexOf('processMessageForLeads({'), src.indexOf('processMessageForLeads async error'));
    expect(call).toContain('campaign_context: { scheduled_post_id: context.scheduled_post_id ?? null }');
  });
});

describe('scheduled lead detection hook', () => {
  it('leadJobProcessor bridges the signal it just wrote, by id, after writeLeadSignal', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../services/leadJobProcessor.ts'), 'utf8');
    const write = src.indexOf('const signalWrite = await writeLeadSignal(');
    const hook = src.indexOf('await bridgeScheduledDetectionSignal(companyId, writtenSignalId)');
    expect(write).toBeGreaterThan(0);
    expect(hook).toBeGreaterThan(write);
    expect(src).toContain("import { bridgeScheduledDetectionSignal } from './prospectProvenance/communityBridge';");
  });
});
