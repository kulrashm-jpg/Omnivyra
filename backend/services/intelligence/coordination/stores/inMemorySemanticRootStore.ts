/**
 * In-memory Semantic Root store (OMNI-COORD-002) — the inert default.
 * Process-local, tenant-scoped, deterministic. Mirrors InMemoryCoordinationStore.
 */
import type { SemanticRoot, SemanticRootStore } from '../semanticContinuityContracts';

export class InMemorySemanticRootStore implements SemanticRootStore {
  private readonly byCompany = new Map<string, Map<string, SemanticRoot>>();

  async upsert(root: SemanticRoot): Promise<SemanticRoot> {
    const roots = this.byCompany.get(root.companyId) ?? new Map<string, SemanticRoot>();
    roots.set(root.id, root);
    this.byCompany.set(root.companyId, roots);
    return root;
  }

  async get(companyId: string, id: string): Promise<SemanticRoot | null> {
    return this.byCompany.get(companyId)?.get(id) ?? null;
  }

  async list(companyId: string): Promise<SemanticRoot[]> {
    return Array.from(this.byCompany.get(companyId)?.values() ?? []);
  }

  reset(): void { this.byCompany.clear(); }
}
