/**
 * CPG-004 — LIVE evidence-acquisition harness.
 *
 * ⚠️ EVALUATION-ONLY. Lives under backend/evaluation/, imported by nothing in
 * pages/, apiHandlers/, jobs/ or workers/. It performs REAL outbound retrieval
 * and must never be reachable from a production path.
 *
 * WHAT IT DOES
 *   • fetches real company websites through the REAL `safeFetch` seam
 *     (HARDEN-005), host-pinned per company;
 *   • performs REAL Wikidata lookups through the EXISTING
 *     `lookupCompanyFirmographicsFromWikidata` adapter — no reimplementation;
 *   • feeds every claim through the UNMODIFIED CPG-001/002/003 chain:
 *     entity resolution → source authority → freshness → confidence →
 *     conflict detection → resolver;
 *   • records exactly what was retrieved, including failures.
 *
 * WHAT IT MUST NEVER DO
 *   • invent a claim a page did not state;
 *   • infer revenue, headcount, ICP, funding or leadership from prose;
 *   • retry around a block, or fetch a host the policy forbids;
 *   • touch a credential. Every source used here is KEYLESS.
 *
 * Retrieval is genuinely non-deterministic (the live web changes), so this file
 * is a HARNESS, not a test. Deterministic behaviour is covered by the fixture
 * suites; this exists to observe the real world once.
 */

import { safeFetch } from '../../../lib/security/safeFetch';
import { lookupCompanyFirmographicsFromWikidata } from '../../services/intelligence/adapters/wikidataAdapter';
import { createFirstPartySource } from '../../services/companyProfile/grounding/acquisition/firstPartySource';
import { createWikidataSource } from '../../services/companyProfile/grounding/acquisition/wikidataSource';
import { createUserSuppliedSource } from '../../services/companyProfile/grounding/acquisition/userSuppliedSource';
import { createRegistryRecordSource } from '../../services/companyProfile/grounding/acquisition/registryRecordSource';
import { orchestrateGrounding } from '../../services/companyProfile/grounding/acquisition/orchestrator';
import { selectSources, assessFieldFreshness } from '../../services/companyProfile/grounding/acquisition/retrievalPolicy';
import { rankSourcesForField, countIndependentFamilies, providerFamily } from '../../services/companyProfile/grounding/acquisition/sourceRegistry';
import { classifySource, hostOf } from '../../services/companyProfile/grounding/sourceAuthority';
import type { EvidenceFetcher } from '../../services/companyProfile/grounding/acquisition/evidenceSource';
import type { EntitySignals, UserClaim } from '../../services/companyProfile/grounding/types';

// The Wikidata adapter's kill switch, read the same way as
// backend/services/companyProfile/grounding/acquisition/wikidataSource.ts on main
// (`WIKIDATA_ENABLED === 'false'` disables it). The shared `isWikidataEnabled()`
// helper this harness was written against never reached main.
const isWikidataEnabled = (): boolean => process.env.WIKIDATA_ENABLED !== 'false';

/** §2 — the live corpus. Real, publicly identifiable companies. */
export interface LiveCompany {
  id: string;
  name: string;
  domain: string;
  rationale: string;
  expectedSources: string[];
  /** A public URL exercised through the user-supplied path. */
  userSuppliedUrl?: string;
  /** Leadership/team page to probe, where one is publicly reachable. */
  leadershipPath?: string;
}

export const LIVE_CORPUS: readonly LiveCompany[] = Object.freeze([
  {
    id: 'infosys', name: 'Infosys', domain: 'infosys.com',
    rationale: 'Indian company, large-cap IT services; strong Wikidata presence and a substantial first-party site.',
    expectedSources: ['first_party_website', 'wikidata'], leadershipPath: '/about/leadership.html',
  },
  {
    id: 'zerodha', name: 'Zerodha', domain: 'zerodha.com',
    rationale: 'Indian startup/scale-up (fintech), private; tests a non-listed Indian entity.',
    expectedSources: ['first_party_website', 'wikidata'], leadershipPath: '/about/team',
  },
  {
    id: 'cloudflare', name: 'Cloudflare', domain: 'cloudflare.com',
    rationale: 'US public company; expected strong Wikidata + first-party evidence.',
    expectedSources: ['first_party_website', 'wikidata'], leadershipPath: '/people/',
  },
  {
    id: 'basecamp', name: 'Basecamp', domain: 'basecamp.com',
    rationale: 'US private company; tests a small private entity with a well-structured public site.',
    expectedSources: ['first_party_website'], leadershipPath: '/about',
  },
  {
    id: 'stripe', name: 'Stripe', domain: 'stripe.com',
    rationale: 'Strong first-party website evidence; large private US company.',
    expectedSources: ['first_party_website', 'wikidata'],
    userSuppliedUrl: 'https://stripe.com/newsroom',
  },
]);

/** The real egress seam, host-pinned. Never bypasses safeFetch. */
export function makeLiveFetcher(): EvidenceFetcher {
  return async (url, opts) => {
    try {
      const res = await safeFetch(url, {
        method: 'GET',
        headers: { 'user-agent': 'OmnivyraGroundingEval/1.0 (+evaluation; contact via site owner)', ...(opts.headers ?? {}) },
      }, {
        allowedHosts: opts.allowedHosts,
        timeoutMs: 20_000,
        // CPG-010: a source may ask for a larger cap for a known-large document.
        maxBytes: Math.min(opts.maxBytes ?? 2 * 1024 * 1024, 16 * 1024 * 1024),
        maxRedirects: 3,
        metricLabel: 'cpg004_live_eval',
      });
      const text = res.ok ? await res.text() : '';
      return { ok: res.ok, status: res.status, url: res.url || url, text };
    } catch {
      // Blocked / timeout / DNS — an outcome, never a reason to fabricate.
      return null;
    }
  };
}

export interface FieldTrace {
  field: string;
  candidatesConsidered: string[];
  candidatesSkipped: { id: string; reason: string }[];
  ranking: string[];
}

export interface CompanyRunResult {
  company: LiveCompany;
  wikidata: {
    attempted: boolean;
    enabled: boolean;
    matchedLabel: string | null;
    foundedYear: string | null;
    teamSize: string | null;
    revenueRange: string | null;
  };
  sourceOutcomes: { sourceId: string; state: string; reason?: string; claimCount: number; documentsFetched: number }[];
  claims: {
    field: string; value: string; sourceUrl: string | null; sourceName: string;
    tier: number; providerFamily: string; accessedAt: string;
  }[];
  fields: {
    field: string; status: string; effectiveValue: string | null; effectiveSource: string;
    confidence: number; band: string; entityMatch: string; freshness: string;
    materialConflict: boolean; evidenceCount: number; conflictCount: number;
  }[];
  confirmationRequests: { field: string; userValue: string | null; publicValue: string | null }[];
  independentFamilies: number;
  fieldTraces: FieldTrace[];
  retrievedAt: string;
}

const FIELDS_OF_INTEREST = [
  'name', 'company_description', 'industry', 'products_services',
  'revenue', 'ceo', 'founded_year', 'employee_count', 'funding', 'brand_positioning',
];

/** §8 — record which sources were considered/skipped/ranked, per field. */
function traceFieldSelection(company: LiveCompany, userSuppliedUrls: string[]): FieldTrace[] {
  return ['revenue', 'products_services', 'ceo', 'founded_year', 'funding'].map((field) => {
    const sel = selectSources([field], {
      companyName: company.name, domain: company.domain, linkedinUrl: null,
      knownPeople: [], industry: null, location: null, userSuppliedUrls,
    });
    return {
      field,
      candidatesConsidered: sel.selected.map((s) => s.id),
      candidatesSkipped: sel.skipped,
      ranking: rankSourcesForField(field, sel.selected.map((s) => s.id)).map((s) => s.id),
    };
  });
}

export async function runLiveCompany(
  company: LiveCompany, userClaims: readonly UserClaim[] = [],
): Promise<CompanyRunResult> {
  const asOf = new Date().toISOString();
  const fetcher = makeLiveFetcher();

  const knownEntity: EntitySignals = {
    companyName: company.name, domain: company.domain, linkedinUrl: null,
    location: null, leadership: [], registryId: null,
  };

  // ── real Wikidata lookup through the EXISTING adapter ────────────────────
  const enabled = isWikidataEnabled();
  let wd = { founded_year: null as string | null, team_size: null as string | null, revenue_range: null as string | null, matched_label: null as string | null };
  if (enabled) {
    try { wd = await lookupCompanyFirmographicsFromWikidata(company.name); } catch { /* recorded as no match */ }
  }

  const paths = ['/', '/about', '/company'];
  if (company.leadershipPath) paths.push(company.leadershipPath);
  const userUrls = company.userSuppliedUrl ? [company.userSuppliedUrl] : [];

  const result = await orchestrateGrounding({
    companyId: `live-${company.id}`,
    knownEntity,
    companyDomain: company.domain,
    userClaims,
    fieldsOfInterest: FIELDS_OF_INTEREST,
    synthesizedFields: ['brand_positioning'],
    sources: [
      createFirstPartySource(paths),
      createWikidataSource(),
      // CPG-010/011: runs only for registry identities the pre-step established (never by name), any provider.
      createRegistryRecordSource(),
      ...(userUrls.length ? [createUserSuppliedSource()] : []),
    ],
    fetcher,
    userSuppliedUrls: userUrls,
    asOf,
  });

  const allClaims = result.fields.flatMap((f) => f.evidence);
  const claims = allClaims.map((e) => {
    // CPG-010: the resolver's own per-claim attribution — this harness kept a
    // THIRD copy of the source-id mapping, which ignored discovery and aliases.
    const a = result.fields.find((f) => f.field === e.field)?.sourceAttribution?.[e.claimId];
    const cls = classifySource(e.sourceUrl, e.sourceType, company.domain);
    const host = hostOf(e.sourceUrl);
    return {
      field: e.field, value: e.value.slice(0, 160), sourceUrl: e.sourceUrl, sourceName: e.sourceName,
      tier: a?.tier ?? cls.tier, providerFamily: a?.family ?? providerFamily('user_supplied_url', host), accessedAt: e.sourceAccessedAt,
    };
  });

  return {
    company,
    wikidata: {
      attempted: enabled, enabled,
      matchedLabel: wd.matched_label, foundedYear: wd.founded_year,
      teamSize: wd.team_size, revenueRange: wd.revenue_range,
    },
    sourceOutcomes: result.sourceOutcomes.map((o) => ({
      sourceId: o.sourceId, state: o.state, reason: o.reason, claimCount: o.claimCount, documentsFetched: o.documentsFetched,
    })),
    claims,
    fields: result.fields
      .filter((f) => f.evidence.length > 0 || f.userClaim || f.status !== 'UNVERIFIED')
      .map((f) => ({
        field: f.field, status: f.status, effectiveValue: f.effectiveValue?.slice(0, 120) ?? null,
        effectiveSource: f.effectiveValueSource, confidence: f.confidence.score, band: f.confidence.band,
        entityMatch: f.entityMatch.status, freshness: f.freshness,
        materialConflict: f.isMaterialConflict, evidenceCount: f.evidence.length, conflictCount: f.conflictingEvidence.length,
      })),
    confirmationRequests: result.confirmationRequests.map((q) => ({
      field: q.field, userValue: q.userValue, publicValue: q.publicValue,
    })),
    independentFamilies: countIndependentFamilies(
      claims.map((c) => ({ sourceId: c.providerFamily, host: hostOf(c.sourceUrl) })),
    ),
    fieldTraces: traceFieldSelection(company, userUrls),
    retrievedAt: asOf,
  };
}

/** §11 — field-sensitive freshness applied to real retrieved evidence. */
export function freshnessProbe(asOf: string) {
  const at = (d: number) => new Date(Date.parse(asOf) - d * 86_400_000).toISOString();
  return {
    leadership_current: assessFieldFreshness('ceo', at(30), asOf, asOf),
    leadership_aging: assessFieldFreshness('ceo', at(200), asOf, asOf),
    founded_year_old: assessFieldFreshness('founded_year', at(3000), asOf, asOf),
    funding_event_old: assessFieldFreshness('funding', at(900), asOf, asOf),
    revenue_historical: assessFieldFreshness('revenue', at(1200), asOf, asOf),
  };
}
