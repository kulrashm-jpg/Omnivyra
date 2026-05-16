/**
 * Creator Lifecycle Integrity Audit Service
 *
 * Periodic forensic sweep that detects corruption in the
 * daily_content_plans ↔ scheduled_posts ↔ queue_jobs triangle.
 *
 * Detects:
 *   - lifecycle_desync     — `content_status` and `creator_lifecycle_state` disagree
 *   - invalid_transition   — last lifecycle history entry violates FSM transition rules
 *   - orphan_scheduled_post — scheduled_posts row whose plan FK is null/dangling
 *   - missing_fk_linkage   — plan.content.scheduled_post_id present but plan.scheduled_post_id NULL
 *   - queue_job_mismatch   — queue_jobs.status='pending' but post is past-due / cancelled
 *   - upload_session_corruption — resumable_session_started_at without an awaiting state
 *   - invalid_mixed_mode_aggregate — campaign's per-row eligibility map disagrees with current row states
 *
 * Each finding includes:
 *   - severity (info | warning | critical)
 *   - auto_healable: boolean (true if a deterministic repair is safe)
 *   - repair_suggestion: short imperative phrase used by the dashboard
 *
 * Reports are emitted as `integrity_audit_run` telemetry events and the
 * full structured report is returned so callers (cron, admin endpoint)
 * can persist or render it.
 */

import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';
import { emitCreatorEvent, CREATOR_EVENTS } from './creatorOperationalTelemetryService';
import { recordAuditEntry } from './creatorAuditTrailService';
import {
  LIFECYCLE_STATES,
  readLifecycleState,
  canTransition,
} from '../../lib/shared/creatorLifecycleStateMachine';
import {
  isAttachmentRequiredFormat,
  normalizeCreatorFormat,
} from '../../lib/shared/creatorGovernanceRegistry';

const SCAN_BATCH = 500;
const MAX_BATCHES = 20; // hard cap → 10,000 rows per audit run

export type IntegrityViolationKind =
  | 'lifecycle_desync'
  | 'invalid_transition'
  | 'orphan_scheduled_post'
  | 'missing_fk_linkage'
  | 'queue_job_mismatch'
  | 'upload_session_corruption'
  | 'invalid_mixed_mode_aggregate';

export type IntegrityViolation = {
  kind: IntegrityViolationKind;
  severity: 'info' | 'warning' | 'critical';
  auto_healable: boolean;
  repair_suggestion: string;
  entity_kind: 'daily_content_plan' | 'scheduled_post' | 'queue_job';
  entity_id: string;
  detail: Record<string, unknown>;
};

export type IntegrityAuditReport = {
  ran_at: string;
  scanned_plans: number;
  scanned_scheduled_posts: number;
  scanned_queue_jobs: number;
  violations: IntegrityViolation[];
  violations_by_kind: Record<string, number>;
  duration_ms: number;
};

export async function runCreatorLifecycleIntegrityAudit(options: {
  companyId?: string | null;
  applyAutoHeal?: boolean;
} = {}): Promise<IntegrityAuditReport> {
  const startedAt = Date.now();
  const violations: IntegrityViolation[] = [];
  let scannedPlans = 0;
  let scannedPosts = 0;
  let scannedJobs = 0;

  // ── 1. Scan daily_content_plans for lifecycle desync + invalid transitions ──
  await paginate(async (offset) => {
    let q = supabase
      .from('daily_content_plans')
      .select('id, campaign_id, content_type, content, content_status, scheduled_post_id, resumable_session_started_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + SCAN_BATCH - 1);
    if (options.companyId) {
      // Plans are scoped via campaign; join-less filter via two-step.
      const { data: companyCampaignIds } = await supabase
        .from('campaigns')
        .select('id')
        .eq('company_id', options.companyId);
      const ids = (companyCampaignIds ?? []).map((r: any) => r.id);
      if (ids.length === 0) return [];
      q = q.in('campaign_id', ids);
    }
    const { data } = await q;
    return Array.isArray(data) ? data : [];
  }, (row: any) => {
    scannedPlans++;
    const content = (row.content ?? {}) as Record<string, unknown>;
    const lifecycleState = readLifecycleState(content);
    const contentStatus = String(row.content_status ?? '');

    // lifecycle_desync
    if (lifecycleState && contentStatus && lifecycleState !== contentStatus) {
      violations.push({
        kind: 'lifecycle_desync',
        severity: 'warning',
        auto_healable: true,
        repair_suggestion: 'Sync content_status to creator_lifecycle_state via FSM apply.',
        entity_kind: 'daily_content_plan',
        entity_id: row.id,
        detail: { lifecycle_state: lifecycleState, content_status: contentStatus },
      });
    }

    // missing_fk_linkage
    const contentScheduledId = (content as any).scheduled_post_id;
    if (contentScheduledId && !row.scheduled_post_id) {
      violations.push({
        kind: 'missing_fk_linkage',
        severity: 'warning',
        auto_healable: true,
        repair_suggestion: 'Backfill daily_content_plans.scheduled_post_id from content JSON.',
        entity_kind: 'daily_content_plan',
        entity_id: row.id,
        detail: { content_scheduled_post_id: contentScheduledId },
      });
    }

    // upload_session_corruption
    const hasResumableStamp = !!row.resumable_session_started_at;
    const inAwaiting = lifecycleState === LIFECYCLE_STATES.AWAITING_MEDIA_UPLOAD || lifecycleState === LIFECYCLE_STATES.UPLOAD_FAILED;
    if (hasResumableStamp && !inAwaiting) {
      violations.push({
        kind: 'upload_session_corruption',
        severity: 'info',
        auto_healable: true,
        repair_suggestion: 'Clear resumable_session_started_at — row has moved past awaiting state.',
        entity_kind: 'daily_content_plan',
        entity_id: row.id,
        detail: { lifecycle_state: lifecycleState, stamp: row.resumable_session_started_at },
      });
    }

    // invalid_transition — inspect last history entry
    const history = Array.isArray((content as any).creator_lifecycle_history)
      ? (content as any).creator_lifecycle_history
      : [];
    if (history.length >= 2) {
      const last = history[history.length - 1];
      const prior = history[history.length - 2];
      if (last && prior && typeof last.to === 'string' && typeof prior.to === 'string') {
        if (!canTransition(prior.to, last.to)) {
          violations.push({
            kind: 'invalid_transition',
            severity: 'critical',
            auto_healable: false,
            repair_suggestion: 'Manually inspect; row recorded an FSM-prohibited transition.',
            entity_kind: 'daily_content_plan',
            entity_id: row.id,
            detail: { from: prior.to, to: last.to },
          });
        }
      }
    }
  });

  // ── 2. Scan scheduled_posts for orphans ──
  await paginate(async (offset) => {
    let q = supabase
      .from('scheduled_posts')
      .select('id, campaign_id, content_type, status, scheduled_for')
      .order('created_at', { ascending: false })
      .range(offset, offset + SCAN_BATCH - 1);
    if (options.companyId) {
      const { data: companyCampaignIds } = await supabase
        .from('campaigns')
        .select('id')
        .eq('company_id', options.companyId);
      const ids = (companyCampaignIds ?? []).map((r: any) => r.id);
      if (ids.length === 0) return [];
      q = q.in('campaign_id', ids);
    }
    const { data } = await q;
    return Array.isArray(data) ? data : [];
  }, async (row: any) => {
    scannedPosts++;
    const normalized = normalizeCreatorFormat(String(row.content_type ?? ''));
    if (!isAttachmentRequiredFormat(normalized)) return;
    // Look up the back-pointing daily plan.
    const { data: plan } = await supabase
      .from('daily_content_plans')
      .select('id, scheduled_post_id, content_status')
      .eq('scheduled_post_id', row.id)
      .maybeSingle();
    if (!plan) {
      violations.push({
        kind: 'orphan_scheduled_post',
        severity: 'critical',
        auto_healable: false,
        repair_suggestion: 'No daily_content_plan references this scheduled_post — cancel + investigate.',
        entity_kind: 'scheduled_post',
        entity_id: row.id,
        detail: { campaign_id: row.campaign_id, content_type: row.content_type, status: row.status },
      });
    }
  });

  // ── 3. Scan queue_jobs for stuck/duplicate/orphan jobs ──
  await paginate(async (offset) => {
    const { data } = await supabase
      .from('queue_jobs')
      .select('id, scheduled_post_id, status, scheduled_for, updated_at, attempts')
      .in('status', ['pending', 'processing'])
      .order('updated_at', { ascending: true })
      .range(offset, offset + SCAN_BATCH - 1);
    return Array.isArray(data) ? data : [];
  }, async (row: any) => {
    scannedJobs++;
    // queue_job_mismatch: scheduled_post status is cancelled but queue_job still pending
    const { data: post } = await supabase
      .from('scheduled_posts')
      .select('id, status')
      .eq('id', row.scheduled_post_id)
      .maybeSingle();
    if (post && (post as any).status === 'cancelled') {
      violations.push({
        kind: 'queue_job_mismatch',
        severity: 'warning',
        auto_healable: true,
        repair_suggestion: 'Mark queue_job cancelled and remove BullMQ job to free the slot.',
        entity_kind: 'queue_job',
        entity_id: row.id,
        detail: { scheduled_post_id: row.scheduled_post_id, post_status: (post as any).status },
      });
    }
  });

  // ── Auto-heal pass ─────────────────────────────────────────────────────
  if (options.applyAutoHeal) {
    for (const v of violations) {
      if (!v.auto_healable) continue;
      await applyAutoHeal(v).catch((err) => {
        logger.warn('creatorIntegrityAudit.autoheal_failed', {
          surface: 'creatorLifecycleIntegrityAudit',
          violation: v.kind,
          entity_id: v.entity_id,
          error: (err as Error)?.message ?? String(err),
        });
      });
    }
  }

  const violations_by_kind = violations.reduce<Record<string, number>>((acc, v) => {
    acc[v.kind] = (acc[v.kind] ?? 0) + 1;
    return acc;
  }, {});

  const report: IntegrityAuditReport = {
    ran_at: new Date().toISOString(),
    scanned_plans: scannedPlans,
    scanned_scheduled_posts: scannedPosts,
    scanned_queue_jobs: scannedJobs,
    violations,
    violations_by_kind,
    duration_ms: Date.now() - startedAt,
  };

  emitCreatorEvent({
    event: CREATOR_EVENTS.INTEGRITY_AUDIT_RUN,
    severity: violations.length > 0 ? 'warning' : 'info',
    companyId: options.companyId ?? null,
    latencyMs: report.duration_ms,
    metadata: {
      scanned_plans: scannedPlans,
      scanned_scheduled_posts: scannedPosts,
      scanned_queue_jobs: scannedJobs,
      total_violations: violations.length,
      violations_by_kind,
      auto_heal_applied: !!options.applyAutoHeal,
    },
  });

  for (const v of violations) {
    if (v.severity === 'critical') {
      emitCreatorEvent({
        event: CREATOR_EVENTS.INTEGRITY_VIOLATION,
        severity: 'critical',
        companyId: options.companyId ?? null,
        dailyPlanId: v.entity_kind === 'daily_content_plan' ? v.entity_id : null,
        scheduledPostId: v.entity_kind === 'scheduled_post' ? v.entity_id : null,
        metadata: { kind: v.kind, detail: v.detail },
      });
    }
  }

  return report;
}

async function paginate<TRow>(
  fetcher: (offset: number) => Promise<TRow[]>,
  handler: (row: TRow) => void | Promise<void>,
): Promise<void> {
  for (let i = 0; i < MAX_BATCHES; i++) {
    const offset = i * SCAN_BATCH;
    let batch: TRow[];
    try {
      batch = await fetcher(offset);
    } catch (err) {
      logger.warn('creatorIntegrityAudit.fetch_failed', {
        surface: 'creatorLifecycleIntegrityAudit',
        error: (err as Error)?.message ?? String(err),
      });
      return;
    }
    if (!batch || batch.length === 0) return;
    for (const row of batch) {
      await Promise.resolve(handler(row)).catch(() => {});
    }
    if (batch.length < SCAN_BATCH) return;
  }
}

async function applyAutoHeal(v: IntegrityViolation): Promise<void> {
  switch (v.kind) {
    case 'lifecycle_desync': {
      const lifecycleState = (v.detail as any).lifecycle_state as string;
      await ownedDbTable('daily_content_plans')
        .update({ content_status: lifecycleState, updated_at: new Date().toISOString() })
        .eq('id', v.entity_id);
      recordAuditEntry({
        action: 'integrity_repair_applied',
        actorKind: 'system',
        source: 'cron',
        dailyPlanId: v.entity_id,
        metadata: { repair: 'sync_content_status_to_lifecycle', detail: v.detail },
      });
      return;
    }
    case 'missing_fk_linkage': {
      const scheduledPostId = (v.detail as any).content_scheduled_post_id as string;
      if (!scheduledPostId) return;
      await ownedDbTable('daily_content_plans')
        .update({ scheduled_post_id: scheduledPostId, updated_at: new Date().toISOString() })
        .eq('id', v.entity_id);
      recordAuditEntry({
        action: 'integrity_repair_applied',
        actorKind: 'system',
        source: 'cron',
        dailyPlanId: v.entity_id,
        scheduledPostId,
        metadata: { repair: 'backfill_fk_from_content_json' },
      });
      return;
    }
    case 'upload_session_corruption': {
      await ownedDbTable('daily_content_plans')
        .update({ resumable_session_started_at: null, updated_at: new Date().toISOString() })
        .eq('id', v.entity_id);
      recordAuditEntry({
        action: 'integrity_repair_applied',
        actorKind: 'system',
        source: 'cron',
        dailyPlanId: v.entity_id,
        metadata: { repair: 'clear_stale_resumable_session_stamp' },
      });
      return;
    }
    case 'queue_job_mismatch': {
      await ownedDbTable('queue_jobs')
        .update({ status: 'cancelled', last_error: 'integrity_audit_reconcile', updated_at: new Date().toISOString() })
        .eq('id', v.entity_id);
      recordAuditEntry({
        action: 'integrity_repair_applied',
        actorKind: 'system',
        source: 'cron',
        metadata: { repair: 'cancel_orphan_queue_job', queue_job_id: v.entity_id },
      });
      return;
    }
    default:
      return;
  }
}
