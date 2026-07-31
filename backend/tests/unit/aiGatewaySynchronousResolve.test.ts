/**
 * AI-ORCH 3C/3D — gateway synchronous resolve + parity-gated selection.
 * Verifies the config-source swap by rollout mode WITHOUT touching the resolver,
 * provider resolution, or rollout stages.
 */
import { resolveGatewayExecutionSelection } from '../../services/aiOrchestration/gatewaySynchronousResolve';
import { resolveExecutionAuthority } from '../../services/aiOrchestration/orchestrationMode';
import { getResolverShadowMetrics } from '../../services/aiOrchestration/resolverShadowMetrics';
import type { ResolverDeps, ResolverBindingRow, ResolverProfileVersion } from '../../services/aiOrchestration/configurationResolver';

// A minimal platform-default profile: sets ONLY temperature + max_output_tokens; leaves
// modality/reliability empty so the resolver config is UNSET on streaming/timeout/retries
// — byte-identical to a sparse legacy config (provider/model echo the legacy input via
// configurationResolver:244-245 when no providerRef/modelRef). deps loaders are the real
// ResolverDeps contract.
function minimalDeps(temperature: number, maxTokens: number): ResolverDeps {
  const version: ResolverProfileVersion = {
    profileId: 'p-min', profileKey: 'BALANCED', version: 1, mode: 'tier', qualityTier: 'balanced',
    capabilityRequirements: {},
    params: { temperature, max_output_tokens: maxTokens },
    modality: {}, reliability: {}, limits: {}, caching: {}, safety: {},
  };
  const platformDefault: ResolverBindingRow = { scope: 'platform_default', capabilityId: null, orgId: null, profileId: 'p-min', isActive: true };
  return {
    async mapOperationToCapability() { return null; },
    async loadBinding() { return null; },
    async loadPlatformDefaultBinding() { return platformDefault; },
    async loadActiveProfileVersion() { return version; },
  };
}

const baseInput = {
  companyId: null as string | null,
  operation: 'op',
  legacyProvider: 'openai',
  legacyModel: 'gpt-4o',
  temperature: 0.4,
  maxOutputTokens: 2000,
};

describe('resolveGatewayExecutionSelection — config-source swap by mode', () => {
  it('OFF → returns null (gateway keeps legacy; byte-identical)', async () => {
    const sel = await resolveGatewayExecutionSelection(baseInput, {
      authority: resolveExecutionAuthority('off'),
      depsFactory: () => minimalDeps(0.4, 2000),
    });
    expect(sel).toBeNull();
  });

  it('SHADOW → returns null (synchronous path not authoritative)', async () => {
    const sel = await resolveGatewayExecutionSelection(baseInput, {
      authority: resolveExecutionAuthority('shadow'),
      depsFactory: () => minimalDeps(0.4, 2000),
    });
    expect(sel).toBeNull();
  });

  it('DUAL → resolves synchronously, records parity, returns LEGACY (authoritative)', async () => {
    const before = getResolverShadowMetrics().dualExecutions;
    const sel = await resolveGatewayExecutionSelection(baseInput, {
      authority: resolveExecutionAuthority('dual'),
      depsFactory: () => minimalDeps(0.4, 2000),
    });
    expect(sel).not.toBeNull();
    expect(sel!.source).toBe('legacy');
    expect(sel!.provider).toBe('openai');
    expect(getResolverShadowMetrics().dualExecutions).toBe(before + 1); // synchronous parity recorded
  });

  it('FULL + enabled + parity IDENTICAL → gateway CONSUMES resolver config', async () => {
    const sel = await resolveGatewayExecutionSelection(baseInput, {
      authority: resolveExecutionAuthority('full', true), // enabled ⇒ executes=resolver
      depsFactory: () => minimalDeps(0.4, 2000),           // resolver == legacy (byte-identical)
    });
    expect(sel).not.toBeNull();
    expect(sel!.source).toBe('resolver');
    expect(sel!.provider).toBe('openai');
    expect(sel!.model).toBe('gpt-4o');
  });

  it('FULL + enabled + caller temperature=0.9 → resolver INHERITS it (3G) → parity IDENTICAL → resolver consumed', async () => {
    // Profile default is 0.4, but the caller supplied 0.9; inheritance honours 0.9 so the
    // resolver config matches legacy — the calibration's whole point.
    const sel = await resolveGatewayExecutionSelection(
      { ...baseInput, temperature: 0.9 },
      { authority: resolveExecutionAuthority('full', true), depsFactory: () => minimalDeps(0.4, 2000) },
    );
    expect(sel).not.toBeNull();
    expect(sel!.source).toBe('resolver'); // caller intent honoured ⇒ no unnecessary fallback
  });

  it('FULL + enabled but GENUINE divergence (explicit-mode different model) → legacy fallback', async () => {
    // Provider/model are NOT inheritable; an explicit-mode profile that resolves a
    // different model genuinely diverges → parity DIFFERENT → legacy fallback.
    const explicitDeps: ResolverDeps = {
      async mapOperationToCapability() { return null; },
      async loadBinding() { return null; },
      async loadPlatformDefaultBinding() { return { scope: 'platform_default', capabilityId: null, orgId: null, profileId: 'p-x', isActive: true }; },
      async loadActiveProfileVersion() {
        return {
          profileId: 'p-x', profileKey: 'EXPLICIT', version: 1, mode: 'explicit', qualityTier: 'balanced',
          providerRef: 'anthropic', modelRef: 'claude-3-5-sonnet',
          capabilityRequirements: {}, params: { temperature: 0.4, max_output_tokens: 2000 },
          modality: {}, reliability: {}, limits: {}, caching: {}, safety: {},
        } as ResolverProfileVersion;
      },
    };
    const sel = await resolveGatewayExecutionSelection(baseInput, {
      authority: resolveExecutionAuthority('full', true), depsFactory: () => explicitDeps,
    });
    expect(sel).not.toBeNull();
    expect(sel!.source).toBe('legacy'); // genuine model divergence → safe fallback
    expect(sel!.provider).toBe('openai');
  });

  it('FULL but master enable OFF → legacy (resolver not authoritative)', async () => {
    const sel = await resolveGatewayExecutionSelection(baseInput, {
      authority: resolveExecutionAuthority('full', false),
      depsFactory: () => minimalDeps(0.4, 2000),
    });
    expect(sel!.source).toBe('legacy');
  });

  it('Rollback: OFF restores legacy immediately (returns null → no swap)', async () => {
    const sel = await resolveGatewayExecutionSelection(baseInput, {
      authority: resolveExecutionAuthority('off'),
      depsFactory: () => minimalDeps(0.4, 2000),
    });
    expect(sel).toBeNull();
  });

  it('Failure: deps throw → null (legacy fallback), never throws', async () => {
    const before = getResolverShadowMetrics().failure;
    let sel: unknown = 'unset';
    await expect(
      (async () => {
        sel = await resolveGatewayExecutionSelection(baseInput, {
          authority: resolveExecutionAuthority('full', true),
          depsFactory: () => { throw new Error('deps boom'); },
        });
      })(),
    ).resolves.toBeUndefined();
    expect(sel).toBeNull();
    expect(getResolverShadowMetrics().failure).toBe(before + 1);
  });
});
