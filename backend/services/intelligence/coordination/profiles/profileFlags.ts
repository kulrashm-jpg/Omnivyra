/**
 * Query Profiles — flags (WS-2D). The profiles are READ-ONLY and always safe to
 * call; this flag only lets a consumer gate whether it SURFACES profile output.
 * Default OFF. It does not change query behaviour.
 */
export const COORDINATION_QUERY_PROFILES_ENABLED_ENV_VAR = 'COORDINATION_QUERY_PROFILES_ENABLED';

export function isCoordinationQueryProfilesEnabled(): boolean {
  return process.env[COORDINATION_QUERY_PROFILES_ENABLED_ENV_VAR] === 'true';
}
