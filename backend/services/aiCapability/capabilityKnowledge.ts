/**
 * capabilityKnowledge.ts — knowledge acquisition (AIC-001 §3).
 *
 * REUSES CKC-001. No capability reads Company Knowledge directly — every one
 * requests context through the canonical Company Knowledge Consumer. This adapter
 * merges the capability's registered knowledge spec with per-request overrides and
 * calls getKnowledgeContext. It reads knowledge; it never composes it.
 */

import { getKnowledgeContext } from '../knowledgeConsumption/companyKnowledgeConsumer';
import type { KnowledgeContext, KnowledgeContextRequest } from '../knowledgeConsumption/knowledgeContextContracts';
import type { CapabilityDefinition } from './capabilityRegistry';
import type { CapabilityRequest } from './capabilityContracts';

/** The knowledge fetcher the runtime depends on (injectable for tests). */
export type KnowledgeFetcher = (req: KnowledgeContextRequest) => Promise<KnowledgeContext | null>;

export const defaultKnowledgeFetcher: KnowledgeFetcher = getKnowledgeContext;

/**
 * Acquire the capability's knowledge context via CKC-001. Deterministic given a
 * deterministic fetcher. Never throws (returns null on unavailability).
 */
export async function acquireCapabilityKnowledge(
  def: CapabilityDefinition,
  request: CapabilityRequest,
  fetcher: KnowledgeFetcher = defaultKnowledgeFetcher,
): Promise<KnowledgeContext | null> {
  const spec = def.knowledge;
  const o = request.knowledge ?? {};
  const ckcRequest: KnowledgeContextRequest = {
    companyId: request.companyId,
    consumer: spec.consumer,
    domains: o.domains ?? spec.domains,
    minConfidence: o.minConfidence ?? spec.minConfidence,
    maxAgeMs: o.maxAgeMs ?? spec.maxAgeMs,
    language: o.language,
    mode: o.mode ?? spec.mode,
    version: o.version,
    now: request.now,
    correlationId: request.correlationId,
  };
  try {
    return await fetcher(ckcRequest);
  } catch {
    return null;
  }
}
