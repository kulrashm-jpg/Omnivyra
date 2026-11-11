/**
 * BETA_AI_MODE gate (83 / e9 ruling, 2026-11-12). Pure, so it can be tested against the RESOLVED
 * config value.
 *
 * Beta AI mode makes the creator image pipeline return a deterministic fixture and SKIP billing. It
 * must never take effect in production, and VERCEL_ENV / NODE_ENV cannot tell production from a beta
 * deployment (a beta project deployed with --prod has both set to 'production'). So the gate is
 * INVERTED and fail-safe: the mode takes effect ONLY when BETA_AI_MODE is on AND the deployment
 * carries the explicit beta-only marker OMNIVYRA_ENV === 'beta'. Unset (the schema default is
 * 'production'), empty, or any other value neutralises it: real provider calls and image billing stay
 * on. Production needs no new variable, and a forgotten marker fails safe.
 */

/** BETA_AI_MODE as the operator set it ('1' | 'true' enable it; anything else does not). */
export function betaAiModeRequested(raw: string | undefined): boolean {
  return raw === '1' || raw === 'true';
}

/** Whether beta AI mode TAKES EFFECT, given the raw flag and the RESOLVED OMNIVYRA_ENV. */
export function betaAiModeActive(raw: string | undefined, resolvedOmnivyraEnv: string | undefined): boolean {
  return betaAiModeRequested(raw) && resolvedOmnivyraEnv === 'beta';
}

/** The one boot-time line when the flag is set without the marker (neutralised, said loudly). */
export const BETA_AI_MODE_NEUTRALISED_MESSAGE =
  '[config] BETA_AI_MODE is set but OMNIVYRA_ENV is not "beta": beta AI mode is NEUTRALISED. Real provider calls and image billing stay ON. Set OMNIVYRA_ENV=beta only on the beta deployment.';
