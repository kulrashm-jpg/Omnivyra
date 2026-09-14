/**
 * CPG-009 — deterministic identity evidence found IN a retrieved document.
 *
 * The question this answers is narrow: what does the document itself STATE
 * that ties the company it names to a specific entity? Not "does the name
 * match" — names collide — but: does the document declare the company's
 * website, registry id or LinkedIn company, link to its domain, or describe it
 * as the brand / subsidiary of someone else?
 *
 * Output is PROVENANCE (immutable): what was found, with verbatim context. The
 * DECISION (DECISIVE / WEAK / MISMATCH) is made by `resolveEntity`, which
 * compares these statements with what is established about the company.
 *
 * Never used: the publisher's own name, the page <title>, search rank, or any
 * fuzzy similarity. No LLM, no network, no clock.
 */

import type { IdentityEvidence } from '../types';
import { nodesOfType, orgIsSubject, readJsonLdBlocks } from './documentExtractors';
import { decodeEntities, splitSentences } from './valueTypes';
import { normalizeRegistryId, registryIdPattern } from '../registryIdentity';

export interface IdentityTarget {
  /** The company the claim is about (the name the statement names). */
  name: string;
  canonicalDomain: string | null;
  /** Established secondary domains (already evidenced — see domainIdentity.ts). */
  aliasDomains?: readonly string[];
  registryIds?: readonly string[];
  linkedinSlugs?: readonly string[];
}

const hostOfUrl = (u: string): string | null => {
  try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};
const within = (h: string, d: string) => h === d || h.endsWith(`.${d}`);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clip = (s: string, n = 160) => { const t = decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** A "website" label followed (within the same small window) by a link or domain. */
const WEBSITE_LABEL = /\b(?:official\s+website|company\s+website|web\s*site|website|homepage)\b\s*:?/gi;
const FIRST_LOCATOR = /href\s*=\s*["'](https?:\/\/[^"'#\s]+)["']|\b((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s<"']*)?/i;

export function extractIdentityEvidence(html: string, t: IdentityTarget): IdentityEvidence[] {
  const out: IdentityEvidence[] = [];
  const seen = new Set<string>();
  const push = (e: IdentityEvidence) => { const k = `${e.kind}|${e.value}`; if (!seen.has(k)) { seen.add(k); out.push(e); } };
  const ours = [t.canonicalDomain, ...(t.aliasDomains ?? [])].filter((d): d is string => !!d).map((d) => d.toLowerCase().replace(/^www\./, ''));
  const isOurs = (h: string | null) => !!h && ours.some((d) => within(h, d));

  // 1. JSON-LD Organization that IS the named company: its declared url/sameAs.
  for (const type of ['Organization', 'Corporation']) {
    for (const org of nodesOfType(readJsonLdBlocks(html), type)) {
      if (!orgIsSubject(org, t.name)) continue;
      const urls = [org.url, org['@id'], ...(Array.isArray(org.sameAs) ? org.sameAs : [org.sameAs])]
        .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
      for (const u of urls) {
        const h = hostOfUrl(u);
        if (!h) continue;
        const li = /linkedin\.com\/company\/([^/?#]+)/i.exec(u);
        if (li) { push({ kind: 'linkedin_company', value: li[1].toLowerCase(), detail: `JSON-LD Organization "${String(org.name)}" sameAs ${u}` }); continue; }
        push({ kind: 'json_ld_org_url', value: h, detail: `JSON-LD Organization "${String(org.name)}" declares ${u}` });
      }
    }
  }

  // 2. A labelled "Website" field whose FIRST link/domain is the company's.
  //    Read positively only: a page listing several companies can carry
  //    several website fields, so a non-matching one proves nothing.
  // ⚠️ CPG-009 LIVE FIX — the label must be VISIBLE TEXT, standing alone, and
  // the value must follow it with nothing visible in between. Live, the word
  // matched inside a footer URL ("website-terms/") and inside Wikipedia's
  // data-mw JSON attributes ('"website":{"wt":"Bloomberg"}'), producing false
  // DECISIVE identity from whatever link happened to come next.
  let m: RegExpExecArray | null;
  const re = new RegExp(WEBSITE_LABEL.source, 'gi');
  while ((m = re.exec(html)) !== null) {
    const before = html.slice(0, m.index);
    if (before.lastIndexOf('<') > before.lastIndexOf('>')) continue;           // inside a tag / attribute
    if (/[-/_.\w"']/.test(html.charAt(m.index + m[0].length)) && !m[0].endsWith(':')) continue; // "website-terms", "website\""
    const win = html.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const loc = FIRST_LOCATOR.exec(win);
    if (!loc) continue;
    // Tags between label and value are fine, including the opening of the
    // <a …> whose href IS the value; visible text is not.
    const between = decodeEntities(win.slice(0, loc.index).replace(/<[^>]*>/g, '').replace(/<[^>]*$/, ''));
    if (!/^[\s:]*$/.test(between)) continue;                                    // the value must follow directly
    const h = hostOfUrl(loc[1] ?? loc[2]);
    if (isOurs(h)) push({ kind: 'labelled_website', value: h!, detail: clip(html.slice(m.index, m.index + m[0].length + 200)) });
  }

  // 3. Explicit identifiers.
  // CPG-010: scheme-aware — a CIK counts only in an explicit CIK / EDGAR
  // context (a bare 7-digit number is not an identifier); the value recorded
  // is the NORMALISED id so it compares across documents.
  for (const id of t.registryIds ?? []) {
    const re = id ? registryIdPattern(id) : null;
    if (id && re && re.test(html)) {
      const n = normalizeRegistryId(id);
      const value = n && n.scheme !== 'RAW' ? n.registryId : id;
      push({ kind: 'registry_id', value, detail: `document states registry identifier ${value}` });
    }
  }
  for (const slug of t.linkedinSlugs ?? []) {
    if (slug && new RegExp(`linkedin\\.com/company/${escapeRe(slug)}(?![A-Za-z0-9-])`, 'i').test(html)) {
      push({ kind: 'linkedin_company', value: slug.toLowerCase(), detail: `document links linkedin.com/company/${slug}` });
    }
  }

  // 4. Any link to the company's domain — SUPPORTING only (links can be incidental).
  const hrefRe = /href\s*=\s*["'](https?:\/\/[^"'#\s]+)["']/gi;
  while ((m = hrefRe.exec(html)) !== null) {
    const h = hostOfUrl(m[1]);
    if (isOurs(h)) { push({ kind: 'domain_link', value: h!, detail: `document links to ${m[1].slice(0, 120)}` }); break; }
  }

  // 5. Relationship, location and rename statements about the named company.
  const T = escapeRe(t.name).replace(/\s+/g, '\\s+');
  const N = String.raw`([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,5})`;
  const rel: [RegExp, string][] = [
    [new RegExp(`\\b${T}\\s*,?\\s*(?:is\\s+)?(?:a|an|the)\\s+(brand|subsidiary|wholly[- ]owned subsidiary|division|business unit|unit|product|trading name)\\s+of\\s+${N}`, 'i'), '$1_of'],
    [new RegExp(`\\b${T}\\s*,?\\s*(?:is\\s+)?(owned|operated)\\s+by\\s+${N}`, 'i'), '$1_by'],
    [new RegExp(`${N}\\s*,?\\s*(?:which|that)\\s+(owns|operates|runs)\\s+(?:the\\s+)?${T}\\b`, 'i'), 'owner'],
  ];
  for (const s of splitSentences(html)) {
    if (!new RegExp(`\\b${T}\\b`, 'i').test(s)) continue;
    for (const [r, kind] of rel) {
      const x = r.exec(s);
      if (!x) continue;
      const trim = (n: string) => n.trim().replace(/[.,;:]+$/, '');
      const k = kind === 'owner' ? `owned_by:${trim(x[1])}` : `${kind.replace('$1', x[1].toLowerCase().replace(/\s+/g, '_'))}:${trim(x[2])}`;
      push({ kind: 'relationship', value: k, detail: clip(s) });
    }
    const loc = new RegExp(`\\b${T}\\b[^.]{0,80}?\\b(?:based|headquartered|headquarters(?:\\s+is)?)\\s+in\\s+([A-Z][A-Za-z .'-]{2,40}?)(?=\\s*(?:[,.;()]|$|and\\b|with\\b|founded\\b))`, 'i').exec(s);
    if (loc) push({ kind: 'location_statement', value: loc[1].trim(), detail: clip(s) });
    const former = new RegExp(`\\b${T}\\b\\s*,?\\s*\\(?\\s*(?:formerly|previously)\\s+(?:known\\s+as\\s+)?${N}`, 'i').exec(s);
    if (former) push({ kind: 'former_name_statement', value: former[1].trim(), detail: clip(s) });
  }
  return out;
}
