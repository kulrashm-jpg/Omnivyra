/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U4.5 — Canonical Production Producer.
 *
 * THE missing producer: builds canonical CompanyUnderstanding from EVIDENCE already available at the
 * production write path (user-entered profile FACTS + the AI-extraction output), so company identity
 * originates from evidence rather than from `companyFromProfile` echoing the keyword classifier. Pure &
 * deterministic (timestamps injected). NO new fetch, NO fabrication, NO defaults — unknown remains unknown.
 *
 * EVIDENCE COVERAGE (honest): `category`/`industry` are derived from the AI-extraction evidence; name/domain/
 * products/services/competitors from profile facts. `operating_model`/`domain_role`/`provider_type`/
 * `solution_domains`/`business_model` have NO evidence source at this write path (they exist only as legacy
 * keyword-classifier output) → the canonical build ABSTAINS them (null). Firmographics are not fetched here
 * → abstain. This is compliant with the Evidence Rule (abstain, never fabricate).
 */

import { buildCompanyUnderstandingFromEvidence, type EvidenceSources } from '../evidence';
import { toLegacyFields, toShadowRecord, type LegacyCompanyFields } from '../persistence';
import { projectCompany } from '../projection';
import type { CompanyUnderstanding } from '../types';

/** Already-fetched write-path inputs. `ai` is the extracted evidence (category/industry/…). No fetch here. */
export interface WriteEvidenceInputs {
  companyId: string;
  asOf: string;
  name?: string | null;
  domain?: string | null;
  products?: string[] | null;
  services?: string[] | null;
  industry?: string | null;
  competitors?: string[] | null;
  ai?: { category?: string | null; industry?: string | null; products?: string[] | null; segments?: string | null; differentiators?: string | null; businessModel?: string | null; providerType?: string | null; solutionDomains?: string[] | null };
}

const clean = (v?: string | null): string | undefined => (v == null || String(v).trim() === '' ? undefined : String(v).trim());
const list = (v?: string[] | null): string[] | undefined => (Array.isArray(v) && v.filter(Boolean).length ? v.filter(Boolean) : undefined);

/** Map the write-path inputs → EvidenceSources. FACTS-only profile + AI-extraction evidence; abstains the
 * ungrounded interpretive fields and firmographics (never fabricated). */
export function collectWriteEvidence(input: WriteEvidenceInputs): EvidenceSources {
  const sources: EvidenceSources = {
    profile: {
      companyId: input.companyId, observedAt: input.asOf,
      name: clean(input.name), domain: clean(input.domain),
      products: list(input.products), services: list(input.services),
      // PRODUCTION-IDENTITY-IMPLEMENTATION-001 Phase A.5 — Canonical Independence:
      // `input.industry` traces to the DERIVED legacy `profile.industry` classification and MUST NOT
      // participate. Industry is derived solely from grounded evidence (the `ai` extraction source below /
      // website crawl). Removing it makes the canonical producer mathematically independent of the legacy
      // stored identity (profile.industry / profile.category / entity_archetype / industry_review), none of
      // which now reach EvidenceSources. Quote-or-abstain: with no grounded industry evidence, industry abstains.
      competitors: list(input.competitors),
    },
  };
  if (input.ai) {
    sources.ai = {
      companyId: input.companyId, observedAt: input.asOf,
      category: clean(input.ai.category), industry: clean(input.ai.industry),
      products: list(input.ai.products),
      segments: clean(input.ai.segments) ? [clean(input.ai.segments) as string] : undefined,
      differentiators: clean(input.ai.differentiators) ? [clean(input.ai.differentiators) as string] : undefined,
      // U4.6 Policy B — evidence-derived (grounded at the extraction/mapping layer):
      businessModel: clean(input.ai.businessModel),
      providerType: clean(input.ai.providerType),
      solutionDomains: list(input.ai.solutionDomains),
      // operatingModel / domainRole intentionally UNSET — Policy A, no evidence source → abstain.
    };
  }
  // firmographics intentionally omitted — not available at this write path → abstain.
  return sources;
}

export interface CanonicalIdentityRecord {
  company_id: string;
  version: number;
  built_at: string;
  identity_source: 'evidence';
  producer: string;
  understanding: CompanyUnderstanding;
  projection: unknown;
  parity: number | null;
}
export interface CanonicalIdentityResult { understanding: CompanyUnderstanding; legacy: LegacyCompanyFields; record: CanonicalIdentityRecord }

const PRODUCER = 'canonicalIdentityProducer@1';

/** Produce the canonical evidence-derived identity + a persistable record. Pure. */
export function produceCanonicalIdentity(input: WriteEvidenceInputs): CanonicalIdentityResult {
  const understanding = buildCompanyUnderstandingFromEvidence(collectWriteEvidence(input), input.asOf);
  const projection = projectCompany(understanding, input.asOf);
  const legacy = toLegacyFields(understanding);
  const record: CanonicalIdentityRecord = { ...toShadowRecord(understanding, projection, null), identity_source: 'evidence', producer: PRODUCER };
  return { understanding, legacy, record };
}

// ── Write-path adapter: map a CompanyProfile + AI extraction → WriteEvidenceInputs (no fetch) ──────
type ExtractionField = { value?: unknown; values?: unknown; source?: unknown } | undefined;
const exVal = (f: ExtractionField): string | undefined => {
  const v = f?.value ?? f?.values;
  if (v == null) return undefined;
  if (Array.isArray(v)) { const s = v.map(String).map((x) => x.trim()).filter(Boolean).join('; '); return s || undefined; }
  const s = String(v).trim();
  return s || undefined;
};
// U4.6: the interpretive B-fields must be GROUNDED (quote-or-abstain) — only accept website/user-sourced
// extraction values; inferred/missing ⇒ abstain (never fabricate).
const GROUNDED = new Set(['website', 'user']);
const isGrounded = (f: ExtractionField): boolean => GROUNDED.has(String(f?.source ?? '').toLowerCase());
const exValGrounded = (f: ExtractionField): string | undefined => (isGrounded(f) ? exVal(f) : undefined);
const exListGrounded = (f: ExtractionField): string[] | undefined => {
  if (!isGrounded(f)) return undefined;
  const v = f?.value ?? f?.values;
  if (v == null) return undefined;
  const arr = Array.isArray(v) ? v.map(String) : String(v).split(/[;,]/);
  const out = arr.map((s) => s.trim()).filter(Boolean);
  return out.length ? out : undefined;
};

export interface ProfileFactsLike {
  company_id?: string | null; name?: string | null; website_url?: string | null;
  products_services?: string | null; products_services_list?: string[] | null;
  industry?: string | null; competitors?: string[] | null; competitors_list?: string[] | null;
}

/** Build write-path inputs from the profile facts + the AI extraction output. Facts are the trusted profile
 * fields; the extraction supplies category/industry as AI-generated evidence. No derived classification. */
export function writeInputsFromProfileAndExtraction(profile: ProfileFactsLike, extraction: Record<string, ExtractionField> | null | undefined, asOf: string): WriteEvidenceInputs {
  const factsProducts = list(profile.products_services_list) ?? (clean(profile.products_services) ? [clean(profile.products_services) as string] : undefined);
  return {
    companyId: profile.company_id ?? '',
    asOf,
    name: clean(profile.name),
    domain: clean(profile.website_url),
    products: factsProducts,
    // Phase A.5 — do NOT source the derived legacy `profile.industry` classification into the producer.
    // Industry evidence comes only from the grounded `ai` extraction (`extraction.industry`) below. This
    // keeps WriteEvidenceInputs.industry unpopulated on the write path, so no derived identity can leak in
    // even if `collectWriteEvidence` were changed later. (Interface field kept optional for compatibility.)
    competitors: list(profile.competitors_list) ?? list(profile.competitors),
    ai: extraction
      ? {
          category: exVal(extraction.category),
          industry: exVal(extraction.industry),
          products: exVal(extraction.products_services) ? [exVal(extraction.products_services) as string] : undefined,
          segments: exVal(extraction.target_audience),
          differentiators: exVal(extraction.unique_value_proposition),
          // U4.6 Policy B — grounded interpretive fields (quote-or-abstain):
          businessModel: exValGrounded(extraction.business_model),
          providerType: exValGrounded(extraction.provider_type),
          solutionDomains: exListGrounded(extraction.solution_domains),
        }
      : undefined,
  };
}
