/**
 * Security regression for the ad-hoc external-API test endpoint.
 *
 * BEFORE: `api_key_env_name` came straight from the request body and reached
 * `process.env[name]` unrestricted. Its value was injected into a request aimed at the
 * caller's own `base_url`, and the provider response body was returned — so any server
 * environment variable could be read back through an echo endpoint. `maskedHeaders`
 * additionally carried the raw value, because masking only handled {{PLACEHOLDER}} tokens
 * and the credential was already substituted as a literal.
 *
 * All fixtures below are fake. No network call is made.
 */
const mockSelect = jest.fn();
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({ select: (...a: unknown[]) => mockSelect(...a) }),
}));

import { buildExternalApiRequest } from '../../services/externalApi/execution';
import {
  assertTestableEnvVarName,
  canonicalDescriptorEnvNames,
} from '../../services/externalApi/testEnvAllowlist';

const FAKE_SERVER_SECRET = 'TEST_SECRET_SECURITY_FIX_ONLY';
const VICTIM_ENV = 'ZZ_FAKE_PLATFORM_SECRET';      // never registered anywhere
const REGISTERED_ENV = 'ZZ_FAKE_REGISTERED_API_KEY'; // registered on a source row
const ATTACKER = 'https://attacker.example/echo';

const adHocSource = (over: Record<string, unknown> = {}) => ({
  id: 'ad-hoc', name: 'Ad hoc', base_url: ATTACKER, purpose: 'trends',
  is_active: true, method: 'GET', auth_type: 'bearer',
  api_key_name: null, api_key_env_name: VICTIM_ENV,
  headers: {}, query_params: {}, company_id: null, ...over,
}) as any;

beforeEach(() => {
  mockSelect.mockReset();
  mockSelect.mockResolvedValue({ data: [{ api_key_env_name: REGISTERED_ENV }], error: null });
  process.env[VICTIM_ENV] = FAKE_SERVER_SECRET;
  process.env[REGISTERED_ENV] = FAKE_SERVER_SECRET;
});
afterEach(() => { delete process.env[VICTIM_ENV]; delete process.env[REGISTERED_ENV]; });

describe('S1 — an arbitrary env-var name is rejected', () => {
  it('refuses a name that is registered nowhere', async () => {
    const d = await assertTestableEnvVarName(VICTIM_ENV);
    expect(d.allowed).toBe(false);
  });

  it('refuses a secret-shaped value pasted into the NAME field', async () => {
    const d = await assertTestableEnvVarName('sk-not-a-real-key-000000');
    expect(d.allowed).toBe(false);
  });

  it('fails closed when the registry cannot be read', async () => {
    mockSelect.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await assertTestableEnvVarName(REGISTERED_ENV)).allowed).toBe(false);
  });

  it('never echoes a value in the rejection reason', async () => {
    const d = await assertTestableEnvVarName(VICTIM_ENV);
    expect(JSON.stringify(d)).not.toContain(FAKE_SERVER_SECRET);
  });
});

describe('S2 — registered env-var names still work', () => {
  it('allows a name registered on an external_api_sources row', async () => {
    const d = await assertTestableEnvVarName(REGISTERED_ENV);
    expect(d.allowed).toBe(true);
  });

  it('allows a canonical provider descriptor name', async () => {
    const canonical = [...canonicalDescriptorEnvNames()][0];
    expect(canonical).toBeDefined();
    expect((await assertTestableEnvVarName(canonical)).allowed).toBe(true);
  });

  it('allows an absent name — unauthenticated tests are unaffected', async () => {
    expect((await assertTestableEnvVarName(undefined)).allowed).toBe(true);
    expect((await assertTestableEnvVarName('')).allowed).toBe(true);
  });
});

describe('S3 — an unregistered secret can never reach a caller-controlled target', () => {
  it('the guard refuses before any request is constructed', async () => {
    const d = await assertTestableEnvVarName(VICTIM_ENV);
    expect(d.allowed).toBe(false);
    // The route returns 400 on this decision, so buildExternalApiRequest is never reached.
  });
});

describe('S5/S6 — Authorization credential is genuinely masked', () => {
  it('maskedHeaders never contains the raw value', () => {
    const { details } = buildExternalApiRequest(adHocSource(), { runtimeValues: {} });
    expect(JSON.stringify((details as any).maskedHeaders)).not.toContain(FAKE_SERVER_SECRET);
  });

  it('the real outbound header still carries the credential (function preserved)', () => {
    const { details } = buildExternalApiRequest(adHocSource(), { runtimeValues: {} });
    expect(String((details as any).headers?.Authorization ?? '')).toContain(FAKE_SERVER_SECRET);
  });
});

describe('S7 — query-parameter credential is genuinely masked', () => {
  it('maskedUrl never contains the raw value', () => {
    const { details } = buildExternalApiRequest(adHocSource({ auth_type: 'query' }), { runtimeValues: {} });
    expect(String((details as any).maskedUrl)).not.toContain(FAKE_SERVER_SECRET);
  });

  it('the real url still carries it, so connectivity testing still functions', () => {
    const { details } = buildExternalApiRequest(adHocSource({ auth_type: 'query' }), { runtimeValues: {} });
    expect(String((details as any).url)).toContain(FAKE_SERVER_SECRET);
  });
});

describe('S8 — missing or invalid configuration fails safely', () => {
  it('an unset but registered env name reports missingEnv rather than leaking', () => {
    delete process.env[REGISTERED_ENV];
    const { details, missingEnv } = buildExternalApiRequest(
      adHocSource({ api_key_env_name: REGISTERED_ENV }), { runtimeValues: {} },
    );
    expect(missingEnv).toContain(REGISTERED_ENV);
    expect(JSON.stringify(details)).not.toContain(FAKE_SERVER_SECRET);
  });

  it('auth_type none carries no credential at all', () => {
    const { details } = buildExternalApiRequest(
      adHocSource({ auth_type: 'none' }), { runtimeValues: {} },
    );
    expect(JSON.stringify(details)).not.toContain(FAKE_SERVER_SECRET);
  });
});

describe('S10 — existing behaviour preserved', () => {
  it('a source with no credential builds an unchanged request', () => {
    const { details } = buildExternalApiRequest(
      adHocSource({ auth_type: 'none', api_key_env_name: null, base_url: 'https://example.test/v1' }),
      { runtimeValues: {} },
    );
    expect(String((details as any).url)).toContain('example.test');
    expect((details as any).method).toBe('GET');
  });
});

describe('route wiring — the guard and the response boundary are actually applied', () => {
  const routeSrc = () =>
    require('fs').readFileSync('pages/api/external-apis/test.ts', 'utf8') as string;

  it('S4 — the provider body is withheld when a credential was used', () => {
    expect(routeSrc()).toContain('credentialInPlay ? CREDENTIAL_BODY_WITHHELD : parsed');
  });

  it('S4 — normalised trends are withheld on the same condition', () => {
    expect(routeSrc()).toContain('credentialInPlay ? [] : normalizedTrends');
  });

  it('the allowlist guard runs before the source is built', () => {
    const src = routeSrc();
    expect(src.indexOf('assertTestableEnvVarName')).toBeLessThan(src.indexOf("id: 'ad-hoc'"));
  });

  it('S9 — Super Admin authorization is unchanged', () => {
    expect(routeSrc()).toContain('withRBAC(handler, [Role.SUPER_ADMIN])');
  });
});
