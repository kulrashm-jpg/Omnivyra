/**
 * Phase 10C — usage propagation (AsyncLocalStorage collector).
 *
 * Proves actual token usage recorded at ANY async depth (simulating
 * orchestrator → generator → gateway) propagates back to the caller's
 * collection scope — the mechanism that lets processors supply
 * collectActualUsage() to the entry-consumption engine.
 */

import { runWithUsageCollection, recordProviderUsage, recordAssetCredits } from '../../services/aiUsageCollector';

describe('aiUsageCollector', () => {
  it('recordProviderUsage / recordAssetCredits are no-ops outside any scope', () => {
    expect(() => recordProviderUsage(100, 50)).not.toThrow();
    expect(() => recordAssetCredits(5)).not.toThrow();
  });

  it('accumulates token usage recorded at any async depth within the scope', async () => {
    const gateway = async (inT: number, outT: number) => { await Promise.resolve(); recordProviderUsage(inT, outT); };
    const generator = async () => { await gateway(1000, 500); };
    const orchestrator = async () => { await generator(); await gateway(200, 100); };

    const { result, usage } = await runWithUsageCollection(async () => {
      await orchestrator();
      return 'CONTENT';
    });

    expect(result).toBe('CONTENT');
    expect(usage).toEqual({ inputTokens: 1200, outputTokens: 600, assetCredits: 0 });
  });

  it('accumulates asset credits alongside tokens (Phase 10E)', async () => {
    const renderImage = async () => { await Promise.resolve(); recordAssetCredits(1); }; // per-image
    const { usage } = await runWithUsageCollection(async () => {
      recordProviderUsage(1000, 500); // text
      await renderImage();            // image 1
      await renderImage();            // image 2 (e.g. carousel)
    });
    expect(usage).toEqual({ inputTokens: 1000, outputTokens: 500, assetCredits: 2 });
  });

  it('isolates concurrent/separate scopes', async () => {
    const [a, b] = await Promise.all([
      runWithUsageCollection(async () => { await Promise.resolve(); recordProviderUsage(10, 5); recordAssetCredits(1); }),
      runWithUsageCollection(async () => { await Promise.resolve(); recordProviderUsage(7, 3); }),
    ]);
    expect(a.usage).toEqual({ inputTokens: 10, outputTokens: 5, assetCredits: 1 });
    expect(b.usage).toEqual({ inputTokens: 7, outputTokens: 3, assetCredits: 0 });
  });

  it('ignores negative / NaN counts', async () => {
    const { usage } = await runWithUsageCollection(async () => {
      recordProviderUsage(-5, NaN);
      recordProviderUsage(100, 50);
      recordAssetCredits(-3);
      recordAssetCredits(2);
    });
    expect(usage).toEqual({ inputTokens: 100, outputTokens: 50, assetCredits: 2 });
  });
});
