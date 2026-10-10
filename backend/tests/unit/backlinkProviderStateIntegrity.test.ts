/**
 * BACKLINK PROVIDER STATE INTEGRITY — a key that enables nothing cannot manufacture readiness.
 *
 * THE DEFECT. `backlinkAuthorityProviderBridge` kept its own `ENV_KEYS = ['AHREFS_API_KEY',
 * 'MOZ_API_KEY', 'MAJESTIC_API_KEY']` and called the provider configured when ANY of them was
 * set. Moz and Majestic have no adapter in this repo — `providerRegistry`'s bootstrap note
 * records that their conditional registrations were removed because the files are absent, and
 * `PROVIDER_SLOTS.authority_inflow` names `AHREFS_API_KEY` alone. So `MOZ_API_KEY=anything`
 * alone was enough to publish `authStatus: 'authenticated'`, `connectionStatus: 'connected'`
 * and `health: 'healthy'` for a provider that cannot answer at all.
 *
 * What these tests pin is the DERIVATION, not a narrower literal: readiness is read from
 * `describeProviderReadiness()`, the registry's single declaration. A test that merely asserted
 * "MOZ is not in the list" would pass against a second hard-coded list that had drifted again.
 *
 * SEMANTIC BOUNDARY. This is about PROVIDER CAPABILITY, never about the company. An unsupported
 * or unconfigured provider yields UNAVAILABLE evidence with a NULL value — never a zero, and
 * never a company finding. The distinction between "provider unavailable", "provider failed",
 * "provider returned zero" and "provider returned nonzero" is unchanged by this slice.
 *
 * NO NETWORK, NO CREDENTIALS. Every key here is a synthetic placeholder and no lookup is made:
 * the unconfigured path returns before any provider call.
 */
import {
  isBacklinkProviderConfigured,
  registerBacklinkProvider,
  isBacklinkProviderAvailable,
  fetchBacklinkEvidence,
} from '../../services/backlinkAuthorityProviderBridge';
import { __clearProviderRegistry, ANTICIPATED_PROVIDERS } from '../../services/evidencePlatform';
import { describeProviderReadiness, slotEnvNames } from '../../services/intelligence/providerRegistry';

const SYNTHETIC = 'synthetic-not-a-real-credential';
const UNSUPPORTED_KEYS = ['MOZ_API_KEY', 'MAJESTIC_API_KEY'] as const;

const savedEnv = { ...process.env };

/** No backlink key of any kind present. */
const clearAllBacklinkKeys = (): void => {
  delete process.env.AHREFS_API_KEY;
  for (const k of UNSUPPORTED_KEYS) delete process.env[k];
};

afterEach(() => {
  process.env = { ...savedEnv };
  __clearProviderRegistry();
});

// ── 1. THE CAPABILITY SOURCE ────────────────────────────────────────────────

describe('backlink readiness is derived from the registry declaration', () => {
  it('the authority slot declares only prerequisites that can actually enable it', () => {
    const declared = slotEnvNames('authority_inflow');
    expect(declared).toContain('AHREFS_API_KEY');
    for (const key of UNSUPPORTED_KEYS) expect(declared).not.toContain(key);
  });

  it('the bridge reports configured only when the registry says CONFIGURED', () => {
    clearAllBacklinkKeys();
    const unconfigured = describeProviderReadiness().find((s) => s.slot === 'authority_inflow');
    expect(unconfigured?.availability).not.toBe('CONFIGURED');
    expect(isBacklinkProviderConfigured()).toBe(false);

    process.env.AHREFS_API_KEY = SYNTHETIC;
    const configured = describeProviderReadiness().find((s) => s.slot === 'authority_inflow');
    expect(configured?.availability).toBe('CONFIGURED');
    expect(isBacklinkProviderConfigured()).toBe(true);
  });

  it('missing credential is CREDENTIAL_REQUIRED — a prerequisite, not a company finding', () => {
    clearAllBacklinkKeys();
    const slot = describeProviderReadiness().find((s) => s.slot === 'authority_inflow');
    expect(slot?.availability).toBe('CREDENTIAL_REQUIRED');
    // ADAPTER_LOAD_FAILED is a DIFFERENT availability in the same vocabulary, and the bridge
    // admits only CONFIGURED — so a module that fails to load is never reported as a missing
    // credential, and never as configured either.
    expect(slot?.availability).not.toBe('ADAPTER_LOAD_FAILED');
    expect(slot?.prerequisite).toContain('AHREFS_API_KEY');
    expect(slot?.detail).toMatch(/not a finding about the company/i);
  });
});

// ── 2. FALSE-POSITIVE NEGATIVE CONTROL ──────────────────────────────────────

describe('an unimplemented provider key cannot manufacture readiness', () => {
  for (const key of UNSUPPORTED_KEYS) {
    it(`${key} alone does NOT make the provider configured/authenticated/connected/healthy`, () => {
      clearAllBacklinkKeys();
      process.env[key] = SYNTHETIC;

      expect(isBacklinkProviderConfigured()).toBe(false);

      const descriptor = registerBacklinkProvider();
      expect(descriptor.authStatus).toBe('unauthenticated');
      expect(descriptor.connectionStatus).toBe('disconnected');
      expect(descriptor.health).not.toBe('healthy');
      expect(descriptor.failureState).not.toBeNull();

      expect(isBacklinkProviderAvailable()).toBe(false);
    });
  }

  it('both unimplemented keys together still make nothing available', () => {
    clearAllBacklinkKeys();
    for (const k of UNSUPPORTED_KEYS) process.env[k] = SYNTHETIC;
    expect(isBacklinkProviderConfigured()).toBe(false);
    expect(isBacklinkProviderAvailable()).toBe(false);
    expect(registerBacklinkProvider().health).not.toBe('healthy');
  });

  it('an unsupported key yields UNAVAILABLE evidence with a NULL value — never a zero', async () => {
    clearAllBacklinkKeys();
    process.env.MOZ_API_KEY = SYNTHETIC;
    const evidence = await fetchBacklinkEvidence('northwind.test', '2026-01-01T00:00:00.000Z');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].maturity).toBe('UNAVAILABLE');
    expect(evidence[0].value).toBeNull();
    // The whole point: unsupported capability is not a measurement of zero backlinks.
    expect(evidence[0].value).not.toBe(0);
  });
});

// ── 3. OPERATOR MESSAGING ───────────────────────────────────────────────────

describe('operator guidance names only prerequisites that work', () => {
  it('does not tell the operator to set keys for unimplemented providers', async () => {
    clearAllBacklinkKeys();
    const evidence = await fetchBacklinkEvidence('northwind.test', '2026-01-01T00:00:00.000Z');
    const reason = String((evidence[0].metadata as Record<string, unknown>).reason ?? '');

    expect(reason.length).toBeGreaterThan(0);
    for (const key of UNSUPPORTED_KEYS) expect(reason).not.toContain(key);
    // It must still name the one prerequisite that does work, or it is useless guidance.
    expect(reason).toContain('AHREFS_API_KEY');
  });
});

// ── 3b. OPERATOR-FACING ACTIVATION SURFACE ──────────────────────────────────

describe('the activation surface does not advertise unimplemented prerequisites', () => {
  it('the backlink descriptor lists only prerequisites that can actually enable it', () => {
    const descriptor = ANTICIPATED_PROVIDERS.find((p) => p.providerId === 'backlink.authority');
    expect(descriptor).toBeDefined();
    // `providerActivationMatrix` prints these verbatim as "set credentials: ...", so an
    // unimplemented key here IS false operator guidance, wherever it is declared.
    expect(descriptor?.envKeys).toEqual(['AHREFS_API_KEY']);
    for (const key of UNSUPPORTED_KEYS) expect(descriptor?.envKeys ?? []).not.toContain(key);
    // The display name must not advertise providers that do not exist either.
    expect(descriptor?.providerName ?? '').not.toMatch(/moz|majestic/i);
  });
});

// ── 4. AHREFS POSITIVE CONTROL — the real provider still works ──────────────

describe('the genuinely supported provider is unaffected', () => {
  it('AHREFS_API_KEY still produces a configured/authenticated/connected provider', () => {
    clearAllBacklinkKeys();
    process.env.AHREFS_API_KEY = SYNTHETIC;

    expect(isBacklinkProviderConfigured()).toBe(true);
    const descriptor = registerBacklinkProvider();
    expect(descriptor.authStatus).toBe('authenticated');
    expect(descriptor.connectionStatus).toBe('connected');
    expect(descriptor.failureState).toBeNull();
    expect(isBacklinkProviderAvailable()).toBe(true);
  });

  it('an unsupported key present ALONGSIDE Ahrefs does not suppress the real provider', () => {
    // Guards against "fixing" this by inverting the logic: the supported key is what decides.
    clearAllBacklinkKeys();
    process.env.AHREFS_API_KEY = SYNTHETIC;
    for (const k of UNSUPPORTED_KEYS) process.env[k] = SYNTHETIC;
    expect(isBacklinkProviderConfigured()).toBe(true);
    expect(isBacklinkProviderAvailable()).toBe(true);
  });

  it('absence of the Ahrefs credential is UNAVAILABLE, distinct from a provider failure', async () => {
    clearAllBacklinkKeys();
    const evidence = await fetchBacklinkEvidence('northwind.test', '2026-01-01T00:00:00.000Z');
    const metadata = evidence[0].metadata as Record<string, unknown>;
    // The unconfigured state is UNAVAILABLE, not an unauthorized/invalid-data failure.
    expect(metadata.failure_state).toBe('unavailable');
    expect(evidence[0].value).toBeNull();
  });
});
