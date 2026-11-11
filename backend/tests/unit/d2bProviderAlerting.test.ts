/**
 * D2b (virality-e9): since a refresh timeout keeps an account "connected" (D2 option B),
 * a provider that keeps failing must alert someone.
 *  - a provider that fails EVERY post for N consecutive cycles (N = 3, configurable) is
 *    reported FAILING at console.error, even when the cycle overall is only degraded;
 *  - a comment fetch that timed out is the distinct failure kind 'timeout';
 *  - after a refresh TIMEOUT the account's refresh is backed off (default 30 min).
 */
import {
  updateProviderStreaks, providerFailingCycles, DEFAULT_PROVIDER_FAILING_CYCLES,
  summarizeIngestionCycle, ingestionCycleLogPayload, type IngestOutcome,
} from '../../services/engagement/ingestionHealth';

const ok = (platform: string): IngestOutcome => ({ platform, success: true });
const fail = (platform: string, failure: any = 'timeout'): IngestOutcome => ({ platform, success: false, failure });

describe('per-provider failing streaks (updateProviderStreaks)', () => {
  it('a provider failing every post for 3 consecutive cycles is reported at the 3rd, while another provider succeeds', () => {
    const streaks = new Map<string, number>();
    const cycle = [fail('linkedin'), fail('linkedin', 'provider'), ok('x')];
    expect(updateProviderStreaks(streaks, cycle, 3)).toEqual([]);
    expect(updateProviderStreaks(streaks, cycle, 3)).toEqual([]);
    expect(updateProviderStreaks(streaks, cycle, 3)).toEqual([
      { provider: 'linkedin', consecutiveCycles: 3, attempted: 2, byFailureKind: { timeout: 1, provider: 1 } }]);
    // The cycle as a whole is only "degraded" - the case the old summary never escalated.
    expect(summarizeIngestionCycle(cycle, 0).health).toBe('degraded');
  });

  it('one success in a cycle resets the streak', () => {
    const streaks = new Map<string, number>();
    updateProviderStreaks(streaks, [fail('facebook')], 3);
    updateProviderStreaks(streaks, [fail('facebook')], 3);
    updateProviderStreaks(streaks, [fail('facebook'), ok('facebook')], 3);
    expect(updateProviderStreaks(streaks, [fail('facebook')], 3)).toEqual([]);
    expect(streaks.get('facebook')).toBe(1);
  });

  it('a cycle in which the provider had no posts leaves its streak unchanged (no evidence either way)', () => {
    const streaks = new Map<string, number>();
    updateProviderStreaks(streaks, [fail('youtube')], 2);
    updateProviderStreaks(streaks, [ok('x')], 2); // youtube idle
    expect(updateProviderStreaks(streaks, [fail('youtube')], 2)).toEqual([
      { provider: 'youtube', consecutiveCycles: 2, attempted: 1, byFailureKind: { timeout: 1 } }]);
  });

  it('keeps reporting every cycle while it keeps failing', () => {
    const streaks = new Map<string, number>([['x', 5]]);
    expect(updateProviderStreaks(streaks, [fail('x')], 3)[0].consecutiveCycles).toBe(6);
  });

  it('N defaults to 3; INGEST_PROVIDER_FAILING_CYCLES overrides it; non-positive or invalid falls back', () => {
    expect(DEFAULT_PROVIDER_FAILING_CYCLES).toBe(3);
    expect(providerFailingCycles({})).toBe(3);
    expect(providerFailingCycles({ INGEST_PROVIDER_FAILING_CYCLES: '5' })).toBe(5);
    expect(providerFailingCycles({ INGEST_PROVIDER_FAILING_CYCLES: '0' })).toBe(3);
    expect(providerFailingCycles({ INGEST_PROVIDER_FAILING_CYCLES: 'x' })).toBe(3);
  });

  it('the log payload carries failing providers with counts and typed reasons only', () => {
    const s = summarizeIngestionCycle([fail('linkedin')], 0);
    s.failingProviders = [{ provider: 'linkedin', consecutiveCycles: 3, attempted: 1, byFailureKind: { timeout: 1 } }];
    expect(ingestionCycleLogPayload(s).failing_providers).toEqual([
      { provider: 'linkedin', consecutive_cycles: 3, attempted: 1, by_failure_kind: { timeout: 1 } }]);
    expect(ingestionCycleLogPayload(summarizeIngestionCycle([], 0)).failing_providers).toEqual([]);
  });
});
