/**
 * Phase 10C — provider-usage collection (generation-layer telemetry only).
 *
 * Lets a caller (e.g. a queue processor) collect the ACTUAL provider token usage
 * produced anywhere inside an async execution — at any depth through
 * orchestrators and generators — WITHOUT threading usage through their
 * signatures. The aiGateway records each completion's tokens into the active
 * collection scope; AsyncLocalStorage propagates that scope implicitly across
 * awaits, so no orchestrator/generator changes are needed.
 *
 * This touches NO billing/settlement/ledger/accounting logic. It only reads
 * token counts the gateway already computes and hands them back to the caller,
 * which then supplies them to the (already-certified) entry-consumption engine
 * via collectActualUsage().
 */

import { AsyncLocalStorage } from 'async_hooks';

interface UsageAccumulator {
  inputTokens: number;
  outputTokens: number;
  /** Phase 10E — non-token artifact credits (e.g. rendered images) produced in scope. */
  assetCredits: number;
}

const usageStore = new AsyncLocalStorage<UsageAccumulator>();

export interface CollectedUsage {
  inputTokens: number;
  outputTokens: number;
  /** Credits for non-token artifacts (images/assets) generated during the scope. */
  assetCredits: number;
}

/**
 * Run `fn` inside a usage-collection scope. Returns its result plus the summed
 * provider token usage recorded during it. Scopes nest safely (the innermost
 * active scope receives recorded usage); a fresh scope starts at zero.
 */
export async function runWithUsageCollection<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; usage: CollectedUsage }> {
  const acc: UsageAccumulator = { inputTokens: 0, outputTokens: 0, assetCredits: 0 };
  const result = await usageStore.run(acc, fn);
  return { result, usage: { inputTokens: acc.inputTokens, outputTokens: acc.outputTokens, assetCredits: acc.assetCredits } };
}

/**
 * Record provider token usage into the active collection scope. No-op when no
 * scope is active (the overwhelmingly common case), so it is safe to call from
 * the gateway on every completion.
 */
export function recordProviderUsage(inputTokens?: number | null, outputTokens?: number | null): void {
  const acc = usageStore.getStore();
  if (!acc) return;
  acc.inputTokens += Math.max(0, Number(inputTokens) || 0);
  acc.outputTokens += Math.max(0, Number(outputTokens) || 0);
}

/**
 * Phase 10E — record non-token artifact CREDITS (e.g. a rendered image) into the
 * active scope, so they reach the creator-content settlement alongside text
 * tokens. No-op when no scope is active. Reuses the same propagation pattern as
 * recordProviderUsage — no new accounting path, no settlement primitive.
 */
export function recordAssetCredits(credits?: number | null): void {
  const acc = usageStore.getStore();
  if (!acc) return;
  acc.assetCredits += Math.max(0, Number(credits) || 0);
}
