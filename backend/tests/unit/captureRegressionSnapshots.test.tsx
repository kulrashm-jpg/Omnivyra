/**
 * @jest-environment jsdom
 *
 * INT-001 Phase 0 (P0-G) — as-is regression snapshots for the straggler capture
 * flows: /api/readiness-lead, the blog content tracker (/api/track) silent-204
 * contract, and the free-audit client submission.
 *
 * Deliberate bug pins (current behaviour is the source of truth):
 *  • readiness-lead SILENTLY DROPS industry/monthlyTraffic/campaignBudget sent
 *    by ReadinessSection/ReadinessModal — pinned exactly as-is.
 *  • free-audit flattens the structured wizard answers into ONE free-text
 *    message string and is fail-open (report renders even if capture fails).
 * No production change.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── shared table-routed supabase mock (raw service-role client) ──────────────
const supabaseInserts: Array<{ table: string; payload: unknown }> = [];
const supabaseResponses: Record<string, { data: unknown; error: unknown }> = {};
let supabaseInsertError: Record<string, unknown> = {};

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const chain: any = {
        select: jest.fn(() => chain),
        eq: jest.fn(() => chain),
        maybeSingle: jest.fn(async () => supabaseResponses[table] ?? { data: null, error: null }),
        insert: jest.fn((p: unknown) => {
          supabaseInserts.push({ table, payload: p });
          return {
            then: (res: any, rej?: any) =>
              Promise.resolve({ data: null, error: supabaseInsertError[table] ?? null }).then(res, rej),
          };
        }),
      };
      return chain;
    },
  },
}));

const getSupabaseUserFromRequest = jest.fn();
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: (...a: unknown[]) => getSupabaseUserFromRequest(...a),
}));

// ── free-audit client mocks ───────────────────────────────────────────────────
const routerPush = jest.fn();
jest.mock('next/router', () => ({ useRouter: () => ({ query: {}, push: routerPush, replace: jest.fn() }) }));
jest.mock('../../../components/seo/MarketingPageMeta', () => () => null);
const trackWebsiteEvent = jest.fn();
jest.mock('../../../lib/websiteAnalytics', () => ({ trackWebsiteEvent: (...a: unknown[]) => trackWebsiteEvent(...a) }));
const safeFetchJson = jest.fn();
jest.mock('../../../lib/utils/safeFetchJson', () => ({ safeFetchJson: (...a: unknown[]) => safeFetchJson(...a) }));
jest.mock('../../../lib/website/attributionCapture', () => ({
  captureAttribution: () => ({ utm_source: 'google', session_id: '', anonymous_id: '', landing_page: '/free-audit/start' }),
}));

import readinessHandler from '../../../pages/api/readiness-lead';
import trackHandler from '../../../pages/api/track';
import FreeAuditStart from '../../../pages/free-audit/start';
import { createMockRes } from '../utils/setupApiTest';

const apiReq = (body: unknown, over: Record<string, unknown> = {}) => ({
  method: 'POST', headers: { 'user-agent': 'Mozilla/5.0' }, body, query: {}, cookies: {}, ...over,
} as any);

beforeEach(() => {
  jest.clearAllMocks();
  supabaseInserts.length = 0;
  supabaseInsertError = {};
  for (const k of Object.keys(supabaseResponses)) delete supabaseResponses[k];
  getSupabaseUserFromRequest.mockResolvedValue({ user: { id: 'u-1' } });
});

describe('P0-G — /api/readiness-lead as-is', () => {
  test('405 non-POST; 400 missing fields; 400 out-of-range score', async () => {
    let res = createMockRes();
    await readinessHandler(apiReq({}, { method: 'GET' }), res);
    expect(res.statusCode).toBe(405);

    res = createMockRes();
    await readinessHandler(apiReq({ companyName: 'Acme' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'companyName and websiteUrl are required' });

    res = createMockRes();
    await readinessHandler(apiReq({ companyName: 'Acme', websiteUrl: 'https://acme.com', score: 250 }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'score must be a number between 0 and 100' });
  });

  test('DROPPED-FIELDS PIN: industry/monthlyTraffic/campaignBudget from the widget are NOT persisted; insert is exactly the 6 known columns', async () => {
    const res = createMockRes();
    await readinessHandler(apiReq({
      companyName: ' Acme ', websiteUrl: ' https://acme.com ', email: ' a@b.com ', score: 72,
      industry: 'SaaS', monthlyTraffic: '10k-50k', campaignBudget: '$5k', // sent by ReadinessSection/Modal
    }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(supabaseInserts).toHaveLength(1);
    expect(supabaseInserts[0].table).toBe('campaign_readiness_leads');
    const payload = supabaseInserts[0].payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ['company_name', 'created_at', 'email', 'score', 'user_id', 'website_url'],
    );
    expect(payload).toMatchObject({
      company_name: 'Acme', website_url: 'https://acme.com', email: 'a@b.com', score: 72, user_id: 'u-1',
    });
    // the widget's extra context is silently dropped today — pinned as-is
    expect(payload.industry).toBeUndefined();
  });

  test('anonymous submit → user_id null; insert error → 500 exact message', async () => {
    getSupabaseUserFromRequest.mockResolvedValue({ user: null });
    let res = createMockRes();
    await readinessHandler(apiReq({ companyName: 'A', websiteUrl: 'https://a.com', score: 1 }), res);
    expect((supabaseInserts[0].payload as Record<string, unknown>).user_id).toBeNull();

    supabaseInsertError = { campaign_readiness_leads: { message: 'db down' } };
    res = createMockRes();
    await readinessHandler(apiReq({ companyName: 'A', websiteUrl: 'https://a.com', score: 1 }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to save lead' });
  });
});

describe('P0-G — /api/track silent-204 contract as-is', () => {
  const EVENT = { account_id: 'co-1', session_id: 's-1', url: 'https://blog.acme.com/post/a?x=1', event_type: 'scroll_milestone', time_on_page: 9999, scroll_depth: 150 };

  test('every rejection is a silent 204 with no insert: bot UA, unknown account, no allowed_domain, domain mismatch', async () => {
    // bot UA
    let res = createMockRes();
    await trackHandler(apiReq({ events: [EVENT] }, { headers: { 'user-agent': 'Googlebot/2.1' } }), res);
    expect(res.statusCode).toBe(204);
    // unknown account
    res = createMockRes();
    await trackHandler(apiReq({ events: [EVENT] }), res);
    expect(res.statusCode).toBe(204);
    // known account, no allowed_domain configured
    supabaseResponses['company_profiles'] = { data: { company_id: 'co-1' }, error: null };
    res = createMockRes();
    await trackHandler(apiReq({ events: [EVENT] }), res);
    expect(res.statusCode).toBe(204);
    // allowed_domain configured but origin/referer mismatch
    supabaseResponses['blog_intelligence_settings'] = { data: { allowed_domain: 'blog.acme.com', allow_subdomains: false }, error: null };
    res = createMockRes();
    await trackHandler(apiReq({ events: [EVENT] }, { headers: { 'user-agent': 'Mozilla/5.0', origin: 'https://evil.com' } }), res);
    expect(res.statusCode).toBe(204);
    expect(supabaseInserts).toHaveLength(0); // nothing ever written
  });

  test('accepted batch → 204 with clamped rows (time≤7200, scroll≤100, pathname-only url, event allow-list fallback to pageview)', async () => {
    supabaseResponses['company_profiles'] = { data: { company_id: 'co-1' }, error: null };
    supabaseResponses['blog_intelligence_settings'] = { data: { allowed_domain: 'blog.acme.com', allow_subdomains: false }, error: null };
    const res = createMockRes();
    await trackHandler(apiReq(
      { events: [EVENT, { ...EVENT, event_type: 'not_a_real_type' }] },
      { headers: { 'user-agent': 'Mozilla/5.0', origin: 'https://blog.acme.com' } },
    ), res);
    expect(res.statusCode).toBe(204);
    expect(supabaseInserts).toHaveLength(1);
    const rows = supabaseInserts[0].payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      account_id: 'co-1', session_id: 's-1', url_slug: '/post/a',
      event_type: 'scroll_milestone', time_on_page: 7200, scroll_depth: 100,
    });
    expect(rows[1]).toMatchObject({ event_type: 'pageview' }); // disallowed type falls back
  });
});

describe('P0-G — free-audit client capture as-is', () => {
  async function walkToStep3() {
    render(<FreeAuditStart />);
    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://shop.acme.com/page' } });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Generate leads'));
    fireEvent.change(screen.getByLabelText('Product/service type'), { target: { value: 'SaaS' } });
    fireEvent.click(screen.getByText('Free'));
    fireEvent.change(screen.getByLabelText('Target audience'), { target: { value: 'SMBs' } });
    fireEvent.click(screen.getByText('Organic search'));
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'buyer@acme.com' } });
    fireEvent.click(screen.getByRole('checkbox'));
  }

  test('FLATTENING PIN: wizard answers collapse into one free-text message; company = hostname; attribution spread into the body', async () => {
    jest.useFakeTimers();
    try {
      safeFetchJson.mockResolvedValue({ ok: true, status: 200, data: {} });
      await walkToStep3();
      await act(async () => { fireEvent.click(screen.getByText('Get My Report')); });
      expect(trackWebsiteEvent).toHaveBeenCalledWith('lead_created', { lead_source: 'free_audit', lead_surface: '/free-audit/start' });
      expect(safeFetchJson).toHaveBeenCalledTimes(1);
      const [url, init] = safeFetchJson.mock.calls[0] as [string, { body: string }];
      expect(url).toBe('/api/website/lead-capture');
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({
        intent: 'free_audit', email: 'buyer@acme.com', company: 'shop.acme.com',
        primaryInterest: 'Website audit', consent: true,
        utm_source: 'google', landing_page: '/free-audit/start', // spread client attribution
      });
      // the structured answers exist ONLY inside the flattened message string
      expect(body.message).toBe(
        'Free audit request. URL: https://shop.acme.com/page. Goal: Generate leads. Product: SaaS. Price: Free. Audience: SMBs. Traffic: Organic search.',
      );
      expect(body.primaryGoal).toBeUndefined();
      expect(body.productType).toBeUndefined();
      await act(async () => { jest.advanceTimersByTime(2600); });
      expect(routerPush).toHaveBeenCalledWith({ pathname: '/free-audit/report', query: { url: 'https://shop.acme.com/page' } });
    } finally {
      jest.useRealTimers();
    }
  });

  test('FAIL-OPEN PIN: capture rejection never blocks the report navigation', async () => {
    jest.useFakeTimers();
    try {
      safeFetchJson.mockRejectedValue(new Error('capture down'));
      await walkToStep3();
      await act(async () => { fireEvent.click(screen.getByText('Get My Report')); });
      await act(async () => { jest.advanceTimersByTime(2600); });
      expect(routerPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/free-audit/report' }));
    } finally {
      jest.useRealTimers();
    }
  });
});
