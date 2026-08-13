/**
 * B7.2 — COMPANY TOPIC COVERAGE WRITER.
 *
 * Records what a company has covered, against a canonical platform topic
 * identity resolved by topicResolutionService. Company-scoped: every write
 * carries company_id and is governed by the B7.1 RLS policy
 * (user_company_roles … status='active'), which was proven behaviourally
 * against real non-superuser roles in the B7.1 rehearsal.
 *
 * ── IDEMPOTENT EXPANSION ───────────────────────────────────────────────────
 * UNIQUE (company_id, topic_id, angle_label) NULLS NOT DISTINCT is the
 * serialization boundary. Re-covering the same (company, topic, angle)
 * INCREMENTS coverage_count; it never inserts a second row. A DIFFERENT angle
 * on the same topic is a distinct row, by design.
 *
 * ── WHAT THIS MODULE NEVER FABRICATES ──────────────────────────────────────
 *   · angle_label — B7.1 deferred extraction to B7.3, and
 *     content_memory.intelligence.narratives has never been evaluated for
 *     cross-artifact comparability. Absent ⇒ NULL, never guessed.
 *   · campaign_id — carried through when the artifact already has one,
 *     otherwise NULL. A campaign is NEVER inferred from topic similarity, and
 *     this module never creates one.
 *   · content_id — carried through, never invented.
 *
 * NEVER THROWS: coverage is knowledge enrichment, not a gate on acceptance.
 */

import { supabase } from '../../../db/supabaseClient';
import type { KnowledgeConfidence, KnowledgeState } from './topicResolutionService';

const TABLE = 'company_topic_coverage';

export interface RecordCoverageInput {
  companyId: string;
  topicId: string;
  contentId?: string | null;
  campaignId?: string | null;
  /** B7.3 owns extraction. Callers MUST NOT synthesise this. */
  angleLabel?: string | null;
  state?: KnowledgeState;
  confidence?: KnowledgeConfidence;
  source?: string;
}

export type CoverageOutcome =
  | { ok: true; action: 'created' | 'incremented'; coverageCount: number }
  | { ok: false; reason: string };

/**
 * Record one coverage contribution.
 *
 * Read-then-write rather than a blind upsert: the increment must be computed
 * from the current value, and the unique index guarantees that a concurrent
 * peer cannot create a duplicate — the loser falls through to the increment
 * branch on retry. Returns a typed outcome; never throws.
 */
export async function recordTopicCoverage(
  input: RecordCoverageInput,
): Promise<CoverageOutcome> {
  if (!input.companyId) return { ok: false, reason: 'missing_company_id' };
  if (!input.topicId) return { ok: false, reason: 'missing_topic_id' };

  const angle = input.angleLabel ?? null;   // never fabricated
  const nowIso = new Date().toISOString();

  try {
    // Existing row for this exact (company, topic, angle)?
    let query = supabase
      .from(TABLE)
      .select('id, coverage_count')
      .eq('company_id', input.companyId)
      .eq('topic_id', input.topicId);
    // `null` is a meaningful value here (the un-angled row), and NULLS NOT
    // DISTINCT makes it collide with itself — so it must be matched with IS
    // NULL, not `= null`.
    query = angle === null ? query.is('angle_label', null) : query.eq('angle_label', angle);

    const { data: existing, error: readError } = await query.maybeSingle();
    if (readError) return { ok: false, reason: `read_failed:${readError.message}` };

    if (existing && (existing as { id?: string }).id) {
      const prior = Number((existing as { coverage_count?: number }).coverage_count ?? 1);
      const next = prior + 1;
      const { error } = await supabase
        .from(TABLE)
        .update({ coverage_count: next, last_covered_at: nowIso })
        .eq('id', (existing as { id: string }).id);
      return error
        ? { ok: false, reason: `increment_failed:${error.message}` }
        : { ok: true, action: 'incremented', coverageCount: next };
    }

    const { error: insertError } = await supabase.from(TABLE).insert({
      company_id: input.companyId,
      topic_id: input.topicId,
      content_id: input.contentId ?? null,
      campaign_id: input.campaignId ?? null,   // preserved, never inferred
      angle_label: angle,                      // NULL until B7.3
      coverage_count: 1,
      first_covered_at: nowIso,
      last_covered_at: nowIso,
      // Coverage is a deterministic MEASUREMENT, so 'observed' — never
      // 'inferred' (nothing was inferred) and never 'confirmed' (no curation).
      state: input.state ?? 'observed',
      confidence: input.confidence ?? 'none',
      source: input.source ?? 'content_acceptance',
    });

    if (!insertError) return { ok: true, action: 'created', coverageCount: 1 };

    // Lost a concurrent insert race — the unique index held. Re-read and
    // increment, so concurrency converges on one row rather than failing.
    let retry = supabase
      .from(TABLE)
      .select('id, coverage_count')
      .eq('company_id', input.companyId)
      .eq('topic_id', input.topicId);
    retry = angle === null ? retry.is('angle_label', null) : retry.eq('angle_label', angle);
    const { data: raced } = await retry.maybeSingle();

    if (raced && (raced as { id?: string }).id) {
      const prior = Number((raced as { coverage_count?: number }).coverage_count ?? 1);
      const next = prior + 1;
      const { error } = await supabase
        .from(TABLE)
        .update({ coverage_count: next, last_covered_at: nowIso })
        .eq('id', (raced as { id: string }).id);
      return error
        ? { ok: false, reason: `race_increment_failed:${error.message}` }
        : { ok: true, action: 'incremented', coverageCount: next };
    }

    return { ok: false, reason: `insert_failed:${insertError.message}` };
  } catch (e) {
    return { ok: false, reason: `coverage_exception:${(e as Error)?.message ?? 'unknown'}` };
  }
}
