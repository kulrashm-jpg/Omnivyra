/**
 * "More versions in this look" (PR5 — variations from looks).
 *
 * N generations of the SAME brief with the chosen look LOCKED. Each request is
 * the normal generation payload plus `creator_card.look_variation`
 * ({ index, count, focus, base_seed }) and its own `creator_card.novelty_seed`.
 * The renderer keeps the look identical and gives every version its own seeded
 * novelty plan; versions share `base_seed`, so their primary picks (setting and
 * composition) are guaranteed distinct across the N versions.
 *
 * Owner 2026-10-25 ("new but inspired by the reference selected"): each version
 * sends the look's sample as a standard-fidelity style reference (images.edit)
 * with the "do not copy" instruction, unless CREATOR_LOOK_SAMPLE_REFERENCE=off
 * or the reference kill switch is set.
 *
 * Same endpoint and same governance as a single generation — this runner never
 * bypasses the pipeline, it only calls it N times, like the variant fan-out
 * runner (but sequentially; see runLookVariations). Billing / idempotency are
 * unchanged: the route derives the credit reference from the brief, not from
 * the seed.
 */

import { apiFetch } from '../apiFetch';

/** Kept on the payload for older renderers; the novelty plan now carries the concrete per-version picks. */
export const LOOK_VARIATION_FOCI = ['composition', 'subject', 'angle'] as const;
export type LookVariationFocus = typeof LOOK_VARIATION_FOCI[number];

export const DEFAULT_LOOK_VARIATION_COUNT = 3;
export const MAX_LOOK_VARIATION_COUNT = 4;

const DEFAULT_ENDPOINT = '/api/command-center/creator-content/generate';

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** A fresh base seed for one "More versions" run (browser or node). */
export function newLookVariationBaseSeed(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `lv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The payloads for N locked-look versions. Pure given `baseSeed` (one is
 * minted when omitted). Version i carries `novelty_seed = <baseSeed>:v<i>`.
 */
export function buildLookVariationPayloads(
  basePayload: Record<string, unknown>,
  lookId: string,
  count: number = DEFAULT_LOOK_VARIATION_COUNT,
  baseSeed: string = newLookVariationBaseSeed(),
): Record<string, unknown>[] {
  const n = Math.max(1, Math.min(MAX_LOOK_VARIATION_COUNT, Math.floor(count) || DEFAULT_LOOK_VARIATION_COUNT));
  const card = obj(basePayload.creator_card);
  const guided = obj(card.guided_creative);
  return Array.from({ length: n }, (_, i) => ({
    ...basePayload,
    creator_card: {
      ...card,
      // The look is LOCKED: every version carries the same id, whatever the base said.
      guided_creative: { ...guided, visual_direction_id: lookId },
      look_variation: {
        index: i + 1,
        count: n,
        focus: LOOK_VARIATION_FOCI[i % LOOK_VARIATION_FOCI.length],
        base_seed: baseSeed,
      },
      // Each version is its own generation with its own seed.
      novelty_seed: `${baseSeed}:v${i + 1}`,
    },
  }));
}

export type LookVariationOutcome = { index: number; ok: boolean; status: number; error?: string };

/**
 * Runs the versions ONE AT A TIME. Every version is the same brief, so the
 * generate route derives the same credit reference for each; running them
 * concurrently would race on that one idempotency key. Sequential keeps every
 * version on the route's ordinary single-request path.
 */
export async function runLookVariations(input: {
  basePayload: Record<string, unknown>;
  lookId: string;
  count?: number;
  endpoint?: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ outcomes: LookVariationOutcome[]; successCount: number; failureCount: number }> {
  const payloads = buildLookVariationPayloads(input.basePayload, input.lookId, input.count);
  const outcomes: LookVariationOutcome[] = [];
  for (let i = 0; i < payloads.length; i++) {
    if (input.signal?.aborted) break;
    try {
      const response = await apiFetch(input.endpoint ?? DEFAULT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloads[i]),
        signal: input.signal,
      });
      if (response.ok) {
        outcomes.push({ index: i + 1, ok: true, status: response.status });
      } else {
        const json = await response.json().catch(() => null) as Record<string, unknown> | null;
        outcomes.push({ index: i + 1, ok: false, status: response.status, error: json && typeof json.error === 'string' ? json.error : `HTTP ${response.status}` });
      }
    } catch (err) {
      outcomes.push({ index: i + 1, ok: false, status: 0, error: err instanceof Error ? err.message : String(err) });
    }
    input.onProgress?.(i + 1, payloads.length);
  }
  return {
    outcomes,
    successCount: outcomes.filter((o) => o.ok).length,
    failureCount: outcomes.filter((o) => !o.ok).length,
  };
}
