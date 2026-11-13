/**
 * Default-OFF gate for the DORMANT provider-neutral settlement foundation's scheduled jobs (e9 ruling 2026-11-13, C97
 * item 1(b)): the settlement expiry sweep and the settlement-metrics retention/prune.
 *
 * Why OFF: the foundation is SANDBOX-ONLY and moves no money, and its tables (20260714 / 18 / 19 / 20 / 21) do not exist
 * in production (C97). Running the jobs there means a lock that fails OPEN and an UNLOCKED sweep over an empty set, plus
 * wasted queries every tick. Turn this on ONLY when the foundation is activated - which requires those tables to exist via
 * a NEW migration first, and then makes payment_provider_config BLOCKING as the provider kill switch (register row).
 */
export const SETTLEMENT_FOUNDATION_ENV = 'SETTLEMENT_FOUNDATION_ENABLED';

export function isSettlementFoundationActive(): boolean {
  return process.env[SETTLEMENT_FOUNDATION_ENV] === 'true';
}
