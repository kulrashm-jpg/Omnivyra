/**
 * Phase 5 — Campaign Architect (full blueprint) endpoint tests.
 *
 * Exercises pages/api/bolt/campaign-chat.ts with its 4 dependencies mocked
 * (auth / profile / billing-wiring / LLM). Covers:
 *   1. blueprint response parsing
 *   2. platform validation (invalid dropped)
 *   3. format validation (invalid text/creator dropped; duration clamped)
 *   5. backward compatibility — without `blueprint:true`, the response is the
 *      original 6 fields ONLY (BOLT Text/Creator endpoint behavior unchanged).
 */

jest.mock('@/backend/services/userContextService', () => ({
  enforceCompanyAccess: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/backend/services/companyProfileService', () => ({
  getProfile: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/backend/services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(),
}));
jest.mock('@/backend/services/billing/phase2RouteWiring', () => ({
  // Pass-through: return whatever the wrapped run() returns.
  wirePhase2Route: jest.fn(async ({ run }: { run: () => Promise<unknown> }) => run()),
}));
jest.mock('@/backend/services/billing/phase2EnforcementGate', () => ({
  PaymentRequiredError: class PaymentRequiredError extends Error {},
}));
// Phase 6A — connected-account eligibility (Section C). Default: none connected
// → no connected restriction (validate against canonical registry only).
jest.mock('@/backend/utils/platformEligibility', () => ({
  getConnectedPlatformsForCompany: jest.fn().mockResolvedValue([]),
}));
// Phase 6D-A — mock the intelligence resolver so these tests never touch the DB
// and can control the injected block precisely.
jest.mock('@/lib/shared/intelligence/resolveIntelligenceContext', () => ({
  resolveIntelligenceContext: jest.fn().mockResolvedValue({ topLearnings: [], platformRankings: [], contentBiases: [] }),
  formatIntelligenceContextBlock: jest.fn().mockReturnValue(''),
}));

import handler from '@/pages/api/bolt/campaign-chat';
import { runCompletionWithOperation } from '@/backend/services/aiGateway';
import { getConnectedPlatformsForCompany } from '@/backend/utils/platformEligibility';
import { MAX_CAMPAIGN_DURATION_WEEKS } from '@/lib/shared/campaignDuration';
import { resolveIntelligenceContext, formatIntelligenceContextBlock } from '@/lib/shared/intelligence/resolveIntelligenceContext';

const mockLLM = runCompletionWithOperation as jest.Mock;
const mockConnected = getConnectedPlatformsForCompany as jest.Mock;
const mockResolveIntel = resolveIntelligenceContext as jest.Mock;
const mockFormatIntel = formatIntelligenceContextBlock as jest.Mock;

function mockReqRes(body: Record<string, unknown>) {
  const req = { method: 'POST', body, headers: {}, cookies: {}, query: {} } as any;
  const json = jest.fn();
  const res: any = { status: jest.fn(() => res), json, setHeader: jest.fn() };
  return { req, res, json };
}

const LLM_BLUEPRINT = {
  reply: 'Here is a plan.',
  suggested_topic: 'AI Marketing Platform Launch',
  suggested_goals: ['Lead Generation', 'NotAGoal'],
  suggested_audience: 'B2B marketers',
  // blueprint fields — mix of valid + invalid
  suggested_strategic_focus: ['Thought leadership', 'Product education'],
  suggested_platforms: ['linkedin', 'x', 'myspace'],          // x→twitter; myspace dropped
  suggested_text_formats: ['article', 'post', 'blog'],         // blog dropped
  suggested_creator_formats: ['carousel', 'video', 'hologram'],// hologram dropped
  suggested_duration: 7,                                       // in 1–12 range → stays 7 (6C-4C)
  suggested_outcome_view: 'week_plan',
};

beforeEach(() => {
  mockLLM.mockReset(); mockConnected.mockReset(); mockConnected.mockResolvedValue([]);
  // 6D-A: default to inert intelligence (empty resolve + empty block) and no mode
  // override (→ handler default 'shadow') so existing blueprint tests are insulated.
  mockResolveIntel.mockReset(); mockFormatIntel.mockReset();
  mockResolveIntel.mockResolvedValue({ topLearnings: [], platformRankings: [], contentBiases: [] });
  mockFormatIntel.mockReturnValue('');
  delete process.env.INTELLIGENT_MIX_INTELLIGENCE_MODE;
});

describe('Phase 5 — campaign-chat blueprint mode', () => {
  test('blueprint:true → parses + validates the full blueprint (#1,#2,#3)', async () => {
    mockLLM.mockResolvedValue({ output: JSON.stringify(LLM_BLUEPRINT) });
    const { req, res, json } = mockReqRes({ companyId: 'c1', message: 'Promote our AI platform', blueprint: true });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const p = json.mock.calls[0][0];
    // base fields still present
    expect(p.suggested_topic).toBe('AI Marketing Platform Launch');
    expect(p.suggested_goals).toEqual(['Lead Generation']);            // invalid goal dropped
    // platform validation against canonical registry: x stays canonical 'x', myspace dropped
    expect(p.suggested_platforms).toEqual(['linkedin', 'x']);
    // format validation
    expect(p.suggested_text_formats).toEqual(['article', 'post']);     // blog dropped
    expect(p.suggested_creator_formats).toEqual(['carousel', 'video']);// hologram dropped
    // duration accepted within the Intelligent Mix 1..12 range (6C-4C: 7 stays 7)
    expect(p.suggested_duration).toBe(7);
    expect(p.suggested_outcome_view).toBe('week_plan');
    expect(p.suggested_strategic_focus).toEqual(['Thought leadership', 'Product education']);
  });

  test('without blueprint flag → response has ONLY the original 6 fields (#5, BOLT Text/Creator unchanged)', async () => {
    mockLLM.mockResolvedValue({ output: JSON.stringify(LLM_BLUEPRINT) });
    const { req, res, json } = mockReqRes({ companyId: 'c1', message: 'Promote our AI platform' });
    await handler(req, res);

    const p = json.mock.calls[0][0];
    expect(Object.keys(p).sort()).toEqual(
      ['reply', 'suggested_audience', 'suggested_description', 'suggested_goals', 'suggested_tone', 'suggested_topic'].sort(),
    );
    // none of the blueprint keys leak into a non-blueprint response
    expect(p.suggested_platforms).toBeUndefined();
    expect(p.suggested_text_formats).toBeUndefined();
    expect(p.suggested_creator_formats).toBeUndefined();
    expect(p.suggested_duration).toBeUndefined();
    expect(p.suggested_outcome_view).toBeUndefined();
    expect(p.suggested_strategic_focus).toBeUndefined();
  });

  test('connected-platform restriction respected (#3) — unconnected platform dropped', async () => {
    // Only LinkedIn connected → AI's linkedin/x/myspace collapses to linkedin only.
    mockConnected.mockResolvedValue(['linkedin']);
    mockLLM.mockResolvedValue({ output: JSON.stringify(LLM_BLUEPRINT) });
    const { req, res, json } = mockReqRes({ companyId: 'c1', message: 'Promote our AI platform', blueprint: true });
    await handler(req, res);
    const p = json.mock.calls[0][0];
    expect(p.suggested_platforms).toEqual(['linkedin']); // x + myspace excluded (x not connected, myspace invalid)
  });

  test('blueprint:true but no topic suggested → blueprint fields omitted (pairing rule)', async () => {
    mockLLM.mockResolvedValue({ output: JSON.stringify({ reply: 'Tell me more.', suggested_platforms: ['linkedin'] }) });
    const { req, res, json } = mockReqRes({ companyId: 'c1', message: 'hi', blueprint: true });
    await handler(req, res);

    const p = json.mock.calls[0][0];
    expect(p.suggested_topic).toBeNull();
    expect(p.suggested_platforms).toBeUndefined(); // no topic → no blueprint
  });

  test('malformed LLM JSON → 500, never throws', async () => {
    mockLLM.mockResolvedValue({ output: 'not json' });
    const { req, res, json } = mockReqRes({ companyId: 'c1', message: 'hi', blueprint: true });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0][0]).toEqual({ error: 'AI returned malformed response' });
  });
});

/**
 * Phase 6C-4C — Campaign Architect duration alignment with the 1–12 week
 * Intelligent Mix execution capability. Blueprint mode (blueprint:true) is the
 * combined Architect by contract; its suggested_duration now derives from the
 * shared authority's combined ceiling (MAX_CAMPAIGN_DURATION_WEEKS).
 */
describe('Phase 6C-4C — Architect duration alignment (1–12)', () => {
  // Resolve the parsed suggested_duration for a given LLM-proposed value.
  async function suggestDuration(value: unknown): Promise<unknown> {
    mockLLM.mockResolvedValue({
      output: JSON.stringify({ ...LLM_BLUEPRINT, suggested_duration: value }),
    });
    const { req, res, json } = mockReqRes({ companyId: 'c1', message: 'Promote our AI platform', blueprint: true });
    await handler(req, res);
    return json.mock.calls[0][0].suggested_duration;
  }

  test('1. combined blueprint may recommend 8 weeks', async () => {
    expect(await suggestDuration(8)).toBe(8);
  });

  test('2. combined blueprint may recommend 12 weeks', async () => {
    expect(await suggestDuration(12)).toBe(12);
  });

  test('3. invalid durations rejected/sanitized (non-numeric → null; out-of-range clamped)', async () => {
    expect(await suggestDuration('lots')).toBeNull(); // NaN → null
    expect(await suggestDuration(null)).toBe(1); // Number(null)=0 → clamped up (prior behavior)
    expect(await suggestDuration(0)).toBe(1); // below floor → clamped up
    expect(await suggestDuration(-3)).toBe(1);
    expect(await suggestDuration(5.6)).toBe(6); // rounded, in range
  });

  test('4. accepted ceiling derives from the shared authority (13 → MAX)', async () => {
    expect(await suggestDuration(13)).toBe(MAX_CAMPAIGN_DURATION_WEEKS);
    expect(await suggestDuration(99)).toBe(MAX_CAMPAIGN_DURATION_WEEKS);
    expect(MAX_CAMPAIGN_DURATION_WEEKS).toBe(12);
  });

  test('5. Text/Creator (no blueprint flag) emit NO duration recommendation (unchanged)', async () => {
    mockLLM.mockResolvedValue({ output: JSON.stringify({ ...LLM_BLUEPRINT, suggested_duration: 12 }) });
    const { req, res, json } = mockReqRes({ companyId: 'c1', message: 'Promote our AI platform' });
    await handler(req, res);
    expect(json.mock.calls[0][0].suggested_duration).toBeUndefined();
  });

  test('6. apply payload compatibility — suggested_duration is a plain number (or null)', async () => {
    const d = await suggestDuration(10);
    // BoltCampaignChat maps a numeric suggested_duration → apply payload `duration`;
    // the combined page then setDuration(d) without an upper clamp.
    expect(typeof d).toBe('number');
    expect(Number.isInteger(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(1);
    expect(d).toBeLessThanOrEqual(MAX_CAMPAIGN_DURATION_WEEKS);
  });
});

/**
 * Phase 6D-A — Intelligent Mix intelligence enrichment gating.
 * Enrichment applies ONLY in blueprint mode (combined-only by contract) and ONLY
 * in 'advisory' mode. 'shadow' (default) computes but does not inject; 'off'
 * does not resolve. BOLT Text/Creator (no blueprint flag) are never affected.
 */
describe('Phase 6D-A — intelligence enrichment gating', () => {
  const INTEL_BLOCK = 'INTELLIGENCE INSIGHTS\nTop Learnings:\n- Educational posts beat promos (90% confidence)';

  // Returns the system-message content sent to the LLM for a given request.
  async function systemPromptFor(body: Record<string, unknown>): Promise<string> {
    mockLLM.mockResolvedValue({ output: JSON.stringify({ reply: 'ok', suggested_topic: 'X' }) });
    const { req, res } = mockReqRes(body);
    await handler(req, res);
    return mockLLM.mock.calls[0][0].messages[0].content as string;
  }

  test('5. advisory mode injects the intelligence block into the blueprint prompt', async () => {
    process.env.INTELLIGENT_MIX_INTELLIGENCE_MODE = 'advisory';
    mockResolveIntel.mockResolvedValue({ topLearnings: ['Educational posts beat promos'], platformRankings: [], contentBiases: [] });
    mockFormatIntel.mockReturnValue(INTEL_BLOCK);
    const sys = await systemPromptFor({ companyId: 'c1', message: 'Promote our AI platform', blueprint: true });
    expect(sys).toContain('INTELLIGENCE INSIGHTS');
    expect(mockResolveIntel).toHaveBeenCalledWith({ companyId: 'c1' });
  });

  test('4. shadow mode computes but does NOT modify the prompt', async () => {
    process.env.INTELLIGENT_MIX_INTELLIGENCE_MODE = 'shadow';
    mockResolveIntel.mockResolvedValue({ topLearnings: ['x'], platformRankings: [], contentBiases: [] });
    mockFormatIntel.mockReturnValue(INTEL_BLOCK); // non-empty, but shadow must not inject
    const sys = await systemPromptFor({ companyId: 'c1', message: 'Promote our AI platform', blueprint: true });
    expect(sys).not.toContain('INTELLIGENCE INSIGHTS');
    expect(mockResolveIntel).toHaveBeenCalled(); // resolver IS called in shadow
  });

  test('off mode does not call the resolver and does not inject', async () => {
    process.env.INTELLIGENT_MIX_INTELLIGENCE_MODE = 'off';
    mockFormatIntel.mockReturnValue(INTEL_BLOCK);
    const sys = await systemPromptFor({ companyId: 'c1', message: 'Promote our AI platform', blueprint: true });
    expect(sys).not.toContain('INTELLIGENCE INSIGHTS');
    expect(mockResolveIntel).not.toHaveBeenCalled();
  });

  test('6/7/8. non-blueprint path (BOLT Text/Creator) is unchanged even in advisory mode', async () => {
    process.env.INTELLIGENT_MIX_INTELLIGENCE_MODE = 'advisory';
    mockFormatIntel.mockReturnValue(INTEL_BLOCK);
    const sys = await systemPromptFor({ companyId: 'c1', message: 'Promote our AI platform' }); // no blueprint flag
    expect(sys).not.toContain('INTELLIGENCE INSIGHTS');
    expect(mockResolveIntel).not.toHaveBeenCalled(); // never resolved outside blueprint mode
  });

  test('advisory mode with empty signals leaves prompt unchanged (empty block)', async () => {
    process.env.INTELLIGENT_MIX_INTELLIGENCE_MODE = 'advisory';
    mockResolveIntel.mockResolvedValue({ topLearnings: [], platformRankings: [], contentBiases: [] });
    mockFormatIntel.mockReturnValue(''); // nothing to inject
    const sys = await systemPromptFor({ companyId: 'c1', message: 'Promote our AI platform', blueprint: true });
    expect(sys).not.toContain('INTELLIGENCE INSIGHTS');
  });
});
