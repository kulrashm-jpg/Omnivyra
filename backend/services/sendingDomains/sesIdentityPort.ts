/**
 * W4 — the SES identity port.
 *
 * WHY A PORT. The domain service sees only this interface; every AWS SDK detail
 * lives in `sesV2IdentityAdapter.ts`. `resolveSesIdentityApi()` (in that file)
 * returns the SESv2 adapter ONLY when `SENDING_DOMAINS_SES_PROVIDER=sesv2` is
 * set AND the dedicated `SENDING_DOMAINS_AWS_ACCESS_KEY_ID` /
 * `SENDING_DOMAINS_AWS_SECRET_ACCESS_KEY` pair is valid (never the generic AWS
 * credential chain); otherwise `unconfiguredSesIdentityApi` below refuses every call with
 * `provider_not_configured`, so nothing reaches AWS by accident and every
 * caller fails closed. The business rules are tested against fakes.
 *
 * The SESv2 adapter maps `CreateEmailIdentity` / `GetEmailIdentity` (identity
 * type DOMAIN, Easy DKIM) onto `SesIdentityState`:
 *   VerifiedForSendingStatus         → verifiedForSending (literal true only)
 *   DkimAttributes.Status            → dkimStatus (unrecognised → null)
 *   DkimAttributes.Tokens            → dkimTokens
 *   DkimAttributes.SigningHostedZone → dkimSigningHostedZone
 *   ConfigurationSetName (Get only)  → configurationSetName
 * and SDK errors onto `SesIdentityErrorCode` — see `sesV2ErrorCode` there for
 * the full table. Only `throttled` and `unavailable` are retryable; an
 * unclassified error is `unknown`, which is terminal.
 */

/** The only region outreach sends from (see the SES audit). */
export const SES_SENDING_REGION = 'eu-north-1';

export type SesIdentityErrorCode =
  | 'provider_not_configured'
  | 'already_exists'
  | 'not_found'
  /** A create named a configuration set SES does not have. Terminal. */
  | 'configuration_set_not_found'
  | 'throttled'
  | 'access_denied'
  | 'invalid_request'
  | 'unavailable'
  /** Account identity quota reached. Terminal. */
  | 'limit_exceeded'
  /** SES answered without the fields a decision needs. Terminal; never a success. */
  | 'incomplete_response'
  /** Unclassified. Terminal: an unknown failure is not retried. */
  | 'unknown';

export class SesIdentityError extends Error {
  constructor(readonly code: SesIdentityErrorCode) {
    super(`ses identity: ${code}`);
    this.name = 'SesIdentityError';
  }
}

/** Errors a retry can change. */
export const RETRYABLE_SES_IDENTITY_ERRORS: ReadonlySet<SesIdentityErrorCode> = new Set(['throttled', 'unavailable']);

export type DkimStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'TEMPORARY_FAILURE' | 'NOT_STARTED';

export interface SesIdentityState {
  verifiedForSending: boolean;
  dkimStatus: DkimStatus | null;
  dkimTokens: string[];
  /** SES's `DkimAttributes.SigningHostedZone` — the CNAME target zone — when it reports one. */
  dkimSigningHostedZone?: string | null;
  /**
   * The identity's default configuration set, as SES reports it on a read.
   * null/absent = none reported (a create response carries none).
   */
  configurationSetName?: string | null;
}

/**
 * May this tenant treat an EXISTING SES identity as its own? Only when SES
 * reports exactly the tenant's configuration set. Absent, malformed or any
 * other value ⇒ no: the identity belongs to someone else (the platform, or a
 * previous holder of the domain) and is never adopted or modified.
 */
export function identityBelongsToConfigurationSet(state: SesIdentityState, expectedConfigurationSetName: string): boolean {
  return typeof state.configurationSetName === 'string'
    && expectedConfigurationSetName.length > 0
    && state.configurationSetName === expectedConfigurationSetName;
}

export interface SesIdentityApi {
  readonly region: string;
  /** Create the DOMAIN identity with Easy DKIM and the tenant's default configuration set. */
  createDomainIdentity(input: { domain: string; configurationSetName: string }): Promise<SesIdentityState>;
  /** Read the identity. Throws `not_found` when SES has no such identity. */
  getDomainIdentity(domain: string): Promise<SesIdentityState>;
}

/** The default: nothing is wired, so everything fails closed. */
export const unconfiguredSesIdentityApi: SesIdentityApi = {
  region: SES_SENDING_REGION,
  async createDomainIdentity() { throw new SesIdentityError('provider_not_configured'); },
  async getDomainIdentity() { throw new SesIdentityError('provider_not_configured'); },
};

export type SendingDomainStatus = 'pending' | 'verified' | 'failed' | 'temporary_failure';

/**
 * Our status from SES's. VERIFIED only when SES says the identity may send AND
 * DKIM succeeded — never on one signal alone.
 */
export function statusFromIdentity(state: SesIdentityState): SendingDomainStatus {
  if (state.verifiedForSending === true && state.dkimStatus === 'SUCCESS') return 'verified';
  if (state.dkimStatus === 'FAILED') return 'failed';
  if (state.dkimStatus === 'TEMPORARY_FAILURE') return 'temporary_failure';
  return 'pending';
}
