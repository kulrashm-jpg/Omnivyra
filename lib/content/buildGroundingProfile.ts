/**
 * buildGroundingProfile.ts
 *
 * Phase 4.3 — Lightweight grounding profile builder. Activates the
 * citation orchestration / source integrity / factual grounding layers
 * WITHOUT introducing a vector DB.
 *
 * The profile is populated from three explicit sources:
 *   1. Prior company blog posts (already in `public_blogs` / `blogs`).
 *   2. Internally uploaded company documents / approved snippets / case
 *      studies (passed in by caller).
 *   3. Approved URL references from the company profile.
 *
 * Matching from claim → source happens later in
 * `claimSourceTraceabilityEngine.ts` using deterministic keyword overlap
 * (not embeddings). This module's job is purely assembly.
 */

import type {
  KnowledgeSource,
  KnowledgeSourceFragment,
  RetrievalGroundingProfile,
  FactualAnchor,
  SourceTrustLevel,
  SourceReliabilityBand,
  SourceVerificationStatus,
  CitationEligibility,
  SourceType,
} from '../../backend/services/longForm/longFormRecommendationTypes';

// ── Input shapes ─────────────────────────────────────────────────────────────

export interface CompanyOwnedBlogSource {
  id: string;
  title: string;
  url?: string;
  publishedAt?: string;
  excerpt?: string;
  /** Raw HTML or plain text — we'll strip to fragments. */
  content?: string;
  tags?: string[];
}

export interface InternalUploadedDocument {
  id: string;
  title: string;
  url?: string;
  publishedAt?: string;
  uploadedAt?: string;
  /** Free-text content. */
  body: string;
  tags?: string[];
  /** When the upload is a vetted case study, raise trust. */
  classification?: 'case_study' | 'whitepaper' | 'product_doc' | 'note' | 'transcript' | 'other';
}

export interface ApprovedUrlReference {
  url: string;
  title?: string;
  topicHint?: string;
  /** Author / publisher name when available. */
  authorOrPublisher?: string;
  /** Optional one-line excerpt to anchor claims. */
  excerpt?: string;
}

export interface ApprovedSnippet {
  id: string;
  text: string;
  topicHint?: string;
  /** Who authored or vetted this — drives trust band. */
  attribution?: string;
}

export interface BuildGroundingProfileInput {
  recommendationId: string;
  topic: string;
  companyBlogs?: CompanyOwnedBlogSource[];
  internalUploads?: InternalUploadedDocument[];
  approvedUrls?: ApprovedUrlReference[];
  approvedSnippets?: ApprovedSnippet[];
  /** Strategic notes/terms from the company profile. */
  approvedTerminology?: string[];
  /** Optional ceiling on how many fragments to keep per source. */
  maxFragmentsPerSource?: number;
}

// ── Type-graph copies (kept narrow — buildGroundingProfile is a leaf) ───────

export interface BuiltGroundingProfile {
  profile: RetrievalGroundingProfile;
  /** Hints back to the caller about completeness. */
  diagnostics: {
    total_sources: number;
    by_source_type: Partial<Record<SourceType, number>>;
    by_trust_band: Partial<Record<SourceReliabilityBand, number>>;
    total_fragments: number;
    total_anchors: number;
    is_empty: boolean;
    coverage_notes: string[];
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 600);
}

function stableId(prefix: string, basis: string): string {
  let h = 5381;
  for (let i = 0; i < basis.length; i += 1) h = ((h << 5) + h) ^ basis.charCodeAt(i);
  return `${prefix}_${(h >>> 0).toString(16)}`;
}

function fragmentsFromText(
  sourceId: string,
  body: string,
  topicHint: string | undefined,
  maxFragments: number,
): KnowledgeSourceFragment[] {
  const sentences = splitIntoSentences(stripHtml(body));
  const top = sentences.slice(0, maxFragments);
  return top.map((sentence, idx) => ({
    fragmentId: stableId(`${sourceId}_f${idx}`, sentence),
    text: sentence,
    topicHint,
  }));
}

function classifyTrust(input: { classification?: string; isCompanyOwned: boolean; hasUrl: boolean; hasAuthor: boolean }): {
  trustLevel: SourceTrustLevel;
  reliabilityBand: SourceReliabilityBand;
  verificationStatus: SourceVerificationStatus;
  citationEligibility: CitationEligibility;
  evidenceStrength: number;
} {
  // Company-owned blogs and case studies are our highest-trust internal
  // sources. URL references with attributable authors come next. Free-form
  // notes / transcripts sit at moderate.
  if (input.classification === 'case_study') {
    return {
      trustLevel: 'high',
      reliabilityBand: 'high',
      verificationStatus: 'verified',
      citationEligibility: 'eligible',
      evidenceStrength: 82,
    };
  }
  if (input.classification === 'whitepaper' || input.classification === 'product_doc') {
    return {
      trustLevel: 'high',
      reliabilityBand: 'high',
      verificationStatus: 'verified',
      citationEligibility: 'eligible',
      evidenceStrength: 78,
    };
  }
  if (input.isCompanyOwned) {
    return {
      trustLevel: 'moderate',
      reliabilityBand: 'moderate',
      verificationStatus: 'verified',
      citationEligibility: 'eligible_with_attribution',
      evidenceStrength: 65,
    };
  }
  if (input.hasUrl && input.hasAuthor) {
    return {
      trustLevel: 'moderate',
      reliabilityBand: 'moderate',
      verificationStatus: 'verified',
      citationEligibility: 'eligible_with_attribution',
      evidenceStrength: 60,
    };
  }
  if (input.hasUrl) {
    return {
      trustLevel: 'moderate',
      reliabilityBand: 'moderate',
      verificationStatus: 'unverified',
      citationEligibility: 'eligible_with_attribution',
      evidenceStrength: 50,
    };
  }
  // Bare snippet, no URL, no attribution — usable but weakest.
  return {
    trustLevel: 'low',
    reliabilityBand: 'low',
    verificationStatus: 'unverified',
    citationEligibility: 'restricted',
    evidenceStrength: 35,
  };
}

// ── Builders ─────────────────────────────────────────────────────────────────

function buildSourceFromCompanyBlog(
  blog: CompanyOwnedBlogSource,
  maxFragmentsPerSource: number,
): KnowledgeSource {
  const trust = classifyTrust({ isCompanyOwned: true, hasUrl: Boolean(blog.url), hasAuthor: false });
  const id = stableId('src_blog', blog.id);
  const body = blog.content ?? blog.excerpt ?? blog.title;
  return {
    sourceId: id,
    sourceType: 'company_context' as SourceType,
    sourceOrigin: blog.url ?? `internal:blog:${blog.id}`,
    title: blog.title,
    excerpt: blog.excerpt,
    trustLevel: trust.trustLevel,
    freshnessMetadata: {
      publishedAt: blog.publishedAt,
      isStale: false,
    },
    verificationStatus: trust.verificationStatus,
    evidenceStrength: trust.evidenceStrength,
    citationEligibility: trust.citationEligibility,
    tags: blog.tags,
    contentFragments: fragmentsFromText(id, body, undefined, maxFragmentsPerSource),
  };
}

function buildSourceFromInternalUpload(
  doc: InternalUploadedDocument,
  maxFragmentsPerSource: number,
): KnowledgeSource {
  const trust = classifyTrust({
    classification: doc.classification,
    isCompanyOwned: true,
    hasUrl: Boolean(doc.url),
    hasAuthor: false,
  });
  const id = stableId('src_doc', doc.id);
  // Map our caller-friendly classification labels onto the canonical
  // SourceType enum used by the rest of the grounded layer.
  const sourceType: SourceType = 'uploaded_document';
  return {
    sourceId: id,
    sourceType,
    sourceOrigin: doc.url ?? `internal:doc:${doc.id}`,
    title: doc.title,
    excerpt: doc.body.slice(0, 180),
    trustLevel: trust.trustLevel,
    freshnessMetadata: {
      publishedAt: doc.publishedAt,
      retrievedAt: doc.uploadedAt,
      isStale: false,
    },
    verificationStatus: trust.verificationStatus,
    evidenceStrength: trust.evidenceStrength,
    citationEligibility: trust.citationEligibility,
    tags: doc.tags,
    contentFragments: fragmentsFromText(id, doc.body, undefined, maxFragmentsPerSource),
  };
}

function buildSourceFromApprovedUrl(
  ref: ApprovedUrlReference,
  maxFragmentsPerSource: number,
): KnowledgeSource {
  const trust = classifyTrust({ isCompanyOwned: false, hasUrl: true, hasAuthor: Boolean(ref.authorOrPublisher) });
  const id = stableId('src_url', `${ref.url}|${ref.title ?? ''}`);
  return {
    sourceId: id,
    sourceType: 'approved_url' as SourceType,
    sourceOrigin: ref.url,
    title: ref.title,
    excerpt: ref.excerpt,
    trustLevel: trust.trustLevel,
    freshnessMetadata: { isStale: false },
    verificationStatus: trust.verificationStatus,
    evidenceStrength: trust.evidenceStrength,
    citationEligibility: trust.citationEligibility,
    authorOrPublisher: ref.authorOrPublisher,
    contentFragments: ref.excerpt
      ? fragmentsFromText(id, ref.excerpt, ref.topicHint, maxFragmentsPerSource)
      : [],
  };
}

function buildSourceFromSnippet(
  snippet: ApprovedSnippet,
  maxFragmentsPerSource: number,
): KnowledgeSource {
  const trust = classifyTrust({ isCompanyOwned: false, hasUrl: false, hasAuthor: Boolean(snippet.attribution) });
  const id = stableId('src_snippet', snippet.id);
  return {
    sourceId: id,
    sourceType: 'internal_knowledge_block' as SourceType,
    sourceOrigin: snippet.attribution ?? 'internal:snippet',
    title: snippet.topicHint ?? `Snippet ${snippet.id}`,
    excerpt: snippet.text.slice(0, 180),
    trustLevel: trust.trustLevel,
    freshnessMetadata: { isStale: false },
    verificationStatus: trust.verificationStatus,
    evidenceStrength: trust.evidenceStrength,
    citationEligibility: trust.citationEligibility,
    authorOrPublisher: snippet.attribution,
    contentFragments: fragmentsFromText(id, snippet.text, snippet.topicHint, maxFragmentsPerSource),
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

export function buildGroundingProfile(input: BuildGroundingProfileInput): BuiltGroundingProfile {
  const maxFragments = input.maxFragmentsPerSource ?? 6;
  const sources: KnowledgeSource[] = [];

  for (const blog of input.companyBlogs ?? []) sources.push(buildSourceFromCompanyBlog(blog, maxFragments));
  for (const doc of input.internalUploads ?? []) sources.push(buildSourceFromInternalUpload(doc, maxFragments));
  for (const ref of input.approvedUrls ?? []) sources.push(buildSourceFromApprovedUrl(ref, maxFragments));
  for (const snip of input.approvedSnippets ?? []) sources.push(buildSourceFromSnippet(snip, maxFragments));

  // Source priority index — used by citation orchestration to prefer
  // exceptional/high sources over moderate/low.
  const sourcePriorityIndex: Record<SourceReliabilityBand, string[]> = {
    unreliable: [],
    low: [],
    moderate: [],
    high: [],
    exceptional: [],
  };
  const byTrustBand: Partial<Record<SourceReliabilityBand, number>> = {};
  for (const source of sources) {
    const band: SourceReliabilityBand =
      source.evidenceStrength >= 90 ? 'exceptional'
      : source.evidenceStrength >= 75 ? 'high'
      : source.evidenceStrength >= 55 ? 'moderate'
      : source.evidenceStrength >= 40 ? 'low'
      : 'unreliable';
    sourcePriorityIndex[band].push(source.sourceId);
    byTrustBand[band] = (byTrustBand[band] ?? 0) + 1;
  }

  // Factual anchors — surface high-evidence fragments as anchors the
  // section generator can be required to reference.
  const factualAnchors: FactualAnchor[] = [];
  for (const source of sources) {
    if (source.evidenceStrength < 60) continue;
    for (const frag of source.contentFragments.slice(0, 2)) {
      factualAnchors.push({
        anchorId: stableId('anc', frag.fragmentId),
        text: frag.text,
        sourceIds: [source.sourceId],
        topicHint: frag.topicHint,
      });
    }
  }

  // Strategic / operational references — flat passthroughs that downstream
  // composers may surface as inline supporting evidence. Uploaded documents
  // classified as case_study / whitepaper / product_doc all map to
  // `uploaded_document` in the canonical type system; we keep classification
  // info via the user-facing input but rely on evidenceStrength to triage
  // strategic vs operational use here.
  const strategicReferences: Array<{ text: string; sourceIds: string[] }> = sources
    .filter((s) => s.sourceType === 'uploaded_document' && s.evidenceStrength >= 78)
    .flatMap((s) => s.contentFragments.slice(0, 2).map((f) => ({ text: f.text, sourceIds: [s.sourceId] })));
  const operationalContext: Array<{ text: string; sourceIds: string[] }> = sources
    .filter((s) => s.sourceType === 'internal_knowledge_block' || (s.sourceType === 'uploaded_document' && s.evidenceStrength < 78))
    .flatMap((s) => s.contentFragments.slice(0, 2).map((f) => ({ text: f.text, sourceIds: [s.sourceId] })));

  const byType: Partial<Record<SourceType, number>> = {};
  let totalFragments = 0;
  for (const s of sources) {
    byType[s.sourceType] = (byType[s.sourceType] ?? 0) + 1;
    totalFragments += s.contentFragments.length;
  }

  const coverageNotes: string[] = [];
  if (sources.length === 0) coverageNotes.push('No grounding sources provided — citation orchestration will operate in dormant mode.');
  if ((input.companyBlogs?.length ?? 0) === 0) coverageNotes.push('No prior company blogs supplied — internal voice grounding limited.');
  if ((input.approvedUrls?.length ?? 0) === 0) coverageNotes.push('No approved URLs supplied — external evidence anchors unavailable.');
  if (factualAnchors.length === 0 && sources.length > 0) coverageNotes.push('No high-evidence anchors available — relax anchor requirement to "preferred".');

  const profile: RetrievalGroundingProfile = {
    retrievalProfileId: stableId('grp', `${input.recommendationId}|${Date.now()}`),
    recommendationId: input.recommendationId,
    approvedSources: sources,
    approvedTerminology: input.approvedTerminology ?? [],
    factualAnchors,
    strategicReferences,
    operationalContext,
    sourcePriorityIndex,
  };

  return {
    profile,
    diagnostics: {
      total_sources: sources.length,
      by_source_type: byType,
      by_trust_band: byTrustBand,
      total_fragments: totalFragments,
      total_anchors: factualAnchors.length,
      is_empty: sources.length === 0,
      coverage_notes: coverageNotes,
    },
  };
}
