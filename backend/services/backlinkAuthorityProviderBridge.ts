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
import { getAuthorityInflowProvider } from './intelligence/providerRegistry';

const PROVIDER_ID = 'backlink.authority';
const ENV_KEYS = ['AHREFS_API_KEY', 'MOZ_API_KEY', 'MAJESTIC_API_KEY'];

/** True when any real backlink provider credential is present. */
export function isBacklinkProviderConfigured(): boolean {
  return ENV_KEYS.some((k) => Boolean(process.env[k]));
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
    return backlinkEvidenceAdapter.onFailure(unavailableFailure(
      PROVIDER_ID, 'domain_authority',
      'No backlink provider configured. Set AHREFS_API_KEY / MOZ_API_KEY / MAJESTIC_API_KEY.',
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
