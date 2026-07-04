/**
 * Canonical Evidence Provider Contract  (BETA-ENGINE-004, Phase 2)
 *
 * ONE unified contract every external-evidence integration (backlinks, Search Console, analytics,
 * reviews, entity graph, LLM visibility, …) implements — a single switchboard shape replacing the
 * domain-fragmented interfaces. This phase defines architecture ONLY: no provider is implemented and
 * no external API is called. Providers convert their responses to the canonical Evidence model via a
 * `ProviderEvidenceAdapter` (see providerAdapter.ts); engines never see provider-specific payloads.
 *
 * Reuses the BETA-ARCH-001 Evidence Platform (Evidence model, maturity, provenance). It does NOT
 * duplicate the existing `intelligence/providerInterfaces.ts` domain framework — a canonical provider
 * MAY wrap an existing domain adapter; this layer is the unified metadata + failure + registry surface.
 */

/** Whether the provider currently has valid credentials. */
export const AUTH_STATUS = {
  AUTHENTICATED: 'authenticated',
  UNAUTHENTICATED: 'unauthenticated',
  EXPIRED: 'expired',
  NOT_REQUIRED: 'not_required',
} as const;
export type AuthStatus = (typeof AUTH_STATUS)[keyof typeof AUTH_STATUS];

/** Whether the provider can currently be reached. */
export const CONNECTION_STATUS = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  DEGRADED: 'degraded',
  UNKNOWN: 'unknown',
} as const;
export type ConnectionStatus = (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

/** Operational health. */
export const PROVIDER_HEALTH = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  DOWN: 'down',
  UNKNOWN: 'unknown',
} as const;
export type ProviderHealth = (typeof PROVIDER_HEALTH)[keyof typeof PROVIDER_HEALTH];

/** Coarse quality of the evidence a provider yields. */
export type EvidenceQuality = 'high' | 'medium' | 'low';

/** Deterministic rate-limit descriptor (no runtime enforcement in this phase). */
export interface RateLimit {
  requestsPerWindow: number;
  windowSeconds: number;
  /** Remaining in the current window, when known. */
  remaining?: number | null;
}

/** Freshness envelope a provider promises. */
export interface ProviderFreshness {
  /** Typical age of the data the provider returns, in hours. */
  typicalAgeHours: number | null;
  /** Age beyond which the provider's data should be treated as stale. */
  maxAgeHours: number | null;
}

/**
 * The canonical provider descriptor — the static, inspectable metadata every provider registers.
 * All Phase-2 required fields are present. Extensible via `metadata`.
 */
export interface EvidenceProviderDescriptor {
  providerId: string;
  providerName: string;
  version: string;
  authStatus: AuthStatus;
  connectionStatus: ConnectionStatus;
  /** Free-form capability tags, e.g. 'backlinks', 'domain_authority', 'referring_domains'. */
  capabilities: string[];
  /** Canonical evidence keys this provider can emit (align with Evidence Registry keys). */
  supportedEvidence: string[];
  rateLimits: RateLimit | null;
  freshness: ProviderFreshness;
  health: ProviderHealth;
  /** Current failure state, when the provider is failing (see providerFailure.ts). null = ok. */
  failureState: string | null;
  evidenceQuality: EvidenceQuality;
  /** Source reliability 0..1 — feeds the Confidence Engine's `providerReliability` factor. */
  providerReliability: number;

  // ── inventory / adoption metadata (Phase 1/6) ──
  /** Engines that will consume this provider's evidence. */
  consumerEngines: string[];
  /** The evidence these engines currently lack and this provider will supply. */
  requiredEvidence: string[];
  /** How the platform copes today without this provider. */
  currentWorkaround: string;
  /** Trust-impact priority for wiring this provider (from BETA-AUDIT-004). */
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Env vars that activate the real provider when set (documentation only this phase). */
  envKeys: string[];
  /** Open extension point. */
  metadata?: Record<string, unknown>;
}

/**
 * The runtime provider interface a real integration will implement in a LATER phase. Defined here so
 * engines can depend on the shape today; no implementation ships in this phase.
 */
export interface EvidenceProvider {
  readonly descriptor: EvidenceProviderDescriptor;
  /** True only when authenticated AND connected AND healthy. Deterministic given descriptor. */
  isAvailable(): boolean;
}

/** Deterministic availability derivation from a descriptor (no I/O). */
export function isDescriptorAvailable(d: EvidenceProviderDescriptor): boolean {
  return (
    (d.authStatus === 'authenticated' || d.authStatus === 'not_required') &&
    d.connectionStatus === 'connected' &&
    (d.health === 'healthy' || d.health === 'degraded') &&
    d.failureState == null
  );
}
