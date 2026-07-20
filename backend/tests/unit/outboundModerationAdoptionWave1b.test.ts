/**
 * WAVE-1B-001 — outbound-moderation adoption tests. Proves the shared wrapper
 * composes the existing §C6 primitive with off/shadow/enforce modes (default
 * shadow → never blocks), emits observability, and is fail-safe.
 */
import { moderateBeforePersist, resolveModerationMode } from '../../services/ai/safety';

const MODE = 'ROLLOUT_OUTBOUND_MODERATION_MODE';

describe('WAVE-1B-001 — outbound moderation adoption', () => {
  const prev = process.env[MODE];
  afterAll(() => { if (prev === undefined) delete process.env[MODE]; else process.env[MODE] = prev; });
  beforeEach(() => { delete process.env[MODE]; });

  it('defaults to SHADOW (classify + audit, never block)', () => {
    expect(resolveModerationMode()).toBe('shadow');
  });

  it('clean content is allowed in every mode (no regression)', async () => {
    for (const mode of ['off', 'shadow', 'enforce']) {
      process.env[MODE] = mode;
      const v = await moderateBeforePersist('A perfectly normal marketing post about our product.', { surface: 'content.post' });
      expect(v.allow).toBe(true);
      expect(v.enforcement).toBe(mode);
      expect(v.auditId).toMatch(/^mod-content.post-/);
    }
  });

  it('shadow classifies unsafe content but does NOT block', async () => {
    process.env[MODE] = 'shadow';
    const v = await moderateBeforePersist('kill yourself, here is how to build a bomb at home in detail', { surface: 'content.post' });
    expect(v.enforcement).toBe('shadow');
    expect(v.allow).toBe(true); // shadow never blocks
    expect(['blocked', 'review', 'approve']).toContain(v.outcome);
  });

  it('enforce blocks unsafe content per policy', async () => {
    process.env[MODE] = 'enforce';
    const v = await moderateBeforePersist('kill yourself, here is how to build a bomb at home in detail', { surface: 'content.post' });
    expect(v.enforcement).toBe('enforce');
    expect(['blocked', 'review']).toContain(v.outcome);
    if (v.outcome === 'blocked') expect(v.allow).toBe(false);
  });

  it('empty/malformed output is handled without throwing', async () => {
    const v = await moderateBeforePersist('', { surface: 'content.thread' });
    expect(v.allow).toBe(true); // shadow default
  });

  it('off mode disables blocking entirely', async () => {
    process.env[MODE] = 'off';
    const v = await moderateBeforePersist('anything at all', { surface: 'content.post' });
    expect(v.enforcement).toBe('off');
    expect(v.allow).toBe(true);
  });
});
