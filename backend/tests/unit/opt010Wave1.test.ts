/**
 * OPT-010 Wave 1 — behavior-parity tests for the optimized round-trips.
 *
 * A1 generation-status: parallel queue lookups, priority preserved.
 * A7 getPlatformRules: memoized reference reads (cache + inflight dedupe).
 * A2 canStartActivity: caller-supplied wallet snapshot skips the internal read.
 * A6 platformPromotionStore batched getters: one .in() query, .single() parity.
 */
import { createApiRequestMock, createMockRes } from '../utils';

// ── A1 mocks ────────────────────────────────────────────────────────────────
const mockGetJob = jest.fn();
const mockQueuesTouched: string[] = [];
jest.mock('../../queue/contentGenerationQueues', () => ({
  getContentQueue: (name: string) => {
    mockQueuesTouched.push(name);
    return { getJob: (id: string) => mockGetJob(name, id) };
  },
}));

// ── A7 / A6 supabase mock (call-counting chainable) ─────────────────────────
const mockTableResponses: Record<string, { data: any; error: any }> = {};
jest.mock('../../db/supabaseClient', () => {
  const { createSupabaseMock } = require('../utils/createSupabaseMock');
  return {
    supabase: createSupabaseMock(
      (table: string) => mockTableResponses[table] || { data: [], error: null }
    ),
  };
});
jest.mock('../../services/companyProfileService', () => ({}));

// ── A2 mocks ────────────────────────────────────────────────────────────────
jest.mock('../../services/creditPriorityService', () => ({
  getWalletSnapshot: jest.fn(),
}));

import generationStatusHandler from '../../../pages/api/content/generation-status/[jobId]';
import { getPlatformRules } from '../../services/platformIntelligenceService';
import { canStartActivity } from '../../services/billing/admissionControl';
import { getWalletSnapshot } from '../../services/creditPriorityService';
import {
  getPromotionMetadataForAssets,
} from '../../db/platformPromotionStore';
import { supabase } from '../../db/supabaseClient';

const walletMock = getWalletSnapshot as jest.Mock;
const fromMock = supabase.from as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockQueuesTouched.length = 0;
  for (const key of Object.keys(mockTableResponses)) delete mockTableResponses[key];
});

describe('A1 — generation-status parallel queue lookup', () => {
  test('job living in the LAST queue is found; all queues probed concurrently', async () => {
    mockGetJob.mockImplementation(async (queueName: string) =>
      queueName === 'bolt-content-jobs'
        ? { id: 'j1', getState: async () => 'active', progress: 40, returnvalue: null, failedReason: null, timestamp: 1735000000000 }
        : null
    );
    const res = createMockRes();
    await generationStatusHandler(createApiRequestMock({ query: { jobId: 'j1' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.jobId).toBe('j1');
    expect(res.body.status).toBe('active');
    expect(mockGetJob).toHaveBeenCalledTimes(10); // one probe per queue, no serial early-exit
  });

  test('priority preserved: duplicate id in two queues → earlier queue wins', async () => {
    mockGetJob.mockImplementation(async (queueName: string) => {
      if (queueName === 'content-post') {
        return { id: 'dup', getState: async () => 'completed', progress: 100, returnvalue: { from: 'content-post' }, failedReason: null, timestamp: 1735000000000 };
      }
      if (queueName === 'bolt-content-jobs') {
        return { id: 'dup', getState: async () => 'failed', progress: 0, returnvalue: null, failedReason: 'late', timestamp: 1735000000000 };
      }
      return null;
    });
    const res = createMockRes();
    await generationStatusHandler(createApiRequestMock({ query: { jobId: 'dup' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('completed'); // content-post (index 1) beat bolt-content-jobs (index 9)
    expect(res.body.result).toEqual({ from: 'content-post' });
  });

  test('not found in any queue → 404 unchanged', async () => {
    mockGetJob.mockResolvedValue(null);
    const res = createMockRes();
    await generationStatusHandler(createApiRequestMock({ query: { jobId: 'nope' } }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Job not found' });
  });
});

describe('A7 — getPlatformRules memoization', () => {
  test('second call for the same platform issues ZERO additional queries', async () => {
    mockTableResponses['platform_master'] = { data: { id: 'pm-1', canonical_key: 'linkedin' }, error: null };
    mockTableResponses['platform_content_rules'] = { data: [{ id: 'r1', platform_id: 'pm-1', content_type: 'post' }], error: null };

    const first = await getPlatformRules('linkedin');
    const callsAfterFirst = fromMock.mock.calls.length;
    expect(first?.platform?.id).toBe('pm-1');
    expect(callsAfterFirst).toBeGreaterThanOrEqual(2); // master + rules

    const second = await getPlatformRules('linkedin');
    expect(second).toBe(first); // same cached object
    expect(fromMock.mock.calls.length).toBe(callsAfterFirst); // no new queries
  });

  test('concurrent first calls share ONE in-flight load', async () => {
    mockTableResponses['platform_master'] = { data: { id: 'pm-x', canonical_key: 'x' }, error: null };
    mockTableResponses['platform_content_rules'] = { data: [], error: null };
    const before = fromMock.mock.calls.length;
    const [a, b, c] = await Promise.all([
      getPlatformRules('x'),
      getPlatformRules('x'),
      getPlatformRules('x'),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(fromMock.mock.calls.length - before).toBe(2); // exactly one master + one rules query
  });
});

describe('A2 — canStartActivity wallet snapshot pass-through', () => {
  const SNAPSHOT = {
    free_balance: 100, paid_balance: 50, incentive_balance: 0,
    reserved_free: 10, reserved_paid: 0, reserved_incentive: 0,
  } as any;

  test('caller-supplied snapshot: internal getWalletSnapshot NOT called; math identical', async () => {
    const d = await canStartActivity({ organizationId: 'org-1', activity: 'ai_reply', walletSnapshot: SNAPSHOT });
    expect(walletMock).not.toHaveBeenCalled();
    // effective = (100+50+0) − (10+0+0) = 140
    expect(d.effectiveCredits).toBe(140);
    expect(d.availableCredits).toBe(150);
    expect(d.activeReservations).toBe(10);
  });

  test('caller-supplied null: no_credit_account path without an internal read', async () => {
    const d = await canStartActivity({ organizationId: 'org-1', activity: 'ai_reply', walletSnapshot: null });
    expect(walletMock).not.toHaveBeenCalled();
    expect(d.reason).toBe('no_credit_account');
    expect(d.allowed).toBe(false);
  });

  test('omitted: original behavior — internal read still happens', async () => {
    walletMock.mockResolvedValue(SNAPSHOT);
    const d = await canStartActivity({ organizationId: 'org-1', activity: 'ai_reply' });
    expect(walletMock).toHaveBeenCalledTimes(1);
    expect(d.effectiveCredits).toBe(140);
  });
});

describe('A6 — batched promotion-store getters', () => {
  test('one .in() query; keys are assetId:platform', async () => {
    mockTableResponses['promotion_metadata'] = {
      data: [
        { content_asset_id: 'a1', platform: 'linkedin', v: 1 },
        { content_asset_id: 'a2', platform: 'x', v: 2 },
      ],
      error: null,
    };
    const before = fromMock.mock.calls.length;
    const map = await getPromotionMetadataForAssets(['a1', 'a2']);
    expect(fromMock.mock.calls.length - before).toBe(1);
    expect(map.get('a1:linkedin')).toMatchObject({ v: 1 });
    expect(map.get('a2:x')).toMatchObject({ v: 2 });
  });

  test('duplicate (asset, platform) rows are dropped — .single() error→null parity', async () => {
    mockTableResponses['promotion_metadata'] = {
      data: [
        { content_asset_id: 'a1', platform: 'linkedin', v: 1 },
        { content_asset_id: 'a1', platform: 'linkedin', v: 99 },
      ],
      error: null,
    };
    const map = await getPromotionMetadataForAssets(['a1']);
    expect(map.has('a1:linkedin')).toBe(false);
  });

  test('empty input issues no query at all', async () => {
    const before = fromMock.mock.calls.length;
    const map = await getPromotionMetadataForAssets([]);
    expect(fromMock.mock.calls.length - before).toBe(0);
    expect(map.size).toBe(0);
  });
});
