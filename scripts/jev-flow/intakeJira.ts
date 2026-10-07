/**
 * gov intake — Jira access.
 *
 *  - `createIntakeReader` (reader identity): read-only search of active OMNI
 *    Stories, so intake can reuse a Story instead of proposing a duplicate.
 *  - `createIntakeJira` (the HUMAN's own Jira identity, `--apply` only): the
 *    only Jira write intake can make is creating a Story or an Acceptance
 *    Criterion. Every request goes through a route allowlist — there is no
 *    edit, transition, delete, comment, link, assign or label-change path —
 *    and every create payload goes through a per-type field allowlist, so
 *    Verification, Deterministic Result, Evidence References, Disposition,
 *    Gate Result, the JEV fields and deployment fields can never be sent.
 *
 * `applyIntakeProposal` refuses (before creating anything) unless the
 * identity is an active human account (`accountType: atlassian`, not a
 * service account) with Browse + Create in OMNI, and the Jira create forms
 * carry every intended field and NO gate field. It is idempotent on the
 * `gov-intake-<hash12>` label and the AC IDs: re-applying the same proposal
 * reuses what exists and creates only what is missing.
 *
 * Errors carry a code and an HTTP status only — never a body or a credential.
 */
import crypto from 'node:crypto';
import { AC_FIELDS, ISSUE_TYPE, JIRA_GATEWAY_BASE, JIRA_TOKEN_ENV, OMNI_PROJECT_ID, STORY_FIELDS } from '../jev-jira/fields';
import { ISSUE_KEY_RE, authorizationHeader, createJiraClient, type JiraCredentials, type JiraIssue } from '../jev-jira/jiraClient';
import { IDENTITY_TOKEN_ENV } from '../jev-jira/identity';
import { GOV_STORY_FIELDS, STORY_AUTHORIZED_PATHS_FIELD } from './jiraQuery';
import { INACTIVE_STORY_STATUS_IDS } from './readiness';
import type { StoredIntakeProposal } from './types';

export const INTAKE_EMAIL_ENV = 'GOV_INTAKE_EMAIL';
export const INTAKE_TOKEN_ENV = 'GOV_INTAKE_TOKEN';
const SERVICE_ACCOUNT_DOMAIN = '@serviceaccount.atlassian.com';

export class IntakeJiraError extends Error {
  constructor(
    readonly code: 'INTAKE_ROUTE_FORBIDDEN' | 'INTAKE_FIELD_FORBIDDEN' | 'JIRA_AUTH' | 'JIRA_NOT_FOUND' | 'JIRA_HTTP_ERROR' | 'JIRA_NETWORK_ERROR' | 'JIRA_MALFORMED',
    message: string,
  ) {
    super(message);
    this.name = 'IntakeJiraError';
  }
}

// ---------------------------------------------------------------- field allowlists

/** The ONLY fields an intake-created Story may carry. */
export const STORY_CREATE_FIELDS: readonly string[] = [
  'project',
  'issuetype',
  'summary',
  'labels',
  STORY_FIELDS.objective,
  STORY_FIELDS.architecture,
  STORY_FIELDS.invariants,
  STORY_AUTHORIZED_PATHS_FIELD,
  STORY_FIELDS.prohibitedPaths,
  STORY_FIELDS.verificationRequirements,
];

/** The ONLY fields an intake-created Acceptance Criterion may carry (summary is mandatory in Jira). */
export const AC_CREATE_FIELDS: readonly string[] = ['project', 'issuetype', 'summary', 'parent', AC_FIELDS.acId, AC_FIELDS.statement, AC_FIELDS.kind, AC_FIELDS.evidenceKind];

/** Gate / verification / JEV / deployment fields: never sent, and their presence on a create form is refused. */
export const GATE_FIELD_IDS: readonly string[] = [
  AC_FIELDS.deterministicResult,
  AC_FIELDS.evidenceReferences,
  AC_FIELDS.verification,
  AC_FIELDS.jevVerdict,
  AC_FIELDS.jevConfidence,
  AC_FIELDS.jevModel,
  AC_FIELDS.jevInputHash,
  AC_FIELDS.jevAdvisoryDisposition,
  STORY_FIELDS.gateResult,
  STORY_FIELDS.commit,
  /** T3 Evidence Reference (T3 is a human gate). */
  'customfield_10078',
  /** Deployment Authorized By / At. */
  'customfield_10079',
  'customfield_10080',
];
/** Gate fields recognised by name as well (any future gate / deployment field). */
export const GATE_FIELD_NAME_RE = /^(verification|deterministic result|evidence references?|gate result|t[123]\b.*|jev\b.*|.*disposition|deployment\b.*|.*\bdeploy(ed|ment)?\b.*)$/i;

/**
 * Fields Jira lists on a create form regardless of the configured create screen — tolerated by
 * the form check only, never added to a creation allowlist:
 *  - `project` / `issuetype`: always;
 *  - `parent` for the Acceptance Criterion sub-task type (its parent Story; intake sends it);
 *  - `parent` for Story: Jira's issue hierarchy (Epic) field, listed by createmeta even when it is
 *    not on the intake-safe Story create screen (OMNI 10142). Intake NEVER sends it for a Story —
 *    `parent` is not in STORY_CREATE_FIELDS, so assertIntakeFields refuses it in a Story payload.
 */
const STORY_FORM_IMPLICIT: readonly string[] = ['project', 'issuetype', 'parent'];
const AC_FORM_IMPLICIT: readonly string[] = ['project', 'issuetype', 'parent'];

export function createFormImplicit(kind: 'story' | 'ac'): readonly string[] {
  return kind === 'ac' ? AC_FORM_IMPLICIT : STORY_FORM_IMPLICIT;
}

/** Story fields every intake proposal sends (Architecture / Invariants are optional). */
export const STORY_ALWAYS_SENT: readonly string[] = ['summary', 'labels', STORY_FIELDS.objective, STORY_AUTHORIZED_PATHS_FIELD, STORY_FIELDS.prohibitedPaths, STORY_FIELDS.verificationRequirements];
/** AC fields every intake-created AC sends. */
export const AC_ALWAYS_SENT: readonly string[] = ['summary', 'parent', AC_FIELDS.acId, AC_FIELDS.statement, AC_FIELDS.kind, AC_FIELDS.evidenceKind];

export function isGateField(fieldId: string, name: string): boolean {
  return GATE_FIELD_IDS.includes(fieldId) || GATE_FIELD_NAME_RE.test(name.trim());
}

/** Throws unless every key is on the allowlist for the issue kind. */
export function assertIntakeFields(kind: 'story' | 'ac', fields: Record<string, unknown>): void {
  const allowed = kind === 'story' ? STORY_CREATE_FIELDS : AC_CREATE_FIELDS;
  const bad = Object.keys(fields).filter((k) => !allowed.includes(k) || GATE_FIELD_IDS.includes(k));
  if (bad.length > 0) throw new IntakeJiraError('INTAKE_FIELD_FORBIDDEN', `refusing to send ${bad.length} field(s) outside the ${kind} allowlist: ${bad.sort().join(', ')}`);
}

// ---------------------------------------------------------------- routes

/** The only requests the intake client can make. Anything else is refused before it is sent. */
export const INTAKE_ROUTES: ReadonlyArray<{ method: 'GET' | 'POST'; re: RegExp }> = [
  { method: 'GET', re: /^\/rest\/api\/3\/myself$/ },
  { method: 'GET', re: /^\/rest\/api\/3\/mypermissions\?projectKey=OMNI&permissions=[A-Z_,]+$/ },
  { method: 'GET', re: /^\/rest\/api\/3\/issue\/createmeta\/OMNI\/issuetypes\/\d+\?startAt=\d+&maxResults=\d+$/ },
  { method: 'GET', re: /^\/rest\/api\/3\/search\/jql\?[^#]*$/ },
  { method: 'GET', re: /^\/rest\/api\/2\/issue\/OMNI-[1-9]\d{0,6}\?fields=[^#]*$/ },
  { method: 'POST', re: /^\/rest\/api\/2\/issue$/ },
];

export function routeAllowed(method: string, path: string): boolean {
  return INTAKE_ROUTES.some((r) => r.method === method && r.re.test(path));
}

type Fetch = typeof fetch;

async function request(doFetch: Fetch, auth: string, timeoutMs: number, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  if (!routeAllowed(method, path)) throw new IntakeJiraError('INTAKE_ROUTE_FORBIDDEN', `intake may not ${method} ${path.split('?')[0]}`);
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
    throw new IntakeJiraError('JIRA_NETWORK_ERROR', `Jira ${method} failed before a response`);
  }
  if (res.status === 404) throw new IntakeJiraError('JIRA_NOT_FOUND', 'Jira returned HTTP 404');
  if (res.status === 401 || res.status === 403) throw new IntakeJiraError('JIRA_AUTH', `Jira returned HTTP ${res.status}`);
  if (!res.ok) throw new IntakeJiraError('JIRA_HTTP_ERROR', `Jira returned HTTP ${res.status}`);
  try {
    return JSON.parse(await res.text());
  } catch {
    throw new IntakeJiraError('JIRA_MALFORMED', 'Jira response is not valid JSON');
  }
}

async function searchKeys(doFetch: Fetch, auth: string, timeoutMs: number, jql: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | null = null;
  for (let page = 0; page < 50; page++) {
    const params = [`jql=${encodeURIComponent(jql)}`, 'fields=key', 'maxResults=100'];
    if (token !== null) params.push(`nextPageToken=${encodeURIComponent(token)}`);
    const body = (await request(doFetch, auth, timeoutMs, 'GET', `/rest/api/3/search/jql?${params.join('&')}`)) as { issues?: unknown; nextPageToken?: unknown; isLast?: unknown };
    if (!body || !Array.isArray(body.issues)) throw new IntakeJiraError('JIRA_MALFORMED', 'Jira search response has no issues');
    for (const i of body.issues) {
      const k = (i as { key?: unknown })?.key;
      if (typeof k !== 'string' || !ISSUE_KEY_RE.test(k)) throw new IntakeJiraError('JIRA_MALFORMED', 'Jira search returned an invalid issue key');
      keys.push(k);
    }
    if (body.isLast === true || typeof body.nextPageToken !== 'string' || body.nextPageToken === '') return [...new Set(keys)];
    token = body.nextPageToken;
  }
  throw new IntakeJiraError('JIRA_MALFORMED', 'Jira search pagination did not terminate');
}

// ---------------------------------------------------------------- reader (read-only)

export interface IntakeReader {
  /** Active OMNI Stories (not Verified / Integrated / Released) with GOV_STORY_FIELDS. */
  searchActiveStories(): Promise<JiraIssue[]>;
}

export function createIntakeReader(opts: { credentials: JiraCredentials; fetchImpl?: Fetch; timeoutMs?: number }): IntakeReader {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const auth = authorizationHeader(opts.credentials);
  const client = createJiraClient({ credentials: opts.credentials, fetchImpl: doFetch, timeoutMs });
  return {
    async searchActiveStories() {
      const jql = `project = OMNI AND issuetype = ${ISSUE_TYPE.story} AND status not in (${INACTIVE_STORY_STATUS_IDS.join(', ')}) ORDER BY key ASC`;
      const keys = await searchKeys(doFetch, auth, timeoutMs, jql);
      const out: JiraIssue[] = [];
      for (const k of keys) out.push(await client.getIssue(k, GOV_STORY_FIELDS));
      return out;
    },
  };
}

// ---------------------------------------------------------------- human identity

export type IntakeCredentialResolution = { ok: true; credentials: JiraCredentials; email: string } | { ok: false; message: string };

/**
 * The human's own Jira identity: GOV_INTAKE_EMAIL + GOV_INTAKE_TOKEN (Basic).
 * Refuses a service-account email and any token equal to the provisioning,
 * reader or advisory token — those identities never create Stories.
 */
export function resolveIntakeCredentials(env: Record<string, string | undefined>): IntakeCredentialResolution {
  const email = (env[INTAKE_EMAIL_ENV] ?? '').trim();
  const token = (env[INTAKE_TOKEN_ENV] ?? '').trim();
  if (!email || !token) return { ok: false, message: `${INTAKE_EMAIL_ENV} and ${INTAKE_TOKEN_ENV} (your own Jira identity) must be set` };
  if (email.toLowerCase().endsWith(SERVICE_ACCOUNT_DOMAIN)) return { ok: false, message: 'a service account cannot apply an intake proposal; use your own Jira identity' };
  const reserved = [env[JIRA_TOKEN_ENV], env[IDENTITY_TOKEN_ENV.reader], env[IDENTITY_TOKEN_ENV.advisory]].map((t) => (t ?? '').trim()).filter((t) => t !== '');
  if (reserved.includes(token)) return { ok: false, message: `${INTAKE_TOKEN_ENV} must not be the provisioning, reader or advisory token` };
  return { ok: true, credentials: { mode: 'basic', email, token }, email };
}

// ---------------------------------------------------------------- credential freshness

/** The two human-intake variables whose freshness is checked; the only names the User-environment reader accepts. */
export const INTAKE_FRESHNESS_VARS = [INTAKE_EMAIL_ENV, INTAKE_TOKEN_ENV] as const;
export type IntakeFreshnessVar = (typeof INTAKE_FRESHNESS_VARS)[number];

/** A read of one variable from the authoritative Windows User environment. Reasons are fixed strings, never registry output. */
export type UserEnvRead = { state: 'present'; value: string } | { state: 'absent' } | { state: 'unavailable'; reason: string };
export type UserEnvReader = (name: IntakeFreshnessVar) => Promise<UserEnvRead>;

/**
 * Interprets `reg query HKCU\Environment /v <name>` output. Pure. `stdout` is null when reg failed;
 * reg exits 1 when the value does not exist. Never returns or embeds raw output.
 */
export function parseRegQueryValue(name: IntakeFreshnessVar, stdout: string | null, exitCode: number | null): UserEnvRead {
  if (stdout === null) return exitCode === 1 ? { state: 'absent' } : { state: 'unavailable', reason: 'the Windows User environment could not be read' };
  const m = new RegExp(`^\\s+${name}\\s+(REG_SZ|REG_EXPAND_SZ)\\s+(.*?)\\s*$`, 'm').exec(stdout);
  if (!m) return { state: 'unavailable', reason: 'the Windows User environment returned an unrecognised entry' };
  if (m[1] === 'REG_EXPAND_SZ' && m[2].includes('%')) return { state: 'unavailable', reason: 'the Windows User environment value is an unexpanded expandable string' };
  return m[2] === '' ? { state: 'absent' } : { state: 'present', value: m[2] };
}

/** Equality without early exit on the first differing character (values are never compared as plain strings). */
function sameSecret(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

export type FreshnessResult = { ok: true } | { ok: false; variable: IntakeFreshnessVar; message: string };

/**
 * Fails closed unless BOTH human-intake variables in this process equal the authoritative Windows
 * User environment. A stale process (a shell started before the User variable was replaced) is
 * refused before any Jira request. Messages name the variable, never a value.
 */
export async function checkIntakeCredentialFreshness(env: Record<string, string | undefined>, readUserEnv: UserEnvReader): Promise<FreshnessResult> {
  for (const name of INTAKE_FRESHNESS_VARS) {
    const processValue = (env[name] ?? '').trim();
    if (processValue === '') return { ok: false, variable: name, message: `${name} is not set in this process` };
    let user: UserEnvRead;
    try {
      user = await readUserEnv(name);
    } catch {
      user = { state: 'unavailable', reason: 'the Windows User environment could not be read' };
    }
    if (user.state === 'unavailable') return { ok: false, variable: name, message: `cannot verify ${name} freshness: ${user.reason}; refusing (the Windows User environment is the authoritative source)` };
    if (user.state === 'absent') return { ok: false, variable: name, message: `${name} is not set in the Windows User environment; set it there, then refresh this process` };
    if (!sameSecret(processValue, user.value.trim())) {
      return { ok: false, variable: name, message: `${name} process environment is stale; refresh the process environment from the Windows User environment before retrying.` };
    }
  }
  return { ok: true };
}

export interface CreateFormField {
  fieldId: string;
  name: string;
  required: boolean;
  hasDefaultValue: boolean;
}

export interface IntakeJira {
  myself(): Promise<{ accountId: string; accountType: string; active: boolean; displayName: string }>;
  permissions(keys: readonly string[]): Promise<Record<string, boolean | undefined>>;
  createForm(issueTypeId: string): Promise<CreateFormField[]>;
  searchKeys(jql: string): Promise<string[]>;
  getIssue(key: string, fields: readonly string[]): Promise<JiraIssue>;
  createIssue(kind: 'story' | 'ac', fields: Record<string, unknown>): Promise<string>;
}

export function createIntakeJira(opts: { credentials: JiraCredentials; fetchImpl?: Fetch; timeoutMs?: number }): IntakeJira {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const auth = authorizationHeader(opts.credentials);
  const get = (path: string) => request(doFetch, auth, timeoutMs, 'GET', path);
  return {
    async myself() {
      const b = (await get('/rest/api/3/myself')) as Record<string, unknown>;
      if (!b || typeof b.accountId !== 'string') throw new IntakeJiraError('JIRA_MALFORMED', 'Jira /myself has no accountId');
      return {
        accountId: b.accountId,
        accountType: typeof b.accountType === 'string' ? b.accountType : '',
        active: b.active === true,
        displayName: typeof b.displayName === 'string' ? b.displayName : '',
      };
    },
    async permissions(keys) {
      if (keys.some((k) => !/^[A-Z_]{3,40}$/.test(k))) throw new IntakeJiraError('JIRA_MALFORMED', 'invalid permission key');
      const b = (await get(`/rest/api/3/mypermissions?projectKey=OMNI&permissions=${keys.join(',')}`)) as { permissions?: Record<string, { havePermission?: unknown }> };
      const perms = b?.permissions;
      if (!perms || typeof perms !== 'object') throw new IntakeJiraError('JIRA_MALFORMED', 'Jira permissions response has no permissions');
      return Object.fromEntries(keys.map((k) => [k, typeof perms[k]?.havePermission === 'boolean' ? (perms[k].havePermission as boolean) : undefined]));
    },
    async createForm(issueTypeId) {
      if (!/^\d+$/.test(issueTypeId)) throw new IntakeJiraError('JIRA_MALFORMED', 'invalid issue type id');
      const out: CreateFormField[] = [];
      for (let startAt = 0, page = 0; page < 20; page++) {
        const b = (await get(`/rest/api/3/issue/createmeta/OMNI/issuetypes/${issueTypeId}?startAt=${startAt}&maxResults=200`)) as { fields?: unknown; values?: unknown; total?: unknown };
        const list = Array.isArray(b?.fields) ? b.fields : Array.isArray(b?.values) ? b.values : null;
        if (!list) throw new IntakeJiraError('JIRA_MALFORMED', 'Jira createmeta response has no fields');
        for (const f of list as Array<Record<string, unknown>>) {
          if (typeof f.fieldId !== 'string') continue;
          out.push({ fieldId: f.fieldId, name: typeof f.name === 'string' ? f.name : '', required: f.required === true, hasDefaultValue: f.hasDefaultValue === true });
        }
        startAt += list.length;
        if (list.length === 0 || typeof b.total !== 'number' || startAt >= b.total) return out;
      }
      throw new IntakeJiraError('JIRA_MALFORMED', 'Jira createmeta pagination did not terminate');
    },
    searchKeys: (jql) => searchKeys(doFetch, auth, timeoutMs, jql),
    async getIssue(key, fields) {
      if (!ISSUE_KEY_RE.test(key)) throw new IntakeJiraError('JIRA_MALFORMED', 'issue key must look like OMNI-<number>');
      const b = (await get(`/rest/api/2/issue/${key}?fields=${encodeURIComponent(fields.join(','))}`)) as JiraIssue;
      if (!b || typeof b.key !== 'string' || !b.fields) throw new IntakeJiraError('JIRA_MALFORMED', 'Jira issue response has no key/fields');
      return { key: b.key, fields: b.fields };
    },
    async createIssue(kind, fields) {
      assertIntakeFields(kind, fields);
      const b = (await request(doFetch, auth, timeoutMs, 'POST', '/rest/api/2/issue', { fields })) as { key?: unknown };
      if (typeof b?.key !== 'string' || !ISSUE_KEY_RE.test(b.key)) throw new IntakeJiraError('JIRA_MALFORMED', 'Jira create response has no issue key');
      return b.key;
    },
  };
}

// ---------------------------------------------------------------- payloads

export function storyPayload(stored: StoredIntakeProposal): Record<string, unknown> {
  const s = stored.proposal.story;
  const f: Record<string, unknown> = {
    project: { id: OMNI_PROJECT_ID },
    issuetype: { id: ISSUE_TYPE.story },
    summary: s.summary.slice(0, 250),
    labels: [stored.label],
    [STORY_FIELDS.objective]: s.objective,
    [STORY_AUTHORIZED_PATHS_FIELD]: s.authorized_paths.join('\n'),
    [STORY_FIELDS.prohibitedPaths]: s.prohibited_paths.join('\n'),
    [STORY_FIELDS.verificationRequirements]: s.verification_requirements.join('\n'),
  };
  if (s.architecture) f[STORY_FIELDS.architecture] = s.architecture;
  if (s.invariants.length > 0) f[STORY_FIELDS.invariants] = s.invariants.join('\n');
  return f;
}

export function acPayload(storyKey: string, ac: StoredIntakeProposal['proposal']['acceptance_criteria'][number]): Record<string, unknown> {
  return {
    project: { id: OMNI_PROJECT_ID },
    issuetype: { id: ISSUE_TYPE.acceptanceCriterion },
    summary: `${ac.ac_id} — ${ac.statement}`.slice(0, 250),
    parent: { key: storyKey },
    [AC_FIELDS.acId]: ac.ac_id,
    [AC_FIELDS.statement]: ac.statement,
    [AC_FIELDS.kind]: { value: ac.kind },
    [AC_FIELDS.evidenceKind]: { value: ac.evidence_kind },
  };
}

/** Problems with a create form for the fields intake intends to send; empty = usable. Pure. */
export function createFormProblems(kind: 'story' | 'ac', form: CreateFormField[], intended: readonly string[]): string[] {
  const allowed = kind === 'story' ? STORY_CREATE_FIELDS : AC_CREATE_FIELDS;
  const ids = new Set(form.map((f) => f.fieldId));
  const problems: string[] = [];
  for (const f of form) if (isGateField(f.fieldId, f.name)) problems.push(`gate field "${f.name || f.fieldId}" (${f.fieldId}) is on the ${kind} create form`);
  const implicit = createFormImplicit(kind);
  for (const id of intended) if (!implicit.includes(id) && !ids.has(id)) problems.push(`field ${id} is not on the ${kind} create form`);
  // The create form may expose ONLY the intake allowlist: any other field (gate or not) means the
  // screen is not intake-safe — refuse rather than create through it.
  for (const f of form) {
    if (implicit.includes(f.fieldId) || allowed.includes(f.fieldId) || isGateField(f.fieldId, f.name)) continue;
    problems.push(`field "${f.name || f.fieldId}" (${f.fieldId}) is on the ${kind} create form but outside the intake allowlist${f.required ? ' (required)' : ''}`);
  }
  return problems.sort();
}

// ---------------------------------------------------------------- apply

export type ApplyRefusal = 'IDENTITY_NOT_HUMAN' | 'PERMISSION_MISSING' | 'CREATE_FORM_INVALID' | 'DUPLICATE_INTAKE_STORY' | 'JIRA_ERROR';

export interface ApplyResult {
  ok: boolean;
  refusal: ApplyRefusal | null;
  message: string;
  approved_by: { account_id: string; display_name: string } | null;
  story_key: string | null;
  created_story: boolean;
  created_acs: string[];
  reused_acs: string[];
}

export const APPLY_REQUIRED_PERMISSIONS: readonly string[] = ['BROWSE_PROJECTS', 'CREATE_ISSUES'];

/**
 * Creates the proposal's Story and ACs in OMNI under the human identity.
 * Checks identity, permissions and both create forms BEFORE creating
 * anything; then reuses or creates. Never edits, deletes or moves a workflow status.
 */
export interface FormsCheck {
  ok: boolean;
  refusal: 'IDENTITY_NOT_HUMAN' | 'PERMISSION_MISSING' | 'CREATE_FORM_INVALID' | null;
  message: string;
  approved_by: { account_id: string; display_name: string } | null;
  problems: string[];
  story_form: CreateFormField[];
  ac_form: CreateFormField[];
}

/**
 * Read-only preflight shared by `--check-forms` and `--apply`: an active human account, Browse +
 * Create in OMNI, and both create forms intake-safe for the intended fields. GET requests only.
 */
export async function checkCreateForms(jira: IntakeJira, storyIntended: readonly string[], acIntended: readonly string[]): Promise<FormsCheck> {
  const out: FormsCheck = { ok: false, refusal: null, message: '', approved_by: null, problems: [], story_form: [], ac_form: [] };
  const me = await jira.myself();
  if (me.accountType !== 'atlassian' || me.active !== true) {
    return Object.assign(out, { refusal: 'IDENTITY_NOT_HUMAN', message: `the Jira identity is not an active human account (accountType ${me.accountType || 'unknown'})` });
  }
  out.approved_by = { account_id: me.accountId, display_name: me.displayName };
  const perms = await jira.permissions(APPLY_REQUIRED_PERMISSIONS);
  const missing = APPLY_REQUIRED_PERMISSIONS.filter((k) => perms[k] !== true);
  if (missing.length > 0) return Object.assign(out, { refusal: 'PERMISSION_MISSING', message: `the Jira identity lacks ${missing.join(', ')} in OMNI` });
  out.story_form = await jira.createForm(ISSUE_TYPE.story);
  out.ac_form = await jira.createForm(ISSUE_TYPE.acceptanceCriterion);
  out.problems = [...createFormProblems('story', out.story_form, storyIntended), ...createFormProblems('ac', out.ac_form, acIntended)];
  if (out.problems.length > 0) return Object.assign(out, { refusal: 'CREATE_FORM_INVALID', message: `create forms are not intake-safe: ${out.problems.join('; ')}` });
  return Object.assign(out, { ok: true, message: 'both create forms expose only the intake allowlist and every field intake sends' });
}

export async function applyIntakeProposal(stored: StoredIntakeProposal, jira: IntakeJira): Promise<ApplyResult> {
  const result: ApplyResult = { ok: false, refusal: null, message: '', approved_by: null, story_key: null, created_story: false, created_acs: [], reused_acs: [] };
  const fail = (refusal: ApplyRefusal, message: string): ApplyResult => Object.assign(result, { ok: false, refusal, message });
  try {
    const storyFields = storyPayload(stored);
    const acFields = stored.proposal.acceptance_criteria.map((ac) => acPayload('OMNI-1', ac));
    assertIntakeFields('story', storyFields);
    for (const f of acFields) assertIntakeFields('ac', f);
    const acIntended = [...new Set(acFields.flatMap((f) => Object.keys(f)))];
    const forms = await checkCreateForms(jira, Object.keys(storyFields), acIntended);
    result.approved_by = forms.approved_by;
    if (!forms.ok) return fail(forms.refusal ?? 'CREATE_FORM_INVALID', forms.refusal === 'CREATE_FORM_INVALID' ? `nothing was created: ${forms.problems.join('; ')}` : forms.message);

    const existing = await jira.searchKeys(`project = OMNI AND issuetype = ${ISSUE_TYPE.story} AND labels = "${stored.label}" ORDER BY key ASC`);
    if (existing.length > 1) return fail('DUPLICATE_INTAKE_STORY', `${existing.length} Stories carry ${stored.label}: ${existing.join(', ')}`);
    let storyKey: string;
    if (existing.length === 1) {
      storyKey = existing[0];
    } else {
      storyKey = await jira.createIssue('story', storyFields);
      result.created_story = true;
    }
    result.story_key = storyKey;

    const acKeys = await jira.searchKeys(`parent = ${storyKey} AND issuetype = ${ISSUE_TYPE.acceptanceCriterion} ORDER BY key ASC`);
    const have = new Map<string, string>();
    for (const k of acKeys) {
      const issue = await jira.getIssue(k, [AC_FIELDS.acId]);
      const id = issue.fields[AC_FIELDS.acId];
      if (typeof id === 'string' && id.trim() !== '') have.set(id.trim(), k);
    }
    for (const ac of stored.proposal.acceptance_criteria) {
      const prior = have.get(ac.ac_id);
      if (prior) {
        result.reused_acs.push(prior);
        continue;
      }
      result.created_acs.push(await jira.createIssue('ac', acPayload(storyKey, ac)));
    }
    result.ok = true;
    result.message = `${result.created_story ? 'created' : 'reused'} ${storyKey}; ${result.created_acs.length} AC(s) created, ${result.reused_acs.length} reused`;
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    return fail('JIRA_ERROR', `${e.code ?? 'ERROR'}: ${e.message}${result.story_key ? ` (after ${result.story_key})` : ''}`);
  }
}
