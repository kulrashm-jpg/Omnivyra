/**
 * Recommendation feedback / outcome capture (append-only).
 *
 * Closes the STORAGE + MEASUREMENT half of the adaptive loop using the
 * existing append-only `audit_events` substrate (no new table, no migration
 * dependency — same pattern as durableOrchestrationStore). It records whether
 * a recommendation was accepted/dismissed/actioned and its observed outcome,
 * and reads back an acceptance/outcome aggregate.
 *
 * HONEST SCOPE: this makes recommendations *measurable and feedback-capable*.
 * It does NOT implement predictive ML or an automatic learning model — the
 * aggregate is exposed so a future model (or a human) can adapt; the current
 * recommendation engine remains deterministic + explainable.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';

export type FeedbackVerdict = 'accepted' | 'dismissed' | 'actioned' | 'ineffective';

export interface RecommendationFeedbackInput {
  companyId: string;
  recommendationId: string;
  category: string;
  verdict: FeedbackVerdict;
  actorUserId?: string | null;
  note?: string;
  /** Optional measured outcome after acting (e.g. confidence delta). */
  outcome?: Record<string, unknown>;
}

export interface FeedbackAggregate {
  companyId: string;
  generatedAt: string;
  available: boolean;
  total: number;
  byVerdict: Record<FeedbackVerdict, number>;
  acceptanceRate: number; // (accepted+actioned)/total, 0..1
  recentNotes: Array<{ at: string; recommendationId: string; verdict: string; note?: string }>;
  capabilityNote: string;
}

const RESOURCE = 'recommendation_feedback';

export async function recordRecommendationFeedback(
  input: RecommendationFeedbackInput,
): Promise<{ correlationId: string }> {
  return recordComplianceAudit({
    companyId: input.companyId,
    actor: { userId: input.actorUserId ?? null, type: input.actorUserId ? 'user' : 'system', label: 'recommendation-feedback' },
    action: `recommendation.${input.verdict}`,
    resourceType: RESOURCE,
    resourceId: input.recommendationId,
    entityLineage: ['company', 'recommendation', input.category, input.verdict],
    outcome: input.verdict === 'ineffective' ? 'failure' : 'success',
    detail: {
      recommendationId: input.recommendationId,
      category: input.category,
      verdict: input.verdict,
      note: input.note ?? null,
      measuredOutcome: input.outcome ?? null,
    },
  });
}

export async function getFeedbackAggregate(
  companyId: string,
  limit = 200,
): Promise<FeedbackAggregate> {
  const byVerdict: Record<FeedbackVerdict, number> = {
    accepted: 0, dismissed: 0, actioned: 0, ineffective: 0,
  };
  const recentNotes: FeedbackAggregate['recentNotes'] = [];
  let available = false;
  let total = 0;

  try {
    const { data, error } = await ownedDbTable('audit_events')
      .select('action, resource_id, metadata, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', RESOURCE)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!error && Array.isArray(data)) {
      available = true;
      for (const row of data as any[]) {
        const v = String((row.metadata ?? {}).verdict ?? '') as FeedbackVerdict;
        if (v in byVerdict) { byVerdict[v] += 1; total += 1; }
        if (recentNotes.length < 20) {
          recentNotes.push({
            at: row.created_at,
            recommendationId: String(row.resource_id ?? ''),
            verdict: v,
            note: (row.metadata ?? {}).note ?? undefined,
          });
        }
      }
    }
  } catch {
    available = false;
  }

  const acceptanceRate =
    total === 0 ? 0 : Number(((byVerdict.accepted + byVerdict.actioned) / total).toFixed(3));

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    available,
    total,
    byVerdict,
    acceptanceRate,
    recentNotes,
    capabilityNote:
      'Feedback is captured + aggregated (append-only audit). Predictive ML / automatic model retraining is NOT implemented — the aggregate is the adaptation input, not an active learner.',
  };
}
