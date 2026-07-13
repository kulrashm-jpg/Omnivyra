/**
 * CKRE-002 §2/§3 — refresh gate: AI runs only when policy permits.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn() }));
jest.mock('../../services/signupEventService', () => ({
  SIGNUP_EVENT_SCHEMA_VERSION: '1.1',
  ensureSignupCorrelationId: jest.fn(async () => 'journey-shared'),
}));

import { supabase } from '../../db/supabaseClient';
import { evaluateRefreshGate } from '../../services/crawl/refreshOrchestrator';
import type { ChangeDecision } from '../../services/crawl/changeDetectionService';
import type { DiscoveredWebsiteMetadata } from '../../services/companyProfile/websiteMetadataExtractor';

const mockFrom = (supabase as any).from as jest.Mock;

function stub(reportSettings: Record<string, unknown>) {
  mockFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({ data: { report_settings: reportSettings, user_locked_fields: [], logo_url: null, favicon_url: null, geography: null } }),
      }),
    }),
    update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
  });
}

const change = (verdict: ChangeDecision['verdict']): ChangeDecision => ({
  verdict, score: 0, changedLevels: [], changedFields: [], reason: 't',
  changedFingerprints: [], affectedFingerprints: [], changedSections: ['business'], reasonCodes: [], recommendedAction: 'NO_ACTION',
});

const META: DiscoveredWebsiteMetadata = {
  title: 'Acme', description: 'd', siteName: 'Acme', faviconUrl: 'https://acme.com/f.ico',
  logoUrl: 'https://acme.com/l.png', language: 'en', country: 'US', brandColor: '#000', keywords: [], openGraph: {},
};

const PRIOR_VERSION = { knowledge_version: { version: 2, createdAt: 'x' }, refresh_history: [] };

describe('CKRE-002 §3 — AI gating outcomes', () => {
  test('UNCHANGED + baseline → skip AI (SKIP_REFRESH)', async () => {
    stub(PRIOR_VERSION);
    const g = await evaluateRefreshGate({ companyId: 'org1', changeDecision: change('UNCHANGED'), metadata: META, manualRefresh: false, workflow: 'profile_refresh', now: 10_000_000_000 });
    expect(g.skipAi).toBe(true);
    expect(g.action).toBe('SKIP_REFRESH');
  });

  test('COSMETIC → skip AI (REFRESH_METADATA_ONLY, deterministic metadata written)', async () => {
    stub(PRIOR_VERSION);
    const g = await evaluateRefreshGate({ companyId: 'org1', changeDecision: change('COSMETIC_CHANGE'), metadata: META, manualRefresh: false, workflow: 'profile_refresh', now: 10_000_000_000 });
    expect(g.skipAi).toBe(true);
    expect(g.action).toBe('REFRESH_METADATA_ONLY');
    expect(g.metadataFields).toContain('logo_url');
  });

  test('BUSINESS → run AI (REFRESH_BUSINESS_ONLY)', async () => {
    stub(PRIOR_VERSION);
    const g = await evaluateRefreshGate({ companyId: 'org1', changeDecision: change('BUSINESS_CHANGE'), metadata: META, manualRefresh: false, workflow: 'profile_refresh', now: 10_000_000_000 });
    expect(g.skipAi).toBe(false);
    expect(g.action).toBe('REFRESH_BUSINESS_ONLY');
  });

  test('MAJOR → run AI (REFRESH_FULL)', async () => {
    stub(PRIOR_VERSION);
    const g = await evaluateRefreshGate({ companyId: 'org1', changeDecision: change('MAJOR_CHANGE'), metadata: META, manualRefresh: false, workflow: 'profile_refresh', now: 10_000_000_000 });
    expect(g.skipAi).toBe(false);
    expect(g.action).toBe('REFRESH_FULL');
  });

  test('first-time (no prior version, UNCHANGED) → run AI (REFRESH_FULL)', async () => {
    stub({});
    const g = await evaluateRefreshGate({ companyId: 'org1', changeDecision: change('UNCHANGED'), metadata: META, manualRefresh: false, workflow: 'profile_refresh', now: 10_000_000_000 });
    expect(g.skipAi).toBe(false);
  });

  test('manual refresh always runs AI even when UNCHANGED', async () => {
    stub(PRIOR_VERSION);
    const g = await evaluateRefreshGate({ companyId: 'org1', changeDecision: change('UNCHANGED'), metadata: META, manualRefresh: true, workflow: 'manual', now: 10_000_000_000 });
    expect(g.skipAi).toBe(false);
    expect(g.action).toBe('REFRESH_FULL');
  });

  test('no company context → run AI (preserve prior behaviour, no gating)', async () => {
    const g = await evaluateRefreshGate({ companyId: null, changeDecision: change('UNCHANGED'), metadata: META, manualRefresh: false, workflow: 'profile_refresh' });
    expect(g.skipAi).toBe(false);
  });

  test('gating disabled → run AI (EXECUTE_REFRESH)', async () => {
    const prev = process.env.CKRE_AI_GATING_ENABLED;
    try {
      process.env.CKRE_AI_GATING_ENABLED = 'false';
      stub(PRIOR_VERSION);
      const g = await evaluateRefreshGate({ companyId: 'org1', changeDecision: change('UNCHANGED'), metadata: META, manualRefresh: false, workflow: 'profile_refresh', now: 10_000_000_000 });
      expect(g.skipAi).toBe(false);
      expect(g.action).toBe('EXECUTE_REFRESH');
    } finally {
      if (prev === undefined) delete process.env.CKRE_AI_GATING_ENABLED; else process.env.CKRE_AI_GATING_ENABLED = prev;
    }
  });

  test('orchestration error fails open (never blocks a refresh — AI runs)', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db down'); });
    const g = await evaluateRefreshGate({ companyId: 'org1', changeDecision: change('UNCHANGED'), metadata: META, manualRefresh: false, workflow: 'profile_refresh' });
    expect(g.skipAi).toBe(false); // the guarantee: a failure never skips AI
    expect(['REFRESH_FULL', 'EXECUTE_REFRESH']).toContain(g.action);
  });
});
