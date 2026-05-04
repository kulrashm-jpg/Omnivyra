import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

// ── Module-level state ────────────────────────────────────────────────────────
export let lastSignalConfidenceSummary: { average: number; min: number; max: number } | null = null;

// ── Usage ID builders ─────────────────────────────────────────────────────────
export const buildUsageUserId = (userId?: string | null, companyId?: string | null) =>
  `${userId || 'system'}:${companyId || 'global'}`;

export const buildFeatureUsageUserId = (feature: string, companyId: string) =>
  `feature:${feature}|company:${companyId}`;

export const resolveUsageDate = (date: Date = new Date()): string => date.toISOString().slice(0, 10);

// ── Signal confidence summary ─────────────────────────────────────────────────
export const recordSignalConfidenceSummary = (confidences: number[]) => {
  if (!confidences.length) {
    lastSignalConfidenceSummary = null;
    return;
  }
  const avg = confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
  lastSignalConfidenceSummary = {
    average: Number(avg.toFixed(3)),
    min: Number(Math.min(...confidences).toFixed(3)),
    max: Number(Math.max(...confidences).toFixed(3)),
  };
};

// ── Usage logging ─────────────────────────────────────────────────────────────
export async function logExternalApiUsage(input: {
  apiSourceId: string;
  userId: string;
  success: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  feature?: string | null;
  companyId?: string | null;
  /** Phase 1+2: which provider account was used (nullable — existing rows stay NULL) */
  accountId?: string | null;
  /** Phase 2: 1-based attempt index within the account iteration loop */
  attempt_number?: number | null;
  /** Phase 2: outcome of this specific attempt */
  outcome?: 'success' | 'rate_limited' | 'failed' | 'missing_env' | 'client_error' | 'skipped' | null;
}): Promise<void> {
  try {
    const usageDate = resolveUsageDate();
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('external_api_usage')
      .select('*')
      .eq('api_source_id', input.apiSourceId)
      .eq('user_id', input.userId)
      .eq('usage_date', usageDate)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.warn('Failed to load API usage record', {
        apiSourceId: input.apiSourceId,
        userId: input.userId,
      });
      return;
    }

    const requestCount = (data?.request_count ?? 0) + 1;
    const successCount = (data?.success_count ?? 0) + (input.success ? 1 : 0);
    const failureCount = (data?.failure_count ?? 0) + (input.success ? 0 : 1);
    const lastFailureAt = input.success ? data?.last_failure_at ?? null : nowIso;
    const lastErrorCode = input.success ? data?.last_error_code ?? null : input.errorCode ?? null;
    const lastErrorMessage = input.success
      ? data?.last_error_message ?? null
      : input.errorMessage ?? null;
    const lastErrorAt = input.success ? data?.last_error_at ?? null : nowIso;
    const lastSuccessAt = input.success ? nowIso : data?.last_success_at ?? null;

    const { error: upsertError } = await supabase
      .from('external_api_usage')
      .upsert(
        {
          api_source_id: input.apiSourceId,
          user_id: input.userId,
          usage_date: usageDate,
          request_count: requestCount,
          success_count: successCount,
          failure_count: failureCount,
          last_used_at: nowIso,
          last_failure_at: lastFailureAt,
          last_error_code: lastErrorCode,
          last_error_message: lastErrorMessage,
          last_error_at: lastErrorAt,
          last_success_at: lastSuccessAt,
          updated_at: nowIso,
          ...(input.accountId !== undefined ? { account_id: input.accountId } : {}),
          ...(input.attempt_number !== undefined ? { last_attempt_number: input.attempt_number } : {}),
          ...(input.outcome !== undefined ? { last_outcome: input.outcome } : {}),
        },
        { onConflict: 'api_source_id,user_id,usage_date' }
      );

    if (upsertError) {
      const isSchemaError =
        (upsertError as { code?: string })?.code === 'PGRST205' ||
        (upsertError.message?.toLowerCase().includes('could not find the table') ?? false) ||
        (upsertError.message?.toLowerCase().includes('relation') && upsertError.message?.toLowerCase().includes('does not exist'));
      if (isSchemaError && !(globalThis as any).__external_api_usage_schema_hint_shown) {
        (globalThis as any).__external_api_usage_schema_hint_shown = true;
        console.warn(
          'Schema mismatch: external_api_usage table missing. Apply migration 20260504010001_fix_external_api_telemetry_tables.sql. API usage tracking will be skipped.'
        );
      } else if (!isSchemaError) {
        const err = upsertError as { code?: string; message?: string };
        console.warn('Failed to update API usage record', {
          apiSourceId: input.apiSourceId,
          userId: input.userId,
          code: err?.code,
          message: err?.message,
        });
      }
    }

    if (input.feature && input.companyId) {
      const featureUserId = buildFeatureUsageUserId(input.feature, input.companyId);
      await supabase.from('external_api_usage').upsert(
        {
          api_source_id: input.apiSourceId,
          user_id: featureUserId,
          usage_date: usageDate,
          request_count: requestCount,
          success_count: successCount,
          failure_count: failureCount,
          last_used_at: nowIso,
          last_failure_at: lastFailureAt,
          last_error_code: lastErrorCode,
          last_error_message: lastErrorMessage,
          last_error_at: lastErrorAt,
          last_success_at: lastSuccessAt,
          updated_at: nowIso,
          ...(input.accountId !== undefined ? { account_id: input.accountId } : {}),
          ...(input.attempt_number !== undefined ? { last_attempt_number: input.attempt_number } : {}),
          ...(input.outcome !== undefined ? { last_outcome: input.outcome } : {}),
        },
        { onConflict: 'api_source_id,user_id,usage_date' }
      );
    }
  } catch (error) {
    console.warn('API usage log failed', { apiSourceId: input.apiSourceId, userId: input.userId });
  }
}

/**
 * Increment signals_generated in external_api_usage (e.g. after inserting into intelligence_signals).
 * Call from intelligence polling worker or any path that inserts signals.
 */
export async function addSignalsGenerated(input: {
  apiSourceId: string;
  userId: string;
  count: number;
  feature?: string | null;
  companyId?: string | null;
}): Promise<void> {
  if (input.count <= 0) return;
  try {
    const usageDate = resolveUsageDate();
    const nowIso = new Date().toISOString();
    const { data, error: selectError } = await supabase
      .from('external_api_usage')
      .select('signals_generated, request_count, success_count, failure_count, last_used_at')
      .eq('api_source_id', input.apiSourceId)
      .eq('user_id', input.userId)
      .eq('usage_date', usageDate)
      .maybeSingle();

    const selectMsg = (selectError as { message?: string })?.message?.toLowerCase() ?? '';
    const isSelectSchemaError =
      selectError &&
      ((selectMsg.includes('column') && selectMsg.includes('does not exist')) ||
        selectMsg.includes('could not find the table') ||
        (selectMsg.includes('relation') && selectMsg.includes('does not exist')));
    if (isSelectSchemaError && !(globalThis as any).__external_api_usage_signals_hint_shown) {
      (globalThis as any).__external_api_usage_signals_hint_shown = true;
      console.warn(
        'Schema mismatch: external_api_usage.signals_generated column missing. Apply migration 20260504010001_fix_external_api_telemetry_tables.sql. Signals tracking will be skipped.'
      );
      return;
    }

    const current = (data?.signals_generated ?? 0) + input.count;
    const { error: upsertError } = await supabase.from('external_api_usage').upsert(
      {
        api_source_id: input.apiSourceId,
        user_id: input.userId,
        usage_date: usageDate,
        signals_generated: current,
        request_count: data?.request_count ?? 0,
        success_count: data?.success_count ?? 0,
        failure_count: data?.failure_count ?? 0,
        last_used_at: data?.last_used_at ?? nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'api_source_id,user_id,usage_date' }
    );

    if (upsertError) {
      const msg = (upsertError as { message?: string })?.message?.toLowerCase() ?? '';
      const isSchemaError =
        (upsertError as { code?: string })?.code === 'PGRST205' ||
        msg.includes('could not find the table') ||
        (msg.includes('relation') && msg.includes('does not exist')) ||
        (msg.includes('column') && msg.includes('does not exist'));
      if (isSchemaError && !(globalThis as any).__external_api_usage_schema_hint_shown) {
        (globalThis as any).__external_api_usage_schema_hint_shown = true;
        console.warn(
          'Schema mismatch: external_api_usage table or signals_generated column missing. Apply migration 20260504010001_fix_external_api_telemetry_tables.sql.'
        );
      } else if (!isSchemaError) {
        const err = upsertError as { code?: string; message?: string };
        console.warn('Failed to update signals_generated', {
          apiSourceId: input.apiSourceId,
          userId: input.userId,
          code: err?.code,
          message: err?.message,
        });
      }
    }

    if (input.feature && input.companyId) {
      const featureUserId = buildFeatureUsageUserId(input.feature, input.companyId);
      const { data: featureData } = await supabase
        .from('external_api_usage')
        .select('signals_generated, request_count, success_count, failure_count, last_used_at')
        .eq('api_source_id', input.apiSourceId)
        .eq('user_id', featureUserId)
        .eq('usage_date', usageDate)
        .maybeSingle();
      const featureCurrent = (featureData?.signals_generated ?? 0) + input.count;
      await supabase.from('external_api_usage').upsert(
        {
          api_source_id: input.apiSourceId,
          user_id: featureUserId,
          usage_date: usageDate,
          signals_generated: featureCurrent,
          request_count: featureData?.request_count ?? 0,
          success_count: featureData?.success_count ?? 0,
          failure_count: featureData?.failure_count ?? 0,
          last_used_at: featureData?.last_used_at ?? nowIso,
          updated_at: nowIso,
        },
        { onConflict: 'api_source_id,user_id,usage_date' }
      );
    }
  } catch (error) {
    console.warn('addSignalsGenerated failed', {
      apiSourceId: input.apiSourceId,
      userId: input.userId,
      error: (error as Error)?.message,
    });
  }
}
