import { supabase } from '../db/supabaseClient';
import { logLeadSignalEvent } from '../utils/leadSignalLogger';

/**
 * Enforcement rule:
 * No direct writes to `lead_signals` are allowed outside this module.
 * Canonical-only mode is the only supported mode.
 */

export type CanonicalLeadSignalSourceType = 'engagement' | 'listening';
export type LeadSignalWriteMode = 'canonical_only';

export type CanonicalLeadSignalInput = {
  organization_id: string;
  source_type: CanonicalLeadSignalSourceType;
  source_id: string;
  thread_id?: string | null;
  platform: string;
  platform_user_id?: string | null;
  content_text?: string | null;
  intent_score?: number | null;
  urgency_score?: number | null;
  icp_score?: number | null;
  confidence_score?: number | null;
  total_score?: number | null;
  detected_at?: string | null;
  crm_lead_id?: string | null;
  migration_source: string;
  metadata?: Record<string, unknown>;
  contact_id?: string | null;
};

export type LeadSignalWriteInput = {
  canonical: CanonicalLeadSignalInput;
  debugContext?: string;
};

export type LeadSignalWriteResult = {
  mode: LeadSignalWriteMode;
  canonical: {
    id: string | null;
    inserted: boolean;
  };
};

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function isCanonicalSignalWriteEnabled(): boolean {
  return parseBooleanFlag(process.env.USE_CANONICAL_SIGNAL_WRITE, true);
}

export function resolveLeadSignalWriteMode(): LeadSignalWriteMode {
  const canonicalEnabled = isCanonicalSignalWriteEnabled();
  if (canonicalEnabled) return 'canonical_only';

  void logLeadSignalEvent({
    level: 'error',
    event: 'invalid_flag_state',
    mode: null,
    error: 'USE_CANONICAL_SIGNAL_WRITE=false is not supported in canonical-only operation',
    retry: false,
    details: {
      useCanonical: canonicalEnabled,
    },
  });
  throw new Error('[leadSignals] Invalid flag state: USE_CANONICAL_SIGNAL_WRITE must remain true');
}

const leadSignalWriteMode = resolveLeadSignalWriteMode();

console.info('[leadSignals] writer mode initialized', {
  useCanonical: isCanonicalSignalWriteEnabled(),
  mode: leadSignalWriteMode,
});
void logLeadSignalEvent({
  level: 'info',
  event: 'writer_mode_initialized',
  mode: leadSignalWriteMode,
  retry: false,
  details: {
    useCanonical: isCanonicalSignalWriteEnabled(),
  },
});

export function buildContactKey(
  platform: string | null | undefined,
  platformUserId: string | null | undefined
): string | null {
  const normalizedPlatform = (platform ?? '').trim().toLowerCase();
  const normalizedUser = (platformUserId ?? '').trim();
  if (!normalizedPlatform || !normalizedUser) return null;
  return `${normalizedPlatform}:${normalizedUser}`;
}

function normalizeNumeric(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(value);
}

function isMissingRelation(error: { message?: string; code?: string } | null | undefined, relation: string): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    error?.code === '42P01' ||
    message.includes(`relation "${relation}" does not exist`) ||
    message.includes(`could not find the table 'public.${relation.toLowerCase()}'`)
  );
}

function isMissingColumn(error: { message?: string; code?: string } | null | undefined, column: string): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    message.includes(`could not find the '${column.toLowerCase()}' column`) ||
    message.includes(`column "${column.toLowerCase()}" does not exist`)
  );
}

async function retryCanonicalLeadSignalWrite(
  input: CanonicalLeadSignalInput,
  attemptContext: string
): Promise<{ id: string | null; inserted: boolean }> {
  try {
    return await upsertCanonicalLeadSignal(input);
  } catch (error) {
    console.error('[leadSignals] canonical write failed', {
      context: attemptContext,
      attempt: 1,
      error: error instanceof Error ? error.message : String(error),
      sourceType: input.source_type,
      sourceId: input.source_id,
    });
    void logLeadSignalEvent({
      level: 'error',
      event: 'canonical_write_failure',
      mode: 'canonical_only',
      signal_id: input.source_id,
      source_type: input.source_type,
      context: attemptContext,
      error: error instanceof Error ? error.message : String(error),
      retry: true,
      attempt: 1,
    });
  }

  try {
    return await upsertCanonicalLeadSignal(input);
  } catch (error) {
    console.error('[leadSignals] canonical write failed', {
      context: attemptContext,
      attempt: 2,
      error: error instanceof Error ? error.message : String(error),
      sourceType: input.source_type,
      sourceId: input.source_id,
    });
    void logLeadSignalEvent({
      level: 'error',
      event: 'canonical_retry_failure',
      mode: 'canonical_only',
      signal_id: input.source_id,
      source_type: input.source_type,
      context: attemptContext,
      error: error instanceof Error ? error.message : String(error),
      retry: true,
      attempt: 2,
    });
    throw error;
  }
}

export async function writeLeadSignal(input: LeadSignalWriteInput): Promise<LeadSignalWriteResult> {
  const mode = resolveLeadSignalWriteMode();
  const context = input.debugContext ?? 'lead_signal_write';

  console.debug?.('[leadSignals] write decision', {
    context,
    mode,
    sourceType: input.canonical.source_type,
    sourceId: input.canonical.source_id,
  });
  void logLeadSignalEvent({
    level: 'debug',
    event: 'write_decision',
    mode,
    signal_id: input.canonical.source_id,
    source_type: input.canonical.source_type,
    context,
    retry: false,
    details: {},
  });

  const canonical = await retryCanonicalLeadSignalWrite(input.canonical, context);
  return { mode, canonical };
}

async function resolveContactId(input: CanonicalLeadSignalInput): Promise<string | null> {
  const platform = input.platform.trim().toLowerCase();
  const platformUserId = (input.platform_user_id ?? '').trim();
  const contactKey = buildContactKey(platform, platformUserId);
  if (!platform || !platformUserId || !contactKey) return null;

  const metadata = input.metadata ?? {};
  const displayName =
    typeof metadata.display_name === 'string'
      ? metadata.display_name
      : typeof metadata.author_handle === 'string'
        ? metadata.author_handle
        : null;
  const profileUrl = typeof metadata.profile_url === 'string' ? metadata.profile_url : null;

  const { data, error } = await supabase
    .from('contacts')
    .upsert(
      {
        organization_id: input.organization_id,
        platform,
        platform_user_id: platformUserId,
        contact_key: contactKey,
        display_name: displayName,
        profile_url: profileUrl,
      },
      { onConflict: 'organization_id,platform,platform_user_id' }
    )
    .select('id')
    .single();

  if (error) {
    if (isMissingRelation(error, 'contacts')) {
      console.warn('[leadSignals] contacts table missing; skipping contact linkage');
      return null;
    }
    throw new Error(error.message || 'Failed to resolve contact');
  }

  return ((data as { id?: string | null } | null)?.id ?? null) || null;
}

async function syncThreadContact(threadId: string | null | undefined, contactId: string | null): Promise<void> {
  if (!threadId || !contactId) return;

  const { error } = await supabase
    .from('engagement_threads')
    .update({ contact_id: contactId })
    .eq('id', threadId)
    .is('contact_id', null);

  if (!error) return;
  if (isMissingColumn(error, 'contact_id') || isMissingRelation(error, 'engagement_threads')) {
    console.warn('[leadSignals] engagement_threads.contact_id missing; skipping thread linkage');
    return;
  }
  throw new Error(error.message || 'Failed to sync thread contact');
}

export async function upsertCanonicalLeadSignal(
  input: CanonicalLeadSignalInput
): Promise<{ id: string | null; inserted: boolean }> {
  const detectedAt = input.detected_at ?? new Date().toISOString();
  const platform = input.platform.trim().toLowerCase();
  const platformUserId = (input.platform_user_id ?? '').trim() || null;
  const contactId = input.contact_id ?? (await resolveContactId(input));
  const payload = {
    organization_id: input.organization_id,
    source_type: input.source_type,
    source_id: input.source_id,
    thread_id: input.thread_id ?? null,
    platform,
    platform_user_id: platformUserId,
    content_text: input.content_text ?? null,
    intent_score: normalizeNumeric(input.intent_score),
    urgency_score: normalizeNumeric(input.urgency_score),
    icp_score: normalizeNumeric(input.icp_score),
    confidence_score: normalizeNumeric(input.confidence_score),
    total_score: normalizeNumeric(input.total_score),
    detected_at: detectedAt,
    contact_key: buildContactKey(platform, platformUserId),
    contact_id: contactId,
    crm_lead_id: input.crm_lead_id ?? null,
    migration_source: input.migration_source,
    metadata: input.metadata ?? {},
  };

  const { data: existing, error: existingError } = await supabase
    .from('lead_signals')
    .select('id, total_score, confidence_score')
    .eq('organization_id', input.organization_id)
    .eq('source_type', input.source_type)
    .eq('source_id', input.source_id)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message || 'Failed to inspect canonical lead signal');
  }

  const existingRow = existing as
    | { id?: string | null; total_score?: number | null; confidence_score?: number | null }
    | null;
  const nextScore = payload.total_score ?? 0;
  const nextConfidence = payload.confidence_score ?? 0;
  const existingScore = existingRow?.total_score ?? 0;
  const existingConfidence = existingRow?.confidence_score ?? 0;

  const shouldUpdate =
    !existingRow ||
    nextScore > existingScore ||
    (nextScore === existingScore && nextConfidence > existingConfidence);

  if (!shouldUpdate) {
    return { id: existingRow?.id ?? null, inserted: false };
  }

  const { data, error } = await supabase
    .from('lead_signals')
    .upsert(payload, { onConflict: 'organization_id,source_type,source_id' })
    .select('id')
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to write canonical lead signal');
  }

  await syncThreadContact(input.thread_id ?? null, contactId);

  return { id: (data as { id?: string | null })?.id ?? null, inserted: !existingRow };
}
