/**
 * Concurrency tests for the single-flight refresh guarantee.
 *
 * Pre-Phase-2.B-D, concurrent /api/company-profile fetches could:
 *   - issue duplicate network requests,
 *   - both observe a transient failure,
 *   - both call signOut() — the second on an already-invalidated client.
 *
 * This module's contract is: at most ONE in-flight promise per key. These
 * tests pin that contract under realistic concurrency patterns.
 */

import {
  singleFlight,
  resetSingleFlight,
  isSingleFlightInFlight,
  singleFlightDiagnostics,
} from '../../../lib/auth/singleFlightRefresh';

beforeEach(() => resetSingleFlight());

describe('singleFlight', () => {
  it('runs work exactly once and returns the same value to concurrent callers', async () => {
    let runs = 0;
    const work = jest.fn(async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 10));
      return runs;
    });

    const promises = [
      singleFlight('k1', work),
      singleFlight('k1', work),
      singleFlight('k1', work),
    ];
    const results = await Promise.all(promises);

    expect(results).toEqual([1, 1, 1]);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('different keys run independently', async () => {
    const work = jest.fn(async (label: string) => {
      await new Promise((r) => setTimeout(r, 5));
      return label;
    });
    const [a, b] = await Promise.all([
      singleFlight('k1', () => work('a')),
      singleFlight('k2', () => work('b')),
    ]);
    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('releases the slot after success so a subsequent call runs fresh', async () => {
    let runs = 0;
    const work = async () => {
      runs += 1;
      return runs;
    };
    const first = await singleFlight('k', work);
    const second = await singleFlight('k', work);
    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  it('releases the slot after failure so subsequent callers retry', async () => {
    let runs = 0;
    const work = async () => {
      runs += 1;
      if (runs === 1) throw new Error('boom');
      return runs;
    };

    await expect(singleFlight('k', work)).rejects.toThrow('boom');
    const second = await singleFlight('k', work);
    expect(second).toBe(2);
  });

  it('coalesces concurrent callers even when work throws', async () => {
    let runs = 0;
    const work = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 5));
      throw new Error('boom');
    };
    const results = await Promise.allSettled([
      singleFlight('k', work),
      singleFlight('k', work),
      singleFlight('k', work),
    ]);
    expect(runs).toBe(1);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('isSingleFlightInFlight reports the in-flight state', async () => {
    expect(isSingleFlightInFlight('k')).toBe(false);
    const p = singleFlight('k', async () => {
      expect(isSingleFlightInFlight('k')).toBe(true);
      return 1;
    });
    await p;
    expect(isSingleFlightInFlight('k')).toBe(false);
  });

  it('diagnostics report coalescedHits', async () => {
    const work = async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 1;
    };
    await Promise.all([
      singleFlight('k', work),
      singleFlight('k', work),
      singleFlight('k', work),
    ]);
    const diag = singleFlightDiagnostics();
    expect(diag.coalescedHits).toBe(2);
  });
});
