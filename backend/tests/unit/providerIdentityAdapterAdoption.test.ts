/**
 * PB-007 — PROVIDER IDENTITY ADOPTION (Program B · Product · Zone A2) — unit tests.
 *
 * WHAT THIS PACKAGE CHANGED. Every visibility adapter previously handed the Platform a
 * HAND-WRITTEN platform literal (`dispatchTransport('anthropic', …)` from an adapter
 * whose product id is `'claude'`). Each literal was CORRECT — there was no live defect
 * — but the correctness rested entirely on the author remembering that two of five ids
 * differ. PB-007 derives the platform id from the adapter's own product id through the
 * canonical PB-006 mapping, so the Platform enforces it.
 *
 * The tests below are therefore, first and foremost, a PARITY suite. The frozen table
 * `LEGACY_HARD_CODED_PLATFORM_ID` records the literal that each adapter passed BEFORE
 * PB-007, transcribed from the pre-change source. Every assertion drives back to it:
 *
 *   1. LEGACY PARITY      — canonical translation of each adapter's product id equals
 *                           the exact literal it replaced. If any row diverged, PB-007
 *                           would be a behavior change and must be stopped.
 *   2. TRANSLATION        — each adapter's product id maps to the expected platform id,
 *                           including the two that differ (chatgpt→openai, claude→
 *                           anthropic) and the three that coincide.
 *   3. DISPATCH PARITY    — driven end-to-end through `probe()` with the gateway flag
 *                           ON, each adapter still calls `dispatchTransport` with that
 *                           same literal, and still exposes the same product `id`.
 *   4. UNKNOWN PROVIDERS  — the strict resolver rejects loudly; the explicit
 *                           non-throwing variants degrade without substituting. No
 *                           adapter routes an unknown id, and MODULE IMPORT — where the
 *                           adapters perform their one translation — never throws.
 *   5. CAPABILITY LOOKUP  — the PB-004 registry is keyed by PLATFORM ids, so a lookup
 *                           is only meaningful AFTER translation. Proven for all five,
 *                           together with the PB-005 invariant that the registry stays
 *                           purely descriptive: no capability gate was introduced.
 *
 * Pure: no network, no I/O. The dispatcher is mocked; the identity layer and the
 * capability registry are the REAL Platform modules (this package must not modify
 * either, so nothing here stubs them).
 */
jest.mock('../../services/intelligence/productionPrimitives', () => ({
  withRetry: (_id: string, fn: () => Promise<unknown>) => fn(),
  fetchProduction: jest.fn(),
  getRateLimiter: () => ({ tryAcquire: () => true }),
  TtlCache: class {
    get(): undefined { return undefined; }
    set(): void {}
  },
  logProviderCall: jest.fn(),
  reasonFromError: (_id: string, e: unknown) => String(e),
  freshnessFromTimestamp: () => 'fresh',
}));
jest.mock('../../services/aiGatewayDispatcher', () => ({ dispatchTransport: jest.fn() }));
jest.mock('../../services/intelligence/costGovernance', () => ({
  withinBudget: () => ({ ok: true }),
  recordUsage: jest.fn(),
  estimateCost: () => 0,
}));
jest.mock('../../services/intelligence/scanBudgetContext', () => ({ getActiveScanId: () => null }));
jest.mock('../../services/intelligence/probeCostCapture', () => ({
  captureProbeCost: jest.fn(() => Promise.resolve()),
  extractProbeTokenUsage: () => ({ inputTokens: 0, outputTokens: 0, model: null }),
}));
jest.mock('../../services/intelligence/citationExtractor', () => ({
  extractCitation: (args: { provider: string; query: string; query_class: string; answer: string; observedAt: string }) => ({
    provider: args.provider,
    query: args.query,
    query_class: args.query_class,
    appeared: /brand x/i.test(args.answer),
    prominence: 1,
    evidence_excerpt: null,
    observed_at: args.observedAt,
  }),
}));
jest.mock('../../services/intelligence/queryOrchestrator', () => ({
  formatQueryForProvider: (q: string) => ({ system: 'sys', user: q }),
}));

import { OpenAIChatGPTAdapter } from '../../services/intelligence/adapters/openaiAdapter';
import { AnthropicClaudeAdapter } from '../../services/intelligence/adapters/anthropicAdapter';
import { GeminiAdapter } from '../../services/intelligence/adapters/geminiAdapter';
import { CopilotAdapter } from '../../services/intelligence/adapters/copilotAdapter';
import {
  PerplexityAdapter,
  PERPLEXITY_ADAPTER_CONSUMED_CAPABILITY,
  reconcileCitationCapability,
  reshapeCompletionToPerplexityResponse,
} from '../../services/intelligence/adapters/perplexityAdapter';
import { dispatchTransport } from '../../services/aiGatewayDispatcher';
import { fetchProduction } from '../../services/intelligence/productionPrimitives';
// The REAL Platform identity layer (PB-006) — untouched by this package.
import {
  ProviderIdentityError,
  isPlatformProviderId,
  isProductProviderId,
  resolvePlatformProviderId,
  toPlatformProviderId,
  tryToPlatformProviderId,
  type ProductProviderId,
} from '../../services/aiGatewayProviderIdentity';
// The REAL PB-004 capability registry — untouched by this package.
import {
  PROVIDER_CAPABILITIES,
  getProviderCapability,
  getProviderCapabilityProfile,
  supportsCapability,
} from '../../services/aiGatewayCapabilities';
import type { AIProviderId } from '../../services/intelligence/providerInterfaces';
import type { NormalizedCompletion } from '../../services/aiGatewayCore';

const dispatchMock = dispatchTransport as unknown as jest.Mock;
const fetchProdMock = fetchProduction as unknown as jest.Mock;

/**
 * THE PARITY BASELINE. For each adapter: the PRODUCT id it declares, and the PLATFORM
 * literal that was HARD-CODED at its `dispatchTransport` call site before PB-007,
 * transcribed verbatim from the pre-change sources:
 *
 *   openaiAdapter.ts:124     dispatchTransport('openai',     …)   (product 'chatgpt')
 *   anthropicAdapter.ts:117  dispatchTransport('anthropic',  …)   (product 'claude')
 *   geminiAdapter.ts:113     dispatchTransport('gemini',     …)   (product 'gemini')
 *   copilotAdapter.ts:136    dispatchTransport('copilot',    …)   (product 'copilot')
 *   perplexityAdapter.ts:325 dispatchTransport('perplexity', …)   (product 'perplexity')
 *
 * These strings are the CONTRACT. They must never be regenerated from the mapping —
 * that would make the parity test vacuous.
 */
const LEGACY_HARD_CODED_PLATFORM_ID = Object.freeze({
  chatgpt: 'openai',
  claude: 'anthropic',
  gemini: 'gemini',
  copilot: 'copilot',
  perplexity: 'perplexity',
} as const satisfies Record<AIProviderId, string>);

/** Env keys each adapter reads for its credential + its gateway-transport flag. */
const ADAPTERS = [
  {
    name: 'OpenAIChatGPTAdapter',
    product: 'chatgpt' as const,
    make: () => new OpenAIChatGPTAdapter(),
    credentialEnv: ['OPENAI_API_KEY'],
    flagEnv: 'OPENAI_ADAPTER_GATEWAY_TRANSPORT',
  },
  {
    name: 'AnthropicClaudeAdapter',
    product: 'claude' as const,
    make: () => new AnthropicClaudeAdapter(),
    credentialEnv: ['ANTHROPIC_API_KEY'],
    flagEnv: 'ANTHROPIC_ADAPTER_GATEWAY_TRANSPORT',
  },
  {
    name: 'GeminiAdapter',
    product: 'gemini' as const,
    make: () => new GeminiAdapter(),
    credentialEnv: ['GEMINI_API_KEY'],
    flagEnv: 'GEMINI_ADAPTER_GATEWAY_TRANSPORT',
  },
  {
    name: 'CopilotAdapter',
    product: 'copilot' as const,
    make: () => new CopilotAdapter(),
    credentialEnv: ['AZURE_COPILOT_API_KEY', 'AZURE_COPILOT_ENDPOINT'],
    flagEnv: 'COPILOT_ADAPTER_GATEWAY_TRANSPORT',
  },
  {
    name: 'PerplexityAdapter',
    product: 'perplexity' as const,
    make: () => new PerplexityAdapter(),
    credentialEnv: ['PERPLEXITY_API_KEY'],
    flagEnv: 'PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT',
  },
] satisfies ReadonlyArray<{
  name: string;
  product: AIProviderId;
  make: () => { id: AIProviderId; probe: (p: never) => Promise<unknown> };
  credentialEnv: readonly string[];
  flagEnv: string;
}>;

const ALL_FLAG_ENVS = ADAPTERS.map((a) => a.flagEnv);
const ALL_CREDENTIAL_ENVS = ADAPTERS.flatMap((a) => a.credentialEnv);

const PROBE = { query_class: 'commercial', queries: ['best crm for teams'], brandName: 'Brand X' };

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of ALL_CREDENTIAL_ENVS) process.env[key] = 'test-key';
  process.env.AZURE_COPILOT_ENDPOINT = 'https://example.openai.azure.com';
  for (const key of ALL_FLAG_ENVS) delete process.env[key];
});

afterEach(() => {
  for (const key of ALL_FLAG_ENVS) delete process.env[key];
});

// ── 1 · LEGACY BEHAVIOR PARITY ───────────────────────────────────────────────
//
// The load-bearing test of this package. PB-007 is only admissible if the derived id
// is byte-identical to the literal it replaced, for EVERY adapter.

describe('PB-007 · legacy parity — the derived id equals the previously hard-coded literal', () => {
  for (const { name, product } of ADAPTERS) {
    it(`${name}: toPlatformProviderId('${product}') === '${LEGACY_HARD_CODED_PLATFORM_ID[product]}' (the pre-PB-007 literal)`, () => {
      const derived = toPlatformProviderId(product);
      expect(derived).toBe(LEGACY_HARD_CODED_PLATFORM_ID[product]);
      // Byte-identical, not merely equal-ish: same length, no case/whitespace drift.
      expect(derived).toHaveLength(LEGACY_HARD_CODED_PLATFORM_ID[product].length);
      expect(derived).toEqual(LEGACY_HARD_CODED_PLATFORM_ID[product]);
    });
  }

  it('the parity table covers every product provider and nothing else', () => {
    expect(ADAPTERS.map((a) => a.product).sort()).toEqual(
      Object.keys(LEGACY_HARD_CODED_PLATFORM_ID).sort(),
    );
  });

  it('the two divergent providers are genuinely divergent (the hazard PB-007 removes)', () => {
    // If these ever coincided the package would be pointless — and a naive `this.id`
    // would silently be "correct", which is exactly the trap PB-005 documented.
    expect(LEGACY_HARD_CODED_PLATFORM_ID.chatgpt).not.toBe('chatgpt');
    expect(LEGACY_HARD_CODED_PLATFORM_ID.claude).not.toBe('claude');
    expect(LEGACY_HARD_CODED_PLATFORM_ID.gemini).toBe('gemini');
    expect(LEGACY_HARD_CODED_PLATFORM_ID.perplexity).toBe('perplexity');
    expect(LEGACY_HARD_CODED_PLATFORM_ID.copilot).toBe('copilot');
  });
});

// ── 2 · SUCCESSFUL TRANSLATION ───────────────────────────────────────────────

describe('PB-007 · successful translation (per adapter)', () => {
  for (const { name, product, make } of ADAPTERS) {
    it(`${name} declares product id '${product}', which translates to a valid platform id`, () => {
      const adapter = make();
      expect(adapter.id).toBe(product);
      expect(isProductProviderId(adapter.id)).toBe(true);

      const platform = toPlatformProviderId(adapter.id);
      expect(isPlatformProviderId(platform)).toBe(true);
      expect(platform).toBe(LEGACY_HARD_CODED_PLATFORM_ID[product]);
    });
  }

  it('a product id is NOT interchangeable with a platform id for the two divergent providers', () => {
    // The failure mode this package structurally prevents: handing `this.id` straight
    // to a Platform API.
    expect(isPlatformProviderId('chatgpt')).toBe(false);
    expect(isPlatformProviderId('claude')).toBe(false);
    expect(isProductProviderId('openai')).toBe(false);
    expect(isProductProviderId('anthropic')).toBe(false);
  });
});

// ── 3 · DISPATCH PARITY (end-to-end through probe) ───────────────────────────

describe('PB-007 · dispatch parity — adapters still route with the identical platform id', () => {
  for (const { name, product, make, flagEnv } of ADAPTERS) {
    it(`${name} dispatches with '${LEGACY_HARD_CODED_PLATFORM_ID[product]}' (unchanged by PB-007)`, async () => {
      process.env[flagEnv] = 'true';
      dispatchMock.mockResolvedValue({
        content: 'Brand X leads the category',
        usage: { prompt_tokens: 9, completion_tokens: 6, total_tokens: 15 },
      } satisfies NormalizedCompletion);

      const result = (await make().probe({ ...PROBE, provider: product } as never)) as {
        state: string;
        provider: string;
      };

      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock.mock.calls[0][0]).toBe(LEGACY_HARD_CODED_PLATFORM_ID[product]);
      expect(fetchProdMock).not.toHaveBeenCalled();
      // The PRODUCT id is what surfaces on the result — translation is inbound-only.
      expect(result.provider).toBe(product);
      expect(result.state).toBe('measured');
    });
  }

  it('flag OFF still uses the legacy direct transport — PB-007 touched no routing decision', async () => {
    fetchProdMock.mockResolvedValue({
      json: async () => ({
        content: [{ type: 'text', text: 'Brand X leads the category' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });
    await new AnthropicClaudeAdapter().probe({ ...PROBE, provider: 'claude' } as never);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(fetchProdMock).toHaveBeenCalledTimes(1);
  });
});

// ── 4 · UNKNOWN PROVIDER HANDLING · NO NEW THROW PATH ────────────────────────

describe('PB-007 · unknown provider handling', () => {
  const BAD_INPUTS: readonly unknown[] = [
    'openai', // a PLATFORM id is not a product id
    'anthropic',
    'ChatGPT', // wrong case — no case folding
    ' claude', // whitespace — no trimming
    'claude ',
    'gpt-4o',
    '',
    '__proto__',
    'constructor',
    'toString',
    null,
    undefined,
    42,
    {},
    [],
  ];

  it('the strict resolver throws a typed ProviderIdentityError for every unmappable input', () => {
    for (const bad of BAD_INPUTS) {
      expect(() => toPlatformProviderId(bad as ProductProviderId)).toThrow(ProviderIdentityError);
    }
  });

  it('the explicit non-throwing variants degrade without substituting a plausible id', () => {
    for (const bad of BAD_INPUTS) {
      expect(tryToPlatformProviderId(bad)).toBeUndefined();
      const resolved = resolvePlatformProviderId(bad);
      expect(resolved.ok).toBe(false);
      if ('reason' in resolved) {
        expect(['not_a_string', 'empty', 'unknown_provider']).toContain(resolved.reason);
      }
    }
  });

  it('NO NEW THROW PATH: importing every adapter performs its one translation without throwing', () => {
    // Each adapter translates ONCE, at module initialization, from a compile-time
    // literal in the product union. If any adapter could ever throw on translation it
    // would throw HERE — deterministically, at import — not on a live probe. Modules
    // are already imported at the top of this file; re-requiring re-asserts it and
    // proves the module objects are intact.
    expect(() => {
      jest.requireActual('../../services/intelligence/adapters/openaiAdapter');
      jest.requireActual('../../services/intelligence/adapters/anthropicAdapter');
      jest.requireActual('../../services/intelligence/adapters/geminiAdapter');
      jest.requireActual('../../services/intelligence/adapters/copilotAdapter');
      jest.requireActual('../../services/intelligence/adapters/perplexityAdapter');
    }).not.toThrow();
  });

  it('NO NEW THROW PATH: constructing every adapter is total', () => {
    for (const { make } of ADAPTERS) {
      expect(() => make()).not.toThrow();
    }
  });

  it('no adapter ever routes an unmappable id: every dispatched id is a canonical platform id', async () => {
    for (const { product, make, flagEnv } of ADAPTERS) {
      jest.clearAllMocks();
      process.env[flagEnv] = 'true';
      dispatchMock.mockResolvedValue({ content: 'Brand X', usage: null } satisfies NormalizedCompletion);
      await make().probe({ ...PROBE, provider: product } as never);
      expect(isPlatformProviderId(dispatchMock.mock.calls[0][0])).toBe(true);
      delete process.env[flagEnv];
    }
  });
});

// ── 5 · CAPABILITY LOOKUP AFTER TRANSLATION ──────────────────────────────────
//
// The PB-004 registry is keyed by PLATFORM ids. These tests show WHY translation must
// precede a lookup — and simultaneously re-assert the PB-005 rule that PB-007 does not
// bend: the registry describes, it never gates.

describe('PB-007 · capability lookup after translation', () => {
  for (const { name, product } of ADAPTERS) {
    it(`${name}: the registry resolves a profile for the TRANSLATED id`, () => {
      const platform = toPlatformProviderId(product);
      const profile = getProviderCapabilityProfile(platform);
      expect(profile).toBeDefined();
      expect(profile?.provider).toBe(LEGACY_HARD_CODED_PLATFORM_ID[product]);
    });
  }

  it('the untranslated PRODUCT id silently resolves to NOTHING for the two divergent providers', () => {
    // Not a bug in the registry — its "no claim" degradation is mandated. It is the
    // reason a product id must never reach it.
    expect(getProviderCapabilityProfile('chatgpt')).toBeUndefined();
    expect(getProviderCapabilityProfile('claude')).toBeUndefined();
    expect(supportsCapability('chatgpt', PROVIDER_CAPABILITIES.SYSTEM_PROMPT)).toBe(false);
    expect(supportsCapability('claude', PROVIDER_CAPABILITIES.SYSTEM_PROMPT)).toBe(false);
    // …and the translated ids answer truthfully.
    expect(supportsCapability(toPlatformProviderId('chatgpt'), PROVIDER_CAPABILITIES.SYSTEM_PROMPT)).toBe(true);
    expect(supportsCapability(toPlatformProviderId('claude'), PROVIDER_CAPABILITIES.SYSTEM_PROMPT)).toBe(true);
  });

  it("Perplexity's consumed capability is declared for the TRANSLATED id", () => {
    const declaration = getProviderCapability(
      toPlatformProviderId('perplexity'),
      PERPLEXITY_ADAPTER_CONSUMED_CAPABILITY,
    );
    expect(declaration).toBeDefined();
    expect(declaration?.supported).toBe(true);
  });

  it('PB-005 invariant survives PB-007: the reconciliation default now uses the DERIVED id and still agrees', () => {
    const reconciliation = reconcileCitationCapability(2);
    expect(reconciliation.provider).toBe(LEGACY_HARD_CODED_PLATFORM_ID.perplexity);
    expect(reconciliation.agreement).toBe('agreed');
    expect(reconciliation.drift).toBe(false);
    expect(reconciliation.citationsApplied).toBe(true);
  });

  it('NO CAPABILITY GATE INTRODUCED: citations are applied without consulting the registry', () => {
    const completion: NormalizedCompletion = {
      content: 'answer',
      usage: null,
      providerMetadata: Object.freeze({
        perplexity: {
          provider: 'perplexity',
          kind: 'citations',
          version: 1,
          data: { citations: ['https://a.example', 'https://b.example'] },
        },
      }),
    } as unknown as NormalizedCompletion;
    const reshaped = reshapeCompletionToPerplexityResponse(completion, 'sonar');
    expect(reshaped.citations).toEqual(['https://a.example', 'https://b.example']);
    // The reconciliation is descriptive only: it cannot suppress what was applied.
    expect(reconcileCitationCapability(reshaped.citations?.length ?? 0).citationsApplied).toBe(true);
  });
});
