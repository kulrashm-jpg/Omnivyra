/**
 * Communication Lifecycle Intelligence — flags (WS-2C).
 *
 * The query services are READ-ONLY and inherently side-effect-free, so they are
 * always safe to call. This flag exists only so a consumer can gate whether it
 * SURFACES coordination intelligence in a UI/report; default OFF. It does not
 * change query behaviour.
 */
export const COORDINATION_INTELLIGENCE_ENABLED_ENV_VAR = 'COORDINATION_INTELLIGENCE_ENABLED';

export function isCoordinationIntelligenceEnabled(): boolean {
  return process.env[COORDINATION_INTELLIGENCE_ENABLED_ENV_VAR] === 'true';
}
