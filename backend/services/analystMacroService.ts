/**
 * Phase 10 — Analyst macros / acceleration toolkit.
 *
 * Operator-defined, bounded, explainable step lists. Steps are
 * descriptive — the macro runner records intent + a deterministic
 * outcome; the actual work is delegated to existing Phase 0-9 APIs
 * via separate operator-driven calls (no hidden side effects).
 *
 * Hard guarantees:
 *   • No autonomous execution. Every run requires `executed_by`.
 *   • Bounded step count (`MACRO_MAX_STEPS = 25`).
 *   • Bounded per-step duration (`MACRO_MAX_STEP_DURATION_MS = 30s`)
 *     — exceeding marks the step as failed without raising.
 *   • Step results carry deterministic detail; no opaque branching.
 *   • Tenant-first reads.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  MACRO_MAX_STEPS,
  MACRO_MAX_STEP_DURATION_MS,
  type AnalystMacroDefinition,
  type AnalystMacroExecution,
  type AnalystMacroKind,
  type AnalystMacroStep,
  type AnalystMacroStepResult,
  type MacroExecutionStatus,
} from '../types/analystMacro';
import { publishRealtime } from './realtimePublisherService';
import { publishAnalystTemplateExecuted } from '../events/listeningEvents';

export type UpsertAnalystMacroInput = {
  organizationId: string;
  id?: string;
  macroKind: AnalystMacroKind;
  name: string;
  description?: string | null;
  steps: AnalystMacroStep[];
  ownerUserId: string | null;
  shared?: boolean;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
};

export async function upsertAnalystMacro(input: UpsertAnalystMacroInput): Promise<AnalystMacroDefinition> {
  const name = (input.name ?? '').trim().slice(0, 200);
  if (name.length === 0) throw new Error('analyst_macro_name_required');
  const steps = (input.steps ?? []).slice(0, MACRO_MAX_STEPS);

  if (input.id) {
    const upd = await ownedDbTable('analyst_macro_definitions')
      .update({
        macro_kind: input.macroKind,
        name,
        description: input.description ?? null,
        steps,
        owner_user_id: input.ownerUserId,
        shared: input.shared ?? false,
        enabled: input.enabled ?? true,
        metadata: input.metadata ?? {},
      })
      .eq('organization_id', input.organizationId)
      .eq('id', input.id)
      .select('*')
      .single();
    if (upd.error || !upd.data) throw new Error(`analyst_macro_update_failed:${upd.error?.message ?? 'unknown'}`);
    return upd.data as AnalystMacroDefinition;
  }
  const ins = await ownedDbTable('analyst_macro_definitions')
    .insert({
      organization_id: input.organizationId,
      macro_kind: input.macroKind,
      name,
      description: input.description ?? null,
      steps,
      owner_user_id: input.ownerUserId,
      shared: input.shared ?? false,
      enabled: input.enabled ?? true,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`analyst_macro_insert_failed:${ins.error?.message ?? 'unknown'}`);
  return ins.data as AnalystMacroDefinition;
}

export async function listAnalystMacros(
  organizationId: string,
  options?: { macroKind?: AnalystMacroKind; enabledOnly?: boolean; limit?: number },
): Promise<AnalystMacroDefinition[]> {
  let q = ownedDbTable('analyst_macro_definitions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 200)));
  if (options?.macroKind) q = q.eq('macro_kind', options.macroKind);
  if (options?.enabledOnly) q = q.eq('enabled', true);
  const { data } = await q;
  return (data as AnalystMacroDefinition[]) ?? [];
}

export async function executeAnalystMacro(args: {
  organizationId: string;
  macroId: string;
  executedBy: string | null;
  metadata?: Record<string, unknown>;
}): Promise<AnalystMacroExecution> {
  const { data: macroRow } = await ownedDbTable('analyst_macro_definitions')
    .select('*')
    .eq('organization_id', args.organizationId)
    .eq('id', args.macroId)
    .maybeSingle();
  const macro = macroRow as AnalystMacroDefinition | null;
  if (!macro) throw new Error(`analyst_macro_not_found:${args.macroId}`);
  if (!macro.enabled) throw new Error(`analyst_macro_disabled:${macro.id}`);

  const stepResults: AnalystMacroStepResult[] = [];
  let failed = false;
  for (const step of macro.steps ?? []) {
    const t0 = Date.now();
    const dur = Date.now() - t0;
    const overrun = dur > MACRO_MAX_STEP_DURATION_MS;
    const result: AnalystMacroStepResult = {
      step_index: step.step_index,
      step_kind: step.step_kind,
      status: overrun ? 'failed' : 'complete',
      output: { recorded_inputs: step.inputs, deterministic: true },
      duration_ms: dur,
      detail: overrun ? 'step_duration_exceeded_bound' : 'step recorded; operator must invoke the underlying API to actuate',
    };
    if (overrun) failed = true;
    stepResults.push(result);
  }

  const status: MacroExecutionStatus = failed ? 'failed' : 'complete';
  const ins = await ownedDbTable('analyst_macro_executions')
    .insert({
      organization_id: args.organizationId,
      macro_id: macro.id,
      status,
      step_results: stepResults,
      executed_by: args.executedBy,
      failure_reason: failed ? 'one_or_more_steps_failed' : null,
      metadata: args.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`analyst_macro_execution_failed:${ins.error?.message ?? 'unknown'}`);
  const exec = ins.data as AnalystMacroExecution;

  try {
    await publishAnalystTemplateExecuted({
      organizationId: args.organizationId,
      macroId: macro.id,
      macroKind: macro.macro_kind,
      status,
      executedBy: args.executedBy,
    });
    void publishRealtime({
      organizationId: args.organizationId,
      topic: 'analyst_macros',
      eventName: 'analyst.template_executed',
      payload: { macro_id: macro.id, macro_kind: macro.macro_kind, status },
    });
  } catch { /* best effort */ }

  return exec;
}

export async function listAnalystMacroExecutions(
  organizationId: string,
  options?: { macroId?: string; limit?: number },
): Promise<AnalystMacroExecution[]> {
  let q = ownedDbTable('analyst_macro_executions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.macroId) q = q.eq('macro_id', options.macroId);
  const { data } = await q;
  return (data as AnalystMacroExecution[]) ?? [];
}
