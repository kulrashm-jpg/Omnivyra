/**
 * A3T — Clearbit is declared, and declaring it activates nothing.
 *
 * The risk this file exists to pin is a specific one: a provider appearing in
 * the Lead Sources list reads, to an operator, like a provider that works. For
 * Clearbit that gap is unusually easy to fall into, because a real WS-4
 * adapter for it already exists — with a live endpoint, an auth scheme and a
 * response mapping — and it would be easy to assume PI can simply use it. PI
 * cannot: that adapter implements a different interface, speaks a different
 * field vocabulary, and reads its credential from the environment.
 *
 * So these tests assert the three separations independently:
 *   declared   ≠ configurable-into-operational
 *   configured ≠ operational
 *   WS-4 contract is NOT the PI adapter (A3U built the second; the first is untouched)
 *
 * SECRETS: every value here is synthetic. No real credential is used.
 */

import {
  ACQUISITION_SOURCES, getSource, resolveConnectionState, listSourceStatus, USABLE_STATES,
} from '../../services/enrichment/providers/sources';
import { getProvider } from '../../services/enrichment/providers/registry';
import {
  validateProviderForCredentialStorage,
  readProviderCredentialStatus,
  authModeFor,
  isCredentialRefusal,
  type ProviderCredentialStatus,
} from '../../apiHandlers/prospects/leadSourceCredentials';
import { makeTenantCredentialPort, PROVIDER_API_KEY } from '../../services/enrichment/providers/credentials';
import { executeEnrichment, type ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import { clearbitProvider } from '../../services/companyIntelligence/providers/adapters';
import { clearbitEnrichmentAdapter } from '../../services/enrichment/providers/adapters/clearbit';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
/** Synthetic. Not a credential for anything that exists. */
const SECRET_A = 'synthetic-tenant-a-clearbit-key';
const SECRET_B = 'synthetic-tenant-b-clearbit-key';

describe('A3T — one canonical identity across every layer', () => {
  it('A3C declares the source as `clearbit`', () => {
    const source = getSource('clearbit');
    expect(source).not.toBeNull();
    expect(source?.id).toBe('clearbit');
    expect(source?.sourceType).toBe('external_api');
  });

  it('the pre-existing WS-4 adapter uses the SAME id, so nothing has to be renamed', () => {
    expect(clearbitProvider.id).toBe('clearbit');
  });

  it('A3P accepts that id and reports it as an API-key provider', () => {
    const v = validateProviderForCredentialStorage('clearbit');
    expect(isCredentialRefusal(v)).toBe(false);
    expect(authModeFor('external_api')).toBe('api_key');
  });

  it('the id is unique in the registry', () => {
    expect(ACQUISITION_SOURCES.filter((s) => s.id === 'clearbit')).toHaveLength(1);
  });
});

describe('A3T — declared is not operational', () => {
  it('no PI adapter is registered for clearbit', () => {
    expect(getProvider('clearbit')).toBeNull();
  });

  it('its connection state is `unsupported`, whatever the environment says', () => {
    const source = getSource('clearbit')!;
    // credentialPresent deliberately TRUE: the absence of an adapter must be
    // what decides, not the presence of a key.
    const withKey = resolveConnectionState(source, false, true);
    expect(withKey.state).toBe('unsupported');
    expect(withKey.reason).toMatch(/no adapter/i);
  });

  it('it is never `usable`', () => {
    const status = listSourceStatus(() => false, () => true).find((s) => s.id === 'clearbit');
    expect(status?.usable).toBe(false);
    expect(USABLE_STATES).toEqual(['connected']);
  });

  // A3U built the adapter, so the capability claim is now backed by one. It is
  // asserted against the ADAPTER rather than against a literal list, so the two
  // cannot drift apart.
  it('it claims only the capabilities its adapter can actually emit', () => {
    const source = getSource('clearbit')!;
    expect(source.capabilities.entities).toEqual(['account']);
    expect([...source.capabilities.attributes].sort())
      .toEqual([...clearbitEnrichmentAdapter.supports].sort());
  });

  it('it has no credit action, so it is unpriced by declaration', () => {
    expect(getSource('clearbit')!.creditAction).toBeNull();
  });

  // A3U satisfied `adapter`, and it was removed rather than left saying
  // something untrue. `credit_action` is what still refuses.
  it('its outstanding requirements name the credit action, and no longer the adapter', () => {
    const reqs = getSource('clearbit')!.authorizationRequirements;
    expect(reqs).toContain('credit_action');
    expect(reqs).not.toContain('adapter');
  });

  it('the descriptor note never claims connected, ready, operational or enriched', () => {
    const note = `${getSource('clearbit')!.note}`.toLowerCase();
    for (const word of ['operational', 'connected', 'ready', 'enriched']) {
      expect(note).not.toContain(word);
    }
  });
});

describe('A3T — A3P discovers it from the registry, with no hard-coded list', () => {
  const read = async () => ({});

  /**
   * Narrow the API's union, failing the test rather than casting past it. A
   * structural cast would not compile here anyway — `CredentialRefusal` and a
   * status array do not overlap — and asserting the refusal case is absent is
   * the stronger statement.
   */
  const statuses = (
    result: Awaited<ReturnType<typeof readProviderCredentialStatus>>,
  ): readonly ProviderCredentialStatus[] => {
    if (isCredentialRefusal(result)) throw new Error(`unexpected refusal: ${result.reason}`);
    return result;
  };

  it('the credential API lists clearbit purely because A3C declares it', async () => {
    const result = await readProviderCredentialStatus({ companyId: ORG_A }, { read });
    expect(isCredentialRefusal(result)).toBe(false);
    const ids = statuses(result).map((p) => p.providerId);
    expect(ids).toContain('clearbit');
    // and the list is exactly the registry's storable sources, in registry order
    const expected = ACQUISITION_SOURCES
      .filter((s) => s.sourceType === 'external_api' || s.sourceType === 'gateway_api')
      .map((s) => s.id);
    expect(ids).toEqual(expected);
  });

  it('it is reported not configured and NOT operational, with the reason', async () => {
    const [status] = statuses(await readProviderCredentialStatus(
      { companyId: ORG_A, providerId: 'clearbit' }, { read },
    ));
    expect(status.configured).toBe(false);
    expect(status.operational).toBe(false);
    // A3U satisfied the adapter requirement; economics is what still refuses.
    expect(status.operationalReason).toMatch(/credit_action/);
  });

  it('configuring a credential still does NOT make it operational', async () => {
    const [status] = statuses(await readProviderCredentialStatus(
      { companyId: ORG_A, providerId: 'clearbit' },
      { read: async () => ({ api_key: SECRET_A }) },
    ));
    expect(status.configured).toBe(true);
    expect(status.operational).toBe(false);
    expect(status.credentialFields.api_key).toBe('********');
    expect(JSON.stringify(status)).not.toContain(SECRET_A);
  });
});

describe('A3T — the tenant credential path is per-tenant, with no env fallback', () => {
  const store: Record<string, Record<string, string>> = {
    [`${ORG_A}::clearbit`]: { [PROVIDER_API_KEY]: SECRET_A },
    [`${ORG_B}::clearbit`]: { [PROVIDER_API_KEY]: SECRET_B },
  };
  const port = makeTenantCredentialPort({
    read: async (company, provider) => ({ ...(store[`${company}::${provider}`] ?? {}) }),
  });

  afterEach(() => { delete process.env.CLEARBIT_API_KEY; });

  it('each tenant resolves its own Clearbit credential', async () => {
    await expect(port.resolveCredential({ organizationId: ORG_A, providerId: 'clearbit' })).resolves.toBe(SECRET_A);
    await expect(port.resolveCredential({ organizationId: ORG_B, providerId: 'clearbit' })).resolves.toBe(SECRET_B);
  });

  it('a tenant with none gets null even when CLEARBIT_API_KEY is set globally', async () => {
    process.env.CLEARBIT_API_KEY = 'synthetic-global-key-that-must-never-be-used';
    const other = '00000000-0000-4000-8000-0000000000cc';
    await expect(port.resolveCredential({ organizationId: other, providerId: 'clearbit' })).resolves.toBeNull();
  });

  it('the credential key A3P writes is the key the resolver reads', () => {
    expect(PROVIDER_API_KEY).toBe('api_key');
  });
});

describe('A3T — an unregistered, unpriced Clearbit cannot make a call', () => {
  const request = {
    organizationId: ORG_A, subject: 'account' as const, entityId: 'account-1',
    attributes: ['employee_count'], selectors: { domain: 'example.com' },
    purpose: 'icp', correlationId: 'corr-a3t',
  };

  const ports = (over: Partial<ExecuteEnrichmentPorts> = {}): ExecuteEnrichmentPorts => ({
    authorizeCost: over.authorizeCost ?? (async () => ({ authorized: false, reason: 'no credit action registered' })),
    releaseCost: async () => { /* noop */ },
    resolveCredential: over.resolveCredential ?? (async () => SECRET_A),
    findRecentObservation: async () => null,
    persistObservation: async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] }),
    now: () => '2026-09-05T00:00:00.000Z',
  });

  it('with no adapter registered it answers not_implemented and calls nobody', async () => {
    const result = await executeEnrichment(request, 'clearbit', ports());
    expect(result.outcome).toBe('not_implemented');
    expect(result.providerCalled).toBe(false);
  });

  it('the WS-4 adapter is NOT reachable through the PI registry', () => {
    // It exists, and it is a different interface on a different spine. PI must
    // not be able to pick it up by name.
    expect(getProvider('clearbit')).toBeNull();
    expect(typeof (clearbitProvider as unknown as { enrich?: unknown }).enrich).toBe('undefined');
    expect(typeof clearbitProvider.fetch).toBe('function');
  });

  it('even given an adapter, an unpriced action still refuses before egress', async () => {
    const calls: unknown[] = [];
    const adapter = {
      id: 'clearbit', label: 'Clearbit', supports: ['employee_count'], credentialEnvVar: 'CLEARBIT_API_KEY',
      isAvailable: () => true,
      enrich: async (r: unknown) => { calls.push(r); return { outcome: 'enriched' as const, fields: [], notReturned: [] }; },
    } as never;

    const result = await executeEnrichment(request, 'clearbit', ports(), { adapter });
    expect(result.outcome).toBe('cost_denied');
    expect(result.providerCalled).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
