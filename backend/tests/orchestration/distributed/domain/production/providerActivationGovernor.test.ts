/**
 * Phase 27B.4 — provider activation governor tests.
 */

import {
  ProviderActivationGovernor,
} from '../../../../../services/orchestration/distributed/domain/production/providerActivationGovernor';

describe('ProviderActivationGovernor', () => {
  test('empty allowlist refuses everything', () => {
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const gov = new ProviderActivationGovernor({
      allowedProviders: [],
      allowedDomains: [],
      rolloutStage: 'full_runtime_live',
      telemetry: { emit: (event, payload) => events.push({ event, payload }) },
    });

    const verdict = gov.evaluateProvider('x');
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/ALLOWED_RUNTIME_PROVIDERS/);
  });

  test('reddit is hard-blocked even when on allowlist', () => {
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const gov = new ProviderActivationGovernor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      allowedProviders: ['reddit', 'x'] as any,
      allowedDomains: ['social_publish'],
      rolloutStage: 'full_runtime_live',
      telemetry: { emit: (event, payload) => events.push({ event, payload }) },
    });

    const reddit = gov.evaluateProvider('reddit');
    expect(reddit.allowed).toBe(false);
    expect(reddit.hardBlocked).toBe(true);
    expect(events.some((e) => e.event === 'provider_activation_hard_blocked')).toBe(true);

    // x still passes — only reddit is hard-blocked.
    const x = gov.evaluateProvider('x');
    expect(x.allowed).toBe(true);
  });

  test('unknown provider refused', () => {
    const gov = new ProviderActivationGovernor({
      allowedProviders: ['x'],
      allowedDomains: ['social_publish'],
      rolloutStage: 'full_runtime_live',
      telemetry: { emit: () => {} },
    });
    const verdict = gov.evaluateProvider('mastodon');
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/not a known/);
  });

  test('publish_disabled stage refuses provider activation', () => {
    const gov = new ProviderActivationGovernor({
      allowedProviders: ['x'],
      allowedDomains: ['social_publish'],
      rolloutStage: 'publish_disabled',
      telemetry: { emit: () => {} },
    });
    const verdict = gov.evaluateProvider('x');
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/forbids/);
  });

  test('domain allowlist enforced', () => {
    const gov = new ProviderActivationGovernor({
      allowedProviders: ['x'],
      allowedDomains: ['social_publish'],
      rolloutStage: 'full_runtime_live',
      telemetry: { emit: () => {} },
    });
    expect(gov.evaluateDomain('social_publish').allowed).toBe(true);
    expect(gov.evaluateDomain('long_form_generation').allowed).toBe(false);
    expect(gov.evaluateDomain('garbage').allowed).toBe(false);
  });

  test('filterAdapterMap drops refused providers without mutation', () => {
    const gov = new ProviderActivationGovernor({
      allowedProviders: ['x', 'linkedin'],
      allowedDomains: ['social_publish'],
      rolloutStage: 'full_runtime_live',
      telemetry: { emit: () => {} },
    });
    const adapters = {
      x: () => {},
      linkedin: () => {},
      reddit: () => {},
      mastodon: () => {},
    };
    const { allowed, refused } = gov.filterAdapterMap(adapters);
    expect(Object.keys(allowed).sort()).toEqual(['linkedin', 'x']);
    const refusedProviders = refused.map((r) => r.provider).sort();
    expect(refusedProviders).toEqual(['mastodon', 'reddit']);
    const reddit = refused.find((r) => r.provider === 'reddit');
    expect(reddit?.hardBlocked).toBe(true);
    // Original map intact.
    expect(Object.keys(adapters).sort()).toEqual(['linkedin', 'mastodon', 'reddit', 'x']);
  });

  test('snapshot exposes config', () => {
    const gov = new ProviderActivationGovernor({
      allowedProviders: ['x', 'linkedin'],
      allowedDomains: ['social_publish'],
      rolloutStage: 'single_provider_live',
      telemetry: { emit: () => {} },
    });
    const snap = gov.snapshot();
    expect(snap.allowedProviders).toContain('x');
    expect(snap.allowedDomains).toContain('social_publish');
    expect(snap.rolloutStage).toBe('single_provider_live');
    expect(snap.hardBlockedProviders).toContain('reddit');
  });
});
