/**
 * Adapter loading — "mod.WikidataAdapter is not a constructor" and
 * "mod.OpenAIChatGPTAdapter is not a constructor" (Digital Snapshot, omnivyra.com,
 * 2026-10-24). Every configured adapter failed this way: the module object required
 * at bootstrap had no exports, so the slots were permanently load-failed.
 *
 * An empty or Promise module object at bootstrap must no longer be fatal: the
 * adapter is resolved on first use, when the module is complete.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import {
  adapterExport,
  instantiateAdapter,
  getAdapterLoadFailures,
  LLM_RETRIEVAL_GROUNDED,
  _resetIntelligenceRegistry,
} from '../../services/intelligence/providerRegistry';
import type { KnowledgeGraphProvider } from '../../services/intelligence/providerInterfaces';

class FakeAdapter implements KnowledgeGraphProvider {
  public readonly id = 'wikidata';
  async isAvailable() { return true; }
  async lookup() { return { state: 'measured', entity: { label: 'Acme' }, score: 70 } as never; }
}

const FAILED: KnowledgeGraphProvider = {
  id: 'adapter_load_failed',
  isAvailable: async () => false,
  lookup: async () => ({ state: 'unavailable', entity: null, score: null }) as never,
};

const kg = (initial: unknown, load: () => unknown) => instantiateAdapter<KnowledgeGraphProvider>({
  initial, load, slot: 'knowledge_graph', sync: { id: 'wikidata' },
  construct: (mod) => {
    const Ctor = adapterExport<new () => KnowledgeGraphProvider>(mod, 'WikidataAdapter');
    return Ctor ? new Ctor() : null;
  },
  onFailure: () => FAILED,
});

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  _resetIntelligenceRegistry();
});

describe('instantiateAdapter', () => {
  it('constructs at once when the export is present (unchanged path)', () => {
    const load = jest.fn();
    expect(kg({ WikidataAdapter: FakeAdapter }, load)).toBeInstanceOf(FakeAdapter);
    expect(load).not.toHaveBeenCalled();
  });

  it('defers when the module is still mid-evaluation (empty exports at bootstrap)', async () => {
    const moduleObject: Record<string, unknown> = {};
    const provider = kg(moduleObject, () => moduleObject);
    expect(provider.id).toBe('wikidata');
    moduleObject.WikidataAdapter = FakeAdapter; // evaluation completes after bootstrap
    expect(await provider.isAvailable()).toBe(true);
    expect((await provider.lookup({ brandName: 'Acme', domain: 'acme.com' })).score).toBe(70);
    expect(getAdapterLoadFailures()).toHaveLength(0);
  });

  it('awaits a bundler async module (require returns a Promise)', async () => {
    const asyncModule = Promise.resolve({ WikidataAdapter: FakeAdapter });
    const provider = kg(asyncModule, () => asyncModule);
    expect(await provider.isAvailable()).toBe(true);
    expect(getAdapterLoadFailures()).toHaveLength(0);
  });

  it('a deferred slot is not a thenable', async () => {
    const provider = kg({}, () => ({ WikidataAdapter: FakeAdapter }));
    expect((provider as unknown as { then?: unknown }).then).toBeUndefined();
    expect(await Promise.resolve(provider)).toBe(provider);
  });

  it('accepts a default-wrapped namespace', () => {
    const mod = { default: { WikidataAdapter: FakeAdapter } };
    expect(kg(mod, () => mod)).toBeInstanceOf(FakeAdapter);
  });

  it('resolves multi-module slots once both are complete', async () => {
    class Store {}
    class History { readonly id = 'report_score_history'; constructor(readonly store: unknown) {} async isAvailable() { return true; } async lookup() { return null as never; } }
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    const provider = instantiateAdapter<{ id: string; isAvailable(): Promise<boolean> }>({
      initial: [a, b], load: () => [a, b], slot: 'trajectory', sync: { id: 'report_score_history' },
      construct: (mods) => {
        const [m1, m2] = mods as unknown[];
        const H = adapterExport<new (s: unknown) => History>(m1, 'History');
        const S = adapterExport<new () => Store>(m2, 'Store');
        return H && S ? new H(new S()) : null;
      },
      onFailure: () => ({ id: 'adapter_load_failed', isAvailable: async () => false }),
    });
    a.History = History; b.Store = Store;
    expect(await provider.isAvailable()).toBe(true);
  });

  it('a genuinely missing export is recorded on first use and answered by the failure provider', async () => {
    const provider = kg({}, () => ({ somethingElse: 1 }));
    expect(await provider.isAvailable()).toBe(false);
    expect((await provider.lookup({ brandName: 'Acme', domain: null })).score).toBeNull();
    const failure = getAdapterLoadFailures().find((f) => f.slot === 'knowledge_graph');
    expect(failure?.message).toContain('module exports: somethingElse');
  });

  it('resolves once — repeated calls do not reload the module', async () => {
    const load = jest.fn(() => ({ WikidataAdapter: FakeAdapter }));
    const provider = kg({}, load);
    await provider.lookup({ brandName: 'a', domain: null });
    await provider.lookup({ brandName: 'b', domain: null });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('LLM_RETRIEVAL_GROUNDED matches the adapter classes', () => {
  it.each([
    ['chatgpt', '../../services/intelligence/adapters/openaiAdapter', 'OpenAIChatGPTAdapter'],
    ['claude', '../../services/intelligence/adapters/anthropicAdapter', 'AnthropicClaudeAdapter'],
    ['gemini', '../../services/intelligence/adapters/geminiAdapter', 'GeminiAdapter'],
    ['perplexity', '../../services/intelligence/adapters/perplexityAdapter', 'PerplexityAdapter'],
    ['copilot', '../../services/intelligence/adapters/copilotAdapter', 'CopilotAdapter'],
  ] as const)('%s', (id, path, cls) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Ctor = require(path)[cls];
    expect(new Ctor().retrieval_grounded).toBe(LLM_RETRIEVAL_GROUNDED[id]);
  });
});
