/**
 * CPG-010 — SEC EDGAR registrant identity (§4).
 *
 * WHAT IS CONSUMED (keyless, public, SEC fair-access policy):
 *   https://data.sec.gov/submissions/CIK##########.json   registrant master record
 *   https://www.sec.gov/files/company_tickers_exchange.json  the SEC's ticker table
 *   https://www.sec.gov/Archives/edgar/data/<cik>/<acc>/<doc> an annual report
 *
 * HOW A CIK IS REACHED — never by name. Only:
 *   1. a link into EDGAR carrying a numeric CIK on the company's OWN page, or
 *   2. an exchange-qualified ticker the company states on its OWN page, mapped
 *      through the SEC's own ticker table (exact ticker; exchange must agree).
 *
 * WHEN THE CIK BECOMES THE COMPANY'S IDENTITY — only when the registrant side
 * points back at the company: the registrant record's `website`, or its latest
 * annual report's statement of "our website", names the company's canonical
 * (or a DECISIVELY established) domain. A pointer from the company alone is not
 * enough: an IR page can link its PARENT's filings, and a press release on it
 * can quote a partner's ticker. Both directions, or nothing (§4: the identity
 * attaches to the actual registrant; parent and subsidiary stay distinct).
 *
 * Exactly one confirmed registrant, or none: two confirmed CIKs is ambiguity,
 * reported, never resolved by picking.
 *
 * No financial value is read from a filing (no XBRL reader) — the filing is
 * used for the registrant↔domain association only.
 */

import { decodeEntities } from '../extraction/valueTypes';
import { field, member } from '../jsonAccess';

/**
 * CPG-011 — this module is now PURE SEC PARSING (records, ticker table, filing
 * website statements). The provider behaviour — which references it acts on,
 * how a candidate is confirmed — lives in registry/providers/secEdgarProvider.ts
 * behind the country-neutral provider contract; the core never imports this file.
 */

/** CIK: 1–10 digits, zero-padded to 10. Form only — never corrected. */
export function cik10(raw: string): string | null {
  const s = raw.trim().replace(/^CIK\s*[:#]?\s*/i, '');
  if (!/^\d{1,10}$/.test(s)) return null;
  const v = s.padStart(10, '0');
  return /^0+$/.test(v) ? null : v;
}

export const SEC_DATA_HOST = 'data.sec.gov';
export const SEC_WWW_HOST = 'www.sec.gov';
export const SEC_TICKER_TABLE_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
export const submissionsUrl = (cik10: string) => `https://${SEC_DATA_HOST}/submissions/CIK${cik10}.json`;

/** Annual-report forms; amendments excluded. */
const ANNUAL_FORMS = new Set(['10-K', '20-F', '40-F']);
/** Bounded work per company. */
export const MAX_CANDIDATES = 4;
export const MAX_TICKERS = 5;
// CPG-010 LIVE FIX — was 12 MB: the Infosys 20-F is 13.06 MB and was refused
// whole (readCapped aborts, it does not truncate). 16 MB is the live fetcher's
// ceiling; a larger filing stays UNCONFIRMED rather than half-read.
export const FILING_MAX_BYTES = 16 * 1024 * 1024;

export interface SecAddress { street1: string | null; city: string | null; stateOrCountry: string | null; stateOrCountryDescription: string | null; country: string | null }

export interface SecRegistrant {
  cik10: string;
  registryId: string;
  name: string;
  formerNames: { name: string; from: string | null; to: string | null }[];
  tickers: string[];
  exchanges: string[];
  ein: string | null;
  stateOfIncorporation: string | null;
  website: string | null;
  businessAddress: SecAddress | null;
  sicDescription: string | null;
  recordUrl: string;
  latestAnnual: { form: string; accessionNumber: string; filingDate: string; reportDate: string | null; primaryDocument: string; url: string } | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Parse a submissions JSON. Pure. Returns null when it is not a registrant record. */
export function parseSubmissions(json: unknown, recordUrl: string): SecRegistrant | null {
  if (!json || typeof json !== 'object') return null;
  const j: unknown = json;
  const c = cik10(String(member(j, 'cik') ?? ''));
  const id = c ? { value: c, registryId: `CIK:${c}` } : null;
  const name = str(member(j, 'name'));
  if (!id || !name) return null;
  const addr = field(member(j, 'addresses'), 'business');
  const recent = field(member(j, 'filings'), 'recent') ?? {};
  const formList = member(recent, 'form');
  const forms: unknown[] = Array.isArray(formList) ? formList : [];
  let latest: SecRegistrant['latestAnnual'] = null;
  for (let i = 0; i < forms.length; i++) {
    const form = String(forms[i]);
    if (!ANNUAL_FORMS.has(form)) continue;
    const acc = str(field(member(recent, 'accessionNumber'), i)); const doc = str(field(member(recent, 'primaryDocument'), i)); const date = str(field(member(recent, 'filingDate'), i));
    if (!acc || !doc || !date) continue;
    // Newest filing date wins; ties by accession — never by array position.
    if (!latest || date > latest.filingDate || (date === latest.filingDate && acc > latest.accessionNumber)) {
      latest = {
        form, accessionNumber: acc, filingDate: date, reportDate: str(field(member(recent, 'reportDate'), i)), primaryDocument: doc,
        url: `https://${SEC_WWW_HOST}/Archives/edgar/data/${Number(id.value)}/${acc.replace(/-/g, '')}/${doc}`,
      };
    }
  }
  const formerNames = member(j, 'formerNames');
  const tickers = member(j, 'tickers');
  const exchanges = member(j, 'exchanges');
  return {
    cik10: id.value, registryId: id.registryId, name,
    formerNames: (Array.isArray(formerNames) ? formerNames : [])
      .map((f: unknown) => ({ name: str(field(f, 'name')) ?? '', from: str(field(f, 'from'))?.slice(0, 10) ?? null, to: str(field(f, 'to'))?.slice(0, 10) ?? null }))
      .filter((f: { name: string }) => f.name),
    tickers: (Array.isArray(tickers) ? tickers : []).map(String),
    exchanges: (Array.isArray(exchanges) ? exchanges : []).map(String),
    ein: str(member(j, 'ein')), stateOfIncorporation: str(member(j, 'stateOfIncorporation')), website: str(member(j, 'website')),
    businessAddress: addr ? { street1: str(member(addr, 'street1')), city: str(member(addr, 'city')), stateOrCountry: str(member(addr, 'stateOrCountry')), stateOrCountryDescription: str(member(addr, 'stateOrCountryDescription')), country: str(member(addr, 'country')) } : null,
    sicDescription: str(member(j, 'sicDescription')), recordUrl, latestAnnual: latest,
  };
}

export interface TickerEntry { cik10: string; name: string; ticker: string; exchange: string | null }

/** Parse the SEC ticker table (company_tickers_exchange.json). Pure. */
export function parseTickerTable(json: unknown): Map<string, TickerEntry[]> {
  const out = new Map<string, TickerEntry[]>();
  const j = json as { fields?: unknown; data?: unknown } | null;
  if (!j || !Array.isArray(j.fields) || !Array.isArray(j.data)) return out;
  const f = j.fields.map(String);
  const ci = f.indexOf('cik'), ni = f.indexOf('name'), ti = f.indexOf('ticker'), ei = f.indexOf('exchange');
  if (ci < 0 || ti < 0) return out;
  for (const row of j.data as unknown[][]) {
    const c = cik10(String(row?.[ci] ?? ''));
    const ticker = String(row?.[ti] ?? '').toUpperCase();
    if (!c || !ticker) continue;
    const e: TickerEntry = { cik10: c, name: String(row?.[ni] ?? ''), ticker, exchange: ei >= 0 && row?.[ei] ? String(row[ei]) : null };
    out.set(ticker, [...(out.get(ticker) ?? []), e]);
  }
  return out;
}

/**
 * "Our website is located at https://www.cloudflare.com", "our website address
 * is www.infosys.com" — the entity's own statement of its website, in a filing.
 * Only first-person statements ("our", "the Company's", "its") are read. Pure.
 */
export function findWebsiteStatements(html: string): { host: string; statement: string }[] {
  const text = decodeEntities(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ');
  const re = /\b(?:our|the company['’]s|its)\s+(?:corporate\s+|internet\s+|investor\s+relations\s+|principal\s+)?(?:web\s?site|internet\s+(?:site|address)|website\s+address)\b[^.]{0,80}?\b((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?=[\s,;)\/]|\.(?:\s|$)|$)/gi;
  const out: { host: string; statement: string }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].toLowerCase();
    let h: string | null = null;
    try { h = new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, ''); } catch { h = null; }
    if (!h || /(^|\.)sec\.gov$/.test(h) || seen.has(h)) continue;
    seen.add(h);
    const start = Math.max(0, m.index - 40);
    out.push({ host: h, statement: text.slice(start, m.index + m[0].length).trim().slice(0, 220) });
  }
  return out;
}

/** Title-case a registry's upper-case city ("SAN FRANCISCO" → "San Francisco"). */
export const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());

export const US_STATES: Readonly<Record<string, string>> = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
});

/** "San Francisco, California" / "Bangalore, India" — as the registry states it, codes expanded. */
export function registrantHeadquarters(r: SecRegistrant): string | null {
  const a = r.businessAddress;
  if (!a?.city) return null;
  const code = a.stateOrCountry?.toUpperCase() ?? null;
  // CPG-010 LIVE FIX — a foreign registrant's record carries the country in
  // `country` (Infosys: stateOrCountry null, country "India"); it was dropped.
  const region = code && US_STATES[code] ? US_STATES[code]
    : a.country ? titleCase(a.country)
    : a.stateOrCountryDescription && a.stateOrCountryDescription.toUpperCase() !== code ? titleCase(a.stateOrCountryDescription)
    : null;
  return region ? `${titleCase(a.city)}, ${region}` : titleCase(a.city);
}
