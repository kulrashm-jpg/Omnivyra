/**
 * CPG-003 — Wikidata evidence source.
 *
 * ⚠️ CORRECTION TO CPG-002. That report classified Wikidata as
 * `implemented_not_wired` with `callableForGrounding: false`. The CPG-003
 * re-audit found that understated: `intelligence/adapters/wikidataAdapter.ts`
 * is a REAL HTTP client against wikidata.org, it is keyless, it is default-ON
 * (`WIKIDATA_ENABLED !== 'false'`), and it already has a live production
 * consumer in `canonicalReportBuilder`. It was callable all along.
 *
 * REUSE, NOT DUPLICATION (§1). This module writes no HTTP client and no parser.
 * It calls the existing `lookupCompanyFirmographicsFromWikidata` and maps its
 * result into CPG-001 evidence claims. The adapter keeps ownership of caching,
 * SSRF annotation, the kill switch and organization-type validation.
 *
 * WHAT IT CAN AND CANNOT SAY. The adapter returns founded_year, team_size,
 * revenue_range and matched_label. So this source contributes IDENTITY and a
 * couple of firmographics — and nothing else. It emits no positioning, no ICP
 * and no actual revenue.
 *
 * ⚠️ `revenue_range` IS NOT REVENUE. It is a coarse band, and mapping it onto
 * the `revenue` field would manufacture exactly the false conflict CPG-002 was
 * built to avoid. It is emitted as `revenue_range`, a distinct field, and the
 * registry marks Wikidata `neverFor: ['revenue','annual_revenue']`.
 */

import { lookupCompanyFirmographicsFromWikidata } from '../../../intelligence/adapters/wikidataAdapter';
import type { EvidenceClaim } from '../types';
import {
  claimId, normalizeValue, retrieved, unavailable,
  type AcquisitionContext, type AcquisitionResult, type EvidenceSource,
} from './evidenceSource';

const SOURCE_ID = 'wikidata';

// The adapter's own kill switch (`WIKIDATA_ENABLED === 'false'` disables it). A shared
// `isWikidataEnabled()` helper exists only on an unmerged branch, so the deploy line
// is read directly here, with the same semantics.
const wikidataEnabled = (): boolean => process.env.WIKIDATA_ENABLED !== 'false';

export type WikidataLookup = (brandName: string) => Promise<{
  founded_year: string | null;
  team_size: string | null;
  revenue_range: string | null;
  matched_label: string | null;
  /** CPG-009 — optional so older lookups / cached entries remain valid. */
  qid?: string | null;
  official_websites?: string[];
}>;

/**
 * `lookup` is injectable so tests exercise the mapping deterministically without
 * a network call. Production uses the real adapter.
 */
export function createWikidataSource(
  lookup: WikidataLookup = lookupCompanyFirmographicsFromWikidata,
  enabled: () => boolean = wikidataEnabled,
): EvidenceSource {
  return {
    id: SOURCE_ID,
    label: 'Wikidata (structured, keyless)',
    isAvailable: () => enabled(),
    async acquire(ctx: AcquisitionContext): Promise<AcquisitionResult> {
      const brand = ctx.knownEntity.companyName?.trim();
      if (!brand) return unavailable('no_coverage', 'no company name to look up');

      const res = await lookup(brand);
      if (!res.matched_label) {
        // A lookup that succeeded and found nothing is MEASURED ABSENCE, not failure.
        return unavailable('no_coverage', `Wikidata has no organization entity matching "${brand}"`);
      }

      // The entity page is the traceable source the user can inspect.
      // CPG-009: the MATCHED entity's page when its id is known — a search URL
      // does not tell the user which organisation was used.
      const url = res.qid
        ? `https://www.wikidata.org/wiki/${res.qid}`
        : `https://www.wikidata.org/wiki/Special:EntityData?search=${encodeURIComponent(res.matched_label)}`;
      const claims: EvidenceClaim[] = [];

      const push = (field: string, value: string | null) => {
        const v = (value ?? '').trim();
        if (!v) return;
        claims.push({
          claimId: claimId(SOURCE_ID, url, field, v),
          field, value: v, normalizedValue: normalizeValue(v),
          sourceType: 'business_intelligence',
          sourceName: 'Wikidata',
          sourceUrl: url,
          // Wikidata statements carry no single publication date we can trust.
          sourcePublishedAt: null,
          sourceAccessedAt: ctx.asOf,
          excerpt: null,
          verificationMethod: 'provider_api',
          entitySignals: {
            companyName: res.matched_label,
            domain: null,      // Wikidata is NOT the company's own domain
            linkedinUrl: null,
            location: null,
            leadership: [],
            registryId: null,
            sourceHost: 'wikidata.org',
            publisher: 'Wikidata',
            // ⚠️ CPG-009 — the lookup matches by LABEL (first search hit). The
            // entity's own P856 official website is what ties it to THIS
            // company: our domain → DECISIVE; another website → MISMATCH (a
            // same-name organisation); none stated → name-only, WEAK.
            identityEvidence: (res.official_websites ?? []).map((w) => ({
              kind: 'structured_official_website' as const,
              value: w,
              detail: `Wikidata ${res.qid ?? '(entity)'} P856 official website ${w}`,
            })),
          },
        });
      };

      push('name', res.matched_label);
      push('founded_year', res.founded_year);
      push('employee_count', res.team_size);
      // Distinct field on purpose — a band is not a revenue figure.
      push('revenue_range', res.revenue_range);

      return retrieved(claims, 1);
    },
  };
}
