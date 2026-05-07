/**
 * AuthenticatedPrincipal — the canonical "who is making this request" record.
 *
 * Produced by IdentityResolver. Every authorization decision in the system
 * consumes a Principal. The Principal carries:
 *   - identity (user id, supabase uid, email)
 *   - session metadata (id, freshness)
 *   - org membership map
 *   - aggregate capability set
 *   - MFA state (factors enrolled, last verification)
 *   - device trust state
 *   - step-up state (currently active or not)
 *
 * Do NOT add new top-level fields without updating SessionAuthorityService,
 * IdentityResolver, and the audit serializer in SecurityAuditService.
 */

import type { Capability } from './SecurityCapabilities';

export type MfaFactorKind = 'webauthn' | 'totp';

export interface PrincipalOrgMembership {
  organizationId: string;
  status: 'active' | 'invited' | 'inactive' | 'deactivated';
  /** Role string from user_company_roles.role. Roles are mapping inputs only. */
  role: string;
}

export interface PrincipalMfaState {
  /** True if any active credential exists (WebAuthn or TOTP). */
  enrolled: boolean;
  /** Active factors. Order matches user preference (passkey-first). */
  factors: ReadonlyArray<MfaFactorKind>;
  /** Last successful MFA verification. Null if never. */
  lastVerifiedAt: Date | null;
  /** Was the most-recent verification a phishing-resistant factor (WebAuthn)? */
  phishingResistant: boolean;
}

export interface PrincipalDeviceState {
  /** trusted_devices.id when known; null when no trusted-device cookie present. */
  deviceId: string | null;
  /** True iff a non-revoked, non-expired trusted_devices row matched the device fingerprint. */
  trusted: boolean;
  /** Stable fingerprint hash used for anomaly hooks. */
  fingerprint: string;
}

export interface PrincipalStepUpState {
  /** True iff a stepup_sessions row is currently valid for this auth_session. */
  active: boolean;
  /** stepup_sessions.expires_at. */
  expiresAt: Date | null;
  /** Factor used to elevate. Null if no current step-up. */
  factor: MfaFactorKind | null;
  /** stepup_sessions.id, when active. */
  sessionId: string | null;
}

export interface AuthenticatedPrincipal {
  // ── Identity ───────────────────────────────────────────────────────────────
  /** public.users.id — application profile PK. */
  userId: string;
  /** auth.users.id — Supabase auth identity. Mirrored in users.supabase_uid. */
  supabaseUid: string;
  email: string;
  emailVerified: boolean;

  // ── Session ────────────────────────────────────────────────────────────────
  /** auth_sessions.id, server-issued. Null only when this principal was resolved
   *  for a request that has no session row yet (e.g. /api/auth/sync-supabase-user
   *  during the first-create path). Authorization checks treat null sessionId as
   *  ineligible for elevated capabilities. */
  sessionId: string | null;
  /** Seconds since auth_sessions.created_at. */
  sessionAgeSeconds: number;
  /** Seconds since auth_sessions.last_seen_at update. */
  sessionStaleSeconds: number;

  // ── Membership ─────────────────────────────────────────────────────────────
  organizations: ReadonlyArray<PrincipalOrgMembership>;
  /** users.active_company_id — caller's currently active org. */
  activeOrgId: string | null;

  // ── Capabilities (post-hierarchy expansion + capability_assignments) ───────
  /** Aggregate set of capabilities held by this principal across all orgs.
   *  org-scoped capability checks must use the AuthorizationService helpers
   *  which scope per-org, not the raw aggregate. */
  capabilities: ReadonlyArray<Capability>;

  // ── MFA / device / step-up ────────────────────────────────────────────────
  mfa: PrincipalMfaState;
  device: PrincipalDeviceState;
  stepUp: PrincipalStepUpState;

  // ── Bridge mode (legacy cookie super-admin) ───────────────────────────────
  /**
   * True iff this principal was authorized via the legacy
   * super_admin_session=1 cookie path. When true:
   *   - capabilities will include SUPER_ADMIN_LEGACY_BRIDGE
   *   - sessionId is typically null (cookie has no auth_sessions row)
   *   - userId may be a synthetic placeholder string
   *   - cannot satisfy step-up requirements
   *   - MUST be audited via SecurityAuditService.logCookieSuperAdminUsage
   *
   * Hard-expires per LEGACY_BRIDGE_HARD_EXPIRY_AT in
   * backend/security/legacyCookieSuperAdminBridge.ts.
   */
  legacyCookieSuperAdmin: boolean;
}
