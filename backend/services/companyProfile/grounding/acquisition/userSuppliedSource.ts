/**
 * CPG-002 — user-supplied source references (§7, §8).
 *
 * A user (or an imported dataset such as Raina-12) can name a document as
 * evidence. That reference is treated as A POINTER TO BE CHECKED, never as a
 * verified fact:
 *
 *   • the URL must actually resolve;
 *   • its host determines its tier — sourceAuthority decides, not the fact that
 *     a human supplied it. A user-supplied Wikipedia link is Tier 4;
 *   • the document must be shown to concern the same company (entity
 *     resolution runs on it like any other source);
 *   • unreachable ⇒ UNAVAILABLE(reason), never a guessed substitute.
 *
 * §8 — LINKEDIN. A LinkedIn URL supplied by the user is accepted as a
 * REFERENCE, and its handle is captured as an entity signal for resolution.
 * No LinkedIn content is retrieved, because no approved retrieval mechanism
 * exists; the record therefore reads `USER_SUPPLIED_LINKEDIN_SOURCE` with
 * `unavailable('not_permitted')` for its content. Scraping around the
 * restriction is prohibited and is not attempted.
 */

import type { EvidenceClaim } from '../types';
import { extractWebsiteMetadata } from '../../websiteMetadataExtractor';
import { hostOf } from '../sourceAuthority';
import { extractIdentityEvidence } from '../extraction/identityEvidence';
import {
  claimId, normalizeValue, retrieved, unavailable,
  type AcquisitionContext, type AcquisitionResult, type EvidenceSource,
} from './evidenceSource';

const SOURCE_ID = 'user_supplied_url';

/** Hosts we may reference but must not fetch content from. */
const NO_FETCH_HOSTS: readonly string[] = Object.freeze(['linkedin.com', 'facebook.com', 'instagram.com']);

export interface UserSuppliedOutcome {
  url: string;
  state: 'retrieved' | 'unavailable';
  reason?: string;
  claims: EvidenceClaim[];
}

function isNoFetchHost(host: string): boolean {
  return NO_FETCH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Per-URL outcomes, so a report can show exactly which references resolved. */
export async function ingestUserSuppliedUrls(ctx: AcquisitionContext): Promise<UserSuppliedOutcome[]> {
  const urls = ctx.userSuppliedUrls ?? [];
  const out: UserSuppliedOutcome[] = [];

  for (const raw of urls) {
    const host = hostOf(raw);
    if (!host) {
      out.push({ url: raw, state: 'unavailable', reason: 'invalid_url: not a resolvable URL', claims: [] });
      continue;
    }

    if (isNoFetchHost(host)) {
      // §8 — reference accepted, content NOT retrieved.
      out.push({
        url: raw, state: 'unavailable',
        reason: `not_permitted: ${host} content is not retrievable through any approved mechanism. Recorded as USER_SUPPLIED_LINKEDIN_SOURCE-style reference only.`,
        claims: [],
      });
      continue;
    }

    let res: Awaited<ReturnType<typeof ctx.fetcher>>;
    try {
      res = await ctx.fetcher(raw, { allowedHosts: [host] });
    } catch (err) {
      out.push({ url: raw, state: 'unavailable', reason: `retrieval_failed: ${err instanceof Error ? err.message : String(err)}`, claims: [] });
      continue;
    }
    if (!res || !res.ok || !res.text) {
      out.push({ url: raw, state: 'unavailable', reason: `retrieval_failed: HTTP ${res?.status ?? 'no response'}`, claims: [] });
      continue;
    }

    const meta = extractWebsiteMetadata(res.text, res.url || raw);
    // CPG-009 — identity statements in the document, read against the company.
    const identityEvidence = extractIdentityEvidence(res.text, {
      name: ctx.knownEntity.companyName ?? '',
      canonicalDomain: ctx.companyDomain,
      aliasDomains: (ctx.knownEntity.domainAliases ?? []).map((a) => a.domain),
      registryIds: [ctx.knownEntity.registryId, ...(ctx.knownEntity.registryIdentities ?? []).map((r) => r.registryId)].filter((x): x is string => !!x),
    });
    const claims: EvidenceClaim[] = [];
    const push = (field: string, value: string | null | undefined) => {
      const v = (value ?? '').trim();
      if (!v) return;
      claims.push({
        claimId: claimId(SOURCE_ID, raw, field, v),
        field, value: v, normalizedValue: normalizeValue(v),
        // Declared generically; sourceAuthority assigns the real tier by host.
        sourceType: 'editorial',
        sourceName: host,
        sourceUrl: res.url || raw,
        sourcePublishedAt: null,
        sourceAccessedAt: ctx.asOf,
        excerpt: v.slice(0, 300),
        verificationMethod: 'user_input',
        entitySignals: {
          // ⚠️ CPG-009 FIX — this was the PUBLISHER's og:site_name / <title>:
          // a user-supplied Inc42 article made "Inc42" the subject, so the
          // document resolved as a name MISMATCH (or, for a similarly named
          // publisher, a false match). The subject is not asserted by the
          // page's branding; identity comes only from what the document states.
          companyName: null,
          domain: null, // a third-party article is NOT the company's domain
          linkedinUrl: null, location: null, leadership: [], registryId: null,
          sourceHost: host, publisher: meta.siteName ?? null, identityEvidence,
        },
      });
    };

    // ⚠️ CPG-009 FIX — no `name` claim from a third-party document: its
    // og:site_name is the PUBLISHER's name (CPG-004's own finding), not the
    // company's. Only the document's description is recorded.
    push('company_description', meta.description);

    out.push(
      claims.length > 0
        ? { url: raw, state: 'retrieved', claims }
        : { url: raw, state: 'unavailable', reason: 'no_extractable_claims: document fetched but stated nothing usable', claims: [] },
    );
  }

  return out;
}

export function createUserSuppliedSource(): EvidenceSource {
  return {
    id: SOURCE_ID,
    label: 'User-supplied source reference',
    isAvailable: () => true,
    async acquire(ctx: AcquisitionContext): Promise<AcquisitionResult> {
      const urls = ctx.userSuppliedUrls ?? [];
      if (urls.length === 0) return unavailable('no_coverage', 'no user-supplied source references');
      const outcomes = await ingestUserSuppliedUrls(ctx);
      const claims = outcomes.flatMap((o) => o.claims);
      const fetched = outcomes.filter((o) => o.state === 'retrieved').length;
      if (fetched === 0) {
        const reasons = outcomes.map((o) => `${o.url}: ${o.reason}`).join('; ');
        return unavailable('retrieval_failed', `no supplied reference resolved — ${reasons}`);
      }
      return retrieved(claims, fetched);
    },
  };
}
