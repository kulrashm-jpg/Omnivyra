/**
 * WS-2A — Engagement Semantic Shadow adoption tests (Zone A2).
 *
 * Proves the shadow coordinator: OFF is a no-op; shadow mode transports semantic
 * context + runs duplicate-intent detection without persisting or throwing; and
 * ids are the canonical deterministic roots. Drives the default singleton
 * registries (in-memory) with unique tenant ids per test to avoid leakage.
 */
import {
  observeEngagementSemanticShadow,
  getCoordinationAdoptionMode,
  communicationRegistry,
  deriveSemanticRootId,
} from '../../services/intelligence/coordination';

const MODE_ENV = 'COORDINATION_ADOPTION_MODE';

function withMode<T>(mode: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env[MODE_ENV];
  process.env[MODE_ENV] = mode;
  return fn().finally(() => {
    if (prev === undefined) delete process.env[MODE_ENV];
    else process.env[MODE_ENV] = prev;
  });
}

describe('WS-2A — coordination adoption flags', () => {
  it('defaults to off', () => {
    const prev = process.env[MODE_ENV];
    delete process.env[MODE_ENV];
    expect(getCoordinationAdoptionMode()).toBe('off');
    if (prev !== undefined) process.env[MODE_ENV] = prev;
  });
});

describe('WS-2A — observeEngagementSemanticShadow', () => {
  it('is a complete no-op when OFF (returns null)', async () => {
    await withMode('off', async () => {
      const ctx = await observeEngagementSemanticShadow({
        companyId: 'co-off', topic: 'anything', surface: 'engagement.reply',
      });
      expect(ctx).toBeNull();
    });
  });

  it('returns null when tenant is missing (never cross-tenant)', async () => {
    await withMode('shadow', async () => {
      const ctx = await observeEngagementSemanticShadow({
        companyId: '', topic: 'x', surface: 'engagement.reply',
      });
      expect(ctx).toBeNull();
    });
  });

  it('transports semantic context in shadow mode with the canonical root id', async () => {
    await withMode('shadow', async () => {
      const companyId = 'co-ws2a-1';
      const topic = 'inbound question about pricing';
      const ctx = await observeEngagementSemanticShadow({
        companyId, topic, platform: 'linkedin', surface: 'engagement.suggestion',
      });
      expect(ctx).not.toBeNull();
      if (!ctx) return;
      expect(ctx.communicationIntent).toBe('reply');
      expect(ctx.semanticRootId).toBe(
        deriveSemanticRootId({ companyId, communicationIntent: 'reply', campaignId: null, topic }),
      );
      expect(ctx.rootPresent).toBe(false);          // nothing registered yet
      expect(ctx.priorEventCount).toBe(0);
      expect(ctx.duplicate.decision).toBe('unique'); // trivially unique — no priors
    });
  });

  it('observes a prior communication event as duplicate INTENT (shadow, non-blocking)', async () => {
    await withMode('shadow', async () => {
      const companyId = 'co-ws2a-2';
      const topic = 'launch of the new integration';
      // A producer previously registered the same intent seed.
      await communicationRegistry.register({
        companyId, communicationIntent: 'reply', topic, sourceModule: 'engagement',
      });
      const ctx = await observeEngagementSemanticShadow({
        companyId, topic, surface: 'engagement.reply',
      });
      expect(ctx).not.toBeNull();
      if (!ctx) return;
      expect(ctx.priorEventCount).toBeGreaterThanOrEqual(1);
      expect(ctx.duplicate.decision).toBe('duplicate_intent');
      expect(ctx.duplicate.basis).toBe('root_id');
    });
  });

  it('never throws (fail-open) even with odd input', async () => {
    await withMode('shadow', async () => {
      await expect(
        observeEngagementSemanticShadow({ companyId: 'co-ws2a-3', topic: '', surface: 's' }),
      ).resolves.toBeDefined();
    });
  });
});
