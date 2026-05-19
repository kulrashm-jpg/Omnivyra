/**
 * Isolated, hardened replay INGRESS — separate from public ingestion.
 *
 * Public ingestion (/api/website-events/track) is origin/secret-gated and is
 * NOT reused or refactored. This is a distinct ingress that requires an
 * internal HMAC (REPLAY_INGRESS_SECRET) on the exact captured body — so a
 * replay can never enter via the public path and signature integrity is
 * preserved end-to-end.
 *
 * Execution policy (honest, no fabrication):
 *   - service/orchestration targets → real idempotent execution via the
 *     existing executeReplay (atomic-locked, deduped).
 *   - raw ingestion/webhook bytes → captured with replay-origin lineage and
 *     marked `accepted_pending_executor`. Actual byte-write requires a
 *     deployment-provided raw executor; we do NOT silently re-drive the
 *     hardened ingestion write path (that would mean refactoring a stable
 *     system). Nothing is lost — it remains replayable once an executor is
 *     configured.
 */
import crypto from 'crypto';
import { verifyWebhookSignature } from '../webhookSecurityService';
import { recordComplianceAudit } from '../audit/complianceAuditService';
import { executeReplay, type ReplayTarget } from './replayOrchestrationService';
import { captureReplayPayload, type ReplaySource } from './rawReplayCaptureService';
import { executeRawReplay, executeWebhookOrLeadReplay } from './rawReplayExecutorService';

const SERVICE_TARGETS: ReplayTarget[] = ['api_base_rediscovery', 'connection_revalidate', 'normalization'];

export type ReplayIngressStatus =
  | 'executed'
  | 'deduped'
  | 'throttled'
  | 'failed'
  | 'accepted_pending_executor'
  | 'unauthorized'
  | 'ingress_not_configured';

export interface ReplayIngressInput {
  companyId: string;
  source: ReplaySource;
  target: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  /** HMAC of the canonical JSON body, hex. */
  signature?: string;
  /** Where this replay originated (operator/ui/worker) — lineage. */
  replayOrigin: string;
  actorUserId?: string | null;
}

export interface ReplayIngressResult {
  status: ReplayIngressStatus;
  detail: string;
  correlationId?: string;
}

function canonical(input: ReplayIngressInput): string {
  return JSON.stringify({
    companyId: input.companyId,
    source: input.source,
    target: input.target,
    dedupeKey: input.dedupeKey,
    payload: input.payload,
  });
}

/** Verify the internal replay HMAC. Returns false if the secret is unset. */
export function verifyReplaySignature(body: string, signature: string | undefined): boolean {
  const secret = process.env.REPLAY_INGRESS_SECRET;
  if (!secret) return false;
  return verifyWebhookSignature(body, secret, signature);
}

export async function ingestReplay(input: ReplayIngressInput): Promise<ReplayIngressResult> {
  const secret = process.env.REPLAY_INGRESS_SECRET;
  if (!secret) {
    return { status: 'ingress_not_configured', detail: 'REPLAY_INGRESS_SECRET is not set — isolated replay ingress is disabled (capture preserved).' };
  }
  const body = canonical(input);
  if (!verifyReplaySignature(body, input.signature)) {
    return { status: 'unauthorized', detail: 'invalid or missing replay signature' };
  }

  const replayOriginHash = crypto.createHash('sha256').update(input.replayOrigin).digest('hex').slice(0, 16);

  // Service/orchestration targets → real idempotent execution.
  if (SERVICE_TARGETS.includes(input.target as ReplayTarget)) {
    const res = await executeReplay({
      companyId: input.companyId,
      target: input.target as ReplayTarget,
      dedupeKey: input.dedupeKey,
      payload: input.payload,
    });
    const status: ReplayIngressStatus =
      res.status === 'succeeded' ? 'executed'
      : res.status === 'deduped' ? 'deduped'
      : res.status === 'throttled' ? 'throttled'
      : 'failed';
    await recordComplianceAudit({
      companyId: input.companyId,
      actor: { userId: input.actorUserId ?? null, type: input.actorUserId ? 'user' : 'system', label: 'replay-ingress' },
      action: `replay_ingress.${status}`,
      resourceType: 'replay_ingress',
      resourceId: input.dedupeKey,
      entityLineage: ['company', 'replay_ingress', input.source, input.target],
      detail: { source: input.source, target: input.target, replayOriginHash, signaturePreserved: true, outcome: res.status, detail: res.detail },
    }).catch(() => undefined);
    return { status, detail: res.detail, correlationId: res.correlationId };
  }

  // Raw ingestion bytes → ISOLATED idempotent executor (never public ingress).
  // Always capture first so nothing is lost regardless of executor state.
  await captureReplayPayload({
    companyId: input.companyId,
    source: input.source,
    target: input.target,
    dedupeKey: input.dedupeKey,
    payload: input.payload,
    error: 'raw-replay accepted via isolated ingress',
  });

  // Ingestion → canonical idempotent re-inject; webhook/lead/etc → durable
  // exactly-once marker (no provably-idempotent lead sink without refactor).
  const exec = input.source === 'ingestion'
    ? await executeRawReplay({
        companyId: input.companyId,
        source: input.source,
        dedupeKey: input.dedupeKey,
        payload: input.payload,
        replayOrigin: input.replayOrigin,
      })
    : await executeWebhookOrLeadReplay({
        companyId: input.companyId,
        source: input.source,
        dedupeKey: input.dedupeKey,
        replayOrigin: input.replayOrigin,
      });

  // Map executor outcome → ingress status (honest about disabled/unsupported).
  const status: ReplayIngressStatus =
    exec.outcome === 'executed' ? 'executed'
    : exec.outcome === 'idempotent_skip' ? 'deduped'
    : exec.outcome === 'failed' || exec.outcome === 'malformed' ? 'failed'
    : 'accepted_pending_executor'; // executor_disabled | unsupported_source

  const audit = await recordComplianceAudit({
    companyId: input.companyId,
    actor: { userId: input.actorUserId ?? null, type: input.actorUserId ? 'user' : 'system', label: 'replay-ingress' },
    action: `replay_ingress.${status}`,
    resourceType: 'replay_ingress',
    resourceId: input.dedupeKey,
    entityLineage: ['company', 'replay_ingress', input.source, 'raw'],
    detail: { source: input.source, replayOriginHash, signaturePreserved: true, executor: exec.outcome, written: exec.written, detail: exec.detail },
  }).catch(() => ({ correlationId: undefined as string | undefined }));

  return {
    status,
    detail: exec.detail,
    correlationId: (audit as any)?.correlationId,
  };
}
