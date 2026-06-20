/**
 * Phase 6C-4B — Generation hardening for 8–12 week campaigns.
 *
 * Root cause (audited): the campaign-plan call
 *   aiPlanningService.generateCampaignPlanAI → aiGateway.generateCampaignPlan
 * passes NO max_tokens, and the operation key 'generateCampaignPlan' was NOT a
 * recognised long-form operation. resolveProviderTimeoutMs therefore returned the
 * 30s short-form cap, so large (8–12 week) plans timed out and the orchestrator
 * silently fell back to a deterministic placeholder plan.
 *
 * Fix (matches the established generateMasterContent pattern): recognise
 * 'generateCampaignPlan' by operation name so it gets the 240s long-form window.
 * Token budget stays the uncapped provider default (sufficient for 12-week plans,
 * exactly as it is for full blogs/newsletters — no artificial max_tokens cap).
 *
 * These tests pin the timeout-resolution contract and guard against regressing
 * the short-form / 1–4-week paths.
 */

import { resolveProviderTimeoutMs } from '../../services/aiGateway';

const SHORT_FORM_MS = 30_000;
const MID_MS = 120_000;
const LONG_FORM_MS = 240_000;

describe('6C-4B — campaign plan long-form timeout classification', () => {
  test('1. generateCampaignPlan is long-form → 240s even with no max_tokens', () => {
    // The real call site passes no max_tokens; operation name alone must widen it.
    expect(resolveProviderTimeoutMs(undefined, 'generateCampaignPlan')).toBe(LONG_FORM_MS);
  });

  test('2a. timeout still scales by max_tokens for token-driven callers', () => {
    expect(resolveProviderTimeoutMs(9000)).toBe(LONG_FORM_MS); // > 8192
    expect(resolveProviderTimeoutMs(5000)).toBe(MID_MS); //     > 4096
    expect(resolveProviderTimeoutMs(2000)).toBe(SHORT_FORM_MS); // small helper call
    expect(resolveProviderTimeoutMs(undefined)).toBe(SHORT_FORM_MS); // no op, no tokens
  });

  test('2b. campaign plan window is the long-form ceiling regardless of plan size', () => {
    // 1–4 week and 8–12 week plans take the SAME path (no max_tokens, same op),
    // so the resolved timeout is identical — the change only raises the ceiling,
    // it never lowers the budget for any plan size.
    const oneToFour = resolveProviderTimeoutMs(undefined, 'generateCampaignPlan');
    const eightToTwelve = resolveProviderTimeoutMs(undefined, 'generateCampaignPlan');
    expect(oneToFour).toBe(eightToTwelve);
    expect(oneToFour).toBe(LONG_FORM_MS);
  });

  test('3. existing long-form operations are unchanged (no collateral change)', () => {
    expect(resolveProviderTimeoutMs(undefined, 'generateMasterContent')).toBe(LONG_FORM_MS);
    expect(resolveProviderTimeoutMs(undefined, 'generateContentBlueprint')).toBe(LONG_FORM_MS);
    expect(resolveProviderTimeoutMs(undefined, 'blogGeneration')).toBe(LONG_FORM_MS);
    expect(resolveProviderTimeoutMs(undefined, 'newsletterGeneration')).toBe(LONG_FORM_MS);
  });

  test('4. non-campaign short-form operations keep the 30s budget (no regression)', () => {
    // Latency-sensitive small calls must NOT inherit the long-form window.
    expect(resolveProviderTimeoutMs(undefined, 'generatePost')).toBe(SHORT_FORM_MS);
    expect(resolveProviderTimeoutMs(undefined, 'classifyIntent')).toBe(SHORT_FORM_MS);
    expect(resolveProviderTimeoutMs(undefined, 'someUnknownHelperOp')).toBe(SHORT_FORM_MS);
    expect(resolveProviderTimeoutMs(100, 'generatePost')).toBe(SHORT_FORM_MS);
  });
});
