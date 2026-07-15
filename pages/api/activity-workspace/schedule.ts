import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/activity-workspace/schedule
 * Saves a finalized platform variant as a scheduled_posts row so it appears on the dashboard calendar.
 * If a post already exists for the same execution_id + platform, it is updated in place (idempotent).
 *
 * Falls back to any active social_account for the user when no platform-specific one is found,
 * so inserts succeed even before the social_account_id NOT NULL column is relaxed via DDL.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { enqueueScheduledPostAt } from '@/backend/scheduler/schedulerService';
import { grantEarnCredit } from '@/backend/services/earnCreditsService';
import { ownedDbTable } from '@/backend/db/writeOwner';
// Step-16: automatic pre-enqueue shared-media finalization. OUTSIDE
// scheduler internals, flag-gated, hard fail-closed (cannot break
// scheduling). Content-only Creator writes; Text untouched.
import { runSharedMediaPreEnqueue } from '@/backend/services/creator/media';
import {
  getThreadRuntimeMode,
  isMultiRowWriteEnabled,
  isLegacyJoinedWriteSkipped,
  checkEnforceGate,
} from '@/lib/thread/threadRuntimeMode';
import { parseThreadNodesPayload } from '@/lib/thread/threadNodeContract';
import {
  insertThreadAtomic,
  replaceThreadChildren,
  ThreadInsertError,
} from '@/lib/thread/threadNodePersistence';
import {
  canonicalizePlatformForDb,
  canonicalizeContentTypeForDb,
} from '@/backend/scheduler/schedulingNormalization';
import {
  checkScheduleCharLimit,
  checkScheduleCharLimitForNodes,
} from '@/backend/scheduler/schedulingCharLimitGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('[schedule] method:', req.method, 'url:', req.url);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method not allowed: ${req.method}` });
  }

  // Resolve current user — always use the real Supabase JWT user ID
  // (resolveUserContext can return 'content_architect' for platform-level sessions,
  // which has no social_accounts and cannot schedule posts on behalf of a real user)
  let userId: string;
  try {
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (error || !user?.id) {
      console.warn('[schedule] unauthenticated request');
      return res.status(401).json({ error: 'Authentication required' });
    }
    userId = user.id;
    console.log('[schedule] resolved userId:', userId);
  } catch (authErr) {
    console.error('[schedule] auth error:', authErr);
    return res.status(401).json({ error: 'Authentication required' });
  }

  const {
    executionId,
    platform,
    contentType,
    title,
    content,
    scheduledDate,
    scheduledTime,
    repurposeIndex,
    repurposeTotal,
    nodes: rawNodes,
  } = req.body || {};

  let campaignId: string = String(req.body?.campaignId || '').trim();
  let companyId: string = String(req.body?.companyId || '').trim();

  console.log('[schedule] body:', { campaignId, platform, content: content?.slice?.(0,30), scheduledDate, executionId });

  if (!campaignId || !platform || !content || !scheduledDate) {
    return res.status(400).json({ error: 'campaignId, platform, content, and scheduledDate are required' });
  }

  // Resolve companyId from campaign_versions when the workspace payload didn't supply it
  if (!companyId) {
    const { data: cv, error: cvErr } = await supabase
      .from('campaign_versions')
      .select('company_id')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cvErr) console.warn('[schedule] companyId lookup error:', cvErr);
    companyId = cv?.company_id || '';
    console.log('[schedule] resolved companyId:', companyId);
  }

  // ── Step-16: automatic pre-enqueue shared-media finalization ──────────
  // Runs BEFORE any scheduled_posts persistence / enqueueScheduledPostAt,
  // OUTSIDE scheduler internals. Hard fail-closed: ANY error is swallowed
  // and scheduling proceeds exactly as before. OFF unless the flag is on.
  try {
    const sm = await runSharedMediaPreEnqueue(
      { supabase, ownedDbTable },
      { campaignId, executionId: executionId ? String(executionId) : null },
    );
    if (sm.ran) {
      console.log('[schedule] shared-media pre-enqueue:',
        JSON.stringify({ events: sm.events, ...sm.summary }));
    }
  } catch (smErr: any) {
    // Never block scheduling on media finalization.
    console.warn('[schedule] shared-media pre-enqueue skipped (non-fatal):', smErr?.message);
  }

  const timeStr =
    typeof scheduledTime === 'string' && /^\d{2}:\d{2}/.test(scheduledTime) ? scheduledTime : '09:00';
  // Build UTC timestamp so calendar date-range queries (which use UTC bounds) match correctly
  const scheduledFor = new Date(`${scheduledDate}T${timeStr}:00Z`);
  if (Number.isNaN(scheduledFor.getTime())) {
    return res.status(400).json({ error: 'Invalid scheduledDate' });
  }
  // Only allow scheduling from today onwards (compare on date-only basis).
  // Past DATES belong to work that missed its publish window. Within today,
  // allow any time slot — the scheduler will fire ASAP if the time has passed.
  {
    const requestedDateStr = String(scheduledDate).slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    if (requestedDateStr && requestedDateStr < todayStr) {
      return res.status(400).json({
        error: 'CANNOT_SCHEDULE_IN_PAST',
        message: 'Scheduled date must be today or in the future.',
        requestedDate: requestedDateStr,
        today: todayStr,
      });
    }
  }

  // G7 — canonical platform + content-type normalization (single source of
  // truth in backend/scheduler/schedulingNormalization.ts).
  const platformNorm = canonicalizePlatformForDb(String(platform));
  const executionIdStr = String(executionId || '').trim();

  // Try to resolve a connected social account for this platform.
  // Falls back to any active social account for the user when no platform-specific one exists.
  let socialAccountId: string | null = null;
  try {
    const platformAlias = platformNorm === 'x' ? 'twitter' : platformNorm;
    const isValidUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    // 1a. Platform + company_id scoped lookup (only when companyId is a valid UUID)
    if (!socialAccountId && companyId && isValidUuid(companyId)) {
      const { data, error } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .eq('company_id', companyId)
        .in('platform', [platformNorm, platformAlias])
        .limit(1)
        .maybeSingle();
      if (error) console.warn('[schedule] company-scoped account lookup error:', error.message);
      socialAccountId = data?.id ?? null;
    }

    // 1b. Platform lookup without company scope
    if (!socialAccountId) {
      const { data, error } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .in('platform', [platformNorm, platformAlias])
        .limit(1)
        .maybeSingle();
      if (error) console.warn('[schedule] platform account lookup error:', error.message);
      socialAccountId = data?.id ?? null;
    }

    console.log('[schedule] resolved socialAccountId:', socialAccountId);
  } catch (err) {
    console.warn('[schedule] social account resolution error:', err);
  }

  // socialAccountId may be null — social_account_id is nullable (patch-scheduled-posts-social-account-optional.sql).
  // Publishing workers check for a valid account before posting; UI shows a "Connect" warning badge.
  console.log('[schedule] inserting row with socialAccountId:', socialAccountId, 'campaignId:', campaignId);

  // campaign_id in scheduled_posts is UUID — only include if it looks like a valid UUID
  const isValidUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const campaignIdUuid = isValidUuid(campaignId) ? campaignId : null;
  if (!campaignIdUuid) console.warn('[schedule] campaignId is not a valid UUID, skipping campaign_id column:', campaignId);

  // Base row — columns guaranteed to exist in the initial schema
  const baseRow: Record<string, unknown> = {
    user_id: userId,
    campaign_id: campaignIdUuid,
    platform: platformNorm,
    content_type: canonicalizeContentTypeForDb(platformNorm, String(contentType || 'post')),
    title: String(title || '').trim() || null,
    content: String(content).trim(),
    scheduled_for: scheduledFor.toISOString(),
    status: 'scheduled',
    social_account_id: socialAccountId,
  };

  // Repurpose lineage columns — added by scheduled_posts_repurpose_lineage.sql migration.
  // Only include them when the migration has been applied (detected by insert error on first attempt).
  const repurposeExtras: Record<string, unknown> = {
    repurpose_parent_execution_id: executionIdStr || null,
    repurpose_index: Number.isFinite(Number(repurposeIndex)) ? Number(repurposeIndex) : 1,
    repurpose_total: Number.isFinite(Number(repurposeTotal)) ? Number(repurposeTotal) : 1,
  };

  const tryInsert = async (row: Record<string, unknown>) => {
    return supabase.from('scheduled_posts').insert(row).select('id').single();
  };

  const tryUpdate = async (id: string, row: Record<string, unknown>) => {
    return supabase
      .from('scheduled_posts')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', id);
  };

  // ── Phase 1B.1: thread multi-row branch ─────────────────────────────────
  // SHADOW: multi-row insert runs alongside legacy joined insert below.
  // ENFORCE: multi-row insert runs and we return early; legacy is SKIPPED.
  const parsedNodes = parseThreadNodesPayload(rawNodes);
  const isThreadPayload = Boolean(parsedNodes && parsedNodes.length >= 2);
  const runtimeMode = getThreadRuntimeMode();

  // G11 — schedule-time char-limit guard. No-op when SCHEDULE_CHAR_LIMIT_MODE
  // is unset/off (default). In 'warn' mode logs and continues; in 'enforce'
  // mode rejects with 422 before the DB constraint surfaces an opaque 500.
  if (isThreadPayload && parsedNodes) {
    const nodeCheck = checkScheduleCharLimitForNodes({
      platform: platformNorm,
      nodes: parsedNodes,
    });
    if (nodeCheck.ok === false) {
      if (nodeCheck.shouldReject) {
        return res.status(422).json({
          error: nodeCheck.code,
          message: nodeCheck.message,
          platform: nodeCheck.platform,
          actualChars: nodeCheck.actualChars,
          maxChars: nodeCheck.maxChars,
          excessChars: nodeCheck.excessChars,
          failedPosition: nodeCheck.failedPosition,
        });
      }
      console.warn('[schedule] char-limit warn (thread)', {
        platform: nodeCheck.platform,
        actualChars: nodeCheck.actualChars,
        maxChars: nodeCheck.maxChars,
        failedPosition: nodeCheck.failedPosition,
      });
    }
  } else {
    const charCheck = checkScheduleCharLimit({
      platform: platformNorm,
      content: String(content || ''),
    });
    if (charCheck.ok === false) {
      if (charCheck.shouldReject) {
        return res.status(422).json({
          error: charCheck.code,
          message: charCheck.message,
          platform: charCheck.platform,
          actualChars: charCheck.actualChars,
          maxChars: charCheck.maxChars,
          excessChars: charCheck.excessChars,
        });
      }
      console.warn('[schedule] char-limit warn (single)', {
        platform: charCheck.platform,
        actualChars: charCheck.actualChars,
        maxChars: charCheck.maxChars,
      });
    }
  }

  if (isThreadPayload && isMultiRowWriteEnabled() && parsedNodes) {
    // Phase 1B.1A — enforce-mode hard gate. Reject before any rows are inserted
    // or updated to prevent first-segment-only publish until 1B.2 ships.
    const enforceGate = checkEnforceGate();
    if (enforceGate.allowed === false) {
      return res.status(422).json({
        error: 'THREAD_ENFORCE_MODE_BLOCKED',
        message: enforceGate.reason,
      });
    }

    try {
      // Phase 1B.1A — root status follows the same rule as scheduler/schedule:
      // 'draft' in shadow mode (dormant; legacy joined row publishes),
      // 'scheduled' in enforce mode (the multi-row root IS the publish target).
      const shadowMode = !isLegacyJoinedWriteSkipped();
      const rootStatus: 'draft' | 'scheduled' = shadowMode ? 'draft' : 'scheduled';

      // Dedup at the ROOT level (works the same in shadow and enforce):
      // a prior multi-row representation for the same
      // (campaign_id, platform, title, is_thread_start) is replaced by
      // updating the existing root in place and atomically swapping children.
      const titleNormForRoot = String(title || '').trim();
      let existingRootId: string | null = null;
      if (campaignIdUuid && titleNormForRoot) {
        try {
          const { data: existing } = await supabase
            .from('scheduled_posts')
            .select('id')
            .eq('campaign_id', campaignIdUuid)
            .eq('platform', platformNorm)
            .eq('title', titleNormForRoot)
            .eq('is_thread_start', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          existingRootId = existing?.id ?? null;
        } catch (lookupErr: any) {
          console.warn('[schedule] thread root dedup lookup failed:', lookupErr?.message);
        }
      }

      let rootId: string;
      if (existingRootId) {
        const rootUpdate: Record<string, unknown> = {
          user_id: userId,
          social_account_id: socialAccountId,
          campaign_id: campaignIdUuid,
          platform: platformNorm,
          content_type: platformNorm === 'twitter' ? 'thread' : 'post',
          content: parsedNodes[0].content,
          title: titleNormForRoot || null,
          scheduled_for: scheduledFor.toISOString(),
          status: rootStatus, // Phase 1B.1A: 'draft' in shadow, 'scheduled' in enforce.
          updated_at: new Date().toISOString(),
        };
        const { error: rootUpdateErr } = await supabase
          .from('scheduled_posts')
          .update(rootUpdate)
          .eq('id', existingRootId);
        if (rootUpdateErr) throw new ThreadInsertError(rootUpdateErr.message, rootUpdateErr.code ?? null);
        await replaceThreadChildren(supabase, existingRootId, parsedNodes.slice(1));
        rootId = existingRootId;
      } else {
        const result = await insertThreadAtomic(supabase, {
          user_id: userId,
          social_account_id: socialAccountId,
          campaign_id: campaignIdUuid,
          platform: platformNorm,
          scheduled_for: scheduledFor.toISOString(),
          title: titleNormForRoot || null,
          hashtags: null,
          nodes: parsedNodes,
          rootStatus,
        });
        rootId = result.rootId;
      }

      // Repurpose lineage columns live on the root only. Defensive write
      // (the columns are additive — schema-mismatch is non-fatal).
      try {
        await supabase
          .from('scheduled_posts')
          .update({
            repurpose_parent_execution_id: executionIdStr || null,
            repurpose_index: Number.isFinite(Number(repurposeIndex)) ? Number(repurposeIndex) : 1,
            repurpose_total: Number.isFinite(Number(repurposeTotal)) ? Number(repurposeTotal) : 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', rootId);
      } catch (repurposeErr: any) {
        console.warn('[schedule] repurpose extras update failed on thread root (non-fatal):', repurposeErr?.message);
      }

      if (isLegacyJoinedWriteSkipped()) {
        // ENFORCE: root is status='scheduled' and IS the publish target.
        // Enqueue + return. Children stay 'draft' until 1B.2's orchestrator
        // ships and starts processing them.
        try {
          await enqueueScheduledPostAt(
            rootId,
            userId,
            String(socialAccountId ?? ''),
            scheduledFor.toISOString(),
          );
        } catch (enqErr: any) {
          console.warn('[schedule] enqueueScheduledPostAt (thread root) failed (non-fatal):', enqErr?.message);
        }

        if (rootId && companyId) {
          grantEarnCredit({
            orgId: companyId,
            userId,
            actionType: 'first_campaign_published',
            referenceId: companyId,
          }).catch((e) => console.warn('[schedule] earn-credit grant failed (non-fatal):', e?.message));
        }

        return res.status(200).json({
          success: true,
          scheduled_post_id: rootId,
          thread: { root_id: rootId, node_count: parsedNodes.length, mode: runtimeMode },
        });
      }
      // SHADOW: multi-row root was created with status='draft' (dormant); the
      // cron's direct scan filters it out. Legacy joined row below remains the
      // publish source-of-truth. Do NOT enqueue the dormant root.
    } catch (threadErr: any) {
      const err = threadErr as ThreadInsertError;
      if (isLegacyJoinedWriteSkipped()) {
        console.error('[schedule] thread multi-row insert failed (enforce mode):',
          err?.message, err?.code);
        return res.status(500).json({ error: err?.message || 'thread_multi_row_insert_failed' });
      }
      console.warn('[schedule] thread multi-row insert failed (shadow mode, non-fatal):',
        err?.message, err?.code);
      // Fall through to legacy insert.
    }
  }

  try {
    let scheduledPostId: string | null = null;
    const fullRow = { ...baseRow, ...repurposeExtras };

    // --- Deduplication strategy 1: campaign_id + platform + title ---
    // This catches re-scheduling the same topic on the same platform (columns always exist).
    const titleNorm = String(title || '').trim();
    if (campaignIdUuid && titleNorm) {
      try {
        const { data: existing } = await supabase
          .from('scheduled_posts')
          .select('id')
          .eq('campaign_id', campaignIdUuid)
          .eq('platform', platformNorm)
          .eq('title', titleNorm)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existing?.id) {
          console.log('[schedule] dedup match (campaign+platform+title), updating:', existing.id);
          const { error: updateErr } = await tryUpdate(existing.id, fullRow);
          if (updateErr) {
            const isSchemaErr = updateErr.message?.includes('column') || updateErr.code === '42703'
              || updateErr.message?.includes('operator does not exist') || updateErr.code === '42883';
            if (isSchemaErr) {
              console.warn('[schedule] schema mismatch on update, retrying without repurpose extras:', updateErr.message);
              const { error: retryErr } = await tryUpdate(existing.id, baseRow);
              if (retryErr) {
                console.error('[activity-workspace/schedule] update retry error:', retryErr);
                return res.status(500).json({ error: retryErr.message });
              }
            } else {
              console.error('[activity-workspace/schedule] update error:', updateErr);
              return res.status(500).json({ error: updateErr.message });
            }
          }
          scheduledPostId = existing.id;
        }
      } catch (lookupErr: any) {
        console.warn('[schedule] campaign+platform+title lookup failed:', lookupErr?.message);
      }
    }

    // --- Deduplication strategy 2: repurpose_parent_execution_id + platform (legacy fallback) ---
    if (!scheduledPostId && executionIdStr) {
      try {
        const { data: existing } = await supabase
          .from('scheduled_posts')
          .select('id')
          .eq('repurpose_parent_execution_id', executionIdStr)
          .eq('platform', platformNorm)
          .maybeSingle();

        if (existing?.id) {
          console.log('[schedule] dedup match (repurpose_id+platform), updating:', existing.id);
          const { error: updateErr } = await tryUpdate(existing.id, fullRow);
          if (updateErr) {
            // Retry without repurpose extras for: missing column (42703), type operator errors (42883)
            const isSchemaErr = updateErr.message?.includes('column') || updateErr.code === '42703'
              || updateErr.message?.includes('operator does not exist') || updateErr.code === '42883';
            if (isSchemaErr) {
              console.warn('[schedule] schema mismatch on update, retrying without repurpose extras:', updateErr.message);
              const { error: retryErr } = await tryUpdate(existing.id, baseRow);
              if (retryErr) {
                console.error('[activity-workspace/schedule] update retry error:', retryErr);
                return res.status(500).json({ error: retryErr.message });
              }
            } else {
              console.error('[activity-workspace/schedule] update error:', updateErr);
              return res.status(500).json({ error: updateErr.message });
            }
          }
          scheduledPostId = existing.id;
        }
      } catch (lookupErr: any) {
        // repurpose_parent_execution_id column doesn't exist — skip idempotency check
        console.warn('[schedule] repurpose lookup failed (column may not exist):', lookupErr?.message);
      }
    }

    if (!scheduledPostId) {
      let { data: inserted, error: insertErr } = await tryInsert(fullRow);

      // Retry without repurpose extras for: missing column (42703), type operator errors (42883)
      if (insertErr && (insertErr.message?.includes('column') || insertErr.code === '42703'
        || insertErr.message?.includes('operator does not exist') || insertErr.code === '42883')) {
        console.warn('[schedule] schema mismatch on insert, retrying without repurpose extras:', insertErr.message);
        const retry = await tryInsert(baseRow);
        inserted = retry.data;
        insertErr = retry.error;
      }

      if (insertErr) {
        console.error('[activity-workspace/schedule] insert error:', {
          code: insertErr.code,
          message: insertErr.message,
          details: (insertErr as any).details,
          hint: (insertErr as any).hint,
        });
        return res.status(500).json({ error: insertErr.message });
      }
      scheduledPostId = inserted?.id ?? null;
    }

    // Enqueue the job to fire at the exact scheduled_for time.
    // Falls back gracefully: duplicate → already queued, past → safety-net cron handles it.
    if (scheduledPostId) {
      try {
        await enqueueScheduledPostAt(
          scheduledPostId,
          userId,
          String(socialAccountId ?? ''),
          scheduledFor.toISOString(),
        );
      } catch (enqErr: any) {
        // Non-fatal: the 4-hour safety-net cron will recover missed posts
        console.warn('[schedule] enqueueScheduledPostAt failed (non-fatal):', enqErr?.message);
      }
    }

    // ── First campaign published → +200 credits (fire-and-forget) ────────────
    if (scheduledPostId && companyId) {
      grantEarnCredit({
        orgId:       companyId,
        userId,
        actionType:  'first_campaign_published',
        referenceId: companyId,   // one grant per org, referenceId = orgId
      }).catch(e => console.warn('[schedule] earn-credit grant failed (non-fatal):', e?.message));
    }

    return res.status(200).json({ success: true, scheduled_post_id: scheduledPostId });
  } catch (err: any) {
    console.error('[activity-workspace/schedule]', err);
    return res.status(500).json({ error: err?.message || 'Failed to schedule post' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/activity-workspace/schedule' });
