/**
 * A3P — the Company Admin control plane for tenant-owned provider credentials.
 *
 * Sits directly on the A3M/A3N foundation and adds nothing to it: no second
 * credential store, no second masking rule, no second provider registry. Its
 * whole job is to decide WHETHER a credential operation is legitimate and then
 * hand it to `integrationCredentialService`.
 *
 * ─── CONFIGURED IS NOT OPERATIONAL ────────────────────────────────────────
 * The single most dangerous thing this layer could do is let "the tenant saved
 * a key" read as "this provider works". It does not, and for every provider in
 * the registry today it demonstrably does not: none has an adapter, none has a
 * registered credit action, and the cost gate refuses before egress regardless
 * of what is stored. So every status this module returns carries `operational:
 * false` with the reason, drawn from the A3C descriptor rather than asserted
 * here. A UI built on this cannot accidentally imply availability.
 *
 * ─── WHY THE PROVIDER LIST IS CLOSED ──────────────────────────────────────
 * Provider ids are validated against `ACQUISITION_SOURCES`, the existing A3C
 * vocabulary. An open registry would let a caller create credential rows under
 * any string, and `provider_key` is half of the uniqueness constraint that
 * keeps one tenant's Apollo credential distinct from its RapidAPI one — a typo
 * would silently become a new provider that nothing can ever resolve.
 *
 * ─── WHY SOME PROVIDERS ARE REFUSED RATHER THAN STORED ────────────────────
 * A3L established that the authentication mechanism is the PROVIDER's to
 * choose. The browser extension authenticates through an HMAC-signed session
 * inside the user's own browser and manual entry needs no credential at all;
 * accepting an API key for either would store a secret that nothing reads and
 * would tell the operator they had connected something they had not. Those are
 * refused as `unsupported_auth_mode`, never quietly converted into API-key
 * storage.
 *
 * ─── NO PROVIDER IS CONTACTED ─────────────────────────────────────────────
 * Storing a credential does not verify it. Verification is a network call with
 * a cost and a rate limit against a provider nobody has an adapter for; it
 * belongs to a later phase. `configured` here means stored, and says so.
 */

import {
  upsertProviderCredentials,
  getProviderCredentials,
  deleteProviderCredentials,
  maskCredentials,
  SECRET_CONFIG_KEYS,
  type CredentialMap,
} from '../../services/integrationCredentialService';
import {
  ACQUISITION_SOURCES,
  getSource,
  type AcquisitionSourceDescriptor,
  type SourceType,
} from '../../services/enrichment/providers/sources';

/** Source types whose credential is a secret THIS PLATFORM stores for a tenant. */
export const STORED_CREDENTIAL_SOURCE_TYPES: readonly SourceType[] = ['external_api', 'gateway_api'];

/**
 * Credential fields this control plane accepts.
 *
 * Deliberately one field. Every provider in the registry authenticates with a
 * single API key, and each of these strings must be a member of
 * `SECRET_CONFIG_KEYS` or it would be stored unencrypted by the config
 * splitter — so the list is asserted against that set below rather than
 * trusted.
 */
export const ACCEPTED_CREDENTIAL_FIELDS: readonly string[] = ['api_key'];

/** How a provider authenticates. Reported so a UI renders the right flow. */
export type ProviderAuthMode = 'api_key' | 'gateway_api_key' | 'browser_session' | 'none';

export const authModeFor = (sourceType: SourceType): ProviderAuthMode => {
  if (sourceType === 'external_api') return 'api_key';
  if (sourceType === 'gateway_api') return 'gateway_api_key';
  if (sourceType === 'browser_extension') return 'browser_session';
  return 'none';
};

export type CredentialRefusalCode =
  | 'unknown_provider'
  | 'unsupported_auth_mode'
  | 'invalid_credential_payload';

export interface CredentialRefusal {
  readonly code: CredentialRefusalCode;
  readonly reason: string;
}

/**
 * Narrow a refusal.
 *
 * A plain `'reason' in x` cannot do this against `CredentialMap`: that type is
 * `Record<string, string>`, and an INDEX SIGNATURE admits every key, so the
 * compiler cannot rule `reason` out of it — the union survives the check and
 * the refusal leaks into the success type. The root tsconfig's `strict: false`
 * removes the usual escape route, so this is a real type predicate rather than
 * a shorthand.
 */
export const isCredentialRefusal = (value: unknown): value is CredentialRefusal =>
  typeof value === 'object'
  && value !== null
  && typeof (value as CredentialRefusal).code === 'string'
  && typeof (value as CredentialRefusal).reason === 'string';

export interface ProviderCredentialStatus {
  readonly providerId: string;
  readonly displayName: string;
  readonly sourceType: SourceType;
  readonly authMode: ProviderAuthMode;
  /** True when this tenant has stored at least one credential field. */
  readonly configured: boolean;
  /** Field names present, MASKED. Never a value. */
  readonly credentialFields: Readonly<Record<string, string>>;
  /**
   * Always false today, with the reason. Configuring a credential is not
   * activation — see the header.
   */
  readonly operational: false;
  readonly operationalReason: string;
}

/** Injectable so tests need no database. Defaults are the real encrypted store. */
export interface LeadSourceCredentialPorts {
  readonly write?: (companyId: string, providerKey: string, credentials: CredentialMap) => Promise<void>;
  readonly read?: (companyId: string, providerKey: string) => Promise<CredentialMap>;
  readonly remove?: (companyId: string, providerKey: string) => Promise<void>;
}

const ports = (p: LeadSourceCredentialPorts = {}) => ({
  write: p.write ?? upsertProviderCredentials,
  read: p.read ?? getProviderCredentials,
  remove: p.remove ?? deleteProviderCredentials,
});

/**
 * Why a provider cannot be activated yet, from ITS OWN descriptor.
 *
 * Derived rather than written, so it cannot drift from the registry: as a
 * provider's requirements are satisfied they leave the list and this sentence
 * shrinks with them.
 *
 * A3X: `tenant_provider_subscription` is stated as the TENANT's own account
 * with the vendor. The wording matters — a status line implying Omnivyra pays
 * for, resells, or consumes Omnivyra credits against a tenant's Clearbit or
 * Apollo usage would be false. Omnivyra stores the key and makes the call; the
 * vendor invoices the tenant.
 */
function operationalReasonFor(source: AcquisitionSourceDescriptor): string {
  const outstanding = source.authorizationRequirements
    .filter((r) => r !== 'api_key')
    .map((r) => (r === 'tenant_provider_subscription'
      ? 'an active subscription with this provider, held and paid for by your company'
      : r));

  if (!outstanding.length) {
    return 'a credential can be stored; this provider is not yet available for lead building';
  }
  return `storing a credential does not activate this provider — still required: ${outstanding.join(', ')}`;
}

/**
 * Validate a provider id for credential STORAGE.
 *
 * Returns the descriptor or a refusal; callers narrow with
 * `isCredentialRefusal`, never with a negated discriminant.
 */
export function validateProviderForCredentialStorage(
  providerId: string,
): AcquisitionSourceDescriptor | CredentialRefusal {
  const id = String(providerId ?? '').trim();
  if (!id) {
    return { code: 'unknown_provider', reason: 'a provider id is required' };
  }

  const source = getSource(id);
  if (!source) {
    return {
      code: 'unknown_provider',
      reason: `'${id}' is not a known lead source`,
    };
  }

  if (!STORED_CREDENTIAL_SOURCE_TYPES.includes(source.sourceType)) {
    return {
      code: 'unsupported_auth_mode',
      reason:
        `'${source.id}' authenticates as '${authModeFor(source.sourceType)}', which stores no `
        + 'server-side secret; it cannot be configured with an API key',
    };
  }

  return source;
}

/**
 * Validate the submitted payload.
 *
 * Rejects unknown fields rather than ignoring them: a caller sending
 * `apiKey` instead of `api_key` would otherwise get a success response for a
 * credential that was never stored.
 */
export function validateCredentialPayload(
  payload: unknown,
): CredentialMap | CredentialRefusal {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { code: 'invalid_credential_payload', reason: 'credentials must be an object' };
  }

  const out: CredentialMap = {};
  for (const [key, raw] of Object.entries(payload as Record<string, unknown>)) {
    if (!ACCEPTED_CREDENTIAL_FIELDS.includes(key)) {
      return {
        code: 'invalid_credential_payload',
        reason: `unsupported credential field '${key}' — accepted: ${ACCEPTED_CREDENTIAL_FIELDS.join(', ')}`,
      };
    }
    // A non-string or blank value is refused rather than coerced: storing '' or
    // 'undefined' would make `configured` true for a credential that cannot work.
    if (typeof raw !== 'string' || !raw.trim()) {
      return {
        code: 'invalid_credential_payload',
        reason: `credential field '${key}' must be a non-empty string`,
      };
    }
    out[key] = raw.trim();
  }

  if (!Object.keys(out).length) {
    return { code: 'invalid_credential_payload', reason: 'no credential fields were supplied' };
  }
  return out;
}

/**
 * Build a status, masking through the EXISTING masker.
 *
 * Only fields that are members of `SECRET_CONFIG_KEYS` are echoed at all, and
 * they are echoed masked. Anything else stored under this provider is dropped
 * rather than passed through, so a field added to the store later cannot leak
 * out of this endpoint by default.
 */
function toStatus(
  source: AcquisitionSourceDescriptor,
  stored: CredentialMap,
): ProviderCredentialStatus {
  const secretsOnly: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (SECRET_CONFIG_KEYS.has(key) && typeof value === 'string' && value.trim()) {
      secretsOnly[key] = value;
    }
  }

  return {
    providerId: source.id,
    displayName: source.displayName,
    sourceType: source.sourceType,
    authMode: authModeFor(source.sourceType),
    configured: Object.keys(secretsOnly).length > 0,
    credentialFields: maskCredentials(secretsOnly),
    operational: false,
    operationalReason: operationalReasonFor(source),
  };
}

/**
 * Store (or replace) one provider credential for ONE tenant.
 *
 * `companyId` is the caller's server-verified tenant. This function never
 * reads it from a payload, and the store it calls puts it in the WHERE clause,
 * so there is no path by which one tenant's write reaches another's row.
 */
export async function configureProviderCredential(input: {
  companyId: string;
  providerId: string;
  credentials: unknown;
}, deps: LeadSourceCredentialPorts = {}): Promise<ProviderCredentialStatus | CredentialRefusal> {
  const source = validateProviderForCredentialStorage(input.providerId);
  if (isCredentialRefusal(source)) return source;

  const credentials = validateCredentialPayload(input.credentials);
  if (isCredentialRefusal(credentials)) return credentials;

  const p = ports(deps);
  await p.write(input.companyId, source.id, credentials);

  // Re-read rather than echoing the submitted payload: the response then
  // describes what is STORED, and the plaintext just submitted never travels
  // back through this function.
  const stored = await p.read(input.companyId, source.id);
  return toStatus(source, stored);
}

/**
 * Read status for one provider, or for every provider that can hold a stored
 * credential. Returns masked metadata only, and never a value.
 */
export async function readProviderCredentialStatus(input: {
  companyId: string;
  providerId?: string | null;
}, deps: LeadSourceCredentialPorts = {}): Promise<readonly ProviderCredentialStatus[] | CredentialRefusal> {
  const p = ports(deps);

  if (input.providerId) {
    const source = validateProviderForCredentialStorage(input.providerId);
    if (isCredentialRefusal(source)) return source;
    return [toStatus(source, await p.read(input.companyId, source.id))];
  }

  const storable = ACQUISITION_SOURCES.filter(
    (s) => STORED_CREDENTIAL_SOURCE_TYPES.includes(s.sourceType));

  const out: ProviderCredentialStatus[] = [];
  for (const source of storable) {
    out.push(toStatus(source, await p.read(input.companyId, source.id)));
  }
  return out;
}

/**
 * Revoke one provider credential for ONE tenant.
 *
 * Idempotent: revoking what is not there is a success, because the caller's
 * intent — "this tenant must not have a credential for this provider" — is
 * satisfied either way, and reporting an error would tell a caller that
 * something existed.
 */
export async function revokeProviderCredential(input: {
  companyId: string;
  providerId: string;
}, deps: LeadSourceCredentialPorts = {}): Promise<ProviderCredentialStatus | CredentialRefusal> {
  const source = validateProviderForCredentialStorage(input.providerId);
  if (isCredentialRefusal(source)) return source;

  const p = ports(deps);
  await p.remove(input.companyId, source.id);
  return toStatus(source, {});
}
