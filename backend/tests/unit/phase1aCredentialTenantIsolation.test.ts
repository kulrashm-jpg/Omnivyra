/**
 * PHASE-1A / T-1 — credential access is tenant-scoped by construction.
 *
 * The audit found that `integrationCredentialService` took a bare
 * `connectionId` and trusted the caller. These tests pin the corrected
 * contract: every credential operation requires a tenant, proves ownership
 * before touching a secret, and refuses a cross-tenant request loudly rather
 * than returning an empty result that a caller might mistake for "no
 * credentials configured".
 */

const rows: Record<string, unknown[]> = {};
const captured: { table: string; op: string; payload?: unknown }[] = [];

jest.mock('../../auth/credentialEncryption', () => ({
  encryptCredential: (v: string) => `enc(${v})`,
  decryptCredential: (v: string) => String(v).replace(/^enc\((.*)\)$/, '$1'),
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const q: Record<string, unknown> = {};
    let filterId: string | null = null;

    q.select = () => q;
    q.eq = (_col: string, val: string) => { filterId = val; return q; };
    q.maybeSingle = async () => {
      const found = (rows[table] ?? []).find((r) => (r as { id?: string }).id === filterId);
      return { data: found ?? null, error: null };
    };
    q.then = undefined;
    q.upsert = async (payload: unknown) => {
      captured.push({ table, op: 'upsert', payload });
      return { error: null };
    };
    // `select().eq()` on integration_credentials resolves as a plain awaited
    // query, so the builder must be thenable for that path only.
    if (table === 'integration_credentials') {
      q.eq = (_col: string, val: string) => {
        filterId = val;
        return Promise.resolve({
          data: (rows[table] ?? []).filter((r) => (r as { connection_id?: string }).connection_id === val),
          error: null,
        }) as unknown as typeof q;
      };
    }
    return q;
  },
}));

import {
  getConnectionCredentials,
  upsertConnectionCredentials,
  mergeConnectionConfig,
  CrossTenantCredentialError,
  splitSecretConfig,
  maskCredentials,
  SECRET_CONFIG_KEYS,
} from '../../services/integrationCredentialService';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const CONN_A = 'conn-a';
const CONN_B = 'conn-b';

beforeEach(() => {
  captured.length = 0;
  rows.website_connections = [
    { id: CONN_A, websites: { company_id: ORG_A } },
    { id: CONN_B, websites: { company_id: ORG_B } },
  ];
  rows.integration_credentials = [
    { connection_id: CONN_A, credential_key: 'api_key', encrypted_value: 'enc(a-secret)' },
    { connection_id: CONN_B, credential_key: 'api_key', encrypted_value: 'enc(b-secret)' },
  ];
});

describe('PHASE-1A — a tenant may read only its own credentials', () => {
  it('returns the credential when the connection belongs to the company', async () => {
    await expect(getConnectionCredentials(ORG_A, CONN_A)).resolves.toEqual({ api_key: 'a-secret' });
  });

  it('REFUSES tenant A reading tenant B’s credential', async () => {
    await expect(getConnectionCredentials(ORG_A, CONN_B)).rejects.toBeInstanceOf(CrossTenantCredentialError);
  });

  it('refuses in both directions — B cannot read A either', async () => {
    await expect(getConnectionCredentials(ORG_B, CONN_A)).rejects.toBeInstanceOf(CrossTenantCredentialError);
  });

  it('never decrypts before ownership is proven — the refusal carries no secret', async () => {
    const err = await getConnectionCredentials(ORG_A, CONN_B).catch((e) => e);
    expect(String(err.message)).not.toContain('b-secret');
    expect(JSON.stringify(err)).not.toContain('b-secret');
  });

  it('a missing connection is absent, not a cross-tenant error', async () => {
    await expect(getConnectionCredentials(ORG_A, 'conn-nope')).resolves.toEqual({});
  });

  it('an unresolvable owner is refused rather than allowed', async () => {
    rows.website_connections = [{ id: CONN_A, websites: null }];
    await expect(getConnectionCredentials(ORG_A, CONN_A)).rejects.toBeInstanceOf(CrossTenantCredentialError);
  });

  it('requires a tenant — a blank companyId is never treated as a wildcard', async () => {
    await expect(getConnectionCredentials('', CONN_A)).rejects.toThrow(/companyId is required/);
    await expect(getConnectionCredentials('   ', CONN_A)).rejects.toThrow(/companyId is required/);
  });
});

describe('PHASE-1A — writes are gated the same way as reads', () => {
  it('writes the credential for an owned connection', async () => {
    await upsertConnectionCredentials(ORG_A, CONN_A, { api_key: 'new' });
    expect(captured.filter((c) => c.op === 'upsert')).toHaveLength(1);
  });

  it('REFUSES a cross-tenant write and persists nothing', async () => {
    await expect(upsertConnectionCredentials(ORG_A, CONN_B, { api_key: 'x' }))
      .rejects.toBeInstanceOf(CrossTenantCredentialError);
    expect(captured.filter((c) => c.op === 'upsert')).toHaveLength(0);
  });

  it('proves ownership BEFORE writing — no partial secret is left behind', async () => {
    await expect(upsertConnectionCredentials(ORG_A, 'conn-nope', { api_key: 'x' })).rejects.toThrow(/not found/);
    expect(captured).toHaveLength(0);
  });

  it('an empty credential set is a no-op and does not even check ownership', async () => {
    await expect(upsertConnectionCredentials(ORG_A, CONN_B, {})).resolves.toBeUndefined();
    expect(captured).toHaveLength(0);
  });
});

describe('PHASE-1A — mergeConnectionConfig', () => {
  it('merges the tenant’s own credentials over its non-secret config', async () => {
    const cfg = await mergeConnectionConfig(ORG_A, CONN_A, { host: 'h' }, { legacy: 'l' });
    expect(cfg).toEqual({ legacy: 'l', host: 'h', api_key: 'a-secret' });
  });

  it('RE-THROWS a cross-tenant request instead of degrading it to an empty config', async () => {
    await expect(mergeConnectionConfig(ORG_A, CONN_B, {}, {}))
      .rejects.toBeInstanceOf(CrossTenantCredentialError);
  });

  it('still tolerates a missing connection — that is a normal outcome', async () => {
    await expect(mergeConnectionConfig(ORG_A, null, { host: 'h' }, {})).resolves.toEqual({ host: 'h' });
  });
});

describe('PHASE-1A — the secret split is unchanged', () => {
  it('routes known secret keys away from non-secret config', () => {
    const { nonSecretConfig, credentials } = splitSecretConfig({ host: 'h', api_key: 'k', refresh_token: 'r' });
    expect(nonSecretConfig).toEqual({ host: 'h' });
    expect(credentials).toEqual({ api_key: 'k', refresh_token: 'r' });
  });

  it('masks every secret key it knows about', () => {
    const masked = maskCredentials({ host: 'h', api_key: 'k' });
    expect(masked.host).toBe('h');
    expect(masked.api_key).toBe('********');
  });

  it('the secret key set still covers OAuth tokens', () => {
    for (const k of ['access_token', 'refresh_token', 'client_secret', 'password']) {
      expect(SECRET_CONFIG_KEYS.has(k)).toBe(true);
    }
  });
});
