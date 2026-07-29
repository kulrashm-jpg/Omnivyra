/**
 * CI-B202/B207 — Legacy → canonical ADOPTION bridge (pure, deterministic). Projects an
 * already-derived company profile (the legacy `companyProfileService` output) into canonical
 * evidence + facets on the shared spine — "project from the profile, never fabricate" (adopted from
 * the ontology `buildCompanyUnderstanding`). Absent fields abstain. This is a compatibility layer:
 * the legacy profile becomes an evidence SOURCE, not a second owner.
 */

import type { CompanyFacets, CompanyWorldView, EvidenceRef } from './types';
import { facet, evidenceRef } from '../intelligence/canonical';

export interface CompanyProfileInput {
  companyId: string;
  asOf: string;
  source?: string;
  name?: string; domain?: string; legalName?: string; foundedYear?: string;
  industry?: string; category?: string; businessModel?: string; primaryMotion?: string; marketPosition?: string;
  size?: string; headcount?: string;
  products?: string[]; services?: string[];
  technologies?: string[]; competitors?: string[]; customers?: string[]; partners?: string[]; executives?: string[];
  fundingStage?: string; revenueBand?: string; hq?: string; markets?: string[];
}

const has = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v != null && v !== '');

export interface AdoptedProfile { facets: Partial<CompanyFacets>; evidence: EvidenceRef[]; worldView: CompanyWorldView; }

export function companyFromProfile(p: CompanyProfileInput): AdoptedProfile {
  const src = p.source ?? 'company_profile';
  const evidence: EvidenceRef[] = [];
  const ev = (label: string, value: string | number | boolean, kind: 'structured' | 'inferred' | 'external' = 'structured'): EvidenceRef => {
    const e = evidenceRef({ id: `company_profile:${label}:${src}`, kind, label, value, source: { system: src }, observedAt: p.asOf, recordedAt: p.asOf });
    evidence.push(e); return e;
  };
  const facets: Partial<CompanyFacets> = {};
  const one = <T>(cond: boolean, name: keyof CompanyFacets, value: T, evs: EvidenceRef[]) => { if (cond) (facets as any)[name] = facet(value, evs); };

  const idEv: EvidenceRef[] = [];
  if (has(p.name)) idEv.push(ev('name', p.name as string));
  if (has(p.domain)) idEv.push(ev('domain', p.domain as string));
  if (has(p.foundedYear)) idEv.push(ev('founded_year', p.foundedYear as string));
  one(idEv.length > 0, 'identity', { name: p.name, domain: p.domain, legalName: p.legalName, foundedYear: p.foundedYear }, idEv);

  one(has(p.headcount) || has(p.size), 'organization', { size: p.size, headcount: p.headcount },
    [has(p.headcount) ? ev('headcount', p.headcount as string) : ev('size', p.size ?? '')].filter(Boolean));
  one(has(p.products) || has(p.services), 'offerings', { products: p.products, services: p.services },
    [...(has(p.products) ? [ev('products', (p.products as string[]).join('; '))] : []), ...(has(p.services) ? [ev('services', (p.services as string[]).join('; '))] : [])]);
  one(has(p.technologies), 'technology', { stack: p.technologies }, [ev('technologies', (p.technologies ?? []).join('; '))]);
  one(has(p.competitors), 'competitive', { competitors: p.competitors }, [ev('competitors', (p.competitors ?? []).join('; '))]);
  one(has(p.customers), 'customers', { namedCustomers: p.customers }, [ev('customers', (p.customers ?? []).join('; '))]);
  one(has(p.partners), 'partners', { partners: p.partners }, [ev('partners', (p.partners ?? []).join('; '))]);
  one(has(p.executives), 'leadership', { executives: p.executives }, [ev('executives', (p.executives ?? []).join('; '))]);
  one(has(p.fundingStage), 'funding', { stage: p.fundingStage }, [ev('funding_stage', p.fundingStage as string)]);
  one(has(p.revenueBand), 'financial', { revenueBand: p.revenueBand }, [ev('revenue_band', p.revenueBand as string)]);
  one(has(p.hq) || has(p.markets), 'geography', { hq: p.hq, markets: p.markets },
    [...(has(p.hq) ? [ev('hq', p.hq as string)] : []), ...(has(p.markets) ? [ev('markets', (p.markets as string[]).join('; '))] : [])]);
  one(has(p.marketPosition) || has(p.category), 'marketPosition', { segment: p.category, positioning: p.marketPosition },
    [...(has(p.marketPosition) ? [ev('market_position', p.marketPosition as string, 'inferred')] : []), ...(has(p.category) ? [ev('category', p.category as string)] : [])]);

  const worldView: CompanyWorldView = { category: p.category, businessModel: p.businessModel, primaryMotion: p.primaryMotion, marketPosition: p.marketPosition };
  return { facets, evidence, worldView };
}
