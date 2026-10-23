/**
 * W4 — the SESv2 identity adapter.
 *
 * Only the client boundary (`send`) is faked; the real SDK command classes are
 * constructed, and the real domain service runs on top for the end-to-end
 * cases. No test contacts AWS or needs AWS credentials.
 */
type Row = Record<string, unknown>;
type Filter = [string, string, unknown];

const db = { tables: {} as Record<string, Row[]>, calls: 0, nextId: 1 };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    db.calls += 1;
    const st = { op: 'select', payload: null as Row | null, filters: [] as Filter[] };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row) => st.filters.every(([k, c, v]) =>
      k === 'eq' ? r[c] === v : k === 'is' ? (r[c] ?? null) === v : k === 'in' ? (v as unknown[]).includes(r[c]) : true);
    const exec = async (mode: 'many' | 'one') => {
      await Promise.resolve();
      if (st.op === 'insert') {
        const row: Row = { id: `sd-${db.nextId++}`, removed_at: null, dkim_tokens: [], dkim_signing_hosted_zone: null, last_error_code: null, last_checked_at: null, verified_at: null, ...st.payload };
        if (table === 'tenant_sending_domains' && rows().some((r) => r.domain === row.domain && r.removed_at == null)) {
          return { data: null, error: { code: '23505', message: 'dup' } };
        }
        rows().push(row);
        return { data: row, error: null };
      }
      if (st.op === 'update') {
        const hit = rows().filter(match);
        hit.forEach((r) => Object.assign(r, st.payload));
        return mode === 'one' ? { data: hit[0] ?? null, error: null } : { data: hit, error: null };
      }
      const found = rows().filter(match);
      return mode === 'one' ? { data: found[0] ?? null, error: null } : { data: found, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.filters.push(['eq', c, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push(['is', c, v]); return b; },
      in: (c: string, v: unknown) => { st.filters.push(['in', c, v]); return b; },
      single: () => exec('one'),
      maybeSingle: () => exec('one'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

import { CreateEmailIdentityCommand, GetEmailIdentityCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import {
  SES_IDENTITY_MAX_ATTEMPTS,
  createDefaultSesV2Client,
  createSesV2IdentityApi,
  identityStateFromResponse,
  resolveSesIdentityApi,
  sesIdentityCredentialsFrom,
  sesV2ErrorCode,
  type SesV2Sender,
} from '../../services/sendingDomains/sesV2IdentityAdapter';
import { RETRYABLE_SES_IDENTITY_ERRORS, SesIdentityError, statusFromIdentity, unconfiguredSesIdentityApi } from '../../services/sendingDomains/sesIdentityPort';
import {
  getSendingDomain,
  refreshSendingDomainStatus,
  registerSendingDomain,
  validateSender,
} from '../../services/sendingDomains/sendingDomainService';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const NOW = new Date('2026-10-21T12:00:00.000Z');
const CS_A = `omnivyra-t-${ORG_A}`;
const CS_B = `omnivyra-t-${ORG_B}`;
/** Sender validation runs on the test clock (verification freshness is time-based). */
const SV = { now: () => NOW };

// Obviously fake, shape-valid credentials (deliberately NOT the AKIA prefix).
const FAKE_CREDS = { accessKeyId: 'TESTDEDICATEDKEY0001', secretAccessKey: 'test/dedicated+secret=000000000000000000' };
const DEDICATED_ENV = {
  SENDING_DOMAINS_AWS_ACCESS_KEY_ID: FAKE_CREDS.accessKeyId,
  SENDING_DOMAINS_AWS_SECRET_ACCESS_KEY: FAKE_CREDS.secretAccessKey,
};
const GENERIC_ENV = { AWS_ACCESS_KEY_ID: 'TESTGENERICKEY000002', AWS_SECRET_ACCESS_KEY: 'test/generic+secret=0000000000000000000000' };

/** A fake SESv2 client: records commands; answers from a script. */
function fakeClient(script: Array<unknown | (() => unknown)>) {
  const sent: Array<CreateEmailIdentityCommand | GetEmailIdentityCommand> = [];
  const client: SesV2Sender & { sent: typeof sent } = {
    sent,
    async send(command) {
      sent.push(command);
      const next = script.shift();
      const value = typeof next === 'function' ? (next as () => unknown)() : next;
      if (value instanceof Error || (value && typeof value === 'object' && (value as { __throw?: boolean }).__throw)) throw value;
      return value;
    },
  };
  return client;
}

/** An SDK-shaped service error (name + $metadata), as the SDK throws them. */
const awsError = (name: string, httpStatusCode?: number, extra: Row = {}) =>
  Object.assign(new Error(`${name}: simulated`), { name, $metadata: httpStatusCode ? { httpStatusCode } : {}, ...extra });

const created = (over: Row = {}) => ({
  IdentityType: 'DOMAIN',
  VerifiedForSendingStatus: false,
  DkimAttributes: { SigningEnabled: true, Status: 'PENDING', Tokens: ['aaa111', 'bbb222', 'ccc333'], SigningHostedZone: 'dkim.amazonses.com' },
  ...over,
});
/** A read of an identity this tenant created: SES reports the set it was created with. */
const verifiedRead = (over: Row = {}) => ({
  IdentityType: 'DOMAIN',
  ConfigurationSetName: CS_A,
  VerifiedForSendingStatus: true,
  VerificationStatus: 'SUCCESS',
  DkimAttributes: { SigningEnabled: true, Status: 'SUCCESS', Tokens: ['aaa111', 'bbb222', 'ccc333'], SigningHostedZone: 'dkim.amazonses.com' },
  ...over,
});

beforeEach(() => {
  db.tables = {
    company_domains: [{ company_id: ORG_A, final_domain: 'acme.com', verification_status: 'verified' }],
    tenant_sending_domains: [],
    companies: [{ id: ORG_A, status: 'active', deleted_at: null }, { id: ORG_B, status: 'active', deleted_at: null }],
  };
  db.calls = 0;
  db.nextId = 1;
});

// 1 ─ region and command inputs ──────────────────────────────────────────────

describe('W4 SESv2 adapter — region and command inputs', () => {
  it('the real SDK client is fixed to eu-north-1 with bounded retries (no network)', async () => {
    const client = createDefaultSesV2Client(FAKE_CREDS);
    expect(await client.config.region()).toBe('eu-north-1');
    expect(await client.config.maxAttempts()).toBe(SES_IDENTITY_MAX_ATTEMPTS);
  });

  it('createDomainIdentity sends CreateEmailIdentityCommand with the domain and tenant configuration set (Easy DKIM)', async () => {
    const client = fakeClient([created()]);
    const api = createSesV2IdentityApi({ client });
    await api.createDomainIdentity({ domain: 'acme.com', configurationSetName: 'omnivyra-t-x' });
    expect(api.region).toBe('eu-north-1');
    expect(client.sent[0]).toBeInstanceOf(CreateEmailIdentityCommand);
    expect(client.sent[0].input).toEqual({ EmailIdentity: 'acme.com', ConfigurationSetName: 'omnivyra-t-x' });
  });

  it('getDomainIdentity sends GetEmailIdentityCommand with the domain only', async () => {
    const client = fakeClient([verifiedRead()]);
    await createSesV2IdentityApi({ client }).getDomainIdentity('acme.com');
    expect(client.sent[0]).toBeInstanceOf(GetEmailIdentityCommand);
    expect(client.sent[0].input).toEqual({ EmailIdentity: 'acme.com' });
  });
});

// 2–4 ─ response mapping ──────────────────────────────────────────────────────

describe('W4 SESv2 adapter — response mapping', () => {
  it('create with DKIM PENDING → pending state with tokens and hosted zone', async () => {
    const state = await createSesV2IdentityApi({ client: fakeClient([created()]) }).createDomainIdentity({ domain: 'acme.com', configurationSetName: 'c' });
    expect(state).toEqual({ verifiedForSending: false, dkimStatus: 'PENDING', dkimTokens: ['aaa111', 'bbb222', 'ccc333'], dkimSigningHostedZone: 'dkim.amazonses.com', configurationSetName: null });
    expect(statusFromIdentity(state)).toBe('pending');
  });

  it('get with VerifiedForSending true and DKIM SUCCESS → verified', async () => {
    const state = await createSesV2IdentityApi({ client: fakeClient([verifiedRead()]) }).getDomainIdentity('acme.com');
    expect(statusFromIdentity(state)).toBe('verified');
  });

  it.each([
    ['a non-DOMAIN identity', created({ IdentityType: 'EMAIL_ADDRESS' })],
    ['a missing IdentityType', created({ IdentityType: undefined })],
    ['no DKIM tokens on create', created({ DkimAttributes: { Status: 'PENDING', Tokens: [] } })],
    ['no DkimAttributes on create', created({ DkimAttributes: undefined })],
    ['only malformed tokens on create', created({ DkimAttributes: { Status: 'PENDING', Tokens: ['bad token', 7] } })],
    ['a null response', null],
    ['a non-object response', 'ok'],
  ])('create with %s → incomplete_response, never a success', async (_label, response) => {
    const api = createSesV2IdentityApi({ client: fakeClient([response]) });
    await expect(api.createDomainIdentity({ domain: 'acme.com', configurationSetName: 'c' }))
      .rejects.toMatchObject({ code: 'incomplete_response' });
  });

  it.each([
    ['VerifiedForSendingStatus missing', verifiedRead({ VerifiedForSendingStatus: undefined })],
    ['VerifiedForSendingStatus as a string', verifiedRead({ VerifiedForSendingStatus: 'true' })],
    ['DKIM status missing', verifiedRead({ DkimAttributes: { Tokens: ['aaa111'] } })],
    ['an unknown DKIM status', verifiedRead({ DkimAttributes: { Status: 'SUCCESSFUL', Tokens: ['aaa111'] } })],
    ['no DkimAttributes at all', verifiedRead({ DkimAttributes: undefined })],
  ])('get with %s is NOT verified', async (_label, response) => {
    const state = await createSesV2IdentityApi({ client: fakeClient([response]) }).getDomainIdentity('acme.com');
    expect(statusFromIdentity(state)).not.toBe('verified');
  });

  it('a malformed hosted zone is dropped; junk tokens are filtered; at most three kept', () => {
    const state = identityStateFromResponse({
      IdentityType: 'DOMAIN', VerifiedForSendingStatus: false,
      DkimAttributes: { Status: 'PENDING', Tokens: ['t1', 'bad token', 't2', 't3', 't4'], SigningHostedZone: 'evil zone/../x' },
    }, 'create');
    expect(state.dkimTokens).toEqual(['t1', 't2', 't3']);
    expect(state.dkimSigningHostedZone).toBeNull();
  });
});

// 6–8 ─ error classification ─────────────────────────────────────────────────

describe('W4 SESv2 adapter — error classification (retry only what is transient)', () => {
  it.each([
    ['AlreadyExistsException', undefined, 'already_exists'],
    ['NotFoundException', 404, 'not_found'],
    ['TooManyRequestsException', 429, 'throttled'],
    ['ThrottlingException', 400, 'throttled'],
    ['SomethingNew', 429, 'throttled'],
    ['InternalServiceErrorException', 500, 'unavailable'],
    ['ConcurrentModificationException', 500, 'unavailable'],
    ['ServiceUnavailable', 503, 'unavailable'],
    ['TimeoutError', undefined, 'unavailable'],
    ['UnknownServerFault', 502, 'unavailable'],
    ['AccessDeniedException', 403, 'access_denied'],
    ['UnrecognizedClientException', 400, 'access_denied'],
    ['InvalidClientTokenId', 403, 'access_denied'],
    ['ExpiredTokenException', 400, 'access_denied'],
    ['AccountSuspendedException', 400, 'access_denied'],
    ['BadRequestException', 400, 'invalid_request'],
    ['ValidationException', 400, 'invalid_request'],
    ['ConflictException', 409, 'invalid_request'],
    ['LimitExceededException', 400, 'limit_exceeded'],
    ['CredentialsProviderError', undefined, 'provider_not_configured'],
  ])('%s (%s) → %s', (name, status, code) => {
    expect(sesV2ErrorCode(awsError(name as string, status as number | undefined))).toBe(code);
  });

  it.each([['ECONNRESET'], ['ETIMEDOUT'], ['EAI_AGAIN']])('network error %s → unavailable', (netCode) => {
    expect(sesV2ErrorCode(Object.assign(new Error('socket'), { code: netCode }))).toBe('unavailable');
  });

  it.each([
    ['a plain Error', new Error('boom')],
    ['a thrown string', 'boom'],
    ['undefined', undefined],
    ['an unnamed 400', awsError('', 400)],
  ])('%s → unknown (terminal)', (_label, e) => {
    expect(sesV2ErrorCode(e)).toBe('unknown');
  });

  it('a thrown SDK error surfaces as SesIdentityError with the mapped code', async () => {
    const api = createSesV2IdentityApi({ client: fakeClient([awsError('AccessDeniedException', 403)]) });
    await expect(api.getDomainIdentity('acme.com')).rejects.toBeInstanceOf(SesIdentityError);
    await expect(createSesV2IdentityApi({ client: fakeClient([awsError('AccessDeniedException', 403)]) }).getDomainIdentity('acme.com'))
      .rejects.toMatchObject({ code: 'access_denied' });
  });

  it('nothing is logged — no credentials, no response bodies', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    const api = createSesV2IdentityApi({ client: fakeClient([awsError('AccessDeniedException', 403, { secretAccessKey: 'SECRET' }), created()]) });
    await api.getDomainIdentity('acme.com').catch(() => undefined);
    await api.createDomainIdentity({ domain: 'acme.com', configurationSetName: 'c' });
    const calls = spies.reduce((n, s) => n + s.mock.calls.length, 0);
    spies.forEach((s) => s.mockRestore());
    expect(calls).toBe(0);
  });
});

// selection ──────────────────────────────────────────────────────────────────

describe('W4 SESv2 adapter — explicit opt-in, fail-closed default', () => {
  it.each([[{}], [{ SENDING_DOMAINS_SES_PROVIDER: '' }], [{ SENDING_DOMAINS_SES_PROVIDER: 'ses' }], [{ SENDING_DOMAINS_SES_PROVIDER: 'true' }]])(
    'without the explicit opt-in (%p) the fail-closed default is used', (env) => {
      expect(resolveSesIdentityApi(env as Record<string, string>)).toBe(unconfiguredSesIdentityApi);
    },
  );

  it('with SENDING_DOMAINS_SES_PROVIDER=sesv2 AND the dedicated credentials the real adapter is selected (eu-north-1)', () => {
    const api = resolveSesIdentityApi({ SENDING_DOMAINS_SES_PROVIDER: 'SESv2', ...DEDICATED_ENV });
    expect(api).not.toBe(unconfiguredSesIdentityApi);
    expect(api.region).toBe('eu-north-1');
  });
});

// 5, 9, 10 ─ through the real domain service ──────────────────────────────────

describe('W4 SESv2 adapter — through the domain service', () => {
  const register = (client: SesV2Sender, org = ORG_A, domain = 'acme.com') =>
    registerSendingDomain({ organizationId: org, domain, actorUserId: 'u1' }, { ses: createSesV2IdentityApi({ client }), now: () => NOW });
  const rows = () => db.tables.tenant_sending_domains;

  it('registration stores pending + tokens + the SES-reported hosted zone, and the DNS instructions use it', async () => {
    const client = fakeClient([created({ DkimAttributes: { Status: 'PENDING', Tokens: ['aaa111', 'bbb222', 'ccc333'], SigningHostedZone: 'dkim.eu-north-1.example' } })]);
    const r = await register(client);
    expect(r.status).toBe('registered');
    expect(rows()[0]).toMatchObject({ status: 'pending', dkim_signing_hosted_zone: 'dkim.eu-north-1.example' });
    const detail = await getSendingDomain(ORG_A, r.domain!.id, { emailAuth: async () => ({ spf: true, dmarc: true, configured: true, domain: 'acme.com' }) });
    expect(detail.detail?.dnsRecords[0]).toEqual({ type: 'CNAME', name: 'aaa111._domainkey.acme.com', value: 'aaa111.dkim.eu-north-1.example' });
  });

  it('an identity that ALREADY EXISTS in SES is adopted via GetEmailIdentity; a repeat sends no further create', async () => {
    const client = fakeClient([awsError('AlreadyExistsException', 400), verifiedRead()]);
    const r = await register(client);
    expect(r.domain).toMatchObject({ status: 'verified', dkimTokens: ['aaa111', 'bbb222', 'ccc333'] });
    expect(client.sent.map((c) => c.constructor.name)).toEqual(['CreateEmailIdentityCommand', 'GetEmailIdentityCommand']);
    const again = await register(client);
    expect(again.status).toBe('already_registered');
    expect(client.sent).toHaveLength(2);
  });

  it.each([
    ['AccessDeniedException', 403, 'terminal_failure', 'ses_access_denied'],
    ['BadRequestException', 400, 'terminal_failure', 'ses_invalid_request'],
    ['LimitExceededException', 400, 'terminal_failure', 'ses_limit_exceeded'],
    ['TooManyRequestsException', 429, 'retryable_failure', 'ses_throttled'],
    ['InternalServiceErrorException', 500, 'retryable_failure', 'ses_unavailable'],
    ['MysteryException', 400, 'terminal_failure', 'ses_unknown'],
  ])('a create failing with %s → %s (%s), row stays pending with no tokens', async (name, status, outcome, reason) => {
    const r = await register(fakeClient([awsError(name as string, status as number)]));
    expect(r).toMatchObject({ status: outcome, reason });
    expect(rows()[0]).toMatchObject({ status: 'pending', dkim_tokens: [], verified_at: null });
  });

  it('an INCOMPLETE create response is terminal and never verified', async () => {
    const r = await register(fakeClient([created({ DkimAttributes: { Status: 'SUCCESS', Tokens: [] }, VerifiedForSendingStatus: true })]));
    expect(r).toMatchObject({ status: 'terminal_failure', reason: 'ses_incomplete_response' });
    expect(rows()[0].status).toBe('pending');
  });

  it.each([
    ['throttled', awsError('TooManyRequestsException', 429)],
    ['access denied', awsError('AccessDeniedException', 403)],
    ['an unknown error', new Error('boom')],
    ['an incomplete response', { IdentityType: 'DOMAIN' }],
  ])('refresh with %s never upgrades a pending domain to verified', async (_label, outcome) => {
    const r = await register(fakeClient([created()]));
    const before = rows()[0].status;
    await refreshSendingDomainStatus(ORG_A, r.domain!.id, { ses: createSesV2IdentityApi({ client: fakeClient([outcome]) }), now: () => NOW });
    expect(before).toBe('pending');
    expect(rows()[0].status).not.toBe('verified');
  });

  it('a later read that omits the hosted zone keeps the stored one', async () => {
    const r = await register(fakeClient([created({ DkimAttributes: { Status: 'PENDING', Tokens: ['aaa111', 'bbb222', 'ccc333'], SigningHostedZone: 'dkim.zone.example' } })]));
    await refreshSendingDomainStatus(ORG_A, r.domain!.id, { ses: createSesV2IdentityApi({ client: fakeClient([verifiedRead({ DkimAttributes: { Status: 'SUCCESS', Tokens: ['aaa111', 'bbb222', 'ccc333'] } })]) }), now: () => NOW });
    expect(rows()[0]).toMatchObject({ status: 'verified', dkim_signing_hosted_zone: 'dkim.zone.example' });
  });

  it('tenant ownership is still enforced BEFORE any SES call', async () => {
    const client = fakeClient([created()]);
    expect((await register(client, ORG_B)).reason).toBe('domain_not_owned');
    expect((await register(client, ORG_A, 'other.com')).reason).toBe('domain_not_owned');
    expect(client.sent).toHaveLength(0);
  });

  it("another tenant cannot refresh this tenant's domain — no SES call", async () => {
    const r = await register(fakeClient([created()]));
    const client = fakeClient([verifiedRead()]);
    const out = await refreshSendingDomainStatus(ORG_B, r.domain!.id, { ses: createSesV2IdentityApi({ client }), now: () => NOW });
    expect(out.status).toBe('not_found');
    expect(client.sent).toHaveLength(0);
  });

  it('sender validation accepts only the verified domain of the same tenant', async () => {
    const r = await register(fakeClient([created()]));
    expect((await validateSender({ organizationId: ORG_A, fromAddress: 'a@acme.com' }, SV)).reason).toBe('domain_not_verified');
    await refreshSendingDomainStatus(ORG_A, r.domain!.id, { ses: createSesV2IdentityApi({ client: fakeClient([verifiedRead()]) }), now: () => NOW });
    expect(await validateSender({ organizationId: ORG_A, fromAddress: 'a@acme.com' }, SV)).toMatchObject({ ok: true, configurationSetName: `omnivyra-t-${ORG_A}` });
    expect((await validateSender({ organizationId: ORG_B, fromAddress: 'a@acme.com' }, SV)).reason).toBe('domain_not_registered');
  });
});

// A1 ─ configuration set, not-found classification ──────────────────────────

describe('W4 SESv2 adapter — configuration set pass-through and NotFound classification', () => {
  it('a read passes through a well-formed ConfigurationSetName', async () => {
    const state = await createSesV2IdentityApi({ client: fakeClient([verifiedRead({ ConfigurationSetName: CS_B })]) }).getDomainIdentity('acme.com');
    expect(state.configurationSetName).toBe(CS_B);
  });

  it.each([
    ['absent', undefined], ['empty', ''], ['malformed', 'bad name!'], ['non-string', 7], ['over 64 chars', 'x'.repeat(65)],
  ])('a %s ConfigurationSetName → null (never a usable set)', async (_label, value) => {
    const state = await createSesV2IdentityApi({ client: fakeClient([verifiedRead({ ConfigurationSetName: value })]) }).getDomainIdentity('acme.com');
    expect(state.configurationSetName).toBeNull();
  });

  it('a CREATE NotFoundException → configuration_set_not_found (the only resource a create references)', async () => {
    await expect(createSesV2IdentityApi({ client: fakeClient([awsError('NotFoundException', 404)]) }).createDomainIdentity({ domain: 'acme.com', configurationSetName: CS_A }))
      .rejects.toMatchObject({ code: 'configuration_set_not_found' });
  });

  it('a GET NotFoundException → not_found (the identity is gone)', async () => {
    await expect(createSesV2IdentityApi({ client: fakeClient([awsError('NotFoundException', 404)]) }).getDomainIdentity('acme.com'))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it.each([['create'], ['get']])('an ambiguous 404 without the NotFoundException name on %s → unknown, not a configuration-set error', async (op) => {
    const api = createSesV2IdentityApi({ client: fakeClient([awsError('SomethingElse', 404)]) });
    const p = op === 'create' ? api.createDomainIdentity({ domain: 'acme.com', configurationSetName: CS_A }) : api.getDomainIdentity('acme.com');
    await expect(p).rejects.toMatchObject({ code: 'unknown' });
  });

  it('configuration_set_not_found is NOT retryable; throttled/unavailable still are', () => {
    expect(RETRYABLE_SES_IDENTITY_ERRORS.has('configuration_set_not_found')).toBe(false);
    expect(RETRYABLE_SES_IDENTITY_ERRORS.has('throttled')).toBe(true);
    expect(RETRYABLE_SES_IDENTITY_ERRORS.has('unavailable')).toBe(true);
  });
});

// A1 ─ identity takeover and reserved domains (through the real service) ─────

describe('W4 SESv2 adapter + service — no adoption of a foreign identity', () => {
  const register = (client: SesV2Sender, org = ORG_A, domain = 'acme.com') =>
    registerSendingDomain({ organizationId: org, domain, actorUserId: 'u1' }, { ses: createSesV2IdentityApi({ client }), now: () => NOW });
  const refresh = (id: string, client: SesV2Sender, org = ORG_A) =>
    refreshSendingDomainStatus(org, id, { ses: createSesV2IdentityApi({ client }), now: () => NOW });
  const rows = () => db.tables.tenant_sending_domains;
  const foreign = (over: Row = {}) => verifiedRead({ DkimAttributes: { Status: 'SUCCESS', Tokens: ['fff111', 'fff222', 'fff333'], SigningHostedZone: 'dkim.foreign.example' }, ...over });

  it("an existing identity carrying exactly this tenant's configuration set is adopted", async () => {
    const client = fakeClient([awsError('AlreadyExistsException', 400), verifiedRead({ ConfigurationSetName: CS_A })]);
    expect((await register(client)).domain).toMatchObject({ status: 'verified' });
  });

  it.each([
    ["another tenant's configuration set", foreign({ ConfigurationSetName: CS_B })],
    ['a platform configuration set', foreign({ ConfigurationSetName: 'omnivyra-platform' })],
    ['a case-variant of the tenant set', foreign({ ConfigurationSetName: CS_A.toUpperCase() })],
    ['NO configuration set', foreign({ ConfigurationSetName: undefined })],
    ['a malformed configuration set', foreign({ ConfigurationSetName: 'not valid!' })],
    ['a non-DOMAIN identity', foreign({ IdentityType: 'EMAIL_ADDRESS' })],
  ])('an existing identity with %s is REFUSED (terminal), unmodified, and nothing of it is stored or returned', async (_label, existing) => {
    const client = fakeClient([awsError('AlreadyExistsException', 400), existing]);
    const r = await register(client);
    expect(r).toMatchObject({ status: 'terminal_failure', reason: 'ses_identity_not_adoptable' });
    expect(rows()[0]).toMatchObject({ status: 'pending', dkim_tokens: [], dkim_signing_hosted_zone: null, verified_at: null, last_error_code: 'ses_identity_not_adoptable' });
    const body = JSON.stringify(r);
    expect(body).not.toContain('fff111');
    expect(body).not.toContain('dkim.foreign.example');
    expect(body).not.toContain(CS_B);
    // Only Create + Get: no command that could modify or delete the identity.
    expect(client.sent.map((c) => c.constructor.name)).toEqual(['CreateEmailIdentityCommand', 'GetEmailIdentityCommand']);
    expect(await validateSender({ organizationId: ORG_A, fromAddress: 'a@acme.com' }, SV)).toMatchObject({ ok: false });
  });

  it.each([
    ['throttled', awsError('TooManyRequestsException', 429), 'retryable_failure', 'ses_throttled'],
    ['unavailable', awsError('InternalServiceErrorException', 500), 'retryable_failure', 'ses_unavailable'],
    ['access denied', awsError('AccessDeniedException', 403), 'terminal_failure', 'ses_access_denied'],
    ['identity vanished', awsError('NotFoundException', 404), 'terminal_failure', 'ses_not_found'],
  ])('when the existing identity cannot be READ (%s) nothing is adopted', async (_label, getError, status, reason) => {
    const r = await register(fakeClient([awsError('AlreadyExistsException', 400), getError]));
    expect(r).toMatchObject({ status, reason });
    expect(rows()[0]).toMatchObject({ status: 'pending', dkim_tokens: [], verified_at: null });
  });

  it('a refused adoption cannot be completed by a later REFRESH (the row is failed, never verified)', async () => {
    const r = await register(fakeClient([awsError('AlreadyExistsException', 400), foreign({ ConfigurationSetName: CS_B })]));
    const out = await refresh(r.domain!.id, fakeClient([foreign({ ConfigurationSetName: CS_B })]));
    expect(out).toMatchObject({ status: 'refreshed', reason: 'ses_identity_not_adoptable' });
    expect(rows()[0]).toMatchObject({ status: 'failed', verified_at: null, dkim_tokens: [] });
    expect((await validateSender({ organizationId: ORG_A, fromAddress: 'a@acme.com' }, SV)).ok).toBe(false);
  });

  it("a refresh that finds this tenant's identity re-pointed to another configuration set → failed", async () => {
    const r = await register(fakeClient([created()]));
    await refresh(r.domain!.id, fakeClient([verifiedRead()]));
    expect(rows()[0].status).toBe('verified');
    await refresh(r.domain!.id, fakeClient([verifiedRead({ ConfigurationSetName: CS_B })]));
    expect(rows()[0]).toMatchObject({ status: 'failed', verified_at: null, last_error_code: 'ses_identity_not_adoptable' });
  });

  it('a create whose configuration set does not exist → terminal ses_configuration_set_not_found', async () => {
    const r = await register(fakeClient([awsError('NotFoundException', 404)]));
    expect(r).toMatchObject({ status: 'terminal_failure', reason: 'ses_configuration_set_not_found' });
    expect(rows()[0]).toMatchObject({ status: 'pending', dkim_tokens: [] });
  });

  it.each([['omnivyra.com'], ['mail.omnivyra.com'], ['A.B.Omnivyra.COM.']])(
    'the reserved %s is refused before ANY database or SES call — even with verified website ownership', async (domain) => {
      db.tables.company_domains.push({ company_id: ORG_A, final_domain: 'omnivyra.com', verification_status: 'admin_override' });
      const client = fakeClient([created()]);
      const before = db.calls;
      expect(await register(client, ORG_A, domain)).toMatchObject({ status: 'refused', reason: 'domain_reserved' });
      expect(db.calls).toBe(before);
      expect(client.sent).toHaveLength(0);
    },
  );

  it('failed website ownership stops BEFORE any SES call, even when an identity exists', async () => {
    const client = fakeClient([awsError('AlreadyExistsException', 400), verifiedRead()]);
    expect((await register(client, ORG_B)).reason).toBe('domain_not_owned');
    expect(client.sent).toHaveLength(0);
  });
});

// A1 ─ DKIM instructions survive a read without tokens ───────────────────────

describe('W4 SESv2 adapter + service — DKIM instructions survive a read without tokens', () => {
  const register = (client: SesV2Sender) =>
    registerSendingDomain({ organizationId: ORG_A, domain: 'acme.com', actorUserId: 'u1' }, { ses: createSesV2IdentityApi({ client }), now: () => NOW });
  const refresh = (id: string, client: SesV2Sender) =>
    refreshSendingDomainStatus(ORG_A, id, { ses: createSesV2IdentityApi({ client }), now: () => NOW });
  const rows = () => db.tables.tenant_sending_domains;
  const zoned = () => created({ DkimAttributes: { Status: 'PENDING', Tokens: ['aaa111', 'bbb222', 'ccc333'], SigningHostedZone: 'dkim.zone.example' } });

  it.each([
    ['missing Tokens', { Status: 'PENDING' }],
    ['an empty Tokens array', { Status: 'PENDING', Tokens: [] }],
    ['only malformed tokens', { Status: 'PENDING', Tokens: ['bad token'] }],
    ['no DkimAttributes', undefined],
  ])('a refresh read with %s keeps the stored tokens and hosted zone', async (_label, dkim) => {
    const r = await register(fakeClient([zoned()]));
    await refresh(r.domain!.id, fakeClient([verifiedRead({ DkimAttributes: dkim, VerifiedForSendingStatus: false })]));
    expect(rows()[0]).toMatchObject({ dkim_tokens: ['aaa111', 'bbb222', 'ccc333'], dkim_signing_hosted_zone: 'dkim.zone.example', status: 'pending' });
    const detail = await getSendingDomain(ORG_A, r.domain!.id, { emailAuth: async () => ({ spf: true, dmarc: true, configured: true, domain: 'acme.com' }) });
    expect(detail.detail?.dnsRecords.map((d) => d.value)).toEqual(['aaa111.dkim.zone.example', 'bbb222.dkim.zone.example', 'ccc333.dkim.zone.example']);
  });

  it('a refresh read WITH tokens replaces them (rotation is reflected)', async () => {
    const r = await register(fakeClient([zoned()]));
    await refresh(r.domain!.id, fakeClient([verifiedRead({ DkimAttributes: { Status: 'PENDING', Tokens: ['new111', 'new222', 'new333'] } })]));
    expect(rows()[0]).toMatchObject({ dkim_tokens: ['new111', 'new222', 'new333'], dkim_signing_hosted_zone: 'dkim.zone.example' });
  });

  it('a read without tokens still cannot upgrade: DKIM SUCCESS without sending readiness stays pending', async () => {
    const r = await register(fakeClient([zoned()]));
    await refresh(r.domain!.id, fakeClient([verifiedRead({ VerifiedForSendingStatus: false, DkimAttributes: { Status: 'SUCCESS' } })]));
    expect(rows()[0]).toMatchObject({ status: 'pending', verified_at: null });
  });
});

// Phase A ─ dedicated credentials, no fallback to the generic chain ──────────

describe('W4 SESv2 adapter — dedicated credentials only (no default-chain fallback)', () => {
  const ENV_KEYS = [
    'SENDING_DOMAINS_SES_PROVIDER', 'SENDING_DOMAINS_AWS_ACCESS_KEY_ID', 'SENDING_DOMAINS_AWS_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE',
  ];
  const saved: Record<string, string | undefined> = {};
  /** Every real SDK `send` is intercepted: the command is recorded with the credentials the client resolved. */
  let sendSpy: jest.SpyInstance;
  const seen: Array<{ command: string; credentials: { accessKeyId: string; secretAccessKey: string } }> = [];

  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    seen.length = 0;
    sendSpy = jest.spyOn(SESv2Client.prototype, 'send').mockImplementation(async function (this: SESv2Client, command: { constructor: { name: string } }) {
      const c = await (this.config.credentials as () => Promise<{ accessKeyId: string; secretAccessKey: string }>)();
      seen.push({ command: command.constructor.name, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } });
      return created();
    } as never);
  });
  afterEach(() => {
    sendSpy.mockRestore();
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  const registerViaDefaults = () => registerSendingDomain({ organizationId: ORG_A, domain: 'acme.com', actorUserId: 'u1' }, { now: () => NOW });

  it('both dedicated values present: the client resolves EXACTLY those credentials (never the generic ones)', async () => {
    Object.assign(process.env, { SENDING_DOMAINS_SES_PROVIDER: 'sesv2', ...DEDICATED_ENV, ...GENERIC_ENV });
    const r = await registerViaDefaults();
    expect(r.status).toBe('registered');
    expect(seen).toEqual([{ command: 'CreateEmailIdentityCommand', credentials: FAKE_CREDS }]);
  });

  it('the static pair is what the SDK client config resolves', async () => {
    const c = await (createDefaultSesV2Client(FAKE_CREDS).config.credentials as () => Promise<{ accessKeyId: string; secretAccessKey: string }>)();
    expect({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey }).toEqual(FAKE_CREDS);
  });

  it.each([
    ['access key missing', { SENDING_DOMAINS_AWS_SECRET_ACCESS_KEY: FAKE_CREDS.secretAccessKey }],
    ['secret key missing', { SENDING_DOMAINS_AWS_ACCESS_KEY_ID: FAKE_CREDS.accessKeyId }],
    ['both missing', {}],
    ['access key empty', { ...DEDICATED_ENV, SENDING_DOMAINS_AWS_ACCESS_KEY_ID: '' }],
    ['secret key empty', { ...DEDICATED_ENV, SENDING_DOMAINS_AWS_SECRET_ACCESS_KEY: '' }],
    ['access key whitespace-only', { ...DEDICATED_ENV, SENDING_DOMAINS_AWS_ACCESS_KEY_ID: '   ' }],
    ['secret key whitespace-only', { ...DEDICATED_ENV, SENDING_DOMAINS_AWS_SECRET_ACCESS_KEY: '\t \n' }],
    ['access key malformed (lower-case / spaces)', { ...DEDICATED_ENV, SENDING_DOMAINS_AWS_ACCESS_KEY_ID: 'not a key id' }],
    ['secret key malformed (too short)', { ...DEDICATED_ENV, SENDING_DOMAINS_AWS_SECRET_ACCESS_KEY: 'short' }],
    ['secret key with an embedded space', { ...DEDICATED_ENV, SENDING_DOMAINS_AWS_SECRET_ACCESS_KEY: 'test/dedicated secret=0000000000000000000' }],
  ])('%s (generic AWS_* present): provider_not_configured, NO AWS command, no fallback', async (_label, dedicated) => {
    Object.assign(process.env, { SENDING_DOMAINS_SES_PROVIDER: 'sesv2', ...GENERIC_ENV, ...dedicated });
    expect(resolveSesIdentityApi()).toBe(unconfiguredSesIdentityApi);
    const r = await registerViaDefaults();
    expect(r).toMatchObject({ status: 'terminal_failure', reason: 'ses_provider_not_configured' });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('generic AWS_* plus a session token/profile, dedicated absent: still no AWS call', async () => {
    Object.assign(process.env, { SENDING_DOMAINS_SES_PROVIDER: 'sesv2', ...GENERIC_ENV, AWS_SESSION_TOKEN: 'tok', AWS_PROFILE: 'default' });
    await registerViaDefaults();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it.each([[undefined], [''], ['ses'], ['sesv1'], ['true']])('provider %p (credentials present) → no AWS client invocation', async (provider) => {
    Object.assign(process.env, { ...DEDICATED_ENV, ...GENERIC_ENV });
    if (provider !== undefined) process.env.SENDING_DOMAINS_SES_PROVIDER = provider;
    expect(resolveSesIdentityApi()).toBe(unconfiguredSesIdentityApi);
    await registerViaDefaults();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('createSesV2IdentityApi has no default client and createDefaultSesV2Client refuses an invalid pair', () => {
    expect(() => createSesV2IdentityApi(undefined as never)).toThrow(SesIdentityError);
    expect(() => createSesV2IdentityApi({} as never)).toThrow(SesIdentityError);
    expect(() => createDefaultSesV2Client(undefined as never)).toThrow(SesIdentityError);
    expect(() => createDefaultSesV2Client({ accessKeyId: '', secretAccessKey: FAKE_CREDS.secretAccessKey })).toThrow(SesIdentityError);
  });

  it('the credential reader trims, and reads ONLY the dedicated names', () => {
    expect(sesIdentityCredentialsFrom({ SENDING_DOMAINS_AWS_ACCESS_KEY_ID: `  ${FAKE_CREDS.accessKeyId} `, SENDING_DOMAINS_AWS_SECRET_ACCESS_KEY: `${FAKE_CREDS.secretAccessKey}\n` })).toEqual(FAKE_CREDS);
    expect(sesIdentityCredentialsFrom(GENERIC_ENV)).toBeNull();
  });

  it.each([
    ['a lower-case / spaced access key id', { ...DEDICATED_ENV, SENDING_DOMAINS_AWS_ACCESS_KEY_ID: 'not a key id' }],
    ['a too-short secret', { ...DEDICATED_ENV, SENDING_DOMAINS_AWS_SECRET_ACCESS_KEY: 'short' }],
    ['a secret with an inner space', { ...DEDICATED_ENV, SENDING_DOMAINS_AWS_SECRET_ACCESS_KEY: 'test/dedicated secret=0000000000000000000' }],
    ['an over-long access key id', { ...DEDICATED_ENV, SENDING_DOMAINS_AWS_ACCESS_KEY_ID: 'A'.repeat(129) }],
  ])('the credential reader itself rejects %s (not only the client factory)', (_label, env) => {
    expect(sesIdentityCredentialsFrom(env)).toBeNull();
  });

  it('no credential value appears in any error, outcome or log — on refusal or on an SDK failure', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    try {
      Object.assign(process.env, { SENDING_DOMAINS_SES_PROVIDER: 'sesv2', ...GENERIC_ENV, SENDING_DOMAINS_AWS_ACCESS_KEY_ID: FAKE_CREDS.accessKeyId });
      const refused = await registerViaDefaults();
      Object.assign(process.env, DEDICATED_ENV);
      sendSpy.mockImplementation(async () => { throw Object.assign(new Error(`AccessDenied for ${FAKE_CREDS.accessKeyId}`), { name: 'AccessDeniedException', $metadata: { httpStatusCode: 403 } }); });
      const failed = await registerViaDefaults();
      expect(failed).toMatchObject({ status: 'terminal_failure', reason: 'ses_access_denied' });
      let thrown: unknown;
      try { await resolveSesIdentityApi().getDomainIdentity('acme.com'); } catch (e) { thrown = e; }
      const logged = spies.flatMap((s) => s.mock.calls).map((c) => JSON.stringify(c)).join(' ');
      const surface = [JSON.stringify(refused), JSON.stringify(failed), String((thrown as Error)?.message), JSON.stringify(thrown), JSON.stringify(db.tables), logged].join(' ');
      for (const v of [FAKE_CREDS.accessKeyId, FAKE_CREDS.secretAccessKey, GENERIC_ENV.AWS_ACCESS_KEY_ID, GENERIC_ENV.AWS_SECRET_ACCESS_KEY]) {
        expect(surface).not.toContain(v);
      }
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it('unrelated integrations are unaffected: process.env (incl. generic AWS_*) is never modified', () => {
    Object.assign(process.env, { SENDING_DOMAINS_SES_PROVIDER: 'sesv2', ...DEDICATED_ENV, ...GENERIC_ENV });
    const before = JSON.stringify(Object.entries(process.env).sort());
    resolveSesIdentityApi();
    resolveSesIdentityApi({ SENDING_DOMAINS_SES_PROVIDER: 'sesv2' });
    expect(JSON.stringify(Object.entries(process.env).sort())).toBe(before);
    expect(process.env.AWS_ACCESS_KEY_ID).toBe(GENERIC_ENV.AWS_ACCESS_KEY_ID);
  });

  it('create/get mappings are unchanged through the real client with dedicated credentials', async () => {
    Object.assign(process.env, { SENDING_DOMAINS_SES_PROVIDER: 'sesv2', ...DEDICATED_ENV });
    sendSpy.mockImplementation(async () => { throw Object.assign(new Error('x'), { name: 'NotFoundException', $metadata: { httpStatusCode: 404 } }); });
    const api = resolveSesIdentityApi();
    await expect(api.createDomainIdentity({ domain: 'acme.com', configurationSetName: CS_A })).rejects.toMatchObject({ code: 'configuration_set_not_found' });
    await expect(api.getDomainIdentity('acme.com')).rejects.toMatchObject({ code: 'not_found' });
  });
});
