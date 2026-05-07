/**
 * Domain types for the WebAuthn/passkey foundation.
 *
 * These are server-side projections of the @simplewebauthn/server data
 * shapes. Routes accept the SimpleWebAuthn JSON types directly from the
 * browser; services translate to/from our DB row shapes via these types.
 */

export type WebAuthnCeremony = 'registration' | 'authentication';

/**
 * The shape we persist in webauthn_credentials.
 * `publicKey` is COSE-encoded bytes; never plaintext private material.
 * `credentialId` is the canonical base64url-encoded credential id.
 */
export interface StoredWebAuthnCredential {
  id: string;                      // db row id (uuid)
  userId: string;                  // public.users.id
  credentialId: string;            // base64url
  publicKey: Uint8Array;           // COSE bytes (bytea)
  counter: number | bigint;
  transports: ReadonlyArray<string> | null;
  attestationFormat: string | null;
  authenticatorAaguid: string | null;
  deviceType: string | null;       // 'singleDevice' | 'multiDevice'
  isBackedUp: boolean;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revocationReason: string | null;
}

/**
 * The shape we persist in webauthn_challenges.
 * Each challenge is one-shot: consumed_at must be set on success/expiry.
 */
export interface StoredWebAuthnChallenge {
  id: string;                      // db row id (uuid)
  userId: string | null;           // null for userless authentication ceremonies
  challenge: string;               // base64url string returned by SimpleWebAuthn
  ceremony: WebAuthnCeremony;
  rpId: string;                    // snapshot of rp_id at issue time (audit + verify-time consistency)
  origin: string;                  // snapshot of rp_origin at issue time
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

/**
 * Audit-event shape for the WebAuthn lifecycle. Mirrored into
 * SecurityAuditService.AuditDecision via the shared union.
 */
export type WebAuthnAuditEvent =
  | 'passkey_registration_started'
  | 'passkey_registered'
  | 'passkey_registration_failed'
  | 'passkey_auth_started'
  | 'passkey_authenticated'
  | 'passkey_auth_failed'
  | 'passkey_revoked';

/**
 * Result returned by WebAuthnAuthenticationService.verify on success.
 *
 * Wave 2B-A scope is verification only — callers (Wave 2B-B step-up
 * service, Wave 2B-C login flow) decide how to project this into a
 * session.
 */
export interface WebAuthnVerifiedAuthentication {
  userId: string;
  credentialId: string;
  /**
   * The new authenticator counter (post-verify). Already persisted by
   * the service; included here so callers can audit it.
   */
  newCounter: number | bigint;
  verifiedAt: Date;
  deviceType: string | null;
  isBackedUp: boolean;
}
