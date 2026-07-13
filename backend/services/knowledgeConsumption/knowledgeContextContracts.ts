/**
 * knowledgeContextContracts.ts — canonical downstream contracts (CKC-001 §7).
 *
 * ONE shape every AI capability receives when it consumes Company Knowledge. No
 * custom per-module formats. The contract carries the knowledge itself plus the
 * metadata every consumer needs to reason about it: version, confidence,
 * provenance, and freshness. Pure types + deterministic helpers only.
 *
 * This layer CONSUMES the existing Company Knowledge API (CKRE-003); it defines
 * no new knowledge and stores nothing.
 */

import type { KnowledgeDomainId } from '../knowledge/companyKnowledgeModel';
import type { KnowledgeProvenanceRef, KnowledgeLifecycleState } from '../knowledge/companyKnowledgeEntity';

/** Known first-class consumers (extensible — any string is accepted). */
export type KnowledgeConsumerId =
  | 'CONTENT_WRITER'
  | 'CONTENT_CREATOR'
  | 'CAMPAIGN_PLANNER'
  | 'STRATEGIC_MIX'
  | 'SEO'
  | 'GROWTH_INTELLIGENCE'
  | 'RECOMMENDATION_ENGINE'
  | 'COMPETITOR_INTELLIGENCE'
  | 'WEBSITE_INTELLIGENCE'
  | (string & {});

/** Context assembly modes (token optimization — §4). */
export type KnowledgeContextMode = 'full' | 'summary' | 'compressed';

/** Version selection strategy (§5). */
export type KnowledgeVersionSelector =
  | { kind: 'latest' }
  | { kind: 'specific'; version: number }
  | { kind: 'approved' }
  | { kind: 'rollback'; version: number }
  | { kind: 'preview'; version: number }
  | { kind: 'comparison'; fromVersion: number | null; toVersion: number };

/** A consumer's request for knowledge context (§3). */
export interface KnowledgeContextRequest {
  companyId: string;
  consumer: KnowledgeConsumerId;
  /** Required domains. Omit/empty → the consumer profile's default domains. */
  domains?: KnowledgeDomainId[];
  /** Per-domain field allow-list (field selection — §4). */
  fields?: Partial<Record<KnowledgeDomainId, string[]>>;
  /** Minimum per-domain confidence (0–100); domains below are dropped (§3). */
  minConfidence?: number;
  /** Maximum acceptable age in ms; older context is flagged not-fresh (§3). */
  maxAgeMs?: number;
  /** Required content language (e.g. 'en'); mismatch is flagged (§3). */
  language?: string;
  /** Version selection (§5). Defaults to latest. */
  version?: KnowledgeVersionSelector;
  /** Token-optimization mode (§4). Defaults to the consumer profile's mode. */
  mode?: KnowledgeContextMode;
  /** Explicitly request the COMPLETE knowledge object (overrides minimization). */
  full?: boolean;
  /** Bypass the context cache for this request (still populates it). */
  noCache?: boolean;
  /** Injected clock for deterministic freshness. Defaults to now at the boundary. */
  now?: string;
  correlationId?: string;
}

/** Per-domain payload delivered to the consumer. */
export interface KnowledgeContextDomain {
  domain: KnowledgeDomainId;
  fields: Record<string, unknown>;
  confidence: number;
  sourceFields: string[];
}

/** Metadata every consumer receives alongside the knowledge (§7). */
export interface KnowledgeContextMetadata {
  version: number;
  lifecycle: KnowledgeLifecycleState;
  confidence: { overall: number; byDomain: Partial<Record<KnowledgeDomainId, number>> };
  provenance: KnowledgeProvenanceRef | null;
  freshness: {
    createdAt: string;
    ageMs: number | null;
    fresh: boolean;
  };
  language: string | null;
  languageMatch: boolean;
  mode: KnowledgeContextMode;
  domainsIncluded: KnowledgeDomainId[];
  domainsDropped: KnowledgeDomainId[];
  /** Estimated tokens of the served context vs the full object (§4/§9). */
  tokens: { served: number; full: number; saved: number };
}

/** THE canonical context object every AI module receives (§7). No custom formats. */
export interface KnowledgeContext {
  companyId: string;
  consumer: KnowledgeConsumerId;
  knowledge: Record<KnowledgeDomainId, KnowledgeContextDomain>;
  metadata: KnowledgeContextMetadata;
}

/** Deterministic token estimate (~4 chars/token). Pure. */
export function estimateTokens(value: unknown): number {
  const json = JSON.stringify(value ?? null);
  return Math.ceil((json ? json.length : 0) / 4);
}
