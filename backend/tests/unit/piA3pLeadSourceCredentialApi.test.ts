/**
 * A3P — the Company Admin credential control plane.
 *
 * Two properties matter here and everything else is detail:
 *
 *   1. a secret goes IN and never comes back — not in a success body, not in
 *      an error body, not in a log line;
 *   2. one tenant's request can never touch another tenant's credential, in
 *      any of the three verbs.
 *
 * The route tests drive the real handler with a faked authorizer, so the
 * authorization CALL is asserted (companyId + requireManage) rather than the
 * authorizer's internals, which have their own tests. The service tests drive
 * the handler module against an in-memory store keyed the way the real table
 * is keyed — (company_id, provider_key, credential_key) — because a fake keyed
 * any other way could not fail the isolation tests.
 *
 * SECRETS: every value below is synthetic and invented for this file. No real
 * provider credential is used, referenced or reproduced.
 */

// ── the in-memory store, keyed exactly like the real table ─────────────────
const store = new Map<string, Record<string, string>>();
const key = (company: string, provider: string) => `${company}::${provider}`;

const fakePorts = {
  write: async (company: string, provider: string, creds: Record<string, string>) => {
    if (!company?.trim() || !provider?.trim()) throw new Error('scope required');
    store.set(key(company, provider), { ...(store.get(key(company, provider)) ?? {}), ...creds });
  },
  read: async (company: string, provider: string) => {
    if (!company?.trim() || !provider?.trim()) throw new Error('scope required');
    return { ...(store.get(key(company, provider)) ?? {}) };
  },
  remove: async (company: string, provider: string) => {
    store.delete(key(company, provider));
  },
};

// ── route-level authorization fake ─────────────────────────────────────────
let authOutcome: 'ok' | 'unauthenticated' | 'forbidden' = 'ok';
const authCalls: { companyId?: string; requireManage?: boolean }[] = [];

jest.mock('../../apiHandlers/externalApis/indexShared', () => ({
  requireExternalApiAccess: jest.fn(async (
    _req: unknown,
    res: { status: (c: number) => { json: (b: unknown) => unknown } },
    companyId?: string,
    requireManage?: boolean,
  ) => {
    authCalls.push({ companyId, requireManage });
    if (!companyId) { res.status(400).json({ error: 'companyId required' }); return null; }
    if (authOutcome === 'unauthenticated') { res.status(401).json({ error: 'UNAUTHORIZED' }); return null; }
    if (authOutcome === 'forbidden') { res.status(403).json({ error: 'FORBIDDEN_ROLE' }); return null; }
    return { userId: 'user-1', role: 'COMPANY_ADMIN' };
  }),
}));

// The route uses the REAL handler module, which uses the REAL credential
// service — so the service is faked at its own boundary, one level down.
jest.mock('../../services/integrationCredentialService', () => {
  const actual = jest.requireActual('../../services/integrationCredentialService');
  return {
    ...actual,
    upsertProviderCredentials: (...a: [string, string, Record<string, string>]) => fakePorts.write(...a),
    getProviderCredentials: (...a: [string, string]) => fakePorts.read(...a),
    deleteProviderCredentials: (...a: [string, string]) => fakePorts.remove(...a),
  };
});

import {
  configureProviderCredential,
  readProviderCredentialStatus,
  revokeProviderCredential,
  validateProviderForCredentialStorage,
  validateCredentialPayload,
  authModeFor,
  ACCEPTED_CREDENTIAL_FIELDS,
  STORED_CREDENTIAL_SOURCE_TYPES,
} from '../../apiHandlers/prospects/leadSourceCredentials';
import { SECRET_CONFIG_KEYS } from '../../services/integrationCredentialService';
import { makeTenantCredentialPort } from '../../services/enrichment/providers/credentials';
import { executeEnrichment, type ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type { EnrichmentProviderAdapter } from '../../services/enrichment/providers/contract';
import handler from '../../../pages/api/prospect-sources/credentials';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';

/** Synthetic. Not a credential for anything that exists. */
const SECRET_A = 'synthetic-tenant-a-apollo-key';
const SECRET_B = 'synthetic-tenant-b-apollo-key';
const SECRET_A2 = 'synthetic-tenant-a-rotated-key';

const deps = fakePorts;

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; return res; };
  return res;
}

async function call(method: string, query: Record<string, unknown>, body?: unknown) {
  const res = mockRes();
  await handler({
    method, url: '/api/prospect-sources/credentials', headers: {}, query, body,
  } as never, res);
  return res;
}

let logSpy: jest.SpyInstance;
beforeEach(() => {
  store.clear();
  authCalls.length = 0;
  authOutcome = 'ok';
  logSpy = jest.spyOn(console, 'error').mockImplementation(() => { /* captured */ });
});
afterEach(() => { logSpy.mockRestore(); });

// ───────────────────────────────────────────────────────────────────────────
describe('A3P — authorization', () => {
  it('an authorized Company Admin can configure', async () => {
    const res = await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    expect(res.statusCode).toBe(200);
    expect(res.body.provider.configured).toBe(true);
  });

  it('an unauthenticated caller is rejected with 401 and stores nothing', async () => {
    authOutcome = 'unauthenticated';
    const res = await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    expect(res.statusCode).toBe(401);
    expect(store.size).toBe(0);
  });

  it('an authenticated caller without the role is rejected with 403 and stores nothing', async () => {
    authOutcome = 'forbidden';
    const res = await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    expect(res.statusCode).toBe(403);
    expect(store.size).toBe(0);
  });

  it('a missing companyId is refused before the body is touched', async () => {
    const res = await call('PUT', {}, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    expect(res.statusCode).toBe(400);
    expect(store.size).toBe(0);
  });

  it('every verb demands the MANAGE grant, reads included', async () => {
    await call('GET', { companyId: ORG_A });
    await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    await call('DELETE', { companyId: ORG_A, provider: 'apollo' });
    expect(authCalls).toHaveLength(3);
    expect(authCalls.every((c) => c.requireManage === true)).toBe(true);
    expect(authCalls.every((c) => c.companyId === ORG_A)).toBe(true);
  });

  it('rejects unsupported methods without reaching the store', async () => {
    const res = await call('POST', { companyId: ORG_A }, { provider: 'apollo' });
    expect(res.statusCode).toBe(405);
    expect(authCalls).toHaveLength(0);
  });

  it('the tenant used is the VERIFIED query id — a body company_id is ignored', async () => {
    await call('PUT', { companyId: ORG_A }, {
      provider: 'apollo', company_id: ORG_B, companyId: ORG_B, credentials: { api_key: SECRET_A },
    });
    expect(store.has(key(ORG_A, 'apollo'))).toBe(true);
    expect(store.has(key(ORG_B, 'apollo'))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3P — tenant isolation', () => {
  beforeEach(async () => {
    await configureProviderCredential({ companyId: ORG_A, providerId: 'apollo', credentials: { api_key: SECRET_A } }, deps);
    await configureProviderCredential({ companyId: ORG_B, providerId: 'apollo', credentials: { api_key: SECRET_B } }, deps);
  });

  it('each tenant configures its own credential for the same provider', () => {
    expect(store.get(key(ORG_A, 'apollo'))).toEqual({ api_key: SECRET_A });
    expect(store.get(key(ORG_B, 'apollo'))).toEqual({ api_key: SECRET_B });
  });

  it('A reading returns A’s status and nothing of B’s', async () => {
    const r = await readProviderCredentialStatus({ companyId: ORG_A, providerId: 'apollo' }, deps);
    expect(JSON.stringify(r)).not.toContain(SECRET_B);
    expect(JSON.stringify(r)).not.toContain(SECRET_A);
  });

  it('A deleting does not delete B', async () => {
    await revokeProviderCredential({ companyId: ORG_A, providerId: 'apollo' }, deps);
    expect(store.has(key(ORG_A, 'apollo'))).toBe(false);
    expect(store.get(key(ORG_B, 'apollo'))).toEqual({ api_key: SECRET_B });
  });

  it('A overwriting does not overwrite B', async () => {
    await configureProviderCredential({ companyId: ORG_A, providerId: 'apollo', credentials: { api_key: SECRET_A2 } }, deps);
    expect(store.get(key(ORG_A, 'apollo'))).toEqual({ api_key: SECRET_A2 });
    expect(store.get(key(ORG_B, 'apollo'))).toEqual({ api_key: SECRET_B });
  });

  it('B’s later configuration leaves A’s credential resolvable and unchanged', async () => {
    await configureProviderCredential({ companyId: ORG_B, providerId: 'apollo', credentials: { api_key: 'synthetic-b-again' } }, deps);
    const port = makeTenantCredentialPort({ read: deps.read });
    await expect(port.resolveCredential({ organizationId: ORG_A, providerId: 'apollo' })).resolves.toBe(SECRET_A);
  });

  it('through the ROUTE, tenant A cannot read, delete or overwrite tenant B', async () => {
    const read = await call('GET', { companyId: ORG_A, provider: 'apollo' });
    expect(JSON.stringify(read.body)).not.toContain(SECRET_B);

    await call('DELETE', { companyId: ORG_A, provider: 'apollo' });
    expect(store.get(key(ORG_B, 'apollo'))).toEqual({ api_key: SECRET_B });

    await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A2 } });
    expect(store.get(key(ORG_B, 'apollo'))).toEqual({ api_key: SECRET_B });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3P — a secret goes in and never comes back', () => {
  it('the configure response carries no plaintext, only a mask', async () => {
    const res = await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET_A);
    expect(res.body.provider.credentialFields.api_key).toBe('********');
  });

  it('the read response carries no plaintext', async () => {
    await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    const res = await call('GET', { companyId: ORG_A, provider: 'apollo' });
    expect(JSON.stringify(res.body)).not.toContain(SECRET_A);
    expect(res.body.providers[0].credentialFields.api_key).toBe('********');
  });

  it('the list response carries no plaintext for any provider', async () => {
    await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    const res = await call('GET', { companyId: ORG_A });
    expect(JSON.stringify(res.body)).not.toContain(SECRET_A);
  });

  it('the delete response carries no plaintext', async () => {
    await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    const res = await call('DELETE', { companyId: ORG_A, provider: 'apollo' });
    expect(JSON.stringify(res.body)).not.toContain(SECRET_A);
    expect(res.body.provider.configured).toBe(false);
  });

  it('a validation error names the FIELD and never the value', async () => {
    const res = await call('PUT', { companyId: ORG_A }, {
      provider: 'apollo', credentials: { apiKey: SECRET_A },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(SECRET_A);
    expect(res.body.reason).toContain('apiKey');
  });

  it('a store failure returns an opaque error and logs no secret', async () => {
    const svc = require('../../services/integrationCredentialService');
    const spy = jest.spyOn(svc, 'upsertProviderCredentials')
      .mockImplementation(async () => { throw new Error('constraint violated'); });

    const res = await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain(SECRET_A);
    expect(res.body).toEqual({ error: 'CREDENTIAL_OPERATION_FAILED' });

    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain(SECRET_A);
    spy.mockRestore();
  });

  it('no console output across a full lifecycle contains the secret', async () => {
    const spies = (['log', 'warn', 'info', 'debug'] as const)
      .map((m) => jest.spyOn(console, m).mockImplementation(() => { /* captured */ }));
    await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    await call('GET', { companyId: ORG_A });
    await call('DELETE', { companyId: ORG_A, provider: 'apollo' });
    const all = JSON.stringify(spies.map((s) => s.mock.calls).concat([logSpy.mock.calls]));
    expect(all).not.toContain(SECRET_A);
    spies.forEach((s) => s.mockRestore());
  });

  it('every accepted credential field is a member of SECRET_CONFIG_KEYS', () => {
    // If one were not, `splitSecretConfig` would route it to NON-secret config
    // and it would be stored unencrypted.
    for (const field of ACCEPTED_CREDENTIAL_FIELDS) {
      expect(SECRET_CONFIG_KEYS.has(field)).toBe(true);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3P — provider validation', () => {
  it('accepts a stored-credential provider', () => {
    const r = validateProviderForCredentialStorage('apollo');
    expect('reason' in r).toBe(false);
  });

  it('accepts the gateway, which does hold a tenant credential', () => {
    const r = validateProviderForCredentialStorage('rapidapi');
    expect('reason' in r).toBe(false);
    expect(authModeFor('gateway_api')).toBe('gateway_api_key');
  });

  it('rejects an unknown provider rather than creating one', async () => {
    const res = await call('PUT', { companyId: ORG_A }, {
      provider: 'not_a_real_provider', credentials: { api_key: SECRET_A },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unknown_provider');
    expect(store.size).toBe(0);
  });

  it('rejects the browser extension rather than converting it to API-key storage', async () => {
    const res = await call('PUT', { companyId: ORG_A }, {
      provider: 'omnivyra_extension', credentials: { api_key: SECRET_A },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unsupported_auth_mode');
    expect(store.size).toBe(0);
  });

  it('rejects manual entry, which has no credential at all', async () => {
    const res = await call('PUT', { companyId: ORG_A }, {
      provider: 'manual', credentials: { api_key: SECRET_A },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unsupported_auth_mode');
  });

  it('rejects an unknown credential field instead of silently ignoring it', () => {
    const r = validateCredentialPayload({ password: 'x' });
    expect('reason' in r).toBe(true);
  });

  it('rejects a blank or non-string credential', () => {
    expect('reason' in validateCredentialPayload({ api_key: '   ' })).toBe(true);
    expect('reason' in validateCredentialPayload({ api_key: 12345 })).toBe(true);
    expect('reason' in validateCredentialPayload({})).toBe(true);
    expect('reason' in validateCredentialPayload(null)).toBe(true);
  });

  it('only external_api and gateway_api can hold a stored credential', () => {
    expect([...STORED_CREDENTIAL_SOURCE_TYPES].sort()).toEqual(['external_api', 'gateway_api']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3P — configured is never reported as operational', () => {
  it('a freshly configured provider is still not operational', async () => {
    const res = await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    expect(res.body.provider.operational).toBe(false);
    expect(res.body.provider.operationalReason).toMatch(/does not activate|credit action/);
  });

  it('every provider in the list is non-operational today', async () => {
    const res = await call('GET', { companyId: ORG_A });
    expect(res.body.providers.length).toBeGreaterThan(0);
    for (const p of res.body.providers) expect(p.operational).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3P — lifecycle, end to end with the PI resolver', () => {
  const request = {
    organizationId: ORG_A, subject: 'person' as const, entityId: 'person-1',
    attributes: ['job_title'], selectors: { email_domain: 'example.com' },
    purpose: 'icp', correlationId: 'corr-a3p',
  };

  function adapterSpy() {
    const calls: unknown[] = [];
    return Object.assign({
      id: 'apollo', label: 'Apollo', supports: ['job_title'], credentialEnvVar: 'APOLLO_API_KEY',
      isAvailable: () => true,
      enrich: async (req: unknown) => {
        calls.push(req);
        return { outcome: 'enriched' as const, notReturned: [], fields: [] };
      },
    }, { calls }) as unknown as EnrichmentProviderAdapter & { calls: unknown[] };
  }

  const piPorts = (): ExecuteEnrichmentPorts => {
    const port = makeTenantCredentialPort({ read: deps.read });
    return {
      authorizeCost: async () => ({ authorized: true, holdId: 'h', cost: { kind: 'free' } }),
      releaseCost: async () => { /* noop */ },
      resolveCredential: (i) => port.resolveCredential(i),
      findRecentObservation: async () => null,
      persistObservation: async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] }),
      now: () => '2026-09-05T00:00:00.000Z',
    };
  };

  it('configure → masked status is available', async () => {
    await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    const res = await call('GET', { companyId: ORG_A, provider: 'apollo' });
    expect(res.body.providers[0].configured).toBe(true);
    expect(res.body.providers[0].credentialFields).toEqual({ api_key: '********' });
  });

  it('configure → the PI resolver can resolve the tenant credential', async () => {
    await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    const adapter = adapterSpy();
    const result = await executeEnrichment(request, 'apollo', piPorts(), { adapter });
    expect(result.outcome).not.toBe('credential_missing');
    expect((adapter.calls[0] as { credential?: string }).credential).toBe(SECRET_A);
  });

  it('delete → the resolver returns credential_missing and nothing is called', async () => {
    await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    await call('DELETE', { companyId: ORG_A, provider: 'apollo' });

    const adapter = adapterSpy();
    const result = await executeEnrichment(request, 'apollo', piPorts(), { adapter });
    expect(result.outcome).toBe('credential_missing');
    expect(adapter.calls).toHaveLength(0);
  });

  it('delete is idempotent — revoking what is absent still succeeds', async () => {
    const first = await call('DELETE', { companyId: ORG_A, provider: 'apollo' });
    const second = await call('DELETE', { companyId: ORG_A, provider: 'apollo' });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.body.provider.configured).toBe(false);
  });

  it('reconfigure → the UPDATED credential is what the resolver uses', async () => {
    await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A2 } });

    const adapter = adapterSpy();
    await executeEnrichment(request, 'apollo', piPorts(), { adapter });
    expect((adapter.calls[0] as { credential?: string }).credential).toBe(SECRET_A2);
  });

  it('a configured credential is still not economic permission', async () => {
    await call('PUT', { companyId: ORG_A }, { provider: 'apollo', credentials: { api_key: SECRET_A } });
    const adapter = adapterSpy();
    const result = await executeEnrichment(request, 'apollo', {
      ...piPorts(),
      authorizeCost: async () => ({ authorized: false, reason: 'no credit action registered' }),
    }, { adapter });
    expect(result.outcome).toBe('cost_denied');
    expect(adapter.calls).toHaveLength(0);
  });
});
