/**
 * Creator suggestion-chip builders + the shared generation payload (P1-1) —
 * pure functions over explicit inputs; the page keeps thin useMemo/useCallback wrappers.
 * ENFORCEMENT: part of the asset-id-minting forbidden-pattern scan (creatorAssetIdFactory.test.ts).
 */
import {
  type WriterOverlayText,
  type WriterCreatorSourcePayload,
} from '../content/writerCreatorAssetLaunch';
import { resolvePurposeStrategy } from '../../backend/services/creator/purposeStrategyRegistry';
import { serializeCreatorFlowContext, type CreatorFlowContext } from '../content/creatorFlowContext';
import type { AssetCompositionIntent, WriterCreatorAssetType, AttachmentMode } from '../content/writerCreatorAttachmentContracts';
import { resolveTemplateCreatorCardPatch, type CreatorTemplate } from '../creator-templates';
import {
  type TemplateFieldValues,
  projectImageOverlayText,
  projectCarouselSlides,
  projectInfographicSections,
} from '../creator-templates/values';
import { creatorRuntimeV2Live } from '../creator-templates/creatorRuntimeFlag';
import { runCreatorRuntimeV2 } from '../creator-templates/creatorRuntimeV2';
import {
  type CreatorTypeId,
  type WorkflowConfig,
  getStarterChips,
  isSocialCreativeType,
  isDeterministicStructuredType,
} from './creatorWorkflowConfig';
import {
  type SavedCreatorAsset,
  type SuggestionOption,
  type CreatorBrandMode,
  type BrandPresence,
  type BrandContextSelections,
  type CreatorBrandProfile,
  buildWriterStructureGuidance,
  getSavedAssetCreatorType,
} from './creatorWorkflowModel';

export function buildOverlayFieldSuggestions(input: {
  type: CreatorTypeId | null;
  writerTitle: string;
  writerBody: string;
  topic: string;
  keyMessage: string;
  currentHook: string;
}): { hook: string[]; headline: string[]; supportingText: string[]; keyInsight: string[] } {
  const { type } = input;
  const limits: Record<keyof WriterOverlayText, number> = {
    hook: 76, headline: 84, keyInsight: 132, cta: 42, supportingText: 96,
  };
  const compact = (raw: string, max: number): string => {
    const single = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!single) return '';
    return single.length <= max ? single : `${single.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  };
  const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

  // Sentence-split the Writer body. Mirrors the splitter used by the
  // structured-prompt path so chips show the same content units the
  // renderer will see. Skips URLs, emoji-only fragments, and very short
  // particles.
  const body = String(input.writerBody || input.keyMessage || '').trim();
  const sentences = body
    .replace(/https?:\/\/\S+/gi, '')
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => s.replace(/^[\-*\d.)\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+/u, '').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 18 && /[A-Za-z]/.test(s));

  const title = String(input.writerTitle || input.topic || '').trim();

  // Proof-ish keyword bias for the Supporting Text field.
  const PROOF_KEYWORDS = /\b(proof|trust|built|backed|teams|customers|data|result|outcome|measur|evidence|clarity|insight|because|reason)\b/i;

  // Ranked candidate lists per field (best-first). Same source sentence
  // can appear across multiple lists at this stage — the allocator
  // below resolves conflicts so each sentence ends up in only one
  // field's chip list.
  const hookCandidates = sentences
    .filter((s) => s.length <= 110)
    .sort((a, b) => a.length - b.length);

  const headlineCandidates = sentences
    .filter((s) => s.length >= 24 && s.length <= 110)
    .sort((a, b) => Math.abs(a.length - 60) - Math.abs(b.length - 60));

  const supportingCandidates = sentences
    .map((s) => ({ s, score: (PROOF_KEYWORDS.test(s) ? 1 : 0) + (s.length >= 40 && s.length <= 120 ? 1 : 0) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.s);

  const insightCandidates = sentences
    .filter((s) => s.length >= 40)
    .sort((a, b) => Math.min(b.length, 132) - Math.min(a.length, 132));

  // Cross-field allocation — each source sentence is claimed by at
  // most one field. Priority order (hook first) reflects how
  // constrained each slot is: hooks need short punchy openers and are
  // hardest to find, key insights are the most permissive.
  const claimed = new Set<string>();
  const allocate = (candidates: string[], limit: number, max: number): string[] => {
    const out: string[] = [];
    for (const sentence of candidates) {
      const key = normalize(sentence);
      if (!key || claimed.has(key)) continue;
      const value = compact(sentence, max);
      if (!value) continue;
      claimed.add(key);
      out.push(value);
      if (out.length >= limit) break;
    }
    return out;
  };

  const hook        = allocate(hookCandidates,       3, limits.hook);
  const headline    = allocate(headlineCandidates,   3, limits.headline);
  const supporting  = allocate(supportingCandidates, 3, limits.supportingText);
  const insight     = allocate(insightCandidates,    3, limits.keyInsight);

  // Operator feedback: chips must be unique — a single global key set
  // spans every slot so duplicates can NEVER appear in two fields.
  // Typed seeds only surface on the HOOK field (their natural home).
  const globalChipKeys = new Set<string>();
  const seedChips = [hook, headline, supporting, insight];
  for (const slot of seedChips) {
    for (const chip of slot) globalChipKeys.add(normalize(chip));
  }

  const seeds = [
    title,
    String(input.currentHook || '').trim(),
    String(input.keyMessage || '').trim(),
  ].filter(Boolean);
  const seenSeeds = new Set<string>();
  const dedupedSeeds = seeds.filter((s) => {
    const k = normalize(s);
    if (!k || seenSeeds.has(k)) return false;
    seenSeeds.add(k);
    return true;
  });
  // Seeds only fill the HOOK field — and only when HOOK has no
  // sentence-derived chip yet.
  for (const seed of dedupedSeeds) {
    if (hook.length > 0) break;
    const key = normalize(seed);
    if (!key || globalChipKeys.has(key)) continue;
    if (seed.length > limits.hook) continue;
    const value = compact(seed.charAt(0).toUpperCase() + seed.slice(1), limits.hook);
    if (!value) continue;
    hook.push(value);
    globalChipKeys.add(normalize(value));
  }

  // Starter-chip fallback. Each field draws from its content-type
  // pool; the global key set prevents cross-field repeats; capped at 4.
  const mergeStarters = (slot: string[], fieldId: string, max: number): void => {
    const starters = getStarterChips(type ?? undefined, fieldId);
    for (const candidate of starters) {
      if (slot.length >= 4) break;
      const value = compact(candidate, max);
      if (!value) continue;
      const key = normalize(value);
      if (globalChipKeys.has(key)) continue;
      slot.push(value);
      globalChipKeys.add(key);
    }
  };
  mergeStarters(hook, 'hook', limits.hook);
  mergeStarters(headline, 'headline', limits.headline);
  mergeStarters(supporting, 'supportingText', limits.supportingText);
  mergeStarters(insight, 'keyInsight', limits.keyInsight);

  return { hook, headline, supportingText: supporting, keyInsight: insight };
}

/** Freeform-question chips (audience / keyMessage / cta / topic / dataPoints / refinement /
 *  objective) from real context — writer source, brand profile/overrides, typed overlay values —
 *  strategy-aware CTAs, globally deduped, starter fallback. */
export function buildFreeformFieldSuggestions(input: {
  type: CreatorTypeId | null;
  subtype: string;
  writerAudience: string;
  writerBody: string;
  writerTitle: string;
  brandOverrideAudience: string;
  brandProfileAudience: string;
  topic: string;
  overlayHook: string;
  overlayKeyInsight: string;
  overlayCta: string;
}): { audience: string[]; keyMessage: string[]; cta: string[]; topic: string[]; dataPoints: string[]; refinement: string[]; objective: string[] } {
  const { type } = input;
  const MAX_CHIPS = 3;
  const compact = (raw: string, max: number): string => {
    const single = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!single) return '';
    return single.length <= max ? single : `${single.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  };
  const capFirst = (s: string): string =>
    s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const pushUnique = (list: string[], value: string | undefined | null, max: number): void => {
    const compacted = compact(capFirst(String(value || '')), max);
    if (!compacted) return;
    const key = norm(compacted);
    if (list.some((existing) => norm(existing) === key)) return;
    if (list.length >= MAX_CHIPS) return;
    list.push(compacted);
  };

  // Audience candidates — priority: writer audience, brand override,
  // brand profile audience. Stops at 3 unique chips.
  const audience: string[] = [];
  pushUnique(audience, input.writerAudience, 80);
  pushUnique(audience, input.brandOverrideAudience, 80);
  pushUnique(audience, input.brandProfileAudience, 80);

  // Key-message candidates — most specific content first (writer first
  // sentence > typed insight > typed hook > topic > writer title).
  const keyMessage: string[] = [];
  const writerBody = String(input.writerBody || '').trim();
  const writerFirstSentence = writerBody
    .split(/(?<=[.!?])\s+|\n+/u)[0]
    ?.trim() || '';
  pushUnique(keyMessage, writerFirstSentence, 200);
  pushUnique(keyMessage, input.overlayKeyInsight, 200);
  pushUnique(keyMessage, input.overlayHook, 200);
  pushUnique(keyMessage, input.topic, 200);
  pushUnique(keyMessage, input.writerTitle, 200);

  // CTA candidates — strategy-aware: the selected purpose strategy's
  // ctaSuggestions surface as click-ready chips (cap intentionally
  // higher — operators expect the strategy's full curated set).
  const cta: string[] = [];
  const ctaStrategy = resolvePurposeStrategy(String(type ?? ''), input.subtype);
  const ctaCap = 6;
  const pushUniqueCta = (value: string | undefined | null): void => {
    const compacted = compact(capFirst(String(value || '')), 64);
    if (!compacted) return;
    const key = norm(compacted);
    if (cta.some((existing) => norm(existing) === key)) return;
    if (cta.length >= ctaCap) return;
    cta.push(compacted);
  };
  // Operator's typed overlay CTA is offered first if present.
  pushUniqueCta(input.overlayCta);
  if (ctaStrategy?.ctaSuggestions?.length) {
    for (const suggestion of ctaStrategy.ctaSuggestions) {
      pushUniqueCta(suggestion);
    }
  }

  // Operator feedback: chips must be unique across every field — one
  // global key set spans all seven lists.
  const globalFreeformKeys = new Set<string>();
  for (const c of audience) globalFreeformKeys.add(norm(c));
  for (const c of keyMessage) globalFreeformKeys.add(norm(c));
  for (const c of cta) globalFreeformKeys.add(norm(c));

  const buildStarterList = (fieldId: string, max: number, alreadyPicked: string[] = []): string[] => {
    const list: string[] = [...alreadyPicked];
    const starters = getStarterChips(type ?? undefined, fieldId);
    for (const starter of starters) {
      if (list.length >= MAX_CHIPS) break;
      const compacted = compact(capFirst(String(starter || '')), max);
      if (!compacted) continue;
      const key = norm(compacted);
      if (globalFreeformKeys.has(key)) continue;
      list.push(compacted);
      globalFreeformKeys.add(key);
    }
    return list;
  };
  // Merge starters AFTER operator-derived values so live brand /
  // writer signals stay in front.
  const audienceWithStarters = buildStarterList('audience', 80, audience);
  const keyMessageWithStarters = buildStarterList('keyMessage', 200, keyMessage);
  const topic = buildStarterList('topic', 120);
  const dataPoints = buildStarterList('dataPoints', 200);
  const refinement = buildStarterList('refinement', 200);
  const objective = buildStarterList('objective', 200);

  return {
    audience: audienceWithStarters,
    keyMessage: keyMessageWithStarters,
    cta,
    topic,
    dataPoints,
    refinement,
    objective,
  };
}

/* ── Generation payload builder (extracted from the page's useCallback) ──
 * The SINGLE payload shape sent to /api/command-center/creator-content/generate —
 * shared by baseline Generate and the variant fan-out path (P1-1). Pure over
 * explicit inputs, so the payload contract is unit-testable. */

export interface BuildGenerationBodyInput {
  type: CreatorTypeId | null;
  config: WorkflowConfig;
  answers: Record<string, string>;
  selectedAsset: SavedCreatorAsset | null;
  selectedSuggestion: SuggestionOption | null;
  refinedSuggestion: string | null;
  refinePrompt: string;
  writerSource: WriterCreatorSourcePayload | null;
  writerSupportingVisual: boolean;
  writerEmbeddedCopy: boolean;
  writerCompositionIntent: AssetCompositionIntent | null;
  writerAssetType: WriterCreatorAssetType | null;
  writerAttachmentMode: AttachmentMode | null;
  standaloneAttachmentMode: AttachmentMode;
  overlayText: WriterOverlayText;
  brandMode: CreatorBrandMode;
  brandPresence: BrandPresence;
  brandSelections: BrandContextSelections;
  brandProfile: CreatorBrandProfile | null;
  brandOverrides: Record<string, string>;
  brandContextLines: string[];
  selectedPlatform: string;
  selectedCompanyId: string | null | undefined;
  activeTemplate: CreatorTemplate | null;
  templateValues: TemplateFieldValues;
  /** Serialized once by the caller (was buildCurrentContext(selectedPlatform)). */
  lightweightContext: CreatorFlowContext;
  /** From ?blueprint= (was router.query.blueprint). */
  blueprintId: string | null;
  /** Draft identity for attached assets. Lookup key only. */
  compositionId?: string | null;
  variantPinOverride: string | null;
}

export function buildCreatorGenerationBody(input: BuildGenerationBodyInput): Record<string, unknown> | null {
  const {
    type, config, answers, selectedAsset, selectedSuggestion, refinedSuggestion, refinePrompt,
    writerSource, writerSupportingVisual, writerEmbeddedCopy, writerCompositionIntent,
    writerAssetType, writerAttachmentMode, standaloneAttachmentMode,
    overlayText, brandMode, brandPresence, brandSelections, brandProfile, brandOverrides,
    brandContextLines, selectedPlatform, selectedCompanyId,
    activeTemplate, templateValues, lightweightContext, blueprintId, compositionId, variantPinOverride,
  } = input;
    if (!String(answers.topic || '').trim()) return null;
    const writerStructureGuidance = writerSource && isDeterministicStructuredType(type)
      ? buildWriterStructureGuidance(writerSource, type as CreatorTypeId)
      : '';
    const writerCopyPolicy = writerCompositionIntent?.copyPolicy ?? null;
    const standaloneEmbeddedCopy = standaloneAttachmentMode === 'embedded_copy';
    const overlayAllowed = !writerSource || writerEmbeddedCopy;
    /**
     * Does on-image copy belong to THIS composition?
     *
     * The user's choice between "Text Inside Image" (embedded_copy) and
     * "Post + Image" (supporting_visual) decides it, and it must decide it for
     * EVERY source of image copy. Previously only the non-template path
     * consulted it: with an image template selected, the template-authoritative
     * branch below emitted overlay_text unconditionally, so choosing
     * "Post + Image" changed the form but not the generated image.
     */
    const imageCopyActive = overlayAllowed
      && (!writerSource ? standaloneEmbeddedCopy : writerEmbeddedCopy);
    const overlayPayload = isSocialCreativeType(type) && overlayAllowed && (!writerSource ? !(type === 'image' && !standaloneEmbeddedCopy) : writerEmbeddedCopy)
      ? {
          hook: String(overlayText.hook || '').trim(),
          headline: String(overlayText.headline || answers.headline || answers.topic || '').trim(),
          keyInsight: String(overlayText.keyInsight || '').trim(),
          cta: (writerCopyPolicy?.allowCTA || (!writerSource && standaloneEmbeddedCopy)) ? String(overlayText.cta || answers.cta || '').trim() : '',
          supportingText: String(overlayText.supportingText || '').trim(),
        }
      : null;
    const constraintLines = [
      answers.subtype ? `Subtype: ${answers.subtype}` : '',
      !writerSource && answers.cta ? `CTA: ${answers.cta}` : '',
      answers.dataPoints ? `Data points: ${answers.dataPoints}` : '',
      answers.sectionDirection ? `Sections: ${answers.sectionDirection}` : '',
      answers.slideDirection ? `Slide direction: ${answers.slideDirection}` : '',
      answers.assetSubtype ? `Supporting asset type: ${answers.assetSubtype}` : '',
      answers.assetDirection ? `Supporting asset direction: ${answers.assetDirection}` : '',
      answers.headline ? `Headline: ${answers.headline}` : '',
      answers.continuity ? `Continuity: ${answers.continuity}` : '',
      answers.visualSystem ? `Visual continuity: ${answers.visualSystem}` : '',
      answers.hierarchy ? `Visual hierarchy: ${answers.hierarchy}` : '',
      answers.structureMode ? `Structure mode: ${answers.structureMode}` : '',
      answers.density ? `Density: ${answers.density}` : '',
      answers.styleDirection ? `Style direction: ${answers.styleDirection}` : '',
      answers.refinement ? `Additional notes: ${answers.refinement}` : '',
      selectedAsset ? `Use existing asset: ${selectedAsset.name} (${getSavedAssetCreatorType(selectedAsset)})` : '',
      selectedSuggestion ? `Selected AI direction: ${selectedSuggestion.summary}` : '',
      refinedSuggestion ? `Refined AI direction: ${refinedSuggestion}` : '',
      refinePrompt ? `Refinement prompt: ${refinePrompt}` : '',
      writerSource && writerSupportingVisual
        ? [
            `Source content imported from ${writerSource.sourceType}: ${writerSource.title}`,
            'Attachment mode: supporting_visual.',
            'Provider image must contain no visible text, CTA, paragraph overlay, thread restatement, or slide duplication.',
          ].join('\n')
        : writerSource && isSocialCreativeType(type) && overlayPayload
          ? [
              `Source content imported from ${writerSource.sourceType}: ${writerSource.title}`,
              'Creator layer owns deterministic typography for embedded copy.',
              `Hook: ${overlayPayload.hook}`,
              `Headline: ${overlayPayload.headline}`,
              `Key insight: ${overlayPayload.keyInsight}`,
              overlayPayload.cta ? `CTA: ${overlayPayload.cta}` : '',
              `Supporting: ${overlayPayload.supportingText}`,
            ].filter(Boolean).join('\n')
          : writerSource
            ? `Source content imported from ${writerSource.sourceType}: ${writerSource.title}\n${writerSource.body.slice(0, 1200)}`
            : '',
      writerStructureGuidance
        ? `Structured asset sequence:\n${writerStructureGuidance}`
        : '',
      writerSource?.sourceType === 'thread' && type === 'carousel'
        ? `Thread carousel safety: transform the source with ${writerCompositionIntent?.copyPolicy?.sourceTextTransform ?? 'none'} before slide generation; never directly map raw thread segments to slides.`
        : '',
      overlayPayload
        ? `Overlay text:\nHook: ${overlayPayload.hook}\nHeadline: ${overlayPayload.headline}\nKey insight: ${overlayPayload.keyInsight}\nCTA: ${overlayPayload.cta}\nSupporting: ${overlayPayload.supportingText}`
        : '',
      `Lightweight context:\n${serializeCreatorFlowContext(lightweightContext)}`,
      `Brand context:\n${brandContextLines.join('\n')}`,
      'Quality guardrails: avoid generic phrases like premium quality, unlock growth, game-changing, or elevate your brand unless the user supplied that language.',
      'Make the output specific to the selected platform, audience, objective, CTA, and visual personality.',
      'Use concrete visual hierarchy, hook framing, and CTA language rather than abstract marketing adjectives.',
    ].filter(Boolean);
    const layoutChoice = String(answers.layout || '').trim();
    const consolidatedContentType =
      config.contentType === 'image' && layoutChoice === 'wide-banner' ? 'banner' :
      config.contentType === 'carousel' && layoutChoice === 'widescreen-presentation' ? 'slider' :
      config.contentType;
    // CREATOR-PROD-005 — deterministic runtime payload (only when the flag is ON;
    // OFF is the default and keeps the legacy projectors below). The user's typed
    // values seed MANUAL overrides so content is preserved verbatim (PROD-004:
    // 100% parity). Any failure falls back to the legacy payload — never blocks.
    const v2Runtime = creatorRuntimeV2Live() && activeTemplate
      ? (() => {
          try {
            const v2Source = [String(answers.topic || ''), ...Object.values(templateValues.fields || {})]
              .filter(Boolean).join('\n').trim() || 'content';
            return runCreatorRuntimeV2({ template: activeTemplate, sourceText: v2Source, existingValues: templateValues });
          } catch { return null; }
        })()
      : null;
    return {
      company_id: selectedCompanyId || undefined,
      // The Creator draft whose attached assets this generation should use.
      // Sent so the server can find them: composition_asset_references is keyed
      // by type + id, so without it a user's attachment is silently ignored.
      // A lookup key only — the server takes the company from the authenticated
      // context, never from here.
      ...(compositionId ? { composition_id: compositionId } : {}),
      creator_type: type,
      content_type: consolidatedContentType,
      topic: String(answers.topic || '').trim(),
      objective: String(answers.objective || '').trim(),
      audience: String(answers.audience || '').trim(),
      summary: String(
        answers.keyMessage || answers.headline || answers.sectionDirection || answers.slideDirection || '',
      ).trim(),
      creator_card: {
        objective: String(answers.objective || '').trim(),
        audience: String(answers.audience || '').trim(),
        tone: String(answers.styleDirection || '').trim(),
        visual_intent: [answers.subtype, answers.styleDirection, answers.visualSystem, answers.hierarchy]
          .filter(Boolean)
          .join(' | '),
        supporting_asset_type: String(answers.assetSubtype || '').trim(),
        existing_asset_id: selectedAsset?.id || null,
        existing_asset_name: selectedAsset?.name || null,
        lightweight_context: lightweightContext,
        selected_platform: selectedPlatform,
        ...(variantPinOverride ? { variant_family: variantPinOverride } : {}),
        // CREATOR-059 follow-up: carry the wizard-selected visual blueprint so the
        // server can derive style/colour/layout guidance (additive; absent ⇒ no-op).
        ...(blueprintId ? { blueprint_id: blueprintId } : {}),
        ...(!writerSource && type === 'image' ? { attachment_mode: standaloneAttachmentMode } : {}),
        writer_asset_type: writerAssetType,
        creator_content_asset_type: type,
        attachment_mode: writerAttachmentMode,
        asset_composition_intent: writerCompositionIntent,
        copy_policy: writerCopyPolicy,
        source_text_transform: writerCopyPolicy?.sourceTextTransform ?? null,
        infographic_layout: type === 'infographic' ? String(answers.structureMode || 'framework') : null,
        // imageCopyActive gates the TEMPLATE path too. In "Post + Image" the
        // post carries the copy and the image is visual-only, so no template
        // field, intake answer or stale overlay value may reach generation as
        // on-image text.
        overlay_text: !imageCopyActive && isSocialCreativeType(type) && type === 'image'
          ? null
          : activeTemplate && activeTemplate.assetFamily === 'image'
          // Template "Text Inside Image" — the template fields are the ONLY
          // source of on-image text. `__template_authoritative` tells the
          // renderer to render exactly these fields (no topic/title/"Learn
          // more" fallback injection) and collapse empty optional fields.
          ? (v2Runtime
              ? (v2Runtime.payload.overlay_text as Record<string, unknown>)
              : (() => {
                  // The overlay copy must be the OPERATOR'S submitted inputs, never a
                  // template placeholder example (which the model then bakes garbled).
                  // Prefer the intake answers (topic → headline, main message →
                  // keyInsight, CTA); fall back to any real template-field value.
                  const tv = projectImageOverlayText(activeTemplate, templateValues);
                  return {
                    hook: '',
                    headline: (String(answers.topic || '').trim() || String(tv.headline || '').trim()).slice(0, 84),
                    keyInsight: (String(answers.keyMessage || '').trim() || String(tv.keyInsight || '').trim()).slice(0, 190),
                    cta: (String(answers.cta || '').trim() || String(tv.cta || '').trim()).slice(0, 42),
                    supportingText: String(tv.supportingText || '').trim().slice(0, 96),
                    __template_authoritative: true,
                  } as Record<string, unknown>;
                })())
          : overlayPayload,
        brand_generation_mode: brandMode,
        brand_presence: brandMode === 'brand-aware' ? brandPresence : 'none',
        brand_context: brandMode === 'brand-aware'
          ? {
              selections: brandSelections,
              profile: brandProfile,
              overrides: brandOverrides,
              context_lines: brandContextLines,
            }
          : {
              disabled: true,
              context_lines: brandContextLines,
            },
        source_content: writerSource
          ? {
              source_type: writerSource.sourceType,
              source_id: writerSource.sourceId,
              title: writerSource.title,
              snippet: writerSource.body.slice(0, 500),
              platform: writerSource.platform,
              hashtags: writerSource.hashtags,
            }
          : null,
        constraints: constraintLines.join('\n'),
        asset_type: type,
        // Creator Template Foundation — project the active template onto the
        // EXISTING pipeline inputs (template_id + purpose_key / subtype /
        // infographic_layout / attachment_mode / slide_count). No template →
        // template_id stays null and nothing else changes.
        ...(activeTemplate ? resolveTemplateCreatorCardPatch(activeTemplate) : { template_id: null }),
        ...(activeTemplate && activeTemplate.assetFamily === 'carousel'
          ? (v2Runtime
              ? { slides: v2Runtime.payload.slides ?? [], slide_count: (v2Runtime.payload.slides ?? []).length || null }
              : { slides: projectCarouselSlides(templateValues), slide_count: templateValues.slideCount ?? null })
          : {}),
        ...(activeTemplate && activeTemplate.assetFamily === 'infographic'
          ? (v2Runtime
              ? { infographic_sections: v2Runtime.payload.infographic_sections ?? [], template_fields: v2Runtime.payload.template_fields }
              : { infographic_sections: projectInfographicSections(templateValues), template_fields: templateValues.fields })
          : {}),
      },
      target_platforms: [selectedPlatform || config.primaryPlatforms[0]],
    };
}
