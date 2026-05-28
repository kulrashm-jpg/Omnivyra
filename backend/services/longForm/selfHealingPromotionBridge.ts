/**
 * selfHealingPromotionBridge.ts
 *
 * Phase 8.8 — Tiny adapter so the self-healing coordinator can freeze
 * the enforcement promotion engine without a circular import.
 *
 * The enforcement rollback guard already exposes a promotion-freeze
 * mechanism (via its in-process state); we re-expose it under a stable
 * name self-healing can call.
 */

let externalFreezeFn: ((freezeUntilISO: string, reason: string) => void) | null = null;

export function registerExternalPromotionFreezer(fn: (freezeUntilISO: string, reason: string) => void): void {
  externalFreezeFn = fn;
}

export function freezePromotionFromSelfHealing(freezeUntilISO: string, reason: string): void {
  if (externalFreezeFn) {
    externalFreezeFn(freezeUntilISO, reason);
    return;
  }
  console.warn(`[longform-self-healing] freeze_promotion requested but no external freezer registered. reason=${reason}`);
}
