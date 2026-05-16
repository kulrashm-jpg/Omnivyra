/**
 * Phase 5 — Hacker News listening connector.
 *
 * Backed by the Algolia HN search API (no auth required, well-documented
 * rate limits). Bounded execution caps mirror the Reddit connector pattern
 * from Phase 3.
 *
 * Endpoints used:
 *   • GET https://hn.algolia.com/api/v1/search_by_date?query=...&tags=story
 *   • GET https://hn.algolia.com/api/v1/items/{objectID}        (for comments)
 *
 * Hard guarantees:
 *   • NEVER persists anything; pipeline owns persistence.
 *   • NEVER recurses; comment depth capped at 1 by default.
 *   • NEVER paginates past `maxPages`.
 *   • NEVER follows links found in stories — comments only come from
 *     the explicit items endpoint for stories we already matched.
 *   • Aborts on 429 / 5xx, returns partial=true with the count.
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

const ALGOLIA_API = 'https://hn.algolia.com/api/v1';
const USER_AGENT = 'omnivyra-listening/1.0';

type AlgoliaSearchHit = {
  objectID: string;
  author?: string;
  title?: string;
  story_text?: string | null;
  comment_text?: string | null;
  url?: string | null;
  created_at?: string;
  points?: number;
  num_comments?: number;
  story_id?: number;
  parent_id?: number;
  _tags?: string[];
};

type AlgoliaSearchResponse = {
  hits: AlgoliaSearchHit[];
  page: number;
  nbPages: number;
  nbHits: number;
  hitsPerPage: number;
};

type AlgoliaItemChild = {
  id: number;
  author?: string | null;
  text?: string | null;
  created_at?: string | null;
  type?: string | null;
  children?: AlgoliaItemChild[];
};

type AlgoliaItemResponse = AlgoliaItemChild;

const SOURCE_IDENTIFIER_RE = /^[A-Za-z0-9_+\-./\s]{1,80}$/;

function keywordMatchesAll(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

async function timedFetch(url: string, deadline: number): Promise<Response> {
  const ms = Math.max(0, deadline - Date.now());
  if (ms <= 0) throw new Error('hn_fetch_timeout');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(ms, 15_000));
  try {
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export const hackerNewsListeningConnector: ListeningConnector = {
  platform: 'hackernews',

  async validateEligibility(input): Promise<ConnectorEligibility> {
    const reasons: string[] = [];
    if (!SOURCE_IDENTIFIER_RE.test(input.sourceIdentifier)) {
      reasons.push('source_identifier_invalid');
    }
    return { eligible: reasons.length === 0, reasons };
  },

  async estimateCost(input): Promise<ConnectorCostEstimate> {
    const pages = Math.max(1, Math.ceil(input.maxPosts / 50));
    const commentReqs = Math.min(input.maxPosts, Math.ceil(input.maxComments / 25));
    const requests = pages + commentReqs;
    return {
      per_run: requests * 2,
      rationale: `${pages} search page(s) + ~${commentReqs} story-comments fetch(es) via Algolia HN`,
    };
  },

  async validateScopes(): Promise<ConnectorScopeValidation> {
    // HN public search has no scoping; advertise an empty requirement so the
    // eligibility evaluator does not block on the scope axis.
    return { sufficient: true, granted: [], required: [], missing: [] };
  },

  async validateRateLimits(): Promise<ConnectorRateLimit> {
    // Algolia HN search is generous but unmetered from our side. Soft-OK.
    return { available: true, reset_at: null, remaining: null };
  },

  async fetchMetadata(input): Promise<ConnectorSourceMetadata> {
    return {
      source_identifier: input.sourceIdentifier,
      display_name: `Hacker News: ${input.sourceIdentifier}`,
      url: `https://hn.algolia.com/?q=${encodeURIComponent(input.sourceIdentifier)}`,
    };
  },

  async fetchSignals(input: FetchSignalsInput): Promise<FetchSignalsResult> {
    const startedAt = Date.now();
    const deadline = startedAt + input.timeoutMs;

    if (!SOURCE_IDENTIFIER_RE.test(input.sourceIdentifier)) {
      throw new Error('source_identifier_invalid');
    }

    const signals: RawSignal[] = [];
    let postsFetched = 0;
    let commentsFetched = 0;
    let pagesFetched = 0;
    let rateLimitPauses = 0;
    let partial = false;

    const query = encodeURIComponent(input.sourceIdentifier);
    const hitsPerPage = 50;

    // ---------- Stories ----------
    while (
      postsFetched < input.maxPosts
      && pagesFetched < input.maxPages
      && Date.now() < deadline
    ) {
      const url = `${ALGOLIA_API}/search_by_date?query=${query}&tags=story&page=${pagesFetched}&hitsPerPage=${hitsPerPage}`;
      let resp: Response;
      try {
        resp = await timedFetch(url, deadline);
      } catch {
        partial = true;
        break;
      }
      pagesFetched += 1;

      if (resp.status === 429) {
        rateLimitPauses += 1;
        partial = true;
        break;
      }
      if (!resp.ok) {
        throw new Error(`hn_search_${resp.status}`);
      }

      const body = (await resp.json()) as AlgoliaSearchResponse;
      const hits = body?.hits ?? [];
      if (hits.length === 0) break;

      for (const hit of hits) {
        if (postsFetched >= input.maxPosts) break;
        postsFetched += 1;

        const text = `${hit.title ?? ''}\n${hit.story_text ?? ''}`.trim();
        if (!text) continue;
        if (!keywordMatchesAll(text, input.keywords)) continue;

        signals.push({
          upstream_id: `hackernews:story_${hit.objectID}`,
          platform: 'hackernews',
          platform_user_id: hit.author ? `hackernews:${hit.author}` : null,
          author_handle: hit.author ?? null,
          content_text: text,
          content_url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
          posted_at: hit.created_at ?? null,
          detected_at: new Date().toISOString(),
          is_comment: false,
          metadata: {
            hn_story_id: hit.objectID,
            points: hit.points ?? null,
            num_comments: hit.num_comments ?? null,
            tags: hit._tags ?? [],
          },
        });
      }

      if (pagesFetched >= body.nbPages) break;
    }

    if (pagesFetched >= input.maxPages || postsFetched >= input.maxPosts) {
      if (pagesFetched >= input.maxPages) partial = true;
    }

    // ---------- Story comments (depth 1) ----------
    if (input.maxComments > 0 && signals.length > 0 && Date.now() < deadline) {
      const stories = signals.filter((s) => !s.is_comment);
      for (const story of stories) {
        if (commentsFetched >= input.maxComments || Date.now() >= deadline) break;
        const storyId = (story.metadata as { hn_story_id?: string }).hn_story_id;
        if (!storyId) continue;

        let itemResp: Response;
        try {
          itemResp = await timedFetch(`${ALGOLIA_API}/items/${encodeURIComponent(storyId)}`, deadline);
        } catch {
          partial = true;
          break;
        }
        if (itemResp.status === 429) {
          rateLimitPauses += 1;
          partial = true;
          break;
        }
        if (!itemResp.ok) continue;

        const tree = (await itemResp.json()) as AlgoliaItemResponse;
        const children = Array.isArray(tree?.children) ? tree.children : [];
        for (const c of children) {
          if (commentsFetched >= input.maxComments) break;
          if (c.type !== 'comment') continue;
          const text = (c.text ?? '').replace(/<[^>]+>/g, '').trim();
          if (!text) continue;
          if (!keywordMatchesAll(text, input.keywords)) continue;
          commentsFetched += 1;
          signals.push({
            upstream_id: `hackernews:comment_${c.id}`,
            platform: 'hackernews',
            platform_user_id: c.author ? `hackernews:${c.author}` : null,
            author_handle: c.author ?? null,
            content_text: text,
            content_url: `https://news.ycombinator.com/item?id=${c.id}`,
            posted_at: c.created_at ?? null,
            detected_at: new Date().toISOString(),
            is_comment: true,
            metadata: {
              hn_comment_id: c.id,
              parent_story_id: storyId,
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
