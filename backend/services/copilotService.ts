/**
 * Phase 11 — Bounded AI co-pilot assistance.
 *
 * Operator-triggered, evidence-grounded, deterministic prose composition.
 * Optionally pulls retrieved evidence via the Phase 9 hybrid retrieval
 * surface so every co-pilot output cites its sources. NO autonomous LLM
 * call; NO hidden chain-of-thought persistence (the optional
 * `reasoning_summary` is a one-paragraph, evidence-linked rationale,
 * never internal scratchpad).
 *
 * Hard guarantees:
 *   • Every response requires `requested_by`.
 *   • Bounded prompt length (4000 chars) + bounded context window
 *     (default 4000, max 12000).
 *   • Every response persists `evidence_refs` + retrieval explanation id.
 *   • Generation method is one of two deterministic templates.
 *   • Tenant-first reads.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  COPILOT_DEFAULT_CONTEXT_WINDOW,
  COPILOT_MAX_CONTEXT_WINDOW,
  COPILOT_MAX_PROMPT_LENGTH,
  type CopilotEvidenceRef,
  type CopilotGenerationMethod,
  type CopilotIntent,
  type CopilotResponse,
} from '../types/copilot';
import { retrieveHybrid } from './hybridSemanticRetrievalService';
import { publishRealtime } from './realtimePublisherService';
import { publishCopilotResponseGenerated } from '../events/listeningEvents';

function clampContextWindow(value?: number): number {
  if (!value) return COPILOT_DEFAULT_CONTEXT_WINDOW;
  return Math.max(500, Math.min(COPILOT_MAX_CONTEXT_WINDOW, value));
}

function composeResponse(args: {
  intent: CopilotIntent;
  subjectRef: string;
  prompt: string;
  evidence: CopilotEvidenceRef[];
  contextWindow: number;
}): { text: string; reasoningSummary: string; tokensUsed: number } {
  const intentLabel = args.intent.replace(/_/g, ' ');
  const header = `Copilot ${intentLabel} — subject: ${args.subjectRef}\n\nPrompt:\n${args.prompt.slice(0, 1000)}\n\n`;
  if (args.evidence.length === 0) {
    const text =
      `${header}No retrievable evidence is available for this subject yet. ` +
      `Generate evidence (execution, escalation, retrieval cache, analyst note) before requesting this output.\n` +
      `Generation: deterministic_copilot_v1 · No autonomous reasoning was applied.`;
    return { text: text.slice(0, args.contextWindow), reasoningSummary: 'no evidence available', tokensUsed: text.length };
  }
  const sorted = [...args.evidence].sort((a, b) => b.weight - a.weight);
  const top = sorted.slice(0, 8);
  const bullets = top
    .map((e, idx) => `  ${idx + 1}. [${e.source_kind}] ${e.source_id} (w=${e.weight.toFixed(2)}) — ${e.preview ?? '(no preview)'}`)
    .join('\n');
  const reasoning =
    `Top ${top.length} evidence items by combined retrieval score support this output. ` +
    `Weights ${top.map((e) => e.weight.toFixed(2)).join(', ')}. ` +
    `Composition is deterministic; no chain-of-thought is persisted beyond this single-paragraph rationale.`;
  const text =
    `${header}Evidence (sorted by weight):\n${bullets}\n\n` +
    `Reasoning summary:\n${reasoning}\n\n` +
    `Generation: retrieval_grounded_v1 · No autonomous decisions, no autonomous escalations, no hidden reasoning chains.`;
  const truncated = text.length > args.contextWindow ? text.slice(0, args.contextWindow) : text;
  return { text: truncated, reasoningSummary: reasoning, tokensUsed: truncated.length };
}

export type GenerateCopilotResponseInput = {
  organizationId: string;
  copilotIntent: CopilotIntent;
  subjectRef: string;
  prompt: string;
  queryHint?: string;
  contextWindow?: number;
  requestedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function generateCopilotResponse(input: GenerateCopilotResponseInput): Promise<CopilotResponse> {
  const prompt = (input.prompt ?? '').slice(0, COPILOT_MAX_PROMPT_LENGTH);
  if (prompt.trim().length === 0) throw new Error('copilot_prompt_required');
  const contextWindow = clampContextWindow(input.contextWindow);

  let evidence: CopilotEvidenceRef[] = [];
  let retrievalExplanationId: string | null = null;
  const method: CopilotGenerationMethod = input.queryHint ? 'retrieval_grounded_v1' : 'deterministic_copilot_v1';
  if (input.queryHint) {
    try {
      const r = await retrieveHybrid({
        organizationId: input.organizationId,
        query: input.queryHint,
        mode: 'hybrid',
        topK: 8,
        requestedBy: input.requestedBy,
        useCache: true,
      });
      retrievalExplanationId = r.explanation_id;
      evidence = r.hits.map((h) => ({
        source_kind: h.source_kind,
        source_id: h.source_id,
        weight: h.combined_score,
        preview: h.preview ?? undefined,
      }));
    } catch (err: any) {
      console.warn('[copilot] retrieval failed:', err?.message);
    }
  }

  const composed = composeResponse({
    intent: input.copilotIntent,
    subjectRef: input.subjectRef,
    prompt,
    evidence,
    contextWindow,
  });

  const ins = await ownedDbTable('copilot_responses')
    .insert({
      organization_id: input.organizationId,
      copilot_intent: input.copilotIntent,
      subject_ref: input.subjectRef,
      prompt_text: prompt,
      response_text: composed.text,
      evidence_refs: evidence,
      retrieval_explanation_id: retrievalExplanationId,
      reasoning_summary: composed.reasoningSummary,
      context_tokens_used: composed.tokensUsed,
      bounded_context_window: contextWindow,
      generation_method: method,
      requested_by: input.requestedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`copilot_response_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const row = ins.data as CopilotResponse;

  try {
    await publishCopilotResponseGenerated({
      organizationId: input.organizationId,
      responseId: row.id,
      copilotIntent: row.copilot_intent,
      subjectRef: row.subject_ref,
      contextTokensUsed: row.context_tokens_used,
      generationMethod: row.generation_method,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'copilot',
      eventName: 'copilot.response_generated',
      payload: { response_id: row.id, copilot_intent: row.copilot_intent, subject_ref: row.subject_ref },
    });
  } catch { /* best effort */ }

  return row;
}

export async function listCopilotResponses(
  organizationId: string,
  options?: { copilotIntent?: CopilotIntent; subjectRef?: string; limit?: number },
): Promise<CopilotResponse[]> {
  let q = ownedDbTable('copilot_responses')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.copilotIntent) q = q.eq('copilot_intent', options.copilotIntent);
  if (options?.subjectRef) q = q.eq('subject_ref', options.subjectRef);
  const { data } = await q;
  return (data as CopilotResponse[]) ?? [];
}

export async function getCopilotResponse(
  organizationId: string,
  responseId: string,
): Promise<CopilotResponse | null> {
  const { data } = await ownedDbTable('copilot_responses')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', responseId)
    .maybeSingle();
  return (data as CopilotResponse | null) ?? null;
}
