/**
 * W4 — pure rules for tenant sending domains. No I/O.
 *
 * WHY A DEDICATED NORMALISER. `normalizeCompanyDomain` is built for website
 * inputs and may reduce a host to its registrable domain; a sending domain such
 * as `mail.acme.com` must keep every label, because the SES identity, the DKIM
 * records and the From address all name it exactly.
 */

/** Must stay identical to the CHECK in 20261220000000_w4_tenant_sending_domains.sql. */
export const SENDING_DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const MAX_DOMAIN_LENGTH = 253;

/**
 * The canonical form of a sending domain, or null when the input is not a plain
 * hostname. Refuses URLs, addresses, wildcards, IP literals and single labels;
 * never guesses (no scheme stripping, no `www.` removal).
 */
export function normalizeSendingDomain(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let d = input.trim().toLowerCase();
  if (d.endsWith('.')) d = d.slice(0, -1);
  if (d === '' || d.length > MAX_DOMAIN_LENGTH) return null;
  if (/[\s@/:*?#[\]\\]/.test(d)) return null;
  if (!SENDING_DOMAIN_RE.test(d)) return null;
  return d;
}

/** True when `candidate` is `parent` or a subdomain of it (label-aligned). */
export function isSameOrSubdomainOf(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.endsWith(`.${parent}`);
}

/**
 * Platform-controlled domains. No tenant may register, adopt or remove an SES
 * identity at or under these: they carry Omnivyra's own mail.
 */
export const RESERVED_SENDING_DOMAINS: readonly string[] = ['omnivyra.com'];

/**
 * True when `domain` is a reserved domain or a subdomain of one. Whole-label
 * matching only: `notomnivyra.com` and `omnivyra.com.example.org` are NOT
 * reserved. An input that is not a plain hostname is treated as reserved, so a
 * caller that forgot to normalise fails closed.
 *
 * This is the single check for every identity-mutating path — registration
 * today, and `DeleteEmailIdentity` in the future removal path, which MUST call
 * it before any deletion.
 */
export function isReservedSendingDomain(domain: unknown): boolean {
  const d = normalizeSendingDomain(domain);
  if (d === null) return true;
  return RESERVED_SENDING_DOMAINS.some((reserved) => isSameOrSubdomainOf(d, reserved));
}

/** The normalised domain of a sender address, or null when it is not one. */
export function senderAddressDomain(address: unknown): string | null {
  if (typeof address !== 'string') return null;
  const trimmed = address.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || trimmed.indexOf('@') !== at) return null;
  const local = trimmed.slice(0, at);
  if (/[\s<>"]/.test(local)) return null;
  return normalizeSendingDomain(trimmed.slice(at + 1));
}

/** SES configuration-set names: `[A-Za-z0-9_-]{1,64}`. */
const CONFIGURATION_SET_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The tenant's configuration set. One per tenant, so each tenant's delivery,
 * bounce and complaint events (and, later, reputation metrics) are separable.
 * Deterministic: re-deriving it never invents a second set.
 */
export function configurationSetNameFor(organizationId: string): string {
  const name = `omnivyra-t-${String(organizationId).trim().toLowerCase()}`;
  if (!CONFIGURATION_SET_RE.test(name)) throw new Error('organization id cannot form a configuration-set name');
  return name;
}

// ── SES identity lifecycle ──────────────────────────────────────────────────

/**
 * What Omnivyra knows about the SES identity behind a sending-domain row.
 * Must stay identical to `tenant_sending_domains_ses_identity_state_valid` and
 * the transition trigger in 20261220000000_w4_tenant_sending_domains.sql.
 *
 *   none            no identity is associated with this row (create not yet
 *                   confirmed, or an existing identity was REFUSED)
 *   created         SES confirmed a create made with this tenant's set
 *   adopted         an existing identity was read and reported EXACTLY this
 *                   tenant's configuration set
 *   delete_pending  the row is removed and the identity is queued for deletion
 *                   (retryable after transient AWS errors)
 *   deleted         Omnivyra deleted it (terminal)
 *   missing         the identity was ABSENT when observed — never "we deleted it"
 */
export const SES_IDENTITY_STATES = ['none', 'created', 'adopted', 'delete_pending', 'deleted', 'missing'] as const;
export type SesIdentityLifecycleState = typeof SES_IDENTITY_STATES[number];

/**
 * Allowed transitions (a same-state write is always allowed). Deletion is only
 * ever entered from `created`/`adopted`; `deleted` is terminal.
 *
 * Idempotency policy for a future delete: `delete_pending → deleted` when
 * DeleteEmailIdentity succeeds, OR when it answers NotFound AFTER this row
 * recorded a delete attempt (`ses_delete_attempted_at`) — our own earlier
 * delete whose response was lost. NotFound with NO recorded attempt is
 * `missing`: something else removed it, and we must not claim we did.
 */
export const SES_IDENTITY_TRANSITIONS: Readonly<Record<SesIdentityLifecycleState, readonly SesIdentityLifecycleState[]>> = {
  none: ['created', 'adopted', 'missing'],
  created: ['delete_pending', 'missing'],
  adopted: ['delete_pending', 'missing'],
  missing: ['created', 'adopted'],
  delete_pending: ['deleted', 'missing'],
  deleted: [],
};

export function canTransitionIdentityState(from: unknown, to: unknown): boolean {
  if (!SES_IDENTITY_STATES.includes(from as never) || !SES_IDENTITY_STATES.includes(to as never)) return false;
  if (from === to) return true;
  return SES_IDENTITY_TRANSITIONS[from as SesIdentityLifecycleState].includes(to as SesIdentityLifecycleState);
}

/** States in which Omnivyra holds the identity and may (after a live re-check) queue it for deletion. */
export const DELETABLE_IDENTITY_STATES: readonly SesIdentityLifecycleState[] = ['created', 'adopted'];

/**
 * The preconditions a FUTURE `DeleteEmailIdentity` must satisfy — every one,
 * from a FRESH SES read; a database row alone never authorizes a deletion.
 * Pure: the caller supplies the live read. Not wired to anything yet.
 */
export function deletionPreconditionFailure(input: {
  domain: unknown;
  organizationId: string;
  lifecycleState: unknown;
  liveIdentity: { isDomainIdentity: boolean; configurationSetName: string | null } | null;
}): string | null {
  if (isReservedSendingDomain(input.domain)) return 'domain_reserved';
  if (!DELETABLE_IDENTITY_STATES.includes(input.lifecycleState as never)) return 'state_not_deletable';
  if (!input.liveIdentity) return 'identity_not_read';
  if (input.liveIdentity.isDomainIdentity !== true) return 'not_a_domain_identity';
  let expected = '';
  try { expected = configurationSetNameFor(input.organizationId); } catch { return 'tenant_invalid'; }
  if (input.liveIdentity.configurationSetName !== expected) return 'configuration_set_mismatch';
  return null;
}

// ── Sender freshness ────────────────────────────────────────────────────────

/**
 * PROPOSED default (owner review): a sending domain's last successful SES
 * verification must be at most 48 hours old to authorize a send. No refresh
 * scheduler exists yet; this is the bound a daily refresh with one missed run
 * would still satisfy. Callers may pass a stricter value.
 */
export const DEFAULT_MAX_VERIFICATION_AGE_MS = 48 * 60 * 60 * 1000;
/** Clock skew tolerated for a verification timestamp slightly in the future. */
export const MAX_VERIFICATION_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** null = fresh; otherwise why the verification timestamp cannot be trusted. */
export function verificationFreshnessFailure(verifiedAt: unknown, now: Date, maxAgeMs: number): string | null {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return 'freshness_policy_invalid';
  if (typeof verifiedAt !== 'string' || verifiedAt.trim() === '') return 'verification_missing';
  const at = Date.parse(verifiedAt);
  if (!Number.isFinite(at)) return 'verification_timestamp_invalid';
  const age = now.getTime() - at;
  if (age < -MAX_VERIFICATION_CLOCK_SKEW_MS) return 'verification_timestamp_in_future';
  if (age > maxAgeMs) return 'verification_stale';
  return null;
}

export interface DnsRecordInstruction {
  type: 'CNAME';
  name: string;
  value: string;
}

/** AWS's documented Easy DKIM zone; used only when SES reports none. */
export const DEFAULT_DKIM_HOSTED_ZONE = 'dkim.amazonses.com';

/**
 * Easy DKIM: one CNAME per token, `<token>._domainkey.<domain>` →
 * `<token>.<zone>`, where the zone is the `SigningHostedZone` SES reported for
 * the identity. Instructions only — nothing writes DNS.
 */
export function dkimCnameRecords(domain: string, tokens: readonly string[], hostedZone?: string | null): DnsRecordInstruction[] {
  const zone = hostedZone || DEFAULT_DKIM_HOSTED_ZONE;
  return tokens
    .filter((t) => typeof t === 'string' && /^[a-z0-9]+$/i.test(t))
    .map((t) => ({ type: 'CNAME' as const, name: `${t}._domainkey.${domain}`, value: `${t}.${zone}` }));
}
