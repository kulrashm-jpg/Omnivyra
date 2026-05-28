import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { enqueueScheduledPostAt } from '@/backend/scheduler/schedulerService';
import { validateCreatorPublishSemantics } from '@/backend/services/creatorPublishValidation';
import { recordCreatorRenderMetric } from '@/backend/services/creatorRenderObservability';
import { persistCreatorValidationManifest } from '@/backend/services/creatorRenderPersistence';
import {
  getThreadRuntimeMode,
  isMultiRowWriteEnabled,
  isLegacyJoinedWriteSkipped,
  checkEnforceGate,
} from '@/lib/thread/threadRuntimeMode';
import {
  parseThreadNodesPayload,
  coerceThreadContentTypeForPlatform,
} from '@/lib/thread/threadNodeContract';
import { insertThreadAtomic, ThreadInsertError } from '@/lib/thread/threadNodePersistence';
import { openThreadRuntimeTracer } from '@/backend/services/threadRuntime/threadRuntimeInstrumentation';
import { canonicalizeScheduleForDb } from '@/backend/scheduler/schedulingNormalization';
import {
  checkScheduleCharLimit,
  checkScheduleCharLimitForNodes,
} from '@/backend/scheduler/schedulingCharLimitGuard';

async function requireUserId(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  return user.id;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;

    const { companyId, title, content, hashtags, mediaType, mediaUrls, mediaTypes, creatorAttachments, scheduledFor, platform, accountId, contentType, nodes: rawNodes } = req.body;

    if (companyId) {
      const access = await enforceCompanyAccess({ req, res, companyId: String(companyId) });
      if (!access) return;
    }

    if (!content || !scheduledFor || !platform) {
      return res.status(400).json({ error: 'Missing required fields: content, scheduledFor, platform' });
    }

    if (new Date(scheduledFor) <= new Date()) {
      return res.status(400).json({ error: 'Scheduled time must be in the future' });
    }

    // ── Phase 1B.1: thread multi-row branch ─────────────────────────────────
    // When THREAD_MULTI_ROW_RUNTIME is on AND the client sent a `nodes` array
    // with 2+ entries, take the multi-row insert path. In 'shadow' mode the
    // legacy joined insert still runs (source of truth); the multi-row insert
    // happens in parallel for soak verification. In 'enforce' mode ONLY the
    // multi-row insert runs.
    const parsedNodes = parseThreadNodesPayload(rawNodes);
    const isThreadPayload = Boolean(parsedNodes && parsedNodes.length >= 2);
    const runtimeMode = getThreadRuntimeMode();

    const hashtagArray = hashtags
      ? hashtags.split(/\s+/).filter((t: string) => t.startsWith('#'))
      : [];

    const { dbPlatform, dbContentType } = canonicalizeScheduleForDb({
      platform,
      contentType: contentType || 'post',
    });

    // G11 — schedule-time char-limit guard. No-op when SCHEDULE_CHAR_LIMIT_MODE
    // is unset/off (default). In 'warn' mode, logs and continues. In 'enforce'
    // mode, rejects with 422 before the DB constraint surfaces an opaque 500.
    if (isThreadPayload && parsedNodes) {
      const nodeCheck = checkScheduleCharLimitForNodes({
        platform: dbPlatform,
        nodes: parsedNodes,
      });
      if (!nodeCheck.ok) {
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
        console.warn('[scheduler/schedule] char-limit warn (thread)', {
          platform: nodeCheck.platform,
          actualChars: nodeCheck.actualChars,
          maxChars: nodeCheck.maxChars,
          failedPosition: nodeCheck.failedPosition,
        });
      }
    } else {
      const charCheck = checkScheduleCharLimit({
        platform: dbPlatform,
        content: String(content || ''),
      });
      if (!charCheck.ok) {
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
        console.warn('[scheduler/schedule] char-limit warn (single)', {
          platform: charCheck.platform,
          actualChars: charCheck.actualChars,
          maxChars: charCheck.maxChars,
        });
      }
    }

    const normalizedMediaUrls = Array.isArray(mediaUrls)
      ? mediaUrls
          .map((u: unknown) => (typeof u === 'string' ? u.trim() : ''))
          .filter((u: string) => u.length > 0)
      : [];
    const normalizedMediaTypes = Array.isArray(mediaTypes)
      ? mediaTypes
          .map((value: unknown) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value: string) => value.length > 0)
      : [];
    const normalizedCreatorAttachments = Array.isArray(creatorAttachments)
      ? creatorAttachments
          .filter((asset: unknown): asset is Record<string, unknown> => Boolean(asset && typeof asset === 'object' && !Array.isArray(asset)))
          .map((asset) => {
            const compositionIntent = asset.compositionIntent && typeof asset.compositionIntent === 'object'
              ? asset.compositionIntent
              : asset.asset_composition_intent && typeof asset.asset_composition_intent === 'object'
                ? asset.asset_composition_intent
                : null;
            const renderManifest = asset.renderManifest && typeof asset.renderManifest === 'object'
              ? asset.renderManifest
              : asset.render_manifest && typeof asset.render_manifest === 'object'
                ? asset.render_manifest
                : null;
            const validationManifest = asset.validationManifest && typeof asset.validationManifest === 'object'
              ? asset.validationManifest
              : asset.validation_manifest && typeof asset.validation_manifest === 'object'
                ? asset.validation_manifest
                : null;
            const attachmentMode = typeof asset.attachmentMode === 'string'
              ? asset.attachmentMode
              : typeof asset.attachment_mode === 'string'
                ? asset.attachment_mode
                : null;
            const transformIntent = typeof asset.transformIntent === 'string'
              ? asset.transformIntent
              : typeof asset.transform_intent === 'string'
                ? asset.transform_intent
                : null;
            const rendererId = typeof asset.rendererId === 'string'
              ? asset.rendererId
              : typeof asset.renderer_id === 'string'
                ? asset.renderer_id
                : renderManifest && typeof (renderManifest as Record<string, unknown>).rendererId === 'string'
                  ? String((renderManifest as Record<string, unknown>).rendererId)
                  : null;
            return {
            id: typeof asset.id === 'string' ? asset.id : null,
            creatorType: typeof asset.creatorType === 'string' ? asset.creatorType : null,
            attachmentMode,
            attachment_mode: attachmentMode,
            compositionIntent,
            asset_composition_intent: compositionIntent,
            transformIntent,
            transform_intent: transformIntent,
            platformContext: typeof asset.platformContext === 'string' ? asset.platformContext : null,
            renderManifest,
            render_manifest: renderManifest,
            validationManifest,
            validation_manifest: validationManifest,
            renderer_id: rendererId,
          };
        })
      : [];

    const scheduleValidation = validateCreatorPublishSemantics({
      platform: rawPlatform,
      contentType: rawContentType,
      text: content,
      mediaUrls: normalizedMediaUrls,
      creatorAttachmentMetadata: normalizedCreatorAttachments,
    });
    if (scheduleValidation.ok === false) {
      recordCreatorRenderMetric({
        name: 'scheduler_validation_rejection',
        tags: { platform: rawPlatform, contentType: rawContentType, errors: scheduleValidation.errors.join(',') },
      });
      await Promise.all(scheduleValidation.normalizedMetadata.map((entry, index) => persistCreatorValidationManifest({
        rendererId: entry.renderer_id ?? 'unknown-renderer',
        assetType: String(entry.asset_composition_intent?.assetType ?? rawContentType),
        platform: rawPlatform,
        attachmentMode: entry.attachment_mode,
        renderManifest: (entry.render_manifest ?? {}) as unknown as Record<string, unknown>,
        validationManifest: {
          phase: 'schedule_hard_validation',
          ok: false,
          index,
          errors: scheduleValidation.errors,
          warnings: scheduleValidation.warnings,
        },
        auditId: `schedule:${rawPlatform}:${index}`,
      })));
      return res.status(422).json({
        error: 'CREATOR_ATTACHMENT_SCHEDULE_VALIDATION_FAILED',
        errors: scheduleValidation.errors,
        warnings: scheduleValidation.warnings,
      });
    }

    // ── Multi-row path (Phase 1B.1) — runs when flag on AND thread payload ──
    if (isThreadPayload && isMultiRowWriteEnabled() && parsedNodes) {
      // Phase 1B.1A — enforce-mode hard gate. Reject before any rows are
      // inserted to prevent first-segment-only publish (children dormant
      // forever) until 1B.2's orchestrator exists.
      const enforceGate = checkEnforceGate();
      if (!enforceGate.allowed) {
        return res.status(422).json({
          error: 'THREAD_ENFORCE_MODE_BLOCKED',
          message: enforceGate.reason,
        });
      }

      // Observability: open a runtime tracer for this scheduling request.
      // All tracer calls are no-throw — wrapped internally by safeCall.
      const pendingThreadId = `pending_${userId.slice(0, 8)}_${Date.now().toString(36)}`;
      const runtimeTracer = openThreadRuntimeTracer({
        threadId: pendingThreadId,
        companyId: userId,
      });
      const persistStartedAtMs = Date.now();

      try {
        // Phase 1B.1A — atomic dormancy. In shadow mode the multi-row root
        // is created with status='draft' so the cron's direct scan does NOT
        // double-publish alongside the legacy joined row.
        const shadowMode = !isLegacyJoinedWriteSkipped();
        runtimeTracer.recordPersistAttempt({
          detail: `insertThreadAtomic platform=${dbPlatform} node_count=${parsedNodes!.length} mode=${runtimeMode}`,
        });
        const threadResult = await insertThreadAtomic(supabase, {
          user_id: userId,
          social_account_id: accountId ? String(accountId) : null,
          campaign_id: null,  // scheduler/schedule does not carry campaign_id
          platform: dbPlatform,
          scheduled_for: String(scheduledFor),
          title: title || null,
          hashtags: hashtagArray.length ? hashtagArray : null,
          nodes: parsedNodes,
          rootStatus: shadowMode ? 'draft' : 'scheduled',
        });
        runtimeTracer.recordPersistSuccess({
          latencyMs: Date.now() - persistStartedAtMs,
          detail: `root=${threadResult.rootId} nodes=${threadResult.nodeIds.length}`,
        });
        // Emit a node_create event per inserted row so replay reconstruction
        // sees individual nodes, not just the atomic RPC. The rootId is at
        // position 0; subsequent ids align with parsedNodes positions.
        try {
          for (let i = 0; i < threadResult.nodeIds.length; i += 1) {
            const id = threadResult.nodeIds[i];
            const inputNode = parsedNodes!.find((n) => n.position === i);
            runtimeTracer.recordNodeCreate({
              nodeId: id,
              parentNodeId: i === 0 ? null : threadResult.rootId,
              position: inputNode?.position ?? i,
              mode: 'manual',
              detail: `multi-row insert position=${inputNode?.position ?? i}`,
            });
          }
        } catch (_emitErr) {
          /* tracer is no-throw internally; this catch is defensive only */
        }

        // Enqueue the ROOT only in enforce mode (where it has status='scheduled'
        // and is the publish target). In shadow mode the root is dormant
        // ('draft') so enqueueing it would not cause publish — but we skip
        // for clarity and to keep the queue uncluttered.
        if (!shadowMode && accountId) {
          try {
            await enqueueScheduledPostAt(
              threadResult.rootId,
              userId,
              String(accountId),
              String(scheduledFor),
            );
          } catch (enqueueError: any) {
            console.warn('[scheduler/schedule] enqueueScheduledPostAt (thread root) failed (non-fatal):', enqueueError?.message);
          }
        }

        recordCreatorRenderMetric({
          name: 'thread_multi_row_insert',
          tags: {
            mode: runtimeMode,
            platform: dbPlatform,
            node_count: String(parsedNodes.length),
            endpoint: 'scheduler/schedule',
            root_status: shadowMode ? 'draft' : 'scheduled',
          },
        });

        // In 'enforce' mode the legacy joined insert is SKIPPED entirely.
        if (isLegacyJoinedWriteSkipped()) {
          return res.status(201).json({
            id: threadResult.rootId,
            message: 'Thread scheduled successfully',
            data: {
              id: threadResult.rootId,
              platform: dbPlatform,
              content_type: coerceThreadContentTypeForPlatform(dbPlatform),
              scheduled_for: scheduledFor,
              status: 'scheduled',
              thread: { root_id: threadResult.rootId, node_count: parsedNodes.length },
            },
          });
        }
        // In 'shadow' mode fall through to the legacy insert below — multi-row
        // tree is dormant (root status='draft'); legacy joined row remains the
        // publish source-of-truth.
      } catch (threadErr) {
        const err = threadErr as ThreadInsertError;
        runtimeTracer.recordPersistFailure({
          detail: err.message ?? 'unknown thread insert error',
          latencyMs: Date.now() - persistStartedAtMs,
          payload: { code: err.code ?? null },
        });
        // Shadow mode: log and continue with legacy insert (non-fatal).
        // Enforce mode: fail the request — we cannot silently fall back to
        // legacy joined insert when the operator has set enforce.
        if (isLegacyJoinedWriteSkipped()) {
          console.error('[scheduler/schedule] thread multi-row insert failed (enforce mode):', err.message, err.code);
          return res.status(500).json({ error: err.message || 'thread_multi_row_insert_failed' });
        }
        console.warn('[scheduler/schedule] thread multi-row insert failed (shadow mode, non-fatal):', err.message);
      }
    }

    const insertPayload: Record<string, any> = {
      user_id: userId,
      platform: dbPlatform,
      content_type: dbContentType,
      content,
      title: title || null,
      hashtags: hashtagArray.length ? hashtagArray : null,
      media_urls: normalizedMediaUrls.length
        ? normalizedMediaUrls
        : (mediaType && mediaType !== 'none' ? [] : null),
      media_types: normalizedMediaTypes.length ? normalizedMediaTypes : null,
      creator_attachment_metadata: normalizedCreatorAttachments.length ? normalizedCreatorAttachments : null,
      scheduled_for: scheduledFor,
      status: 'scheduled',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (accountId) {
      insertPayload.social_account_id = accountId;
    }

    const { data: newPost, error: insertError } = await supabase
      .from('scheduled_posts')
      .insert(insertPayload)
      .select('id, platform, content, scheduled_for, status')
      .single();

    if (insertError || !newPost) {
      console.error('[scheduler/schedule] insert failed:', insertError);
      return res.status(500).json({ error: insertError?.message || 'Failed to schedule post' });
    }

    if (accountId && newPost?.id) {
      try {
        await enqueueScheduledPostAt(
          newPost.id,
          userId,
          String(accountId),
          String(scheduledFor),
        );
      } catch (enqueueError: any) {
        console.warn('[scheduler/schedule] enqueueScheduledPostAt failed (non-fatal):', enqueueError?.message);
      }
    }

    return res.status(201).json({
      id: newPost.id,
      message: 'Post scheduled successfully',
      data: newPost,
    });

  } catch (error: any) {
    console.error('[scheduler/schedule] error:', error);
    return res.status(500).json({ error: error.message });
  }
}
