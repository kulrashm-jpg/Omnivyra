/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 8 (FINAL) — Competitor Intelligence adoption seam.
 *
 * Competitor Intelligence CONSUMES the OWNER company's identity to shape competitor search. This seam
 * routes that acquisition through `resolveCompanyProjection`, overlaying the projection-owned worldView
 * identity — `category`, `business_model`, `operating_model`, `domain_role` — onto the profile the
 * competitor engine reads. It NEVER repairs/reinterprets/overrides/reclassifies company identity, and it
 * NEVER touches competitor evidence: the owner's declared competitor list (`named_competitors`,
 * `competitor_details`, …) and every other `market_pulse` field are preserved untouched. Pure &
 * deterministic. Flag OFF (default) ⇒ same profile reference, byte-identical (O(1) rollback).
 *
 * COMPETITIVE INTEGRITY: company identity determines how competitors are searched; competitor results never
 * flow back into identity. This seam only READS the projected identity → overlays owner-identity fields.
 * Scope: `provider_type`/`solution_domains` (not projection-owned) and `business_classification` (legacy
 * classifier output → U5) are left as stored. `industry` is not projection-owned (deferred).
 */

import { resolveCompanyProjection } from '../consumerAdapter';
import type { EvidenceSources } from '../../evidence';

interface CompetitorProfileLike {
  name?: string | null;
  website_url?: string | null;
  category?: string | null;
  report_settings?: { market_pulse?: { business_model?: string | null; operating_model?: string | null; domain_role?: string | null } | null } | null;
}

/**
 * Overlay the projected owner-company identity onto the profile the competitor engine reads. Flag OFF ⇒
 * same reference (no-op); flag ON ⇒ projected `category`/`business_model`/`operating_model`/`domain_role`
 * (evidence-derived when supplied, else profile-derived echo). Competitor evidence is preserved verbatim.
 */
export function adoptCompetitorCompanyIdentity<T>(profile: T, companyId: string, asOf: string, evidence?: EvidenceSources): T {
  if (profile == null) return profile;
  const p = profile as unknown as CompetitorProfileLike;
  const mp = p.report_settings?.market_pulse ?? null;
  const input = {
    companyId,
    asOf,
    name: p.name ?? undefined,
    domain: p.website_url ?? undefined,
    category: p.category ?? undefined,
    businessModel: mp?.business_model ?? undefined,
    primaryMotion: mp?.operating_model ?? undefined,   // canonical worldView.primaryMotion
    marketPosition: mp?.domain_role ?? undefined,       // canonical worldView.marketPosition
  };
  const { source, worldView } = resolveCompanyProjection(input, evidence ? { evidence } : {});
  if (source === 'legacy' || !worldView) return profile; // flag OFF / fail-safe ⇒ untouched, same reference
  return {
    ...(profile as Record<string, unknown>),
    category: worldView.category ?? p.category ?? null,
    report_settings: {
      ...(p.report_settings ?? {}),
      market_pulse: {
        ...(mp ?? {}), // competitor evidence (named_competitors/competitor_details/…) preserved verbatim
        business_model: worldView.businessModel ?? mp?.business_model ?? null,
        operating_model: worldView.operatingModel ?? mp?.operating_model ?? null,
        domain_role: worldView.domainRole ?? mp?.domain_role ?? null,
      },
    },
  } as unknown as T;
}
