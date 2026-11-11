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
 * A principal flagged legacyCookieSuperAdmin would receive 'not_applicable'.
 * None can exist since the cookie bridge was removed (e9 (C), 2026-11-11);
 * the check is kept until the flag itself is removed.
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
