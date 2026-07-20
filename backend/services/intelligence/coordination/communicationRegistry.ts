/**
 * Coordination Intelligence Layer — the canonical CommunicationRegistry.
 *
 * The shared coordination mechanism. It records communication *intents* and
 * answers "has this company already communicated this intent?" semantically. It
 * generates no content and couples to no module — every consumer (Writer,
 * Campaigns, Creator, Engagement, Analytics, MarketPulse) depends only on the
 * `CommunicationRegistry` interface.
 *
 * Design guarantees (mirroring the platform's fail-open runtime):
 *  - Tenant-scoped: a missing companyId is a typed `TENANT_REQUIRED` error, never
 *    a cross-tenant read.
 *  - Fail-safe: failures return a typed `CoordinationResult` error; the registry
 *    never throws into a consumer's critical path.
 *  - Never fabricates: duplicate-intent verdicts degrade to `not_evaluable` when
 *    they cannot be substantiated semantically.
 *  - Additive/inert by default: the in-memory store + embedding-off comparator
 *    make the foundation state completely side-effect-free.
 */
import { randomUUID } from 'crypto';
import { AiError } from '../../ai/safety';
import type {
  CommunicationRegistry,
  CommunicationRecord,
  CoordinationQuery,
  CoordinationResult,
  CoordinationStore,
  DuplicateIntentVerdict,
  PublicationStatus,
  RegisterCommunicationInput,
  SemanticEmbeddingRef,
  SemanticIntentComparator,
} from './coordinationContracts';
import { deriveSemanticRootId } from './coordinationKeys';
import { evaluateDuplicateIntent } from './duplicateIntentDetector';
import { embeddingSeamComparator } from './semanticIntentComparator';
import { isCoordinationPersistEnabled } from './coordinationFlags';
import { InMemoryCoordinationStore } from './stores/inMemoryCoordinationStore';
import { SupabaseCoordinationStore } from './stores/supabaseCoordinationStore';
import {
  recordCoordinationRegister,
  recordDuplicateIntentDecision,
  recordCoordinationDegrade,
} from './coordinationObservability';

const EMBEDDING_PROVIDER = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const DEFAULT_CANDIDATE_LIMIT = 200;

export interface CommunicationRegistryDeps {
  store?: CoordinationStore;
  comparator?: SemanticIntentComparator;
  /** Injectable clock (ISO string) for deterministic tests. */
  now?: () => string;
  /** How many prior records to consider as duplicate candidates. */
  candidateLimit?: number;
}

function ok<T>(value: T): CoordinationResult<T> { return { ok: true, value }; }
function fail<T>(error: AiError): CoordinationResult<T> { return { ok: false, error }; }

function requireTenant(companyId: string | undefined | null): AiError | null {
  if (typeof companyId === 'string' && companyId.length > 0) return null;
  return new AiError('TENANT_REQUIRED', { devDetail: 'coordination: companyId is required' });
}

class CommunicationRegistryImpl implements CommunicationRegistry {
  private readonly store: CoordinationStore;
  private readonly comparator: SemanticIntentComparator;
  private readonly now: () => string;
  private readonly candidateLimit: number;

  constructor(deps: CommunicationRegistryDeps) {
    this.store = deps.store ?? new InMemoryCoordinationStore();
    this.comparator = deps.comparator ?? embeddingSeamComparator;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.candidateLimit = deps.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
  }

  /** Resolve the semantic root + embedding for an input (shared by register/check). */
  private async materialize(input: RegisterCommunicationInput): Promise<{
    semanticRootId: string;
    embedding: SemanticEmbeddingRef | null;
  }> {
    const semanticRootId = input.semanticRootId?.trim()
      || deriveSemanticRootId({
        companyId: input.companyId,
        communicationIntent: input.communicationIntent,
        campaignId: input.campaignId,
        topic: input.topic,
      });

    // Caller may pre-supply an embedding; else attempt the seam (flag-gated inside).
    let embedding: SemanticEmbeddingRef | null = input.embedding ?? null;
    if (!embedding) {
      const vector = await this.comparator.embed(input.topic, input.companyId);
      embedding = vector
        ? { provider: EMBEDDING_PROVIDER, dim: vector.length, vector }
        : null;
    }
    return { semanticRootId, embedding };
  }

  private candidateQuery(input: RegisterCommunicationInput): CoordinationQuery {
    return {
      // Coordinate within the campaign when present, else across the company.
      campaignId: input.campaignId ?? undefined,
      limit: this.candidateLimit,
    };
  }

  async register(input: RegisterCommunicationInput): Promise<CoordinationResult<CommunicationRecord>> {
    const tenantErr = requireTenant(input.companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const { semanticRootId, embedding } = await this.materialize(input);
      const record: CommunicationRecord = {
        id: randomUUID(),
        companyId: input.companyId,
        semanticRootId,
        communicationIntent: input.communicationIntent,
        topic: input.topic,
        campaignId: input.campaignId ?? null,
        platform: input.platform ?? null,
        audience: input.audience ?? null,
        publicationStatus: input.publicationStatus ?? 'planned',
        embedding,
        contentRef: input.contentRef ?? null,
        performanceRef: input.performanceRef ?? null,
        sourceModule: input.sourceModule ?? 'unknown',
        observedAt: this.now(),
        metadata: input.metadata,
        // Semantic lineage (OMNI-COORD-002) — optional/additive, purely descriptive.
        artifactType: input.artifactType,
        parentArtifactId: input.parentArtifactId ?? null,
        derivedFrom: input.derivedFrom,
        generationStage: input.generationStage,
      };
      const stored = await this.store.insert(record);
      recordCoordinationRegister(stored, { surface: 'coordination.register', correlationId: input.correlationId });
      return ok(stored);
    } catch (e) {
      recordCoordinationDegrade('register', 'store_error', { correlationId: input.correlationId });
      return fail(new AiError('INTERNAL', {
        devDetail: `coordination register failed: ${e instanceof Error ? e.message : String(e)}`,
        correlationId: input.correlationId,
      }));
    }
  }

  async lookup(companyId: string, query: CoordinationQuery = {}): Promise<CoordinationResult<CommunicationRecord[]>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const rows = await this.store.query(companyId, { limit: this.candidateLimit, ...query });
      return ok(rows);
    } catch (e) {
      recordCoordinationDegrade('lookup', 'store_error');
      return fail(new AiError('INTERNAL', {
        devDetail: `coordination lookup failed: ${e instanceof Error ? e.message : String(e)}`,
      }));
    }
  }

  async checkDuplicateIntent(input: RegisterCommunicationInput): Promise<CoordinationResult<DuplicateIntentVerdict>> {
    const tenantErr = requireTenant(input.companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const { semanticRootId, embedding } = await this.materialize(input);
      const existing = await this.store.query(input.companyId, this.candidateQuery(input));
      const verdict = evaluateDuplicateIntent({
        candidate: {
          semanticRootId,
          communicationIntent: input.communicationIntent,
          embedding: embedding?.vector ?? null,
        },
        existing,
        comparator: this.comparator,
      });
      recordDuplicateIntentDecision(verdict, { surface: 'coordination.check', correlationId: input.correlationId });
      return ok(verdict);
    } catch (e) {
      recordCoordinationDegrade('check', 'store_error', { correlationId: input.correlationId });
      return fail(new AiError('INTERNAL', {
        devDetail: `coordination checkDuplicateIntent failed: ${e instanceof Error ? e.message : String(e)}`,
        correlationId: input.correlationId,
      }));
    }
  }

  async markStatus(companyId: string, id: string, status: PublicationStatus): Promise<CoordinationResult<void>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      await this.store.markStatus(companyId, id, status);
      return ok(undefined);
    } catch (e) {
      recordCoordinationDegrade('markStatus', 'store_error');
      return fail(new AiError('INTERNAL', {
        devDetail: `coordination markStatus failed: ${e instanceof Error ? e.message : String(e)}`,
      }));
    }
  }
}

/** Construct a registry with explicit dependencies (tests, migration waves). */
export function createCommunicationRegistry(deps: CommunicationRegistryDeps = {}): CommunicationRegistry {
  return new CommunicationRegistryImpl(deps);
}

/** In-memory registry — deterministic, no DB, no seam cost. Ideal for tests. */
export function createInMemoryCommunicationRegistry(deps: Omit<CommunicationRegistryDeps, 'store'> = {}): CommunicationRegistry {
  return new CommunicationRegistryImpl({ ...deps, store: new InMemoryCoordinationStore() });
}

/** Pick the default store per the persistence flag (Supabase when enabled, else in-memory). */
function defaultStore(): CoordinationStore {
  return isCoordinationPersistEnabled() ? new SupabaseCoordinationStore() : new InMemoryCoordinationStore();
}

/**
 * The default process-wide registry. Inert until flags are set:
 *  - persistence OFF ⇒ in-memory store,
 *  - embedding OFF ⇒ semantic tier degrades to `not_evaluable`/`root_id` only.
 */
export const communicationRegistry: CommunicationRegistry = createCommunicationRegistry({ store: defaultStore() });
