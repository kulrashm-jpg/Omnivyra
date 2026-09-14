/**
 * CPG-011 §9 — SEC EDGAR as ONE implementation of the registry-provider contract.
 *
 *   jurisdiction US → registry SEC EDGAR → scheme CIK → RegistryProvider
 *
 * Every CPG-010 safeguard is kept, now expressed through the contract:
 *   • no name lookup — lookupModes are by_identifier and by_first_party_reference;
 *   • a CIK arrives only from the company's own EDGAR link or its own
 *     exchange-qualified listing statement mapped through the SEC ticker table;
 *   • a listing candidate must agree with the record it led to (checkCandidate);
 *   • the registrant must POINT BACK (verifyDomainAssociation): its record's
 *     website or its latest annual report's "our website" names a company host;
 *   • parent / subsidiary stay distinct — a parent's CIK fails the point-back.
 * The core never imports this file except through registry/builtins.ts.
 */

import type { DomainAlias, DomainAssociation } from '../../types';
import type { IdentifierScheme } from '../schemes';
import type { CandidateIdentifier, FirstPartyReference, ProviderContext, ProviderFailure, RegistryProvider, RegistryRecord } from '../providerContract';
import { qualify } from '../jurisdiction';
import {
  cik10, FILING_MAX_BYTES, findWebsiteStatements, MAX_TICKERS, parseSubmissions, parseTickerTable, registrantHeadquarters,
  SEC_DATA_HOST, SEC_TICKER_TABLE_URL, SEC_WWW_HOST, submissionsUrl, US_STATES, type TickerEntry,
} from '../../acquisition/secEdgar';
import { aliasEligibleHost } from '../../acquisition/domainIdentity';

export const CIK_SCHEME: IdentifierScheme = {
  code: 'CIK', name: 'SEC Central Index Key', jurisdiction: 'US', issuer: 'U.S. Securities and Exchange Commission',
  normalize: (raw) => cik10(raw),
  // A bare number is never self-evidently a CIK.
  documentPattern: (value) => {
    const bare = value.replace(/^0+/, '');
    return new RegExp(`(?:\\bCIK\\W{0,3}0*${bare}(?!\\d)|edgar/data/0*${bare}/)`, 'i');
  },
};

/** U.S. employer identification number — issued by the IRS; stated in SEC records. No provider resolves it. */
export const EIN_SCHEME: IdentifierScheme = {
  code: 'EIN', name: 'U.S. Employer Identification Number', jurisdiction: 'US', issuer: 'U.S. Internal Revenue Service',
  normalize: (raw) => { const d = raw.trim().replace(/-/g, ''); return /^\d{9}$/.test(d) ? d : null; },
  documentPattern: (value) => new RegExp(`\\bEIN\\W{0,3}${value.slice(0, 2)}-?${value.slice(2)}(?!\\d)`, 'i'),
};

const EDGAR_LINK = /href\s*=\s*["'](https?:\/\/(?:www\.)?sec\.gov\/(?:cgi-bin\/browse-edgar\?[^"']*?\bCIK=(\d{1,10})\b[^"']*|edgar\/browse\/\?[^"']*?\bCIK=(\d{1,10})\b[^"']*|Archives\/edgar\/data\/(\d{1,10})\/[^"']*))["']/gi;
/** U.S. exchanges the SEC ticker table covers. */
const LISTING = /\b(NYSE American|NYSE Arca|NYSE|NASDAQ|Nasdaq(?:\s+(?:GS|GM|CM|Global Select Market))?)\s*:\s*([A-Z]{1,5}(?:\.[A-Z])?)\b/g;
const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const hostOf = (w: string) => { try { return new URL(w.startsWith('http') ? w : `https://${w}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const within = (h: string, d: string) => h === d || h.endsWith(`.${d}`);

async function fetchJson(ctx: ProviderContext, url: string, host: string): Promise<unknown | null> {
  const r = await ctx.fetcher(url, { allowedHosts: [host], headers: ctx.userAgent ? { 'user-agent': ctx.userAgent } : undefined }).catch(() => null);
  if (!r || !r.ok) return null;
  try { return JSON.parse(r.text); } catch { return null; }
}

export const secEdgarProvider: RegistryProvider = {
  providerId: 'sec_edgar',
  registryName: 'SEC EDGAR',
  jurisdiction: 'US',
  country: 'US',
  schemes: [CIK_SCHEME],
  capabilities: ['CAN_RESOLVE_IDENTIFIER', 'CAN_VERIFY_LEGAL_NAME', 'CAN_VERIFY_DOMAIN', 'CAN_VERIFY_JURISDICTION', 'CAN_PROVIDE_FILINGS'],
  lookupModes: ['by_identifier', 'by_first_party_reference'],
  availability: 'LIVE',
  availabilityDetail: 'Keyless (SEC fair access: declared User-Agent, < 10 req/s). Live-proven CPG-010.',
  providerFamily: 'sec_edgar',
  listingExchanges: ['NYSE', 'NYSE AMERICAN', 'NYSE ARCA', 'NASDAQ'],
  pageHints: { investorLinks: /\b(sec\s+filings?|10-K|20-F|40-F)\b/i },

  extractReferences(pages) {
    const out: FirstPartyReference[] = [];
    for (const p of pages) {
      let m: RegExpExecArray | null;
      EDGAR_LINK.lastIndex = 0;
      while ((m = EDGAR_LINK.exec(p.html)) !== null) {
        const c = cik10(m[2] ?? m[3] ?? m[4]);
        if (c) out.push({ kind: 'registry_link', value: `CIK:${c}`, scheme: 'CIK', providerId: 'sec_edgar', sourceUrl: p.url, detail: `${p.url} links ${clip(m[1])}` });
      }
      LISTING.lastIndex = 0;
      while ((m = LISTING.exec(p.text)) !== null) {
        const exchange = /^nasdaq/i.test(m[1]) ? 'NASDAQ' : m[1].toUpperCase();
        out.push({ kind: 'listing_statement', value: m[2], scheme: null, providerId: null, exchange, sourceUrl: p.url, detail: `${p.url} states "${m[0]}"` });
      }
    }
    return out;
  },

  async resolveFromFirstPartyReference(refs, ctx) {
    const out: CandidateIdentifier[] = [];
    for (const r of refs.filter((x) => x.kind === 'registry_link' && x.scheme === 'CIK')) {
      out.push({ registryId: r.value, via: 'registry_link', sourceUrl: r.sourceUrl, detail: r.detail });
    }
    const listings = [...new Map(refs.filter((x) => x.kind === 'listing_statement').map((s) => [`${s.exchange}:${s.value}`, s])).values()].slice(0, MAX_TICKERS);
    if (listings.length === 0) return out;
    const json = await fetchJson(ctx, SEC_TICKER_TABLE_URL, SEC_WWW_HOST);
    const table = json ? parseTickerTable(json) : new Map<string, TickerEntry[]>();
    for (const s of listings) {
      const hits = (table.get(s.value) ?? []).filter((e) => !e.exchange || !s.exchange || e.exchange.toUpperCase() === s.exchange);
      const ciks = [...new Set(hits.map((h) => h.cik10))];
      if (ciks.length === 1) {
        out.push({ registryId: `CIK:${ciks[0]}`, via: 'listing_mapping', sourceUrl: SEC_TICKER_TABLE_URL,
          detail: `${s.detail} → SEC ticker table: ${s.exchange}:${s.value} = CIK ${ciks[0]} (${hits[0].name})`, listing: { exchange: s.exchange ?? '', ticker: s.value } });
      }
    }
    return out;
  },

  async resolveFromExplicitIdentifier(registryId, ctx): Promise<RegistryRecord | ProviderFailure> {
    const c = cik10(registryId);
    if (!c) return { failure: 'invalid_identifier', detail: `${registryId} is not a CIK` };
    const url = submissionsUrl(c);
    const json = await fetchJson(ctx, url, SEC_DATA_HOST);
    const reg = json ? parseSubmissions(json, url) : null;
    if (!reg) return { failure: 'retrieval_failed', detail: `SEC registrant record ${url} not retrieved` };
    // CPG-011: incorporation is COUNTRY-QUALIFIED ("US-DE"); a non-US state code
    // (SEC's own codes for foreign registrants) is not guessed into a country.
    const inc = reg.stateOfIncorporation && US_STATES[reg.stateOfIncorporation.toUpperCase()] ? qualify('US', reg.stateOfIncorporation) : null;
    return {
      providerId: 'sec_edgar', scheme: 'CIK', registryId: reg.registryId, legalName: reg.name, formerNames: reg.formerNames,
      jurisdiction: inc, status: null, headquarters: registrantHeadquarters(reg),
      crossReferences: reg.ein ? [{ registryId: `EIN:${reg.ein}`, sourceUrl: url, detail: `SEC registrant record states EIN ${reg.ein}` }] : [],
      relationships: [], sourceUrl: url, retrievedAt: ctx.retrievedAt, providerFamily: 'sec_edgar',
      metadata: { tickers: reg.tickers, exchanges: reg.exchanges, website: reg.website, sicDescription: reg.sicDescription, latestAnnual: reg.latestAnnual,
        stateOfIncorporation: reg.stateOfIncorporation },
    };
  },

  checkCandidate(candidate, record) {
    if (!candidate.listing) return null;
    const tickers = ((record.metadata?.tickers as string[] | undefined) ?? []).map((t) => t.toUpperCase());
    return tickers.includes(candidate.listing.ticker) ? null : `record tickers ${tickers.join(',') || 'none'} do not include the stated ticker ${candidate.listing.ticker}`;
  },

  async verifyDomainAssociation(record, ctx) {
    const owned = ctx.ownedHosts.map((h) => h.toLowerCase().replace(/^www\./, ''));
    const isOwned = (h: string) => owned.some((d) => within(h, d));
    const website = (record.metadata?.website as string | null | undefined) ?? null;
    const recHost = website ? hostOf(website) : null;
    if (recHost && isOwned(recHost)) {
      const association: DomainAssociation = { legalEntity: record.legalName, registryId: record.registryId, domain: recHost,
        associationReason: 'registry_record', associationSource: record.sourceUrl, detail: `SEC registrant record states website ${website}` };
      return { association, additionalDomains: [] };
    }
    const annual = record.metadata?.latestAnnual as { form: string; filingDate: string; url: string } | null | undefined;
    if (!annual) return null;
    const f = await ctx.fetcher(annual.url, { allowedHosts: [SEC_WWW_HOST], maxBytes: FILING_MAX_BYTES, headers: ctx.userAgent ? { 'user-agent': ctx.userAgent } : undefined }).catch(() => null);
    const statements = f && f.ok ? findWebsiteStatements(f.text) : [];
    const ours = statements.find((s) => isOwned(s.host));
    if (!ours) return null;
    const association: DomainAssociation = { legalEntity: record.legalName, registryId: record.registryId, domain: ours.host,
      associationReason: 'official_filing_statement', associationSource: annual.url,
      detail: `${annual.form} filed ${annual.filingDate} states: "${ours.statement}"` };
    const additionalDomains: DomainAlias[] = statements
      .filter((s) => !isOwned(s.host) && aliasEligibleHost(s.host))
      .map((s) => ({ domain: s.host, evidence: 'official_filing_statement' as const, sourceUrl: annual.url,
        detail: `${annual.form} of ${record.legalName} (${record.registryId}) states: "${s.statement}"` }));
    return { association, additionalDomains };
  },
};
