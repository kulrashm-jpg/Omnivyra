/**
 * CONVERSATION-INTELLIGENCE-001 Phase C — pilot route wiring.
 *
 * Proves the flag-gated adoption of the canonical profileConversationOrchestrator
 * on /api/company-profile/define-target-customer:
 *   - flag OFF (default) → the route is BYTE-IDENTICAL to before: the AI-emitted
 *     nextQuestion is returned verbatim; the orchestrator is never consulted.
 *   - flag ON → an AI-emitted question that maps to an ALREADY-SATISFIED node
 *     (never-re-ask / semantic dedup) is REFUSED and replaced with the
 *     orchestrator's highest-value next gap; an eligible AI question is passed
 *     through untouched.
 *   - the `done`/structuredFields extraction path is unaffected by the flag
 *     (question governance only; extraction is Phase D).
 *
 * Only the I/O seams (profile load, AI completion, access) are mocked; the real
 * orchestrator + real knowledge graph run, so the gating asserted here is genuine.
 */
import handler from '../../../pages/api/company-profile/define-target-customer';
import { createApiRequestMock, createMockRes } from '../utils';
import type { CompanyProfile } from '../../services/companyProfile/types';

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

// A profile whose products_services node is already satisfied (High confidence)
// and nothing else — so an AI question that maps to products_services must be
// refused when the flag is ON, and the highest-value remaining gap is `company`.
const PROFILE: CompanyProfile = {
  company_id: 'acme',
  products_services: 'Retail analytics dashboards',
  field_confidence: { products_services: 'High' },
} as CompanyProfile;

const setAi = (payload: Record<string, unknown>) =>
  (runCompletion as jest.Mock).mockResolvedValue({ output: JSON.stringify(payload) });

const run = async (body: Record<string, unknown> = {}) => {
  (getCanonicalProfile as jest.Mock).mockResolvedValue(PROFILE);
  const req = createApiRequestMock({ method: 'POST', companyId: 'acme', body });
  const res = createMockRes();
  await handler(req, res);
  return res;
};

describe('define-target-customer pilot — orchestrator flag', () => {
  const original = process.env[MODE_ENV];
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env[MODE_ENV];
  });
  afterAll(() => {
    if (original === undefined) delete process.env[MODE_ENV];
    else process.env[MODE_ENV] = original;
  });

  test('flag OFF (default): AI nextQuestion returned VERBATIM even if it re-asks a known node', async () => {
    // AI emits a question that maps to an already-satisfied node — off ⇒ passed through.
    setAi({ nextQuestion: 'What do you sell?' });
    const res = await run({ conversation: [] });
    expect(res.statusCode).toBe(200);
    // byte-identical: exactly the AI string, single key.
    expect(res.body).toEqual({ nextQuestion: 'What do you sell?' });
  });

  test('flag OFF: fallback string is byte-identical when AI omits nextQuestion', async () => {
    setAi({}); // no nextQuestion, no done
    const res = await run({ conversation: [] });
    expect(res.body).toEqual({
      nextQuestion: 'Anything else you’d like to add about your commercial strategy?',
    });
  });

  test('flag ON: an AI question that re-asks a SATISFIED node is refused + replaced', async () => {
    process.env[MODE_ENV] = 'enforce';
    setAi({ nextQuestion: 'What do you sell?' }); // → products_services, already satisfied
    const res = await run({ conversation: [] });
    expect(res.statusCode).toBe(200);
    // refused: NOT the AI's re-ask
    expect(res.body.nextQuestion).not.toBe('What do you sell?');
    // replaced with the orchestrator's highest-value real gap (company, value 100)
    expect(res.body.nextQuestion).toBe('What is your company called?');
  });

  test('flag ON: an ELIGIBLE AI question is passed through untouched', async () => {
    process.env[MODE_ENV] = 'enforce';
    // website is unknown in the fixture → eligible → not overridden.
    setAi({ nextQuestion: 'What is your website address?' });
    const res = await run({ conversation: [] });
    expect(res.body.nextQuestion).toBe('What is your website address?');
  });

  test('flag ON: the done/structuredFields extraction path is unchanged (governance ≠ extraction)', async () => {
    process.env[MODE_ENV] = 'enforce';
    setAi({
      done: true,
      structuredFields: {
        target_customer_segment: 'SMB', ideal_customer_profile: 'Retail ops lead',
        pricing_model: 'subscription', sales_motion: 'self-serve', avg_deal_size: '$5k',
        sales_cycle: 'weeks', key_metrics: 'MRR, CAC',
      },
      campaign_purpose_intent: {
        primary_objective: 'awareness', campaign_intent: 'growth', monetization_intent: 'trials',
        dominant_problem_domains: ['ops'], brand_positioning_angle: 'trusted',
      },
    });
    const res = await run({ conversation: [] });
    expect(res.body.done).toBe(true);
    expect(res.body.structuredFields.target_customer_segment).toBe('SMB');
    expect(res.body).not.toHaveProperty('nextQuestion');
  });

  test('flag SHADOW (any non-off mode) also gates the re-ask', async () => {
    process.env[MODE_ENV] = 'shadow';
    setAi({ nextQuestion: 'What do you sell?' });
    const res = await run({ conversation: [] });
    expect(res.body.nextQuestion).not.toBe('What do you sell?');
  });
});
