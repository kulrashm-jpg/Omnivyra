/**
 * W4 — tenant sending domains: rules, registration, status, refresh and sender
 * validation. A database double (with the live-domain unique index) and a fake
 * SES identity port; nothing reaches AWS or a database.
 */
import fs from 'fs';
import path from 'path';

type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  failures: {} as Record<string, { op?: string; code: string }>,
  calls: 0,
  nextId: 1,
  /** Runs at INSERT time, before the unique index is checked: a competing writer. */
  onInsert: null as null | ((table: string) => void),
  /** A raw SELECT answer for a table, ignoring filters: a malformed/misbehaving database response. */
  answers: {} as Record<string, unknown>,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    db.calls += 1;
    const st = { op: 'select', payload: null as Row | null, filters: [] as Filter[] };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row) => st.filters.every(([k, c, v]) =>
      k === 'eq' ? r[c] === v : k === 'is' ? (r[c] ?? null) === v : k === 'in' ? (v as unknown[]).includes(r[c]) : true);
    const exec = async (mode: 'many' | 'one') => {
      await Promise.resolve();
      const f = db.failures[table];
      if (f && (!f.op || f.op === st.op)) return { data: null, error: { code: f.code, message: 'injected' } };
      if (st.op === 'select' && table in db.answers) return { data: db.answers[table], error: null };
      if (st.op === 'insert') {
        if (db.onInsert) { const hook = db.onInsert; db.onInsert = null; hook(table); }
        const row: Row = {
          id: `sd-${db.nextId++}`, removed_at: null, dkim_tokens: [], last_error_code: null,
          last_checked_at: null, verified_at: null, created_at: '2026-10-20T00:00:00.000Z', ...st.payload,
        };
        // uq_tenant_sending_domains_live_domain
        if (table === 'tenant_sending_domains' && rows().some((r) => r.domain === row.domain && r.removed_at == null)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_tenant_sending_domains_live_domain"' } };
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

import {
  SENDING_DOMAIN_RE,
  configurationSetNameFor,
  dkimCnameRecords,
  DEFAULT_MAX_VERIFICATION_AGE_MS,
  SES_IDENTITY_STATES,
  SES_IDENTITY_TRANSITIONS,
  canTransitionIdentityState,
  deletionPreconditionFailure,
  isReservedSendingDomain,
  isSameOrSubdomainOf,
  normalizeSendingDomain,
  senderAddressDomain,
  verificationFreshnessFailure,
} from '../../services/sendingDomains/sendingDomainRules';
import { SesIdentityError, identityBelongsToConfigurationSet, statusFromIdentity, type SesIdentityErrorCode, type SesIdentityState } from '../../services/sendingDomains/sesIdentityPort';
import {
  getSendingDomain,
  refreshSendingDomainStatus,
  registerSendingDomain,
  validateSender,
} from '../../services/sendingDomains/sendingDomainService';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const NOW = new Date('2026-10-20T12:00:00.000Z');
/** The configuration set SES reports for an identity ORG_A created. */
const CS_A = `omnivyra-t-${ORG_A}`;
/** Sender validation runs on the test clock (verification freshness is time-based). */
const SV = { now: () => NOW };

const companyDomain = (over: Row = {}): Row => ({
  company_id: ORG_A, final_domain: 'acme.com', verification_status: 'verified', verified: true, ...over,
});

function fakeSes() {
  const identities = new Map<string, SesIdentityState>();
  const api = {
    region: 'eu-north-1',
    calls: [] as Array<[string, string, string?]>,
    failCreate: null as SesIdentityErrorCode | null,
    failGet: null as SesIdentityErrorCode | null,
    identities,
    async createDomainIdentity(input: { domain: string; configurationSetName: string }) {
      api.calls.push(['create', input.domain, input.configurationSetName]);
      if (api.failCreate) throw new SesIdentityError(api.failCreate);
      if (identities.has(input.domain)) throw new SesIdentityError('already_exists');
      const s: SesIdentityState = { verifiedForSending: false, dkimStatus: 'PENDING', dkimTokens: ['tok1', 'tok2', 'tok3'], configurationSetName: input.configurationSetName };
      identities.set(input.domain, s);
      return s;
    },
    async getDomainIdentity(domain: string) {
      api.calls.push(['get', domain]);
      if (api.failGet) throw new SesIdentityError(api.failGet);
      const s = identities.get(domain);
      if (!s) throw new SesIdentityError('not_found');
      return s;
    },
  };
  return api;
}

let ses: ReturnType<typeof fakeSes>;
const deps = () => ({ ses, now: () => NOW });
const register = (domain: unknown, org = ORG_A) => registerSendingDomain({ organizationId: org, domain, actorUserId: 'user-1' }, deps());
const rows = () => (db.tables.tenant_sending_domains ??= []);

beforeEach(() => {
  db.tables = {
    company_domains: [companyDomain()],
    tenant_sending_domains: [],
    companies: [{ id: ORG_A, status: 'active', deleted_at: null }, { id: ORG_B, status: 'active', deleted_at: null }],
  };
  db.failures = {};
  db.answers = {};
  db.calls = 0;
  db.nextId = 1;
  db.onInsert = null;
  ses = fakeSes();
});

// ── Rules ───────────────────────────────────────────────────────────────────

describe('W4 rules', () => {
  it.each([
    ['Acme.COM', 'acme.com'], ['mail.acme.com.', 'mail.acme.com'], [' news.acme.co.uk ', 'news.acme.co.uk'], ['xn--bcher-kva.example', 'xn--bcher-kva.example'],
  ])('normalises %s → %s', (input, out) => expect(normalizeSendingDomain(input)).toBe(out));

  it.each(['', 'acme', 'https://acme.com', 'user@acme.com', '*.acme.com', '1.2.3.4', 'acme.com/path', 'a..com', '-acme.com', 'acme-.com', `${'a'.repeat(64)}.com`, 42, null])(
    'refuses %p', (input) => expect(normalizeSendingDomain(input)).toBeNull());

  it('subdomain matching is label-aligned', () => {
    expect(isSameOrSubdomainOf('mail.acme.com', 'acme.com')).toBe(true);
    expect(isSameOrSubdomainOf('acme.com', 'acme.com')).toBe(true);
    expect(isSameOrSubdomainOf('notacme.com', 'acme.com')).toBe(false);
    expect(isSameOrSubdomainOf('acme.com', 'mail.acme.com')).toBe(false);
  });

  it('parses a sender address strictly (no display names)', () => {
    expect(senderAddressDomain('Jo@Mail.Acme.com')).toBe('mail.acme.com');
    for (const bad of ['Acme <jo@acme.com>', 'jo@@acme.com', '@acme.com', 'jo', 'jo@', 'a"b@acme.com']) {
      expect(senderAddressDomain(bad)).toBeNull();
    }
  });

  it('one deterministic, SES-valid configuration set per tenant', () => {
    const name = configurationSetNameFor(ORG_A);
    expect(name).toBe(`omnivyra-t-${ORG_A}`);
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(configurationSetNameFor(ORG_A)).toBe(name);
    expect(configurationSetNameFor(ORG_B)).not.toBe(name);
  });

  it('builds the three Easy DKIM CNAMEs', () => {
    expect(dkimCnameRecords('acme.com', ['tok1', 'tok2', 'tok3', 'bad token'])).toEqual([
      { type: 'CNAME', name: 'tok1._domainkey.acme.com', value: 'tok1.dkim.amazonses.com' },
      { type: 'CNAME', name: 'tok2._domainkey.acme.com', value: 'tok2.dkim.amazonses.com' },
      { type: 'CNAME', name: 'tok3._domainkey.acme.com', value: 'tok3.dkim.amazonses.com' },
    ]);
  });

  it('VERIFIED needs BOTH SES verified-for-sending AND DKIM success', () => {
    expect(statusFromIdentity({ verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: [] })).toBe('verified');
    expect(statusFromIdentity({ verifiedForSending: false, dkimStatus: 'SUCCESS', dkimTokens: [] })).toBe('pending');
    expect(statusFromIdentity({ verifiedForSending: true, dkimStatus: 'PENDING', dkimTokens: [] })).toBe('pending');
    expect(statusFromIdentity({ verifiedForSending: false, dkimStatus: 'FAILED', dkimTokens: [] })).toBe('failed');
    expect(statusFromIdentity({ verifiedForSending: false, dkimStatus: 'TEMPORARY_FAILURE', dkimTokens: [] })).toBe('temporary_failure');
  });

  it('the TS domain pattern matches the migration CHECK exactly', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261220000000_w4_tenant_sending_domains.sql'), 'utf8');
    const pattern = SENDING_DOMAIN_RE.source.replace(/\\\//g, '/');
    expect(sql).toContain(`domain ~ '${pattern}'`);
  });
});

// ── Registration ────────────────────────────────────────────────────────────

describe('W4 registration — ownership', () => {
  it('registers an owned domain: pending row, DKIM tokens, the tenant configuration set, eu-north-1', async () => {
    const r = await register('Acme.com');
    expect(r.status).toBe('registered');
    expect(r.domain).toMatchObject({
      organizationId: ORG_A, domain: 'acme.com', status: 'pending', sesRegion: 'eu-north-1',
      configurationSetName: `omnivyra-t-${ORG_A}`, dkimTokens: ['tok1', 'tok2', 'tok3'],
    });
    expect(ses.calls).toEqual([['create', 'acme.com', `omnivyra-t-${ORG_A}`]]);
    expect(rows()[0]).toMatchObject({ created_by: 'user-1' });
  });

  it('registers a SUBDOMAIN of a verified company domain', async () => {
    expect((await register('mail.acme.com')).status).toBe('registered');
  });

  it('accepts an admin_override company domain', async () => {
    db.tables.company_domains = [companyDomain({ verification_status: 'admin_override' })];
    expect((await register('acme.com')).status).toBe('registered');
  });

  it.each(['unverified', 'pending'])('refuses when the company domain is %s — even with the legacy boolean `verified` = true', async (st) => {
    db.tables.company_domains = [companyDomain({ verification_status: st, verified: true })];
    const r = await register('acme.com');
    expect(r).toMatchObject({ status: 'refused', reason: 'domain_not_owned' });
    expect(ses.calls).toHaveLength(0);
    expect(rows()).toHaveLength(0);
  });

  it("refuses a domain verified by ANOTHER tenant, without calling SES", async () => {
    db.tables.company_domains = [companyDomain({ company_id: ORG_B })];
    expect(await register('acme.com')).toMatchObject({ status: 'refused', reason: 'domain_not_owned' });
    expect(ses.calls).toHaveLength(0);
  });

  it('refuses a PARENT of the verified domain', async () => {
    db.tables.company_domains = [companyDomain({ final_domain: 'mail.acme.com' })];
    expect((await register('acme.com')).reason).toBe('domain_not_owned');
  });

  it.each(['acme', 'https://acme.com', '*.acme.com', 'x@acme.com', null])('refuses an invalid domain %p with ZERO database calls', async (d) => {
    expect((await register(d)).reason).toBe('invalid_domain');
    expect(db.calls).toBe(0);
  });

  it('an unreadable company_domains fails closed (retryable), no SES call', async () => {
    db.failures.company_domains = { code: '08006' };
    expect(await register('acme.com')).toMatchObject({ status: 'retryable_failure', reason: 'ownership_unverifiable' });
    expect(ses.calls).toHaveLength(0);
  });
});

describe('W4 registration — one live owner per domain, idempotency, races', () => {
  it('a repeat by the owning tenant is idempotent: no second SES create', async () => {
    await register('acme.com');
    const again = await register('acme.com');
    expect(again.status).toBe('already_registered');
    expect(ses.calls.filter((c) => c[0] === 'create')).toHaveLength(1);
    expect(rows()).toHaveLength(1);
  });

  it("another tenant's live registration is refused as unavailable — nothing is revealed or called", async () => {
    rows().push({ id: 'sd-x', organization_id: ORG_B, domain: 'acme.com', status: 'verified', removed_at: null, dkim_tokens: ['t'], ses_region: 'eu-north-1', configuration_set_name: 'x' });
    const r = await register('acme.com');
    expect(r).toMatchObject({ status: 'refused', reason: 'domain_unavailable', domain: null });
    expect(ses.calls).toHaveLength(0);
  });

  it('a lost race (23505) resolves to the winner: another tenant → unavailable', async () => {
    // Another tenant's row lands between our lookup and our insert, so OUR insert
    // collides on the real unique index and the re-read decides the answer.
    db.onInsert = (table) => {
      if (table !== 'tenant_sending_domains') return;
      rows().push({ id: 'sd-w', organization_id: ORG_B, domain: 'acme.com', status: 'pending', removed_at: null, dkim_tokens: [], ses_region: 'eu-north-1', configuration_set_name: 'x' });
    };
    const r = await register('acme.com');
    expect(r).toMatchObject({ status: 'refused', reason: 'domain_unavailable' });
    expect(ses.calls).toHaveLength(0);
    expect(rows().filter((x) => x.organization_id === ORG_A)).toHaveLength(0);
  });

  it('a lost race to the SAME tenant (double submit) resolves to that row and completes it', async () => {
    db.onInsert = (table) => {
      if (table !== 'tenant_sending_domains') return;
      rows().push({ id: 'sd-same', organization_id: ORG_A, domain: 'acme.com', status: 'pending', removed_at: null, dkim_tokens: [], ses_region: 'eu-north-1', configuration_set_name: `omnivyra-t-${ORG_A}` });
    };
    const r = await register('acme.com');
    expect(r.domain).toMatchObject({ id: 'sd-same', dkimTokens: ['tok1', 'tok2', 'tok3'] });
    expect(rows()).toHaveLength(1);
  });
});

describe('W4 registration — SES provider outcomes fail closed', () => {
  it('with NO adapter wired (the default), registration stops at a pending row with no DKIM tokens', async () => {
    const r = await registerSendingDomain({ organizationId: ORG_A, domain: 'acme.com', actorUserId: null }, { now: () => NOW });
    expect(r).toMatchObject({ status: 'terminal_failure', reason: 'ses_provider_not_configured' });
    expect(rows()[0]).toMatchObject({ status: 'pending', dkim_tokens: [], last_error_code: 'ses_provider_not_configured' });
  });

  it('…and a later attempt, once an adapter exists, completes the SAME row', async () => {
    await registerSendingDomain({ organizationId: ORG_A, domain: 'acme.com', actorUserId: null }, { now: () => NOW });
    const r = await register('acme.com');
    expect(r.status).toBe('already_registered');
    expect(r.domain?.dkimTokens).toEqual(['tok1', 'tok2', 'tok3']);
    expect(rows()).toHaveLength(1);
  });

  it.each([['throttled', 'retryable_failure'], ['unavailable', 'retryable_failure'], ['access_denied', 'terminal_failure'], ['invalid_request', 'terminal_failure']])(
    'SES %s → %s, nothing marked verified', async (code, status) => {
      ses.failCreate = code as SesIdentityErrorCode;
      const r = await register('acme.com');
      expect(r).toMatchObject({ status, reason: `ses_${code}` });
      expect(rows()[0].status).toBe('pending');
    },
  );

  it("an identity that already exists in SES with THIS tenant's configuration set is ADOPTED (its tokens read back)", async () => {
    ses.identities.set('acme.com', { configurationSetName: CS_A, verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['a1', 'a2', 'a3'] });
    const r = await register('acme.com');
    expect(r.domain).toMatchObject({ status: 'verified', dkimTokens: ['a1', 'a2', 'a3'] });
    expect(rows()[0].verified_at).toBe(NOW.toISOString());
  });
});

// ── Status, refresh ─────────────────────────────────────────────────────────

describe('W4 status and DNS instructions', () => {
  it('returns DKIM CNAMEs and read-only SPF/DMARC diagnostics with guidance', async () => {
    const { domain } = await register('acme.com');
    const res = await getSendingDomain(ORG_A, domain!.id, { emailAuth: async () => ({ spf: true, dmarc: false, configured: true, domain: 'acme.com' }) });
    expect(res.status).toBe('found');
    expect(res.detail?.dnsRecords).toHaveLength(3);
    expect(res.detail?.diagnostics).toMatchObject({ spf: true, dmarc: false });
    expect(res.detail?.diagnostics.guidance.join(' ')).toMatch(/DMARC/);
  });

  it("another tenant's id is NOT FOUND — no data", async () => {
    const { domain } = await register('acme.com');
    expect(await getSendingDomain(ORG_B, domain!.id)).toEqual({ status: 'not_found', detail: null });
  });

  it('a failing diagnostic does not fail the read', async () => {
    const { domain } = await register('acme.com');
    const res = await getSendingDomain(ORG_A, domain!.id, { emailAuth: async () => { throw new Error('dns down'); } });
    expect(res.status).toBe('found');
    expect(res.detail?.diagnostics).toMatchObject({ spf: false, dmarc: false });
  });
});

describe('W4 refresh — never upgrades on error', () => {
  const registered = async () => (await register('acme.com')).domain!.id;

  it('SES verified + DKIM success → verified, verified_at set', async () => {
    const id = await registered();
    ses.identities.set('acme.com', { configurationSetName: CS_A, verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['tok1', 'tok2', 'tok3'] });
    const r = await refreshSendingDomainStatus(ORG_A, id, deps());
    expect(r.domain).toMatchObject({ status: 'verified', verifiedAt: NOW.toISOString() });
  });

  it.each([['FAILED', 'failed'], ['TEMPORARY_FAILURE', 'temporary_failure'], ['PENDING', 'pending']])('DKIM %s → %s', async (dkim, status) => {
    const id = await registered();
    ses.identities.set('acme.com', { configurationSetName: CS_A, verifiedForSending: false, dkimStatus: dkim as never, dkimTokens: ['tok1', 'tok2', 'tok3'] });
    expect((await refreshSendingDomainStatus(ORG_A, id, deps())).domain?.status).toBe(status);
  });

  it('a throttled SES read keeps a VERIFIED domain verified (no downgrade, no upgrade) and is retryable', async () => {
    const id = await registered();
    ses.identities.set('acme.com', { configurationSetName: CS_A, verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['t1', 't2', 't3'] });
    await refreshSendingDomainStatus(ORG_A, id, deps());
    ses.failGet = 'throttled';
    const r = await refreshSendingDomainStatus(ORG_A, id, deps());
    expect(r).toMatchObject({ status: 'retryable_failure', reason: 'ses_throttled' });
    expect(rows()[0].status).toBe('verified');
  });

  it('a pending domain stays pending when SES cannot be read', async () => {
    const id = await registered();
    ses.failGet = 'unavailable';
    await refreshSendingDomainStatus(ORG_A, id, deps());
    expect(rows()[0].status).toBe('pending');
  });

  it('an identity deleted in SES → failed (ses_identity_missing)', async () => {
    const id = await registered();
    ses.identities.delete('acme.com');
    const r = await refreshSendingDomainStatus(ORG_A, id, deps());
    expect(r).toMatchObject({ status: 'refreshed', reason: 'ses_identity_missing' });
    expect(rows()[0]).toMatchObject({ status: 'failed', verified_at: null });
  });

  it('lapsed website ownership → failed, even when SES still says verified', async () => {
    const id = await registered();
    ses.identities.set('acme.com', { configurationSetName: CS_A, verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['t1', 't2', 't3'] });
    db.tables.company_domains = [companyDomain({ verification_status: 'unverified' })];
    const r = await refreshSendingDomainStatus(ORG_A, id, deps());
    expect(r.reason).toBe('ownership_lapsed');
    expect(rows()[0].status).toBe('failed');
  });

  it("another tenant cannot refresh this tenant's domain", async () => {
    const id = await registered();
    expect((await refreshSendingDomainStatus(ORG_B, id, deps())).status).toBe('not_found');
    expect(ses.calls.filter((c) => c[0] === 'get')).toHaveLength(0);
  });
});

// ── Sender validation ───────────────────────────────────────────────────────

describe('W4 sender validation — only an exact, verified, still-owned domain of the same tenant', () => {
  async function verifiedDomain(domain = 'acme.com', org = ORG_A) {
    const { domain: rec } = await registerSendingDomain({ organizationId: org, domain, actorUserId: null }, deps());
    ses.identities.set(domain, { configurationSetName: configurationSetNameFor(org), verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['t1', 't2', 't3'] });
    await refreshSendingDomainStatus(org, rec!.id, deps());
  }

  it('accepts and returns the tenant configuration set', async () => {
    await verifiedDomain();
    expect(await validateSender({ organizationId: ORG_A, fromAddress: 'Hello@ACME.com' }, SV)).toEqual({
      ok: true, domain: 'acme.com', configurationSetName: `omnivyra-t-${ORG_A}`, reason: null,
    });
  });

  it('refuses a registered but UNVERIFIED domain', async () => {
    await register('acme.com');
    expect((await validateSender({ organizationId: ORG_A, fromAddress: 'a@acme.com' }, SV)).reason).toBe('domain_not_verified');
  });

  it('refuses a SUBDOMAIN of a verified domain (needs its own registration)', async () => {
    await verifiedDomain();
    expect((await validateSender({ organizationId: ORG_A, fromAddress: 'a@mail.acme.com' }, SV)).reason).toBe('domain_not_registered');
  });

  it("refuses ANOTHER tenant's verified domain", async () => {
    db.tables.company_domains.push(companyDomain({ company_id: ORG_B, final_domain: 'beta.com' }));
    await verifiedDomain('beta.com', ORG_B);
    expect(await validateSender({ organizationId: ORG_A, fromAddress: 'a@beta.com' }, SV)).toMatchObject({ ok: false, reason: 'domain_not_registered' });
  });

  it('refuses when website ownership has LAPSED since verification', async () => {
    await verifiedDomain();
    db.tables.company_domains = [companyDomain({ verification_status: 'pending' })];
    expect((await validateSender({ organizationId: ORG_A, fromAddress: 'a@acme.com' }, SV)).reason).toBe('ownership_lapsed');
  });

  it.each(['Acme <a@acme.com>', 'not-an-address', '', null])('refuses an invalid sender %p with zero database calls', async (addr) => {
    const before = db.calls;
    expect((await validateSender({ organizationId: ORG_A, fromAddress: addr }, SV)).reason).toBe('invalid_sender_address');
    expect(db.calls).toBe(before);
  });

  it('a lookup failure refuses (fail closed)', async () => {
    await verifiedDomain();
    db.failures.tenant_sending_domains = { op: 'select', code: '08006' };
    expect((await validateSender({ organizationId: ORG_A, fromAddress: 'a@acme.com' }, SV)).reason).toBe('lookup_failed');
  });

  it('a tenant-less request refuses', async () => {
    expect((await validateSender({ organizationId: ' ', fromAddress: 'a@acme.com' }, SV)).reason).toBe('tenant_required');
  });
});

describe('W4 migration draft', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261220000000_w4_tenant_sending_domains.sql'), 'utf8');

  it('is tenant-owned, RLS service-role only, one live owner per domain', () => {
    expect(sql).toMatch(/organization_id\s+uuid NOT NULL REFERENCES public\.companies \(id\) ON DELETE RESTRICT,/);
    expect(sql).not.toMatch(/ON DELETE CASCADE/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_sending_domains_live_domain\s+ON public\.tenant_sending_domains \(domain\)\s+WHERE removed_at IS NULL OR ses_identity_state = 'delete_pending';/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/FOR ALL USING \(auth\.role\(\) = 'service_role'\) WITH CHECK \(auth\.role\(\) = 'service_role'\)/);
    expect(sql).toMatch(/CONSTRAINT tenant_sending_domains_id_tenant UNIQUE \(id, organization_id\)/);
    expect(sql).toMatch(/CHECK \(status IN \('pending', 'verified', 'failed', 'temporary_failure', 'removed'\)\)/);
  });

  it('has a rollback', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'supabase/migrations/rollbacks/w4_tenant_sending_domains_rollback.sql'))).toBe(true);
  });
});

// ── A1: reserved domains, adoption, DKIM preservation ──────────────────────

describe('W4 A1 — reserved platform domains', () => {
  it.each([['omnivyra.com'], ['mail.omnivyra.com'], ['a.b.omnivyra.com'], ['OMNIVYRA.COM'], ['omnivyra.com.']])('%s is reserved', (d) => {
    expect(isReservedSendingDomain(d)).toBe(true);
  });

  it.each([['notomnivyra.com'], ['omnivyra.co'], ['omnivyra.com.example.org'], ['omnivyra-com.net'], ['xomnivyra.com'], ['acme.com']])(
    'the lookalike %s is NOT reserved (whole-label matching)', (d) => {
      expect(isReservedSendingDomain(d)).toBe(false);
    },
  );

  it.each([[''], ['not a domain'], [null], [42]])('an input that is not a hostname (%p) is treated as reserved (fail closed)', (d) => {
    expect(isReservedSendingDomain(d)).toBe(true);
  });

  it('registration refuses a reserved domain before any database or SES call, even with verified ownership', async () => {
    db.tables.company_domains.push(companyDomain({ final_domain: 'omnivyra.com', verification_status: 'admin_override' }));
    const before = db.calls;
    expect(await register('news.omnivyra.com')).toMatchObject({ status: 'refused', reason: 'domain_reserved' });
    expect(db.calls).toBe(before);
    expect(ses.calls).toHaveLength(0);
    expect(rows()).toHaveLength(0);
  });

  it('a lookalike of a reserved domain proceeds to the normal ownership check', async () => {
    expect((await register('notomnivyra.com')).reason).toBe('domain_not_owned');
  });
});

describe('W4 A1 — an existing SES identity is adopted only when it is provably this tenant\'s', () => {
  it('the ownership rule: exact configuration set only', () => {
    const s = (c: unknown): SesIdentityState => ({ verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: [], configurationSetName: c as string });
    expect(identityBelongsToConfigurationSet(s(CS_A), CS_A)).toBe(true);
    expect(identityBelongsToConfigurationSet(s(`omnivyra-t-${ORG_B}`), CS_A)).toBe(false);
    expect(identityBelongsToConfigurationSet(s(CS_A.toUpperCase()), CS_A)).toBe(false);
    expect(identityBelongsToConfigurationSet(s(null), CS_A)).toBe(false);
    expect(identityBelongsToConfigurationSet(s(undefined), CS_A)).toBe(false);
    expect(identityBelongsToConfigurationSet(s(''), '')).toBe(false);
  });

  it.each([
    ["another tenant's", `omnivyra-t-${ORG_B}`],
    ['a missing', undefined],
  ])('an existing identity with %s configuration set is refused (terminal) and nothing of it is stored', async (_label, cs) => {
    ses.identities.set('acme.com', { verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['f1', 'f2', 'f3'], configurationSetName: cs as string });
    const r = await register('acme.com');
    expect(r).toMatchObject({ status: 'terminal_failure', reason: 'ses_identity_not_adoptable' });
    expect(rows()[0]).toMatchObject({ status: 'pending', dkim_tokens: [], verified_at: null });
    expect(JSON.stringify(r)).not.toContain('f1');
    expect(ses.calls.map((c) => c[0])).toEqual(['create', 'get']);
  });

  it('a non-DOMAIN existing identity (SES read is incomplete) is refused as not adoptable', async () => {
    ses.identities.set('acme.com', { verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: [] });
    ses.failGet = 'incomplete_response';
    expect(await register('acme.com')).toMatchObject({ status: 'terminal_failure', reason: 'ses_identity_not_adoptable' });
  });

  it('an SES lookup failure during adoption adopts nothing and stays retryable', async () => {
    ses.identities.set('acme.com', { configurationSetName: CS_A, verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['t1'] });
    ses.failGet = 'throttled';
    expect(await register('acme.com')).toMatchObject({ status: 'retryable_failure', reason: 'ses_throttled' });
    expect(rows()[0]).toMatchObject({ status: 'pending', dkim_tokens: [] });
  });

  it('a refused adoption is not completed by a later refresh', async () => {
    ses.identities.set('acme.com', { verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['f1'], configurationSetName: `omnivyra-t-${ORG_B}` });
    const { domain } = await register('acme.com');
    const r = await refreshSendingDomainStatus(ORG_A, domain!.id, deps());
    expect(r).toMatchObject({ status: 'refreshed', reason: 'ses_identity_not_adoptable' });
    expect(rows()[0]).toMatchObject({ status: 'failed', verified_at: null });
    expect((await validateSender({ organizationId: ORG_A, fromAddress: 'a@acme.com' }, SV)).ok).toBe(false);
  });

  it('no SES call at all when website ownership fails, even if an identity exists', async () => {
    ses.identities.set('acme.com', { configurationSetName: CS_A, verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['t1'] });
    expect((await register('acme.com', ORG_B)).reason).toBe('domain_not_owned');
    expect(ses.calls).toHaveLength(0);
  });
});

describe('W4 A1 — refresh keeps DKIM instructions when SES reports no tokens', () => {
  it.each([[[]], [undefined]])('tokens %p in the read keep the stored tokens', async (tokens) => {
    const { domain } = await register('acme.com');
    ses.identities.set('acme.com', { configurationSetName: CS_A, verifiedForSending: false, dkimStatus: 'PENDING', dkimTokens: tokens as unknown as string[] ?? [] });
    await refreshSendingDomainStatus(ORG_A, domain!.id, deps());
    expect(rows()[0].dkim_tokens).toEqual(['tok1', 'tok2', 'tok3']);
  });

  it('present tokens replace the stored ones', async () => {
    const { domain } = await register('acme.com');
    ses.identities.set('acme.com', { configurationSetName: CS_A, verifiedForSending: false, dkimStatus: 'PENDING', dkimTokens: ['n1', 'n2', 'n3'] });
    await refreshSendingDomainStatus(ORG_A, domain!.id, deps());
    expect(rows()[0].dkim_tokens).toEqual(['n1', 'n2', 'n3']);
  });

  it('a refresh error still changes nothing but the error fields', async () => {
    const { domain } = await register('acme.com');
    ses.failGet = 'unavailable';
    await refreshSendingDomainStatus(ORG_A, domain!.id, deps());
    expect(rows()[0]).toMatchObject({ status: 'pending', dkim_tokens: ['tok1', 'tok2', 'tok3'], last_error_code: 'ses_unavailable' });
  });
});

// ── Final hardening: company status, verification freshness, identity lifecycle ──

const HOUR = 60 * 60 * 1000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

async function verifiedAcme(org = ORG_A) {
  const { domain } = await registerSendingDomain({ organizationId: org, domain: 'acme.com', actorUserId: null }, deps());
  ses.identities.set('acme.com', { configurationSetName: configurationSetNameFor(org), verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['t1', 't2', 't3'] });
  await refreshSendingDomainStatus(org, domain!.id, deps());
  return domain!.id;
}
const sendAs = (org = ORG_A, now = NOW, extra: Record<string, unknown> = {}) =>
  validateSender({ organizationId: org, fromAddress: 'a@acme.com' }, { now: () => now, ...extra });
const company = (over: Record<string, unknown>) => { db.tables.companies = [{ id: ORG_A, status: 'active', deleted_at: null, ...over }]; };

describe('W4 sender validation — the company itself must be active', () => {
  it('an active, non-deleted company with a fresh verified domain is accepted', async () => {
    await verifiedAcme();
    expect(await sendAs()).toMatchObject({ ok: true, configurationSetName: CS_A });
  });

  it.each([
    ['soft-deleted (deleted_at set, status inactive)', { status: 'inactive', deleted_at: '2026-10-19T00:00:00.000Z' }, 'company_deleted'],
    ['soft-deleted even if status still reads active', { status: 'active', deleted_at: '2026-10-19T00:00:00.000Z' }, 'company_deleted'],
    ['inactive (disable_company_cascade)', { status: 'inactive' }, 'company_inactive'],
    ['suspended', { status: 'suspended' }, 'company_inactive'],
    ['an unrecognised status', { status: 'archived' }, 'company_inactive'],
    ['a case-variant status', { status: 'ACTIVE' }, 'company_inactive'],
    ['a null status', { status: null }, 'company_inactive'],
    ['a malformed deleted_at', { deleted_at: 'yesterday' }, 'company_deleted'],
  ])('a company that is %s is refused even with a verified domain', async (_label, over, reason) => {
    await verifiedAcme();
    company(over);
    expect(await sendAs()).toEqual({ ok: false, domain: null, configurationSetName: null, reason });
  });

  it('a missing company row is refused', async () => {
    await verifiedAcme();
    db.tables.companies = [];
    expect((await sendAs()).reason).toBe('company_not_found');
  });

  it("a record for ANOTHER company is refused (filtered out, or returned by a misbehaving answer)", async () => {
    await verifiedAcme();
    db.tables.companies = [{ id: ORG_B, status: 'active', deleted_at: null }];
    expect((await sendAs()).reason).toBe('company_not_found');
    // The database ignores the id filter and answers with another, ACTIVE company.
    db.answers.companies = { id: ORG_B, status: 'active', deleted_at: null };
    expect((await sendAs()).reason).toBe('company_not_found');
  });

  it.each([['a string', 'active'], ['an array', [{ id: ORG_A, status: 'active', deleted_at: null }]], ['a record without an id', { status: 'active', deleted_at: null }]])(
    'a malformed company answer (%s) is refused', async (_label, answer) => {
      await verifiedAcme();
      db.answers.companies = answer;
      expect((await sendAs()).reason).toBe('company_not_found');
    },
  );

  it('a database error reading the company refuses (fail closed)', async () => {
    await verifiedAcme();
    db.failures.companies = { op: 'select', code: '08006' };
    expect((await sendAs()).reason).toBe('lookup_failed');
  });
});

describe('W4 sender validation — verification freshness', () => {
  it('fresh within the window; stale beyond it (default 48h, proposed)', async () => {
    await verifiedAcme();
    expect(DEFAULT_MAX_VERIFICATION_AGE_MS).toBe(48 * HOUR);
    expect((await sendAs(ORG_A, at(47 * HOUR))).ok).toBe(true);
    expect(await sendAs(ORG_A, at(49 * HOUR))).toMatchObject({ ok: false, reason: 'verification_stale' });
  });

  it('a stricter caller-supplied window is honoured', async () => {
    await verifiedAcme();
    expect((await sendAs(ORG_A, at(2 * HOUR), { maxVerificationAgeMs: HOUR })).reason).toBe('verification_stale');
  });

  it.each([[0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]])('an invalid freshness policy (%p) refuses', async (maxVerificationAgeMs) => {
    await verifiedAcme();
    expect((await sendAs(ORG_A, NOW, { maxVerificationAgeMs })).reason).toBe('freshness_policy_invalid');
  });

  it('a refresh ERROR does not renew freshness; a successful refresh does', async () => {
    const id = await verifiedAcme();
    ses.failGet = 'throttled';
    await refreshSendingDomainStatus(ORG_A, id, { ses, now: () => at(47 * HOUR) });
    expect(rows()[0].status).toBe('verified');
    expect(rows()[0].verified_at).toBe(NOW.toISOString());
    expect((await sendAs(ORG_A, at(49 * HOUR))).reason).toBe('verification_stale');
    ses.failGet = null;
    await refreshSendingDomainStatus(ORG_A, id, { ses, now: () => at(47 * HOUR) });
    expect((await sendAs(ORG_A, at(49 * HOUR))).ok).toBe(true);
  });

  it.each([
    ['in the future (beyond clock skew)', () => at(2 * HOUR).toISOString(), 'verification_timestamp_in_future'],
    ['malformed', () => 'not-a-date', 'verification_timestamp_invalid'],
    ['missing', () => null, 'verification_missing'],
    ['a number, not a timestamp', () => 12345, 'verification_missing'],
  ])('a verification timestamp that is %s refuses', async (_label, value, reason) => {
    await verifiedAcme();
    rows()[0].verified_at = value();
    expect((await sendAs()).reason).toBe(reason);
  });

  it('a timestamp within the tolerated clock skew is accepted', async () => {
    await verifiedAcme();
    rows()[0].verified_at = at(4 * 60 * 1000).toISOString();
    expect((await sendAs()).ok).toBe(true);
  });

  it('the freshness rule in isolation', () => {
    expect(verificationFreshnessFailure(NOW.toISOString(), NOW, HOUR)).toBeNull();
    expect(verificationFreshnessFailure(at(-HOUR - 1).toISOString(), NOW, HOUR)).toBe('verification_stale');
    expect(verificationFreshnessFailure('', NOW, HOUR)).toBe('verification_missing');
  });
});

describe('W4 sender validation — a verified status alone is not enough', () => {
  it("a row marked verified but whose identity Omnivyra does not hold ('none') is refused", async () => {
    await verifiedAcme();
    rows()[0].ses_identity_state = 'none';
    expect((await sendAs()).reason).toBe('identity_not_held');
  });

  it.each([['missing'], ['delete_pending'], ['deleted'], [undefined], ['bogus']])('identity state %p is refused', async (state) => {
    await verifiedAcme();
    rows()[0].ses_identity_state = state;
    expect((await sendAs()).reason).toBe('identity_not_held');
  });

  it("a row carrying ANOTHER tenant's configuration set is refused", async () => {
    await verifiedAcme();
    rows()[0].configuration_set_name = `omnivyra-t-${ORG_B}`;
    expect((await sendAs()).reason).toBe('configuration_set_mismatch');
  });

  it("another tenant cannot pass with this tenant's fresh, verified record", async () => {
    await verifiedAcme();
    expect((await sendAs(ORG_B)).reason).toBe('domain_not_registered');
  });
});

describe('W4 SES identity lifecycle — recorded by the service', () => {
  it("a new row starts 'none'; a confirmed create makes it 'created'", async () => {
    const r = await register('acme.com');
    expect(r.domain?.identityState).toBe('created');
    expect(rows()[0].ses_identity_state).toBe('created');
  });

  it("an existing identity with the exact tenant set is 'adopted'", async () => {
    ses.identities.set('acme.com', { configurationSetName: CS_A, verifiedForSending: false, dkimStatus: 'PENDING', dkimTokens: ['t1'] });
    expect((await register('acme.com')).domain?.identityState).toBe('adopted');
  });

  it("a refused adoption leaves the row at 'none' (no identity associated)", async () => {
    ses.identities.set('acme.com', { configurationSetName: `omnivyra-t-${ORG_B}`, verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['t1'] });
    await register('acme.com');
    expect(rows()[0].ses_identity_state).toBe('none');
  });

  it("a failed create leaves the row at 'none'", async () => {
    ses.failCreate = 'throttled';
    await register('acme.com');
    expect(rows()[0].ses_identity_state).toBe('none');
  });

  it("an identity observed ABSENT on refresh becomes 'missing' (never 'deleted')", async () => {
    const { domain } = await register('acme.com');
    ses.identities.delete('acme.com');
    await refreshSendingDomainStatus(ORG_A, domain!.id, deps());
    expect(rows()[0]).toMatchObject({ ses_identity_state: 'missing', status: 'failed' });
  });

  describe("re-registering a domain whose identity went 'missing' (it must not be stuck)", () => {
    async function goneMissing() {
      const { domain } = await register('acme.com');
      ses.identities.delete('acme.com');
      await refreshSendingDomainStatus(ORG_A, domain!.id, deps());
      expect(rows()[0]).toMatchObject({ ses_identity_state: 'missing', status: 'failed' });
      expect((rows()[0].dkim_tokens as unknown[]).length).toBeGreaterThan(0); // stale tokens are kept
      ses.calls.length = 0;
    }

    it('re-creates the identity: a CreateEmailIdentity is sent and the row is held again', async () => {
      await goneMissing();
      const r = await register('acme.com');
      expect(ses.calls.map((c) => c[0])).toEqual(['create']);
      expect(r.domain?.identityState).toBe('created');
      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toMatchObject({ ses_identity_state: 'created', status: 'pending', last_error_code: null });
    });

    it("re-adopts an identity that reappeared with EXACTLY this tenant's configuration set", async () => {
      await goneMissing();
      ses.identities.set('acme.com', { configurationSetName: CS_A, verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['n1', 'n2', 'n3'] });
      const r = await register('acme.com');
      expect(r.domain).toMatchObject({ identityState: 'adopted', status: 'verified', dkimTokens: ['n1', 'n2', 'n3'] });
    });

    it("still refuses an identity that reappeared under ANOTHER configuration set (stays 'missing', never verified)", async () => {
      await goneMissing();
      ses.identities.set('acme.com', { configurationSetName: `omnivyra-t-${ORG_B}`, verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['f1'] });
      expect(await register('acme.com')).toMatchObject({ status: 'terminal_failure', reason: 'ses_identity_not_adoptable' });
      expect(rows()[0]).toMatchObject({ ses_identity_state: 'missing', status: 'failed', verified_at: null });
    });

    it('a domain whose identity is still HELD keeps the no-SES-call shortcut', async () => {
      await register('acme.com');
      ses.calls.length = 0;
      expect((await register('acme.com')).status).toBe('already_registered');
      expect(ses.calls).toHaveLength(0);
    });
  });

  it("a 'none' row whose identity a refresh proves is the tenant's becomes 'adopted'", async () => {
    ses.failCreate = 'unavailable';
    const { domain } = await register('acme.com');
    ses.failCreate = null;
    ses.identities.set('acme.com', { configurationSetName: CS_A, verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['t1'] });
    await refreshSendingDomainStatus(ORG_A, domain!.id, deps());
    expect(rows()[0]).toMatchObject({ ses_identity_state: 'adopted', status: 'verified' });
  });

  it("a refresh never moves a row out of a deletion state (write refused, nothing upgraded)", async () => {
    const { domain } = await register('acme.com');
    rows()[0].ses_identity_state = 'delete_pending';
    ses.identities.set('acme.com', { configurationSetName: CS_A, verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['t1'] });
    const r = await refreshSendingDomainStatus(ORG_A, domain!.id, deps());
    expect(r).toMatchObject({ status: 'retryable_failure', reason: 'write_failed' });
    expect(rows()[0]).toMatchObject({ ses_identity_state: 'delete_pending', status: 'pending' });
  });
});

describe('W4 SES identity lifecycle — transition rules', () => {
  const ALLOWED: Array<[string, string]> = [
    ['none', 'created'], ['none', 'adopted'], ['none', 'missing'],
    ['created', 'delete_pending'], ['created', 'missing'],
    ['adopted', 'delete_pending'], ['adopted', 'missing'],
    ['missing', 'created'], ['missing', 'adopted'],
    ['delete_pending', 'deleted'], ['delete_pending', 'missing'],
  ];

  it('exactly the documented transitions are allowed (plus same-state writes)', () => {
    for (const from of SES_IDENTITY_STATES) {
      for (const to of SES_IDENTITY_STATES) {
        const expected = from === to || ALLOWED.some(([f, t]) => f === from && t === to);
        expect([from, to, canTransitionIdentityState(from, to)]).toEqual([from, to, expected]);
      }
    }
  });

  it('deletion is only entered from created/adopted; deleted is terminal; missing never becomes deleted', () => {
    expect(SES_IDENTITY_STATES.filter((s) => canTransitionIdentityState(s, 'delete_pending') && s !== 'delete_pending')).toEqual(['created', 'adopted']);
    expect(SES_IDENTITY_TRANSITIONS.deleted).toEqual([]);
    expect(canTransitionIdentityState('missing', 'deleted')).toBe(false);
    expect(canTransitionIdentityState('none', 'deleted')).toBe(false);
  });

  it.each([['bogus', 'created'], ['none', 'bogus'], [null, 'none'], [undefined, undefined]])('unknown states (%p → %p) are never allowed', (from, to) => {
    expect(canTransitionIdentityState(from, to)).toBe(false);
  });

  it('the migration trigger and CHECK mirror the TypeScript lifecycle exactly', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261220000000_w4_tenant_sending_domains.sql'), 'utf8');
    const block = /\(OLD\.ses_identity_state, NEW\.ses_identity_state\) IN \(([\s\S]*?)\n\s*\) THEN/.exec(sql);
    expect(block).not.toBeNull();
    const pairs = [...block![1].matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => [m[1], m[2]]);
    const tsPairs = Object.entries(SES_IDENTITY_TRANSITIONS).flatMap(([f, ts]) => ts.map((t) => [f, t]));
    expect(pairs.sort()).toEqual(tsPairs.sort());
    const check = /ses_identity_state_valid\s+CHECK \(ses_identity_state IN \(([^)]*)\)\)/.exec(sql);
    expect(check![1].split(',').map((x) => x.trim().replace(/'/g, ''))).toEqual([...SES_IDENTITY_STATES]);
    expect(sql).toMatch(/IF NEW\.ses_identity_state <> 'none' THEN/);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF ses_identity_state ON public\.tenant_sending_domains/);
    expect(sql).toMatch(/CHECK \(status <> 'verified' OR ses_identity_state IN \('created', 'adopted'\)\)/);
    expect(sql).toMatch(/CHECK \(ses_identity_state NOT IN \('delete_pending', 'deleted'\) OR status = 'removed'\)/);
    expect(sql).toMatch(/CHECK \(ses_identity_state <> 'deleted' OR ses_delete_attempted_at IS NOT NULL\)/);
    expect(sql).toMatch(/SET search_path = public, pg_temp/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.tenant_sending_domains_identity_guard\(\) FROM PUBLIC, anon, authenticated;/);
  });

  it('the rollback states plainly that it does not delete SES identities, and removes the guard function', () => {
    const rb = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/rollbacks/w4_tenant_sending_domains_rollback.sql'), 'utf8');
    expect(rb).toMatch(/THIS DOES NOT TOUCH AWS/);
    expect(rb).toMatch(/export the reconciliation record/);
    expect(rb).toMatch(/DROP TABLE IF EXISTS public\.tenant_sending_domains;\s*\nDROP FUNCTION IF EXISTS public\.tenant_sending_domains_identity_guard\(\);/);
  });
});

describe('W4 future deletion — preconditions (pure, not wired)', () => {
  const live = (over: Record<string, unknown> = {}) => ({ isDomainIdentity: true, configurationSetName: CS_A, ...over });
  const pre = (over: Record<string, unknown> = {}) =>
    deletionPreconditionFailure({ domain: 'acme.com', organizationId: ORG_A, lifecycleState: 'created', liveIdentity: live(), ...over } as never);

  it('all preconditions met → null', () => {
    expect(pre()).toBeNull();
    expect(pre({ lifecycleState: 'adopted' })).toBeNull();
  });

  it.each([
    ['a reserved domain', { domain: 'mail.omnivyra.com' }, 'domain_reserved'],
    ['a reserved domain even with a matching set', { domain: 'omnivyra.com', liveIdentity: live() }, 'domain_reserved'],
    ['state none', { lifecycleState: 'none' }, 'state_not_deletable'],
    ['state missing', { lifecycleState: 'missing' }, 'state_not_deletable'],
    ['state deleted', { lifecycleState: 'deleted' }, 'state_not_deletable'],
    ['an unknown state', { lifecycleState: 'bogus' }, 'state_not_deletable'],
    ['no fresh SES read', { liveIdentity: null }, 'identity_not_read'],
    ['a non-domain identity', { liveIdentity: live({ isDomainIdentity: false }) }, 'not_a_domain_identity'],
    ["another tenant's set", { liveIdentity: live({ configurationSetName: `omnivyra-t-${ORG_B}` }) }, 'configuration_set_mismatch'],
    ['no configuration set', { liveIdentity: live({ configurationSetName: null }) }, 'configuration_set_mismatch'],
  ])('%s → refused (%s)', (_label, over, reason) => {
    expect(pre(over)).toBe(reason);
  });
});
