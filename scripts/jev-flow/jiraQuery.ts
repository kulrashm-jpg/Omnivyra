/**
 * gov read-only Jira access: one Story and its Acceptance Criteria.
 *
 * Built alongside the Phase 2 client (never modifies it): single issues are
 * read through `createJiraClient(...).getIssue` (REST v2 → plain-text fields);
 * the AC list comes from one JQL search on the same gateway, same
 * Authorization header, redirects refused. GET only — this module has no
 * write path. Errors carry a code and HTTP status only, never a body or a
 * credential.
 */
import { AC_FIELDS, ISSUE_TYPE, JIRA_GATEWAY_BASE, STORY_FIELDS } from '../jev-jira/fields';
import { ISSUE_KEY_RE, JiraClientError, authorizationHeader, createJiraClient, type JiraCredentials, type JiraIssue } from '../jev-jira/jiraClient';

/** Story "Authorized Paths" (not part of the Phase 2 STORY_FIELDS set). */
export const STORY_AUTHORIZED_PATHS_FIELD = 'customfield_10083';

export const GOV_STORY_FIELDS: readonly string[] = [
  'summary',
  'issuetype',
  'project',
  'status',
  'updated',
  STORY_FIELDS.objective,
  STORY_FIELDS.architecture,
  STORY_FIELDS.invariants,
  STORY_AUTHORIZED_PATHS_FIELD,
  STORY_FIELDS.prohibitedPaths,
  STORY_FIELDS.verificationRequirements,
];

export const GOV_AC_FIELDS: readonly string[] = [
  'summary',
  'issuetype',
  'project',
  'status',
  'parent',
  'updated',
  AC_FIELDS.acId,
  AC_FIELDS.statement,
  AC_FIELDS.kind,
  AC_FIELDS.evidenceKind,
  AC_FIELDS.verification,
];

const SEARCH_PAGE_SIZE = 100;
/** Hard stop against a misbehaving paginator. */
const MAX_SEARCH_PAGES = 50;

export interface JiraQuery {
  /** The Story, or null when Jira answers 404. */
  getStory(key: string): Promise<JiraIssue | null>;
  /** Every Acceptance Criterion sub-task of the Story, in Jira key order. */
  listAcceptanceCriteria(storyKey: string): Promise<JiraIssue[]>;
}

export function createJiraQuery(opts: { credentials: JiraCredentials; fetchImpl?: typeof fetch; timeoutMs?: number }): JiraQuery {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const auth = authorizationHeader(opts.credentials);
  const client = createJiraClient({ credentials: opts.credentials, fetchImpl: doFetch, timeoutMs });

  function assertKey(key: string): void {
    if (!ISSUE_KEY_RE.test(key)) throw new JiraClientError('JIRA_MALFORMED', 'issue key must look like OMNI-<number>');
  }

  async function searchPage(jql: string, nextPageToken: string | null): Promise<{ keys: string[]; next: string | null }> {
    const params = [`jql=${encodeURIComponent(jql)}`, 'fields=key', `maxResults=${SEARCH_PAGE_SIZE}`];
    if (nextPageToken !== null) params.push(`nextPageToken=${encodeURIComponent(nextPageToken)}`);
    let res: Response;
    try {
      res = await doFetch(`${JIRA_GATEWAY_BASE}/rest/api/3/search/jql?${params.join('&')}`, {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: auth, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new JiraClientError('JIRA_NETWORK_ERROR', 'Jira GET failed before a response');
    }
    if (res.status === 404) throw new JiraClientError('JIRA_NOT_FOUND', 'Jira returned HTTP 404');
    if (res.status === 401 || res.status === 403) throw new JiraClientError('JIRA_AUTH', `Jira returned HTTP ${res.status}`);
    if (!res.ok) throw new JiraClientError('JIRA_HTTP_ERROR', `Jira returned HTTP ${res.status}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      throw new JiraClientError('JIRA_MALFORMED', 'Jira search response is not valid JSON');
    }
    const body = parsed as { issues?: unknown; nextPageToken?: unknown; isLast?: unknown };
    if (!body || !Array.isArray(body.issues)) throw new JiraClientError('JIRA_MALFORMED', 'Jira search response has no issues');
    const keys = body.issues.map((i) => (i as { key?: unknown })?.key);
    if (keys.some((k) => typeof k !== 'string' || !ISSUE_KEY_RE.test(k))) {
      throw new JiraClientError('JIRA_MALFORMED', 'Jira search returned an invalid issue key');
    }
    const last = body.isLast === true || typeof body.nextPageToken !== 'string' || body.nextPageToken === '';
    return { keys: keys as string[], next: last ? null : (body.nextPageToken as string) };
  }

  return {
    async getStory(key) {
      assertKey(key);
      try {
        return await client.getIssue(key, GOV_STORY_FIELDS);
      } catch (err) {
        if (err instanceof JiraClientError && err.code === 'JIRA_NOT_FOUND') return null;
        throw err;
      }
    },

    async listAcceptanceCriteria(storyKey) {
      assertKey(storyKey);
      const jql = `parent = ${storyKey} AND issuetype = ${ISSUE_TYPE.acceptanceCriterion} ORDER BY key ASC`;
      const keys: string[] = [];
      let token: string | null = null;
      for (let page = 0; ; page++) {
        if (page >= MAX_SEARCH_PAGES) throw new JiraClientError('JIRA_MALFORMED', 'Jira search pagination did not terminate');
        const { keys: pageKeys, next } = await searchPage(jql, token);
        keys.push(...pageKeys);
        if (next === null) break;
        token = next;
      }
      const unique = [...new Set(keys)];
      const out: JiraIssue[] = [];
      for (const key of unique) out.push(await client.getIssue(key, GOV_AC_FIELDS));
      return out;
    },
  };
}
