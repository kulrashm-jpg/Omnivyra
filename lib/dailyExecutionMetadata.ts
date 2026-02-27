export type DailyExecutionMetadata = {
  execution_id?: string;
  source_type?: 'planned' | 'manual';
  is_committed?: boolean;
  retention_state?: 'temporary' | 'saved' | 'archived';
  expires_at?: string | null;
  archived_at?: string | null;
  content_visibility?: boolean;
  retention_reminders?: Array<{
    days_before: 30 | 15 | 7 | 1;
    remind_at: string;
    sent: boolean;
  }>;
};

function normalizeSourceType(value: unknown): 'planned' | 'manual' {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'planned') return 'planned';
  if (raw === 'manual') return 'manual';
  if (raw) {
    console.warn('[daily-metadata][unknown-source-type]', { source_type: raw });
  }
  return 'manual';
}

/**
 * Deterministic metadata section:
 * execution_id:{id};source_type:{type};is_committed:{true|false}
 */
export function buildDailyExecutionMetadata(input: DailyExecutionMetadata): string {
  const execution_id = String(input.execution_id ?? '').trim();
  const source_type = normalizeSourceType(input.source_type);
  const is_committed = Boolean(input.is_committed);
  const retention_state = String(input.retention_state ?? '').trim().toLowerCase();
  const expires_at = String(input.expires_at ?? '').trim();
  const archived_at = String(input.archived_at ?? '').trim();
  const content_visibility = typeof input.content_visibility === 'boolean' ? input.content_visibility : true;
  const retention_reminders = Array.isArray(input.retention_reminders) ? input.retention_reminders : [];
  return [
    `execution_id:${execution_id}`,
    `source_type:${source_type}`,
    `is_committed:${is_committed ? 'true' : 'false'}`,
    `retention_state:${retention_state || 'temporary'}`,
    `expires_at:${expires_at}`,
    `archived_at:${archived_at}`,
    `content_visibility:${content_visibility ? 'true' : 'false'}`,
    `retention_reminders:${encodeURIComponent(JSON.stringify(retention_reminders))}`,
  ].join(';');
}

/**
 * Parses both semicolon and legacy pipe-delimited formats.
 * Never throws; returns safe defaults.
 */
export function parseDailyExecutionMetadata(formatNotes: unknown): DailyExecutionMetadata {
  const raw = String(formatNotes ?? '').trim();
  if (!raw) {
    return {
      source_type: 'manual',
      is_committed: false,
    };
  }

  const tokens = raw
    .split(/[;|]/g)
    .map((part) => part.trim())
    .filter(Boolean);

  let execution_id: string | undefined;
  let source_type_raw: string | undefined;
  let is_committed: boolean | undefined;
  let retention_state_raw: string | undefined;
  let expires_at: string | null | undefined;
  let archived_at: string | null | undefined;
  let content_visibility: boolean | undefined;
  let retention_reminders: DailyExecutionMetadata['retention_reminders'];

  for (const token of tokens) {
    const idx = token.indexOf(':');
    if (idx < 0) continue;
    const key = token.slice(0, idx).trim().toLowerCase();
    const value = token.slice(idx + 1).trim();
    if (key === 'execution_id') {
      execution_id = value || undefined;
      continue;
    }
    if (key === 'source_type') {
      source_type_raw = value.toLowerCase();
      continue;
    }
    if (key === 'is_committed') {
      is_committed = value.toLowerCase() === 'true';
      continue;
    }
    if (key === 'retention_state') {
      retention_state_raw = value.toLowerCase();
      continue;
    }
    if (key === 'expires_at') {
      expires_at = value || null;
      continue;
    }
    if (key === 'archived_at') {
      archived_at = value || null;
      continue;
    }
    if (key === 'content_visibility') {
      content_visibility = value.toLowerCase() === 'true';
      continue;
    }
    if (key === 'retention_reminders') {
      try {
        const decoded = decodeURIComponent(value);
        const parsed = JSON.parse(decoded);
        if (Array.isArray(parsed)) {
          retention_reminders = parsed as DailyExecutionMetadata['retention_reminders'];
        }
      } catch {
        retention_reminders = [];
      }
    }
  }

  const source_type = normalizeSourceType(source_type_raw);
  const retention_state: DailyExecutionMetadata['retention_state'] =
    retention_state_raw === 'saved' || retention_state_raw === 'archived' || retention_state_raw === 'temporary'
      ? retention_state_raw
      : 'temporary';
  if (source_type === 'planned' && !String(execution_id ?? '').trim()) {
    console.warn('[daily-metadata][missing-execution-id-planned]', { format_notes: raw });
  }
  if (retention_state === 'temporary' && !expires_at) {
    console.warn('[daily-metadata][temporary-missing-expires-at]', { format_notes: raw });
  }
  if (retention_state === 'saved' && expires_at) {
    console.warn('[daily-metadata][saved-has-expires-at]', { format_notes: raw });
  }
  if (retention_state === 'archived' && !archived_at) {
    console.warn('[daily-metadata][archived-missing-archived-at]', { format_notes: raw });
  }
  return {
    execution_id,
    source_type,
    is_committed: typeof is_committed === 'boolean' ? is_committed : false,
    retention_state,
    expires_at: typeof expires_at === 'string' || expires_at === null ? expires_at : undefined,
    archived_at: typeof archived_at === 'string' || archived_at === null ? archived_at : undefined,
    content_visibility: typeof content_visibility === 'boolean' ? content_visibility : true,
    retention_reminders: Array.isArray(retention_reminders) ? retention_reminders : undefined,
  };
}

