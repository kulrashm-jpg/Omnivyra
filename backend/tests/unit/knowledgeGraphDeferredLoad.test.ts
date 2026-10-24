/**
 * Knowledge graph — "mod.WikidataAdapter is not a constructor" (Digital Snapshot,
 * omnivyra.com, 2026-10-24). The module object required at bootstrap had no
 * exports, so the slot was permanently marked load-failed for the process.
 *
 * An empty or Promise module object at bootstrap must no longer be fatal: the
 * adapter is resolved on first use, when the module is complete.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import { createKnowledgeGraphProvider, getAdapterLoadFailures, _resetIntelligenceRegistry } from '../../services/intelligence/providerRegistry';

class FakeAdapter {
  public readonly id = 'wikidata';
  async isAvailable() { return true; }
  async lookup() { return { state: 'measured', entity: { label: 'Acme' }, score: 70 } as never; }
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  _resetIntelligenceRegistry();
});

describe('createKnowledgeGraphProvider', () => {
  it('uses the adapter at once when the export is present (unchanged path)', async () => {
    const load = jest.fn();
    const provider = createKnowledgeGraphProvider({ WikidataAdapter: FakeAdapter }, load);
    expect(provider).toBeInstanceOf(FakeAdapter);
    expect(load).not.toHaveBeenCalled();
  });

  it('defers when the module is still mid-evaluation (empty exports at bootstrap)', async () => {
    const moduleObject: Record<string, unknown> = {};
    const provider = createKnowledgeGraphProvider(moduleObject, () => moduleObject);
    moduleObject.WikidataAdapter = FakeAdapter; // evaluation completes after bootstrap
    expect(await provider.isAvailable()).toBe(true);
    expect((await provider.lookup({ brandName: 'Acme', domain: 'acme.com' })).score).toBe(70);
    expect(getAdapterLoadFailures()).toHaveLength(0);
  });

  it('awaits a bundler async module (require returns a Promise)', async () => {
    const asyncModule = Promise.resolve({ WikidataAdapter: FakeAdapter });
    const provider = createKnowledgeGraphProvider(asyncModule, () => asyncModule);
    expect(await provider.isAvailable()).toBe(true);
    expect(getAdapterLoadFailures()).toHaveLength(0);
  });

  it('accepts a default-wrapped namespace', async () => {
    const mod = { default: { WikidataAdapter: FakeAdapter } };
    expect(createKnowledgeGraphProvider(mod, () => mod)).toBeInstanceOf(FakeAdapter);
  });

  it('a genuinely missing export is still recorded and reported, never scored', async () => {
    const provider = createKnowledgeGraphProvider({}, () => ({ somethingElse: 1 }));
    expect(await provider.isAvailable()).toBe(false);
    const result = await provider.lookup({ brandName: 'Acme', domain: null });
    expect(result.state).toBe('unavailable');
    expect(result.score).toBeNull();
    expect(result.reason_unavailable).toContain('configured but failed to load');
    const failure = getAdapterLoadFailures().find((f) => f.slot === 'knowledge_graph');
    expect(failure?.message).toContain('module exports: somethingElse');
  });

  it('resolves once — repeated lookups do not reload the module', async () => {
    const load = jest.fn(() => ({ WikidataAdapter: FakeAdapter }));
    const provider = createKnowledgeGraphProvider({}, load);
    await provider.lookup({ brandName: 'a', domain: null });
    await provider.lookup({ brandName: 'b', domain: null });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
