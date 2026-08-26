/**
 * Phase 60G — the user's own creative choices.
 *
 * WHAT THESE PROTECT
 * ------------------
 * The Creator has always decided how an image looks. A ten-profile director
 * engine picked realism, framing and whether a person was central; a
 * forty-nine entry style registry described how a finished creative should
 * feel. Both were reached only by keyword inference over the brief, and neither
 * was reachable by the person whose creative it was.
 *
 * The failure these tests exist to prevent is the quiet one: a user picks
 * graffiti, the pipeline keeps inferring, and the result is indistinguishable
 * from never having asked. So the assertions are about OUTCOMES — what the plan
 * says, what the prompt contains, what the reference carries — rather than
 * about which function was called.
 *
 * The other failure is the opposite one: that adding a user channel changes the
 * result for the millions of generations where nobody chose anything. Section A
 * pins that inference is untouched when the user is silent.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import * as fs from 'fs';
import * as path from 'path';

import {
  SUBJECT_OPTIONS,
  subjectEmphasisFor,
  isSubjectChoice,
  groupForVisualStyle,
  listVisualDirections,
  visualDirectionsByGroup,
  recommendVisualDirections,
  getVisualDirection,
  isVisualDirectionSupported,
  sanitizeGuidedChoices,
  hasGuidedChoices,
  visualDirectionPreviewUrl,
  VISUAL_DIRECTION_GROUPS,
  RECOMMENDED_DIRECTION_COUNT,
} from '../../../lib/content/guidedCreativeDirection';
import {
  readGuidedChoices,
  serializeGuidedChoices,
  GUIDED_CHOICES_SESSION_KEY,
} from '../../../lib/content/guidedCreativeSession';
import { VISUAL_STYLES } from '../../../lib/creator-outcomes/creatorVisualStyleRegistry';
import { buildCreatorGenerationBody } from '../../../lib/creator-content/creatorSuggestionAndPayload';
import { getTemplateById } from '../../../lib/creator-templates';
import { WORKFLOW_CONFIG } from '../../../lib/creator-content/creatorWorkflowConfig';
import { planCreativeDirection } from '../../services/creator/creativeDirectorEngine';
import { userInstructionFor, toAdditionalReferences } from '../../../lib/content/compositionAssetRouting';
import type { CompositionAssetReference } from '../../../lib/content/compositionAssetReference';

const BASE_PLAN_INPUT = {
  campaignIntent: 'launch our new analytics product',
  audience: 'marketing leaders',
  platform: 'linkedin',
  contentType: 'image',
};

/* ── A. Silence changes nothing ─────────────────────────────────────────────*/

describe('A — no user choice leaves inference exactly as it was', () => {
  it('the plan is identical with no userChoices and with an empty one', () => {
    const withoutField = planCreativeDirection({ ...BASE_PLAN_INPUT });
    const withEmpty = planCreativeDirection({ ...BASE_PLAN_INPUT, userChoices: null });
    expect(withEmpty).toEqual(withoutField);
  });

  it('a plan with no choices reports none — it does not invent a neutral one', () => {
    const plan = planCreativeDirection({ ...BASE_PLAN_INPUT });
    expect(plan.userVisualDirectionId).toBeNull();
    expect(plan.userVisualInstruction).toBeNull();
    expect(plan.subjectChosenByUser).toBe(false);
  });

  it('inference still selects a strategy from the brief', () => {
    const plan = planCreativeDirection({ ...BASE_PLAN_INPUT });
    expect(plan.strategyProfile).toBeTruthy();
    expect(plan.rationale.length).toBeGreaterThan(0);
  });
});

/* ── B. A chosen look survives ──────────────────────────────────────────────*/

describe('B — the user\'s chosen look wins', () => {
  it('the chosen style id is carried on the plan, distinct from what was inferred', () => {
    const plan = planCreativeDirection({
      ...BASE_PLAN_INPUT,
      userChoices: { visualDirectionId: 'graffiti', subjectEmphasis: null, visualInstruction: null },
    });
    expect(plan.userVisualDirectionId).toBe('graffiti');
    expect(plan.rationale).toContain('user_visual_direction:graffiti');
  });

  it('a chosen look outranks brand-memory continuity', () => {
    // Brand memory still picks the strategy — it is a different axis — but the
    // user's look is carried regardless, which is the point.
    const plan = planCreativeDirection({
      ...BASE_PLAN_INPUT,
      brandMemory: { preferredStrategy: 'minimal_premium_ui' },
      userChoices: { visualDirectionId: 'graffiti', subjectEmphasis: null, visualInstruction: null },
    });
    expect(plan.userVisualDirectionId).toBe('graffiti');
  });

  it('a free-form instruction is carried and flagged', () => {
    const plan = planCreativeDirection({
      ...BASE_PLAN_INPUT,
      userChoices: { visualDirectionId: null, subjectEmphasis: null, visualInstruction: 'make it feel like a night market' },
    });
    expect(plan.userVisualInstruction).toBe('make it feel like a night market');
    expect(plan.rationale).toContain('user_visual_instruction');
  });
});

/* ── C. What should be featured ─────────────────────────────────────────────*/

describe('C — the subject choice overrides inferred emphasis', () => {
  it('every offered option maps to a deterministic emphasis pair', () => {
    expect(subjectEmphasisFor('person')).toEqual({ humanEmphasis: 'central', productEmphasis: 'absent' });
    expect(subjectEmphasisFor('product')).toEqual({ humanEmphasis: 'absent', productEmphasis: 'central' });
    expect(subjectEmphasisFor('both')).toEqual({ humanEmphasis: 'central', productEmphasis: 'central' });
    expect(subjectEmphasisFor('text-only')).toEqual({ humanEmphasis: 'absent', productEmphasis: 'absent' });
  });

  it('"let AI decide" is the ABSENCE of an override, not a neutral one', () => {
    expect(subjectEmphasisFor('ai')).toBeNull();
    expect(subjectEmphasisFor(null)).toBeNull();
    expect(subjectEmphasisFor(undefined)).toBeNull();
  });

  it('CRITICAL: "just text and background" actually removes the person', () => {
    // A brief about founders infers a human-centred profile. The user saying
    // "no person" has to beat that, or the option is decoration.
    const inferred = planCreativeDirection({
      ...BASE_PLAN_INPUT,
      campaignIntent: 'founder story behind the scenes',
    });
    const chosen = planCreativeDirection({
      ...BASE_PLAN_INPUT,
      campaignIntent: 'founder story behind the scenes',
      userChoices: { visualDirectionId: null, subjectEmphasis: subjectEmphasisFor('text-only'), visualInstruction: null },
    });
    expect(inferred.humanPresenceMode).toBe('central');
    expect(chosen.humanPresenceMode).toBe('absent');
    expect(chosen.subjectChosenByUser).toBe(true);
    expect(chosen.rationale).toContain('user_subject:absent/absent');
  });

  it('the rest of the art direction survives a subject override', () => {
    const base = planCreativeDirection({ ...BASE_PLAN_INPUT });
    const chosen = planCreativeDirection({
      ...BASE_PLAN_INPUT,
      userChoices: { visualDirectionId: null, subjectEmphasis: subjectEmphasisFor('person'), visualInstruction: null },
    });
    // Same profile, same realism — only the emphasis moved.
    expect(chosen.strategyProfile).toBe(base.strategyProfile);
    expect(chosen.realismProfile).toBe(base.realismProfile);
    expect(chosen.humanPresenceMode).toBe('central');
  });

  it('every offered option is a recognised choice', () => {
    for (const option of SUBJECT_OPTIONS) expect(isSubjectChoice(option.choice)).toBe(true);
    expect(isSubjectChoice('nonsense')).toBe(false);
  });
});

/* ── D. The look reaches the prompt ─────────────────────────────────────────*/

describe('D — a chosen look reaches the one prompt builder', () => {
  const composerSrc = fs.readFileSync(
    path.resolve(__dirname, '../../services/creator/creatorPromptComposer.ts'), 'utf8',
  );
  const rendererSrc = fs.readFileSync(
    path.resolve(__dirname, '../../services/creatorAssetRendererSvg.ts'), 'utf8',
  );

  it('the user lines join the EXISTING visualDirection layer', () => {
    expect(composerSrc).toContain('userVisualDirectionLines(input.userVisualDirection)');
    expect(composerSrc).toContain('...buildVisualDirectionLayer(template)');
  });

  it('the style vocabulary is quoted from the ONE registry, never restated', () => {
    // The renderer reads the registry's own stylePrompt rather than carrying
    // its own copy of what "graffiti" means.
    expect(rendererSrc).toContain('getVisualStyle');
    expect(rendererSrc).toContain('stylePrompt: chosenStyle?.stylePrompt');
  });

  it('the renderer hands the choices to the existing planner, not a new one', () => {
    expect(rendererSrc).toContain('userChoices: userChoicesForPlanner');
    expect(rendererSrc.match(/planCreativeDirection\(/g) ?? []).toHaveLength(1);
  });

  it('every style the user can pick has a prompt fragment to contribute', () => {
    const empty = VISUAL_STYLES.filter((s) => !String(s.stylePrompt || '').trim());
    expect(empty.map((s) => s.id)).toEqual([]);
  });
});

/* ── E. Unsupported choices fail safe ───────────────────────────────────────*/

describe('E — an unusable choice falls back to AI rather than forcing itself', () => {
  it('a style the family cannot render is dropped, not carried', () => {
    // `graffiti` supports image + carousel only.
    expect(isVisualDirectionSupported('graffiti', 'image')).toBe(true);
    expect(isVisualDirectionSupported('graffiti', 'infographic')).toBe(false);
    const sanitized = sanitizeGuidedChoices({ visualDirectionId: 'graffiti' }, 'infographic');
    expect(sanitized.visualDirectionId).toBeUndefined();
  });

  it('an unknown style id is dropped', () => {
    expect(sanitizeGuidedChoices({ visualDirectionId: 'not-a-style' }, 'image').visualDirectionId).toBeUndefined();
    expect(getVisualDirection('not-a-style')).toBeNull();
  });

  it('an unrecognised subject is dropped, and "ai" is stored as no choice', () => {
    expect(sanitizeGuidedChoices({ subject: 'wizard' as never }, 'image').subject).toBeUndefined();
    expect(sanitizeGuidedChoices({ subject: 'ai' }, 'image').subject).toBeUndefined();
    expect(sanitizeGuidedChoices({ subject: 'person' }, 'image').subject).toBe('person');
  });

  it('an oversized instruction is bounded rather than refused', () => {
    const long = 'x'.repeat(1000);
    expect(sanitizeGuidedChoices({ visualInstruction: long }, 'image').visualInstruction).toHaveLength(400);
  });

  it('hasGuidedChoices distinguishes a real answer from an empty shell', () => {
    expect(hasGuidedChoices(null)).toBe(false);
    expect(hasGuidedChoices({})).toBe(false);
    expect(hasGuidedChoices({ subject: 'ai' })).toBe(false);
    expect(hasGuidedChoices({ subject: 'person' })).toBe(true);
    expect(hasGuidedChoices({ visualDirectionId: 'graffiti' })).toBe(true);
  });
});

/* ── F. Choosing a look creates no template ─────────────────────────────────*/

describe('F — a look is a value, never a template', () => {
  it('the guided module builds no templates and touches no template registry', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/content/guidedCreativeDirection.ts'), 'utf8',
    );
    expect(src).not.toMatch(/systemTemplates|getTemplateById|CreatorTemplate\b/);
    // It reads the ONE style registry and nothing else creative.
    expect(src).toContain("from '../creator-outcomes/creatorVisualStyleRegistry'");
  });

  it('there is still exactly one visual-style registry', () => {
    const libFiles: string[] = [];
    const stack = [path.resolve(__dirname, '../../../lib')];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (/\.tsx?$/.test(entry.name)) libFiles.push(full);
      }
    }
    // Keyed on the registry's SHAPE, not its name: `aiTemplateIntent` exports an
    // unrelated `VISUAL_STYLES` tuple of seven intent adjectives, which is a name
    // collision rather than a second registry, and a guard that confused the two
    // would fail for the wrong reason.
    const registries = libFiles.filter((f) => /export const VISUAL_STYLES: VisualStyle\[\]/.test(fs.readFileSync(f, 'utf8')));
    expect(registries.map((f) => path.basename(f))).toEqual(['creatorVisualStyleRegistry.ts']);
  });
});

/* ── G. Grouping and recommendation ─────────────────────────────────────────*/

describe('G — the looks are discoverable', () => {
  it('every style lands in exactly one known group', () => {
    for (const style of VISUAL_STYLES) {
      expect(VISUAL_DIRECTION_GROUPS).toContain(groupForVisualStyle(style));
    }
  });

  it('the grouped browser covers every style for a family, without duplicates', () => {
    const flat = visualDirectionsByGroup('image').flatMap((b) => b.directions.map((d) => d.id));
    const all = listVisualDirections('image').map((d) => d.id);
    expect(new Set(flat).size).toBe(flat.length);
    expect(flat.sort()).toEqual([...all].sort());
  });

  it('the artistic looks land where a person would look for them', () => {
    const groupOf = (id: string) => groupForVisualStyle(VISUAL_STYLES.find((s) => s.id === id)!);
    expect(groupOf('graffiti')).toBe('Bold & Street');
    expect(groupOf('anime')).toBe('Bold & Street');
    expect(groupOf('watercolor')).toBe('Illustrated');
    expect(groupOf('3d')).toBe('Dimensional');
    expect(groupOf('real-photography')).toBe('Photographic');
    expect(groupOf('dashboard')).toBe('Product & UI');
  });

  it('recommendations are always filled and always the same for the same input', () => {
    const a = recommendVisualDirections({ family: 'image', outcomeId: 'product-launch' });
    const b = recommendVisualDirections({ family: 'image', outcomeId: 'product-launch' });
    expect(a).toHaveLength(RECOMMENDED_DIRECTION_COUNT);
    expect(a.map((d) => d.id)).toEqual(b.map((d) => d.id));
  });

  it('an unusual outcome still yields a full set rather than three options', () => {
    const out = recommendVisualDirections({ family: 'infographic', outcomeId: 'nothing-matches-this' });
    expect(out).toHaveLength(RECOMMENDED_DIRECTION_COUNT);
  });

  it('every recommendation is renderable by the family it was asked for', () => {
    for (const family of ['image', 'carousel', 'infographic'] as const) {
      for (const d of recommendVisualDirections({ family })) {
        expect(isVisualDirectionSupported(d.id, family)).toBe(true);
      }
    }
  });

  it('CRITICAL: every look a family offers has a real picture for THAT family', () => {
    // The whole premise is that "graffiti" is meaningless as a word and obvious
    // as an image, so a missing showcase would quietly undo the feature. The
    // showcases are per family — a style's carousel render and its single-image
    // render are different pictures — so each is checked against the family it
    // is actually offered to.
    const publicDir = path.resolve(__dirname, '../../../public');
    const missing: string[] = [];
    for (const family of ['image', 'carousel', 'infographic'] as const) {
      for (const d of listVisualDirections(family)) {
        if (!fs.existsSync(path.join(publicDir, d.previewUrl!))) missing.push(`${d.id}:${family}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

/* ── H. The hand-off ────────────────────────────────────────────────────────*/

describe('H — choices survive the trip to the editor', () => {
  it('round-trips through the session transport', () => {
    const raw = serializeGuidedChoices({ visualDirectionId: 'graffiti', subject: 'person', visualInstruction: 'me on the right' });
    expect(readGuidedChoices(raw)).toEqual({
      visualDirectionId: 'graffiti', subject: 'person', visualInstruction: 'me on the right',
    });
  });

  it('malformed storage yields NO choices — never different ones', () => {
    expect(readGuidedChoices(null)).toBeNull();
    expect(readGuidedChoices('')).toBeNull();
    expect(readGuidedChoices('{not json')).toBeNull();
    expect(readGuidedChoices('[]')).toBeNull();
    expect(readGuidedChoices('{"visualDirectionId":null}')).toBeNull();
  });

  it('the style id never travels in the URL', () => {
    const workspace = fs.readFileSync(
      path.resolve(__dirname, '../../../components/creator/AssetCreationWorkspace.tsx'), 'utf8',
    );
    expect(workspace).toContain(GUIDED_CHOICES_SESSION_KEY.length > 0 ? 'GUIDED_CHOICES_SESSION_KEY' : '');
    expect(workspace).not.toMatch(/&(style|visual_direction)=/);
  });
});

/* ── I. The user's words about their image ──────────────────────────────────*/

function reference(over: Partial<CompositionAssetReference> = {}): CompositionAssetReference {
  return {
    id: 'ref-1', companyId: 'co', compositionType: 'creator_asset', compositionId: 'comp',
    assetId: 'asset-1', purpose: 'subject', mode: 'condition', ordinal: 0, metadata: {},
    createdAt: 'T', updatedAt: 'T', ...over,
  } as CompositionAssetReference;
}

describe('I — an image instruction reaches the prompt', () => {
  it('is read from the reference metadata that already exists', () => {
    expect(userInstructionFor(reference({ metadata: { userInstruction: 'use me on the right' } })))
      .toBe('use me on the right');
    expect(userInstructionFor(reference())).toBeNull();
    expect(userInstructionFor(reference({ metadata: { userInstruction: '   ' } }))).toBeNull();
    expect(userInstructionFor(reference({ metadata: { userInstruction: 42 } }))).toBeNull();
  });

  it('CRITICAL: the user\'s words travel in their OWN field, beside the canned hint', () => {
    /*
     * They used to REPLACE `hint`, which put user-authored text into the field
     * the composer treats as application-authored — so a sentence a stranger
     * typed reached the model in the same voice as our own instructions.
     * Phase 61C separated them: the words still carry (and still outrank the
     * canned line in the prompt), but the composer can now tell whose they are.
     */
    const routed = [{ reference: reference({ metadata: { userInstruction: 'use me as the main person on the right' } }), sourceUrl: 's' }];
    const [out] = toAdditionalReferences(routed);
    expect(out.userInstruction).toBe('use me as the main person on the right');
    expect(out.hint).toContain('primary subject');
    expect(out.hint).not.toContain('use me as the main person');
  });

  it('without an instruction the canned hint still applies', () => {
    const [out] = toAdditionalReferences([{ reference: reference(), sourceUrl: 's' }]);
    expect(out.hint).toContain('primary subject');
  });

  it('an oversized instruction is bounded before it can reach a prompt', () => {
    const [out] = toAdditionalReferences([
      { reference: reference({ metadata: { userInstruction: 'y'.repeat(900) } }), sourceUrl: 's' },
    ]);
    // Bounded in the one place that bounds it — `userInstructionFor` — and the
    // composer adds no second limit of its own.
    expect(out.userInstruction).toHaveLength(400);
  });

  it('no migration was added for it — it rides existing metadata', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../pages/api/creator-assets/composition.ts'), 'utf8',
    );
    expect(src).toContain('userInstruction');
    expect(src).not.toMatch(/ALTER TABLE|CREATE TABLE/i);
  });
});

/* ── J. The real generation payload ─────────────────────────────────────────
 *
 * Asserted at `buildCreatorGenerationBody` — the actual builder the Generate
 * button calls — rather than through the UI. The precedence defect these pin
 * lived entirely in the payload: the form showed a "Headline / Image Text"
 * field, the user filled it, and the builder quietly preferred the brief topic.
 * A UI-level assertion would have passed throughout.
 */
describe('J — payload precedence and carriage', () => {
  function body(over: Record<string, unknown> = {}) {
    const template = getTemplateById('sys-image-headline-sub-cta')!;
    return buildCreatorGenerationBody({
      type: 'image',
      config: WORKFLOW_CONFIG.image,
      answers: { topic: 'BRIEF TOPIC', keyMessage: 'BRIEF MESSAGE', cta: 'BRIEF CTA' },
      selectedAsset: null, selectedSuggestion: null, refinedSuggestion: null, refinePrompt: '',
      writerSource: null, writerSupportingVisual: false, writerEmbeddedCopy: false,
      writerCompositionIntent: null, writerAssetType: null, writerAttachmentMode: null,
      standaloneAttachmentMode: 'embedded_copy',
      overlayText: {}, brandMode: 'neutral', brandPresence: 'none', brandSelections: {},
      brandProfile: null, brandOverrides: {}, brandContextLines: [],
      selectedPlatform: 'linkedin', selectedCompanyId: 'co-1',
      activeTemplate: template,
      templateValues: { fields: { headline: 'TEMPLATE HEADLINE', subheadline: 'TEMPLATE SUB', cta: 'TEMPLATE CTA' } },
      lightweightContext: {}, blueprintId: null, compositionId: 'comp-1',
      variantPinOverride: null,
      ...over,
    } as never) as Record<string, unknown>;
  }
  const overlay = (b: Record<string, unknown>) =>
    ((b.creator_card as Record<string, unknown>).overlay_text ?? {}) as Record<string, unknown>;

  it('CRITICAL: the template headline and CTA beat the brief', () => {
    const o = overlay(body());
    expect(o.headline).toBe('TEMPLATE HEADLINE');
    expect(o.cta).toBe('TEMPLATE CTA');
    expect(o.supportingText).toBe('TEMPLATE SUB');
    expect(o.__template_authoritative).toBe(true);
  });

  it('blank template fields still fall back to the brief', () => {
    // The fix must not leave an image with no words on it.
    const o = overlay(body({ templateValues: { fields: { headline: '', subheadline: '', cta: '' } } }));
    expect(o.headline).toBe('BRIEF TOPIC');
    expect(o.cta).toBe('BRIEF CTA');
  });

  it('no fourth text source appeared — supportingText comes only from the template', () => {
    const o = overlay(body({ templateValues: { fields: { headline: 'H', subheadline: '', cta: 'C' } } }));
    expect(o.supportingText).toBe('');
  });

  it('the guided choices ride the existing creator_card', () => {
    const card = body({
      guidedChoices: { visualDirectionId: 'graffiti', subject: 'person', visualInstruction: 'me on the right' },
    }).creator_card as Record<string, unknown>;
    expect(card.guided_creative).toEqual({
      visual_direction_id: 'graffiti', subject: 'person', visual_instruction: 'me on the right',
    });
  });

  it('CRITICAL: an unchosen creative adds nothing to the payload at all', () => {
    // Byte-identical to every generation before this feature existed.
    expect((body().creator_card as Record<string, unknown>).guided_creative).toBeUndefined();
  });
});
