/**
 * Semantic Coordination Platform (OMNI-COORD-002) — the canonical facade.
 *
 * Binds the coordination + semantic-continuity surfaces into one reusable entry
 * point so every intelligence (Writer, Campaigns, Creator, Engagement, Analytics,
 * MarketPulse) derives from the SAME semantic origin without duplicating logic:
 *
 *   platform.roots           → SemanticRootRegistry     (the origin)
 *   platform.communications  → CommunicationRegistry    (intents + artifacts + lineage)
 *   platform.getGraph(...)    → CommunicationGraph        (pure projection)
 *   platform.continuity       → SemanticContinuityEvaluator (INERT — contract only)
 *   platform.drift            → SemanticDriftEvaluator      (INERT — contract only)
 *
 * Composition only — no new behaviour, no AI, no persistence beyond what the
 * injected registries already do. Evaluators default to the inert (NOT_EVALUABLE)
 * stubs; a future wave injects real ones behind the same interfaces.
 */
import { AiError } from '../../ai/safety';
import type { CoordinationResult, CommunicationRegistry } from './coordinationContracts';
import type {
  SemanticRootRegistry,
  SemanticContinuityEvaluator,
  SemanticDriftEvaluator,
  CommunicationGraph,
} from './semanticContinuityContracts';
import { inertContinuityEvaluator, inertDriftEvaluator } from './semanticContinuityContracts';
import { buildCommunicationGraph } from './communicationGraph';
import { communicationRegistry } from './communicationRegistry';
import { semanticRootRegistry } from './semanticRootRegistry';
import { recordCoordinationDegrade } from './coordinationObservability';

export interface SemanticCoordinationPlatform {
  roots: SemanticRootRegistry;
  communications: CommunicationRegistry;
  continuity: SemanticContinuityEvaluator;
  drift: SemanticDriftEvaluator;
  /** Project the communication graph for a company (optionally one root). */
  getGraph(companyId: string, semanticRootId?: string): Promise<CoordinationResult<CommunicationGraph>>;
}

export interface SemanticCoordinationPlatformDeps {
  roots?: SemanticRootRegistry;
  communications?: CommunicationRegistry;
  continuity?: SemanticContinuityEvaluator;
  drift?: SemanticDriftEvaluator;
}

export function createSemanticCoordinationPlatform(
  deps: SemanticCoordinationPlatformDeps = {},
): SemanticCoordinationPlatform {
  const roots = deps.roots ?? semanticRootRegistry;
  const communications = deps.communications ?? communicationRegistry;
  const continuity = deps.continuity ?? inertContinuityEvaluator;
  const drift = deps.drift ?? inertDriftEvaluator;

  return {
    roots,
    communications,
    continuity,
    drift,
    async getGraph(companyId, semanticRootId): Promise<CoordinationResult<CommunicationGraph>> {
      // `'error' in x` narrowing — the repo convention: the generic Result alias
      // does not narrow on the `.ok` discriminant under this tsconfig.
      const rootsRes = await roots.list(companyId);
      if ('error' in rootsRes) return { ok: false, error: rootsRes.error };
      const artifactsRes = await communications.lookup(companyId, semanticRootId ? { semanticRootId } : {});
      if ('error' in artifactsRes) return { ok: false, error: artifactsRes.error };
      try {
        const graph = buildCommunicationGraph({
          companyId,
          roots: rootsRes.value,
          artifacts: artifactsRes.value,
          semanticRootId,
        });
        return { ok: true, value: graph };
      } catch (e) {
        recordCoordinationDegrade('graph.project', 'projection_error');
        return { ok: false, error: new AiError('INTERNAL', {
          devDetail: `communication graph projection failed: ${e instanceof Error ? e.message : String(e)}`,
        }) };
      }
    },
  };
}

/** The default process-wide platform (inert evaluators; inert registries by default). */
export const semanticCoordinationPlatform: SemanticCoordinationPlatform = createSemanticCoordinationPlatform();
