/**
 * Closure-014 (E) — the rule for issuing a DIRECT capability grant
 * (`capability_assignments` row).
 *
 * D-3's root cause was that a direct grant of a platform-tier capability made a
 * non-platform principal *hold* it. requireCapability now refuses such a holder
 * on every platform write; this policy keeps new grants from being issued that
 * way in the first place. It is pure (no I/O): any future grant tooling must
 * call it before writing, and the proposed database trigger
 * (docs/security/proposed/20261013_capability_assignments_platform_write_guard.sql)
 * enforces the platform-write part for direct SQL writers too.
 *
 * Intended assignable principals:
 *   • a platform-tier WRITE capability → only an ACTIVE, exact-spelling
 *     SUPER_ADMIN (a grant never substitutes for platform authority);
 *   • a platform-tier READ capability (super_admin.dashboard.view,
 *     consumption.view.aggregate) → any principal (read delegation);
 *   • any other capability → any principal.
 * In every case the GRANTOR must be an active platform SUPER_ADMIN on a
 * canonical (non-bridge) principal, and nobody grants to themself.
 */
import {
  ALL_CAPABILITIES,
  CONSUMPTION_VIEW_AGGREGATE,
  SUPER_ADMIN_DASHBOARD_VIEW,
  type Capability,
} from '../../shared/contracts/security';
import { PLATFORM_TIER_CAPABILITIES } from './platformCapabilities';
import { hasPlatformWriteAuthority, type PlatformWriteActor } from './platformWriteAuthority';

export const PLATFORM_TIER_WRITE_CAPABILITIES: ReadonlyArray<Capability> = PLATFORM_TIER_CAPABILITIES.filter(
  (c) => c !== SUPER_ADMIN_DASHBOARD_VIEW && c !== CONSUMPTION_VIEW_AGGREGATE,
);

export type CapabilityGrantRefusal =
  | 'UNKNOWN_CAPABILITY'
  | 'SELF_GRANT'
  | 'GRANTOR_NOT_PLATFORM_SUPER_ADMIN'
  | 'PLATFORM_WRITE_REQUIRES_ACTIVE_SUPER_ADMIN';

export type CapabilityGrantDecision = { ok: true } | { ok: false; reason: CapabilityGrantRefusal };

export interface CapabilityGrantRequest {
  capability: string;
  targetUserId: string;
  /** The target's user_company_roles rows (role, status) as stored. */
  targetMemberships: ReadonlyArray<{ role: string; status: string }>;
  grantor: PlatformWriteActor;
}

const KNOWN = new Set<string>(ALL_CAPABILITIES);
const PLATFORM_WRITE = new Set<string>(PLATFORM_TIER_WRITE_CAPABILITIES);

export function validateCapabilityGrant(req: CapabilityGrantRequest): CapabilityGrantDecision {
  if (!KNOWN.has(req.capability)) return { ok: false, reason: 'UNKNOWN_CAPABILITY' };
  if (req.grantor?.userId && req.grantor.userId === req.targetUserId) return { ok: false, reason: 'SELF_GRANT' };
  if (!hasPlatformWriteAuthority(req.grantor)) return { ok: false, reason: 'GRANTOR_NOT_PLATFORM_SUPER_ADMIN' };
  if (PLATFORM_WRITE.has(req.capability)) {
    // Exact spelling + active — the same predicate as platform write authority.
    const targetIsSuperAdmin = req.targetMemberships.some((m) => m.role === 'SUPER_ADMIN' && m.status === 'active');
    if (!targetIsSuperAdmin) return { ok: false, reason: 'PLATFORM_WRITE_REQUIRES_ACTIVE_SUPER_ADMIN' };
  }
  return { ok: true };
}
