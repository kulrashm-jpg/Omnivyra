/**
 * Phase 8G-B — AI-visibility probe platform cost capture.
 *
 * Verifies token extraction per provider and that captureProbeCost records the
 * cost into usage_events as a PLATFORM row: organization_id NULL, source_type
 * 'system', activity 'ai_visibility_probe' — never customer-billed. Only the DB
 * sink (logUsageEvent) is mocked, so the real probe→platform-capture chain runs.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
type LogUsageEventArgs = Parameters<typeof import('../../services/usageLedgerService')['logUsageEvent']>;
const usageLedger = { logUsageEvent: jest.fn(async (..._a: LogUsageEventArgs) => undefined) };
jest.mock('../../services/usageLedgerService', () => usageLedger);
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: jest.fn() }));

import { extractProbeTokenUsage, captureProbeCost } from '../../services/intelligence/probeCostCapture';

beforeEach(() => jest.clearAllMocks());

describe('extractProbeTokenUsage (per-provider response shapes)', () => {
  it('gemini → usageMetadata + modelVersion', () => {
    expect(extractProbeTokenUsage('gemini', { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 }, modelVersion: 'gemini-1.5-flash' }))
      .toEqual({ inputTokens: 100, outputTokens: 50, model: 'gemini-1.5-flash' });
  });
  it('claude → usage.input/output_tokens', () => {
    expect(extractProbeTokenUsage('claude', { usage: { input_tokens: 80, output_tokens: 40 }, model: 'claude-3-5-sonnet' }))
      .toEqual({ inputTokens: 80, outputTokens: 40, model: 'claude-3-5-sonnet' });
  });
  it('openai-style (perplexity/copilot/chatgpt) → usage.prompt/completion_tokens', () => {
    expect(extractProbeTokenUsage('perplexity', { usage: { prompt_tokens: 60, completion_tokens: 30 }, model: 'sonar' }))
      .toEqual({ inputTokens: 60, outputTokens: 30, model: 'sonar' });
  });
  it('missing usage → zeros + null model', () => {
    expect(extractProbeTokenUsage('chatgpt', {})).toEqual({ inputTokens: 0, outputTokens: 0, model: null });
  });
});

describe('captureProbeCost → platform capture (no org, system)', () => {
  it('records null org, source_type=system, probe activity, tokens + cost', async () => {
    await captureProbeCost({ providerId: 'gemini', json: { usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 }, modelVersion: 'gemini-1.5-flash' } });
    expect(usageLedger.logUsageEvent).toHaveBeenCalledTimes(1);
    const p = usageLedger.logUsageEvent.mock.calls[0][0];
    expect(p.organization_id).toBeNull();           // never a customer org (TASK 3)
    expect(p.source_type).toBe('system');           // platform classification (TASK 3)
    expect(p.reference_type).toBe('ai_visibility_probe');
    expect(p.provider).toBe('gemini');
    expect(p.input_tokens).toBe(1000);
    expect(p.output_tokens).toBe(500);
    expect(p.total_cost_usd).toBeGreaterThan(0);     // gemini-1.5-flash rate × tokens
    expect(p.metadata.platform_cost).toBe(true);
    expect(p.metadata.capture).toBe('platform_probe_v1');
  });

  it('falls back to per-provider default model when response omits it', async () => {
    await captureProbeCost({ providerId: 'claude', json: { usage: { input_tokens: 10, output_tokens: 5 } } });
    const p = usageLedger.logUsageEvent.mock.calls[0][0];
    expect(p.model).toBe('claude-3-5-sonnet');
  });

  it('never throws if the sink fails (best-effort telemetry)', async () => {
    usageLedger.logUsageEvent.mockRejectedValueOnce(new Error('db down'));
    await expect(captureProbeCost({ providerId: 'perplexity', json: null })).resolves.toBeUndefined();
  });
});
