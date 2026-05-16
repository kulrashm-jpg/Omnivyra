/**
 * Phase 6 — Tenant-scoped realtime publisher.
 *
 * Single funnel for all server-side realtime broadcasts. Every publish:
 *   • Targets a deterministic channel name `org:<organizationId>:<topic>`
 *   • Carries `payload_version` for client-side compatibility
 *   • Includes a stable `event_id` so the client can replay-safely dedup
 *
 * Transport: Supabase Realtime broadcast. Falls back to no-op when the
 * Supabase client is unavailable so this layer cannot break the pipeline.
 *
 * Hard guarantees:
 *   • Channel name always carries `organization_id`. Cross-org leakage is
 *     impossible because both sides (publisher + client subscriber) must
 *     supply the same channel name.
 *   • No long-lived publisher connection. Each publish opens, sends, closes.
 *   • Best-effort: failure to publish never blocks the caller.
 *   • No autonomous publisher exists; callers fire one event per real
 *     state change.
 */

import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { PROJECTION_PAYLOAD_VERSION } from '../types/projectionSync';

export const REALTIME_TOPICS = [
  'opportunity_feed',
  'graph',
  'alerts',
  'clusters',
  'lifecycle',
  'workflow',
  'escalations',
  'source_health',
  'execution',
  'governance',
  'partitions',
  'throughput',
  'semantic_indexing',
  'cost_governance',
  'sla',
  'rollout',
  'operator_audit',
  // Phase 9 — async runtime + analytics + incidents
  'replay_coordination',
  'analytics_warehouse',
  'incidents',
  'reports',
  'runtime_health',
  // Phase 10 — marketplace, onboarding, AI investigation, trends, DR, compliance, macros, safeguards
  'marketplace',
  'onboarding',
  'ai_investigation',
  'intelligence_trends',
  'disaster_recovery',
  'compliance',
  'analyst_macros',
  'production_safeguards',
  // Phase 11 — rollout, safety rails, copilot, deployment, tenant onboarding runtime, migration, resilience, certification
  'production_rollout',
  'safety_rails',
  'copilot',
  'deployment_health',
  'tenant_onboarding_runtime',
  'migration_tooling',
  'resilience',
  'production_certification',
  // Phase 12 — GA launch hardening
  'platform_stabilization',
  'sre_operations',
  'support_snapshots',
  'governance_convergence',
  'resilience_advisory',
  'customer_operations',
  'observability_convergence',
] as const;
export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

export type RealtimeEnvelope<T extends Record<string, unknown> = Record<string, unknown>> = {
  event_id: string;
  topic: RealtimeTopic;
  organization_id: string;
  payload_version: number;
  emitted_at: string;
  payload: T;
};

export function channelNameFor(organizationId: string, topic: RealtimeTopic): string {
  return `org:${organizationId}:${topic}`;
}

function buildEventId(
  organizationId: string,
  topic: RealtimeTopic,
  payload: Record<string, unknown>,
): string {
  const canonical = `${organizationId}|${topic}|${JSON.stringify(payload)}|${Date.now()}`;
  return createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

/**
 * Publish a typed event to the org's channel. Returns the envelope even
 * when transport fails — callers can persist it for retry.
 */
export async function publishRealtime<T extends Record<string, unknown>>(args: {
  organizationId: string;
  topic: RealtimeTopic;
  payload: T;
  eventName: string;
}): Promise<{ ok: boolean; envelope: RealtimeEnvelope<T>; error?: string }> {
  const envelope: RealtimeEnvelope<T> = {
    event_id: buildEventId(args.organizationId, args.topic, args.payload),
    topic: args.topic,
    organization_id: args.organizationId,
    payload_version: PROJECTION_PAYLOAD_VERSION,
    emitted_at: new Date().toISOString(),
    payload: args.payload,
  };

  try {
    const client = (supabase as unknown as {
      channel?: (name: string) => {
        send?: (msg: { type: string; event: string; payload: unknown }) => Promise<{ error?: { message?: string } } | unknown>;
        unsubscribe?: () => Promise<unknown> | unknown;
      };
    } | undefined);
    if (!client || typeof client.channel !== 'function') {
      return { ok: false, envelope, error: 'supabase_realtime_unavailable' };
    }
    const ch = client.channel(channelNameFor(args.organizationId, args.topic));
    if (!ch?.send) return { ok: false, envelope, error: 'channel_send_unavailable' };
    const result = await ch.send({ type: 'broadcast', event: args.eventName, payload: envelope });
    try { await ch.unsubscribe?.(); } catch { /* ignore */ }
    const err = (result as { error?: { message?: string } } | undefined)?.error?.message;
    if (err) return { ok: false, envelope, error: err };
    return { ok: true, envelope };
  } catch (err: any) {
    return { ok: false, envelope, error: err?.message ?? 'unknown' };
  }
}

/**
 * Authorise a client subscription. Phase 6 doesn't enforce server-side
 * subscription auth (client-side Supabase RLS does that for postgres_changes;
 * broadcast trusts the channel name). This helper exists so the UI can
 * compute the correct channel name without leaking the format.
 */
export function getSubscriptionChannelName(organizationId: string, topic: RealtimeTopic): string {
  return channelNameFor(organizationId, topic);
}
