/**
 * Phase 3 — Listening connector contract.
 *
 * Every platform integration that participates in autonomous listening must
 * conform to this interface. Phase 3 only ships the Reddit implementation;
 * additional connectors land in later phases and must NOT bypass any of
 * these methods.
 *
 * Hard contracts:
 *   • All methods are async and must terminate within the connector's
 *     declared timeout. No method may spawn long-running listeners.
 *   • `fetchSignals()` must return a BOUNDED RawSignal[] — implementations
 *     are responsible for honouring `maxPosts` / `maxComments` / pagination
 *     caps from the input.
 *   • No connector may persist anything. Persistence is the pipeline's job.
 *   • No connector may call AI / classification services directly. Scoring
 *     happens in the pipeline after moderation.
 */

export type ConnectorEligibility = {
  eligible: boolean;
  reasons: string[];
};

export type ConnectorCostEstimate = {
  per_run: number;
  rationale: string;
};

export type ConnectorScopeValidation = {
  sufficient: boolean;
  granted: string[];
  required: string[];
  missing: string[];
};

export type ConnectorRateLimit = {
  available: boolean;
  reset_at: string | null;
  remaining: number | null;
  detail?: string;
};

export type ConnectorSourceMetadata = {
  source_identifier: string;
  display_name: string;
  subscribers?: number | null;
  description?: string | null;
  url?: string | null;
};

export type RawSignal = {
  /** Stable upstream id; used as a dedup component. */
  upstream_id: string;
  platform: string;
  platform_user_id: string | null;
  author_handle: string | null;
  content_text: string;
  content_url: string | null;
  posted_at: string | null;
  detected_at: string;
  /** True if this is a comment under a post (vs. the post itself). */
  is_comment: boolean;
  /** Free-form metadata; connector-specific. Pipeline preserves but does not interpret. */
  metadata: Record<string, unknown>;
};

export type FetchSignalsInput = {
  organizationId: string;
  sourceIdentifier: string;
  keywords: string[];
  /** Hard limit on posts pulled in a single execution. Connector MUST honour. */
  maxPosts: number;
  /** Hard limit on comments pulled in a single execution. Connector MUST honour. */
  maxComments: number;
  /** Hard limit on pagination pages. Connector MUST honour. */
  maxPages: number;
  /** Hard timeout for the entire fetch. Connector MUST abort beyond this. */
  timeoutMs: number;
};

export type FetchSignalsResult = {
  signals: RawSignal[];
  stats: {
    posts_fetched: number;
    comments_fetched: number;
    pages_fetched: number;
    rate_limit_pauses: number;
    fetch_duration_ms: number;
  };
  partial: boolean;
};

export interface ListeningConnector {
  readonly platform: string;

  validateEligibility(input: { organizationId: string; sourceIdentifier: string }): Promise<ConnectorEligibility>;
  estimateCost(input: { keywords: string[]; maxPosts: number; maxComments: number }): Promise<ConnectorCostEstimate>;
  validateScopes(input: { organizationId: string }): Promise<ConnectorScopeValidation>;
  validateRateLimits(input: { organizationId: string }): Promise<ConnectorRateLimit>;
  fetchMetadata(input: { organizationId: string; sourceIdentifier: string }): Promise<ConnectorSourceMetadata>;
  fetchSignals(input: FetchSignalsInput): Promise<FetchSignalsResult>;
}
