/**
 * Composition asset ROUTING — usage decides how an asset is consumed.
 *
 * Phase 43 established what a file is; Phase 44 established how it is used in a
 * composition (`purpose` + `mode`). Neither made that declaration *do* anything.
 * This module is the decision layer: it turns a set of composition references
 * into two explicitly separated lanes, and refuses anything it cannot route.
 *
 *   reference ──> purpose ──┬── compose   ──> deterministic composition path
 *                           └── condition ──> multimodal reference path
 *
 * THE FAILURE THIS PREVENTS
 * -------------------------
 * A user who marks their logo as an exact brand mark must not have it quietly
 * reinterpreted by a generative model, and a photograph meant to influence the
 * output must not be silently pasted on as a deterministic overlay. Those are
 * different guarantees, and the difference is invisible in the output until a
 * customer notices their logo is subtly wrong. So every rule here FAILS CLOSED:
 * an unroutable reference is returned as a typed rejection, never dropped and
 * never converted to the other mode.
 *
 * Pure functions only — no DB, no fetch, no Node built-ins. Tenancy and
 * lifecycle are enforced one layer up, where the asset is actually resolved.
 */

import type { ReferenceImage, ReferenceImagePurpose } from '../../backend/services/creator/creatorPromptComposer';
import {
  COMPOSITION_ASSET_PURPOSES,
  type CompositionAssetMode,
  type CompositionAssetPurpose,
  type CompositionAssetReference,
  type ReferenceValidationResult,
} from './compositionAssetReference';

/* ── Which modes each purpose may legally take ──────────────────────────────
 *
 * Deliberately small. A purpose is constrained only where the constraint is
 * inherent to its meaning, and is otherwise permissive with a sensible default:
 *
 *   overlay              compose ONLY — "laid over the composition" IS
 *                        deterministic placement; conditioning on it is a
 *                        contradiction, not a variant.
 *   style/composition/
 *   realism_reference    condition ONLY — these describe how generation should
 *                        be influenced. There is nothing to place exactly.
 *   logo, favicon        both, default COMPOSE — a brand mark is exact until
 *                        someone deliberately says otherwise.
 *   everything else      both, default CONDITION — a supplied photograph is
 *                        normally meant to inform generation.
 *
 * The default only applies when a caller does not state a mode. A STATED mode
 * that is not allowed is an error, never a silent correction.
 */
export interface PurposeModePolicy {
  allowed: readonly CompositionAssetMode[];
  default: CompositionAssetMode;
}

const COMPOSE_ONLY: PurposeModePolicy = { allowed: ['compose'], default: 'compose' };
const CONDITION_ONLY: PurposeModePolicy = { allowed: ['condition'], default: 'condition' };
const BOTH_COMPOSE_FIRST: PurposeModePolicy = { allowed: ['compose', 'condition'], default: 'compose' };
const BOTH_CONDITION_FIRST: PurposeModePolicy = { allowed: ['compose', 'condition'], default: 'condition' };

const PURPOSE_MODE_POLICY: Record<CompositionAssetPurpose, PurposeModePolicy> = {
  // composition vocabulary
  subject: BOTH_CONDITION_FIRST,
  background: BOTH_CONDITION_FIRST,
  product: BOTH_CONDITION_FIRST,
  overlay: COMPOSE_ONLY,
  /**
   * `supporting` — both modes, defaulting to COMPOSE.
   *
   * Read from the foundation rather than chosen: the contract defines it as an
   * image that "occupies its own PLACE in the composition alongside the
   * subject", which is placement language, and the foundation's own test
   * exercises it as `mode: 'compose'`. So an exact-placement default matches
   * both the prose and the established usage.
   *
   * It is not compose-ONLY, because unlike `overlay` — whose meaning ("sits on
   * top") IS deterministic placement — a secondary image can legitimately
   * inform generation instead of being pasted in. Forbidding that would be
   * inventing a restriction the foundation does not state.
   */
  supporting: BOTH_COMPOSE_FIRST,
  // provider vocabulary
  logo: BOTH_COMPOSE_FIRST,
  favicon: BOTH_COMPOSE_FIRST,
  dashboard: BOTH_CONDITION_FIRST,
  ui_surface: BOTH_CONDITION_FIRST,
  product_screenshot: BOTH_CONDITION_FIRST,
  style_reference: CONDITION_ONLY,
  composition_reference: CONDITION_ONLY,
  realism_reference: CONDITION_ONLY,
};

export function modePolicyForPurpose(purpose: CompositionAssetPurpose): PurposeModePolicy {
  return PURPOSE_MODE_POLICY[purpose];
}

/** The mode a purpose takes when the caller does not state one. */
export function defaultModeForPurpose(purpose: CompositionAssetPurpose): CompositionAssetMode {
  return PURPOSE_MODE_POLICY[purpose].default;
}

/** Whether a STATED mode is legal for a purpose. Never auto-corrects. */
export function isModeAllowedForPurpose(
  purpose: CompositionAssetPurpose,
  mode: CompositionAssetMode,
): boolean {
  return PURPOSE_MODE_POLICY[purpose].allowed.includes(mode);
}

/* ── What a template accepts ────────────────────────────────────────────────*/

/**
 * One reference slot a template declares it can accept.
 *
 * Compatibility lives on the TEMPLATE, once, rather than being re-derived by
 * every renderer — the duplication the architecture audit found everywhere else.
 */
export interface TemplateAssetSlot {
  purpose: CompositionAssetPurpose;
  /** Restrict this slot to one mode. Omitted = the purpose's own policy applies. */
  mode?: CompositionAssetMode;
  /** Maximum references for this slot. Omitted = 1. */
  max?: number;
  /**
   * Where a COMPOSE-mode asset is placed, as fractions of the canvas in [0,1].
   *
   * Fractions rather than pixels because one template renders at many platform
   * sizes — the same reason `defaultBrandPlacement` derives from width/height
   * at render time rather than storing constants.
   *
   * There is no default and no fallback: a compose reference whose slot omits
   * this is REFUSED. The audit found the renderer carries geometry for exactly
   * one role (the brand mark) and even that exists twice with disagreeing
   * values — bottom-right in `defaultBrandPlacement`, top-right in
   * `buildOverlaySvg`. With no canonical source to infer from, inventing
   * coordinates would place a user's asset somewhere nobody chose.
   */
  placement?: TemplateAssetPlacement;
}

export interface TemplateAssetPlacement {
  /** Distance from the top edge, as a fraction of canvas height. */
  top: number;
  /** Distance from the left edge, as a fraction of canvas width. */
  left: number;
  /** Box width, as a fraction of canvas width. */
  maxWidth: number;
  /** Box height, as a fraction of canvas height. */
  maxHeight: number;
  /**
   * `contain` fits the whole source inside the box and crops nothing — the only
   * mode that preserves every source pixel. `cover` fills the box and discards
   * the overflowing edges. Stated, never inferred: which one applies changes
   * whether pixels survive.
   */
  fit?: 'contain' | 'cover';
}

const PLACEMENT_FITS = ['contain', 'cover'] as const;

/**
 * Validate placement geometry structurally.
 *
 * Rejects rather than repairs. Clamping an out-of-range coordinate would put
 * the asset somewhere the template author did not choose while reporting
 * success, which is the silent-wrong-output failure this whole layer exists to
 * prevent.
 */
export function validateTemplateAssetPlacement(
  placement: Partial<TemplateAssetPlacement> | null | undefined,
): ReferenceValidationResult {
  const errors: string[] = [];
  if (!placement || typeof placement !== 'object') {
    return { ok: false, errors: ['placement is required'] };
  }

  const inUnit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  const inOpenUnit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1;

  if (!inUnit(placement.top)) errors.push('placement.top must be within [0,1]');
  if (!inUnit(placement.left)) errors.push('placement.left must be within [0,1]');
  if (!inOpenUnit(placement.maxWidth)) errors.push('placement.maxWidth must be within (0,1]');
  if (!inOpenUnit(placement.maxHeight)) errors.push('placement.maxHeight must be within (0,1]');

  if (
    placement.fit !== undefined &&
    !(PLACEMENT_FITS as readonly string[]).includes(placement.fit as string)
  ) {
    errors.push(`placement.fit must be one of: ${PLACEMENT_FITS.join(', ')}`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * A template that has not declared `assetSlots` accepts NO references.
 *
 * This is fail-closed on purpose. The alternative — treating "undeclared" as
 * "anything goes" — would let a reference reach a template whose layout has
 * nowhere to put it, and the user would see it silently ignored. Today no
 * template declares slots, so the honest answer to "may I attach this?" is no
 * until one opts in.
 */
export function templateAcceptsReferences(slots: readonly TemplateAssetSlot[] | undefined): boolean {
  return Array.isArray(slots) && slots.length > 0;
}

export function slotFor(
  slots: readonly TemplateAssetSlot[] | undefined,
  purpose: CompositionAssetPurpose,
): TemplateAssetSlot | null {
  if (!Array.isArray(slots)) return null;
  return slots.find((s) => s.purpose === purpose) ?? null;
}

/* ── Routing ────────────────────────────────────────────────────────────────*/

export type RoutingRejectionReason =
  | 'template_accepts_no_references'
  | 'purpose_not_accepted_by_template'
  | 'mode_not_allowed_for_purpose'
  | 'mode_not_allowed_by_template_slot'
  | 'slot_capacity_exceeded'
  | 'provider_reference_limit_exceeded'
  | 'slot_missing_placement'
  | 'slot_placement_invalid';

export interface RoutedReference {
  reference: CompositionAssetReference;
  /** The resolved storage location of the asset's bytes. */
  sourceUrl: string;
}

export interface RoutingRejection {
  referenceId: string;
  purpose: CompositionAssetPurpose;
  mode: CompositionAssetMode;
  reason: RoutingRejectionReason;
  detail: string;
}

export interface RoutingResult {
  /** Exact-pixel lane — deterministic composition. */
  compose: RoutedReference[];
  /** Generative lane — becomes provider reference input. */
  condition: RoutedReference[];
  /** Everything refused, with a reason. Never silently dropped. */
  rejected: RoutingRejection[];
  /**
   * True when the provider cannot accept reference images, so the condition
   * lane will reach the model only as text descriptors. Surfaced rather than
   * hidden: for `style_reference` that is an acceptable degradation, for a
   * person's photograph it is emphatically not, and the caller must be able to
   * tell the difference.
   */
  conditionDegradedToText: boolean;
}

/**
 * Can this template slot honour `purpose` in `mode`?
 *
 * THE single compatibility answer. Routing asks it before admitting a
 * reference, and the Content Creator panel asks it before OFFERING a usage —
 * because a panel that offers what routing discards is exactly how an attach
 * looked successful while generation ignored it. Two implementations of "is
 * this allowed" would drift the moment either changed; there is one.
 *
 * Capacity is NOT decided here: it depends on how many references have already
 * been admitted in this run, which is routing's state and not a property of the
 * slot.
 */
export interface SlotAcceptance {
  ok: boolean;
  /** The slot that admitted this reference. Null when `ok` is false. */
  slot: TemplateAssetSlot | null;
  /** Why it was refused, in the router's own vocabulary. Null when `ok` is true. */
  reason: RoutingRejectionReason | null;
  detail: string;
}

export function slotAcceptance(
  slots: readonly TemplateAssetSlot[] | undefined,
  purpose: CompositionAssetPurpose,
  mode: CompositionAssetMode,
): SlotAcceptance {
  if (!templateAcceptsReferences(slots)) {
    return { ok: false, slot: null, reason: 'template_accepts_no_references', detail: 'The template declares no assetSlots, so it accepts no references.' };
  }

  const slot = slotFor(slots, purpose);
  if (!slot) {
    return { ok: false, slot: null, reason: 'purpose_not_accepted_by_template', detail: `The template declares no slot for purpose "${purpose}".` };
  }

  // A stated mode is honoured or refused — never converted.
  if (!isModeAllowedForPurpose(purpose, mode)) {
    return { ok: false, slot: null, reason: 'mode_not_allowed_for_purpose', detail: `Purpose "${purpose}" does not allow mode "${mode}".` };
  }
  if (slot.mode && slot.mode !== mode) {
    return { ok: false, slot: null, reason: 'mode_not_allowed_by_template_slot', detail: `The template slot for "${purpose}" accepts only mode "${slot.mode}".` };
  }

  // A compose reference is only placeable if the slot says where. There is no
  // fallback geometry — see the note on TemplateAssetSlot.placement.
  if (mode === 'compose') {
    if (!slot.placement) {
      return { ok: false, slot: null, reason: 'slot_missing_placement',
        detail: `The template slot for "${purpose}" declares no placement, so a compose asset cannot be positioned.` };
    }
    const geometry = validateTemplateAssetPlacement(slot.placement);
    if (!geometry.ok) {
      return { ok: false, slot: null, reason: 'slot_placement_invalid',
        detail: `The template slot for "${purpose}" has invalid placement: ${geometry.errors.join('; ')}` };
    }
  }

  return { ok: true, slot, reason: null, detail: '' };
}

export interface RoutingInput {
  /** Ordered references — ordering is the caller's, already made deterministic. */
  references: Array<{ reference: CompositionAssetReference; sourceUrl: string }>;
  /** Slots the target template declares. Undefined = declares none. */
  templateSlots?: readonly TemplateAssetSlot[];
  /** Provider capability for the condition lane. */
  provider: { acceptsReferenceImages: boolean; maxReferenceImages: number };
}

/**
 * Route references into the compose and condition lanes.
 *
 * Order is preserved within each lane; capacity is applied in that order so the
 * outcome is deterministic for a given input rather than dependent on which
 * reference happened to be examined first.
 */
export function routeCompositionReferences(input: RoutingInput): RoutingResult {
  const compose: RoutedReference[] = [];
  const condition: RoutedReference[] = [];
  const rejected: RoutingRejection[] = [];
  const slots = input.templateSlots;
  const perSlotCount = new Map<CompositionAssetPurpose, number>();

  const reject = (
    r: CompositionAssetReference,
    reason: RoutingRejectionReason,
    detail: string,
  ) => rejected.push({ referenceId: r.id, purpose: r.purpose, mode: r.mode, reason, detail });

  for (const item of input.references) {
    const r = item.reference;

    // Compatibility is decided in ONE place, shared with the surface that
    // offers these usages, so the two cannot disagree.
    const acceptance = slotAcceptance(slots, r.purpose, r.mode);
    if (!acceptance.ok) {
      reject(r, acceptance.reason, acceptance.detail);
      continue;
    }
    const slot = acceptance.slot;

    const used = perSlotCount.get(r.purpose) ?? 0;
    const capacity = slot.max ?? 1;
    if (used >= capacity) {
      reject(r, 'slot_capacity_exceeded',
        `The template slot for "${r.purpose}" accepts at most ${capacity}.`);
      continue;
    }
    perSlotCount.set(r.purpose, used + 1);

    if (r.mode === 'compose') compose.push({ reference: r, sourceUrl: item.sourceUrl });
    else condition.push({ reference: r, sourceUrl: item.sourceUrl });
  }

  // Provider cardinality applies to the condition lane only — the compose lane
  // never reaches the provider.
  let conditionDegradedToText = false;
  if (input.provider.acceptsReferenceImages) {
    const cap = Math.max(0, input.provider.maxReferenceImages);
    while (condition.length > cap) {
      const dropped = condition.pop()!;
      reject(dropped.reference, 'provider_reference_limit_exceeded',
        `The provider accepts at most ${cap} reference image(s).`);
    }
  } else if (condition.length > 0) {
    // Not a rejection: the existing pipeline degrades references to text
    // descriptors, which is a real (if weaker) behaviour rather than a drop.
    conditionDegradedToText = true;
  }

  return { compose, condition, rejected, conditionDegradedToText };
}

/* ── Adapter onto the existing provider seam ────────────────────────────────*/

/**
 * The provider vocabulary has no `subject` / `background` / `product`, so the
 * composition-only purposes map onto the nearest provider purpose and carry
 * their precise intent in `hint` — which is exactly what that field is for
 * ("free-text hint passed to the provider when capability allows").
 *
 * Nothing is lost, and no new provider purpose is invented: widening
 * ReferenceImagePurpose is a provider-side change and belongs to the phase that
 * owns the provider.
 */
const COMPOSITION_PURPOSE_ADAPTER: Record<string, { purpose: ReferenceImagePurpose; hint: string }> = {
  subject: {
    purpose: 'composition_reference',
    hint: 'the primary subject of the composition — keep it prominent and central',
  },
  background: {
    purpose: 'composition_reference',
    hint: 'use as the background scene behind the composition',
  },
  product: {
    purpose: 'composition_reference',
    hint: 'the exact product being featured — preserve its form and finish',
  },
  overlay: {
    // Unreachable in practice: overlay is compose-only and never enters this
    // lane. Mapped anyway so the adapter is total rather than throwing.
    purpose: 'composition_reference',
    hint: 'element laid over the composition',
  },
};

/**
 * Convert the condition lane into the `ReferenceImage[]` that
 * `assembleMultimodalPayload({ additionalReferences })` already accepts.
 *
 * This is the whole point of the phase: after this call, a canonical asset is
 * expressible in the provider seam that has existed all along and has never had
 * a user asset to carry.
 */
export function toAdditionalReferences(condition: readonly RoutedReference[]): ReferenceImage[] {
  return condition.map(({ reference, sourceUrl }) => {
    const adapted = COMPOSITION_PURPOSE_ADAPTER[reference.purpose];
    /*
     * The USER'S OWN WORDS about this image outrank the canned hint.
     *
     * The adapter sentences are a reasonable default for "background" or
     * "product", but they are the same six sentences for everybody. Someone who
     * wrote "use me as the main person on the right" has said something the
     * purpose enum cannot express, and dropping it in favour of a generic line
     * is the difference between a reference the model understands and one it
     * merely receives.
     */
    const instruction = userInstructionFor(reference);
    /*
     * The user's words travel in their OWN field, never in `hint`.
     *
     * They used to replace the adapter's sentence, which put user-authored text
     * into the field the composer treats as application-authored — so a
     * sentence a stranger typed reached the prompt in the same voice as our own
     * instructions. The words still outrank the canned hint in prominence; what
     * changed is that the composer can now tell whose words they are.
     */
    if (adapted) {
      return {
        url: sourceUrl,
        purpose: adapted.purpose,
        hint: adapted.hint,
        ...(instruction ? { userInstruction: instruction } : {}),
      };
    }
    // Already a provider purpose — pass through unchanged.
    return {
      url: sourceUrl,
      purpose: reference.purpose as ReferenceImagePurpose,
      ...(instruction ? { userInstruction: instruction } : {}),
    };
  });
}

/**
 * The instruction a user attached to this reference, if any.
 *
 * Stored on the reference's existing `metadata` JSONB — no new column, no
 * migration. Bounded and trimmed here so a malformed or oversized value can
 * never reach the prompt, whatever wrote it.
 */
export function userInstructionFor(
  reference: Pick<CompositionAssetReference, 'metadata'>,
): string | null {
  const metadata = (reference?.metadata ?? {}) as Record<string, unknown>;
  const raw = metadata.userInstruction;
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text ? text.slice(0, 400) : null;
}

/** Every purpose must have a policy — guards against a purpose added without one. */
export function purposesWithoutPolicy(): CompositionAssetPurpose[] {
  return COMPOSITION_ASSET_PURPOSES.filter((p) => !PURPOSE_MODE_POLICY[p]);
}
