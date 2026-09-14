/**
 * CPG-006 — the discovered-evidence source (§6, §8, §9, §14).
 *
 * Turns discovery candidates into real evidence by RETRIEVING them. This is the
 * enforcement point for the rule the whole task rests on:
 *
 *     search snippet  ->  NEVER a claim
 *     fetched document ->  evidence
 *
 * A candidate that cannot be fetched produces NOTHING. There is no path from a
 * title or snippet to an `EvidenceClaim`; the extractor only ever reads a
 * document body retrieved through `safeFetch`.
 *
 * ─── AUTHORITY STAYS DOWNSTREAM (§9) ───────────────────────────────────────
 * This source performs one pre-retrieval check against the CPG-003 registry:
 * it refuses to spend a fetch on a host the registry marks `neverFor` the field
 * being sought (a company marketing page for `revenue`, say). That is a COST
 * decision, not an authority decision — and it can only ever REMOVE a candidate,
 * never promote one. Final authority, entity match, freshness, corroboration and
 * conflict all remain owned by CPG-001/003 exactly as before.
 *
 * Search rank never survives into evidence strength.
 *
 * ─── BOUNDED (§16) ─────────────────────────────────────────────────────────
 * At most `maxRetrievalsPerField` documents per field. No recursion, no link
 * following, no crawling. Discovery runs once per field and stops.
 */

import { extractWebsiteMetadata } from '../../websiteMetadataExtractor';
import { extractDocumentDate, extractField } from '../extraction/documentExtractors';
import { toEvidenceValue } from '../extraction/valueTypes';
import { extractIdentityEvidence } from '../extraction/identityEvidence';
import { authorityForField, registrySourceIdFor } from './sourceRegistry';
import { classifySource } from '../sourceAuthority';
import type { EvidenceClaim } from '../types';
import {
  claimId, normalizeValue, retrieved, unavailable,
  type AcquisitionContext, type AcquisitionResult, type EvidenceSource,
} from './evidenceSource';
import { buildQueryPlan } from '../discovery/queryStrategy';
import {
  discover, DISCOVERY_LIMITS,
  type DiscoveryCandidate, type DiscoveryProvider, type DiscoveryResult,
} from '../discovery/webDiscovery';

const SOURCE_ID = 'discovered_web';

/** Provenance a discovered claim carries beyond the normal evidence fields. */
export interface DiscoveryProvenance {
  discoveryProvider: string;
  discoveryQuery: string;
  discoveryRank: number;
  originalUrl: string;
  canonicalUrl: string;
}

/** Per-run record, so a report can show exactly what happened (§14). */
export interface DiscoveredRunTrace {
  field: string;
  queries: string[];
  refusedReason: string | null;
  discovery: DiscoveryResult | null;
  /** Candidates dropped before any fetch was spent. */
  skippedBeforeFetch: { url: string; reason: string }[];
  fetched: { url: string; ok: boolean; status: number }[];
  claimsProduced: number;
  provenance: DiscoveryProvenance[];
}

export interface DiscoveredSourceOptions {
  provider: DiscoveryProvider;
  /** Fields to attempt discovery for. Non-discoverable fields are refused. */
  fields: readonly string[];
  /** Collected per run, for the report. */
  trace?: DiscoveredRunTrace[];
}

export function createDiscoveredWebSource(opts: DiscoveredSourceOptions): EvidenceSource {
  return {
    id: SOURCE_ID,
    label: 'Discovered public web evidence',
    isAvailable: () => opts.provider.isAvailable(),

    async acquire(ctx: AcquisitionContext): Promise<AcquisitionResult> {
      const companyName = ctx.knownEntity.companyName?.trim();
      if (!companyName) return unavailable('no_coverage', 'no company name to search for');

      const claims: EvidenceClaim[] = [];
      let documentsFetched = 0;
      const unavailableReasons: string[] = [];

      for (const field of opts.fields) {
        const trace: DiscoveredRunTrace = {
          field, queries: [], refusedReason: null, discovery: null,
          skippedBeforeFetch: [], fetched: [], claimsProduced: 0, provenance: [],
        };

        const plan = buildQueryPlan(companyName, field);
        trace.queries = plan.queries;
        trace.refusedReason = plan.refusedReason;
        if (plan.refusedReason) { opts.trace?.push(trace); continue; }

        const result = await discover({
          companyName, companyDomain: ctx.companyDomain, field,
          queries: plan.queries, provider: opts.provider, asOf: ctx.asOf,
        });
        trace.discovery = result;

        if (result.status !== 'ok') {
          if (result.unavailableReason) unavailableReasons.push(`${field}: ${result.unavailableReason}`);
          opts.trace?.push(trace);
          continue;
        }

        let fetchesForField = 0;
        for (const cand of result.candidates) {
          if (fetchesForField >= DISCOVERY_LIMITS.maxRetrievalsPerField) break;

          // §9 — refuse to SPEND a fetch on a source the registry forbids for
          // this field. Removal only; never promotion.
          const regId = registrySourceIdFor(cand.host, cand.host, ctx.companyDomain, true,
            { domainAliases: ctx.knownEntity.domainAliases, path: (() => { try { return new URL(cand.url).pathname; } catch { return null; } })() });
          if (authorityForField(regId, field) === 'never') {
            trace.skippedBeforeFetch.push({
              url: cand.url,
              reason: `registry marks ${regId} neverFor "${field}" — search rank ${cand.rank} does not override that`,
            });
            continue;
          }

          // §6 — RETRIEVAL IS MANDATORY. The snippet is not consulted here.
          let res: Awaited<ReturnType<typeof ctx.fetcher>>;
          try { res = await ctx.fetcher(cand.url, { allowedHosts: [cand.host] }); }
          catch { trace.fetched.push({ url: cand.url, ok: false, status: 0 }); continue; }

          fetchesForField++;
          if (!res || !res.ok || !res.text) {
            trace.fetched.push({ url: cand.url, ok: false, status: res?.status ?? 0 });
            continue;
          }
          trace.fetched.push({ url: res.url || cand.url, ok: true, status: res.status });
          documentsFetched++;

          for (const c of extractFromDocument(res.text, res.url || cand.url, cand, field, ctx)) {
            claims.push(c);
            trace.claimsProduced++;
            trace.provenance.push({
              discoveryProvider: cand.provider, discoveryQuery: cand.query,
              discoveryRank: cand.rank, originalUrl: cand.url, canonicalUrl: cand.canonicalUrl,
            });
          }
        }
        opts.trace?.push(trace);
      }

      if (claims.length === 0) {
        return unavailable(
          unavailableReasons.length ? 'retrieval_failed' : 'no_extractable_claims',
          unavailableReasons.join('; ') || 'discovered documents stated nothing extractable',
        );
      }
      return retrieved(claims, documentsFetched);
    },
  };
}

/**
 * Extract claims from a RETRIEVED document.
 *
 * Conservative on purpose, exactly as the first-party extractor is: only what
 * the document's own metadata asserts. A discovered article's `<title>` is the
 * publisher's headline, not a company fact, so it never becomes `name`.
 *
 * The value of discovery here is not richer parsing — it is that an INDEPENDENT
 * document now exists in the evidence set, with its URL, so corroboration and
 * conflict detection have something real to work with.
 */
function extractFromDocument(
  html: string, url: string, cand: DiscoveryCandidate, field: string, ctx: AcquisitionContext,
): EvidenceClaim[] {
  const meta = extractWebsiteMetadata(html, url);
  const cls = classifySource(url, 'editorial', ctx.companyDomain, ctx.knownEntity.domainAliases);
  const out: EvidenceClaim[] = [];

  // ── CPG-009 — what this document says about IDENTITY (once per document) ─
  // The publisher (og:site_name) is recorded separately and never matched as
  // the subject. Identity comes only from what the document states.
  const k = ctx.knownEntity;
  const identityEvidence = extractIdentityEvidence(html, {
    name: k.companyName ?? '',
    canonicalDomain: ctx.companyDomain,
    aliasDomains: (k.domainAliases ?? []).map((a) => a.domain),
    // CPG-010: every ESTABLISHED registry id, normalised (CIK / CIN / …).
    registryIds: [k.registryId, ...(k.registryIdentities ?? []).map((r) => r.registryId)].filter((x): x is string => !!x),
    linkedinSlugs: k.linkedinUrl ? [/linkedin\.com\/company\/([^/?#]+)/i.exec(k.linkedinUrl)?.[1] ?? ''].filter(Boolean) : [],
  });
  const docIdentity = {
    sourceHost: cand.host, publisher: meta.siteName ?? null, identityEvidence,
  };

  // ── CPG-007 — STRUCTURED VALUE EXTRACTION (closes B-15) ──────────────────
  // Before falling back to "this document discusses the field", try to extract
  // an actual typed value. A structured value can corroborate or contradict a
  // user's profile; a source statement cannot. The extractor emits nothing
  // unless the document states the value explicitly.
  const companyName = ctx.knownEntity.companyName ?? '';
  if (companyName) {
    // Declared by the document itself, or null. Freshness only — never a period.
    const documentDate = extractDocumentDate(html);
    for (const v of extractField(field, html, companyName).values) {
      // Currency-qualified for money ("INR 78,000,000 (FY2024)"), so the
      // resolver compares amount AND currency, never a bare number.
      const ev = toEvidenceValue(v);
      out.push({
        claimId: claimId(SOURCE_ID, url, v.field, ev.normalizedValue),
        field: v.field,
        value: ev.value,
        normalizedValue: ev.normalizedValue,
        sourceType: cls.sourceType,
        sourceName: cand.host,
        sourceUrl: url,
        sourcePublishedAt: documentDate,
        sourceAccessedAt: ctx.asOf,
        // The VERBATIM supporting sentence — the user's proof, not a paraphrase.
        excerpt: v.sourceStatement.slice(0, 300),
        verificationMethod: v.method === 'json_ld' ? 'derivation' : 'crawl',
        entitySignals: {
          // ⚠️ CPG-007 FIX — the entity a value is ABOUT is the company the
          // statement names (the extractor refuses any statement or JSON-LD
          // node that does not name it), NOT the publisher. Using
          // `meta.siteName` made every Reuters/Mint/TechCrunch value resolve as
          // an entity MISMATCH ("Reuters" ≠ "Cloudflare") and be discarded.
          // A name alone resolves to `weak` — never decisive — which is exactly
          // the strength a third-party statement deserves.
          companyName,
          domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null,
          ...docIdentity,
        },
        discovery: { provider: cand.provider, query: cand.query, rank: cand.rank },
        extraction: {
          sourceStatement: v.sourceStatement,
          temporalType: v.temporalType,
          period: v.period,
          year: v.year,
          currency: v.currency,
          approximation: v.approximation,
          moneyKind: v.moneyKind,
          method: v.method,
          acceptedBecause: v.acceptedBecause,
          qualifier: v.qualifier ?? null,
        },
      });
    }
  }

  const description = (meta.description ?? '').trim();
  if (!description) return out;

  out.push({
    claimId: claimId(SOURCE_ID, url, `${field}_source_statement`, description),
    // Namespaced deliberately: this is what an independent document SAYS about
    // the field, not a resolved value for the field itself.
    field: `${field}_source_statement`,
    value: description,
    normalizedValue: normalizeValue(description),
    sourceType: cls.sourceType,
    sourceName: cand.host,
    sourceUrl: url,
    sourcePublishedAt: null,
    sourceAccessedAt: ctx.asOf,
    excerpt: description.slice(0, 300),
    verificationMethod: 'crawl',
    discovery: { provider: cand.provider, query: cand.query, rank: cand.rank },
    entitySignals: {
      // A third-party document is NOT the company's domain — it must never
      // borrow first-party authority through entity resolution.
      // ⚠️ CPG-009 FIX — `companyName` was the PUBLISHER's og:site_name here
      // (the CPG-007 defect, surviving in this second code path). A page
      // description does not necessarily name the company, so no subject name
      // is asserted; identity comes only from the document's statements.
      companyName: null,
      domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null,
      ...docIdentity,
    },
  });
  return out;
}
