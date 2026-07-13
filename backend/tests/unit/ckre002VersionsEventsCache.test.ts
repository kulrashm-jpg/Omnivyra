/**
 * CKRE-002 §4/§5/§6/§7 — knowledge versions, refresh history, events, cache.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn() }));
jest.mock('../../services/signupEventService', () => ({
  SIGNUP_EVENT_SCHEMA_VERSION: '1.1',
  ensureSignupCorrelationId: jest.fn(async () => 'journey-shared'),
}));

import { supabase } from '../../db/supabaseClient';
import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { recordRawCounter } from '../../observability';
import { getKnowledgeState, recordRefresh } from '../../services/crawl/knowledgeVersionStore';
import { emitRefreshEvent, metricForRefreshEvent, REFRESH_EVENT_CAPABILITY_PREFIX } from '../../services/crawl/refreshEventService';
import { isCacheable } from '../../services/aiResponseCache';

const mockFrom = (supabase as any).from as jest.Mock;
const mockLog = logSecurityEvent as jest.MockedFunction<typeof logSecurityEvent>;
const mockCounter = recordRawCounter as jest.Mock;

function stubProfile(reportSettings: Record<string, unknown> | null, captureUpdate?: (u: any) => void) {
  mockFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({ data: reportSettings === null ? null : { report_settings: reportSettings } }),
      }),
    }),
    update: jest.fn((u: any) => { captureUpdate?.(u); return { eq: jest.fn().mockResolvedValue({ error: null }) }; }),
  });
}

describe('CKRE-002 §5/§7 — knowledge versions + history (additive report_settings)', () => {
  test('first version is 1 with null previous + rollback metadata', async () => {
    let written: any = null;
    stubProfile({ discovered_metadata: { keep: true } }, (u) => { written = u; });
    const r = await recordRefresh({
      companyId: 'org1', createVersion: true, refreshReason: 'major_change', action: 'REFRESH_FULL',
      verdict: 'MAJOR_CHANGE', affectedSections: ['business'], historyLimit: 20, now: '2026-07-14T00:00:00.000Z',
    });
    expect(r.version).toBe(1);
    expect(r.created).toBe(true);
    expect(written.report_settings.knowledge_version.version).toBe(1);
    expect(written.report_settings.knowledge_version.previousVersion).toBeNull();
    expect(written.report_settings.knowledge_version.rollback).toEqual({ previousVersion: null, previousCreatedAt: null });
    // sibling preserved (additive)
    expect(written.report_settings.discovered_metadata).toEqual({ keep: true });
    // history record appended
    expect(written.report_settings.refresh_history[0].action).toBe('REFRESH_FULL');
  });

  test('subsequent version increments and carries rollback to the prior', async () => {
    let written: any = null;
    stubProfile({ knowledge_version: { version: 3, createdAt: '2026-01-01T00:00:00.000Z' }, refresh_history: [] }, (u) => { written = u; });
    const r = await recordRefresh({
      companyId: 'org1', createVersion: true, refreshReason: 'business_change', action: 'REFRESH_BUSINESS_ONLY',
      verdict: 'BUSINESS_CHANGE', affectedSections: [], historyLimit: 20, now: '2026-07-14T00:00:00.000Z',
    });
    expect(r.version).toBe(4);
    expect(written.report_settings.knowledge_version.previousVersion).toBe(3);
    expect(written.report_settings.knowledge_version.rollback.previousCreatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  test('createVersion=false records history without minting a version', async () => {
    let written: any = null;
    stubProfile({ knowledge_version: { version: 2 }, refresh_history: [] }, (u) => { written = u; });
    const r = await recordRefresh({
      companyId: 'org1', createVersion: false, refreshReason: 'unchanged', action: 'SKIP_REFRESH',
      verdict: 'UNCHANGED', affectedSections: [], cacheHit: true, historyLimit: 20, now: 'n',
    });
    expect(r.created).toBe(false);
    expect(written.report_settings.knowledge_version.version).toBe(2); // unchanged
    expect(written.report_settings.refresh_history[0].cacheHit).toBe(true);
  });

  test('history is bounded (newest-first)', async () => {
    let written: any = null;
    const existing = Array.from({ length: 20 }, (_, i) => ({ at: `t${i}` }));
    stubProfile({ refresh_history: existing }, (u) => { written = u; });
    await recordRefresh({ companyId: 'org1', createVersion: false, refreshReason: 'r', action: 'DEFER', verdict: null, affectedSections: [], historyLimit: 20, now: 'newest' });
    expect(written.report_settings.refresh_history).toHaveLength(20);
    expect(written.report_settings.refresh_history[0].at).toBe('newest');
  });

  test('getKnowledgeState reads version + history; fail-safe on error', async () => {
    stubProfile({ knowledge_version: { version: 5 }, refresh_history: [{ at: 'x' }] });
    const s = await getKnowledgeState('org1');
    expect(s.version?.version).toBe(5);
    expect(s.history).toHaveLength(1);

    mockFrom.mockImplementation(() => { throw new Error('db down'); });
    await expect(getKnowledgeState('org1')).resolves.toEqual({ version: null, history: [] });
  });
});

describe('CKRE-002 §6 — refresh events reuse the AUTH-001 envelope', () => {
  test('capability refresh.<Event>, versioned envelope, correlation in resource_id', async () => {
    await emitRefreshEvent({ event: 'RefreshSkipped', outcome: 'allowed', correlationId: 'cid', companyId: 'org1', workflow: 'profile_refresh', reason: 'unchanged' });
    const row = mockLog.mock.calls[0][0];
    expect(row.capability).toBe(`${REFRESH_EVENT_CAPABILITY_PREFIX}RefreshSkipped`);
    expect(row.resourceId).toBe('cid');
    expect(JSON.parse(String(row.reason)).v).toBe('1.1');
  });

  test('event → metric mapping; never throws on sink failure', async () => {
    expect(metricForRefreshEvent('RefreshSkipped')).toBe('skipped');
    expect(metricForRefreshEvent('RefreshStarted')).toBe('executed');
    expect(metricForRefreshEvent('KnowledgeVersionCreated')).toBe('knowledge_version_created');
    await emitRefreshEvent({ event: 'RefreshStarted', outcome: 'allowed', correlationId: 'c', companyId: 'o', workflow: 'w' });
    expect(mockCounter).toHaveBeenCalledWith('refresh.executed', 1, { workflow: 'w' });
    mockLog.mockRejectedValueOnce(new Error('down'));
    await expect(emitRefreshEvent({ event: 'RefreshFailed', outcome: 'denied', correlationId: 'c', companyId: 'o' })).resolves.toBeUndefined();
  });
});

describe('CKRE-002 §4 — enrichment cache is opt-in', () => {
  test('enrichment ops uncacheable by default; non-enrichment ops follow NO_CACHE_OPS', () => {
    expect(isCacheable('profileExtraction')).toBe(false); // default flag off
    expect(isCacheable('profileEnrichment')).toBe(false);
    expect(isCacheable('someOtherOp')).toBe(true);
    expect(isCacheable('chatModeration')).toBe(false); // still excluded
  });
  test('enabling the flag makes enrichment ops cacheable', () => {
    const prev = process.env.CKRE_ENRICHMENT_CACHE_ENABLED;
    try {
      process.env.CKRE_ENRICHMENT_CACHE_ENABLED = 'true';
      expect(isCacheable('profileExtraction')).toBe(true);
      expect(isCacheable('profileEnrichment')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CKRE_ENRICHMENT_CACHE_ENABLED; else process.env.CKRE_ENRICHMENT_CACHE_ENABLED = prev;
    }
  });
});
