/**
 * Semantic Root Registry (OMNI-COORD-002 Phase 1) — the canonical origin store.
 *
 * Records the origin of communication so every downstream artifact can derive
 * from one shared semantic seed. Additive, tenant-scoped, fail-safe, inert by
 * default (in-memory store unless COORDINATION_REGISTRY_PERSIST_ENABLED). Generates
 * no content; couples to no module.
 */
import { AiError } from '../../ai/safety';
import type { CoordinationResult } from './coordinationContracts';
import type {
  SemanticRoot,
  SemanticRootRegistry,
  SemanticRootStore,
  RegisterSemanticRootInput,
} from './semanticContinuityContracts';
import { deriveSemanticRootId } from './coordinationKeys';
import { isCoordinationPersistEnabled } from './coordinationFlags';
import { InMemorySemanticRootStore } from './stores/inMemorySemanticRootStore';
import { SupabaseSemanticRootStore } from './stores/supabaseSemanticRootStore';
import { recordCoordinationDegrade } from './coordinationObservability';

export interface SemanticRootRegistryDeps {
  store?: SemanticRootStore;
  now?: () => string;
}

function ok<T>(value: T): CoordinationResult<T> { return { ok: true, value }; }
function fail<T>(error: AiError): CoordinationResult<T> { return { ok: false, error }; }

function requireTenant(companyId: string | undefined | null): AiError | null {
  if (typeof companyId === 'string' && companyId.length > 0) return null;
  return new AiError('TENANT_REQUIRED', { devDetail: 'semantic-root: companyId is required' });
}

class SemanticRootRegistryImpl implements SemanticRootRegistry {
  private readonly store: SemanticRootStore;
  private readonly now: () => string;

  constructor(deps: SemanticRootRegistryDeps) {
    this.store = deps.store ?? new InMemorySemanticRootStore();
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async register(input: RegisterSemanticRootInput): Promise<CoordinationResult<SemanticRoot>> {
    const tenantErr = requireTenant(input.companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const id = input.id?.trim() || deriveSemanticRootId({
        companyId: input.companyId,
        communicationIntent: input.communicationIntent,
        campaignId: input.campaignObjective ?? null,
        topic: input.topic,
      });
      const root: SemanticRoot = {
        id,
        companyId: input.companyId,
        businessObjective: input.businessObjective,
        campaignObjective: input.campaignObjective ?? null,
        topic: input.topic,
        communicationIntent: input.communicationIntent,
        targetAudience: input.targetAudience,
        positioning: input.positioning,
        createdAt: this.now(),
        metadata: input.metadata,
      };
      const stored = await this.store.upsert(root);
      return ok(stored);
    } catch (e) {
      recordCoordinationDegrade('root.register', 'store_error', { correlationId: input.correlationId });
      return fail(new AiError('INTERNAL', {
        devDetail: `semantic root register failed: ${e instanceof Error ? e.message : String(e)}`,
        correlationId: input.correlationId,
      }));
    }
  }

  async get(companyId: string, id: string): Promise<CoordinationResult<SemanticRoot | null>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      return ok(await this.store.get(companyId, id));
    } catch (e) {
      recordCoordinationDegrade('root.get', 'store_error');
      return fail(new AiError('INTERNAL', { devDetail: `semantic root get failed: ${e instanceof Error ? e.message : String(e)}` }));
    }
  }

  async list(companyId: string): Promise<CoordinationResult<SemanticRoot[]>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      return ok(await this.store.list(companyId));
    } catch (e) {
      recordCoordinationDegrade('root.list', 'store_error');
      return fail(new AiError('INTERNAL', { devDetail: `semantic root list failed: ${e instanceof Error ? e.message : String(e)}` }));
    }
  }
}

/** Construct a Semantic Root registry with explicit deps (tests, migration waves). */
export function createSemanticRootRegistry(deps: SemanticRootRegistryDeps = {}): SemanticRootRegistry {
  return new SemanticRootRegistryImpl(deps);
}

/** In-memory registry — deterministic, no DB. Ideal for tests. */
export function createInMemorySemanticRootRegistry(deps: Omit<SemanticRootRegistryDeps, 'store'> = {}): SemanticRootRegistry {
  return new SemanticRootRegistryImpl({ ...deps, store: new InMemorySemanticRootStore() });
}

function defaultStore(): SemanticRootStore {
  return isCoordinationPersistEnabled() ? new SupabaseSemanticRootStore() : new InMemorySemanticRootStore();
}

/** Default process-wide Semantic Root registry (inert until flags are set). */
export const semanticRootRegistry: SemanticRootRegistry = createSemanticRootRegistry({ store: defaultStore() });
