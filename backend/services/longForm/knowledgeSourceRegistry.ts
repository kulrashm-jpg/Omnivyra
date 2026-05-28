/**
 * Phase 1 — Knowledge source registry.
 *
 * In-memory store of `KnowledgeSource` records. Real-world callers will fill
 * it with company-context, uploaded documents, approved URLs, internal
 * knowledge blocks, etc. Tests use synthetic sources.
 *
 * Helpers:
 *   - `createKnowledgeSourceRegistry()` — fresh instance.
 *   - `getDefaultKnowledgeSourceRegistry()` — swappable singleton.
 *   - `deriveFreshness()` — utility to compute `SourceFreshnessMetadata`.
 *   - `makeKnowledgeSource()` — convenience builder with sensible defaults.
 */

import type {
  KnowledgeSource,
  KnowledgeSourceFragment,
  SourceFreshnessMetadata,
  SourceType,
  SourceTrustLevel,
  SourceVerificationStatus,
  CitationEligibility,
} from './longFormRecommendationTypes';

const DEFAULT_STALE_AFTER_DAYS_BY_TYPE: Record<SourceType, number | undefined> = {
  company_context: undefined,             // company context doesn't go stale automatically
  uploaded_document: 365,
  approved_url: 180,
  internal_knowledge_block: 365,
  research_reference: 730,
  planner_derived_evidence: 30,
  verified_citation: 180,
  retrieved_web_evidence: 60,
};

export function deriveFreshness(input: {
  publishedAt?: string;
  retrievedAt?: string;
  staleAfterDays?: number;
  sourceType?: SourceType;
}): SourceFreshnessMetadata {
  const reference = input.publishedAt ?? input.retrievedAt;
  const now = Date.now();
  const ageInDays = reference
    ? Math.max(0, Math.floor((now - Date.parse(reference)) / (1000 * 60 * 60 * 24)))
    : undefined;
  const staleAfterDays = input.staleAfterDays
    ?? (input.sourceType ? DEFAULT_STALE_AFTER_DAYS_BY_TYPE[input.sourceType] : undefined);
  const isStale = staleAfterDays != null && ageInDays != null && ageInDays > staleAfterDays;
  return {
    publishedAt: input.publishedAt,
    retrievedAt: input.retrievedAt,
    ageInDays,
    staleAfterDays,
    isStale,
  };
}

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

export interface MakeKnowledgeSourceInput {
  sourceType: SourceType;
  sourceOrigin: string;
  title?: string;
  excerpt?: string;
  trustLevel?: SourceTrustLevel;
  verificationStatus?: SourceVerificationStatus;
  evidenceStrength?: number;
  citationEligibility?: CitationEligibility;
  authorOrPublisher?: string;
  tags?: string[];
  contentFragments?: Array<Omit<KnowledgeSourceFragment, 'fragmentId'> & { fragmentId?: string }>;
  publishedAt?: string;
  retrievedAt?: string;
  staleAfterDays?: number;
  /** Override sourceId; default derives from origin hash. */
  sourceId?: string;
}

export function makeKnowledgeSource(input: MakeKnowledgeSourceInput): KnowledgeSource {
  const sourceId = input.sourceId ?? `src_${input.sourceType}_${stableHash(input.sourceOrigin).slice(0, 10)}`;
  const fragments: KnowledgeSourceFragment[] = (input.contentFragments ?? []).map((frag, i) => ({
    fragmentId: frag.fragmentId ?? `frg_${sourceId.slice(-8)}_${i.toString(36)}`,
    text: frag.text,
    topicHint: frag.topicHint,
    numericClaim: frag.numericClaim,
  }));
  return {
    sourceId,
    sourceType: input.sourceType,
    sourceOrigin: input.sourceOrigin,
    title: input.title,
    excerpt: input.excerpt,
    trustLevel: input.trustLevel ?? defaultTrustLevelFor(input.sourceType),
    freshnessMetadata: deriveFreshness({
      publishedAt: input.publishedAt,
      retrievedAt: input.retrievedAt,
      staleAfterDays: input.staleAfterDays,
      sourceType: input.sourceType,
    }),
    verificationStatus: input.verificationStatus ?? defaultVerificationFor(input.sourceType),
    evidenceStrength: input.evidenceStrength ?? defaultEvidenceStrengthFor(input.sourceType),
    citationEligibility: input.citationEligibility ?? defaultCitationEligibilityFor(input.sourceType),
    authorOrPublisher: input.authorOrPublisher,
    tags: input.tags,
    contentFragments: fragments,
  };
}

function defaultTrustLevelFor(type: SourceType): SourceTrustLevel {
  switch (type) {
    case 'company_context': return 'authoritative';
    case 'uploaded_document':
    case 'verified_citation':
    case 'internal_knowledge_block': return 'high';
    case 'research_reference': return 'high';
    case 'approved_url': return 'moderate';
    case 'planner_derived_evidence': return 'moderate';
    case 'retrieved_web_evidence': return 'low';
  }
}

function defaultVerificationFor(type: SourceType): SourceVerificationStatus {
  if (type === 'company_context' || type === 'verified_citation') return 'verified';
  if (type === 'uploaded_document' || type === 'approved_url' || type === 'internal_knowledge_block') return 'reviewed';
  return 'unverified';
}

function defaultEvidenceStrengthFor(type: SourceType): number {
  switch (type) {
    case 'company_context': return 90;
    case 'verified_citation': return 88;
    case 'uploaded_document': return 78;
    case 'internal_knowledge_block': return 78;
    case 'research_reference': return 80;
    case 'approved_url': return 65;
    case 'planner_derived_evidence': return 55;
    case 'retrieved_web_evidence': return 45;
  }
}

function defaultCitationEligibilityFor(type: SourceType): CitationEligibility {
  switch (type) {
    case 'company_context': return 'eligible_with_attribution';
    case 'verified_citation':
    case 'research_reference':
    case 'approved_url':
    case 'uploaded_document':
    case 'internal_knowledge_block': return 'eligible';
    case 'planner_derived_evidence': return 'restricted';
    case 'retrieved_web_evidence': return 'eligible_with_attribution';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Registry
// ────────────────────────────────────────────────────────────────────────────

export interface KnowledgeSourceRegistry {
  register(source: KnowledgeSource): void;
  registerMany(sources: KnowledgeSource[]): void;
  get(sourceId: string): KnowledgeSource | null;
  list(): KnowledgeSource[];
  /** Lookup by tag — used by retrieval layer to fetch topic-relevant sources. */
  findByTag(tag: string): KnowledgeSource[];
  /** Fuzzy text lookup over content fragments. */
  searchFragments(query: string, limit?: number): Array<{ source: KnowledgeSource; fragment: KnowledgeSourceFragment; score: number }>;
  clear(): void;
  size(): number;
}

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','for','with','by','at','is','are',
  'be','as','from','that','this','these','those','it','its','can','should','would','will',
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    if (t.length > 2 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter += 1; });
  return inter / (a.size + b.size - inter);
}

export function createKnowledgeSourceRegistry(): KnowledgeSourceRegistry {
  const byId = new Map<string, KnowledgeSource>();

  return {
    register(source) {
      byId.set(source.sourceId, source);
    },
    registerMany(sources) {
      for (const s of sources) byId.set(s.sourceId, s);
    },
    get(sourceId) {
      return byId.get(sourceId) ?? null;
    },
    list() {
      return Array.from(byId.values());
    },
    findByTag(tag) {
      const lower = tag.toLowerCase();
      return this.list().filter((s) => (s.tags ?? []).some((t) => t.toLowerCase() === lower));
    },
    searchFragments(query, limit = 10) {
      const q = tokens(query);
      const results: Array<{ source: KnowledgeSource; fragment: KnowledgeSourceFragment; score: number }> = [];
      for (const source of this.list()) {
        for (const fragment of source.contentFragments) {
          const score = jaccard(q, tokens(fragment.text));
          if (score >= 0.05) results.push({ source, fragment, score });
        }
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, limit);
    },
    clear() {
      byId.clear();
    },
    size() {
      return byId.size;
    },
  };
}

let _defaultRegistry: KnowledgeSourceRegistry | null = null;

export function getDefaultKnowledgeSourceRegistry(): KnowledgeSourceRegistry {
  if (!_defaultRegistry) _defaultRegistry = createKnowledgeSourceRegistry();
  return _defaultRegistry;
}

export function setDefaultKnowledgeSourceRegistry(reg: KnowledgeSourceRegistry): void {
  _defaultRegistry = reg;
}
