/**
 * WAVE-1A-002 — Prompt-safety adoption utility (thin wrapper over the existing
 * §C6 primitive — NOT a new safety algorithm). Exists so every adoption site uses
 * ONE copy of the harden+observe pattern (DRY; no duplicate safety logic).
 *
 * Reuses: escapeUntrusted/detectInjection (promptSafety.ts) + the HARDEN-001
 * observability registry (recordRawCounter/recordRawHistogram). Adds correlation/
 * reasoning-id + decision tracing per the Observability contract (§X1).
 */
import { randomUUID } from 'crypto';
import { escapeUntrusted, detectInjection, type UntrustedSource, type InjectionFinding } from './promptSafety';
import { recordRawCounter, recordRawHistogram } from '../../../observability';

/** A per-generation reasoning id, propagated with prompt-safety decisions. */
export function newReasoningId(): string {
  try { return `rsn-${randomUUID()}`; } catch { return `rsn-${Date.now()}`; }
}

function observe(source: UntrustedSource, findings: InjectionFinding[]): void {
  if (!findings.length) return;
  try { recordRawCounter('ai.prompt_safety.injection_detected', findings.length, { source }); } catch { /* fail-safe */ }
}

/** Harden one untrusted string field: escape control sequences + count injection attempts. */
export function hardenText(source: UntrustedSource, value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try { observe(source, detectInjection(value, source)); } catch { /* fail-safe */ }
  return escapeUntrusted(value);
}

/** Harden a list of untrusted strings. */
export function hardenTextList(source: UntrustedSource, values: (string | null | undefined)[] | null | undefined): string[] | undefined {
  const cleaned = (values || []).filter(Boolean).map((v) => hardenText(source, v as string)!).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}

/**
 * Harden an already-assembled block of untrusted text (e.g. competitor / user-guided
 * blocks). Returns the escaped block ('' when empty), keeping it as inert DATA.
 */
export function hardenBlock(source: UntrustedSource, block: string | null | undefined): string {
  if (!block) return '';
  try { observe(source, detectInjection(block, source)); } catch { /* fail-safe */ }
  return escapeUntrusted(block);
}

export interface PromptSafetyDecision {
  surface: string;                 // e.g. 'engagement.reply', 'campaign.plan'
  correlationId?: string;
  reasoningId?: string;
  findings: InjectionFinding[];
  durationMs?: number;
}

/**
 * Emit a prompt-safety decision trace (§X1): injection classification + timing +
 * correlation/reasoning ids. Reuses the existing observability framework; fail-safe.
 */
export function recordPromptSafetyDecision(d: PromptSafetyDecision): void {
  const classification = d.findings.length === 0 ? 'clean' : d.findings.length >= 3 ? 'high' : d.findings.length === 2 ? 'med' : 'low';
  try {
    recordRawCounter('ai.prompt_safety.decision', 1, {
      surface: d.surface,
      classification,
      correlation: d.correlationId ?? 'na',
    });
    if (typeof d.durationMs === 'number') {
      recordRawHistogram('ai.prompt_safety.latency_ms', Math.max(0, d.durationMs), { surface: d.surface });
    }
  } catch { /* observability is fail-safe */ }
}

/**
 * Convenience: harden a set of fields at a surface and emit one decision trace.
 * Returns the hardened values in the same key order.
 */
export function hardenFieldsWithTrace(
  surface: string,
  fields: Array<{ key: string; source: UntrustedSource; value: string | null | undefined }>,
  ctx: { correlationId?: string; reasoningId?: string } = {},
): Record<string, string | undefined> {
  const started = Date.now();
  const out: Record<string, string | undefined> = {};
  const findings: InjectionFinding[] = [];
  for (const f of fields) {
    if (f.value) { try { findings.push(...detectInjection(f.value, f.source)); } catch { /* ignore */ } }
    out[f.key] = f.value ? escapeUntrusted(f.value) : undefined;
  }
  recordPromptSafetyDecision({ surface, findings, durationMs: Date.now() - started, ...ctx });
  return out;
}
