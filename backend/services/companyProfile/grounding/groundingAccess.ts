/**
 * CPG-001 — tenant isolation + authorization for grounding state (§16).
 *
 * The resolution engine is pure and company-agnostic; it will happily resolve
 * whatever it is handed. That makes THIS module the place where a caller's right
 * to see or change a company's grounding is decided, and it is deliberately the
 * only door.
 *
 * TWO INDEPENDENT DEFENCES, because either alone has failed before in this
 * codebase:
 *   1. RLS at the database (see the CPG-001 migration) — scoped by
 *      `user_company_roles`, the existing membership seam.
 *   2. This application-layer guard — so a service-role client, which bypasses
 *      RLS entirely, still cannot read or mutate across tenants.
 *
 * Confirmation decisions are WRITES. They change the effective value a customer
 * sees, so they require write authority, not merely membership.
 *
 * Pure and deterministic: membership is injected. No I/O, no clock, no RNG.
 */

import type { GroundedField } from './types';
import { applyUserDecision, type ApplyDecisionInput, type UserDecision } from './confirmation';

export type GroundingRole = 'viewer' | 'editor' | 'admin';

export interface AccessContext {
  userId: string;
  /** Companies this user belongs to, with the role they hold. Injected. */
  memberships: ReadonlyArray<{ companyId: string; role: GroundingRole }>;
}

export class TenantIsolationError extends Error {
  constructor(public readonly companyId: string, public readonly userId: string) {
    super(`user ${userId} has no membership in company ${companyId}`);
    this.name = 'TenantIsolationError';
  }
}

export class AuthorizationError extends Error {
  constructor(public readonly required: GroundingRole, public readonly actual: GroundingRole) {
    super(`this action requires '${required}'; caller holds '${actual}'`);
    this.name = 'AuthorizationError';
  }
}

const RANK: Readonly<Record<GroundingRole, number>> = Object.freeze({ viewer: 0, editor: 1, admin: 2 });

function roleFor(ctx: AccessContext, companyId: string): GroundingRole {
  const m = ctx.memberships.find((x) => x.companyId === companyId);
  if (!m) throw new TenantIsolationError(companyId, ctx.userId);
  return m.role;
}

/** Assert read access. Throws rather than returning empty — silence hides bugs. */
export function assertCanRead(ctx: AccessContext, companyId: string): GroundingRole {
  return roleFor(ctx, companyId);
}

/** Assert write access (confirmations, corrections). */
export function assertCanWrite(ctx: AccessContext, companyId: string): GroundingRole {
  const role = roleFor(ctx, companyId);
  if (RANK[role] < RANK.editor) throw new AuthorizationError('editor', role);
  return role;
}

/**
 * Filter a batch of grounded fields to those the caller may see.
 *
 * Cross-tenant rows are DROPPED, not thrown on — a batch read that includes one
 * foreign row is a caller bug, and failing the whole request would leak the
 * existence of that row through the error.
 */
export function filterReadable(ctx: AccessContext, fields: readonly GroundedField[]): GroundedField[] {
  const allowed = new Set(ctx.memberships.map((m) => m.companyId));
  return fields.filter((f) => allowed.has(f.companyId));
}

/**
 * The ONLY authorized path to apply a user decision. Verifies tenancy and write
 * authority, and pins the actor to the authenticated user so a caller cannot
 * attribute a correction to somebody else.
 */
export function applyUserDecisionGuarded(
  ctx: AccessContext,
  grounded: GroundedField,
  decision: UserDecision,
  asOf: string,
): GroundedField {
  assertCanWrite(ctx, grounded.companyId);
  const input: ApplyDecisionInput = { grounded, decision, actor: ctx.userId, asOf };
  return applyUserDecision(input);
}
