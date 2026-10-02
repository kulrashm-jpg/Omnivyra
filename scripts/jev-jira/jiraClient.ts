/**
 * Minimal Jira gateway client for the orchestrator.
 *
 * Exactly two issue operations: read one issue (explicit field list) and update
 * allowlisted advisory fields on one OMNI issue — plus a read-only OMNI
 * permission probe used by the identity preflight. There is deliberately no
 * transition, create, delete, comment or search operation, so this client
 * cannot move an issue to Verified / Integrated / Released.
 *
 * Hardening (mirrors the BJC provider):
 *  - one fixed base URL (Atlassian gateway for the OMNI cloud id);
 *  - redirects refused, so the credential is never forwarded elsewhere;
 *  - credentials come only from JIRA_EMAIL + JIRA_PROVISION_TOKEN, sent as
 *    Basic (default) or, with JIRA_AUTH_MODE=bearer, as Bearer <token> only;
 *    any other mode fails closed before a request is made;
 *  - errors carry a code and HTTP status only — never a body or a credential.
 */
import { ADVISORY_WRITE_FIELDS, JIRA_AUTH_MODES, JIRA_AUTH_MODE_ENV, JIRA_EMAIL_ENV, JIRA_GATEWAY_BASE, JIRA_TOKEN_ENV, type JiraAuthMode } from './fields';

export const ISSUE_KEY_RE = /^OMNI-[1-9]\d{0,6}$/;

export type JiraErrorCode = 'JIRA_NOT_FOUND' | 'JIRA_AUTH' | 'JIRA_AUTH_MODE' | 'JIRA_HTTP_ERROR' | 'JIRA_NETWORK_ERROR' | 'JIRA_MALFORMED' | 'JIRA_FORBIDDEN_WRITE';

export class JiraClientError extends Error {
  constructor(
    readonly code: JiraErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'JiraClientError';
  }
}

export interface JiraIssue {
  key: string;
  fields: Record<string, unknown>;
}

export interface JiraClient {
  getIssue(key: string, fields: readonly string[]): Promise<JiraIssue>;
  updateAdvisoryFields(key: string, fields: Record<string, unknown>): Promise<void>;
}

export interface JiraCredentials {
  /** Absent means `basic`. */
  mode?: JiraAuthMode;
  /** Required for basic; for bearer it is identity metadata only and never sent. */
  email: string;
  token: string;
}

/** The configured auth mode; unset → `basic`; anything else → null (fail closed). */
export function resolveJiraAuthMode(env: Record<string, string | undefined>): JiraAuthMode | null {
  const raw = env[JIRA_AUTH_MODE_ENV];
  if (raw === undefined || raw.trim() === '') return 'basic';
  return (JIRA_AUTH_MODES as readonly string[]).includes(raw.trim()) ? (raw.trim() as JiraAuthMode) : null;
}

export function resolveJiraCredentials(env: Record<string, string | undefined>): JiraCredentials | null {
  const mode = resolveJiraAuthMode(env);
  const email = (env[JIRA_EMAIL_ENV] ?? '').trim();
  const token = (env[JIRA_TOKEN_ENV] ?? '').trim();
  if (mode === null || !token) return null;
  if (mode === 'basic' && !email) return null;
  return { mode, email, token };
}

/** The Authorization header for the configured mode; throws (before any request) on an unsupported mode. */
export function authorizationHeader(credentials: JiraCredentials): string {
  const mode = credentials.mode ?? 'basic';
  if (mode === 'bearer') return `Bearer ${credentials.token}`;
  if (mode === 'basic') return `Basic ${Buffer.from(`${credentials.email}:${credentials.token}`).toString('base64')}`;
  throw new JiraClientError('JIRA_AUTH_MODE', 'unsupported Jira auth mode');
}

function assertKey(key: string): void {
  if (!ISSUE_KEY_RE.test(key)) throw new JiraClientError('JIRA_MALFORMED', 'issue key must look like OMNI-<number>');
}

/** Defense in depth: the client itself refuses any field outside the advisory allowlist. */
export function assertAdvisoryOnly(fields: Record<string, unknown>): void {
  const allowed = ADVISORY_WRITE_FIELDS as readonly string[];
  const bad = Object.keys(fields).filter((k) => !allowed.includes(k));
  if (bad.length > 0 || Object.keys(fields).length === 0) {
    throw new JiraClientError('JIRA_FORBIDDEN_WRITE', `refusing to write non-advisory fields (${bad.length} rejected)`);
  }
}

/** Read-only probe of the caller's own OMNI permissions (identity preflight). */
export interface JiraPermissionProbe {
  getMyPermissions(keys: readonly string[]): Promise<Record<string, boolean | undefined>>;
}

export function createJiraClient(opts: { credentials: JiraCredentials; fetchImpl?: typeof fetch; timeoutMs?: number }): JiraClient & JiraPermissionProbe {
  const doFetch = opts.fetchImpl ?? fetch;
  const auth = authorizationHeader(opts.credentials);
  const timeoutMs = opts.timeoutMs ?? 15000;

  async function call(method: 'GET' | 'PUT', path: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(`${JIRA_GATEWAY_BASE}${path}`, {
        method,
        redirect: 'error',
        headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new JiraClientError('JIRA_NETWORK_ERROR', `Jira ${method} failed before a response`);
    }
    if (res.status === 404) throw new JiraClientError('JIRA_NOT_FOUND', 'Jira returned HTTP 404');
    if (res.status === 401 || res.status === 403) throw new JiraClientError('JIRA_AUTH', `Jira returned HTTP ${res.status}`);
    if (!res.ok) throw new JiraClientError('JIRA_HTTP_ERROR', `Jira returned HTTP ${res.status}`);
    return res;
  }

  return {
    async getIssue(key, fields) {
      assertKey(key);
      const res = await call('GET', `/rest/api/2/issue/${key}?fields=${encodeURIComponent(fields.join(','))}`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await res.text());
      } catch {
        throw new JiraClientError('JIRA_MALFORMED', 'Jira issue response is not valid JSON');
      }
      const issue = parsed as JiraIssue;
      if (!issue || typeof issue.key !== 'string' || !issue.fields || typeof issue.fields !== 'object') {
        throw new JiraClientError('JIRA_MALFORMED', 'Jira issue response has no key/fields');
      }
      return { key: issue.key, fields: issue.fields };
    },

    async getMyPermissions(keys) {
      if (keys.some((k) => !/^[A-Z_]{3,40}$/.test(k))) throw new JiraClientError('JIRA_MALFORMED', 'invalid permission key');
      const res = await call('GET', `/rest/api/3/mypermissions?projectKey=OMNI&permissions=${keys.join(',')}`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await res.text());
      } catch {
        throw new JiraClientError('JIRA_MALFORMED', 'Jira permissions response is not valid JSON');
      }
      const perms = (parsed as { permissions?: Record<string, { havePermission?: unknown }> })?.permissions;
      if (!perms || typeof perms !== 'object') throw new JiraClientError('JIRA_MALFORMED', 'Jira permissions response has no permissions');
      return Object.fromEntries(keys.map((k) => [k, typeof perms[k]?.havePermission === 'boolean' ? (perms[k].havePermission as boolean) : undefined]));
    },

    async updateAdvisoryFields(key, fields) {
      assertKey(key);
      assertAdvisoryOnly(fields);
      await call('PUT', `/rest/api/2/issue/${key}`, { fields });
    },
  };
}
