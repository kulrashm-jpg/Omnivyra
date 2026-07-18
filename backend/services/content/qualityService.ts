/**
 * Quality Service — WRITER-EXEC-005 Wave 4 (item 2). Persists + reads the
 * deterministic quality scorecard to/from `content_quality`.
 *
 * Uses the shared service-role client (RLS-bypassing) so EVERY query is
 * explicitly company-scoped. Rows are snake_case; callers see camelCase DTOs.
 * Fail-safe: writes/reads never throw — a failure logs and returns null.
 *
 * See supabase/migrations/20260718000002_content_quality_collaboration.sql.
 * QualityScorecard contract is mirrored in recommendationRuntime.ts pending the
 * canonical lib/content/quality/types.ts (WAVE4-TODO: re-point when it lands).
 */

import { supabase } from '../../db/supabaseClient';
import type { QualityScorecard } from './recommendationRuntime';

const QUALITY_TABLE = 'content_quality';

export interface PersistedScorecard {
  id: string;
  companyId: string;
  contentId: string | null;
  overallScore: number | null;
  dimensions: Record<string, unknown>;
  evaluatedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(row: any): PersistedScorecard {
  return {
    id: row.id,
    companyId: row.company_id,
    contentId: row.content_id ?? null,
    overallScore: row.overall_score ?? null,
    dimensions: (row.dimensions ?? {}) as Record<string, unknown>,
    evaluatedAt: row.evaluated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function dimScore(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object') {
    const s = (v as { score?: unknown }).score;
    if (typeof s === 'number' && Number.isFinite(s)) return s;
  }
  return null;
}

/** overallScore if provided, else the mean of numeric dimension scores. */
function resolveOverall(scorecard: QualityScorecard): number | null {
  if (typeof scorecard.overallScore === 'number' && Number.isFinite(scorecard.overallScore)) {
    return scorecard.overallScore;
  }
  const scores = Object.values(scorecard?.dimensions ?? {})
    .map(dimScore)
    .filter((n): n is number => n != null);
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export interface PersistScorecardInput {
  companyId: string;
  contentId?: string | null;
  scorecard: QualityScorecard;
}

/**
 * Insert a scorecard snapshot (append-only history; the newest wins on read).
 * Returns the persisted DTO, or null on any failure.
 */
export async function persistScorecard(
  input: PersistScorecardInput,
): Promise<PersistedScorecard | null> {
  try {
    if (!input?.companyId || !input?.scorecard) return null;
    const row = {
      company_id: input.companyId,
      content_id: input.contentId ?? null,
      overall_score: resolveOverall(input.scorecard),
      dimensions: input.scorecard.dimensions ?? {},
    };
    const { data, error } = await supabase
      .from(QUALITY_TABLE)
      .insert(row)
      .select('*')
      .single();
    if (error || !data) {
      console.warn('[qualityService] persistScorecard failed:', error?.message);
      return null;
    }
    return mapRow(data);
  } catch (e) {
    console.warn('[qualityService] persistScorecard threw:', (e as Error)?.message);
    return null;
  }
}

/** Fetch the most recent scorecard for a content row (company-scoped), or null. */
export async function getScorecard(
  contentId: string,
  companyId: string,
): Promise<PersistedScorecard | null> {
  try {
    if (!contentId || !companyId) return null;
    const { data, error } = await supabase
      .from(QUALITY_TABLE)
      .select('*')
      .eq('content_id', contentId)
      .eq('company_id', companyId)
      .order('evaluated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('[qualityService] getScorecard failed:', error.message);
      return null;
    }
    return data ? mapRow(data) : null;
  } catch (e) {
    console.warn('[qualityService] getScorecard threw:', (e as Error)?.message);
    return null;
  }
}
