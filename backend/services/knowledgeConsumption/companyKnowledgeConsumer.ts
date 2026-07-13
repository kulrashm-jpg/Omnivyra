/**
 * companyKnowledgeConsumer.ts — THE canonical Company Knowledge Consumer (CKC-001 §1).
 *
 * The single gateway through which every AI capability obtains Company Knowledge.
 * It orchestrates the consumption pipeline — version selection → cache lookup →
 * deterministic assembly → cache store → events/telemetry — over the EXISTING
 * Company Knowledge API. No module should read or assemble Company Knowledge
 * directly anymore; they call getKnowledgeContext().
 *
 * Deterministic, cache-backed, observable, and fail-safe (returns null rather
 * than throwing when knowledge is unavailable).
 */

import type { KnowledgeConsumerId, KnowledgeContext, KnowledgeContextRequest } from './knowledgeContextContracts';
import { resolveKnowledgeForSelector } from './knowledgeVersionSelector';
import { assembleKnowledgeContext } from './knowledgeContextAssembler';
import { getCachedContext, setCachedContext, invalidateContextCache } from './knowledgeContextCache';
import {
  emitConsumerEvent, recordContextTelemetry, resolveConsumptionCorrelationId,
} from './knowledgeConsumerEvents';

/**
 * Obtain a canonical KnowledgeContext for a consumer request. Never throws;
 * returns null when the company has no resolvable knowledge.
 */
export async function getKnowledgeContext(request: KnowledgeContextRequest): Promise<KnowledgeContext | null> {
  const { companyId } = request;
  const now = request.now ?? new Date().toISOString();
  const cid = request.correlationId ?? (await resolveConsumptionCorrelationId(null, companyId));
  if (!companyId) return null;

  void emitConsumerEvent({ event: 'ContextRequested', outcome: 'allowed', correlationId: cid, companyId, consumer: request.consumer, reason: request.consumer, metadata: { version: request.version?.kind ?? 'latest', mode: request.full ? 'full' : request.mode ?? null } });

  // §6 — cache lookup (unless bypassed).
  if (!request.noCache) {
    const cached = await getCachedContext(request);
    if (cached) {
      void emitConsumerEvent({ event: 'ContextCacheHit', outcome: 'allowed', correlationId: cid, companyId, consumer: request.consumer });
      void emitConsumerEvent({ event: 'ContextServed', outcome: 'allowed', correlationId: cid, companyId, consumer: request.consumer, metadata: { cached: true, version: cached.metadata.version } });
      recordContextTelemetry({ consumer: request.consumer, version: cached.metadata.version, servedTokens: cached.metadata.tokens.served, savedTokens: cached.metadata.tokens.saved, domains: cached.metadata.domainsIncluded });
      return cached;
    }
    void emitConsumerEvent({ event: 'ContextCacheMiss', outcome: 'allowed', correlationId: cid, companyId, consumer: request.consumer });
  }

  // §5 — resolve the requested version to concrete knowledge (existing API).
  const resolved = await resolveKnowledgeForSelector(companyId, request.version);
  if (!resolved) {
    void emitConsumerEvent({ event: 'ContextServed', outcome: 'denied', correlationId: cid, companyId, consumer: request.consumer, reason: 'no_knowledge' });
    return null;
  }

  // §2/§3/§4 — deterministic assembly (filter + optimize).
  const context = assembleKnowledgeContext({
    companyId, consumer: request.consumer,
    domains: resolved.domains, entity: resolved.entity,
    request, currentActiveVersion: resolved.currentActiveVersion, now,
  });

  void emitConsumerEvent({ event: 'ContextAssembled', outcome: 'allowed', correlationId: cid, companyId, consumer: request.consumer, metadata: { version: context.metadata.version, domains: context.metadata.domainsIncluded, tokens: context.metadata.tokens } });

  // §6 — populate the cache (even when the read was bypassed).
  await setCachedContext(request, context);

  void emitConsumerEvent({ event: 'ContextServed', outcome: 'allowed', correlationId: cid, companyId, consumer: request.consumer, metadata: { cached: false, version: context.metadata.version } });
  recordContextTelemetry({ consumer: request.consumer, version: context.metadata.version, servedTokens: context.metadata.tokens.served, savedTokens: context.metadata.tokens.saved, domains: context.metadata.domainsIncluded });

  return context;
}

/** Convenience: fetch context for a consumer with light overrides. */
export async function getKnowledgeContextForConsumer(
  consumer: KnowledgeConsumerId,
  companyId: string,
  overrides: Partial<Omit<KnowledgeContextRequest, 'companyId' | 'consumer'>> = {},
): Promise<KnowledgeContext | null> {
  return getKnowledgeContext({ companyId, consumer, ...overrides });
}

/**
 * Invalidate a company's cached contexts + emit ContextInvalidated. Called by CKRE
 * orchestration when knowledge changes. Never throws.
 */
export async function invalidateKnowledgeContext(companyId: string, reason: string = 'knowledge_changed'): Promise<number> {
  if (!companyId) return 0;
  const removed = await invalidateContextCache(companyId);
  const cid = await resolveConsumptionCorrelationId(null, companyId);
  void emitConsumerEvent({ event: 'ContextInvalidated', outcome: 'allowed', correlationId: cid, companyId, reason, metadata: { removed } });
  return removed;
}
