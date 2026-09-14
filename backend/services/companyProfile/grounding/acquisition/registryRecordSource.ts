/**
 * CPG-011 — the registry-record evidence source, for EVERY provider.
 *
 * (Replaces CPG-010's secEdgarSource.ts, which was SEC-only.)
 *
 * For each identity ESTABLISHED as the company's own (role `subject`, read
 * from the registry) whose provider is LIVE, it re-reads the registry's record
 * through the provider contract and emits what a registry record states —
 * identity, not performance:
 *   legal_name     the registered legal name;
 *   registry_id    the normalised identifier ("SIREN:542051180");
 *   headquarters   the registered / principal address, when stated.
 *
 * Never for a `site_publisher` or `related_entity`: Sanofi Winthrop
 * Industrie's registered name is not Sanofi's legal name.
 *
 * Each claim carries the identity the RECORD declares, so entity resolution
 * compares it with the established one scheme by scheme (same id → DECISIVE;
 * a different id in the same scheme → MISMATCH). A registry match makes the
 * DOCUMENT's identity decisive; it says nothing about any other field.
 */

import type { EvidenceClaim, RegistryIdentity } from '../types';
import {
  claimId, normalizeValue, retrieved, unavailable,
  type AcquisitionContext, type AcquisitionResult, type EvidenceSource,
} from './evidenceSource';
import type { ProviderRegistry } from '../registry/providerRegistry';
import type { RegistryProvider, RegistryRecord } from '../registry/providerContract';
import { isFailure } from '../registry/providerContract';
import { defaultProviderRegistry } from '../registry/builtins';

const SOURCE_ID = 'registry_records';

export function createRegistryRecordSource(opts: { registry?: ProviderRegistry; userAgent?: string } = {}): EvidenceSource {
  return {
    id: SOURCE_ID,
    label: 'Corporate registry records (provider registry, keyless)',
    isAvailable: () => true,
    async acquire(ctx: AcquisitionContext): Promise<AcquisitionResult> {
      const registry = opts.registry ?? defaultProviderRegistry();
      const subjects = (ctx.knownEntity.registryIdentities ?? [])
        .filter((r) => (r.role ?? 'subject') === 'subject' && r.registryVerified)
        .map((r) => ({ r, p: registry.provider(r.provider) }))
        .filter((x): x is { r: RegistryIdentity; p: RegistryProvider } => !!x.p && x.p.availability === 'LIVE' && x.p.capabilities.includes('CAN_RESOLVE_IDENTIFIER'))
        .sort((a, b) => (a.r.registryId < b.r.registryId ? -1 : 1));
      if (subjects.length === 0) {
        return unavailable('no_coverage', 'no registry identity is established as the company\'s own with a reachable registry (no first-party reference confirmed; no identifier supplied)');
      }
      const claims: EvidenceClaim[] = [];
      let read = 0;
      for (const { r, p } of subjects) {
        // CPG-012: one provider throwing must not cost the claims of the others.
        const rec = await p.resolveFromExplicitIdentifier(r.registryId, {
          fetcher: ctx.fetcher, retrievedAt: ctx.asOf, canonicalDomain: ctx.companyDomain ?? '', ownedHosts: [], userAgent: opts.userAgent,
        }).catch((e: unknown) => ({ failure: 'provider_error' as const, detail: e instanceof Error ? e.message : String(e) }));
        if (isFailure(rec)) continue;
        read++;
        claims.push(...recordClaims(rec, r, p.registryName, ctx.asOf));
      }
      if (read === 0) return unavailable('retrieval_failed', 'no registry record retrieved');
      return retrieved(claims, read);
    },
  };
}

/** The claims one registry record states. Pure (exported for tests). */
export function recordClaims(rec: RegistryRecord, established: RegistryIdentity, registryName: string, asOf: string): EvidenceClaim[] {
  const declared: RegistryIdentity = {
    ...established,
    scheme: rec.scheme, registryId: rec.registryId, provider: rec.providerId, legalName: rec.legalName, formerNames: rec.formerNames,
    jurisdiction: rec.jurisdiction, status: rec.status ?? null,
  };
  const host = (() => { try { return new URL(rec.sourceUrl).hostname.toLowerCase(); } catch { return null; } })();
  const out: EvidenceClaim[] = [];
  const push = (field: string, value: string | null | undefined, excerpt: string) => {
    const v = (value ?? '').trim();
    if (!v) return;
    out.push({
      claimId: claimId(SOURCE_ID, rec.sourceUrl, field, v),
      field, value: v, normalizedValue: normalizeValue(v),
      sourceType: 'corporate_registry', sourceName: registryName, sourceUrl: rec.sourceUrl,
      // A master record is current state, not a dated publication.
      sourcePublishedAt: null, sourceAccessedAt: asOf,
      excerpt, verificationMethod: 'provider_api',
      entitySignals: {
        companyName: rec.legalName, domain: null, linkedinUrl: null, location: null, leadership: [],
        registryId: rec.registryId, legalEntity: rec.legalName,
        sourceHost: host, publisher: registryName,
        registryIdentities: [declared], identityEvidence: [],
      },
    });
  };
  push('legal_name', rec.legalName, `${registryName} ${rec.registryId}: registered name "${rec.legalName}"`);
  push('registry_id', rec.registryId, `${registryName} record ${rec.registryId}`);
  push('headquarters', rec.headquarters, `${registryName} ${rec.registryId}: registered address ${rec.headquarters ?? ''}`);
  return out;
}
