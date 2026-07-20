/**
 * Canonical Communication Registration pipeline (WS-2B, Zone A2).
 *
 * The ONE operation a future producer calls — `registerCommunication(...)`. Behind
 * it, automatically:
 *   Semantic Root (ensure) → Registry (idempotent write) → Communication Graph
 *   (membership, via lineage fields) → Observability → Future Duplicate Detection
 *   (the row becomes a prior for checkDuplicateIntent).
 *
 * Guarantees:
 *   - Idempotent / replay-safe: a retry or duplicate request with the same logical
 *     identity collapses onto the same row (created:false). Never a duplicate.
 *   - Additive + flag-gated (default OFF ⇒ derive ids, no write, `skipped:true`).
 *   - Fail-safe: returns a typed error, never throws into a caller.
 *   - Module-agnostic: consumes only the canonical request — no producer DTOs.
 *   - Ownership-safe: consumes the certified registry/root interfaces + the
 *     platform identity functions; changes no platform contract.
 */
import { AiError } from '../../../ai/safety';
import {
  deriveSemanticRootId,
  normalizeCommunicationIntent,
  type CommunicationIntent,
} from '../../../../platform/intelligence';
import type { CoordinationResult, CommunicationRegistry } from '../coordinationContracts';
import type { SemanticRootRegistry } from '../semanticContinuityContracts';
import { communicationRegistry } from '../communicationRegistry';
import { semanticRootRegistry } from '../semanticRootRegistry';
import {
  type CommunicationRegistrationPipeline,
  type RegisterCommunicationRequest,
  type RegistrationOutcome,
  type CommunicationLifecycleState,
  lifecycleOrder,
} from './registrationContracts';
import { deriveIdempotencyKey } from './registrationKeys';
import { getRegistrationMode } from './registrationFlags';
import {
  recordRegistration,
  recordLifecycleAdvance,
  recordRegistrationDegrade,
} from './registrationObservability';

export interface RegistrationPipelineDeps {
  registry?: CommunicationRegistry;
  roots?: SemanticRootRegistry;
}

function ok<T>(value: T): CoordinationResult<T> { return { ok: true, value }; }
function fail<T>(error: AiError): CoordinationResult<T> { return { ok: false, error }; }

function requireTenant(companyId: string | undefined | null): AiError | null {
  if (typeof companyId === 'string' && companyId.length > 0) return null;
  return new AiError('TENANT_REQUIRED', { devDetail: 'registration: companyId is required' });
}

class CommunicationRegistrationPipelineImpl implements CommunicationRegistrationPipeline {
  private readonly registry: CommunicationRegistry;
  private readonly roots: SemanticRootRegistry;

  constructor(deps: RegistrationPipelineDeps) {
    this.registry = deps.registry ?? communicationRegistry;
    this.roots = deps.roots ?? semanticRootRegistry;
  }

  async registerCommunication(request: RegisterCommunicationRequest): Promise<CoordinationResult<RegistrationOutcome>> {
    const tenantErr = requireTenant(request.companyId);
    if (tenantErr) return fail(tenantErr);

    const started = Date.now();
    try {
      const intent: CommunicationIntent = normalizeCommunicationIntent(String(request.communicationIntent));
      // A derived artifact inherits its parent's root and has no topic of its own.
      const topic = request.topic ?? '';
      const semanticRootId = request.semanticRootId?.trim()
        || deriveSemanticRootId({
          companyId: request.companyId,
          communicationIntent: intent,
          campaignId: request.campaignId ?? null,
          topic,
        });
      const idempotencyKey = request.idempotencyKey?.trim()
        || deriveIdempotencyKey({
          companyId: request.companyId,
          semanticRootId,
          artifactType: request.artifactType ?? null,
          generationStage: request.generationStage ?? null,
          platform: request.platform ?? null,
          campaignId: request.campaignId ?? null,
          audience: request.audience ?? null,
          contentRefId: request.contentRef?.id ?? null,
        });

      const mode = getRegistrationMode();
      if (mode === 'off') {
        // Derive ids so a call site is adoption-safe, but perform NO write.
        recordRegistration({ outcome: 'skipped', rootEnsured: false, sourceModule: request.sourceModule ?? 'unknown', artifactType: request.artifactType, latencyMs: 0 });
        return ok({ record: null, created: false, skipped: true, semanticRootId, idempotencyKey, rootEnsured: false });
      }

      // Ensure a Semantic Root when the seed is supplied (idempotent upsert on id).
      let rootEnsured = false;
      if (request.root) {
        const rootRes = await this.roots.register({
          companyId: request.companyId,
          id: semanticRootId,
          communicationIntent: intent,
          topic,
          campaignObjective: request.root.campaignObjective ?? request.campaignId ?? null,
          businessObjective: request.root.businessObjective,
          positioning: request.root.positioning,
          targetAudience: request.root.targetAudience,
          correlationId: request.correlationId,
        });
        rootEnsured = rootRes.ok;
      }

      const lifecycleState: CommunicationLifecycleState = request.lifecycleState ?? 'planned';
      const regRes = await this.registry.registerIdempotent({
        companyId: request.companyId,
        communicationIntent: intent,
        topic,
        semanticRootId,
        idempotencyKey,
        campaignId: request.campaignId ?? null,
        platform: request.platform ?? null,
        audience: request.audience ?? null,
        publicationStatus: lifecycleState,
        artifactType: request.artifactType,
        parentArtifactId: request.parentArtifactId ?? null,
        derivedFrom: request.derivedFrom,
        generationStage: request.generationStage,
        contentRef: request.contentRef ?? null,
        performanceRef: request.performanceRef ?? null,
        sourceModule: request.sourceModule ?? 'unknown',
        embedding: request.embedding ?? null,
        metadata: request.metadata,
        correlationId: request.correlationId,
        observedAt: request.observedAt,
      });
      if ('error' in regRes) return fail(regRes.error);

      recordRegistration({
        outcome: regRes.value.created ? 'created' : 'replayed',
        rootEnsured,
        sourceModule: request.sourceModule ?? 'unknown',
        artifactType: request.artifactType,
        latencyMs: Date.now() - started,
      });

      return ok({
        record: regRes.value.record,
        created: regRes.value.created,
        skipped: false,
        semanticRootId,
        idempotencyKey,
        rootEnsured,
      });
    } catch (e) {
      recordRegistration({ outcome: 'error', rootEnsured: false, sourceModule: request.sourceModule ?? 'unknown', artifactType: request.artifactType, latencyMs: Date.now() - started });
      recordRegistrationDegrade('registerCommunication', 'pipeline_error');
      return fail(new AiError('INTERNAL', {
        devDetail: `registerCommunication failed: ${e instanceof Error ? e.message : String(e)}`,
        correlationId: request.correlationId,
      }));
    }
  }

  async advanceLifecycle(
    companyId: string,
    communicationId: string,
    toState: CommunicationLifecycleState,
  ): Promise<CoordinationResult<{ changed: boolean; state: CommunicationLifecycleState }>> {
    const tenantErr = requireTenant(companyId);
    if (tenantErr) return fail(tenantErr);
    try {
      const cur = await this.registry.get(companyId, communicationId);
      if ('error' in cur) return fail(cur.error);
      if (!cur.value) {
        return fail(new AiError('INTERNAL', { devDetail: `advanceLifecycle: communication ${communicationId} not found` }));
      }
      const currentState = cur.value.publicationStatus;
      const curOrder = lifecycleOrder(currentState);
      const toOrder = lifecycleOrder(toState);

      // Monotonic forward-only. `archived` is the max state, so `toOrder > curOrder`
      // already covers "archive from anywhere"; same-state (incl. archived→archived)
      // and any backward transition are idempotent no-ops. A record in a legacy
      // (non-lifecycle) state has curOrder −1 and can only move forward.
      const shouldAdvance = toOrder >= 0 && toOrder > curOrder;
      if (!shouldAdvance) {
        const reason = currentState === toState ? 'same_state' : 'backward_or_unknown';
        recordLifecycleAdvance({ changed: false, toState, fromState: currentState, reason });
        return ok({ changed: false, state: (currentState as CommunicationLifecycleState) });
      }

      const mark = await this.registry.markStatus(companyId, communicationId, toState);
      if ('error' in mark) return fail(mark.error);
      recordLifecycleAdvance({ changed: true, toState, fromState: currentState, reason: 'advanced' });
      return ok({ changed: true, state: toState });
    } catch (e) {
      recordRegistrationDegrade('advanceLifecycle', 'pipeline_error');
      return fail(new AiError('INTERNAL', {
        devDetail: `advanceLifecycle failed: ${e instanceof Error ? e.message : String(e)}`,
      }));
    }
  }
}

/** Construct a pipeline with explicit deps (tests, migration waves). */
export function createCommunicationRegistrationPipeline(
  deps: RegistrationPipelineDeps = {},
): CommunicationRegistrationPipeline {
  return new CommunicationRegistrationPipelineImpl(deps);
}

/** The default process-wide registration pipeline (inert until the flag is set). */
export const communicationRegistrationPipeline: CommunicationRegistrationPipeline =
  createCommunicationRegistrationPipeline();
