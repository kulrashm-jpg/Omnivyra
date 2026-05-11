/**
 * authMode — derive the diagnostic auth-mode label from a principal.
 *
 * Phase 1 — Session Integrity Diagnostics. Used to populate the
 * `authMode` field on auth-denial response bodies so a frontend can
 * tell apart bridge-cookie operators (no path to step-up) from canonical
 * operators (who should be challenged for step-up rather than logged out).
 *
 * NB: this is a diagnostic projection, not an authority signal. Never
 * branch security decisions on it.
 */
import type { AuthenticatedPrincipal } from '../../shared/contracts/security';

export type AuthMode = 'canonical' | 'bridge' | 'unauthenticated';

export function authModeFor(principal: AuthenticatedPrincipal | null): AuthMode {
  if (!principal) return 'unauthenticated';
  if (principal.legacyCookieSuperAdmin) return 'bridge';
  return 'canonical';
}

/**
 * Step-up applicability label for diagnostics. Mirrors the four states
 * documented on AuthDeniedDiagnostics.stepUpStatus.
 */
export type StepUpDiagnosticStatus = 'not_required' | 'required' | 'satisfied' | 'not_applicable';

/**
 * Compute the step-up diagnostic label for a principal × policy pair.
 * Bridge principals receive 'not_applicable' (they can never satisfy
 * step-up by design — see legacyCookieSuperAdminBridge.ts).
 */
export function stepUpStatusFor(
  principal: AuthenticatedPrincipal | null,
  needsStepUp: boolean,
  satisfied: boolean,
): StepUpDiagnosticStatus {
  if (!needsStepUp) return 'not_required';
  if (!principal) return 'required';
  if (principal.legacyCookieSuperAdmin) return 'not_applicable';
  return satisfied ? 'satisfied' : 'required';
}
