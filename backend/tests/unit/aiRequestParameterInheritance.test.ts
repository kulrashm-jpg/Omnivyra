/**
 * AI-ORCH 3G — request-parameter inheritance. Verifies the canonical precedence
 * (Request > Profile) at the resolver, with UNSET preserved and reliability centralized.
 */
import { resolveExecutionPlan, type ResolverDeps, type ResolverProfileVersion } from '../../services/aiOrchestration/configurationResolver';

// Profile default: temperature 0.4, maxTok 2000, streaming false, structured false,
// timeout 60000, retries 2 (BALANCED-like). Provider/model echo the legacy input.
function profileDeps(): ResolverDeps {
  const version: ResolverProfileVersion = {
    profileId: 'p', profileKey: 'BALANCED', version: 1, mode: 'tier', qualityTier: 'balanced',
    capabilityRequirements: {},
    params: { temperature: 0.4, max_output_tokens: 2000 },
    modality: { streaming: false, structured_output: false },
    reliability: { timeout_ms: 60000, max_retries: 2 },
    limits: {}, caching: {}, safety: {},
  };
  return {
    async mapOperationToCapability() { return null; },
    async loadBinding() { return null; },
    async loadPlatformDefaultBinding() { return { scope: 'platform_default', capabilityId: null, orgId: null, profileId: 'p', isActive: true }; },
    async loadActiveProfileVersion() { return version; },
  };
}

const base = { operation: 'op', orgId: null, legacyProvider: 'openai', legacyModel: 'gpt-4o' };
const resolve = (overrides?: any) => resolveExecutionPlan({ ...base, overrides }, profileDeps());

describe('AI-ORCH 3G — request-parameter inheritance (Request > Profile)', () => {
  it('temperature: request OVERRIDES profile (0.9 wins over 0.4)', async () => {
    const { plan } = await resolve({ temperature: 0.9 });
    expect(plan.params.temperature).toBe(0.9);
  });

  it('temperature: profile used when request UNSET', async () => {
    const { plan } = await resolve({ maxOutputTokens: 1234 }); // temperature omitted
    expect(plan.params.temperature).toBe(0.4); // profile default
  });

  it('UNSET preserved: no overrides object ⇒ pure profile (backward-compatible)', async () => {
    const { plan } = await resolve(undefined);
    expect(plan.params.temperature).toBe(0.4);
    expect(plan.params.maxOutputTokens).toBe(2000);
  });

  it('maxOutputTokens: request overrides profile', async () => {
    const { plan } = await resolve({ maxOutputTokens: 8000 });
    expect(plan.params.maxOutputTokens).toBe(8000);
  });

  it('streaming inheritance: request true overrides profile false', async () => {
    const { plan } = await resolve({ streaming: true });
    expect(plan.params.streaming).toBe(true);
  });

  it('structured output inheritance: request true overrides profile false', async () => {
    const { plan } = await resolve({ structuredOutput: true });
    expect(plan.params.structuredOutput).toBe(true);
  });

  it('JSON responseFormat inheritance: request json_schema over profile none', async () => {
    const { plan } = await resolve({ responseFormat: 'json_schema' });
    expect(plan.params.responseFormat).toBe('json_schema');
  });

  it('DEFAULT preserved: streaming omitted ⇒ profile false (not synthesized true)', async () => {
    const { plan } = await resolve({ temperature: 0.5 });
    expect(plan.params.streaming).toBe(false); // profile default, unchanged
  });

  it('reliability policy inheritance: reliabilityCentralized takes ONLY overrides, drops profile', async () => {
    const { plan } = await resolve({ reliabilityCentralized: true, timeoutMs: 30000 });
    expect(plan.reliability.timeoutMs).toBe(30000);   // central policy value
    expect(plan.reliability.maxRetries).toBeNull();    // profile 2 DROPPED (policy-owned)
  });

  it('reliability without centralization keeps profile (override wins when present)', async () => {
    const a = await resolve({ timeoutMs: 45000 });
    expect(a.plan.reliability.timeoutMs).toBe(45000);  // override
    const b = await resolve({ temperature: 0.5 });
    expect(b.plan.reliability.timeoutMs).toBe(60000);  // profile retained
  });

  it('provider/model NOT changed by inheritance (still echoes legacy)', async () => {
    const { plan } = await resolve({ temperature: 0.9 });
    expect(plan.model.provider).toBe('openai');
    expect(plan.model.model).toBe('gpt-4o');
  });
});
