/**
 * K4 — availability is reported, the arithmetic is not changed.
 *
 * overallPercent is a weighted mean over AVAILABLE factors only. That is
 * deliberate and stays deliberate: an unreadable factor must not count as zero.
 * But it means an unavailable factor leaves the DENOMINATOR, so the same
 * underlying progress can report a different percentage depending on which reads
 * succeeded — and the monotonic ratchet cannot compensate, because it floors
 * factor scores rather than the denominator.
 *
 * So the fix is not to change the score. It is to stop presenting a rescoped
 * score as a complete one. These tests pin both halves: identical numbers when
 * everything is available, and an explicit shortfall when it is not.
 */
import { evaluateCapabilityRegistry } from '../../../lib/shared/capabilityRegistry';

type Reg = Parameters<typeof evaluateCapabilityRegistry>[0];

/** Minimal registry: one category, factors driven straight from the signals. */
function registry(factorIds: string[]): any {
  return [
    {
      id: 'cat',
      title: 'Category',
      weight: 1,
      capability: () => ({ supported: true, enabled: true, available: true, reason: null }),
      factors: () =>
        factorIds.map((id) => ({
          id,
          title: id,
          description: id,
          weight: 1,
          evaluate: (signals: any) => {
            const v = signals[id];
            return v === undefined
              ? { available: false as const, reason: 'no signal' }
              : { score: v };
          },
        })),
    },
  ];
}

const evaluate = (ids: string[], signals: Record<string, number | undefined>) =>
  evaluateCapabilityRegistry(registry(ids) as Reg, signals as any, {});

describe('K4 — complete availability preserves the existing number', () => {
  it('all factors available → availability.complete is true', () => {
    const r = evaluate(['a', 'b', 'c'], { a: 1, b: 1, c: 1 });
    expect(r.availability.complete).toBe(true);
    expect(r.availability.unavailableCount).toBe(0);
    expect(r.availability.evaluatedCount).toBe(3);
    expect(r.availability.declaredCount).toBe(3);
  });

  it('all available → percentage is the plain weighted mean, unchanged', () => {
    expect(evaluate(['a', 'b', 'c', 'd'], { a: 1, b: 1, c: 1, d: 0 }).overallPercent).toBe(75);
    expect(evaluate(['a', 'b'], { a: 1, b: 0 }).overallPercent).toBe(50);
    expect(evaluate(['a'], { a: 1 }).overallPercent).toBe(100);
    expect(evaluate(['a', 'b'], { a: 0, b: 0 }).overallPercent).toBe(0);
  });

  it('adding availability metadata did not disturb the summary counts', () => {
    const r = evaluate(['a', 'b', 'c'], { a: 1, b: 0.5, c: 0 });
    expect(r.summary.completedCount).toBe(1);
    expect(r.summary.inProgressCount).toBe(1);
    expect(r.summary.totalCount).toBe(3);
  });
});

describe('K4 — unavailable factors are reported, not silently dropped', () => {
  it('one unavailable → complete is false and the shortfall is counted', () => {
    const r = evaluate(['a', 'b', 'c'], { a: 1, b: 1, c: undefined });
    expect(r.availability.complete).toBe(false);
    expect(r.availability.unavailableCount).toBe(1);
    expect(r.availability.evaluatedCount).toBe(2);
    expect(r.availability.declaredCount).toBe(3);
  });

  it('multiple unavailable are all counted', () => {
    const r = evaluate(['a', 'b', 'c', 'd'], { a: 1, b: undefined, c: undefined, d: undefined });
    expect(r.availability.unavailableCount).toBe(3);
    expect(r.availability.evaluatedCount).toBe(1);
    expect(r.availability.complete).toBe(false);
  });

  it('CRITICAL: the denominator drift is now VISIBLE rather than silent', () => {
    // Identical underlying progress; one run simply could not read factor c.
    const everything = evaluate(['a', 'b', 'c'], { a: 1, b: 1, c: 0 });
    const degraded = evaluate(['a', 'b', 'c'], { a: 1, b: 1, c: undefined });

    // The rescoping still happens — that is the existing, deliberate philosophy.
    expect(everything.overallPercent).toBe(67);
    expect(degraded.overallPercent).toBe(100);

    // What changed: the second result no longer CLAIMS to be a complete score.
    expect(everything.availability.complete).toBe(true);
    expect(degraded.availability.complete).toBe(false);
    expect(degraded.availability.unavailableCount).toBe(1);
  });

  it('MUTATION GUARD: an unavailable factor can never be reported as complete', () => {
    for (const missing of ['a', 'b', 'c']) {
      const signals: Record<string, number | undefined> = { a: 1, b: 1, c: 1 };
      signals[missing] = undefined;
      const r = evaluate(['a', 'b', 'c'], signals);
      expect(r.availability.complete).toBe(false);
      expect(r.availability.unavailableCount).toBeGreaterThan(0);
    }
  });

  it('an unavailable factor is still excluded from the numerator (not scored zero)', () => {
    // Unchanged philosophy: unreadable must not be punished as zero.
    const r = evaluate(['a', 'b'], { a: 1, b: undefined });
    expect(r.overallPercent).toBe(100);
  });
});

describe('K4 — ratchet compatibility', () => {
  it('prior maxima still floor factor scores', () => {
    const withPrior = evaluateCapabilityRegistry(registry(['a']) as Reg, { a: 0 } as any, { a: 1 });
    expect(withPrior.overallPercent).toBe(100);
    expect(withPrior.availability.complete).toBe(true);
  });

  it('a fresh evaluation with no prior state is deterministic', () => {
    const a = evaluate(['a', 'b'], { a: 1, b: 0 });
    const b = evaluate(['a', 'b'], { a: 1, b: 0 });
    expect(a.overallPercent).toBe(b.overallPercent);
    expect(a.availability).toEqual(b.availability);
  });

  it('the ratchet only records maxima for available factors', () => {
    const HOOK = require('fs').readFileSync(
      require('path').join(process.cwd(), 'hooks/useCommandCenterCore.tsx'),
      'utf-8',
    );
    expect(HOOK).toContain('if (f.available) next[f.id] = Math.max(next[f.id] ?? 0, f.score);');
  });

  it('ratchet and stabiliser stay scoped per company (no cross-company leakage)', () => {
    const HOOK = require('fs').readFileSync(
      require('path').join(process.cwd(), 'hooks/useCommandCenterCore.tsx'),
      'utf-8',
    );
    expect(HOOK).toContain('`cc-ratchet:${key}:${companyId}`');
    expect(HOOK).toContain('`cc-stable-inputs:${companyId}`');
  });

  it('the empty evaluation does not claim to be a complete 0%', () => {
    const HOOK = require('fs').readFileSync(
      require('path').join(process.cwd(), 'hooks/useCommandCenterCore.tsx'),
      'utf-8',
    );
    expect(HOOK).toMatch(/availability: \{ evaluatedCount: 0, unavailableCount: 0, declaredCount: 0, complete: false \}/);
  });
});
