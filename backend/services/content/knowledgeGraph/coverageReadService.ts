/**
 * B7.2 — COMPANY TOPIC COVERAGE READER.
 *
 * The counterpart to `coverageService.ts` (the writer). Until this module
 * existed, `company_topic_coverage` was WRITE-ONLY: the B7.10 producer in
 * contentService recorded what a company had covered and nothing in the
 * platform ever read it back, so the knowledge graph could not influence what
 * the company was advised to publish next.
 *
 * -- WHAT THIS RETURNS -------------------------------------------------------
 * The company's own covered topics, most-recently-covered first, each carrying
 * the canonical label from `platform_topic_node` and the coverage count the
 * writer maintains. Nothing is derived, scored, or inferred here — this is a
 * read, not an analysis.
 *
 * -- WHY THE SERVICE-ROLE CLIENT ---------------------------------------------
 * Same client the producers use (`backend/db/supabaseClient`, service role).
 * This is not a convenience:
 *   - `platform_topic_node` has RLS ENABLED WITH ZERO POLICIES (B7.1
 *     migration) — it is platform-owned and deliberately unreachable by any
 *     tenant JWT. An anon/user client returns zero label rows, always.
 *   - `company_topic_coverage` has a tenant RLS policy keyed on auth.uid(),
 *     but the caller here is a server-side service with no request JWT.
 * Because RLS is therefore NOT the tenant boundary on this path, the
 * `.eq('company_id', companyId)` filter below IS the boundary. It is applied
 * on the coverage query — the only query that touches tenant rows. The second
 * query reads `platform_topic_node`, which is platform-wide and carries no
 * company_id at all; it is constrained to the topic ids the FIRST, tenant-
 * filtered query already returned, so it cannot widen the tenant scope.
 *
 * -- WHY TWO QUERIES INSTEAD OF A POSTGREST EMBED ----------------------------
 * `company_topic_coverage.topic_id` is a SOFT reference (see the B7.1
 * migration: "soft ref -> platform_topic_node.id"); there is no FK constraint,
 * so PostgREST cannot resolve a `platform_topic_node(canonical_label)` embed.
 * Two bounded queries is the correct shape, not a workaround.
 *
 * -- NEVER THROWS ------------------------------------------------------------
 * Consumers of this reader are enrichment paths (today: the "Suggest with AI"
 * brief). A graph read must never be able to fail the thing the user actually
 * asked for. Every failure returns an empty list AND emits a counter, so
 * "contained" never becomes "invisible" and an empty result is never mistaken
 * for a healthy read.
 */

import { supabase } from '../../../db/supabaseClient';
import { recordRawCounter } from '../../../observability';
import { isPlatformKnowledgeGraphEnabled } from './topicResolutionService';

const COVERAGE_TABLE = 'company_topic_coverage';
const TOPIC_TABLE = 'platform_topic_node';

/** Bounded by default: this feeds a prompt, not a report. */
export const DEFAULT_COVERAGE_READ_LIMIT = 8;
const MAX_COVERAGE_READ_LIMIT = 50;

export interface CompanyTopicCoverageEntry {
  topicId: string;
  /** Canonical label from platform_topic_node. Never synthesised. */
  label: string;
  coverageCount: number;
  lastCoveredAt: string | null;
  /** NULL until B7.3 owns angle extraction. Passed through, never guessed. */
  angleLabel: string | null;
}

type CoverageRow = {
  topic_id?: string | null;
  coverage_count?: number | null;
  last_covered_at?: string | null;
  angle_label?: string | null;
};

type TopicRow = { id?: string | null; canonical_label?: string | null };

/**
 * Read one company's topic coverage, labelled.
 *
 * Returns [] for: the flag being off, a missing companyId, no coverage rows,
 * an unreadable table, or coverage rows whose topic identity has disappeared.
 * Each of those is a DIFFERENT counter — the caller only needs to know the
 * list is empty, but an operator needs to know which emptiness this was.
 */
export async function readCompanyTopicCoverage(
  companyId: string,
  options: { limit?: number } = {},
): Promise<CompanyTopicCoverageEntry[]> {
  // Same flag as the producer. Gating the read on it keeps the whole B7.10
  // path reversible with one env change: turn the graph off and nothing reads
  // OR writes it. A reader on a flag of its own would make "off" ambiguous.
  if (!isPlatformKnowledgeGraphEnabled()) {
    recordRawCounter('content.knowledge_graph.read_disabled', 1);
    return [];
  }

  const tenant = typeof companyId === 'string' ? companyId.trim() : '';
  if (!tenant) {
    // Without a tenant there is no safe query to make. Returning [] rather
    // than querying unscoped is the entire point of this guard.
    recordRawCounter('content.knowledge_graph.read_missing_company', 1);
    return [];
  }

  const limit = Math.min(
    Math.max(1, Math.trunc(Number(options.limit) || DEFAULT_COVERAGE_READ_LIMIT)),
    MAX_COVERAGE_READ_LIMIT,
  );

  try {
    // -- 1. Tenant rows. `.eq('company_id', ...)` IS the tenant boundary. ----
    const { data: coverageData, error: coverageError } = await supabase
      .from(COVERAGE_TABLE)
      .select('topic_id, coverage_count, last_covered_at, angle_label')
      .eq('company_id', tenant)
      .order('last_covered_at', { ascending: false })
      .limit(limit);

    if (coverageError) {
      recordRawCounter('content.knowledge_graph.read_failed', 1);
      return [];
    }

    const rows = (Array.isArray(coverageData) ? coverageData : []) as CoverageRow[];
    const scoped = rows.filter((row) => typeof row?.topic_id === 'string' && row.topic_id);
    if (scoped.length === 0) {
      recordRawCounter('content.knowledge_graph.read_empty', 1);
      return [];
    }

    // -- 2. Platform labels for exactly those ids, and no others. -----------
    const topicIds = Array.from(new Set(scoped.map((row) => String(row.topic_id))));
    const { data: topicData, error: topicError } = await supabase
      .from(TOPIC_TABLE)
      .select('id, canonical_label')
      .in('id', topicIds);

    if (topicError) {
      // Coverage without labels is unusable: a topic id is not something a
      // prompt can say. Degrade to empty rather than emit raw uuids.
      recordRawCounter('content.knowledge_graph.read_label_failed', 1);
      return [];
    }

    const labelById = new Map<string, string>();
    for (const topic of (Array.isArray(topicData) ? topicData : []) as TopicRow[]) {
      const id = typeof topic?.id === 'string' ? topic.id : '';
      const label = typeof topic?.canonical_label === 'string' ? topic.canonical_label.trim() : '';
      if (id && label) labelById.set(id, label);
    }

    const entries: CompanyTopicCoverageEntry[] = [];
    let unlabelled = 0;
    for (const row of scoped) {
      const topicId = String(row.topic_id);
      const label = labelById.get(topicId);
      if (!label) {
        // The identity was deleted or is unreadable. Dropping it is the honest
        // outcome — a label is never invented from the id.
        unlabelled += 1;
        continue;
      }
      entries.push({
        topicId,
        label,
        coverageCount: Number(row.coverage_count ?? 1) || 1,
        lastCoveredAt: typeof row.last_covered_at === 'string' ? row.last_covered_at : null,
        angleLabel: typeof row.angle_label === 'string' && row.angle_label.trim()
          ? row.angle_label.trim()
          : null,
      });
    }

    if (unlabelled > 0) recordRawCounter('content.knowledge_graph.read_unlabelled', unlabelled);
    if (entries.length === 0) recordRawCounter('content.knowledge_graph.read_empty', 1);
    return entries;
  } catch {
    recordRawCounter('content.knowledge_graph.read_error', 1);
    return [];
  }
}
