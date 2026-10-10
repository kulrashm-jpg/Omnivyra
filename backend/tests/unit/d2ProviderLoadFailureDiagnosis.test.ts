/**
 * D2 — "CONFIGURED BUT BROKEN" IS NOT "NOT CONFIGURED".
 *
 * WHY THIS SUITE EXISTS. Every adapter registration in `providerRegistry` is a
 * dynamic `require()` inside a try/catch whose body was empty. When an LLM
 * adapter's credential WAS present but the module failed to load — a syntax
 * error, a broken transitive import, a bundler path that resolves at build time
 * and not at runtime — the catch swallowed the error and the slot kept
 * `UnavailableLLMProvider`, whose probe reports:
 *
 *   observation_outcome: 'no_provider'
 *   reason: "<id> adapter not configured — set the corresponding API key in env"
 *
 * That reason is false in exactly the case that matters: the key IS set. The
 * operator is told to add a credential that is already there, a broken build is
 * indistinguishable from an unconfigured one, and the load failure leaves no
 * trace anywhere — no log, no counter, no report field.
 *
 * The ScoreState was and remains `unavailable` either way: this is a DIAGNOSIS
 * fix, not a measurement fix. Nothing here can make a cell measurable.
 *
 * SECRETS: no credential is read into any message. The env var is set to a
 * synthetic placeholder and its VALUE never reaches an assertion or a reason.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

// The adapter module is forced to fail at require time — the exact production
// failure mode the empty catch used to hide.
jest.mock('../../services/intelligence/adapters/perplexityAdapter', () => {
  throw new Error('Cannot find module ./transport/sonarGateway');
});

import {
  _resetIntelligenceRegistry,
  getAdapterLoadFailures,
  getLLMProvider,
} from '../../services/intelligence/providerRegistry';
import type { ProbeObservationOutcome } from '../../services/intelligence/aiVisibilityGrounding';

// The harness runs with `restoreMocks: true`, so the spy is installed per test
// rather than once at module scope — a module-scope spy is detached before the
// first test body runs and silently records nothing.
let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  _resetIntelligenceRegistry();
  process.env.PERPLEXITY_API_KEY = 'test-key-not-a-real-credential';
});

afterEach(() => {
  delete process.env.PERPLEXITY_API_KEY;
  _resetIntelligenceRegistry();
});

const probeFor = (provider: 'perplexity' | 'gemini') =>
  ({
    provider,
    query_class: 'branded' as const,
    queries: ['What is Northwind Analytics?'],
    brandName: 'Northwind Analytics',
    domain: 'northwind.test',
  });

describe('D2 — an adapter that is configured but fails to load reports the failure', () => {
  it('the load failure is recorded rather than swallowed', async () => {
    getLLMProvider('perplexity'); // triggers bootstrap
    const failures = getAdapterLoadFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0].slot).toBe('llm:perplexity');
    expect(failures[0].module).toContain('perplexityAdapter');
    expect(failures[0].message).toContain('sonarGateway');
    expect(warn).toHaveBeenCalled();
  });

  it('the probe says provider_failed — NOT no_provider, and NOT "not configured"', async () => {
    // THE NEGATIVE CONTROL for the swallowed catch. With the empty catch body
    // restored this slot keeps `UnavailableLLMProvider`, so `observation_outcome`
    // is `no_provider` and the reason tells the operator to set a key that is
    // already set. Both assertions below fail in that state.
    const result = await getLLMProvider('perplexity').probe(probeFor('perplexity'));
    expect(result.observation_outcome).toBe<ProbeObservationOutcome>('provider_failed');
    expect(result.reason_unavailable).toContain('configured but failed to load');
    expect(result.reason_unavailable).not.toContain('not configured —');
  });

  it('a genuinely unconfigured slot still reports no_provider', async () => {
    // The distinction is only worth anything if the OTHER case is preserved.
    delete process.env.GEMINI_API_KEY;
    const result = await getLLMProvider('gemini').probe(probeFor('gemini'));
    expect(result.observation_outcome).toBe<ProbeObservationOutcome>('no_provider');
    expect(result.reason_unavailable).toContain('not configured');
  });

  it('a failed-to-load adapter is still unmeasurable — the fix is diagnosis, not promotion', async () => {
    const provider = getLLMProvider('perplexity');
    expect(provider.retrieval_grounded).toBe(false);
    expect(await provider.isAvailable()).toBe(false);
    const result = await provider.probe(probeFor('perplexity'));
    expect(result.state).toBe('unavailable');
    expect(result.citation_rate).toBeNull();
    expect(result.mean_prominence).toBeNull();
  });

  it('no credential VALUE ever reaches the failure record or the probe reason', async () => {
    const secret = process.env.PERPLEXITY_API_KEY!;
    const result = await getLLMProvider('perplexity').probe(probeFor('perplexity'));
    expect(JSON.stringify(getAdapterLoadFailures())).not.toContain(secret);
    expect(result.reason_unavailable ?? '').not.toContain(secret);
  });
});
