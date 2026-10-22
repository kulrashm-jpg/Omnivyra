/**
 * W4 — tenant sending domains (Model A).
 *
 * Register a domain a tenant owns as an SES domain identity, report the DNS the
 * tenant must publish, refresh verification, and decide whether a given From
 * address may be used. Every path is tenant-scoped and fails CLOSED: an
 * unverified domain, an SES error, a missing provider, an unreadable table or an
 * ownership that cannot be proven is a refusal, never a send.
 *
 * OWNERSHIP. A sending domain must equal, or be a subdomain of, a
 * `company_domains.final_domain` of the SAME tenant whose `verification_status`
 * is `verified` or `admin_override`. (`verified` the boolean column defaults to
 * true and is NOT evidence.) `final_domain` is unique (`unique_final_domain`,
 * migration 20260611), so another tenant's exact domain can never match.
 * Ownership is re-checked at every sender validation, so a lapsed website
 * verification stops sending.
 *
 * RESERVED DOMAINS. `omnivyra.com` and every subdomain are platform mail and are
 * refused before any lookup (`isReservedSendingDomain`).
 *
 * NO ADOPTION OF FOREIGN IDENTITIES. SES identities are global to the AWS
 * account. An identity that already exists is treated as this tenant's ONLY
 * when SES reports exactly the tenant's configuration set
 * (`omnivyra-t-<organizationId>`); otherwise it is refused as
 * `ses_identity_not_adoptable` (terminal), on registration AND on refresh, and
 * it is never modified. Nothing about the foreign identity is stored or returned.
 *
 * ONE LIVE OWNER PER DOMAIN, enforced by `uq_tenant_sending_domains_live_domain`.
 * A domain held by another tenant is refused with the same answer as one that
 * is simply unavailable, so registration cannot be used to probe other tenants.
 *
 * NOTHING HERE WRITES DNS. SPF/DMARC are read-only diagnostics.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { checkEmailAuth, type EmailAuthStatus } from '../emailAuthService';
import {
  DEFAULT_MAX_VERIFICATION_AGE_MS,
  canTransitionIdentityState,
  configurationSetNameFor,
  dkimCnameRecords,
  isReservedSendingDomain,
  isSameOrSubdomainOf,
  normalizeSendingDomain,
  senderAddressDomain,
  verificationFreshnessFailure,
  type DnsRecordInstruction,
  type SesIdentityLifecycleState,
} from './sendingDomainRules';
import {
  RETRYABLE_SES_IDENTITY_ERRORS,
  SesIdentityError,
  identityBelongsToConfigurationSet,
  statusFromIdentity,
  type SesIdentityApi,
  type SesIdentityState,
} from './sesIdentityPort';
import { resolveSesIdentityApi } from './sesV2IdentityAdapter';

export const SENDING_DOMAINS_TABLE = 'tenant_sending_domains';
const COMPANY_DOMAINS_TABLE = 'company_domains';
const OWNERSHIP_STATUSES = ['verified', 'admin_override'] as const;
const COMPANIES_TABLE = 'companies';
const COLUMNS = 'id, organization_id, domain, status, ses_region, configuration_set_name, dkim_tokens, dkim_signing_hosted_zone, ses_identity_state, last_error_code, last_checked_at, verified_at, removed_at, created_at';

export interface SendingDomainRecord {
  id: string;
  organizationId: string;
  domain: string;
  status: string;
  sesRegion: string;
  configurationSetName: string;
  dkimTokens: string[];
  dkimSigningHostedZone: string | null;
  /** Omnivyra's knowledge of the SES identity (see SES_IDENTITY_STATES). */
  identityState: string;
  lastErrorCode: string | null;
  lastCheckedAt: string | null;
  verifiedAt: string | null;
}

export interface ServiceDeps {
  ses?: SesIdentityApi;
  now?: () => Date;
  emailAuth?: (domain: string) => Promise<EmailAuthStatus>;
}

type Row = Record<string, unknown>;

const toRecord = (r: Row): SendingDomainRecord => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  domain: String(r.domain),
  status: String(r.status),
  sesRegion: String(r.ses_region),
  configurationSetName: String(r.configuration_set_name),
  dkimTokens: Array.isArray(r.dkim_tokens) ? (r.dkim_tokens as unknown[]).map(String) : [],
  dkimSigningHostedZone: typeof r.dkim_signing_hosted_zone === 'string' ? r.dkim_signing_hosted_zone : null,
  identityState: typeof r.ses_identity_state === 'string' ? r.ses_identity_state : 'none',
  lastErrorCode: typeof r.last_error_code === 'string' ? r.last_error_code : null,
  lastCheckedAt: typeof r.last_checked_at === 'string' ? r.last_checked_at : null,
  verifiedAt: typeof r.verified_at === 'string' ? r.verified_at : null,
});

async function query(op: () => PromiseLike<{ data?: unknown; error?: unknown }>): Promise<{ data: unknown; failed: boolean; code: string | null }> {
  try {
    const res = await op();
    if (res?.error) return { data: null, failed: true, code: (res.error as { code?: string })?.code ?? null };
    return { data: res?.data ?? null, failed: false, code: null };
  } catch {
    return { data: null, failed: true, code: null };
  }
}

/**
 * Does this tenant own `domain` through a verified company domain?
 * `null` = could not be determined (caller fails closed).
 */
async function tenantOwnsDomain(organizationId: string, domain: string): Promise<boolean | null> {
  const res = await query(() => ownedDbTable(COMPANY_DOMAINS_TABLE)
    .select('final_domain, verification_status')
    .eq('company_id', organizationId)           // TENANT FIRST, always
    .in('verification_status', [...OWNERSHIP_STATUSES]));
  if (res.failed) return null;
  const rows = (Array.isArray(res.data) ? res.data : []) as Row[];
  return rows.some((r) => {
    const finalDomain = normalizeSendingDomain(r.final_domain);
    return finalDomain !== null && OWNERSHIP_STATUSES.includes(r.verification_status as never)
      && isSameOrSubdomainOf(domain, finalDomain);
  });
}

/** The tenant's own configuration set, or '' (which never matches) when it cannot be formed. */
function expectedConfigurationSet(organizationId: string): string {
  try { return configurationSetNameFor(organizationId); } catch { return ''; }
}

const NOT_ADOPTABLE = 'ses_identity_not_adoptable';

async function recordError(organizationId: string, id: string, code: string, now: () => Date): Promise<void> {
  await query(() => ownedDbTable(SENDING_DOMAINS_TABLE)
    .update({ last_error_code: code, last_checked_at: now().toISOString(), updated_at: now().toISOString() })
    .eq('organization_id', organizationId).eq('id', id));
}

async function liveRowForDomain(domain: string): Promise<{ row: Row | null; failed: boolean }> {
  const res = await query(() => ownedDbTable(SENDING_DOMAINS_TABLE)
    .select(COLUMNS).eq('domain', domain).is('removed_at', null));
  if (res.failed) return { row: null, failed: true };
  const rows = (Array.isArray(res.data) ? res.data : []) as Row[];
  return { row: rows[0] ?? null, failed: false };
}

// ── Registration ────────────────────────────────────────────────────────────

export interface RegisterOutcome {
  status: 'registered' | 'already_registered' | 'refused' | 'retryable_failure' | 'terminal_failure';
  domain: SendingDomainRecord | null;
  reason: string | null;
}

const outcome = (status: RegisterOutcome['status'], reason: string | null, domain: SendingDomainRecord | null = null): RegisterOutcome =>
  ({ status, reason, domain });

/**
 * Register a tenant sending domain and create (or adopt) its SES identity.
 * Idempotent for the owning tenant: a repeat completes a registration whose
 * SES step had not finished, and otherwise returns the existing record.
 */
export async function registerSendingDomain(
  input: { organizationId: string; domain: unknown; actorUserId: string | null },
  deps: ServiceDeps = {},
): Promise<RegisterOutcome> {
  const ses = deps.ses ?? resolveSesIdentityApi();
  const now = deps.now ?? (() => new Date());
  const organizationId = String(input.organizationId ?? '').trim();
  if (!organizationId) return outcome('refused', 'tenant_required');

  const domain = normalizeSendingDomain(input.domain);
  if (!domain) return outcome('refused', 'invalid_domain');
  if (isReservedSendingDomain(domain)) return outcome('refused', 'domain_reserved');

  const owns = await tenantOwnsDomain(organizationId, domain);
  if (owns === null) return outcome('retryable_failure', 'ownership_unverifiable');
  if (!owns) return outcome('refused', 'domain_not_owned');

  const existing = await liveRowForDomain(domain);
  if (existing.failed) return outcome('retryable_failure', 'lookup_failed');
  let row = existing.row;
  if (row && row.organization_id !== organizationId) return outcome('refused', 'domain_unavailable');

  if (!row) {
    const inserted = await query(() => ownedDbTable(SENDING_DOMAINS_TABLE).insert({
      organization_id: organizationId,
      domain,
      status: 'pending',
      ses_region: ses.region,
      configuration_set_name: configurationSetNameFor(organizationId),
      ses_identity_state: 'none',
      created_by: input.actorUserId,
    }).select(COLUMNS).single());
    if (inserted.failed) {
      if (inserted.code !== '23505') return outcome('retryable_failure', 'write_failed');
      // Lost a race for the domain. Whoever won decides the answer.
      const winner = await liveRowForDomain(domain);
      if (winner.failed || !winner.row) return outcome('retryable_failure', 'lookup_failed');
      if (winner.row.organization_id !== organizationId) return outcome('refused', 'domain_unavailable');
      row = winner.row;
    } else {
      row = inserted.data as Row;
    }
  } else if (
    (row.ses_identity_state === 'created' || row.ses_identity_state === 'adopted')
    && Array.isArray(row.dkim_tokens) && row.dkim_tokens.length > 0
  ) {
    // Only an identity Omnivyra still HOLDS is "already registered". A row
    // whose identity went 'missing' (or was never associated) must be able to
    // create or adopt it again — otherwise the tenant is stuck for good.
    return outcome('already_registered', null, toRecord(row));
  }

  // Create the SES identity — or, if it already exists, adopt it ONLY when it
  // is provably this tenant's (see header). A refused adoption stores nothing
  // from the foreign identity and never modifies it.
  const rowId = String(row.id);
  const refuseAdoption = async (): Promise<RegisterOutcome> => {
    await recordError(organizationId, rowId, NOT_ADOPTABLE, now);
    return outcome('terminal_failure', NOT_ADOPTABLE, toRecord({ ...row, last_error_code: NOT_ADOPTABLE }));
  };
  let state: SesIdentityState;
  let adopting = false;
  try {
    try {
      state = await ses.createDomainIdentity({ domain, configurationSetName: String(row.configuration_set_name) });
    } catch (e) {
      if (!(e instanceof SesIdentityError) || e.code !== 'already_exists') throw e;
      adopting = true;
      state = await ses.getDomainIdentity(domain);
    }
  } catch (e) {
    // An existing identity SES cannot describe as a DOMAIN cannot be proven ours.
    if (adopting && e instanceof SesIdentityError && e.code === 'incomplete_response') return refuseAdoption();
    const code = e instanceof SesIdentityError ? e.code : 'unavailable';
    await recordError(organizationId, rowId, `ses_${code}`, now);
    const retryable = e instanceof SesIdentityError ? RETRYABLE_SES_IDENTITY_ERRORS.has(e.code) : true;
    return outcome(retryable ? 'retryable_failure' : 'terminal_failure', `ses_${code}`, toRecord({ ...row, last_error_code: `ses_${code}` }));
  }
  if (adopting && !identityBelongsToConfigurationSet(state, expectedConfigurationSet(organizationId))) return refuseAdoption();

  const updated = await persistIdentityState(organizationId, rowId, state, now, row.ses_identity_state, adopting ? 'adopted' : 'created');
  if (!updated) return outcome('retryable_failure', 'write_failed', toRecord(row));
  return outcome(existing.row ? 'already_registered' : 'registered', null, updated);
}

const currentIdentityState = (v: unknown): SesIdentityLifecycleState =>
  (typeof v === 'string' ? v : 'none') as SesIdentityLifecycleState;

/**
 * Persist an SES read together with the lifecycle state it proves. A
 * transition the lifecycle does not allow is NOT written (and the database
 * trigger would refuse it anyway): the caller sees a write failure.
 */
async function persistIdentityState(
  organizationId: string,
  id: string,
  state: SesIdentityState,
  now: () => Date,
  fromIdentityState: unknown,
  toIdentityState: SesIdentityLifecycleState,
): Promise<SendingDomainRecord | null> {
  const from = currentIdentityState(fromIdentityState);
  if (!canTransitionIdentityState(from, toIdentityState)) return null;
  const status = statusFromIdentity(state);
  const at = now().toISOString();
  const patch: Row = {
    status,
    ses_identity_state: toIdentityState,
    // Keep the stored DKIM tokens when SES reports none: an empty read must not
    // erase the DNS instructions the tenant has (or is about to) publish.
    ...(state.dkimTokens.length > 0 ? { dkim_tokens: state.dkimTokens.slice(0, 3) } : {}),
    last_error_code: null,
    last_checked_at: at,
    updated_at: at,
    verified_at: status === 'verified' ? at : null,
    // Keep a previously reported zone when SES omits it on a later read.
    ...(state.dkimSigningHostedZone ? { dkim_signing_hosted_zone: state.dkimSigningHostedZone } : {}),
  };
  const res = await query(() => ownedDbTable(SENDING_DOMAINS_TABLE)
    .update(patch).eq('organization_id', organizationId).eq('id', id).select(COLUMNS).single());
  if (res.failed || !res.data) return null;
  return toRecord(res.data as Row);
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listSendingDomains(organizationId: string): Promise<{ ok: boolean; domains: SendingDomainRecord[] }> {
  const res = await query(() => ownedDbTable(SENDING_DOMAINS_TABLE)
    .select(COLUMNS).eq('organization_id', organizationId).is('removed_at', null));
  if (res.failed) return { ok: false, domains: [] };
  return { ok: true, domains: ((Array.isArray(res.data) ? res.data : []) as Row[]).map(toRecord) };
}

/** Tenant-scoped: another tenant's id is simply not found. */
async function loadOwnRow(organizationId: string, id: string): Promise<{ row: Row | null; failed: boolean }> {
  const res = await query(() => ownedDbTable(SENDING_DOMAINS_TABLE)
    .select(COLUMNS).eq('organization_id', organizationId).eq('id', id).maybeSingle());
  if (res.failed) return { row: null, failed: true };
  const row = res.data as Row | null;
  if (row && row.organization_id !== organizationId) return { row: null, failed: false };
  return { row, failed: false };
}

export interface SendingDomainDetail {
  domain: SendingDomainRecord;
  dnsRecords: DnsRecordInstruction[];
  /** Read-only diagnostics; nothing here changes the tenant's DNS. */
  diagnostics: { spf: boolean; dmarc: boolean; guidance: string[] };
}

export async function getSendingDomain(
  organizationId: string,
  id: string,
  deps: ServiceDeps = {},
): Promise<{ status: 'found' | 'not_found' | 'retryable_failure'; detail: SendingDomainDetail | null }> {
  const loaded = await loadOwnRow(organizationId, id);
  if (loaded.failed) return { status: 'retryable_failure', detail: null };
  if (!loaded.row || loaded.row.removed_at) return { status: 'not_found', detail: null };
  const record = toRecord(loaded.row);

  const emailAuth = deps.emailAuth ?? checkEmailAuth;
  let auth: EmailAuthStatus = { spf: false, dmarc: false, configured: false, domain: record.domain };
  try { auth = await emailAuth(record.domain); } catch { /* diagnostics are best-effort */ }

  const guidance: string[] = [];
  if (!auth.dmarc) guidance.push('No DMARC record found at _dmarc.<domain>. Publish one (start with p=none) before sending at volume.');
  if (!auth.spf) guidance.push('No SPF record found. SES signs with DKIM; SPF alignment needs a custom MAIL FROM domain, which is not configured by this feature.');
  return {
    status: 'found',
    detail: { domain: record, dnsRecords: dkimCnameRecords(record.domain, record.dkimTokens, record.dkimSigningHostedZone), diagnostics: { spf: auth.spf, dmarc: auth.dmarc, guidance } },
  };
}

// ── Refresh ─────────────────────────────────────────────────────────────────

export interface RefreshOutcome {
  status: 'refreshed' | 'not_found' | 'retryable_failure' | 'terminal_failure';
  domain: SendingDomainRecord | null;
  reason: string | null;
}

/**
 * Re-read the SES identity and update our status. A failed read never
 * UPGRADES anything: the stored status is kept and the error recorded. A domain
 * whose ownership has lapsed, or whose SES identity has disappeared, is marked
 * `failed`.
 */
export async function refreshSendingDomainStatus(organizationId: string, id: string, deps: ServiceDeps = {}): Promise<RefreshOutcome> {
  const ses = deps.ses ?? resolveSesIdentityApi();
  const now = deps.now ?? (() => new Date());
  const loaded = await loadOwnRow(organizationId, id);
  if (loaded.failed) return { status: 'retryable_failure', domain: null, reason: 'lookup_failed' };
  if (!loaded.row || loaded.row.removed_at) return { status: 'not_found', domain: null, reason: null };
  const row = loaded.row;
  const domain = String(row.domain);

  const owns = await tenantOwnsDomain(organizationId, domain);
  if (owns === null) return { status: 'retryable_failure', domain: toRecord(row), reason: 'ownership_unverifiable' };
  if (!owns) {
    const failed = await markFailed(organizationId, String(row.id), 'ownership_lapsed', now);
    return { status: failed ? 'refreshed' : 'retryable_failure', domain: failed ?? toRecord(row), reason: 'ownership_lapsed' };
  }

  try {
    const state = await ses.getDomainIdentity(domain);
    // Never let a refresh adopt an identity registration refused (or one that
    // was re-pointed out of band): no tenant configuration set, no status.
    if (!identityBelongsToConfigurationSet(state, expectedConfigurationSet(organizationId))) {
      const failed = await markFailed(organizationId, String(row.id), NOT_ADOPTABLE, now);
      return { status: failed ? 'refreshed' : 'retryable_failure', domain: failed ?? toRecord(row), reason: NOT_ADOPTABLE };
    }
    // The exact configuration-set match above is what proves the identity is
    // this tenant's: a row whose create was never confirmed ('none') or whose
    // identity had gone ('missing') becomes 'adopted'; created/adopted stay.
    const from = currentIdentityState(row.ses_identity_state);
    const to: SesIdentityLifecycleState = from === 'created' || from === 'adopted' ? from : 'adopted';
    const updated = await persistIdentityState(organizationId, String(row.id), state, now, from, to);
    if (!updated) return { status: 'retryable_failure', domain: toRecord(row), reason: 'write_failed' };
    return { status: 'refreshed', domain: updated, reason: null };
  } catch (e) {
    const code = e instanceof SesIdentityError ? e.code : 'unavailable';
    if (code === 'not_found') {
      // Observed absent — recorded as `missing`, never as "we deleted it".
      const failed = await markFailed(organizationId, String(row.id), 'ses_identity_missing', now,
        canTransitionIdentityState(currentIdentityState(row.ses_identity_state), 'missing') ? 'missing' : undefined);
      return { status: failed ? 'refreshed' : 'retryable_failure', domain: failed ?? toRecord(row), reason: 'ses_identity_missing' };
    }
    await query(() => ownedDbTable(SENDING_DOMAINS_TABLE)
      .update({ last_error_code: `ses_${code}`, last_checked_at: now().toISOString(), updated_at: now().toISOString() })
      .eq('organization_id', organizationId).eq('id', String(row.id)));
    const retryable = e instanceof SesIdentityError ? RETRYABLE_SES_IDENTITY_ERRORS.has(e.code) : true;
    return { status: retryable ? 'retryable_failure' : 'terminal_failure', domain: toRecord(row), reason: `ses_${code}` };
  }
}

async function markFailed(
  organizationId: string,
  id: string,
  code: string,
  now: () => Date,
  identityState?: SesIdentityLifecycleState,
): Promise<SendingDomainRecord | null> {
  const at = now().toISOString();
  const res = await query(() => ownedDbTable(SENDING_DOMAINS_TABLE)
    .update({ status: 'failed', verified_at: null, last_error_code: code, last_checked_at: at, updated_at: at, ...(identityState ? { ses_identity_state: identityState } : {}) })
    .eq('organization_id', organizationId).eq('id', id).select(COLUMNS).single());
  if (res.failed || !res.data) return null;
  return toRecord(res.data as Row);
}

// ── Sender validation ───────────────────────────────────────────────────────

export interface SenderValidation {
  ok: boolean;
  domain: string | null;
  configurationSetName: string | null;
  reason: string | null;
}

const refuse = (reason: string): SenderValidation => ({ ok: false, domain: null, configurationSetName: null, reason });

/**
 * Is the tenant itself allowed to act? Same rule as TenantGuard (only
 * `status = 'active'`), plus `deleted_at` as defence in depth (as in
 * adsDueSubjects): a soft-deleted, inactive, suspended, missing or
 * unrecognised company is refused. `null` = could not be determined.
 */
async function companyActiveFailure(organizationId: string): Promise<string | null> {
  const res = await query(() => ownedDbTable(COMPANIES_TABLE)
    .select('id, status, deleted_at').eq('id', organizationId).maybeSingle());
  if (res.failed) return 'lookup_failed';
  const company = res.data as Row | null;
  if (!company || typeof company !== 'object' || company.id !== organizationId) return 'company_not_found';
  if (company.deleted_at !== null && company.deleted_at !== undefined) return 'company_deleted';
  if (company.status !== 'active') return 'company_inactive';
  return null;
}

export interface SenderValidationDeps {
  now?: () => Date;
  /** Max age of the last successful SES verification. Default: DEFAULT_MAX_VERIFICATION_AGE_MS (proposed, owner review). */
  maxVerificationAgeMs?: number;
}

/**
 * May this tenant send From `fromAddress`? ALL of these must hold, and anything
 * uncertain is a refusal:
 *   • the company is active and not deleted;
 *   • the address's domain is an EXACT registered domain of the SAME tenant
 *     (a subdomain needs its own registration);
 *   • SES confirmed sending readiness AND DKIM success (`status = verified`);
 *   • Omnivyra holds the identity (`created`/`adopted`) under EXACTLY the
 *     tenant's configuration set;
 *   • that verification is recent (`verified_at`, written only by a successful
 *     SES read — an error never renews it) and not in the future;
 *   • website ownership still holds.
 * Not wired into any send path yet.
 */
export async function validateSender(
  input: { organizationId: string; fromAddress: unknown },
  deps: SenderValidationDeps = {},
): Promise<SenderValidation> {
  const now = deps.now ?? (() => new Date());
  const maxAgeMs = deps.maxVerificationAgeMs ?? DEFAULT_MAX_VERIFICATION_AGE_MS;
  const organizationId = String(input.organizationId ?? '').trim();
  if (!organizationId) return refuse('tenant_required');
  const domain = senderAddressDomain(input.fromAddress);
  if (!domain) return refuse('invalid_sender_address');

  const companyFailure = await companyActiveFailure(organizationId);
  if (companyFailure) return refuse(companyFailure);

  const res = await query(() => ownedDbTable(SENDING_DOMAINS_TABLE)
    .select(COLUMNS).eq('organization_id', organizationId).eq('domain', domain).is('removed_at', null));
  if (res.failed) return refuse('lookup_failed');
  const rows = ((Array.isArray(res.data) ? res.data : []) as Row[]).filter((r) => r.organization_id === organizationId);
  if (rows.length === 0) return refuse('domain_not_registered');
  if (rows.length > 1) return refuse('ambiguous_registration');
  const row = rows[0];
  if (row.status !== 'verified') return refuse('domain_not_verified');
  if (row.ses_identity_state !== 'created' && row.ses_identity_state !== 'adopted') return refuse('identity_not_held');
  if (row.configuration_set_name !== expectedConfigurationSet(organizationId)) return refuse('configuration_set_mismatch');
  const stale = verificationFreshnessFailure(row.verified_at, now(), maxAgeMs);
  if (stale) return refuse(stale);

  const owns = await tenantOwnsDomain(organizationId, domain);
  if (owns === null) return refuse('lookup_failed');
  if (!owns) return refuse('ownership_lapsed');

  return { ok: true, domain, configurationSetName: String(row.configuration_set_name), reason: null };
}
