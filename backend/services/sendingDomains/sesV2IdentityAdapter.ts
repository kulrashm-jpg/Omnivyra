/**
 * W4 — the SESv2 implementation of the SES identity port.
 *
 * Every AWS SDK detail — client, commands, response fields, exception names —
 * stays in this file. The domain service sees only `SesIdentityApi`.
 *
 * REGION is fixed to `SES_SENDING_REGION` (eu-north-1).
 *
 * CREDENTIALS are DEDICATED and EXPLICIT: `SENDING_DOMAINS_AWS_ACCESS_KEY_ID` /
 * `SENDING_DOMAINS_AWS_SECRET_ACCESS_KEY`, passed to the client as a static
 * pair. The SDK's default provider chain is never consulted, so the generic
 * `AWS_ACCESS_KEY_ID` (read elsewhere, e.g. the warehouse export) or a
 * runtime-injected role can never be used for tenant identity operations. A
 * missing, blank or malformed pair is `provider_not_configured` before any
 * client exists. Long-lived IAM keys only: no session token is read. Values
 * are never logged or put in an error.
 *
 * FAIL CLOSED:
 *   • a response that is not a DOMAIN identity, or a create that returns no
 *     DKIM tokens, is `incomplete_response` — never a success;
 *   • `verifiedForSending` is true only when SES says so explicitly;
 *   • an unrecognised DKIM status becomes null (→ pending), never SUCCESS;
 *   • an unclassified error is `unknown`, which is terminal (not retried);
 *   • a reported `ConfigurationSetName` is passed through only when it is a
 *     well-formed set name — the service refuses to adopt an identity unless
 *     it is exactly the tenant's own set.
 *
 * NOT FOUND. On a CREATE the only resource the request references is the
 * configuration set (no DKIM signing attributes, no tags are sent), so a
 * `NotFoundException` there is `configuration_set_not_found`. On a GET it means
 * the identity is gone: `not_found`. Neither is retried.
 *
 * RETRIES. The SDK retries throttling and transient service errors itself
 * (`maxAttempts`). After that, only `throttled` and `unavailable` are reported
 * as retryable; authorization, validation, limits and unknown errors are not.
 *
 * SELECTION. `resolveSesIdentityApi()` returns this adapter ONLY when
 * `SENDING_DOMAINS_SES_PROVIDER=sesv2` is set explicitly AND the dedicated
 * credential pair is valid. Otherwise — and if the client cannot be
 * constructed — it returns the fail-closed default, so an environment that
 * merely has AWS credentials can never call SES by accident.
 */
import {
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import {
  SES_SENDING_REGION,
  SesIdentityError,
  unconfiguredSesIdentityApi,
  type DkimStatus,
  type SesIdentityApi,
  type SesIdentityErrorCode,
  type SesIdentityState,
} from './sesIdentityPort';

export const SES_IDENTITY_PROVIDER_ENV = 'SENDING_DOMAINS_SES_PROVIDER';
export const SES_IDENTITY_ACCESS_KEY_ENV = 'SENDING_DOMAINS_AWS_ACCESS_KEY_ID';
export const SES_IDENTITY_SECRET_KEY_ENV = 'SENDING_DOMAINS_AWS_SECRET_ACCESS_KEY';
export const SES_IDENTITY_MAX_ATTEMPTS = 3;

export interface SesIdentityCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

// IAM access key ids are upper-case alphanumerics; secrets are base64-like.
// Shape checks only: they reject blanks, whitespace and pasted junk, not keys.
const ACCESS_KEY_ID_RE = /^[A-Z0-9]{16,128}$/;
const SECRET_ACCESS_KEY_RE = /^[A-Za-z0-9/+=]{16,128}$/;

/**
 * The dedicated credential pair from `env`, or null when either value is
 * missing, blank or malformed. Never falls back to any other variable.
 */
export function sesIdentityCredentialsFrom(env: Record<string, string | undefined>): SesIdentityCredentials | null {
  const accessKeyId = typeof env[SES_IDENTITY_ACCESS_KEY_ENV] === 'string' ? env[SES_IDENTITY_ACCESS_KEY_ENV]!.trim() : '';
  const secretAccessKey = typeof env[SES_IDENTITY_SECRET_KEY_ENV] === 'string' ? env[SES_IDENTITY_SECRET_KEY_ENV]!.trim() : '';
  if (!ACCESS_KEY_ID_RE.test(accessKeyId) || !SECRET_ACCESS_KEY_RE.test(secretAccessKey)) return null;
  return { accessKeyId, secretAccessKey };
}

/** The client boundary the adapter needs. Tests inject a fake here. */
export interface SesV2Sender {
  send(command: CreateEmailIdentityCommand | GetEmailIdentityCommand): Promise<unknown>;
}

const DKIM_STATUSES: ReadonlySet<string> = new Set(['PENDING', 'SUCCESS', 'FAILED', 'TEMPORARY_FAILURE', 'NOT_STARTED']);
const HOSTED_ZONE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const CONFIGURATION_SET_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Map one SESv2 Create/GetEmailIdentity response onto the port's state. */
export function identityStateFromResponse(out: unknown, op: 'create' | 'get'): SesIdentityState {
  if (!isRec(out) || out.IdentityType !== 'DOMAIN') throw new SesIdentityError('incomplete_response');
  const dkim = isRec(out.DkimAttributes) ? out.DkimAttributes : {};
  const tokens = Array.isArray(dkim.Tokens)
    ? dkim.Tokens.filter((t): t is string => typeof t === 'string' && /^[a-z0-9]+$/i.test(t))
    : [];
  // A create MUST hand back the Easy DKIM tokens: without them the tenant has
  // nothing to publish, and calling that a success would strand the domain.
  if (op === 'create' && tokens.length === 0) throw new SesIdentityError('incomplete_response');
  const status = typeof dkim.Status === 'string' && DKIM_STATUSES.has(dkim.Status) ? (dkim.Status as DkimStatus) : null;
  const zone = typeof dkim.SigningHostedZone === 'string' ? dkim.SigningHostedZone.trim().toLowerCase() : '';
  return {
    verifiedForSending: out.VerifiedForSendingStatus === true,
    dkimStatus: status,
    dkimTokens: tokens.slice(0, 3),
    dkimSigningHostedZone: HOSTED_ZONE_RE.test(zone) ? zone : null,
    configurationSetName: typeof out.ConfigurationSetName === 'string' && CONFIGURATION_SET_NAME_RE.test(out.ConfigurationSetName)
      ? out.ConfigurationSetName
      : null,
  };
}

const ACCESS_DENIED = new Set([
  'AccessDeniedException', 'AccessDenied', 'UnrecognizedClientException', 'InvalidClientTokenId',
  'InvalidSignatureException', 'SignatureDoesNotMatch', 'ExpiredTokenException', 'UnauthorizedOperation',
  'AccountSuspendedException', 'SendingPausedException',
]);
const TRANSIENT_NAMES = new Set([
  'InternalServiceErrorException', 'ConcurrentModificationException', 'ServiceUnavailable',
  'ServiceUnavailableException', 'InternalFailure', 'RequestTimeout', 'RequestTimeoutException', 'TimeoutError',
]);
const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE']);

/** Classify any thrown value. Unrecognised ⇒ `unknown` (terminal). */
export function sesV2ErrorCode(e: unknown): SesIdentityErrorCode {
  if (e instanceof SesIdentityError) return e.code;
  const err = (isRec(e) ? e : {}) as Rec & { $metadata?: { httpStatusCode?: number } };
  const name = typeof err.name === 'string' ? err.name : '';
  const status = typeof err.$metadata?.httpStatusCode === 'number' ? err.$metadata.httpStatusCode : null;
  if (name === 'AlreadyExistsException') return 'already_exists';
  if (name === 'NotFoundException') return 'not_found';
  if (name === 'TooManyRequestsException' || name === 'ThrottlingException' || status === 429) return 'throttled';
  if (name === 'LimitExceededException') return 'limit_exceeded';
  if (name === 'BadRequestException' || name === 'ConflictException' || name === 'ValidationException') return 'invalid_request';
  if (name === 'CredentialsProviderError') return 'provider_not_configured';
  if (ACCESS_DENIED.has(name) || status === 401 || status === 403) return 'access_denied';
  if (TRANSIENT_NAMES.has(name) || (status !== null && status >= 500)) return 'unavailable';
  if (typeof err.code === 'string' && NETWORK_CODES.has(err.code)) return 'unavailable';
  return 'unknown';
}

/**
 * The real SDK client: fixed region, bounded SDK retries, and the dedicated
 * credentials as a STATIC pair — so the SDK's default provider chain (env,
 * shared files, container/instance roles) is never consulted.
 */
export function createDefaultSesV2Client(credentials: SesIdentityCredentials): SESv2Client {
  if (!credentials || !ACCESS_KEY_ID_RE.test(credentials.accessKeyId) || !SECRET_ACCESS_KEY_RE.test(credentials.secretAccessKey)) {
    throw new SesIdentityError('provider_not_configured');
  }
  return new SESv2Client({
    region: SES_SENDING_REGION,
    maxAttempts: SES_IDENTITY_MAX_ATTEMPTS,
    credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
  });
}

/**
 * Build the adapter around a client. There is deliberately NO default client
 * here: the only way to a real one is `resolveSesIdentityApi()` (explicit
 * opt-in + dedicated credentials). Tests inject a fake.
 */
export function createSesV2IdentityApi(opts: { client: SesV2Sender }): SesIdentityApi {
  const client: SesV2Sender | undefined = opts?.client;
  if (!client) throw new SesIdentityError('provider_not_configured');

  const call = async (command: CreateEmailIdentityCommand | GetEmailIdentityCommand, op: 'create' | 'get') => {
    let out: unknown;
    try {
      out = await client.send(command);
    } catch (e) {
      const code = sesV2ErrorCode(e);
      throw new SesIdentityError(op === 'create' && code === 'not_found' ? 'configuration_set_not_found' : code);
    }
    return identityStateFromResponse(out, op);
  };

  return {
    region: SES_SENDING_REGION,
    async createDomainIdentity({ domain, configurationSetName }) {
      // No DkimSigningAttributes ⇒ Easy DKIM (SES generates and rotates the keys).
      return call(new CreateEmailIdentityCommand({ EmailIdentity: domain, ConfigurationSetName: configurationSetName }), 'create');
    },
    async getDomainIdentity(domain) {
      return call(new GetEmailIdentityCommand({ EmailIdentity: domain }), 'get');
    },
  };
}

/**
 * The identity API the application should use: the SESv2 adapter only when
 * explicitly enabled AND the dedicated credentials are valid; otherwise (or on
 * any construction failure) the fail-closed default, which refuses every call
 * with `provider_not_configured` without creating a client.
 */
export function resolveSesIdentityApi(env: Record<string, string | undefined> = process.env): SesIdentityApi {
  if (String(env[SES_IDENTITY_PROVIDER_ENV] ?? '').trim().toLowerCase() !== 'sesv2') return unconfiguredSesIdentityApi;
  const credentials = sesIdentityCredentialsFrom(env);
  if (!credentials) return unconfiguredSesIdentityApi;
  try {
    return createSesV2IdentityApi({ client: createDefaultSesV2Client(credentials) });
  } catch {
    return unconfiguredSesIdentityApi;
  }
}
