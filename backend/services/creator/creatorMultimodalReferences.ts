/**
 * Multimodal reference assembly + provider-capability routing.
 *
 * Phase 1-2 of the multimodal creative evolution. Translates the
 * composer's structured `ReferenceImage[]` into a payload the actual
 * image provider can consume, with capability-aware degradation:
 *
 *   - Providers that accept reference images (future / experimental):
 *     receive the URLs alongside the text prompt.
 *   - Providers that do NOT accept references (OpenAI gpt-image-1
 *     standard generate today): receive enriched textual descriptors
 *     injected into the prompt so the visual identity signals survive
 *     the text-only round-trip.
 *
 * NO provider assumptions are hardcoded inside the renderer call; the
 * provider id is looked up in this module and the payload shape is
 * routed accordingly.
 */

import type {
  CreatorComposedPrompt,
  ReferenceImage,
  ReferenceImagePurpose,
} from './creatorPromptComposer';

/* ── Provider capability registry ───────────────────────────────────── */

export type ProviderImageCapabilities = {
  providerId: string;
  acceptsReferenceImages: boolean;
  maxReferenceImages: number;
  /** Whether the provider accepts a separate "edit/reference image" parameter. */
  supportsReferenceParameter: boolean;
};

const CAPABILITY_REGISTRY: Record<string, ProviderImageCapabilities> = {
  // OpenAI gpt-image-1 standard `images.generate` does NOT accept
  // reference images during generation (only during edit/variations
  // via a separate endpoint). Capability set accordingly so the
  // renderer falls back to text-enriched descriptors.
  //
  // This entry describes ONE ENDPOINT, and that is the point: the same model
  // answers differently on `images.edit`, which is what
  // `resolveProviderCapabilities(providerId, 'edit')` returns. Reading this row
  // as "gpt-image-1 cannot take images" was the misreading that made user
  // assets look impossible; it cannot, on `generate`.
  'openai-gpt-image-1': {
    providerId: 'openai-gpt-image-1',
    acceptsReferenceImages: false,
    maxReferenceImages: 0,
    supportsReferenceParameter: false,
  },
  /**
   * The SAME model on `images.edit`.
   *
   * Not an aspiration and not raised to satisfy a test — these numbers are the
   * installed SDK's own documented contract for this model (openai@5.23.2,
   * `ImageEditParamsBase.image`): "each image should be a `png`, `webp`, or
   * `jpg` file less than 50MB. You can provide up to 16 images."
   */
  'openai-gpt-image-1:edit': {
    providerId: 'openai-gpt-image-1',
    acceptsReferenceImages: true,
    maxReferenceImages: 16,
    supportsReferenceParameter: true,
  },
  // Architecture-future placeholder: any provider that exposes
  // multi-image conditioning at generate time can register here and
  // the renderer will route references natively.
  'multimodal-reference-capable': {
    providerId: 'multimodal-reference-capable',
    acceptsReferenceImages: true,
    maxReferenceImages: 4,
    supportsReferenceParameter: true,
  },
};

/** Which API operation the capability question is being asked about. */
export type ProviderImageEndpoint = 'generate' | 'edit';

/**
 * Capability is a property of (model, endpoint), not of the model alone.
 *
 * Defaults to `generate` so every existing caller keeps its exact answer; only
 * a caller that is actually about to call `images.edit` sees the edit row.
 */
export function resolveProviderCapabilities(
  providerId: string,
  endpoint: ProviderImageEndpoint = 'generate',
): ProviderImageCapabilities {
  if (endpoint === 'edit') {
    const edit = CAPABILITY_REGISTRY[`${providerId}:edit`];
    if (edit) return edit;
  }
  return CAPABILITY_REGISTRY[providerId] ?? CAPABILITY_REGISTRY['openai-gpt-image-1'];
}

/* ── Payload assembly ───────────────────────────────────────────────── */

export type MultimodalImagePayload = {
  /** Text prompt the provider will receive — may be enriched when
   *  the provider can't accept reference images natively. */
  textPrompt: string;
  /** Reference images the provider will receive AS IMAGES (only when
   *  the provider's capability bit is true). */
  referenceImages: ReferenceImage[];
  /** Audit envelope describing what was provided + what the provider accepted. */
  audit: {
    providerId: string;
    capability: ProviderImageCapabilities;
    referencesPresent: number;
    referencesAccepted: number;
    referencesDegradedToText: number;
    referenceDescriptorsInjected: string[];
  };
};

/**
 * Convert a single reference into an enriched textual descriptor for
 * providers that can't accept the image. We never emit the URL itself
 * (the provider can't fetch it inside the prompt context and it would
 * waste tokens), only structural hints about what the reference
 * conveys.
 */
function referenceToTextDescriptor(ref: ReferenceImage): string | null {
  switch (ref.purpose) {
    case 'logo':
      return 'Brand mark visual hint: a real brand logo exists for this company — its presence in the scene should respect tasteful placement (etched on a device, embroidered on apparel, reflected as ambient light) and never be rendered as a literal corner watermark.';
    case 'favicon':
      // Favicons are too small to drive prompt enrichment without
      // introducing noise; omit deliberately.
      return null;
    case 'dashboard':
    case 'ui_surface':
      return 'Product surface visual hint: a real product dashboard exists for this company — when any screen appears in the scene, match its visual cadence (information density, spacing rhythm, layout discipline) without copying literal text.';
    case 'product_screenshot':
      return 'Product visual hint: a real product screenshot exists — the imagined surface should evoke the actual UI cadence (visual density, palette discipline, layout rhythm) without copying literal text or copyrighted UI elements.';
    case 'style_reference':
      return ref.hint
        ? `Style reference hint: ${ref.hint}`
        : 'Style reference hint: a curated style anchor exists for this campaign — match its tonal discipline and compositional restraint.';
    case 'composition_reference':
      return ref.hint
        ? `Composition reference hint: ${ref.hint}`
        : 'Composition reference hint: a curated composition anchor exists — match its framing discipline and focal hierarchy.';
    case 'realism_reference':
      return ref.hint
        ? `Realism reference hint: ${ref.hint}`
        : 'Realism reference hint: a curated realism anchor exists — match its photographic discipline and material honesty.';
    default:
      return null;
  }
}

/**
 * Assemble the multimodal payload from a composed prompt + a provider id.
 * Pure function. Deterministic.
 */
export function assembleMultimodalPayload(input: {
  composed: CreatorComposedPrompt;
  providerId: string;
  /** Optional additional references (style, composition, realism)
   *  that the renderer wants to inject beyond what the brand kit
   *  + product context already produced. */
  additionalReferences?: ReferenceImage[];
}): MultimodalImagePayload {
  const capability = resolveProviderCapabilities(input.providerId);
  const baseReferences = [...input.composed.references, ...(input.additionalReferences ?? [])];
  const present = baseReferences.length;

  // Path A — provider accepts references natively. Pass them through
  // up to the capability cap; degrade the rest to text descriptors.
  if (capability.acceptsReferenceImages) {
    const accepted = baseReferences.slice(0, Math.max(0, capability.maxReferenceImages));
    const degraded = baseReferences.slice(capability.maxReferenceImages);
    const descriptors = degraded
      .map(referenceToTextDescriptor)
      .filter((d): d is string => Boolean(d));
    const textPrompt = descriptors.length > 0
      ? [input.composed.prompt, '', ...descriptors].join('\n')
      : input.composed.prompt;
    return {
      textPrompt,
      referenceImages: accepted,
      audit: {
        providerId: input.providerId,
        capability,
        referencesPresent: present,
        referencesAccepted: accepted.length,
        referencesDegradedToText: descriptors.length,
        referenceDescriptorsInjected: descriptors,
      },
    };
  }

  // Path B — provider does not accept references. Degrade ALL of
  // them into textual descriptors so the visual identity signals
  // survive. Falls back to a text-only round-trip.
  const descriptors = baseReferences
    .map(referenceToTextDescriptor)
    .filter((d): d is string => Boolean(d));
  // Dedupe descriptors (a brand often supplies both logo + favicon;
  // their dropped descriptor is null/null but if dashboard + ui_surface
  // both appear we don't want two near-identical lines).
  const seen = new Set<string>();
  const unique = descriptors.filter((d) => (seen.has(d) ? false : (seen.add(d), true)));
  const textPrompt = unique.length > 0
    ? [input.composed.prompt, '', ...unique].join('\n')
    : input.composed.prompt;
  return {
    textPrompt,
    referenceImages: [],
    audit: {
      providerId: input.providerId,
      capability,
      referencesPresent: present,
      referencesAccepted: 0,
      referencesDegradedToText: unique.length,
      referenceDescriptorsInjected: unique,
    },
  };
}

/* ── Reference utilities ────────────────────────────────────────────── */

/** Filter references by purpose — handy for renderer instrumentation. */
export function filterReferencesByPurpose(
  refs: ReferenceImage[],
  purpose: ReferenceImagePurpose,
): ReferenceImage[] {
  return refs.filter((r) => r.purpose === purpose);
}
