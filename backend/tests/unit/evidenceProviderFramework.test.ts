import {
  registerAnticipatedProviders, ANTICIPATED_PROVIDERS,
  listProviders, getProvider, findByCapability, findBySupportedEvidence, findByConsumerEngine,
  isProviderAvailable, listUnavailableProviders, isDescriptorAvailable, __clearProviderRegistry,
  PROVIDER_FAILURE, ALL_PROVIDER_FAILURES, failureToEvidence, failureReasonCode, unavailableFailure,
  baseAdapterFailure, type EvidenceProviderDescriptor,
} from '../../services/evidencePlatform';

describe('External Evidence Provider Framework (BETA-ENGINE-004)', () => {
  beforeEach(() => __clearProviderRegistry());

  it('registers every anticipated provider, all UNAVAILABLE by default', () => {
    const regs = registerAnticipatedProviders();
    expect(regs.length).toBeGreaterThanOrEqual(10);
    expect(listProviders().length).toBe(regs.length);
    for (const p of listProviders()) {
      expect(p.authStatus).toBe('unauthenticated');
      expect(p.connectionStatus).toBe('disconnected');
      expect(p.failureState).toBe(PROVIDER_FAILURE.UNAVAILABLE);
      expect(isProviderAvailable(p.providerId)).toBe(false);
    }
    expect(listUnavailableProviders().length).toBe(listProviders().length);
  });

  it('supports discovery by capability, evidence, and consumer engine', () => {
    registerAnticipatedProviders();
    expect(findByCapability('backlinks').map((p) => p.providerId)).toContain('backlink.authority');
    expect(findBySupportedEvidence('domain_authority').length).toBeGreaterThan(0);
    expect(findByConsumerEngine('authority').map((p) => p.providerId)).toContain('backlink.authority');
    expect(getProvider('backlink.authority')?.priority).toBe('critical');
  });

  it('availability is deterministic and requires auth + connection + health', () => {
    const base = ANTICIPATED_PROVIDERS[0];
    expect(isDescriptorAvailable(base)).toBe(false); // unavailable default
    const wired: EvidenceProviderDescriptor = {
      ...base, authStatus: 'authenticated', connectionStatus: 'connected', health: 'healthy', failureState: null,
    };
    expect(isDescriptorAvailable(wired)).toBe(true);
    // any failure state keeps it unavailable
    expect(isDescriptorAvailable({ ...wired, failureState: PROVIDER_FAILURE.TIMEOUT })).toBe(false);
  });

  it('every failure state becomes canonical Evidence — no silent failures, no fabricated value', () => {
    for (const state of ALL_PROVIDER_FAILURES) {
      const ev = failureToEvidence({ providerId: 'backlink.authority', state, reason: `test ${state}`, evidenceKey: 'domain_authority', observedAt: '2026-01-01T00:00:00.000Z' });
      expect(ev.value).toBeNull(); // never fabricates a value
      expect(ev.maturity).toBe('UNAVAILABLE');
      expect(ev.sourceType).toBe('external_api');
      expect((ev.metadata as any).failure_state).toBe(state);
      expect((ev.metadata as any).reason_code).toBe(`PROVIDER_${state.toUpperCase()}`);
      expect(ev.provenance?.origin).toBe('provider:backlink.authority');
    }
    expect(failureReasonCode(PROVIDER_FAILURE.UNAUTHORIZED)).toBe('PROVIDER_UNAUTHORIZED');
  });

  it('failure→evidence is deterministic; adapter default wraps one failure as one evidence', () => {
    const f = unavailableFailure('search_console', 'impressions', 'not wired');
    expect(failureToEvidence(f)).toEqual(failureToEvidence(f));
    expect(baseAdapterFailure(f)).toHaveLength(1);
    expect(baseAdapterFailure(f)[0].maturity).toBe('UNAVAILABLE');
  });

  it('exposes the seven canonical failure states', () => {
    expect(ALL_PROVIDER_FAILURES.sort()).toEqual(
      ['deprecated', 'invalid_data', 'partial_response', 'quota_exceeded', 'timeout', 'unauthorized', 'unavailable'].sort(),
    );
  });
});
