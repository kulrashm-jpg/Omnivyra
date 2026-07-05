import { resolveActivationLatch } from '../../services/activationReadinessService';

describe('resolveActivationLatch (activation once = forever)', () => {
  it('reports a check done when live even if never latched, and marks it to persist', () => {
    const r = resolveActivationLatch({ cms: true, analytics: false, leads: false }, {});
    expect(r.cmsDone).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.nextLatch.cms).toBe(true);
  });

  it('keeps a check done when it was latched but is no longer live (disconnected/deleted)', () => {
    const r = resolveActivationLatch({ cms: false, analytics: false, leads: false }, { cms: true });
    expect(r.cmsDone).toBe(true); // credit retained
    expect(r.changed).toBe(false); // already latched — no write
  });

  it('does not write when the live state simply matches the existing latch', () => {
    const r = resolveActivationLatch(
      { cms: true, analytics: true, leads: true },
      { cms: true, analytics: true, leads: true },
    );
    expect(r.changed).toBe(false);
    expect(r.cmsDone && r.analyticsDone && r.leadsDone).toBe(true);
  });

  it('latches each check independently and preserves prior latch keys', () => {
    const r = resolveActivationLatch(
      { cms: false, analytics: true, leads: false },
      { cms: true },
    );
    expect(r.nextLatch).toEqual({ cms: true, analytics: true });
    expect(r.changed).toBe(true); // analytics newly earned
    expect(r.cmsDone).toBe(true); // retained
    expect(r.analyticsDone).toBe(true); // live
    expect(r.leadsDone).toBe(false); // never earned
  });

  it('reads not-done and writes nothing when a check has never been satisfied', () => {
    const r = resolveActivationLatch({ cms: false, analytics: false, leads: false }, {});
    expect(r.cmsDone || r.analyticsDone || r.leadsDone).toBe(false);
    expect(r.changed).toBe(false);
  });
});
