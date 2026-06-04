/**
 * Phase 10C / 12E — provider-usage collection + first-consumable-event trigger.
 *
 * Lets a caller collect the ACTUAL provider token usage produced anywhere inside
 * an async execution — at any depth through orchestrators and generators —
 * WITHOUT threading usage through their signatures. The aiGateway records each
 * completion's tokens into the active collection scope; AsyncLocalStorage
 * propagates that scope implicitly across awaits.
 *
 * Phase 12E adds a one-shot "first consumable event" trigger: the FIRST provider
 * completion (recordProviderUsage) or billable artifact (recordAssetCredits) in
 * the scope fires an armed callback exactly once. The entry-consumption engine
 * uses this to consume the non-refundable ENTRY at the first real consumable
 * event (first token/provider/asset) — never at mere activity launch.
 *
 * This touches NO billing/settlement/ledger logic itself; it only reports token
 * counts and a first-event signal that the (certified) engine acts on.
 */

import { AsyncLocalStorage } from 'async_hooks';

interface UsageAccumulator {
  inputTokens: number;
  outputTokens: number;
  /** Phase 10E — non-token artifact credits (e.g. rendered images) produced in scope. */
  assetCredits: number;
  /** Phase 12E — set once the first consumable event occurs in this scope. */
  firstConsumableFired: boolean;
  /** Phase 12E — armed one-shot, invoked on the first consumable event. */
  onFirstConsumable: (() => void) | null;
}

const usageStore = new AsyncLocalStorage<UsageAccumulator>();

function newAccumulator(): UsageAccumulator {
  return { inputTokens: 0, outputTokens: 0, assetCredits: 0, firstConsumableFired: false, onFirstConsumable: null };
}

/** Fire the armed one-shot exactly once, on the first consumable event. */
function fireFirstConsumable(acc: UsageAccumulator): void {
  if (acc.firstConsumableFired) return;
  acc.firstConsumableFired = true;
  const cb = acc.onFirstConsumable;
  if (cb) { try { cb(); } catch { /* trigger must never break execution */ } }
}

export interface CollectedUsage {
  inputTokens: number;
  outputTokens: number;
  /** Credits for non-token artifacts (images/assets) generated during the scope. */
  assetCredits: number;
}

/**
 * Run `fn` inside a usage-collection scope. Returns its result plus the summed
 * provider token usage recorded during it. (Used by paths that only need the
 * totals — e.g. reports. The entry-consumption engine uses createUsageScope so
 * it can also arm the first-consumable trigger and read it on the throw path.)
 */
export async function runWithUsageCollection<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; usage: CollectedUsage }> {
  const acc = newAccumulator();
  const result = await usageStore.run(acc, fn);
  return { result, usage: { inputTokens: acc.inputTokens, outputTokens: acc.outputTokens, assetCredits: acc.assetCredits } };
}

/**
 * Phase 12E — an explicit, engine-owned usage scope. The engine creates it,
 * arms the first-consumable trigger, runs the executor inside `run`, and reads
 * `usage` / `firstConsumableFired` AFTER — on both the success and the throw
 * path (the accumulator outlives the run). This is what lets entry consumption
 * move to the first real consumable event while staying abandonment-correct.
 */
export interface UsageScope {
  run<T>(fn: () => Promise<T>): Promise<T>;
  armFirstConsumable(cb: () => void): void;
  readonly usage: CollectedUsage;
  readonly firstConsumableFired: boolean;
}

export function createUsageScope(): UsageScope {
  const acc = newAccumulator();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> { return usageStore.run(acc, fn); },
    armFirstConsumable(cb: () => void): void { acc.onFirstConsumable = cb; },
    get usage(): CollectedUsage { return { inputTokens: acc.inputTokens, outputTokens: acc.outputTokens, assetCredits: acc.assetCredits }; },
    get firstConsumableFired(): boolean { return acc.firstConsumableFired; },
  };
}

/**
 * Record provider token usage into the active collection scope. No-op when no
 * scope is active (the overwhelmingly common case). Calling this AT ALL marks a
 * provider completion → fires the first-consumable trigger once.
 */
export function recordProviderUsage(inputTokens?: number | null, outputTokens?: number | null): void {
  const acc = usageStore.getStore();
  if (!acc) return;
  acc.inputTokens += Math.max(0, Number(inputTokens) || 0);
  acc.outputTokens += Math.max(0, Number(outputTokens) || 0);
  fireFirstConsumable(acc); // a provider completion is a consumable event
}

/**
 * Phase 10E — record non-token artifact CREDITS (e.g. a rendered image) into the
 * active scope. No-op when no scope is active. A billable artifact is also a
 * consumable event → fires the first-consumable trigger once.
 */
export function recordAssetCredits(credits?: number | null): void {
  const acc = usageStore.getStore();
  if (!acc) return;
  acc.assetCredits += Math.max(0, Number(credits) || 0);
  fireFirstConsumable(acc); // a billable artifact is a consumable event
}
