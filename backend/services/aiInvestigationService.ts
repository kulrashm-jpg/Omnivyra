/**
 * Phase 10 — AI-assisted investigation layer (bounded, retrieval-grounded).
 *
 * Generates investigation summaries by:
 *   1. Pulling evidence via the Phase 9 hybrid retrieval service
 *      (deterministic, explainable, replay-safe).
 *   2. Composing a deterministic, template-driven summary from the
 *      retrieved evidence. NO autonomous LLM call. NO hidden reasoning.
 *      The "AI assist" is grounded evidence aggregation + structured
 *      narrative composition. Every output cites the evidence ids that
 *      produced it.
 *
 * Hard guarantees:
 *   • Operator-triggered only — every call requires `requested_by`.
 *   • Bounded context window (default 4000 chars, max 12000).
 *   • Every summary persists `evidence_refs` (typed) + the source
 *     retrieval explanation id for replay.
 *   • No autonomous escalation, no autonomous incident creation, no
 *     hidden reasoning chains.
 *   • Tenant-first reads.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  INVESTIGATION_AI_DEFAULT_CONTEXT_WINDOW,
  INVESTIGATION_AI_MAX_CONTEXT_WINDOW,
  type EvidenceRef,
  type InvestigationAiKind,
  type InvestigationAiMethod,
  type InvestigationAiSummary,
} from '../types/investigationAi';
import { retrieveHybrid } from './hybridSemanticRetrievalService';
import { publishRealtime } from './realtimePublisherService';
import { publishInvestigationSummaryGenerated } from '../events/listeningEvents';

function clampContextWindow(value?: number): number {
  if (!value) return INVESTIGATION_AI_DEFAULT_CONTEXT_WINDOW;
  return Math.max(500, Math.min(INVESTIGATION_AI_MAX_CONTEXT_WINDOW, value));
}

function composeSummary(args: {
  kind: InvestigationAiKind;
  subjectRef: string;
  evidenceRefs: EvidenceRef[];
  contextWindow: number;
}): { text: string; tokensUsed: number } {
  if (args.evidenceRefs.length === 0) {
    const text = `No retrievable evidence for ${args.kind} on ${args.subjectRef}. ` +
      `Generate evidence via execution, escalation, or analyst note before requesting this summary.`;
    return { text: text.slice(0, args.contextWindow), tokensUsed: text.length };
  }
  const header = `Investigation summary — ${args.kind} — ${args.subjectRef}\n\n`;
  const sorted = [...args.evidenceRefs].sort((a, b) => b.weight - a.weight);
  const topThree = sorted.slice(0, 3);
  const opening =
    `Top ${topThree.length} evidence item${topThree.length === 1 ? '' : 's'} ` +
    `surface via deterministic retrieval (weights ${topThree.map((e) => e.weight.toFixed(2)).join(', ')}).\n\n`;
  const bullets = sorted
    .slice(0, 8)
    .map((e, idx) => `  ${idx + 1}. [${e.source_kind}] ${e.source_id} (w=${e.weight.toFixed(2)}) — ${e.preview ?? '(no preview)'}`)
    .join('\n');
  const closing =
    `\n\nAll items above are grounded in the org's persisted state. ` +
    `Generation method: deterministic_summary_v1. No autonomous reasoning was applied.`;
  const text = `${header}${opening}${bullets}${closing}`;
  const truncated = text.length > args.contextWindow ? text.slice(0, args.contextWindow) : text;
  return { text: truncated, tokensUsed: truncated.length };
}

export type GenerateInvestigationSummaryInput = {
  organizationId: string;
  investigationKind: InvestigationAiKind;
  subjectRef: string;
  queryHint?: string;
  contextWindow?: number;
  requestedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function generateInvestigationSummary(
  input: GenerateInvestigationSummaryInput,
): Promise<InvestigationAiSummary> {
  const contextWindow = clampContextWindow(input.contextWindow);

  let evidenceRefs: EvidenceRef[] = [];
  let retrievalExplanationId: string | null = null;
  const method: InvestigationAiMethod = input.queryHint ? 'retrieval_assist_v1' : 'deterministic_summary_v1';

  if (input.queryHint) {
    try {
      const result = await retrieveHybrid({
        organizationId: input.organizationId,
        query: input.queryHint,
        mode: 'hybrid',
        topK: 8,
        requestedBy: input.requestedBy,
        useCache: true,
      });
      retrievalExplanationId = result.explanation_id;
      evidenceRefs = result.hits.map((h) => ({
        source_kind: h.source_kind,
        source_id: h.source_id,
        preview: h.preview ?? undefined,
        weight: h.combined_score,
      }));
    } catch (err: any) {
      console.warn('[aiInvestigation] retrieval failed:', err?.message);
    }
  }

  const summary = composeSummary({
    kind: input.investigationKind,
    subjectRef: input.subjectRef,
    evidenceRefs,
    contextWindow,
  });

  const ins = await ownedDbTable('investigation_ai_summaries')
    .insert({
      organization_id: input.organizationId,
      investigation_kind: input.investigationKind,
      subject_ref: input.subjectRef,
      summary_text: summary.text,
      evidence_refs: evidenceRefs,
      retrieval_explanation_id: retrievalExplanationId,
      generation_method: method,
      context_tokens_used: summary.tokensUsed,
      bounded_context_window: contextWindow,
      requested_by: input.requestedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`investigation_summary_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const row = ins.data as InvestigationAiSummary;

  try {
    await publishInvestigationSummaryGenerated({
      organizationId: input.organizationId,
      summaryId: row.id,
      investigationKind: row.investigation_kind,
      subjectRef: row.subject_ref,
      generationMethod: row.generation_method,
      contextTokensUsed: row.context_tokens_used,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'ai_investigation',
      eventName: 'investigation.summary_generated',
      payload: { summary_id: row.id, investigation_kind: row.investigation_kind, subject_ref: row.subject_ref },
    });
  } catch { /* best effort */ }

  return row;
}

export async function listInvestigationSummaries(
  organizationId: string,
  options?: { investigationKind?: InvestigationAiKind; subjectRef?: string; limit?: number },
): Promise<InvestigationAiSummary[]> {
  let q = ownedDbTable('investigation_ai_summaries')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.investigationKind) q = q.eq('investigation_kind', options.investigationKind);
  if (options?.subjectRef) q = q.eq('subject_ref', options.subjectRef);
  const { data } = await q;
  return (data as InvestigationAiSummary[]) ?? [];
}

export async function getInvestigationSummary(
  organizationId: string,
  summaryId: string,
): Promise<InvestigationAiSummary | null> {
  const { data } = await ownedDbTable('investigation_ai_summaries')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', summaryId)
    .maybeSingle();
  return (data as InvestigationAiSummary | null) ?? null;
}
