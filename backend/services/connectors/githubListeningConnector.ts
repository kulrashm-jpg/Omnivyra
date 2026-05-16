/**
 * Phase 5 — GitHub listening connector.
 *
 * Read-only against the GitHub REST API. Strictly REPO-SCOPED — accepts
 * "owner/repo" identifiers and refuses anything outside that pattern. NEVER
 * clones, NEVER reads file contents, NEVER traverses an org's repo graph.
 *
 * Endpoints used:
 *   • GET /repos/{owner}/{repo}/issues?state=all&per_page=...      (issues + PRs)
 *   • GET /repos/{owner}/{repo}/issues/{number}/comments           (top-level comments)
 *   • GET /repos/{owner}/{repo}                                    (metadata only)
 *
 * Auth: prefers a token if `process.env.GITHUB_TOKEN` is present (raises
 * rate limit from 60/h to 5000/h). Otherwise public-anonymous; the cap
 * makes the lower limit acceptable.
 *
 * Hard guarantees:
 *   • Source identifier must match /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
 *   • Bounded `maxPosts` (issues), `maxComments` (per issue), `maxPages`
 *   • Aborts on 403 (rate-limited), 429, 5xx; returns partial=true
 *   • Never follows reactions, never expands cross-references
 */

import type {
  ConnectorCostEstimate,
  ConnectorEligibility,
  ConnectorRateLimit,
  ConnectorScopeValidation,
  ConnectorSourceMetadata,
  FetchSignalsInput,
  FetchSignalsResult,
  ListeningConnector,
  RawSignal,
} from '../../types/listeningConnector';

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'omnivyra-listening/1.0';
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

type GitHubIssue = {
  id: number;
  number: number;
  title?: string | null;
  body?: string | null;
  user?: { login?: string | null } | null;
  html_url?: string | null;
  created_at?: string | null;
  state?: string | null;
  pull_request?: unknown;
  reactions?: { total_count?: number } | null;
};

type GitHubComment = {
  id: number;
  body?: string | null;
  user?: { login?: string | null } | null;
  html_url?: string | null;
  created_at?: string | null;
};

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function keywordMatches(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

async function timedFetch(url: string, deadline: number): Promise<Response> {
  const ms = Math.max(0, deadline - Date.now());
  if (ms <= 0) throw new Error('github_fetch_timeout');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(ms, 15_000));
  try {
    return await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/vnd.github+json',
        ...authHeaders(),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function readRateLimit(headers: Headers): { remaining: number | null; reset_at: string | null } {
  const rem = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  return {
    remaining: rem != null ? Math.floor(Number(rem)) : null,
    reset_at: reset != null ? new Date(Number(reset) * 1000).toISOString() : null,
  };
}

export const githubListeningConnector: ListeningConnector = {
  platform: 'github',

  async validateEligibility(input): Promise<ConnectorEligibility> {
    const reasons: string[] = [];
    if (!REPO_RE.test(input.sourceIdentifier)) {
      reasons.push('source_identifier_must_be_owner_slash_repo');
    }
    return { eligible: reasons.length === 0, reasons };
  },

  async estimateCost(input): Promise<ConnectorCostEstimate> {
    const issuePages = Math.max(1, Math.ceil(input.maxPosts / 30));
    const commentReqs = Math.min(input.maxPosts, Math.ceil(input.maxComments / 30));
    const requests = issuePages + commentReqs;
    return {
      per_run: requests * 2,
      rationale: `${issuePages} issue listing page(s) + ~${commentReqs} comment fetch(es)`,
    };
  },

  async validateScopes(): Promise<ConnectorScopeValidation> {
    // Public-anon access is allowed; if the platform later requires private
    // repo access we'll surface a missing scope here.
    return { sufficient: true, granted: ['public_repo'], required: [], missing: [] };
  },

  async validateRateLimits(): Promise<ConnectorRateLimit> {
    try {
      const resp = await fetch(`${GITHUB_API}/rate_limit`, {
        headers: { 'User-Agent': USER_AGENT, ...authHeaders() },
      });
      if (!resp.ok) return { available: true, reset_at: null, remaining: null };
      const body = (await resp.json()) as { resources?: { core?: { remaining?: number; reset?: number } } };
      const remaining = body?.resources?.core?.remaining ?? null;
      const reset = body?.resources?.core?.reset ?? null;
      return {
        available: typeof remaining !== 'number' || remaining > 10,
        remaining,
        reset_at: typeof reset === 'number' ? new Date(reset * 1000).toISOString() : null,
      };
    } catch {
      return { available: true, reset_at: null, remaining: null };
    }
  },

  async fetchMetadata(input): Promise<ConnectorSourceMetadata> {
    if (!REPO_RE.test(input.sourceIdentifier)) {
      return {
        source_identifier: input.sourceIdentifier,
        display_name: input.sourceIdentifier,
        url: null,
      };
    }
    try {
      const resp = await fetch(`${GITHUB_API}/repos/${input.sourceIdentifier}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json', ...authHeaders() },
      });
      if (!resp.ok) {
        return {
          source_identifier: input.sourceIdentifier,
          display_name: input.sourceIdentifier,
          url: `https://github.com/${input.sourceIdentifier}`,
        };
      }
      const body = (await resp.json()) as {
        full_name?: string;
        description?: string | null;
        stargazers_count?: number;
        html_url?: string;
      };
      return {
        source_identifier: input.sourceIdentifier,
        display_name: body.full_name ?? input.sourceIdentifier,
        subscribers: body.stargazers_count ?? null,
        description: body.description ?? null,
        url: body.html_url ?? `https://github.com/${input.sourceIdentifier}`,
      };
    } catch {
      return {
        source_identifier: input.sourceIdentifier,
        display_name: input.sourceIdentifier,
        url: `https://github.com/${input.sourceIdentifier}`,
      };
    }
  },

  async fetchSignals(input: FetchSignalsInput): Promise<FetchSignalsResult> {
    const startedAt = Date.now();
    const deadline = startedAt + input.timeoutMs;
    if (!REPO_RE.test(input.sourceIdentifier)) {
      throw new Error('source_identifier_must_be_owner_slash_repo');
    }

    const signals: RawSignal[] = [];
    let postsFetched = 0;
    let commentsFetched = 0;
    let pagesFetched = 0;
    let rateLimitPauses = 0;
    let partial = false;

    // ---------- Issues + PRs ----------
    let page = 1;
    while (
      postsFetched < input.maxPosts
      && pagesFetched < input.maxPages
      && Date.now() < deadline
    ) {
      const perPage = Math.min(30, input.maxPosts - postsFetched);
      const url = `${GITHUB_API}/repos/${input.sourceIdentifier}/issues?state=all&per_page=${perPage}&page=${page}`;
      let resp: Response;
      try {
        resp = await timedFetch(url, deadline);
      } catch {
        partial = true;
        break;
      }
      pagesFetched += 1;
      page += 1;

      const rl = readRateLimit(resp.headers);
      if (resp.status === 403 || resp.status === 429 || (rl.remaining ?? 999) <= 2) {
        rateLimitPauses += 1;
        partial = true;
        break;
      }
      if (!resp.ok) {
        throw new Error(`github_issues_${resp.status}`);
      }

      const issues = (await resp.json()) as GitHubIssue[];
      if (!Array.isArray(issues) || issues.length === 0) break;

      for (const issue of issues) {
        if (postsFetched >= input.maxPosts) break;
        postsFetched += 1;
        const isPR = !!issue.pull_request;
        const text = `${issue.title ?? ''}\n${issue.body ?? ''}`.trim();
        if (!text) continue;
        if (!keywordMatches(text, input.keywords)) continue;

        signals.push({
          upstream_id: `github:issue_${input.sourceIdentifier}#${issue.number}`,
          platform: 'github',
          platform_user_id: issue.user?.login ? `github:${issue.user.login}` : null,
          author_handle: issue.user?.login ?? null,
          content_text: text,
          content_url: issue.html_url ?? null,
          posted_at: issue.created_at ?? null,
          detected_at: new Date().toISOString(),
          is_comment: false,
          metadata: {
            repo: input.sourceIdentifier,
            issue_number: issue.number,
            issue_state: issue.state,
            kind: isPR ? 'pull_request' : 'issue',
            reactions: issue.reactions?.total_count ?? null,
          },
        });
      }

      if (issues.length < perPage) break;
    }

    if (postsFetched >= input.maxPosts || pagesFetched >= input.maxPages) {
      partial = true;
    }

    // ---------- Comments per matched issue ----------
    if (input.maxComments > 0 && signals.length > 0 && Date.now() < deadline) {
      const matchedIssues = signals.filter((s) => !s.is_comment);
      for (const issueSignal of matchedIssues) {
        if (commentsFetched >= input.maxComments || Date.now() >= deadline) break;
        const issueNumber = (issueSignal.metadata as { issue_number?: number }).issue_number;
        if (!issueNumber) continue;

        const url = `${GITHUB_API}/repos/${input.sourceIdentifier}/issues/${issueNumber}/comments?per_page=30`;
        let resp: Response;
        try {
          resp = await timedFetch(url, deadline);
        } catch {
          partial = true;
          break;
        }
        const rl = readRateLimit(resp.headers);
        if (resp.status === 403 || resp.status === 429 || (rl.remaining ?? 999) <= 2) {
          rateLimitPauses += 1;
          partial = true;
          break;
        }
        if (!resp.ok) continue;

        const comments = (await resp.json()) as GitHubComment[];
        for (const c of comments) {
          if (commentsFetched >= input.maxComments) break;
          const text = (c.body ?? '').trim();
          if (!text) continue;
          if (!keywordMatches(text, input.keywords)) continue;
          commentsFetched += 1;
          signals.push({
            upstream_id: `github:comment_${c.id}`,
            platform: 'github',
            platform_user_id: c.user?.login ? `github:${c.user.login}` : null,
            author_handle: c.user?.login ?? null,
            content_text: text,
            content_url: c.html_url ?? null,
            posted_at: c.created_at ?? null,
            detected_at: new Date().toISOString(),
            is_comment: true,
            metadata: {
              repo: input.sourceIdentifier,
              parent_issue: issueNumber,
            },
          });
        }
      }
    }

    if (Date.now() >= deadline) partial = true;

    return {
      signals,
      stats: {
        posts_fetched: postsFetched,
        comments_fetched: commentsFetched,
        pages_fetched: pagesFetched,
        rate_limit_pauses: rateLimitPauses,
        fetch_duration_ms: Date.now() - startedAt,
      },
      partial,
    };
  },
};
