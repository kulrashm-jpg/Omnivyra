/**
 * CONVERSATION-INTELLIGENCE-003 — canonical adoption on
 * /api/company-profile/define-campaign-purpose.
 *
 * Proves this route now behaves IDENTICALLY to the certified define-target-customer
 * pilot, reusing the SAME canonical implementation (orchestrator + knowledge graph
 * + readiness + completion) behind the SAME two rollout flags:
 *   - flag OFF (default) → BYTE-IDENTICAL to before: the AI-emitted nextQuestion is
 *     returned verbatim, the orchestrator is never consulted, AND the prompt is NOT
 *     grounded (no undocumented prompt change).
 *   - flag ON → the orchestrator gates question selection (refuse an AI question
 *     that re-asks a satisfied node, replace with the highest-value gap), the prompt
 *     is grounded with what the graph knows, and once the knowledge core is
 *     satisfied the interview naturally STOPS with a completion + handoff signal.
 *   - the `done`/campaign_purpose_intent extraction path is unaffected by the flag.
 *
 * Only the I/O seams (profile load, AI completion, access) are mocked; the real
 * orchestrator + real knowledge graph run, so the gating asserted here is genuine.
 */
import handler from '../../../pages/api/company-profile/define-campaign-purpose';
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

// products_services satisfied (High), nothing else → an AI question mapping to
// products_services must be refused when ON; highest-value remaining gap = company.
const PROFILE: CompanyProfile = {
  company_id: 'acme',
  products_services: 'Retail analytics dashboards',
  field_confidence: { products_services: 'High' },
} as CompanyProfile;

// Entire knowledge CORE satisfied at High → enoughToProceed → hand off (flag ON).
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

const setAi = (payload: Record<string, unknown>) =>
  (runCompletion as jest.Mock).mockResolvedValue({ output: JSON.stringify(payload) });

const run = async (profile: CompanyProfile, body: Record<string, unknown> = {}) => {
  (getCanonicalProfile as jest.Mock).mockResolvedValue(profile);
  const req = createApiRequestMock({ method: 'POST', companyId: 'acme', body });
  const res = createMockRes();
  await handler(req, res);
  return res;
};

const lastUserPrompt = (): string => {
  const call = (runCompletion as jest.Mock).mock.calls.at(-1)?.[0];
  const msgs = call?.messages as Array<{ role: string; content: string }>;
  return msgs.find((m) => m.role === 'user')?.content ?? '';
};

describe('define-campaign-purpose — canonical adoption (CONV-INTEL-003)', () => {
  const original = process.env[MODE_ENV];
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env[MODE_ENV];
  });
  afterAll(() => {
    if (original === undefined) delete process.env[MODE_ENV];
    else process.env[MODE_ENV] = original;
  });

  // --- flag OFF: byte-identical to the pre-migration route ---

  test('flag OFF: AI nextQuestion returned VERBATIM even if it re-asks a known node', async () => {
    setAi({ nextQuestion: 'What do you sell?' });
    const res = await run(PROFILE, { conversation: [] });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ nextQuestion: 'What do you sell?' });
  });

  test('flag OFF: fallback string is byte-identical when AI omits nextQuestion', async () => {
    setAi({});
    const res = await run(PROFILE, { conversation: [] });
    expect(res.body).toEqual({
      nextQuestion: 'Anything else you’d like to add about your campaign purpose?',
    });
  });

  test('flag OFF: the prompt is NOT grounded (byte-identical AI input)', async () => {
    setAi({ nextQuestion: 'Why are you using social media?' });
    await run(PROFILE, { conversation: [] });
    // Exact original user message: Context + start line, NO knowledge grounding inserted.
    expect(lastUserPrompt()).toBe(
      'Context: Company: acme. Industry: Not set. Target: Not set.\n\n' +
        'Start the questionnaire. Ask the first question about campaign purpose.',
    );
  });

  test('flag OFF + core-complete profile: STILL returns the AI question (no completion)', async () => {
    setAi({ nextQuestion: 'What is your primary objective?' });
    const res = await run(CORE_COMPLETE_PROFILE, { conversation: [] });
    expect(res.body).toEqual({ nextQuestion: 'What is your primary objective?' });
    expect(res.body).not.toHaveProperty('complete');
    expect(res.body).not.toHaveProperty('transition');
  });

  // --- flag ON: canonical behaviour (identical to the pilot) ---

  test('flag ON: an AI question that re-asks a SATISFIED node is refused + replaced', async () => {
    process.env[MODE_ENV] = 'enforce';
    setAi({ nextQuestion: 'What do you sell?' }); // → products_services, satisfied
    const res = await run(PROFILE, { conversation: [] });
    expect(res.body.nextQuestion).not.toBe('What do you sell?');
    expect(res.body.nextQuestion).toBe('What is your company called?'); // highest-value gap
  });

  test('flag ON: an ELIGIBLE AI question is passed through untouched', async () => {
    process.env[MODE_ENV] = 'enforce';
    setAi({ nextQuestion: 'What is your website address?' });
    const res = await run(PROFILE, { conversation: [] });
    expect(res.body.nextQuestion).toBe('What is your website address?');
  });

  test('flag ON: the prompt IS grounded with what the graph knows', async () => {
    process.env[MODE_ENV] = 'enforce';
    setAi({ nextQuestion: 'What is your website address?' });
    await run(PROFILE, { conversation: [] });
    // grounding injected → the known products_services value reaches the prompt.
    expect(lastUserPrompt()).toContain('Retail analytics dashboards');
  });

  test('flag ON + core satisfied: the interview STOPS with a completion + handoff signal', async () => {
    process.env[MODE_ENV] = 'enforce';
    setAi({ nextQuestion: 'What is your primary objective?' });
    const res = await run(CORE_COMPLETE_PROFILE, { conversation: [] });
    expect(res.body.complete).toBe(true);
    expect(res.body.nextQuestion).toBeNull();
    expect(res.body.transition.ready).toBe(true);
    expect(res.body.transition.suggestedNext).toBe(PROFILE_CONVERSATION_HANDOFF_KEY);
    expect(res.body.readiness.enoughToProceed).toBe(true);
  });

  test('flag ON + core NOT satisfied: still asks (no false completion)', async () => {
    process.env[MODE_ENV] = 'enforce';
    setAi({ nextQuestion: 'What is your website address?' });
    const res = await run(PROFILE, { conversation: [] });
    expect(res.body).not.toHaveProperty('complete');
    expect(res.body.nextQuestion).toBe('What is your website address?');
  });

  // --- extraction path unaffected by the governance flag ---

  test('flag ON: the done/campaign_purpose_intent path is unchanged (governance ≠ extraction)', async () => {
    process.env[MODE_ENV] = 'enforce';
    setAi({
      done: true,
      campaign_purpose_intent: {
        primary_objective: 'awareness',
        campaign_intent: 'growth',
        monetization_intent: 'trials',
        dominant_problem_domains: ['ops', 'clarity'],
        brand_positioning_angle: 'trusted',
        reader_emotion_target: 'confident',
        recommended_cta_style: 'Soft',
      },
    });
    const res = await run(CORE_COMPLETE_PROFILE, { conversation: [] });
    expect(res.body.done).toBe(true);
    expect(res.body.campaign_purpose_intent.primary_objective).toBe('awareness');
    expect(res.body.campaign_purpose_intent.dominant_problem_domains).toEqual(['ops', 'clarity']);
    expect(res.body).not.toHaveProperty('transition');
  });

  test('flag SHADOW (any non-off mode) also gates the re-ask', async () => {
    process.env[MODE_ENV] = 'shadow';
    setAi({ nextQuestion: 'What do you sell?' });
    const res = await run(PROFILE, { conversation: [] });
    expect(res.body.nextQuestion).not.toBe('What do you sell?');
  });
});
