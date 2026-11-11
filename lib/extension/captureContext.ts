/**
 * The verified caller context for Sales Navigator capture
 * (EXTENSION-1.5.0-CONTRACT.md §5.3; agreed with PI, 2026-11-10).
 *
 * Only `verifyCaptureCaller` in the Outreach capture route can construct one: the
 * brand symbol is not exported, so PI (which imports the TYPE only) cannot create a
 * value, and a structurally similar object is not assignable. The type remains
 * assignable to PI's structural CaptureCallerContext.
 */

declare const verifiedCaptureBrand: unique symbol;

export interface VerifiedCaptureContext {
  readonly orgId: string;
  readonly userId: string;
  /** The bound LinkedIn account; null until social_accounts identity (PI C-PI-1) links it. */
  readonly socialAccountId: string | null;
  readonly actingMemberUrn: string;
  readonly commandId: string;
  readonly extensionVersion: string;
  readonly [verifiedCaptureBrand]: true;
}

/**
 * Internal constructor. Call ONLY after every check in the capture route has
 * passed: signature, version gate, live command bound to this session and
 * binding, cap and rate limit.
 */
export function __brandVerifiedCaptureContext(c: Omit<VerifiedCaptureContext, typeof verifiedCaptureBrand>): VerifiedCaptureContext {
  return Object.freeze({ ...c }) as VerifiedCaptureContext;
}
