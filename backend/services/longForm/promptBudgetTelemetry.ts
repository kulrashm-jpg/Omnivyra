/**
 * promptBudgetTelemetry.ts
 *
 * Phase 3.6 — Prompt budget instrumentation for long-form operations.
 *
 * Phase 2 expanded `CompanyContext` from 18 to 35 fields and added an
 * `editorialRuntimeContext + generatorRuntimeAlignment + generatorBehavioralSteering`
 * serialized block plus per-section strategic assignments. Phase 3 now
 * also injects the canonical identity lock and anti-generic rules into
 * the section system prompt. Prompts have meaningfully grown.
 *
 * Without telemetry we have no idea whether:
 *   - the doctrine block is dominating the prompt
 *   - identity-lock + anti-generic dwarf the actual section contract
 *   - long-form prompts are approaching the model's context ceiling
 *
 * This module produces a deterministic per-call report and emits a
 * `LONGFORM_PROMPT_BUDGET` event. No external dependencies — a simple
 * token-estimate heuristic (chars / 4) is sufficient for budget
 * tracking accuracy.
 */

const TOKENS_PER_CHAR_ESTIMATE = 1 / 4; // ~4 chars per token is the OpenAI rule of thumb
const GPT_4O_INPUT_LIMIT = 128_000;
const GPT_4O_OUTPUT_LIMIT = 16_384;
const GPT_4O_MINI_INPUT_LIMIT = 128_000;
const GPT_4O_MINI_OUTPUT_LIMIT = 16_384;

function modelInputLimit(model: string): number {
  if (model.startsWith('gpt-4o-mini')) return GPT_4O_MINI_INPUT_LIMIT;
  if (model.startsWith('gpt-4o')) return GPT_4O_INPUT_LIMIT;
  return 32_000; // conservative default for unknown models
}

function modelOutputLimit(model: string): number {
  if (model.startsWith('gpt-4o-mini')) return GPT_4O_MINI_OUTPUT_LIMIT;
  if (model.startsWith('gpt-4o')) return GPT_4O_OUTPUT_LIMIT;
  return 4_096;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR_ESTIMATE);
}

// ── Marker-based segment estimation ──────────────────────────────────────────
//
// Identify approximate sizes of the major prompt segments by scanning for
// canonical markers. This is heuristic; the goal is "is the doctrine eating
// the prompt?" not exact accounting.

interface SegmentRule {
  segment: 'identity_lock' | 'anti_generic' | 'doctrine_runtime' | 'company_context_block' | 'strategic_assignments' | 'evidence_rules' | 'icp_framing' | 'capability_emphasis' | 'terminology' | 'avoid_patterns';
  markers: string[];
  // Heuristic: estimated length is from the marker start to the next marker
  // OR `defaultSpan` characters, whichever is smaller.
  defaultSpan: number;
}

const SEGMENT_RULES: SegmentRule[] = [
  { segment: 'identity_lock',          markers: ['You are the in-house content strategist for', 'YOUR AUDIENCE:'], defaultSpan: 900 },
  { segment: 'anti_generic',           markers: ['CONTENT ENFORCEMENT RULES (NON-NEGOTIABLE)', 'FORBIDDEN PHRASES'], defaultSpan: 1500 },
  { segment: 'doctrine_runtime',       markers: ['EDITORIAL RUNTIME CONTEXT', 'GENERATOR RUNTIME ALIGNMENT', 'GENERATOR BEHAVIORAL STEERING'], defaultSpan: 3000 },
  { segment: 'company_context_block',  markers: ['COMPANY:', 'PEER INTELLIGENCE:', 'IDEAL CUSTOMER (ICP)'], defaultSpan: 800 },
  { segment: 'strategic_assignments',  markers: ['STRATEGIC ASSIGNMENTS', 'Section 1 [introduction]'], defaultSpan: 1200 },
  { segment: 'evidence_rules',         markers: ['FACTUAL INTEGRITY', 'GROUNDED GENERATION CONSTRAINTS'], defaultSpan: 1500 },
  { segment: 'icp_framing',            markers: ['ICP FRAMING:'], defaultSpan: 400 },
  { segment: 'capability_emphasis',    markers: ['CAPABILITY EMPHASIS'], defaultSpan: 300 },
  { segment: 'terminology',            markers: ['TERMINOLOGY EMPHASIS'], defaultSpan: 300 },
  { segment: 'avoid_patterns',         markers: ['AVOID PATTERNS:', 'AVOID (always):'], defaultSpan: 600 },
];

interface SegmentSize {
  segment: SegmentRule['segment'];
  estimated_chars: number;
  estimated_tokens: number;
}

function estimateSegmentSizes(systemPrompt: string): SegmentSize[] {
  const result: SegmentSize[] = [];
  for (const rule of SEGMENT_RULES) {
    let totalChars = 0;
    for (const m of rule.markers) {
      const idx = systemPrompt.indexOf(m);
      if (idx === -1) continue;
      // Find the next major segment header after this marker.
      const remaining = systemPrompt.slice(idx);
      const nextHeader = remaining.slice(m.length).search(/\n[A-Z][A-Z _]{3,}:/);
      const span = nextHeader === -1
        ? Math.min(rule.defaultSpan, remaining.length)
        : Math.min(rule.defaultSpan, nextHeader + m.length);
      totalChars += span;
    }
    if (totalChars > 0) {
      result.push({
        segment: rule.segment,
        estimated_chars: totalChars,
        estimated_tokens: estimateTokens(' '.repeat(totalChars)),
      });
    }
  }
  return result;
}

// ── Telemetry payload ────────────────────────────────────────────────────────

export interface PromptBudgetReport {
  operation: string;
  model: string;
  company_id: string | null;
  system_prompt_chars: number;
  system_prompt_tokens: number;
  user_prompt_chars: number;
  user_prompt_tokens: number;
  total_input_chars: number;
  total_input_tokens: number;
  segments: SegmentSize[];
  doctrine_share_of_system_pct: number;
  identity_share_of_system_pct: number;
  output_budget_tokens: number;
  total_budget_tokens: number;
  model_input_limit: number;
  model_output_limit: number;
  input_headroom_tokens: number;
  truncation_risk: 'none' | 'low' | 'moderate' | 'high';
  warnings: string[];
}

const SAFE_INPUT_USE_PCT = 0.65;   // anything over 65% of input limit is "moderate"
const HIGH_INPUT_USE_PCT = 0.85;   // anything over 85% is "high"
const DOCTRINE_DOMINANCE_PCT = 35; // doctrine should not exceed 35% of system prompt
const IDENTITY_DOMINANCE_PCT = 45; // identity + anti-generic combined should not dominate

export interface ComputePromptBudgetInput {
  operation: string;
  model: string;
  companyId: string | null;
  systemPrompt: string;
  userPrompt: string;
  outputBudgetTokens?: number;
}

export function computePromptBudgetReport(input: ComputePromptBudgetInput): PromptBudgetReport {
  const sysChars = input.systemPrompt.length;
  const usrChars = input.userPrompt.length;
  const sysTokens = estimateTokens(input.systemPrompt);
  const usrTokens = estimateTokens(input.userPrompt);
  const totalInputTokens = sysTokens + usrTokens;
  const inputLimit = modelInputLimit(input.model);
  const outputLimit = modelOutputLimit(input.model);
  const outputBudget = input.outputBudgetTokens ?? outputLimit;
  const inputHeadroom = inputLimit - totalInputTokens;

  const segments = estimateSegmentSizes(input.systemPrompt);
  const doctrineChars = segments
    .filter((s) => s.segment === 'doctrine_runtime')
    .reduce((sum, s) => sum + s.estimated_chars, 0);
  const identityChars = segments
    .filter((s) => s.segment === 'identity_lock' || s.segment === 'anti_generic' || s.segment === 'company_context_block')
    .reduce((sum, s) => sum + s.estimated_chars, 0);
  const doctrinePct = sysChars > 0 ? Math.round((doctrineChars / sysChars) * 100) : 0;
  const identityPct = sysChars > 0 ? Math.round((identityChars / sysChars) * 100) : 0;

  const warnings: string[] = [];
  if (totalInputTokens / inputLimit > HIGH_INPUT_USE_PCT) {
    warnings.push(`Input tokens (${totalInputTokens}) exceed ${Math.round(HIGH_INPUT_USE_PCT * 100)}% of model input limit (${inputLimit}). Strategic fields likely truncated by the model.`);
  } else if (totalInputTokens / inputLimit > SAFE_INPUT_USE_PCT) {
    warnings.push(`Input tokens (${totalInputTokens}) exceed ${Math.round(SAFE_INPUT_USE_PCT * 100)}% of model input limit (${inputLimit}). Approaching truncation risk.`);
  }
  if (doctrinePct > DOCTRINE_DOMINANCE_PCT) {
    warnings.push(`Doctrine + runtime context occupies ${doctrinePct}% of the system prompt — exceeds the ${DOCTRINE_DOMINANCE_PCT}% safety threshold. Useful context may be crowded out.`);
  }
  if (identityPct > IDENTITY_DOMINANCE_PCT) {
    warnings.push(`Identity-lock + anti-generic + company-context block occupies ${identityPct}% of the system prompt. Strategic fields may be visually drowned by enforcement boilerplate.`);
  }
  if (totalInputTokens + outputBudget > inputLimit) {
    warnings.push(`Combined budget (input ${totalInputTokens} + output ${outputBudget}) exceeds model input limit (${inputLimit}). Provider may reject the call.`);
  }

  let truncationRisk: PromptBudgetReport['truncation_risk'];
  const useRatio = totalInputTokens / inputLimit;
  if (useRatio > HIGH_INPUT_USE_PCT) truncationRisk = 'high';
  else if (useRatio > SAFE_INPUT_USE_PCT) truncationRisk = 'moderate';
  else if (useRatio > 0.4) truncationRisk = 'low';
  else truncationRisk = 'none';

  return {
    operation: input.operation,
    model: input.model,
    company_id: input.companyId,
    system_prompt_chars: sysChars,
    system_prompt_tokens: sysTokens,
    user_prompt_chars: usrChars,
    user_prompt_tokens: usrTokens,
    total_input_chars: sysChars + usrChars,
    total_input_tokens: totalInputTokens,
    segments,
    doctrine_share_of_system_pct: doctrinePct,
    identity_share_of_system_pct: identityPct,
    output_budget_tokens: outputBudget,
    total_budget_tokens: totalInputTokens + outputBudget,
    model_input_limit: inputLimit,
    model_output_limit: outputLimit,
    input_headroom_tokens: inputHeadroom,
    truncation_risk: truncationRisk,
    warnings,
  };
}

export function emitPromptBudgetTelemetry(report: PromptBudgetReport): void {
  const line = `[longform-budget] ${JSON.stringify({ event: 'LONGFORM_PROMPT_BUDGET', ...report, timestamp: new Date().toISOString() })}`;
  if (report.warnings.length > 0 || report.truncation_risk === 'high') {
    console.warn(line);
  } else {
    console.log(line);
  }
}
