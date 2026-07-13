/**
 * knowledgeContextAssembler.ts — the ONE deterministic context assembler (CKC-001 §2/§3/§4).
 *
 * Given already-composed Company Knowledge domains (from CKRE-003) + the version
 * entity + a consumer request, it produces the canonical KnowledgeContext with
 * ONLY the required knowledge. Pure: no I/O, no AI, no clock — freshness is
 * computed from an injected `now`. This is the single place context is assembled;
 * downstream modules never build their own.
 */

import type { KnowledgeDomain, KnowledgeDomainId } from '../knowledge/companyKnowledgeModel';
import type { KnowledgeEntity } from '../knowledge/companyKnowledgeEntity';
import { deriveKnowledgeLifecycle } from '../knowledge/companyKnowledgeEntity';
import {
  estimateTokens,
  type KnowledgeConsumerId,
  type KnowledgeContext,
  type KnowledgeContextDomain,
  type KnowledgeContextMode,
  type KnowledgeContextRequest,
} from './knowledgeContextContracts';
import { resolveConsumerProfile } from './knowledgeConsumerProfiles';

const SUMMARY_STRING_CAP = 600;
const COMPRESSED_STRING_CAP = 160;
const COMPRESSED_ARRAY_CAP = 10;

/** Deterministic per-mode field optimization (token minimization — §4). Pure. */
function optimizeFields(
  fields: Record<string, unknown>,
  mode: KnowledgeContextMode,
  allow?: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (allow && !allow.includes(k)) continue;
    if (mode === 'full') { out[k] = v; continue; }
    // summary / compressed: drop empty, truncate long values.
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      if (v.trim() === '') continue;
      const cap = mode === 'compressed' ? COMPRESSED_STRING_CAP : SUMMARY_STRING_CAP;
      out[k] = v.length > cap ? v.slice(0, cap) : v;
    } else if (Array.isArray(v)) {
      if (v.length === 0) continue;
      out[k] = mode === 'compressed' ? v.slice(0, COMPRESSED_ARRAY_CAP) : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface AssembleInput {
  companyId: string;
  consumer: KnowledgeConsumerId;
  domains: Record<KnowledgeDomainId, KnowledgeDomain>;
  entity: KnowledgeEntity;
  request: KnowledgeContextRequest;
  currentActiveVersion: number;
  now: string;
}

/**
 * Assemble the canonical context. Deterministic given identical inputs. Applies
 * (in order): domain selection → confidence filtering → field selection → mode
 * optimization, then computes freshness, language match, and token accounting.
 */
export function assembleKnowledgeContext(input: AssembleInput): KnowledgeContext {
  const { companyId, consumer, domains, entity, request, now } = input;
  const profile = resolveConsumerProfile(consumer);

  const explicitFull = request.full === true;
  const mode: KnowledgeContextMode = explicitFull ? 'full' : (request.mode ?? profile.mode);
  const minConfidence = request.minConfidence ?? profile.minConfidence ?? 0;

  // §3 — domain selection: requested domains, else the consumer profile defaults.
  const requested = (request.domains && request.domains.length ? request.domains : profile.domains)
    .filter((d, i, a) => a.indexOf(d) === i); // dedupe, preserve order

  const knowledge = {} as Record<KnowledgeDomainId, KnowledgeContextDomain>;
  const domainsIncluded: KnowledgeDomainId[] = [];
  const domainsDropped: KnowledgeDomainId[] = [];
  let fullTokens = 0;

  for (const domain of requested) {
    const composed = domains[domain];
    if (!composed) { domainsDropped.push(domain); continue; }
    const confidence = Math.max(0, Math.min(100, Number(entity.confidence.byDomain[domain] ?? 0)));

    // Full-object token baseline (what an un-optimized consumer would have sent).
    fullTokens += estimateTokens(composed.fields);

    // §3 — confidence filtering.
    if (minConfidence > 0 && confidence < minConfidence) { domainsDropped.push(domain); continue; }

    const allow = request.fields?.[domain];
    const fields = optimizeFields(composed.fields, mode, allow);
    const sourceFields = mode === 'compressed' ? [] : composed.sourceFields;

    knowledge[domain] = { domain, fields, confidence, sourceFields };
    domainsIncluded.push(domain);
  }

  // §4 — freshness (from injected clock; no Date.now here).
  const createdMs = Date.parse(entity.createdAt);
  const nowMs = Date.parse(now);
  const ageMs = Number.isFinite(createdMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - createdMs) : null;
  const fresh = request.maxAgeMs == null || ageMs == null ? true : ageMs <= request.maxAgeMs;

  // Language (from IDENTITY.language if composed).
  const identity = domains.IDENTITY?.fields ?? {};
  const language = (typeof identity.language === 'string' ? identity.language : null);
  const languageMatch = request.language ? language === request.language : true;

  const servedTokens = estimateTokens(knowledge);
  const saved = Math.max(0, fullTokens - servedTokens);

  return {
    companyId,
    consumer,
    knowledge,
    metadata: {
      version: entity.version,
      lifecycle: deriveKnowledgeLifecycle(entity.lifecycle, entity.version, input.currentActiveVersion),
      confidence: { overall: entity.confidence.overall, byDomain: entity.confidence.byDomain },
      provenance: entity.provenance,
      freshness: { createdAt: entity.createdAt, ageMs, fresh },
      language,
      languageMatch,
      mode,
      domainsIncluded,
      domainsDropped,
      tokens: { served: servedTokens, full: fullTokens, saved },
    },
  };
}
