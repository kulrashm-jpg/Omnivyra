/**
 * CPG-010 §11 — the identity pre-step: what is ESTABLISHED about the company
 * before any evidence about it is weighed.
 *
 *   company (canonical domain)
 *     → first-party pages (homepage, its investor pages)
 *     → secondary domains the company itself establishes (CPG-009 aliases)
 *     → the DECISIVE ones fetched at their EXACT host (IR site)
 *     → the company's legal-notice / imprint page (who publishes the site)
 *     → registry identities, through the ONE country-neutral path
 *       (registry/establishment.ts: provider registry → selection → records →
 *       role → explicit cross-references). No provider is named here.
 *
 * The output ENRICHES `knownEntity` (domainAliases, registryIdentities), so
 * every later source and the resolver see the same established identity. It
 * never produces a field value.
 *
 * SAFETY
 *   • every fetch is host-pinned (safeFetch via the injected fetcher);
 *   • only first-party pages (canonical host or a DECISIVE alias host) are read;
 *     an arbitrary outbound link is never followed;
 *   • bounded: ≤ 1 homepage + 2 investor pages + 2 of their filings pages +
 *     2 legal-notice pages + 3 alias roots + 2 filing pages per alias, plus the
 *     providers' own identifier lookups;
 *   • failure-isolated: a failed fetch is recorded and the step continues.
 */

import type { DomainAlias, EntitySignals, RegistryIdentity } from '../types';
import type { EvidenceFetcher } from './evidenceSource';
import { ALIAS_STRENGTH, establishDomainAliases, type FirstPartyPage } from './domainIdentity';
import { decodeEntities } from '../extraction/valueTypes';
import { establishRegistryIdentities, type RegistryEstablishment } from '../registry/establishment';
import type { ProviderRegistry } from '../registry/providerRegistry';
import { defaultProviderRegistry } from '../registry/builtins';

export interface IdentityEstablishmentReport {
  canonicalDomain: string;
  pagesRead: { url: string; status: number | null; role: 'homepage' | 'investor_page' | 'legal_notice' | 'alias_root' | 'alias_filing_page' }[];
  aliases: DomainAlias[];
  /** CPG-011 — the country-neutral registry outcome: provider selection, references, candidates. */
  registry: Omit<RegistryEstablishment, 'identities' | 'additionalDomains'> | null;
  registryIdentities: RegistryIdentity[];
  /** One line per decision, in order — the audit trail. */
  steps: string[];
}

export interface IdentityEstablishmentInput {
  canonicalDomain: string;
  fetcher: EvidenceFetcher;
  retrievedAt: string;
  /** Known company name + legal names (decides subject vs site publisher for an ID the site states). */
  companyNames?: readonly string[];
  /** Known jurisdictions of the company (incorporation, listing, operation). */
  jurisdictions?: readonly string[];
  /** Identifiers already supplied for the company. */
  knownIdentifiers?: readonly string[];
  /** Registry fair-access User-Agent (SEC asks for one), operator-configured. Never a credential. */
  registryUserAgent?: string;
  /** Test seam / extension point: the provider registry to use. */
  registry?: ProviderRegistry;
}

const MAX_INVESTOR_PAGES = 2;
const MAX_ALIAS_ROOTS = 3;
const MAX_ALIAS_PAGES = 2;
const MAX_LEGAL_PAGES = 2;
/** A legal notice / imprint link — how a site states its publisher, in several legal traditions. */
/**
 * CPG-012 — only English interface conventions live here ("legal notice",
 * "imprint", "investors"). National terms ("mentions légales", "Impressum") are
 * declared by the provider that needs them (RegistryProvider.pageHints), so a
 * new jurisdiction brings its own vocabulary and the core carries none.
 */
const LEGAL_TEXT = /\b(legal\s+notice|legal\s+information|imprint)\b|^legal$/i;
const LEGAL_HREF = /\/(legal(-notice)?|imprint)\/?$/i;
/** Generic: regulatory material any jurisdiction publishes. Registry-specific wording comes from providers (pageHints). */
const FILINGS_TEXT = /\b(filings|annual\s+reports?|regulated\s+information|regulatory\s+(?:filings|information))\b/i;

const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const within = (h: string, d: string) => h === d || h.endsWith(`.${d}`);

/** Same-host links whose URL PATH is a legal-notice page (footers often label it only "Legal" or an icon). */
function sameHostHrefs(page: FirstPartyPage, hostDomain: string, path: RegExp, max: number): string[] {
  const out: string[] = [];
  const a = /href\s*=\s*["']([^"'#\s]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = a.exec(page.html)) !== null && out.length < max) {
    let abs: string;
    try { abs = new URL(m[1], page.url).toString(); } catch { continue; }
    const h = hostOf(abs);
    if (!h || !within(h, hostDomain) || !/^https:/.test(abs)) continue;
    if (path.test(new URL(abs).pathname) && !out.includes(abs) && abs !== page.url) out.push(abs);
  }
  return out;
}

/** Same-host links whose visible text names investor material — never another host. */
function sameHostLinks(page: FirstPartyPage, hostDomain: string, text: RegExp, max: number): string[] {
  const out: string[] = [];
  const a = /<a\b[^>]*href\s*=\s*["']([^"'#\s]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = a.exec(page.html)) !== null && out.length < max) {
    let abs: string;
    try { abs = new URL(m[1], page.url).toString(); } catch { continue; }
    const h = hostOf(abs);
    if (!h || !within(h, hostDomain) || !/^https:/.test(abs)) continue;
    const label = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (text.test(label) && !out.includes(abs) && abs !== page.url) out.push(abs);
  }
  return out;
}

export async function establishIdentity(input: IdentityEstablishmentInput): Promise<IdentityEstablishmentReport> {
  const canonical = input.canonicalDomain.toLowerCase().replace(/^www\./, '');
  const report: IdentityEstablishmentReport = {
    canonicalDomain: canonical, pagesRead: [], aliases: [], registry: null, registryIdentities: [], steps: [],
  };
  const read = async (url: string, allowedHosts: string[], role: IdentityEstablishmentReport['pagesRead'][number]['role']) => {
    const r = await input.fetcher(url, { allowedHosts }).catch(() => null);
    report.pagesRead.push({ url, status: r?.status ?? null, role });
    return r && r.ok && r.text ? { url: r.url || url, html: r.text } : null;
  };

  // 1. the company's own homepage (and where it lands)
  const home = await read(`https://${canonical}/`, [canonical, `www.${canonical}`], 'homepage');
  if (!home) {
    // ⚠️ CPG-012 LIVE DEFECT (dbs.com answered nothing): this returned here, discarding the
    // identifier the account owner supplied — GLEIF could still cross-reference it. Without a
    // page there is no statement, alias or domain association; only supplied identifiers count.
    report.steps.push(`homepage https://${canonical}/ not retrieved — no first-party page, alias or statement can be established; supplied identifiers are still resolved`);
    return attachRegistry(report, [], [canonical], input, canonical);
  }
  const landed = hostOf(home.url);
  const redirectedTo = landed && !within(landed, canonical) ? home.url : null;
  const firstParty: FirstPartyPage[] = [home];

  // 2. its investor pages, same host only — and one hop to their filings pages
  const investorPages: FirstPartyPage[] = [];
  for (const u of sameHostLinks(home, canonical, /\binvestor(s|\s+relations)?\b/i, MAX_INVESTOR_PAGES)) {
    const p = await read(u, [hostOf(u)!], 'investor_page');
    if (p && within(hostOf(p.url) ?? '', canonical)) { firstParty.push(p); investorPages.push(p); }
  }
  // Which investor links to follow: the generic hint, plus whatever the registered providers declare.
  const registry = input.registry ?? defaultProviderRegistry();
  const hints = [FILINGS_TEXT, ...registry.providers().map((pr) => pr.pageHints?.investorLinks).filter((h): h is RegExp => !!h)];
  const legalTexts = [LEGAL_TEXT, ...registry.providers().map((pr) => pr.pageHints?.legalNoticeLinks).filter((h): h is RegExp => !!h)];
  const legalPaths = [LEGAL_HREF, ...registry.providers().map((pr) => pr.pageHints?.legalNoticePaths).filter((h): h is RegExp => !!h)];
  const hinted = (page: FirstPartyPage, host: string) => [...new Set(hints.flatMap((h) => sameHostLinks(page, host, h, MAX_ALIAS_PAGES)))];
  const filingLinks = [...new Set(investorPages.flatMap((p) => hinted(p, canonical)))]
    .filter((u) => !firstParty.some((p) => p.url === u)).slice(0, MAX_ALIAS_PAGES);
  for (const u of filingLinks) {
    const p = await read(u, [hostOf(u)!], 'investor_page');
    if (p && within(hostOf(p.url) ?? '', canonical)) firstParty.push(p);
  }

  // 2b. CPG-011 — the legal notice / imprint: the site's own statement of who publishes it
  const legalLinks = [...new Set([home, ...investorPages].flatMap((p) => [
    ...legalTexts.flatMap((t) => sameHostLinks(p, canonical, t, MAX_LEGAL_PAGES)),
    ...legalPaths.flatMap((h) => sameHostHrefs(p, canonical, h, MAX_LEGAL_PAGES)),
  ]))].filter((u) => !firstParty.some((p) => p.url === u)).slice(0, MAX_LEGAL_PAGES);
  for (const u of legalLinks) {
    const p = await read(u, [hostOf(u)!], 'legal_notice');
    if (p && within(hostOf(p.url) ?? '', canonical)) firstParty.push(p);
  }

  // 3. secondary domains the company itself establishes (CPG-009)
  report.aliases = establishDomainAliases(canonical, firstParty, redirectedTo);
  for (const a of report.aliases) report.steps.push(`alias ${a.domain} (${a.evidence}, ${ALIAS_STRENGTH[a.evidence]}): ${a.detail}`);

  // 4. DECISIVE alias roots, EXACT host (an IR site on a shared platform is not the platform)
  const decisive = report.aliases.filter((a) => ALIAS_STRENGTH[a.evidence] === 'DECISIVE').slice(0, MAX_ALIAS_ROOTS);
  const aliasPages: FirstPartyPage[] = [];
  for (const a of decisive) {
    const root = await read(`https://${a.domain}/`, [a.domain, `www.${a.domain}`], 'alias_root');
    if (!root || !within(hostOf(root.url) ?? '', a.domain)) continue;
    aliasPages.push(root);
    for (const u of hinted(root, a.domain).slice(0, MAX_ALIAS_PAGES)) {
      const p = await read(u, [hostOf(u)!], 'alias_filing_page');
      if (p && within(hostOf(p.url) ?? '', a.domain)) aliasPages.push(p);
    }
  }

  // 5. registry identity — ONE path for every jurisdiction (registry/establishment.ts)
  return attachRegistry(report, [...firstParty, ...aliasPages], [canonical, ...decisive.map((a) => a.domain)], input, canonical);
}

async function attachRegistry(report: IdentityEstablishmentReport, pages: FirstPartyPage[], ownedHosts: string[],
  input: IdentityEstablishmentInput, canonical: string): Promise<IdentityEstablishmentReport> {
  const reg = await establishRegistryIdentities({
    pages, canonicalDomain: canonical, ownedHosts,
    companyNames: input.companyNames ?? [], jurisdictions: input.jurisdictions ?? [], knownIdentifiers: input.knownIdentifiers ?? [],
    fetcher: input.fetcher, retrievedAt: input.retrievedAt, userAgent: input.registryUserAgent, registry: input.registry,
  });
  const { identities, additionalDomains, ...rest } = reg;
  report.registry = rest;
  report.registryIdentities = identities;
  for (const ref of reg.references) report.steps.push(`reference ${ref.kind} ${ref.exchange ? `${ref.exchange}:` : ''}${ref.value} — ${ref.detail}`);
  for (const sel of reg.selection) report.steps.push(`provider ${sel.providerId} (${sel.jurisdiction}, ${sel.availability}): ${sel.status} — ${sel.reasons.join('; ') || 'no reason'}`);
  for (const c of reg.candidates) report.steps.push(`${c.providerId} ${c.registryId} via ${c.via}: ${c.outcome} — ${c.detail}`);
  for (const a of reg.ambiguity) report.steps.push(`registry: ${a}`);
  for (const fa of additionalDomains) {
    if (!report.aliases.some((a) => a.domain === fa.domain)) { report.aliases.push(fa); report.steps.push(`alias ${fa.domain} (${fa.evidence}): ${fa.detail}`); }
  }
  report.aliases.sort((x, y) => (x.domain < y.domain ? -1 : 1));
  return report;
}

/** Merge an establishment report into the known entity. Existing entries are kept; nothing is removed. */
export function enrichKnownEntity(known: EntitySignals, r: IdentityEstablishmentReport): EntitySignals {
  const aliases = [...(known.domainAliases ?? [])];
  for (const a of r.aliases) if (!aliases.some((x) => x.domain === a.domain)) aliases.push(a);
  const ids = [...(known.registryIdentities ?? [])];
  for (const i of r.registryIdentities) if (!ids.some((x) => x.registryId === i.registryId)) ids.push(i);
  return { ...known, domainAliases: aliases, registryIdentities: ids };
}
