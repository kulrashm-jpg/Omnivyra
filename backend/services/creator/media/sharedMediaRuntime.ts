/**
 * Shared Creator Media — Step-15 runtime publishing wiring (pure core).
 * ──────────────────────────────────────────────────────────────────────────
 * Completes the inheritance pipeline: turns resolved inheritance into the
 * finalized per-row `content.uploaded_media_url` the EXISTING scheduler
 * already consumes — WITHOUT touching the scheduler, BOLT Text, or
 * render internals.
 *
 * This module is PURE: DB reads/writes are done by the caller (the
 * shared-media endpoint) and passed in. The scheduler never imports this
 * — it remains delivery-only and render-unaware.
 *
 * Media-only: it computes `uploaded_media_url`. It NEVER reads or writes
 * caption / hashtags / CTA / metadata — platform-native text is produced
 * elsewhere and is structurally out of reach here.
 */

import {
  resolveSharedMediaInheritance,
  finalizeSchedulerMedia,
  isPlatformAssetCompatible,
  type InheritanceOverridePolicy,
  type CompatibilityPolicy,
  type PlatformOverrideKind,
} from './index';

export function isSharedMediaPublishingEnabled(): boolean {
  const raw = String(process.env.ENABLE_CREATOR_WORKSPACE_LIFECYCLE ?? '')
    .trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

export type SharedMediaRuntimeEvent =
  | 'inheritance_resolved'
  | 'override_applied'
  | 'incompatible_skipped'
  | 'finalized_media_attached'
  | 'duplicate_render_prevented'
  | 'no_media';

export interface FinalizeRowInput {
  intentType: string | null | undefined;
  platform: string;
  assetType: unknown;
  /** Resolved attachment for this content core (caller-loaded). */
  attachment: {
    asset_id: string;
    asset_url: string | null;
    override_policy: InheritanceOverridePolicy;
    compatibility_policy: CompatibilityPolicy;
  } | null;
  /** Per-platform overrides (caller-loaded), keyed by normalized key. */
  overrides?: Record<string, { kind: PlatformOverrideKind; asset_id?: string; asset_url?: string | null }>;
  /** The row's CURRENT content.uploaded_media_url (for reuse detection). */
  existingUploadedUrl?: string | null;
}

export interface FinalizeRowResult {
  /** true ⇒ a content-only patch should be persisted. */
  applied: boolean;
  /** Scheduler-safe flat shape ONLY (Phase-2). */
  finalized: { platform: string; media_url: string | null; media_source: string } | null;
  /** The ONLY field written back — nothing strategic/inheritance/render. */
  content_patch: { uploaded_media_url: string | null } | null;
  /** True when an existing identical inherited URL was reused (no new
   *  upload / render / lineage). */
  reused: boolean;
  events: SharedMediaRuntimeEvent[];
  reason?: string;
}

const SKIP: FinalizeRowResult = {
  applied: false, finalized: null, content_patch: null, reused: false, events: [],
};

/**
 * PURE finalize for ONE row/platform. Creator-only; Text rows are a
 * no-op (returns SKIP) so BOLT Text caption repurposing is untouched.
 * Compatibility is enforced fail-closed before any media is attached.
 */
export function finalizeRowSharedMedia(input: FinalizeRowInput): FinalizeRowResult {
  if (String(input.intentType ?? '') !== 'creator') {
    return { ...SKIP, reason: 'not_creator' };           // Text isolation
  }
  if (!input.attachment) {
    return { ...SKIP, reason: 'no_attachment' };
  }
  const platform = String(input.platform ?? '').trim().toLowerCase();
  if (!platform) return { ...SKIP, reason: 'no_platform' };

  // Phase-4 fail-closed compatibility BEFORE resolution.
  const compat = isPlatformAssetCompatible(
    platform, input.assetType, input.attachment.compatibility_policy,
  );
  if (!compat.compatible) {
    return {
      applied: false, finalized: { platform, media_url: null, media_source: 'incompatible' },
      content_patch: null, reused: false,
      events: ['incompatible_skipped'], reason: compat.reason ?? 'incompatible',
    };
  }

  const overrides = input.overrides ?? {};
  const resolved = resolveSharedMediaInheritance({
    assetType: input.assetType,
    sharedAssetId: input.attachment.asset_id,
    targetPlatforms: [platform],
    overridePolicy: input.attachment.override_policy,
    compatibilityPolicy: input.attachment.compatibility_policy,
    overrides,
  });
  const res = resolved.resolutions[0];
  if (!res) return { ...SKIP, reason: 'unresolved' };

  // asset_id → url (pure map: shared asset_url, or override url).
  const urlFor = (assetId: string | null): string | null => {
    if (!assetId) return null;
    if (assetId === input.attachment!.asset_id) return input.attachment!.asset_url;
    for (const ov of Object.values(overrides)) {
      if (ov.asset_id === assetId && ov.asset_url) return ov.asset_url;
    }
    return null;
  };
  const finalizedArr = finalizeSchedulerMedia([res], urlFor);
  const finalized = finalizedArr[0]!;          // {platform,media_url,media_source}

  const events: SharedMediaRuntimeEvent[] = ['inheritance_resolved'];
  if (res.source === 'overridden_replaced' || res.source === 'overridden_disabled') {
    events.push('override_applied');
  }

  // Phase-6 render/upload reuse: identical inherited URL already on the
  // row ⇒ reuse it, emit NO patch (no duplicate upload/render/lineage).
  if (
    res.source === 'inherited' &&
    finalized.media_url &&
    input.existingUploadedUrl &&
    input.existingUploadedUrl === finalized.media_url
  ) {
    events.push('duplicate_render_prevented');
    return { applied: false, finalized, content_patch: null, reused: true, events };
  }

  if (finalized.media_url == null) {
    // disabled / not_inherited / no-url ⇒ remove the inherited media
    // slot (set null). 'incompatible' already returned above.
    events.push('no_media');
    return {
      applied: true, finalized,
      content_patch: { uploaded_media_url: null },
      reused: false, events,
    };
  }

  events.push('finalized_media_attached');
  return {
    applied: true,
    finalized,
    content_patch: { uploaded_media_url: finalized.media_url },
    reused: false,
    events,
  };
}

/* ── Step-16: pre-enqueue orchestration (pure) ──────────────────────────── */

export type OrchestrationEvent =
  | 'shared_media_prepare_started'
  | 'shared_media_prepare_completed'
  | 'shared_media_prepare_skipped'
  | 'shared_media_prepare_failed'
  | 'duplicate_media_prevented'
  | 'incompatible_media_skipped';

export interface OrchestrationRowInput extends FinalizeRowInput {
  /** Caller key used to route the resulting patch back to a DB row. */
  rowKey: string;
}

export interface OrchestrationPatch {
  rowKey: string;
  content_patch: { uploaded_media_url: string | null };
}

export interface PrepareSharedMediaResult {
  /** Content-only patches to persist (caller writes them, scheduler-free). */
  patches: OrchestrationPatch[];
  events: OrchestrationEvent[];
  summary: {
    total: number;
    attached: number;
    reused: number;
    incompatible: number;
    skipped: number;
    failed: number;
  };
}

const EMPTY_PREPARE: PrepareSharedMediaResult = {
  patches: [],
  events: ['shared_media_prepare_skipped'],
  summary: { total: 0, attached: 0, reused: 0, incompatible: 0, skipped: 0, failed: 0 },
};

/**
 * PHASE-1/2/3 pure pre-enqueue orchestrator. Runs finalize for every
 * candidate Creator row, FAIL-CLOSED per row: a thrown/failed row is
 * isolated (counted, event-logged) and NEVER aborts the batch or yields
 * a partial patch — existing scheduling integrity is preserved. NEVER
 * throws as a whole. Scheduler-free, DB-free, deterministic.
 */
export function prepareSharedMediaForPublishing(
  inputs: ReadonlyArray<OrchestrationRowInput>,
): PrepareSharedMediaResult {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return { ...EMPTY_PREPARE, summary: { ...EMPTY_PREPARE.summary } };
  }
  const events: OrchestrationEvent[] = ['shared_media_prepare_started'];
  const patches: OrchestrationPatch[] = [];
  const summary = { total: inputs.length, attached: 0, reused: 0, incompatible: 0, skipped: 0, failed: 0 };

  for (const input of inputs) {
    let r: FinalizeRowResult;
    try {
      r = finalizeRowSharedMedia(input);
    } catch {
      // Fail-closed: isolate this row, never corrupt the batch.
      summary.failed += 1;
      if (!events.includes('shared_media_prepare_failed')) events.push('shared_media_prepare_failed');
      continue;
    }
    if (r.reused) {
      summary.reused += 1;
      if (!events.includes('duplicate_media_prevented')) events.push('duplicate_media_prevented');
      continue; // no patch — duplicate prevented
    }
    if (r.finalized && r.finalized.media_source === 'incompatible') {
      summary.incompatible += 1;
      if (!events.includes('incompatible_media_skipped')) events.push('incompatible_media_skipped');
      continue; // fail-closed: no media injected
    }
    if (r.applied && r.content_patch) {
      patches.push({ rowKey: input.rowKey, content_patch: r.content_patch });
      summary.attached += 1;
    } else {
      summary.skipped += 1;
    }
  }

  events.push('shared_media_prepare_completed');
  return { patches, events, summary };
}

/* ── Step-16: runtime adapter (DI; route owns the clients) ──────────────── */

export interface SharedMediaPreEnqueueDeps {
  /** PostgREST-like reader (e.g. the supabase client). */
  supabase: any;
  /** Write-owner table factory (content-only updates). */
  ownedDbTable: (table: string) => any;
}
export interface SharedMediaPreEnqueueArgs {
  campaignId: string;
  /** Optional: limit to one execution's content core. */
  executionId?: string | null;
}

/**
 * Automatic pre-enqueue adapter. Flag-gated + FAIL-CLOSED: ANY error is
 * swallowed and reported — it can never break scheduling. Performs ONLY
 * content-only `uploaded_media_url` writes on Creator rows; touches no
 * scheduler internals, no Text rows, no caption/hashtag/CTA/metadata.
 * Returns a summary the caller logs ONCE (no noisy logs here).
 */
export async function runSharedMediaPreEnqueue(
  deps: SharedMediaPreEnqueueDeps,
  args: SharedMediaPreEnqueueArgs,
): Promise<PrepareSharedMediaResult & { ran: boolean }> {
  const skipped = (): PrepareSharedMediaResult & { ran: boolean } => ({
    ...EMPTY_PREPARE, summary: { ...EMPTY_PREPARE.summary }, ran: false,
  });
  try {
    if (!isSharedMediaPublishingEnabled()) return skipped();
    const { supabase, ownedDbTable } = deps;
    const campaignId = String(args.campaignId || '').trim();
    if (!campaignId) return skipped();

    const { data: sibs } = await supabase
      .from('daily_content_plans')
      .select('id, content, content_type, platform, intent_type')
      .eq('campaign_id', campaignId)
      .eq('intent_type', 'creator')
      .limit(200);
    const rows: any[] = Array.isArray(sibs) ? sibs : [];
    if (rows.length === 0) return skipped();

    // Determine the target content core(s). When executionId is given,
    // scope to that row's core; else process every creator core present.
    const parse = (c: unknown): any => {
      try { return typeof c === 'string' ? JSON.parse(c) : (c || {}); } catch { return {}; }
    };
    let targetCoreIds: Set<string> | null = null;
    if (args.executionId) {
      const anchor = rows.find((r) => {
        const sc = parse(r.content);
        return String(sc?.execution_id || r.id) === String(args.executionId)
          || String(r.id) === String(args.executionId);
      });
      if (anchor) {
        const ac = parse(anchor.content);
        const cid = String(ac?.creator_planning_source?.card_id || '');
        if (cid) targetCoreIds = new Set([cid]);
      }
    }

    // Build finalize inputs grouped by content core; load attachment +
    // overrides + core asset_url per core (read-only).
    const inputs: OrchestrationRowInput[] = [];
    const coreCache = new Map<string, any>();
    for (const r of rows) {
      const sc = parse(r.content);
      const coreId = String(sc?.creator_planning_source?.card_id || '');
      if (!coreId) continue;
      if (targetCoreIds && !targetCoreIds.has(coreId)) continue;

      let core = coreCache.get(coreId);
      if (!core) {
        const { data: att } = await supabase
          .from('content_asset_attachment').select('*')
          .eq('content_core_id', coreId).limit(1).maybeSingle();
        if (!att) { coreCache.set(coreId, { att: null }); core = { att: null }; }
        else {
          const { data: ovRows } = await supabase
            .from('content_asset_platform_override')
            .select('platform, override_kind, override_asset_id, override_asset_url')
            .eq('attachment_id', att.id);
          const { data: ca } = await supabase
            .from('content_core_asset').select('asset_url')
            .eq('content_core_id', coreId).eq('asset_id', att.asset_id).maybeSingle();
          const overrides: Record<string, any> = {};
          for (const o of (ovRows as any[]) ?? []) {
            overrides[o.platform] = { kind: o.override_kind, asset_id: o.override_asset_id ?? undefined, asset_url: o.override_asset_url ?? null };
          }
          core = { att, overrides, assetUrl: (ca as any)?.asset_url ?? null };
        }
        coreCache.set(coreId, core);
      }
      if (!core.att) continue;
      inputs.push({
        rowKey: String(r.id),
        intentType: r.intent_type,
        platform: String(sc?.platform || r.platform || '').trim().toLowerCase(),
        assetType: String(r.content_type || sc?.asset_type || 'image'),
        attachment: {
          asset_id: core.att.asset_id,
          asset_url: core.assetUrl,
          override_policy: core.att.override_policy,
          compatibility_policy: core.att.compatibility_policy,
        },
        overrides: core.overrides,
        existingUploadedUrl: typeof sc?.uploaded_media_url === 'string' ? sc.uploaded_media_url : null,
      });
    }
    if (inputs.length === 0) return skipped();

    const result = prepareSharedMediaForPublishing(inputs);

    // Persist content-only patches (uploaded_media_url ONLY).
    const rowById = new Map(rows.map((r) => [String(r.id), r]));
    for (const p of result.patches) {
      const row = rowById.get(p.rowKey);
      if (!row) continue;
      const sc = parse(row.content);
      const next = { ...sc, uploaded_media_url: p.content_patch.uploaded_media_url };
      try {
        await ownedDbTable('daily_content_plans')
          .update({ content: JSON.stringify(next), updated_at: new Date().toISOString() })
          .eq('id', p.rowKey)
          .eq('intent_type', 'creator');
      } catch {
        result.summary.failed += 1;
        if (!result.events.includes('shared_media_prepare_failed')) {
          result.events.push('shared_media_prepare_failed');
        }
      }
    }
    return { ...result, ran: true };
  } catch {
    // Hard fail-closed: orchestration NEVER breaks scheduling.
    return { ...EMPTY_PREPARE, summary: { ...EMPTY_PREPARE.summary }, events: ['shared_media_prepare_failed'], ran: false };
  }
}
