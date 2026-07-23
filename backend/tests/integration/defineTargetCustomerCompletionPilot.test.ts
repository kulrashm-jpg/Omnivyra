/**
 * CONVERSATION-INTELLIGENCE-001 Phase E — pilot route wiring (completion intelligence).
 *
 * Proves the flag-gated terminal state on /api/company-profile/define-target-customer,
 * reusing the SAME `profile-conversation-orchestrator` flag as Phase C:
 *   - flag OFF (default) → BYTE-IDENTICAL to before: even a core-complete profile
 *     still returns the AI-emitted nextQuestion verbatim (the orchestrator, and
 *     therefore the completion signal, is never consulted).
 *   - flag ON + core satisfied → the interview naturally STOPS: the route returns
 *     a completion + descriptive handoff signal instead of asking another question.
 *   - flag ON + core NOT yet satisfied → still returns a question (no false stop).
 *
 * Only the I/O seams (profile load, AI completion, access) are mocked; the real
 * orchestrator + real knowledge graph run, so the completion asserted here is
 * genuine and delegates to the graph's enoughToProceed.
 */
import handler from '../../../pages/api/company-profile/define-target-customer';
import { createApiRequestMock, createMockRes } from '../utils';
import type { CompanyProfile } from '../../services/companyProfile/types';
import { PROFILE_CONVERSATION_HANDOFF_KEY } from '../../services/companyProfile/profileConversationOrchestrator';

const MODE_ENV = 'ROLLOUT_PROFILE_CONVERSATION_ORCHESTRATOR_MODE';

jest.mock('../../services/contentArchitectService', () => ({
  resolveCompanyAccess: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'SUPER_ADMIN' }),
}));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({
  getCanonicalProfile: jest.fn(),
}));
jest.mock('../../services/aiGateway', () => ({
  runCompletion: jest.fn(),
}));

import { getCanonicalProfile } from '../../services/context/canonicalProfileAdapter';
import { runCompletion } from '../../services/aiGateway';

// A profile whose entire knowledge CORE is satisfied at High confidence →
// enoughToProceed is true → the interview should hand off (flag ON).
const CORE_COMPLETE_PROFILE: CompanyProfile = {
  company_id: 'acme',
  name: 'Acme',
  website_url: 'acme.com',
  industry: 'Software',
  products_services: 'Retail analytics dashboards',
  target_audience: 'Retail ops leaders',
  unique_value: 'Real-time signal',
  field_confidence: {
    name: 'High', website_url: 'High', industry: 'High', products_services: 'High',
    target_audience: 'High', unique_value: 'High',
  },
} as CompanyProfile;

// A profile with only one core node satisfied → NOT enough to proceed.
const PARTIAL_PROFILE: CompanyProfile = {
  company_id: 'acme',
  products_services: 'Retail analytics dashboards',
  field_confidence: { products_services: 'High' },
} as CompanyProfile;

const setAi = (payload: Record<string, unknown>) =>
  (runCompletion as jest.Mock).mockResolvedValue({ output: JSON.stringify(payload) });

const run = async (profile: CompanyProfile, body: Record<string, unknown> = {}) => {
  (getCanonicalProfile as jest.Mock).mockResolvedValue(profile);
  const req = createApiRequestMock({ method: 'POST', companyId: 'acme', body });
  const res = createMockRes();
  await handler(req, res);
  return res;
};

describe('define-target-customer pilot — Phase E completion handoff', () => {
  const original = process.env[MODE_ENV];
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env[MODE_ENV];
  });
  afterAll(() => {
    if (original === undefined) delete process.env[MODE_ENV];
    else process.env[MODE_ENV] = original;
  });

  test('flag OFF (default): a core-complete profile STILL returns the AI question verbatim (byte-identical)', async () => {
    setAi({ nextQuestion: 'What is your pricing model?' });
    const res = await run(CORE_COMPLETE_PROFILE, { conversation: [] });
    expect(res.statusCode).toBe(200);
    // byte-identical: exactly the AI string, single key — no completion/transition.
    expect(res.body).toEqual({ nextQuestion: 'What is your pricing model?' });
    expect(res.body).not.toHaveProperty('complete');
    expect(res.body).not.toHaveProperty('transition');
  });

  test('flag ON + core satisfied: the interview STOPS and returns a completion + handoff signal', async () => {
    process.env[MODE_ENV] = 'enforce';
    // The AI would still ask another question — but the orchestrator overrides it.
    setAi({ nextQuestion: 'What is your pricing model?' });
    const res = await run(CORE_COMPLETE_PROFILE, { conversation: [] });
    expect(res.statusCode).toBe(200);
    expect(res.body.complete).toBe(true);
    expect(res.body.nextQuestion).toBeNull();
    expect(res.body.transition.ready).toBe(true);
    expect(res.body.transition.suggestedNext).toBe(PROFILE_CONVERSATION_HANDOFF_KEY);
    // readiness is surfaced for the handoff.
    expect(res.body.readiness.enoughToProceed).toBe(true);
  });

  test('flag ON + core NOT yet satisfied: still asks (no false completion)', async () => {
    process.env[MODE_ENV] = 'enforce';
    // An eligible AI question about an unknown node → passed through, no handoff.
    setAi({ nextQuestion: 'What is your website address?' });
    const res = await run(PARTIAL_PROFILE, { conversation: [] });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toHaveProperty('complete');
    expect(res.body.nextQuestion).toBe('What is your website address?');
  });

  test('flag ON + core satisfied + AI returns done: the done/extraction path is unaffected', async () => {
    process.env[MODE_ENV] = 'enforce';
    setAi({
      done: true,
      structuredFields: {
        target_customer_segment: 'SMB', ideal_customer_profile: 'Retail ops lead',
        pricing_model: 'subscription', sales_motion: 'self-serve', avg_deal_size: '$5k',
        sales_cycle: 'weeks', key_metrics: 'MRR, CAC',
      },
    });
    const res = await run(CORE_COMPLETE_PROFILE, { conversation: [] });
    // The completion overlay only intercepts the question path; done short-circuits first.
    expect(res.body.done).toBe(true);
    expect(res.body).not.toHaveProperty('transition');
  });
});
