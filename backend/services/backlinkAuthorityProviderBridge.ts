/**
 * Canonical Backlink Authority Provider Bridge  (BETA-PROVIDER-001) — REFERENCE IMPLEMENTATION
 *
 * Wires the FIRST real external evidence provider into the canonical BETA-ENGINE-004 framework by
 * REUSING the existing production-grade Ahrefs adapter (`intelligence/adapters/ahrefsAdapter.ts` via
 * `getAuthorityInflowProvider()`) — no provider code is duplicated. It:
 *   • registers the canonical `backlink.authority` provider with live auth/connection from env,
 *   • converts the reused provider's response into canonical Evidence via `backlinkEvidenceAdapter`,
 *   • maps every provider failure to canonical Evidence (no fabrication, no silent failure),
 *   • exposes a deterministic availability signal engines use to set evidence maturity.
 *
 * Backward compatible: with no provider credentials the provider is UNAVAILABLE, so engines keep their
 * current INFERRED behaviour; confidence rises to MEASURED only when a real key is configured.
 */
import {
  registerProvider, getProvider, isProviderAvailable, ANTICIPATED_PROVIDERS,
  PROVIDER_FAILURE, unavailableFailure, type EvidenceProviderDescriptor, type Evidence,
} from './evidencePlatform';
import { backlinkEvidenceAdapter, type BacklinkEvidenceInput } from './evidencePlatform/providers/backlink/backlinkEvidenceAdapter';
import {
  getAuthorityInflowProvider,
  describeProviderReadiness,
  type ProviderSlotReadiness,
} from './intelligence/providerRegistry';

const PROVIDER_ID = 'backlink.authority';
/** The registry slot that owns the only implemented backlink provider. */
const AUTHORITY_SLOT = 'authority_inflow';

/**
 * ── PROVIDER READINESS IS THE REGISTRY'S ANSWER, NOT AN ENV-VAR GUESS ────────
 *
 * THE DEFECT. This bridge kept its own list — `ENV_KEYS = ['AHREFS_API_KEY',
 * 'MOZ_API_KEY', 'MAJESTIC_API_KEY']` — and called the provider configured when ANY of
 * them was set. Moz and Majestic have no adapter in this repo: `providerRegistry`'s
 * bootstrap note records that their conditional registrations were REMOVED because the
 * files are absent, and `PROVIDER_SLOTS.authority_inflow` therefore names
 * `AHREFS_API_KEY` alone and says so. So `MOZ_API_KEY=anything`, by itself, was enough
 * for this bridge to publish `authStatus: 'authenticated'`, `connectionStatus:
 * 'connected'` and `health: 'healthy'` for a provider that cannot answer at all — a
 * false readiness signal, and a third independent copy of a fact the registry owns.
 *
 * THE CONTRACT. Readiness is READ from `describeProviderReadiness()`, the registry's
 * single declaration, so a key that enables nothing can never make this slot configured.
 * The distinctions that vocabulary already draws are inherited rather than restated, and
 * no new status is invented:
 *
 *   CONFIGURED           an implemented adapter's prerequisite is present and it loaded
 *   CREDENTIAL_REQUIRED  no value for the prerequisite this slot actually consults
 *   ADAPTER_LOAD_FAILED  the prerequisite IS present and the module failed to load —
 *                        never reported as a missing credential, and never as configured
 *   DISABLED / NOT_IMPLEMENTED  a decision, or a capability with no adapter
 *
 * Only `CONFIGURED` counts as configured. This is a statement about PROVIDER CAPABILITY
 * and never about the company: an unsupported, unconfigured or broken provider yields
 * `UNAVAILABLE` evidence with a NULL value — never a zero, and never a company finding.
 *
 * Note: reading the registry means this function participates in the registry's
 * (idempotent, local, network-free) adapter bootstrap, where before it only read
 * `process.env`. That is the point — capability cannot be established without consulting
 * the thing that owns it.
 */
function authorityReadiness(): ProviderSlotReadiness | null {
  return describeProviderReadiness().find((slot) => slot.slot === AUTHORITY_SLOT) ?? null;
}

/**
 * True only when the registry reports the implemented backlink slot as CONFIGURED.
 * Fails closed: an unknown slot is not configured.
 */
export function isBacklinkProviderConfigured(): boolean {
  return authorityReadiness()?.availability === 'CONFIGURED';
}

/** Register the canonical backlink provider with auth/connection derived from env (idempotent). */
export function registerBacklinkProvider(): EvidenceProviderDescriptor {
  const base = ANTICIPATED_PROVIDERS.find((p) => p.providerId === PROVIDER_ID);
  if (!base) throw new Error('backlink.authority descriptor missing from anticipated providers');
  const configured = isBacklinkProviderConfigured();
  return registerProvider({
    ...base,
    authStatus: configured ? 'authenticated' : 'unauthenticated',
    connectionStatus: configured ? 'connected' : 'disconnected',
    health: configured ? 'healthy' : 'unknown',
    failureState: configured ? null : PROVIDER_FAILURE.UNAVAILABLE,
  });
}

/** Deterministic availability engines consult to choose MEASURED vs INFERRED maturity. */
export function isBacklinkProviderAvailable(): boolean {
  registerBacklinkProvider();
  return isProviderAvailable(PROVIDER_ID);
}

export function backlinkProviderReliability(): number | null {
  return getProvider(PROVIDER_ID)?.providerReliability ?? null;
}

/**
 * Reference fetch → canonical Evidence. Reuses the existing Ahrefs adapter for the actual lookup
 * (real HTTP + rate-limit + cache + retry live there) and converts its response through the canonical
 * adapter. Every failure (no key, unauthorized, rate limit, HTTP error, no profile) becomes canonical
 * Evidence — never throws, never fabricates. `nowIso` is passed in (deterministic; no clock access).
 */
export async function fetchBacklinkEvidence(domain: string, nowIso: string): Promise<Evidence[]> {
  registerBacklinkProvider();
  if (!isBacklinkProviderConfigured()) {
    // The operator text comes from the registry's slot declaration, so it names only
    // prerequisites that can actually enable this provider. The old literal told
    // operators to set MOZ_API_KEY / MAJESTIC_API_KEY, which enable nothing.
    return backlinkEvidenceAdapter.onFailure(unavailableFailure(
      PROVIDER_ID, 'domain_authority',
      authorityReadiness()?.detail
        ?? 'No backlink/authority provider is configured, so inbound authority could not be established. This is a missing provider prerequisite, not a finding about the company.',
    ));
  }
  const provider = getAuthorityInflowProvider(); // reuse existing real Ahrefs adapter
  const result = await provider.lookup({ domain });
  if (result.state !== 'measured' || !result.profile) {
    return backlinkEvidenceAdapter.onFailure({
      providerId: PROVIDER_ID,
      state: PROVIDER_FAILURE.UNAVAILABLE,
      reason: result.reason_unavailable ?? 'Backlink provider returned no measured profile.',
      evidenceKey: 'domain_authority',
      observedAt: nowIso,
    });
  }
  const p = result.profile;
  const input: BacklinkEvidenceInput = {
    domain,
    referringDomains: p.referring_domains ?? null,
    totalBacklinks: p.total_backlinks ?? null,
    domainAuthority: p.domain_authority,
    spamScore: p.spam_score,
    // The reused Ahrefs endpoint does not return these — honest null, adapter omits them (no fabrication).
    dofollowCount: null, nofollowCount: null, uniqueAnchors: null, uniqueDomains: null,
    newLinks30d: null, lostLinks30d: null,
    observedAt: p.freshness.last_observed_at ?? nowIso,
    providerReliability: backlinkProviderReliability(),
  };
  return backlinkEvidenceAdapter.toEvidence(input, { observedAt: input.observedAt, subjectId: domain });
}
