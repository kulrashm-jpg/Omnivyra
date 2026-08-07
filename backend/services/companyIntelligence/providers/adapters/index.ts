/**
 * WS-4 Phase-2 — the six vendor adapters.
 *
 * Each supplies only what is vendor-specific: host, request shape, response
 * mapping, and the confidence it is honest about. Everything else — the
 * no-credential short circuit, SSRF-pinned egress, status-code classification,
 * never-throw and never-fabricate — comes from `createVendorAdapter`.
 *
 * CONFIDENCE IS NOT A PREFERENCE. The constants below reflect what each vendor
 * is actually good at, not how much we like them. Clearbit's firmographics are
 * a stronger claim than Apollo's; BuiltWith's detected stack is a strong claim
 * because it is observed rather than asserted; Apollo's headcount is
 * self-reported and rated accordingly. Where a vendor returns its own
 * confidence, that value is used and these constants are not consulted.
 *
 * PRECEDENCE is the tie-break AFTER confidence, and encodes a standing
 * judgement per capability domain — identity/firmographics first from the
 * vendors that specialise in them.
 *
 * NONE OF THESE IS CONFIGURED IN ANY ENVIRONMENT TODAY. They register, report
 * `no_credential`, and cost nothing until a key exists. That is the intended
 * state, not an incomplete one.
 */

import { createVendorAdapter, field, fields, joinList, pick } from './vendorAdapter';
import type { CompanyEnrichmentProvider } from '../contract';

/** Clearbit — firmographics and identity. Strong, well-normalised company records. */
export const clearbitProvider: CompanyEnrichmentProvider = createVendorAdapter({
  id: 'clearbit',
  credentialEnv: 'CLEARBIT_API_KEY',
  host: 'company.clearbit.com',
  capabilities: ['firmographics', 'identity', 'technology'],
  precedence: 10,
  buildRequest: (req, _capability, credential) => {
    if (!req.domain) return null;
    return {
      url: `https://company.clearbit.com/v2/companies/find?domain=${encodeURIComponent(req.domain)}`,
      init: { method: 'GET', headers: { Authorization: `Bearer ${credential}` } },
    };
  },
  mapResponse: (payload, req, capability) => {
    const at = String(pick(payload, 'foundedDate') ?? req.asOf);
    if (capability === 'technology') {
      return fields(field('technologies', joinList(pick(payload, 'tech')), 0.75, req.asOf));
    }
    if (capability === 'identity') {
      return fields(
        field('legalName', pick(payload, 'legalName'), 0.9, req.asOf),
        field('domain', pick(payload, 'domain'), 0.95, req.asOf),
        field('linkedinHandle', pick(payload, 'linkedin', 'handle'), 0.85, req.asOf),
      );
    }
    return fields(
      field('headcount', pick(payload, 'metrics', 'employees'), 0.85, req.asOf),
      field('size', pick(payload, 'metrics', 'employeesRange'), 0.8, req.asOf),
      field('revenueBand', pick(payload, 'metrics', 'estimatedAnnualRevenue'), 0.7, req.asOf),
      field('foundedYear', pick(payload, 'foundedYear'), 0.9, at),
      field('industry', pick(payload, 'category', 'industry'), 0.8, req.asOf),
      field('hq', joinList([pick(payload, 'geo', 'city'), pick(payload, 'geo', 'country')]), 0.85, req.asOf),
      field('country', pick(payload, 'geo', 'country'), 0.9, req.asOf),
    );
  },
});

/** Apollo — broad coverage, self-reported headcount, good hiring signal. */
export const apolloProvider: CompanyEnrichmentProvider = createVendorAdapter({
  id: 'apollo',
  credentialEnv: 'APOLLO_API_KEY',
  host: 'api.apollo.io',
  capabilities: ['firmographics', 'hiring', 'identity'],
  precedence: 20,
  buildRequest: (req, _capability, credential) => {
    if (!req.domain) return null;
    return {
      url: `https://api.apollo.io/v1/organizations/enrich?domain=${encodeURIComponent(req.domain)}`,
      init: { method: 'GET', headers: { 'X-Api-Key': credential, Accept: 'application/json' } },
    };
  },
  mapResponse: (payload, req, capability) => {
    const org = pick(payload, 'organization') ?? payload;
    if (capability === 'hiring') {
      return fields(
        field('openRoles', pick(org, 'job_postings_count'), 0.7, req.asOf),
        field('hiringDepartments', joinList(pick(org, 'departmental_head_count')), 0.6, req.asOf),
      );
    }
    if (capability === 'identity') {
      return fields(
        field('legalName', pick(org, 'name'), 0.8, req.asOf),
        field('linkedinHandle', pick(org, 'linkedin_uid'), 0.75, req.asOf),
      );
    }
    return fields(
      // Self-reported: a materially weaker claim than an observed count.
      field('headcount', pick(org, 'estimated_num_employees'), 0.65, req.asOf),
      field('industry', pick(org, 'industry'), 0.7, req.asOf),
      field('foundedYear', pick(org, 'founded_year'), 0.8, req.asOf),
      field('hq', joinList([pick(org, 'city'), pick(org, 'country')]), 0.7, req.asOf),
      field('country', pick(org, 'country'), 0.8, req.asOf),
    );
  },
});

/** PeopleDataLabs — strong headcount and size bands. */
export const peopleDataLabsProvider: CompanyEnrichmentProvider = createVendorAdapter({
  id: 'peopledatalabs',
  credentialEnv: 'PEOPLEDATALABS_API_KEY',
  host: 'api.peopledatalabs.com',
  capabilities: ['firmographics', 'identity'],
  precedence: 15,
  buildRequest: (req, _capability, credential) => {
    if (!req.domain) return null;
    return {
      url: `https://api.peopledatalabs.com/v5/company/enrich?website=${encodeURIComponent(req.domain)}`,
      init: { method: 'GET', headers: { 'X-Api-Key': credential, Accept: 'application/json' } },
    };
  },
  mapResponse: (payload, req, capability) => {
    if (capability === 'identity') {
      return fields(
        field('legalName', pick(payload, 'display_name'), 0.85, req.asOf),
        field('linkedinHandle', pick(payload, 'linkedin_id'), 0.8, req.asOf),
      );
    }
    return fields(
      field('headcount', pick(payload, 'employee_count'), 0.8, req.asOf),
      field('size', pick(payload, 'size'), 0.85, req.asOf),
      field('industry', pick(payload, 'industry'), 0.75, req.asOf),
      field('foundedYear', pick(payload, 'founded'), 0.85, req.asOf),
      field('hq', joinList([pick(payload, 'location', 'locality'), pick(payload, 'location', 'country')]), 0.8, req.asOf),
      field('country', pick(payload, 'location', 'country'), 0.85, req.asOf),
    );
  },
});

/** Crunchbase — the authority on funding. Weak on headcount, so it does not claim it. */
export const crunchbaseProvider: CompanyEnrichmentProvider = createVendorAdapter({
  id: 'crunchbase',
  credentialEnv: 'CRUNCHBASE_API_KEY',
  host: 'api.crunchbase.com',
  capabilities: ['funding', 'identity'],
  precedence: 10,
  buildRequest: (req, _capability, credential) => {
    if (!req.domain) return null;
    return {
      url: `https://api.crunchbase.com/api/v4/entities/organizations/${encodeURIComponent(req.domain)}?card_ids=raised_funding_rounds`,
      init: { method: 'GET', headers: { 'X-cb-user-key': credential, Accept: 'application/json' } },
    };
  },
  mapResponse: (payload, req, capability) => {
    const props = pick(payload, 'properties') ?? payload;
    if (capability === 'identity') {
      return fields(field('legalName', pick(props, 'legal_name'), 0.85, req.asOf));
    }
    return fields(
      field('fundingStage', pick(props, 'last_funding_type'), 0.9, req.asOf),
      field('totalRaised', pick(props, 'funding_total', 'value_usd'), 0.9, req.asOf),
      field('lastFundingAt', pick(props, 'last_funding_at'), 0.9, req.asOf),
      field('investorCount', pick(props, 'num_investors'), 0.8, req.asOf),
    );
  },
});

/** Hunter — email-pattern discovery, used here only for identity corroboration. */
export const hunterProvider: CompanyEnrichmentProvider = createVendorAdapter({
  id: 'hunter',
  credentialEnv: 'HUNTER_API_KEY',
  host: 'api.hunter.io',
  capabilities: ['identity'],
  precedence: 40,
  buildRequest: (req, _capability, credential) => {
    if (!req.domain) return null;
    return {
      url: `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(req.domain)}&api_key=${encodeURIComponent(credential)}`,
      init: { method: 'GET', headers: { Accept: 'application/json' } },
    };
  },
  mapResponse: (payload, req) => {
    const data = pick(payload, 'data') ?? payload;
    return fields(
      field('emailPattern', pick(data, 'pattern'), 0.7, req.asOf),
      field('legalName', pick(data, 'organization'), 0.6, req.asOf),
    );
  },
});

/** BuiltWith — OBSERVED technology, which is why its confidence is the highest here. */
export const builtWithProvider: CompanyEnrichmentProvider = createVendorAdapter({
  id: 'builtwith',
  credentialEnv: 'BUILTWITH_API_KEY',
  host: 'api.builtwith.com',
  capabilities: ['technology'],
  precedence: 10,
  buildRequest: (req, _capability, credential) => {
    if (!req.domain) return null;
    return {
      url: `https://api.builtwith.com/v21/api.json?KEY=${encodeURIComponent(credential)}&LOOKUP=${encodeURIComponent(req.domain)}`,
      init: { method: 'GET', headers: { Accept: 'application/json' } },
    };
  },
  mapResponse: (payload, req) => {
    const groups = pick(payload, 'Results', '0', 'Result', 'Paths') as unknown;
    const technologies = Array.isArray(groups)
      ? groups.flatMap((p) => {
          const techs = pick(p, 'Technologies');
          return Array.isArray(techs) ? techs.map((t) => pick(t, 'Name')) : [];
        })
      : [];
    // Observed from the live site rather than asserted by the company.
    return fields(field('technologies', joinList(technologies), 0.9, req.asOf));
  },
});

/** All six, in registration order. */
export const VENDOR_PROVIDERS: readonly CompanyEnrichmentProvider[] = [
  clearbitProvider,
  peopleDataLabsProvider,
  apolloProvider,
  crunchbaseProvider,
  builtWithProvider,
  hunterProvider,
] as const;
