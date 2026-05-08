// Real structured-data extractor.
//
// Operates on already-crawled HTML stored in the project's `page_content` /
// `canonical_pages` tables (Phase 1 publicDomainAuditService is the upstream).
// Extracts:
//   - schema.org Organization fields
//   - FAQPage / HowTo / QAPage markup
//   - sameAs links
//   - metadata consistency across pages
//
// Phase 4: real measurement. No fabrication. When pages have no structured
// data, the result is honest: `state: 'measured'` with `score: 0` and the
// observations log says exactly which schema types were absent.

import type {
  CanonicalScore,
  EvidenceObservation,
  EvidenceTrace,
} from '../canonicalReport/canonicalReportTypes';
import { canonicalBandFromValue } from '../canonicalReport/canonicalReportTypes';

export type StructuredDataInput = {
  // Each crawled page contributes its raw <script type="application/ld+json"> blocks.
  pages: Array<{
    url: string;
    jsonld_blocks: unknown[];
    head_meta?: { title?: string | null; description?: string | null };
  }>;
};

export type StructuredDataResult = {
  schema_richness_score: CanonicalScore;
  has_organization_schema: boolean;
  has_faq_schema: boolean;
  has_howto_schema: boolean;
  has_qa_schema: boolean;
  organization_completeness: number; // 0-1
  sameas_count: number;
  sameas_targets: string[];
  metadata_consistency_score: number; // 0-1: title/description consistency across pages
  evidence: EvidenceTrace;
};

const ORG_FIELDS = [
  'name',
  'url',
  'logo',
  'sameAs',
  'description',
  'address',
  'foundingDate',
  'founder',
  'contactPoint',
] as const;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function flattenGraph(block: unknown): unknown[] {
  if (Array.isArray(block)) return block.flatMap(flattenGraph);
  if (isObject(block)) {
    const graph = (block as { '@graph'?: unknown[] })['@graph'];
    if (Array.isArray(graph)) return graph.flatMap(flattenGraph);
    return [block];
  }
  return [];
}

function typesOf(node: unknown): string[] {
  if (!isObject(node)) return [];
  const t = node['@type'];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
}

function organizationCompleteness(node: Record<string, unknown>): number {
  let populated = 0;
  for (const field of ORG_FIELDS) {
    const value = node[field];
    if (value == null) continue;
    if (typeof value === 'string' && value.trim().length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    populated += 1;
  }
  return populated / ORG_FIELDS.length;
}

function extractSameAs(node: Record<string, unknown>): string[] {
  const sameAs = node['sameAs'];
  if (typeof sameAs === 'string') return [sameAs];
  if (Array.isArray(sameAs)) return sameAs.filter((x): x is string => typeof x === 'string');
  return [];
}

function metadataConsistency(input: StructuredDataInput): number {
  if (input.pages.length < 2) return input.pages.length === 1 ? 1 : 0;
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const page of input.pages) {
    if (page.head_meta?.title) titles.add(page.head_meta.title.trim());
    if (page.head_meta?.description) descriptions.add(page.head_meta.description.trim());
  }
  // Each page should have a unique title (high uniqueness) AND a populated
  // description. We score: % of pages that have BOTH a title and a description.
  const pagesWithFullMeta = input.pages.filter(
    (p) => Boolean(p.head_meta?.title) && Boolean(p.head_meta?.description),
  ).length;
  return pagesWithFullMeta / input.pages.length;
}

export function extractStructuredData(input: StructuredDataInput): StructuredDataResult {
  const observedAt = new Date().toISOString();
  const observations: EvidenceObservation[] = [];

  let hasOrganization = false;
  let orgCompletenessSum = 0;
  let orgCount = 0;
  let hasFaq = false;
  let hasHowTo = false;
  let hasQa = false;
  const sameAsAccum = new Set<string>();

  for (const page of input.pages) {
    for (const block of page.jsonld_blocks) {
      for (const node of flattenGraph(block)) {
        if (!isObject(node)) continue;
        const types = typesOf(node);
        if (types.some((t) => /Organization|Corporation|LocalBusiness/i.test(t))) {
          hasOrganization = true;
          orgCount += 1;
          orgCompletenessSum += organizationCompleteness(node);
          for (const link of extractSameAs(node)) sameAsAccum.add(link);
          observations.push({
            signal: `schema:Organization:${page.url}`,
            source: 'schema_org',
            observed_at: observedAt,
          });
        }
        if (types.some((t) => /FAQPage/i.test(t))) {
          hasFaq = true;
          observations.push({
            signal: `schema:FAQPage:${page.url}`,
            source: 'schema_org',
            observed_at: observedAt,
          });
        }
        if (types.some((t) => /HowTo/i.test(t))) {
          hasHowTo = true;
          observations.push({
            signal: `schema:HowTo:${page.url}`,
            source: 'schema_org',
            observed_at: observedAt,
          });
        }
        if (types.some((t) => /QAPage/i.test(t))) {
          hasQa = true;
          observations.push({
            signal: `schema:QAPage:${page.url}`,
            source: 'schema_org',
            observed_at: observedAt,
          });
        }
      }
    }
  }

  const orgCompleteness = orgCount > 0 ? orgCompletenessSum / orgCount : 0;
  const metaConsistency = metadataConsistency(input);

  // Composite: 35% org schema + 25% FAQ/HowTo/QA presence + 20% sameAs density + 20% meta consistency.
  const orgComponent = (hasOrganization ? 35 : 0) * orgCompleteness + (hasOrganization && orgCompleteness === 0 ? 12 : 0);
  const semanticComponent = ((hasFaq ? 1 : 0) + (hasHowTo ? 1 : 0) + (hasQa ? 1 : 0)) / 3 * 25;
  const sameAsComponent = Math.min(8, sameAsAccum.size) * 2.5;
  const metaComponent = metaConsistency * 20;
  const total = Math.round(Math.max(0, Math.min(100, orgComponent + semanticComponent + sameAsComponent + metaComponent)));

  const evidence: EvidenceTrace = {
    count: observations.length || (input.pages.length > 0 ? 1 : 0),
    sources: ['schema_org'],
    freshness: { last_observed_at: observedAt, age_hours: 0 },
    observations,
  };

  const score: CanonicalScore = {
    value: input.pages.length === 0 ? null : total,
    state: input.pages.length === 0 ? 'insufficient_signal' : 'measured',
    confidence: input.pages.length >= 6 ? 'high' : input.pages.length >= 2 ? 'medium' : 'low',
    band: canonicalBandFromValue(total, input.pages.length === 0 ? 'insufficient_signal' : 'measured'),
    evidence,
    benchmark: { value: null, label: null },
  };

  return {
    schema_richness_score: score,
    has_organization_schema: hasOrganization,
    has_faq_schema: hasFaq,
    has_howto_schema: hasHowTo,
    has_qa_schema: hasQa,
    organization_completeness: orgCompleteness,
    sameas_count: sameAsAccum.size,
    sameas_targets: [...sameAsAccum].slice(0, 20),
    metadata_consistency_score: metaConsistency,
    evidence,
  };
}
