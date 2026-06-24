/**
 * Phase 25C — governed activation-outreach tests. Pure gate + orchestration (no real send).
 */

import {
  evaluateOutreach,
  sendGovernedActivationOutreach,
  type OutreachContext,
  type GovernedOutreachDeps,
} from '../../services/activationOutreachService';
import type { CustomerActivationInput } from '../../services/customerActivationWorkbenchService';

const activation = (over: Partial<CustomerActivationInput> = {}): CustomerActivationInput => ({
  company_id: 'c1', company_name: 'Acme',
  profile_confidence: 100, domain_verified: false, ga_status: null, gsc_status: null, active_team_members: 1, ...over,
});

const ctx = (over: Partial<OutreachContext> = {}): OutreachContext => ({
  company_id: 'c1', company_exists: true, company_name: 'Acme', classification: 'CUSTOMER',
  admin_email: 'admin@acme.com', activation: activation(), app_url: 'https://www.omnivyra.com', ...over,
});

describe('evaluateOutreach — governance gate', () => {
  it('rejects non-existent company', () => {
    expect(evaluateOutreach(ctx({ company_exists: false })).ok).toBe(false);
    expect(evaluateOutreach(ctx({ company_exists: false }))).toMatchObject({ reason: 'COMPANY_NOT_FOUND' });
  });
  it('rejects QA / TEST / INTERNAL / DEMO / UNKNOWN / untracked as NOT_CUSTOMER', () => {
    for (const c of ['QA', 'TEST', 'INTERNAL', 'DEMO', 'UNKNOWN', null] as const) {
      expect(evaluateOutreach(ctx({ classification: c }))).toMatchObject({ ok: false, reason: 'NOT_CUSTOMER' });
    }
  });
  it('rejects CUSTOMER with no active admin', () => {
    expect(evaluateOutreach(ctx({ admin_email: null }))).toMatchObject({ reason: 'NO_ACTIVE_ADMIN' });
    expect(evaluateOutreach(ctx({ admin_email: 'not-an-email' }))).toMatchObject({ reason: 'NO_ACTIVE_ADMIN' });
  });
  it('rejects already-activated (no remaining milestones)', () => {
    const done = activation({ domain_verified: true, ga_status: 'connected', gsc_status: 'connected', active_team_members: 2 });
    expect(evaluateOutreach(ctx({ activation: done }))).toMatchObject({ reason: 'ALREADY_ACTIVATED' });
  });
  it('accepts valid CUSTOMER and resolves recipient from admin (never caller-supplied)', () => {
    const d = evaluateOutreach(ctx());
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.recipientEmail).toBe('admin@acme.com');
      expect(d.missingMilestones).toEqual(['DOMAIN', 'GA', 'GSC', 'TEAM']);
      expect(d.ctaUrl).toBe('https://www.omnivyra.com/integrations');
    }
  });
});

// Minimal chainable supabase stub: single tables resolve via maybeSingle, list tables via await.
function dbStub(spec: Record<string, { single?: any; list?: any[] }>, inserts: any[]) {
  return {
    from(table: string) {
      const api: any = {
        select: () => api,
        eq: () => api,
        maybeSingle: () => Promise.resolve({ data: spec[table]?.single ?? null }),
        insert: (row: any) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); },
        then: (resolve: any) => Promise.resolve({ data: spec[table]?.list ?? [] }).then(resolve),
      };
      return api;
    },
  };
}

describe('sendGovernedActivationOutreach — orchestration (no real send)', () => {
  const baseSpec = () => ({
    customer_population_classification: { single: { classification: 'CUSTOMER' } },
    companies: { single: { id: 'c1', name: 'Acme' } },
    user_company_roles: { list: [{ user_id: 'u1', role: 'OWNER', status: 'active', created_at: '2026-01-01' }] },
    users: { single: { email: 'admin@acme.com' } },
    company_profiles: { single: { overall_confidence: 100 } },
    company_domains: { list: [] },
    analytics_integrations: { list: [] },
  });

  it('valid CUSTOMER → sends via injected seam + audits attempt & success', async () => {
    const inserts: any[] = [];
    const sent: any[] = [];
    const deps: GovernedOutreachDeps = {
      db: dbStub(baseSpec(), inserts) as any,
      appUrl: 'https://www.omnivyra.com',
      now: () => '2026-06-24T00:00:00Z',
      send: (async (opts: any) => { sent.push(opts); }) as any,
    };
    const res = await sendGovernedActivationOutreach('c1', deps);
    expect(res.sent).toBe(true);
    expect(res.recipientEmail).toBe('admin@acme.com');
    expect(sent[0].recipientEmail).toBe('admin@acme.com');
    expect(sent[0].missingMilestones).toEqual(['DOMAIN', 'GA', 'GSC', 'TEAM']);
    const types = inserts.map((i) => `${i.row.activity_type}:${i.row.status}`);
    expect(types).toEqual(['OUTREACH_ATTEMPT:attempted', 'OUTREACH_RESULT:success']);
  });

  it('QA company → no send, audits rejection', async () => {
    const spec = baseSpec();
    spec.customer_population_classification.single.classification = 'QA';
    const inserts: any[] = [];
    let sendCalled = false;
    const res = await sendGovernedActivationOutreach('c1', {
      db: dbStub(spec, inserts) as any, appUrl: 'https://x', now: () => 't',
      send: (async () => { sendCalled = true; }) as any,
    });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('NOT_CUSTOMER');
    expect(sendCalled).toBe(false);
    expect(inserts[0].row.status).toBe('rejected:NOT_CUSTOMER');
  });
});
