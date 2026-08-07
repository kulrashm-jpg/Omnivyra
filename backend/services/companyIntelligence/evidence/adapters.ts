/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U1 — Evidence adapters (pure, deterministic).
 *
 * Each adapter maps an ALREADY-FETCHED, source-shaped raw input into `EvidenceRef[]` — never a business
 * object, never a facet, never a derived classification. Adapters do NOT fetch (fetching/grounding is the
 * caller's concern via the approved evidence services + safeFetch); they only normalize raw facts/AI output
 * into traceable evidence with source · kind · weight · observed/recorded timestamps · lifecycle.
 *
 * KEY RULE: the company-profile adapter ingests FACTS the user provided (name/domain/products/services/
 * industry/competitors) — it does NOT ingest the legacy DERIVED classification (category/provider_type/
 * operating_model/domain_role/solution_domains). Those interpretive fields are populated from AI-extraction
 * evidence, so the understanding is built from evidence, not from the pre-classified profile.
 */

import { mkEvidence } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

const join = (xs?: string[]): string => (xs ?? []).filter((x) => x != null && x !== '').join('; ');
const has = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v != null && v !== '');

// ── Source-shaped raw inputs (already fetched; adapters only normalize) ──────────────────────────
export interface WebsiteCrawlInput { companyId: string; observedAt: string; name?: string; domain?: string; offerings?: string[]; positioning?: string; }
export interface AiExtractionInput { companyId: string; observedAt: string; category?: string; industry?: string; businessModel?: string; providerType?: string; solutionDomains?: string[]; operatingModel?: string; domainRole?: string; products?: string[]; segments?: string[]; differentiators?: string[]; }
/** FACTS only — never the derived classification. */
export interface CompanyProfileFactsInput { companyId: string; observedAt: string; name?: string; domain?: string; products?: string[]; services?: string[]; industry?: string; competitors?: string[]; }
/**
 * One external system's firmographic claim. WS-4 Phase-2 adds the fields below the original six;
 * every addition is OPTIONAL, so existing producers and tests are unaffected.
 */
export interface FirmographicInput {
  companyId: string; observedAt: string; system: string; sourceRef?: string;
  foundedYear?: string; headcount?: string; size?: string; revenueBand?: string; fundingStage?: string; hq?: string;
  // WS-4 Phase-2 — the capabilities that previously had nowhere to land.
  country?: string; industry?: string;
  technologies?: string;
  totalRaised?: string; lastFundingAt?: string;
  openRoles?: string; hiringDepartments?: string;
  legalName?: string; linkedinHandle?: string;
}

export interface EvidenceSources { website?: WebsiteCrawlInput; ai?: AiExtractionInput; profile?: CompanyProfileFactsInput; firmographics?: FirmographicInput[]; }

type Kind = 'structured' | 'observed' | 'inferred' | 'external' | 'ai_generated';
const push = (out: EvidenceRef[], system: string, kind: Kind, weight: number, observedAt: string, label: string, value: unknown): void => {
  if (!has(value)) return;
  out.push(mkEvidence('company', { label, value: Array.isArray(value) ? join(value as string[]) : (value as string | number | boolean), source: system, observedAt, kind, weight }));
};

/** Official website crawl → observed evidence (high trust, first-party). */
export function websiteEvidence(input?: WebsiteCrawlInput): EvidenceRef[] {
  if (!input) return [];
  const out: EvidenceRef[] = [];
  push(out, 'website_capture', 'observed', 0.9, input.observedAt, 'name', input.name);
  push(out, 'website_capture', 'observed', 0.9, input.observedAt, 'domain', input.domain);
  push(out, 'website_capture', 'observed', 0.85, input.observedAt, 'products', input.offerings);
  push(out, 'website_capture', 'observed', 0.7, input.observedAt, 'positioning', input.positioning);
  return out;
}

/** AI extraction (grounded) → ai_generated evidence (lower trust; the interpretive source). */
export function aiExtractionEvidence(input?: AiExtractionInput): EvidenceRef[] {
  if (!input) return [];
  const out: EvidenceRef[] = [];
  push(out, 'ai_extraction', 'ai_generated', 0.6, input.observedAt, 'category', input.category);
  push(out, 'ai_extraction', 'ai_generated', 0.6, input.observedAt, 'industry', input.industry);
  // U4.6 (Policy B — evidence-derived): grounded business_model / provider_type / solution_domains.
  push(out, 'ai_extraction', 'ai_generated', 0.6, input.observedAt, 'business_model', input.businessModel);
  push(out, 'ai_extraction', 'ai_generated', 0.6, input.observedAt, 'provider_type', input.providerType);
  push(out, 'ai_extraction', 'ai_generated', 0.6, input.observedAt, 'solution_domains', input.solutionDomains);
  push(out, 'ai_extraction', 'ai_generated', 0.6, input.observedAt, 'operating_model', input.operatingModel);
  push(out, 'ai_extraction', 'ai_generated', 0.6, input.observedAt, 'domain_role', input.domainRole);
  push(out, 'ai_extraction', 'ai_generated', 0.5, input.observedAt, 'products', input.products);
  push(out, 'ai_extraction', 'ai_generated', 0.5, input.observedAt, 'segments', input.segments);
  push(out, 'ai_extraction', 'ai_generated', 0.5, input.observedAt, 'differentiators', input.differentiators);
  return out;
}

/** Company profile FACTS (user-provided) → structured evidence — NOT the derived classification. */
export function companyProfileFactsEvidence(input?: CompanyProfileFactsInput): EvidenceRef[] {
  if (!input) return [];
  const out: EvidenceRef[] = [];
  push(out, 'company_profile', 'structured', 0.9, input.observedAt, 'name', input.name);
  push(out, 'company_profile', 'structured', 0.9, input.observedAt, 'domain', input.domain);
  push(out, 'company_profile', 'structured', 0.9, input.observedAt, 'products', input.products);
  push(out, 'company_profile', 'structured', 0.9, input.observedAt, 'services', input.services);
  push(out, 'company_profile', 'structured', 0.7, input.observedAt, 'industry', input.industry);
  push(out, 'company_profile', 'structured', 0.85, input.observedAt, 'competitors', input.competitors);
  return out;
}

/**
 * Firmographics (LinkedIn API / Crunchbase / registries / trusted / Wikidata) → external evidence.
 *
 * WS-4 Phase-2 extends this ADDITIVELY. The original six fields are emitted exactly as before —
 * same labels, same weight, same order — so any consumer comparing evidence lists sees no change
 * unless a provider actually supplied one of the new fields. The extension exists because the
 * enrichment providers answer five capabilities and only firmographics had a home; technology,
 * funding, hiring and identity had nowhere to land, which is why the CI-C3xx engines that read
 * them were starved.
 *
 * `weight` differs by field for an evidenced reason: an OBSERVED technology stack (BuiltWith reads
 * the live site) is a stronger claim than a SELF-REPORTED headcount, and flattening both to 0.7
 * would tell the fusion layer they are equally trustworthy when they are not.
 */
export function firmographicEvidence(inputs?: FirmographicInput[]): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  for (const f of inputs ?? []) {
    // ── original six, unchanged ──────────────────────────────────────────────────────────────
    push(out, f.system, 'external', 0.7, f.observedAt, 'founded_year', f.foundedYear);
    push(out, f.system, 'external', 0.7, f.observedAt, 'headcount', f.headcount);
    push(out, f.system, 'external', 0.7, f.observedAt, 'size', f.size);
    push(out, f.system, 'external', 0.7, f.observedAt, 'revenue_band', f.revenueBand);
    push(out, f.system, 'external', 0.7, f.observedAt, 'funding_stage', f.fundingStage);
    push(out, f.system, 'external', 0.7, f.observedAt, 'hq', f.hq);
    // ── WS-4 Phase-2 additions ───────────────────────────────────────────────────────────────
    push(out, f.system, 'external', 0.75, f.observedAt, 'country', f.country);
    push(out, f.system, 'external', 0.75, f.observedAt, 'industry', f.industry);
    push(out, f.system, 'observed', 0.8, f.observedAt, 'technologies', f.technologies);
    push(out, f.system, 'external', 0.75, f.observedAt, 'total_raised', f.totalRaised);
    push(out, f.system, 'external', 0.75, f.observedAt, 'last_funding_at', f.lastFundingAt);
    push(out, f.system, 'external', 0.65, f.observedAt, 'open_roles', f.openRoles);
    push(out, f.system, 'external', 0.6, f.observedAt, 'hiring_departments', f.hiringDepartments);
    push(out, f.system, 'external', 0.8, f.observedAt, 'legal_name', f.legalName);
    push(out, f.system, 'external', 0.8, f.observedAt, 'linkedin_handle', f.linkedinHandle);
  }
  return out;
}

/** Run every adapter over the sources → one deterministic evidence list. */
export function ingestCompanyEvidence(sources: EvidenceSources): EvidenceRef[] {
  return [
    ...companyProfileFactsEvidence(sources.profile),
    ...websiteEvidence(sources.website),
    ...aiExtractionEvidence(sources.ai),
    ...firmographicEvidence(sources.firmographics),
  ];
}
