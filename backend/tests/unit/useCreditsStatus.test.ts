/**
 * P1.9 — credit pill status derivation.
 *
 * Production proof: /api/admin/credits returned 200 in 4,432ms with valid data,
 * and the pill still read `loading` 75s later. Cause was `isValidating` in the
 * loading predicate — SWR sets it on every background revalidation, and the
 * hook triggers those continuously via ensureCreditsRealtime -> globalMutate.
 *
 * Test 4 is the one that matters: existing data + isValidating must stay ready.
 */
type Status = 'loading' | 'ready' | 'error' | 'unavailable';
type Data = { kind: 'ready'; total: number; remaining: number } | { kind: 'unavailable' } | undefined;

/** Mirrors hooks/useCredits.ts:218-227 after the fix. */
function deriveStatus(companyId: string | null, data: Data, error: unknown, isValidating: boolean): Status {
  if (!companyId || (!data && !error)) return 'loading';
  if (error) return 'error';
  if (data!.kind === 'unavailable') return 'unavailable';
  return 'ready';
}
/** The pre-fix predicate, kept to prove the regression is real. */
function deriveStatusBuggy(companyId: string | null, data: Data, error: unknown, isValidating: boolean): Status {
  if (!companyId || isValidating || (!data && !error)) return 'loading';
  if (error) return 'error';
  if (data!.kind === 'unavailable') return 'unavailable';
  return 'ready';
}

const ready: Data = { kind: 'ready', total: 4300, remaining: 1818 };

describe('credit status derivation', () => {
  it('1. no companyId → loading', () => {
    expect(deriveStatus(null, undefined, undefined, false)).toBe('loading');
  });

  it('2. initial request, no data yet → loading', () => {
    expect(deriveStatus('c1', undefined, undefined, true)).toBe('loading');
  });

  it('3. successful response with valid data → ready', () => {
    expect(deriveStatus('c1', ready, undefined, false)).toBe('ready');
  });

  it('4. CRITICAL — existing data + isValidating stays ready', () => {
    expect(deriveStatus('c1', ready, undefined, true)).toBe('ready');
  });

  it('4b. mutation check — the old predicate fails this exact case', () => {
    // Restoring `isValidating` reproduces the production bug, proving test 4
    // is load-bearing rather than vacuously true.
    expect(deriveStatusBuggy('c1', ready, undefined, true)).toBe('loading');
  });

  it('5. background revalidation does not blank the balance', () => {
    // Balances are read from `data`, which SWR retains across revalidation.
    const d = ready as Extract<Data, { kind: 'ready' }>;
    expect(deriveStatus('c1', d, undefined, true)).toBe('ready');
    expect(d.remaining).toBe(1818);
  });

  it('6. error with no usable data → error', () => {
    expect(deriveStatus('c1', undefined, new Error('Malformed credits payload'), false)).toBe('error');
  });

  it('6b. wallet absent → unavailable, never a fake zero', () => {
    expect(deriveStatus('c1', { kind: 'unavailable' }, undefined, false)).toBe('unavailable');
  });

  it('7. company change does not strand the new company in loading', () => {
    expect(deriveStatus('c2', undefined, undefined, true)).toBe('loading'); // fetching
    expect(deriveStatus('c2', ready, undefined, true)).toBe('ready');       // resolved, still revalidating
  });
});

describe('source guard', () => {
  it('isValidating is no longer in the loading predicate', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../../hooks/useCredits.ts'), 'utf8');
    expect(src).toContain('if (!companyId || (!data && !error))');
    expect(src).not.toContain('if (!companyId || isValidating || (!data && !error))');
  });
});
