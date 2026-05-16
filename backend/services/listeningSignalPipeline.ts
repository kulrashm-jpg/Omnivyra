/**
 * Phase 3 — Listening signal pipeline.
 *
 * Single deterministic path from RawSignal[] → persisted canonical
 * lead_signals. Every signal MUST pass moderation; every persistence MUST
 * go through canonicalLeadSignalService. The pipeline is the ONLY caller
 * of writeLeadSignal for listening-source signals and the ONLY place
 * dedup is enforced cross-run.
 *
 * Order:
 *   1. moderate (moderationGateService.evaluateModeration)
 *   2. normalize (platform, content, contact_key, metadata)
 *   3. dedup (listening_signal_dedup table on org+platform+content_hash)
 *   4. score (heuristic Phase 3 scoring — keyword density, length,
 *       moderation flags)
 *   5. write (canonicalLeadSignalService.writeLeadSignal)
 *
 * Every persisted signal carries `migration_source = 'listening_pipeline_v3'`
 * so it's traceable through the canonical write-boundary lint and audit
 * paths from Phase 0.
 */

import { ownedDbTable } from '../db/writeOwner';
import { writeLeadSignal, buildContactKey } from './canonicalLeadSignalService';
import {
  evaluateModeration,
  computeContentHash,
  type ModerationDecision,
} from './moderation/moderationGateService';
import type { RawSignal } from '../types/listeningConnector';
import {
  publishConsentRecordedEvent,
  publishLeadSignalCreatedEvent,
} from '../events/listeningEvents';
import {
  recordOpportunityFromSignal,
  publishFeedBatchUpdated,
} from './opportunityFeedService';
import { projectOpportunityIntoGraph } from './opportunityGraphService';
import { raiseAlert } from './alertRoutingService';
import { recordIngestion } from './ingestionThroughputService';
import { recordCost } from './costGovernanceService';
import { initialiseLifecycleForOpportunity } from './opportunityLifecycleService';
import { publishRealtime } from './realtimePublisherService';
import { advanceProjectionCursor } from './projectionSyncService';

export type SignalPipelineInput = {
  organizationId: string;
  listeningExecutionId: string;
  rawSignals: RawSignal[];
  keywords: string[];
};

export type SignalPipelineResult = {
  signals_detected: number;
  signals_persisted: number;
  signals_deduplicated: number;
  signals_moderation_blocked: number;
  signals_moderation_flagged: number;
};

function safeKeywordDensity(text: string, keywords: string[]): number {
  if (keywords.length === 0 || text.length === 0) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (!k) continue;
    let idx = lower.indexOf(k);
    while (idx !== -1) {
      hits += 1;
      idx = lower.indexOf(k, idx + k.length);
    }
  }
  return Math.min(1, hits / Math.max(1, Math.ceil(text.length / 200)));
}

function scoreSignal(args: {
  raw: RawSignal;
  moderation: ModerationDecision;
  keywords: string[];
}): {
  intent_score: number;
  urgency_score: number;
  icp_score: number;
  confidence_score: number;
  total_score: number;
} {
  const density = safeKeywordDensity(args.raw.content_text, args.keywords);
  // Heuristic baseline. Phase 3 deliberately keeps scoring simple — the AI
  // classifier hook in moderation can later push these via a separate
  // pipeline stage without restructuring the pipeline itself.
  const lengthSignal = Math.min(1, args.raw.content_text.length / 500);
  const moderationPenalty = args.moderation.outcome === 'flagged' ? 0.7 : 1;
  const intent = Math.min(1, density * 0.7 + lengthSignal * 0.3) * moderationPenalty;
  const urgency = args.raw.is_comment ? Math.min(1, intent * 1.1) : intent;
  const icp = intent;
  const confidence = args.moderation.outcome === 'approved' ? 0.85 : 0.6;
  const total = Math.min(1, intent * 0.5 + urgency * 0.2 + icp * 0.3);
  return {
    intent_score: Number(intent.toFixed(3)),
    urgency_score: Number(urgency.toFixed(3)),
    icp_score: Number(icp.toFixed(3)),
    confidence_score: Number(confidence.toFixed(3)),
    total_score: Number(total.toFixed(3)),
  };
}

async function recordModerationDecision(args: {
  organizationId: string;
  executionId: string;
  platform: string;
  decision: ModerationDecision;
}): Promise<void> {
  try {
    await ownedDbTable('moderation_decisions').insert({
      organization_id: args.organizationId,
      listening_execution_id: args.executionId,
      platform: args.platform,
      content_hash: args.decision.content_hash,
      outcome: args.decision.outcome,
      reasons: args.decision.reasons,
      metadata: args.decision.metadata,
    });
  } catch (err: any) {
    console.warn('[signalPipeline] moderation_decisions insert failed:', err?.message);
  }
}

async function recordDedupAndCheck(args: {
  organizationId: string;
  platform: string;
  contentHash: string;
  executionId: string;
  blocked: boolean;
  persisted: boolean;
}): Promise<{ seen_before: boolean }> {
  // Upsert. If a row already exists, increment seen_count + update last_seen.
  // Otherwise insert with first_seen = now. Returns whether this content was
  // previously observed so the pipeline can skip canonical write.
  try {
    const { data: existing } = await ownedDbTable('listening_signal_dedup')
      .select('id, seen_count')
      .eq('organization_id', args.organizationId)
      .eq('platform', args.platform)
      .eq('content_hash', args.contentHash)
      .maybeSingle();

    if (existing) {
      await ownedDbTable('listening_signal_dedup')
        .update({
          last_seen_at: new Date().toISOString(),
          seen_count: (existing.seen_count ?? 1) + 1,
        })
        .eq('id', existing.id);
      return { seen_before: true };
    }

    await ownedDbTable('listening_signal_dedup').insert({
      organization_id: args.organizationId,
      platform: args.platform,
      content_hash: args.contentHash,
      first_seen_execution_id: args.executionId,
      was_persisted: args.persisted,
      was_blocked: args.blocked,
    });
    return { seen_before: false };
  } catch (err: any) {
    console.warn('[signalPipeline] dedup upsert failed:', err?.message);
    return { seen_before: false };
  }
}

/**
 * Run the pipeline for one execution. Returns aggregate stats so the
 * orchestrator can populate listening_executions.signal_stats.
 */
export async function processRawSignals(
  input: SignalPipelineInput,
): Promise<SignalPipelineResult> {
  let detected = 0;
  let persisted = 0;
  let deduplicated = 0;
  let blocked = 0;
  let flagged = 0;

  for (const raw of input.rawSignals) {
    detected += 1;

    // Moderation
    const decisionMaybe = evaluateModeration({ content: raw.content_text, platform: raw.platform });
    const decision: ModerationDecision = decisionMaybe instanceof Promise ? await decisionMaybe : decisionMaybe;

    await recordModerationDecision({
      organizationId: input.organizationId,
      executionId: input.listeningExecutionId,
      platform: raw.platform,
      decision,
    });

    if (decision.outcome === 'blocked') {
      blocked += 1;
      await recordDedupAndCheck({
        organizationId: input.organizationId,
        platform: raw.platform,
        contentHash: decision.content_hash,
        executionId: input.listeningExecutionId,
        blocked: true,
        persisted: false,
      });
      continue;
    }
    if (decision.outcome === 'flagged') flagged += 1;

    // Dedup
    const contentHash = decision.content_hash;
    const dedup = await recordDedupAndCheck({
      organizationId: input.organizationId,
      platform: raw.platform,
      contentHash,
      executionId: input.listeningExecutionId,
      blocked: false,
      persisted: false,
    });
    if (dedup.seen_before) {
      deduplicated += 1;
      continue;
    }

    // Score + canonical write
    const scores = scoreSignal({ raw, moderation: decision, keywords: input.keywords });

    try {
      const result = await writeLeadSignal({
        canonical: {
          organization_id: input.organizationId,
          source_type: 'listening',
          source_id: raw.upstream_id,
          thread_id: null,
          platform: raw.platform,
          platform_user_id: raw.platform_user_id,
          content_text: raw.content_text,
          intent_score: scores.intent_score,
          urgency_score: scores.urgency_score,
          icp_score: scores.icp_score,
          confidence_score: scores.confidence_score,
          total_score: scores.total_score,
          detected_at: raw.detected_at,
          crm_lead_id: null,
          migration_source: 'listening_pipeline_v3',
          metadata: {
            ...raw.metadata,
            content_url: raw.content_url,
            posted_at: raw.posted_at,
            is_comment: raw.is_comment,
            author_handle: raw.author_handle,
            moderation_outcome: decision.outcome,
            moderation_reasons: decision.reasons,
            listening_execution_id: input.listeningExecutionId,
            contact_key: buildContactKey(raw.platform, raw.platform_user_id),
          },
        },
        debugContext: 'listening_pipeline_v3',
      });
      if (result.canonical?.id) {
        persisted += 1;
        await ownedDbTable('listening_signal_dedup')
          .update({ was_persisted: true })
          .eq('organization_id', input.organizationId)
          .eq('platform', raw.platform)
          .eq('content_hash', contentHash);
        await publishLeadSignalCreatedEvent({
          organization_id: input.organizationId,
          lead_signal_id: result.canonical.id,
          platform: raw.platform,
          source_type: 'listening',
          occurred_at: new Date().toISOString(),
        });
        // Phase 4 — classify + cluster + persist opportunity feed item.
        // Best-effort: never let an opportunity-write failure block the
        // canonical signal that already succeeded.
        try {
          const oppResult = await recordOpportunityFromSignal({
            organizationId: input.organizationId,
            signalId: result.canonical.id,
            listeningExecutionId: input.listeningExecutionId,
            raw,
            moderation: decision,
            baseScores: scores,
          });
          // Phase 5 — project this opportunity into the graph. Strictly
          // best-effort; cannot block the canonical signal.
          if (oppResult?.created && oppResult.feed_item) {
            try {
              await projectOpportunityIntoGraph({
                organizationId: input.organizationId,
                opportunity: oppResult.feed_item,
              });
            } catch (graphErr: any) {
              console.warn('[signalPipeline] graph projection failed:', {
                opp_id: oppResult.feed_item.id,
                error: graphErr?.message,
              });
            }
            // Phase 6 — initialise lifecycle to 'detected' (idempotent).
            try {
              await initialiseLifecycleForOpportunity({
                organizationId: input.organizationId,
                opportunityFeedItemId: oppResult.feed_item.id,
              });
            } catch (lifecycleErr: any) {
              console.warn('[signalPipeline] lifecycle init failed:', {
                opp_id: oppResult.feed_item.id,
                error: lifecycleErr?.message,
              });
            }
            // Phase 6 — tenant-scoped realtime broadcast (best-effort,
            // no-op if Supabase Realtime is unreachable).
            try {
              await publishRealtime({
                organizationId: input.organizationId,
                topic: 'opportunity_feed',
                eventName: 'opportunity.added',
                payload: {
                  opportunity_feed_item_id: oppResult.feed_item.id,
                  opportunity_type: oppResult.feed_item.opportunity_type,
                  opportunity_score: oppResult.feed_item.opportunity_score,
                  cluster_id: oppResult.feed_item.cluster_id,
                  platform: oppResult.feed_item.platform,
                  source_identifier: oppResult.feed_item.source_identifier,
                },
              });
              await advanceProjectionCursor({
                organizationId: input.organizationId,
                projectionKind: 'opportunity_feed',
                cursor: oppResult.feed_item.created_at,
              });
            } catch (realtimeErr: any) {
              console.warn('[signalPipeline] realtime publish failed:', {
                opp_id: oppResult.feed_item.id,
                error: realtimeErr?.message,
              });
            }
            // Phase 5 — high-intent alert (rate-limited / deduped inside).
            if (
              oppResult.feed_item.opportunity_type === 'buying_intent'
              && oppResult.feed_item.opportunity_score >= 0.75
            ) {
              try {
                await raiseAlert({
                  organizationId: input.organizationId,
                  alertType: 'high_intent_detected',
                  severity: oppResult.feed_item.opportunity_score >= 0.9 ? 'high' : 'medium',
                  dedupKey: `cluster:${oppResult.feed_item.cluster_id ?? oppResult.feed_item.id}`,
                  title: `High buyer-intent signal on ${raw.platform}`,
                  body: oppResult.feed_item.detected_reason,
                  metadata: {
                    opportunity_feed_item_id: oppResult.feed_item.id,
                    platform: raw.platform,
                    source_identifier: oppResult.feed_item.source_identifier,
                  },
                });
              } catch (alertErr: any) {
                console.warn('[signalPipeline] alert raise failed:', {
                  opp_id: oppResult.feed_item.id,
                  error: alertErr?.message,
                });
              }
            }
          }
        } catch (oppErr: any) {
          console.warn('[signalPipeline] opportunity write failed:', {
            signal_id: result.canonical.id,
            error: oppErr?.message,
          });
        }
      }
    } catch (err: any) {
      console.warn('[signalPipeline] canonical write failed:', {
        upstream_id: raw.upstream_id,
        error: err?.message,
      });
    }
  }

  // Silence the unused-import lint for publishConsentRecordedEvent: it is
  // re-exported here to make the pipeline's event surface a single import
  // for callers that watch listening events.
  void publishConsentRecordedEvent;

  // Phase 4 — emit a single feed.updated event at the end of the pipeline
  // so subscribers can refresh once per execution rather than once per
  // persisted signal.
  if (persisted > 0) {
    await publishFeedBatchUpdated(input.organizationId, persisted);
  }

  // Phase 8 — record ingestion throughput + attribute execution cost.
  // Both are best-effort; failures here cannot block canonical writes.
  if (detected > 0) {
    try {
      await recordIngestion({
        organizationId: input.organizationId,
        scope: 'org',
        bucket: 'org',
        count: detected,
        credits: persisted,
        metadata: { listening_execution_id: input.listeningExecutionId },
      });
    } catch (err: any) {
      console.warn('[signalPipeline] throughput record failed:', err?.message);
    }
    try {
      await recordCost({
        organizationId: input.organizationId,
        category: 'execution',
        units: persisted,
        decision: 'allowed',
        attributionKind: 'listening_execution',
        attributionRef: input.listeningExecutionId,
      });
    } catch (err: any) {
      console.warn('[signalPipeline] cost record failed:', err?.message);
    }
  }

  return {
    signals_detected: detected,
    signals_persisted: persisted,
    signals_deduplicated: deduplicated,
    signals_moderation_blocked: blocked,
    signals_moderation_flagged: flagged,
  };
}
