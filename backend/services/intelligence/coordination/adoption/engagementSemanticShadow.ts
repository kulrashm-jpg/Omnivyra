/**
 * Engagement Semantic Shadow coordinator (WS-2A, Zone A2).
 *
 * The FIRST real consumer of the certified Coordination Platform. It runs BEFORE
 * (fire-and-forget, alongside) engagement reply generation and:
 *   Phase 2 — looks up the Semantic Root + prior communication events (lineage),
 *   Phase 3 — runs checkDuplicateIntent() (non-persisting) — log only, never blocks,
 *   Phase 4 — assembles an EngagementSemanticContext (transported; generator may ignore),
 *   Phase 5 — records platform ADOPTION metrics.
 *
 * Guarantees:
 *   - ZERO behavior change. It never modifies, blocks, or delays a reply. It is
 *     invoked fire-and-forget and returns a context the caller may ignore.
 *   - It NEVER throws (all paths swallow) and NEVER persists (lookup + non-mutating
 *     duplicate check only).
 *   - OFF by default (mode 'off' ⇒ immediate no-op).
 *
 * Consumes the certified interfaces exactly as published — the registries, the
 * `deriveSemanticRootId` platform function, and the DuplicateIntent contract.
 */
import {
  communicationRegistry,
  semanticRootRegistry,
  deriveSemanticRootId,
  type CommunicationIntent,
  type DuplicateIntentVerdict,
} from '../index';
import { getCoordinationAdoptionMode } from './coordinationAdoptionFlags';
import {
  recordEngagementAdoption,
  recordCoordinationAdoptionDegrade,
} from './coordinationAdoptionObservability';

/** Every engagement reply intent maps to the canonical 'reply' communication intent. */
const ENGAGEMENT_INTENT: CommunicationIntent = 'reply';

export interface EngagementShadowInput {
  /** Tenant — engagement's organization_id is the coordination companyId. */
  companyId: string;
  /** The inbound topic seed (original post / message) — NOT the generated reply. */
  topic: string;
  platform?: string | null;
  campaignId?: string | null;
  /** Where the probe fired, e.g. 'engagement.suggestion' | 'engagement.reply'. */
  surface: string;
  correlationId?: string;
}

/** Semantic context transported to the reply pipeline (ignored by the generator today). */
export interface EngagementSemanticContext {
  companyId: string;
  semanticRootId: string;
  communicationIntent: CommunicationIntent;
  campaignId: string | null;
  platform: string | null;
  surface: string;
  /** Is a Semantic Root already registered for this seed? (adoption signal) */
  rootPresent: boolean;
  /** Prior communication events observed under this root. */
  priorEventCount: number;
  /** How many priors carry lineage metadata (continuity depth signal). */
  lineageDepth: number;
  /** Semantic duplicate-intent verdict (shadow — never acted upon). */
  duplicate: DuplicateIntentVerdict;
}

const NOT_EVALUABLE: DuplicateIntentVerdict = {
  decision: 'not_evaluable',
  basis: 'none',
  maxSimilarity: null,
  candidatesConsidered: 0,
  note: 'shadow probe could not evaluate',
};

/**
 * Run the shadow coordination probe. Returns the semantic context (for future
 * consumption) or `null` when disabled / unusable. Never throws, never persists,
 * never affects the reply.
 */
export async function observeEngagementSemanticShadow(
  input: EngagementShadowInput,
): Promise<EngagementSemanticContext | null> {
  if (getCoordinationAdoptionMode() === 'off') return null;
  const started = Date.now();
  try {
    const companyId = (input.companyId ?? '').trim();
    if (!companyId) return null;
    const topic = (input.topic ?? '').trim();
    const campaignId = input.campaignId ?? null;
    const platform = input.platform ?? null;

    // Phase 2 — deterministic root id + Semantic Root lookup (non-mutating).
    const semanticRootId = deriveSemanticRootId({
      companyId,
      communicationIntent: ENGAGEMENT_INTENT,
      campaignId,
      topic,
    });
    const rootRes = await semanticRootRegistry.get(companyId, semanticRootId);
    const rootPresent = rootRes.ok && !!rootRes.value;

    // Phase 2 — prior communication events + lineage under this root.
    const priorRes = await communicationRegistry.lookup(companyId, { semanticRootId, limit: 50 });
    const priorEvents = priorRes.ok ? priorRes.value : [];
    const lineageDepth = priorEvents.filter((e) => e.artifactType || e.generationStage).length;

    // Phase 3 — duplicate INTENT detection (semantic, non-persisting). Log only.
    const dupRes = await communicationRegistry.checkDuplicateIntent({
      companyId,
      communicationIntent: ENGAGEMENT_INTENT,
      topic,
      platform,
      campaignId,
      sourceModule: 'engagement',
      correlationId: input.correlationId,
    });
    const duplicate = dupRes.ok ? dupRes.value : NOT_EVALUABLE;

    // Phase 4 — assemble the transported context (generator may ignore it).
    const context: EngagementSemanticContext = {
      companyId,
      semanticRootId,
      communicationIntent: ENGAGEMENT_INTENT,
      campaignId,
      platform,
      surface: input.surface,
      rootPresent,
      priorEventCount: priorEvents.length,
      lineageDepth,
      duplicate,
    };

    // Phase 5 — record adoption metrics.
    recordEngagementAdoption({
      surface: input.surface,
      latencyMs: Date.now() - started,
      rootPresent,
      priorEventCount: priorEvents.length,
      duplicate,
    });

    return context;
  } catch {
    recordCoordinationAdoptionDegrade(input.surface, 'shadow_error');
    return null;
  }
}
