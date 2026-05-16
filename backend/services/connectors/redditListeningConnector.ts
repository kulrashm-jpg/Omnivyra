/**
 * Phase 3 — Reddit listening connector (OAuth, BOUNDED).
 *
 * Reads recent posts (and optionally top-level comments) from a single
 * explicitly-configured subreddit. Filters by keyword. Hard caps on posts,
 * comments, pages, and wall-clock time. NEVER discovers new subreddits.
 * NEVER paginates indefinitely. NEVER persists anything.
 *
 * Auth: uses the OAuth token already persisted via the Community-AI Reddit
 * connector flow (platformTokenService). If the token cannot be read,
 * `validateScopes` returns insufficient and the pipeline blocks before any
 * network call.
 *
 * Rate limiting: Reddit returns x-ratelimit-* headers. The connector reads
 * them after every request and aborts the run when fewer than 5 requests
 * remain, recording a `rate_limit_pauses` count for observability.
 */

import type {
  ConnectorEligibility,
  ConnectorCostEstimate,
  ConnectorRateLimit,
  ConnectorScopeValidation,
  ConnectorSourceMetadata,
  FetchSignalsInput,
  FetchSignalsResult,
  ListeningConnector,
  RawSignal,
} from '../../types/listeningConnector';
import { getToken } from '../platformTokenService';

const REDDIT_API = 'https://oauth.reddit.com';
const USER_AGENT = 'omnivyra-listening/1.0 (by /u/omnivyra-bot)';
const REQUIRED_SCOPES = ['read'];

const SUBREDDIT_RE = /^[A-Za-z0-9_]{2,21}$/;

type RedditListingChild = {
  kind: string;
  data: {
    id: string;
    name: string;
    author?: string;
    title?: string;
    selftext?: string;
    body?: string;
    permalink?: string;
    url?: string;
    created_utc?: number;
    subreddit?: string;
    ups?: number;
    num_comments?: number;
    is_self?: boolean;
  };
};

type RedditListingResponse = {
  data: {
    after: string | null;
    children: RedditListingChild[];
  };
};

type RateLimitHeaders = {
  remaining: number | null;
  reset_at: string | null;
  used: number | null;
};

function readRateLimit(headers: Headers): RateLimitHeaders {
  const rem = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  const used = headers.get('x-ratelimit-used');
  return {
    remaining: rem != null ? Math.floor(Number(rem)) : null,
    reset_at: reset != null ? new Date(Date.now() + Number(reset) * 1000).toISOString() : null,
    used: used != null ? Math.floor(Number(used)) : null,
  };
}

function keywordMatches(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

async function fetchOAuthToken(organizationId: string): Promise<string | null> {
  // tenant_id == organization_id in the consolidated token model.
  const token = await getToken(organizationId, organizationId, 'reddit');
  return token?.access_token ?? null;
}

export const redditListeningConnector: ListeningConnector = {
  platform: 'reddit',

  async validateEligibility(input): Promise<ConnectorEligibility> {
    const reasons: string[] = [];
    if (!SUBREDDIT_RE.test(input.sourceIdentifier)) {
      reasons.push('source_identifier_invalid_subreddit_name');
    }
    const token = await fetchOAuthToken(input.organizationId);
    if (!token) reasons.push('oauth_token_unavailable');
    return { eligible: reasons.length === 0, reasons };
  },

  async estimateCost(input): Promise<ConnectorCostEstimate> {
    // Reddit cost model is dominated by request count: one per page of
    // posts plus one per post when fetching comments. Deterministic.
    const pages = Math.ceil(input.maxPosts / 25);
    const requests = pages + Math.min(input.maxPosts, Math.ceil(input.maxComments / 25));
    return {
      per_run: requests * 3, // 3 credit-units per request (cost model alignment)
      rationale: `${pages} listing page(s) + ~${requests - pages} comment fetch(es)`,
    };
  },

  async validateScopes(input): Promise<ConnectorScopeValidation> {
    const token = await fetchOAuthToken(input.organizationId);
    if (!token) {
      return { sufficient: false, granted: [], required: REQUIRED_SCOPES, missing: REQUIRED_SCOPES };
    }
    // We don't currently re-parse the OAuth response per request; the
    // 'read' scope is implied by a successful authorization on a Reddit
    // user-context token. A future tightening reads social_accounts.granted_scopes
    // for the row and intersects with REQUIRED_SCOPES; doing so here would
    // require fetching the account row again. Phase 3 leaves this as a soft
    // approval and lets fetchSignals' 401/403 handling surface real auth gaps.
    return { sufficient: true, granted: ['read'], required: REQUIRED_SCOPES, missing: [] };
  },

  async validateRateLimits(input): Promise<ConnectorRateLimit> {
    // Cheap probe: HEAD-ish call against /api/v1/me to inspect headers.
    // If unauthorised, we surface this as a transient `available=false`.
    const token = await fetchOAuthToken(input.organizationId);
    if (!token) return { available: false, reset_at: null, remaining: null, detail: 'no_oauth_token' };
    try {
      const resp = await fetch(`${REDDIT_API}/api/v1/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
      });
      const rl = readRateLimit(resp.headers);
      return {
        available: resp.ok && (rl.remaining ?? 0) > 5,
        reset_at: rl.reset_at,
        remaining: rl.remaining,
        detail: resp.ok ? undefined : `probe_status_${resp.status}`,
      };
    } catch (err: any) {
      return { available: false, reset_at: null, remaining: null, detail: `probe_failed:${err?.message ?? 'unknown'}` };
    }
  },

  async fetchMetadata(input): Promise<ConnectorSourceMetadata> {
    const token = await fetchOAuthToken(input.organizationId);
    if (!token) {
      return {
        source_identifier: input.sourceIdentifier,
        display_name: `r/${input.sourceIdentifier}`,
        url: `https://www.reddit.com/r/${input.sourceIdentifier}`,
      };
    }
    try {
      const resp = await fetch(`${REDDIT_API}/r/${encodeURIComponent(input.sourceIdentifier)}/about`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
      });
      if (!resp.ok) {
        return {
          source_identifier: input.sourceIdentifier,
          display_name: `r/${input.sourceIdentifier}`,
          url: `https://www.reddit.com/r/${input.sourceIdentifier}`,
        };
      }
      const body = await resp.json().catch(() => null) as { data?: { display_name?: string; subscribers?: number; public_description?: string } } | null;
      const d = body?.data;
      return {
        source_identifier: input.sourceIdentifier,
        display_name: d?.display_name ? `r/${d.display_name}` : `r/${input.sourceIdentifier}`,
        subscribers: typeof d?.subscribers === 'number' ? d.subscribers : null,
        description: d?.public_description ?? null,
        url: `https://www.reddit.com/r/${input.sourceIdentifier}`,
      };
    } catch {
      return {
        source_identifier: input.sourceIdentifier,
        display_name: `r/${input.sourceIdentifier}`,
        url: `https://www.reddit.com/r/${input.sourceIdentifier}`,
      };
    }
  },

  async fetchSignals(input: FetchSignalsInput): Promise<FetchSignalsResult> {
    const startedAt = Date.now();
    const deadline = startedAt + input.timeoutMs;

    if (!SUBREDDIT_RE.test(input.sourceIdentifier)) {
      throw new Error('source_identifier_invalid_subreddit_name');
    }

    const token = await fetchOAuthToken(input.organizationId);
    if (!token) throw new Error('oauth_token_unavailable');

    const signals: RawSignal[] = [];
    let postsFetched = 0;
    let commentsFetched = 0;
    let pagesFetched = 0;
    let rateLimitPauses = 0;
    let after: string | null = null;
    let partial = false;

    // -------- Listings (posts) ----------------------------------------------
    while (
      postsFetched < input.maxPosts
      && pagesFetched < input.maxPages
      && Date.now() < deadline
    ) {
      const url = new URL(`${REDDIT_API}/r/${encodeURIComponent(input.sourceIdentifier)}/new`);
      url.searchParams.set('limit', String(Math.min(100, input.maxPosts - postsFetched)));
      if (after) url.searchParams.set('after', after);

      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
      });
      pagesFetched += 1;

      const rl = readRateLimit(resp.headers);
      if ((rl.remaining ?? 999) <= 5) {
        rateLimitPauses += 1;
        partial = true;
        break;
      }
      if (resp.status === 429) {
        rateLimitPauses += 1;
        partial = true;
        break;
      }
      if (!resp.ok) {
        throw new Error(`reddit_listing_${resp.status}`);
      }

      const body = (await resp.json()) as RedditListingResponse;
      const children = body?.data?.children ?? [];
      after = body?.data?.after ?? null;

      for (const child of children) {
        if (postsFetched >= input.maxPosts) break;
        const d = child.data;
        if (!d?.id) continue;
        postsFetched += 1;

        const text = `${d.title ?? ''}\n${d.selftext ?? ''}`.trim();
        if (!text) continue;
        if (!keywordMatches(text, input.keywords)) continue;

        signals.push({
          upstream_id: `reddit:t3_${d.id}`,
          platform: 'reddit',
          platform_user_id: d.author ? `reddit:${d.author}` : null,
          author_handle: d.author ?? null,
          content_text: text,
          content_url: d.permalink ? `https://www.reddit.com${d.permalink}` : (d.url ?? null),
          posted_at: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
          detected_at: new Date().toISOString(),
          is_comment: false,
          metadata: {
            subreddit: d.subreddit ?? input.sourceIdentifier,
            ups: d.ups ?? null,
            num_comments: d.num_comments ?? null,
            is_self: d.is_self ?? null,
            upstream_name: d.name,
          },
        });
      }

      if (!after) break;
      if (postsFetched >= input.maxPosts) break;
    }

    if (postsFetched >= input.maxPosts || pagesFetched >= input.maxPages) {
      // Hit a cap before exhausting the listing — flag partial so the
      // pipeline records it.
      if (postsFetched >= input.maxPosts && after !== null) partial = true;
      if (pagesFetched >= input.maxPages && after !== null) partial = true;
    }

    // -------- Comments ------------------------------------------------------
    // Only fetched if the caller actually allowed comment budget. We pull
    // top-level comments for the posts we kept (i.e. matched keywords),
    // capped at maxComments overall.
    if (input.maxComments > 0 && signals.length > 0 && Date.now() < deadline) {
      const matchedPosts = signals.filter((s) => !s.is_comment);
      for (const post of matchedPosts) {
        if (commentsFetched >= input.maxComments || Date.now() >= deadline) break;

        const id = post.metadata.upstream_name as string | undefined;
        if (!id) continue;
        const t3 = id.startsWith('t3_') ? id.slice(3) : id;

        const resp = await fetch(
          `${REDDIT_API}/comments/${encodeURIComponent(t3)}?limit=25&depth=1&sort=new`,
          { headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT } },
        );
        const rl = readRateLimit(resp.headers);
        if ((rl.remaining ?? 999) <= 5) {
          rateLimitPauses += 1;
          partial = true;
          break;
        }
        if (resp.status === 429) {
          rateLimitPauses += 1;
          partial = true;
          break;
        }
        if (!resp.ok) continue;

        const body = (await resp.json()) as RedditListingResponse[];
        const commentsListing = Array.isArray(body) && body.length > 1 ? body[1] : null;
        const commentChildren = commentsListing?.data?.children ?? [];

        for (const c of commentChildren) {
          if (commentsFetched >= input.maxComments) break;
          if (c.kind !== 't1') continue;
          const d = c.data;
          const text = (d.body ?? '').trim();
          if (!text) continue;
          if (!keywordMatches(text, input.keywords)) continue;

          commentsFetched += 1;
          signals.push({
            upstream_id: `reddit:t1_${d.id}`,
            platform: 'reddit',
            platform_user_id: d.author ? `reddit:${d.author}` : null,
            author_handle: d.author ?? null,
            content_text: text,
            content_url: d.permalink
              ? `https://www.reddit.com${d.permalink}`
              : `https://www.reddit.com${post.metadata.subreddit ? `/r/${post.metadata.subreddit}/comments/${t3}/_/${d.id}` : `/comments/${t3}`}`,
            posted_at: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
            detected_at: new Date().toISOString(),
            is_comment: true,
            metadata: {
              subreddit: d.subreddit ?? post.metadata.subreddit ?? input.sourceIdentifier,
              ups: d.ups ?? null,
              parent_post_t3: t3,
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

// Phase 5 — the canonical connector lookup lives in
// ./listeningConnectorRegistry. The Reddit connector is just a concrete
// implementation registered there.
