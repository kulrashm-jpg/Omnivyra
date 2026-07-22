/**
 * Originality Regeneration — Wave 2.
 *
 * Wraps a content generator so its output is checked against the originality
 * gate and, if it comes back a (near-)duplicate, regenerated up to `maxAttempts`
 * times. Returns the FIRST original generation; if none clears the gate, returns
 * the LAST generation with its OriginalityResult so the caller still gets fresh
 * output (never a prior generation verbatim — every attempt calls `generate`
 * afresh).
 *
 * FAIL-OPEN: if the originality assertion itself throws, that attempt is treated
 * as accepted ('bypassed') and returned immediately — originality checking can
 * never block or break generation.
 */

import { computeFingerprint } from '../../../lib/content/originality/fingerprint';
import type { OriginalityResult } from '../../../lib/content/originality/types';

export interface RegenerationInput<T> {
  /** Produce a fresh generation for the given 1-based attempt number. */
  generate: (attempt: number) => Promise<{ text: string; result: T }>;
  /** Assert the originality of a candidate's text. */
  assert: (text: string) => Promise<OriginalityResult>;
  /** Total attempts, including the first (default 2). */
  maxAttempts?: number;
}

export interface RegenerationOutcome<T> {
  text: string;
  result: T;
  originality: OriginalityResult;
  /** 1-based number of the attempt that produced the returned output. */
  attempts: number;
  /** True when more than one attempt was made. */
  regenerated: boolean;
}

/** Build an accepting (fail-open) originality result for a text. */
function bypassResult(text: string): OriginalityResult {
  return {
    isOriginal: true,
    score: 1,
    decision: 'bypassed',
    nearestMatches: [],
    dimensions: {},
    fingerprint: computeFingerprint(text ?? ''),
  };
}

/**
 * Generate, check originality, and regenerate on duplicates up to `maxAttempts`.
 * Returns the first original result, or the last attempt if none was original.
 */
export async function regenerateUntilOriginal<T>(
  input: RegenerationInput<T>,
): Promise<RegenerationOutcome<T>> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 2);

  let last: RegenerationOutcome<T> | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const gen = await input.generate(attempt);

    let originality: OriginalityResult;
    try {
      originality = await input.assert(gen.text);
    } catch {
      // FAIL-OPEN: assertion failure ⇒ accept this generation as-is.
      return {
        text: gen.text,
        result: gen.result,
        originality: bypassResult(gen.text),
        attempts: attempt,
        regenerated: attempt > 1,
      };
    }

    if (originality.isOriginal) {
      // First original: if it took a regeneration to get here, mark it so.
      return {
        text: gen.text,
        result: gen.result,
        originality:
          attempt > 1 ? { ...originality, decision: 'regenerated' } : originality,
        attempts: attempt,
        regenerated: attempt > 1,
      };
    }

    last = {
      text: gen.text,
      result: gen.result,
      originality,
      attempts: attempt,
      regenerated: attempt > 1,
    };
  }

  // Nothing cleared the gate. Return the LAST (freshest) generation; its
  // decision stays 'duplicate' but `regenerated` records that we tried.
  return (
    last ?? {
      // Unreachable (maxAttempts >= 1 always runs the loop once), but typed-safe.
      text: '',
      result: undefined as unknown as T,
      originality: bypassResult(''),
      attempts: 0,
      regenerated: false,
    }
  );
}
