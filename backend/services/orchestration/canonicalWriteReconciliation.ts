/**
 * canonicalWriteReconciliation — Phase-2 Step-3.
 *
 * Pure (no I/O) reconciliation of an execution content write against the
 * existing persisted blob. Prevents the persistence-drift class of bugs:
 *   - blank overwrite of enrichments
 *   - stale overwrite
 *   - execution_id / platform mutation
 *   - metadata deletion
 *
 * Enrichment merge priority (highest wins / never blanked):
 *   1. creator_workspace
 *   2. writer_content_brief
 *   3. asset_payload
 *   4. scheduling metadata (scheduled_at / scheduling_status)
 *   5. platform_variants  (union-merged, never truncated)
 *   6. lifecycle state (creator_lifecycle_state / content_status)
 *
 * Invariants are LOG-ONLY in Step-3 (no hard blocking).
 */

const PROTECTED_ENRICHMENTS = [
  'creator_workspace',
  'writer_content_brief',
  'asset_payload',
  'master_content',
  'intent',
] as const;

const IMMUTABLE_KEYS = ['execution_id', 'platform'] as const;

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

export interface ReconcileResult {
  merged: Record<string, unknown>;
  changed_fields: string[];
  preserved_fields: string[];
  prevented: string[];
  invariant_violations: string[];
}

export interface ReconcileOptions {
  source_writer: string;
  campaign_id?: string | null;
  execution_id?: string | null;
}

/** Union-merge platform_variants by platform::content_type (never drops existing). */
function mergeVariants(
  existing: unknown,
  incoming: unknown,
): { list: Array<Record<string, unknown>>; changed: boolean } | null {
  const ex = Array.isArray(existing) ? (existing as Array<Record<string, unknown>>) : [];
  const inc = Array.isArray(incoming) ? (incoming as Array<Record<string, unknown>>) : [];
  if (ex.length === 0 && inc.length === 0) return null;
  const key = (v: Record<string, unknown>) =>
    `${String((v as any)?.platform || '').trim().toLowerCase()}::${String((v as any)?.content_type || '').trim().toLowerCase()}`;
  const map = new Map<string, Record<string, unknown>>();
  for (const v of ex) { const k = key(v); if (k !== '::') map.set(k, v); }
  let changed = false;
  for (const v of inc) {
    const k = key(v);
    if (k === '::') continue;
    if (!map.has(k)) changed = true;
    map.set(k, v); // newer variant for same slot wins, but existing slots never lost
  }
  return { list: Array.from(map.values()), changed };
}

/** Log-only execution invariants. */
function checkInvariants(
  existing: Record<string, unknown>,
  merged: Record<string, unknown>,
): string[] {
  const v: string[] = [];
  for (const k of IMMUTABLE_KEYS) {
    if (!isEmpty(existing[k]) && !isEmpty(merged[k]) && String(existing[k]) !== String(merged[k])) {
      v.push(`${k}_immutable_violation(${String(existing[k])}→${String(merged[k])})`);
    }
  }
  const exWf = String(existing.workflow_type ?? existing.intent_type ?? '').toLowerCase();
  const mgWf = String(merged.workflow_type ?? merged.intent_type ?? '').toLowerCase();
  if (exWf && mgWf && exWf !== mgWf && merged.__allow_workflow_override !== true) {
    v.push(`workflow_type_changed_without_override(${exWf}→${mgWf})`);
  }
  const sched = String(merged.scheduling_status ?? '').toLowerCase();
  const ready = String(merged.scheduling_readiness ?? '').toLowerCase();
  if (sched === 'scheduled' && ready && ready !== 'ready') {
    v.push('scheduled_without_readiness');
  }
  if (String(merged.publish_readiness ?? '').toLowerCase() === 'ready') {
    const mediaReq = merged.__media_upload_required === true;
    if (mediaReq && isEmpty(merged.asset_payload) && isEmpty(merged.uploaded_asset_ref)) {
      v.push('publish_ready_without_required_asset');
    }
  }
  return v;
}

/**
 * Reconcile `incoming` (desired state or patch) onto `existing` content blob.
 * Returns the safe merged blob + diagnostics. Never throws.
 */
export function reconcileContentWrite(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
  _opts: ReconcileOptions,
): ReconcileResult {
  const base: Record<string, unknown> = { ...(existing ?? {}) };
  const inc: Record<string, unknown> = { ...(incoming ?? {}) };
  const changed_fields: string[] = [];
  const preserved_fields: string[] = [];
  const prevented: string[] = [];

  const merged: Record<string, unknown> = { ...base };

  for (const [k, val] of Object.entries(inc)) {
    // 1. immutable keys — never mutate once set.
    if ((IMMUTABLE_KEYS as readonly string[]).includes(k)) {
      if (!isEmpty(base[k]) && !isEmpty(val) && String(base[k]) !== String(val)) {
        prevented.push(`${k}:immutable`);
        continue;
      }
      if (isEmpty(base[k]) && !isEmpty(val)) { merged[k] = val; changed_fields.push(k); }
      continue;
    }
    // 2. protected enrichments — never blank/stale overwrite.
    if ((PROTECTED_ENRICHMENTS as readonly string[]).includes(k)) {
      if (isEmpty(val) && !isEmpty(base[k])) { prevented.push(`${k}:blank_overwrite`); preserved_fields.push(k); continue; }
      if (!isEmpty(val)) { merged[k] = val; if (JSON.stringify(base[k]) !== JSON.stringify(val)) changed_fields.push(k); }
      else preserved_fields.push(k);
      continue;
    }
    // 3. platform_variants — union-merge, never truncate.
    if (k === 'platform_variants') {
      const m = mergeVariants(base.platform_variants, val);
      if (m) { merged.platform_variants = m.list; if (m.changed) changed_fields.push('platform_variants'); else preserved_fields.push('platform_variants'); }
      continue;
    }
    // 4. everything else: incoming wins unless it would blank a non-empty value.
    if (isEmpty(val) && !isEmpty(base[k])) { prevented.push(`${k}:blank_overwrite`); preserved_fields.push(k); continue; }
    merged[k] = val;
    if (JSON.stringify(base[k]) !== JSON.stringify(val)) changed_fields.push(k);
  }

  // Preserve any existing keys not touched by incoming (metadata-deletion guard).
  for (const k of Object.keys(base)) {
    if (!(k in merged)) { merged[k] = base[k]; preserved_fields.push(k); }
  }

  const invariant_violations = checkInvariants(base, merged);
  return { merged, changed_fields, preserved_fields, prevented, invariant_violations };
}
