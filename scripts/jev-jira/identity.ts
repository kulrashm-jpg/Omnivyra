/**
 * Runtime Jira identity for the orchestrator — explicit, per run, fail closed.
 *
 *  - JEV_JIRA_IDENTITY must be `reader` (read-only runs) or `advisory`
 *    (--write-back runs); anything else, including the provisioning/admin
 *    identity, is refused.
 *  - Each identity reads ONLY its own token variable and always sends it as
 *    `Bearer <token>` (scoped service-account token). JIRA_PROVISION_TOKEN is
 *    never read here.
 *  - Before any issue is read, the token's live OMNI permissions must match
 *    the identity's policy exactly, so a wrong or over-privileged token (for
 *    example an admin token placed in the advisory slot) fails closed.
 *
 * Pure apart from the types; the permission probe itself is a Jira GET.
 */
import type { JiraCredentials } from './jiraClient';

export const JIRA_IDENTITY_ENV = 'JEV_JIRA_IDENTITY';
export type RuntimeIdentity = 'reader' | 'advisory';

export const IDENTITY_TOKEN_ENV: Readonly<Record<RuntimeIdentity, string>> = {
  reader: 'JEV_READER_TOKEN',
  advisory: 'JEV_ADVISORY_TOKEN',
};

/** OMNI project permissions each identity MUST have and MUST NOT have. */
export const IDENTITY_POLICY: Readonly<Record<RuntimeIdentity, { required: readonly string[]; forbidden: readonly string[] }>> = {
  reader: {
    required: ['BROWSE_PROJECTS'],
    forbidden: ['EDIT_ISSUES', 'TRANSITION_ISSUES', 'CREATE_ISSUES', 'DELETE_ISSUES', 'ADMINISTER_PROJECTS', 'ADMINISTER'],
  },
  advisory: {
    required: ['BROWSE_PROJECTS', 'EDIT_ISSUES'],
    forbidden: ['TRANSITION_ISSUES', 'CREATE_ISSUES', 'DELETE_ISSUES', 'ADMINISTER_PROJECTS', 'ADMINISTER'],
  },
};

export type IdentityResolution =
  | { ok: true; identity: RuntimeIdentity; credentials: JiraCredentials }
  | { ok: false; message: string };

/** Resolves the run's identity and credential; never echoes a token. */
export function resolveRuntimeIdentity(env: Record<string, string | undefined>, writeBack: boolean): IdentityResolution {
  const raw = (env[JIRA_IDENTITY_ENV] ?? '').trim();
  if (raw !== 'reader' && raw !== 'advisory') return { ok: false, message: `${JIRA_IDENTITY_ENV} must be "reader" or "advisory"` };
  const identity: RuntimeIdentity = raw;
  if (writeBack && identity !== 'advisory') return { ok: false, message: '--write-back requires JEV_JIRA_IDENTITY=advisory' };
  if (!writeBack && identity !== 'reader') return { ok: false, message: 'a read-only run requires JEV_JIRA_IDENTITY=reader' };
  const token = (env[IDENTITY_TOKEN_ENV[identity]] ?? '').trim();
  if (!token) return { ok: false, message: `${IDENTITY_TOKEN_ENV[identity]} must be set for JEV_JIRA_IDENTITY=${identity}` };
  return { ok: true, identity, credentials: { mode: 'bearer', email: '', token } };
}

/** Every permission key the preflight asks Jira about for this identity. */
export function preflightPermissionKeys(identity: RuntimeIdentity): string[] {
  const p = IDENTITY_POLICY[identity];
  return [...p.required, ...p.forbidden];
}

/** Policy violations for the live permission map; a missing key is a violation (fail closed). */
export function identityViolations(identity: RuntimeIdentity, have: Readonly<Record<string, boolean | undefined>>): string[] {
  const p = IDENTITY_POLICY[identity];
  return [
    ...p.required.filter((k) => have[k] !== true).map((k) => `${k} must be granted`),
    ...p.forbidden.filter((k) => have[k] !== false).map((k) => `${k} must NOT be granted`),
  ];
}
