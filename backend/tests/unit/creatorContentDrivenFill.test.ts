/**
 * PR 2 — content drives every field; the MAIN MESSAGE is the key; a field the
 * user edited is never overwritten.
 *
 * Covers: main-message precedence + user-edit protection (template + overlay),
 * auto-fill planning for every field type (image / carousel / infographic),
 * chips grounded in content vs the starter fallback, the field-assist prompt
 * carrying the whole brief, the payload, and the Post + Image scene prompt.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTemplateById } from '../../../lib/creator-templates';
import { initTemplateValues } from '../../../lib/creator-templates/values';
import {
  buildBriefOverlayChips,
  diffTemplateEdits,
  fieldEditKey,
  planOverlayFillTargets,
  planTemplateFillTargets,
  seedOverlayFromBrief,
  seedTemplateFromBrief,
} from '../../../lib/creator-content/creatorContentFill';
import type { CreatorBrief } from '../../../lib/creator-content/creatorBrief';
import {
  buildCreatorGenerationBody,
  buildFreeformFieldSuggestions,
  buildOverlayFieldSuggestions,
} from '../../../lib/creator-content/creatorSuggestionAndPayload';
import { WORKFLOW_CONFIG, STARTER_CHIPS_BY_CONTENT_TYPE } from '../../../lib/creator-content/creatorWorkflowConfig';
import {
  buildFieldAssistMessages,
  deterministicTransform,
  resolveTemplateField,
  runCreatorFieldAssist,
  validateFieldAssistRequest,
  type FieldAssistRequest,
} from '../../services/creator/creatorFieldAssistService';
import { composeCreatorImagePrompt } from '../../services/creator/creatorPromptComposer';
import { validateProviderImageTextSafety } from '../../services/creatorImageTextValidation';

const imageTpl = getTemplateById('sys-image-headline-sub-cta')!; // headline(80) / subheadline / cta(28)
const carouselTpl = getTemplateById('sys-carousel-educational-5')!;
const infographicTpl = getTemplateById('sys-infographic-statistics')!;

const BRIEF: CreatorBrief = {
  mainMessage: 'Teams publish a week of content in one afternoon',
  body: 'Teams publish a week of content in one afternoon. Busy founders get 8 hours back every week because planning is automated. Omnivyra drafts, schedules and checks every post.',
  audience: 'Busy SaaS founders',
  tone: 'Confident and friendly',
  cta: 'Start free',
  offer: 'Omnivyra Scheduler',
  objective: 'Drive trial signups',
  source: 'workspace',
};
const NONE = new Set<string>();
const EMPTY_OVERLAY = { hook: '', headline: '', keyInsight: '', cta: '', supportingText: '' };

describe('MAIN MESSAGE IS THE KEY — template lead + CTA', () => {
  it('CRITICAL: Text Inside Image puts the main message in the headline and the viewer action in the CTA', () => {
    const seed = seedTemplateFromBrief({ template: imageTpl, values: initTemplateValues(imageTpl), brief: BRIEF, edited: NONE, imageCopyActive: true });
    expect(seed.changed).toBe(true);
    expect(seed.values.fields.headline).toBe(BRIEF.mainMessage);
    expect(seed.values.fields.cta).toBe('Start free');
    expect(seed.condenseLead).toBe(false);
  });

  it('the main message replaces a topic-mirrored (not user-edited) headline', () => {
    const values = { fields: { headline: 'Scheduler', subheadline: '', cta: '' } };
    expect(seedTemplateFromBrief({ template: imageTpl, values, brief: BRIEF, edited: NONE, imageCopyActive: true }).values.fields.headline)
      .toBe(BRIEF.mainMessage);
  });

  it('CRITICAL: a USER-edited headline / CTA is never overwritten', () => {
    const values = { fields: { headline: 'My headline', subheadline: '', cta: 'Call us' } };
    const edited = new Set([fieldEditKey('flat', 'headline'), fieldEditKey('flat', 'cta')]);
    const seed = seedTemplateFromBrief({ template: imageTpl, values, brief: BRIEF, edited, imageCopyActive: true });
    expect(seed.changed).toBe(false);
    expect(seed.values.fields).toEqual(values.fields);
  });

  it('a message too long for the field is fitted at a word boundary and flagged for AI condensing', () => {
    const long = { ...BRIEF, mainMessage: 'Teams publish a full week of on-brand content in a single afternoon without hiring another marketer' };
    const seed = seedTemplateFromBrief({ template: imageTpl, values: initTemplateValues(imageTpl), brief: long, edited: NONE, imageCopyActive: true });
    expect(seed.values.fields.headline.length).toBeLessThanOrEqual(80);
    expect(long.mainMessage.startsWith(seed.values.fields.headline)).toBe(true);
    expect(seed.condenseLead).toBe(true);
  });

  it('Post + Image: no copy is seeded (the image carries no text)', () => {
    const seed = seedTemplateFromBrief({ template: imageTpl, values: initTemplateValues(imageTpl), brief: BRIEF, edited: NONE, imageCopyActive: false });
    expect(seed.changed).toBe(false);
  });

  it('overlay: headline = main message, CTA = viewer action; edited roles untouched', () => {
    expect(seedOverlayFromBrief({ overlay: EMPTY_OVERLAY, brief: BRIEF, edited: NONE }))
      .toMatchObject({ headline: BRIEF.mainMessage, cta: 'Start free' });
    const mine = { ...EMPTY_OVERLAY, headline: 'Mine', cta: 'Mine too' };
    expect(seedOverlayFromBrief({
      overlay: mine, brief: BRIEF, edited: new Set([fieldEditKey('overlay', 'headline'), fieldEditKey('overlay', 'cta')]),
    })).toEqual(mine);
  });

  it('user edits are detected per field (flat, slide, section) — structural row changes mark nothing', () => {
    const a = { fields: { headline: 'A', cta: '' }, slides: [{ title: '', body: '' }] };
    const b = { fields: { headline: 'B', cta: '' }, slides: [{ title: 'T', body: '' }, { title: '', body: '' }] };
    expect(diffTemplateEdits(a, b).sort()).toEqual([fieldEditKey('flat', 'headline'), fieldEditKey('slide', 'title', 0)].sort());
  });
});

describe('AUTO-FILL EVERYTHING from content — planning per field type', () => {
  it('image: every empty supporting field (subheadline), not the seeded lead, not edited fields', () => {
    const seeded = seedTemplateFromBrief({ template: imageTpl, values: initTemplateValues(imageTpl), brief: BRIEF, edited: NONE, imageCopyActive: true }).values;
    const t = planTemplateFillTargets({ template: imageTpl, values: seeded, edited: NONE, imageCopyActive: true });
    expect(t.map((x) => x.fieldKey)).toEqual(['subheadline']);
    // With the lead needing a condense pass it is targeted too.
    expect(planTemplateFillTargets({ template: imageTpl, values: seeded, edited: NONE, imageCopyActive: true, includeLead: true })
      .map((x) => x.fieldKey)).toContain('headline');
    // A subheadline the user typed is theirs.
    expect(planTemplateFillTargets({
      template: imageTpl, values: { fields: { ...seeded.fields, subheadline: '' } },
      edited: new Set([fieldEditKey('flat', 'subheadline')]), imageCopyActive: true,
    })).toEqual([]);
  });

  it('image Post + Image: no image-copy field is targeted', () => {
    const t = planTemplateFillTargets({ template: imageTpl, values: initTemplateValues(imageTpl), edited: NONE, imageCopyActive: false });
    expect(t).toEqual([]);
  });

  it('carousel: EVERY empty slide field is targeted, edited slide fields are skipped', () => {
    const values = initTemplateValues(carouselTpl);
    const all = planTemplateFillTargets({ template: carouselTpl, values, edited: NONE, imageCopyActive: true });
    const slideFields = carouselTpl.formDefinition.slides!.fields.filter((f) => f.aiAssist.generate).length;
    expect(all.filter((x) => x.scope === 'slide')).toHaveLength(values.slides!.length * slideFields);
    // Partially-filled rows are filled too (the old rule only filled entirely-empty rows).
    const partial = { ...values, slides: values.slides!.map((r, i) => (i === 1 ? { ...r, title: 'Kept' } : r)) };
    const t = planTemplateFillTargets({ template: carouselTpl, values: partial, edited: new Set([fieldEditKey('slide', 'body', 2)]), imageCopyActive: true });
    expect(t.some((x) => x.scope === 'slide' && x.index === 1 && x.fieldKey === 'body')).toBe(true);
    expect(t.some((x) => x.scope === 'slide' && x.index === 1 && x.fieldKey === 'title')).toBe(false);
    expect(t.some((x) => x.scope === 'slide' && x.index === 2 && x.fieldKey === 'body')).toBe(false);
  });

  it('infographic: the title and every section field are targeted', () => {
    const values = initTemplateValues(infographicTpl);
    const t = planTemplateFillTargets({ template: infographicTpl, values, edited: NONE, imageCopyActive: true });
    expect(t.some((x) => x.scope === 'flat' && x.fieldKey === 'headline')).toBe(true);
    expect(t.filter((x) => x.scope === 'section')).toHaveLength(values.sections!.length * infographicTpl.formDefinition.sections!.fields.length);
  });

  it('overlay roles: image = headline + supporting (density-safe); carousel/infographic = fuller set; edited skipped', () => {
    expect(planOverlayFillTargets({ overlay: EMPTY_OVERLAY, edited: NONE, family: 'image' })).toEqual(['headline', 'supportingText']);
    expect(planOverlayFillTargets({ overlay: EMPTY_OVERLAY, edited: NONE, family: 'carousel' })).toEqual(['hook', 'headline', 'supportingText', 'keyInsight']);
    const seeded = seedOverlayFromBrief({ overlay: EMPTY_OVERLAY, brief: BRIEF, edited: NONE });
    expect(planOverlayFillTargets({ overlay: seeded, edited: new Set([fieldEditKey('overlay', 'supportingText')]), family: 'image' })).toEqual([]);
  });
});

describe('NO GENERIC CHIPS when content exists', () => {
  const allStarters = new Set(Object.values(STARTER_CHIPS_BY_CONTENT_TYPE).flatMap((m) => Object.values(m as Record<string, string[]>).flat()));

  it('CRITICAL: with a brief, every overlay chip is grounded in the content — no starter phrase', () => {
    const chips = buildOverlayFieldSuggestions({
      type: 'image', writerTitle: '', writerBody: '', topic: 'Scheduler', keyMessage: '', currentHook: '', brief: BRIEF,
    });
    const flat = [...chips.hook, ...chips.headline, ...chips.supportingText, ...chips.keyInsight];
    expect(flat.length).toBeGreaterThan(0);
    for (const c of flat) expect(allStarters.has(c)).toBe(false);
    expect(flat).not.toContain('Stop the scroll');
    // Headline chips are variants of the main message.
    expect(chips.headline[0]).toBe(BRIEF.mainMessage);
    // Supporting chips come from the body (proof line first).
    expect(chips.supportingText[0]).toMatch(/8 hours back/);
  });

  it('AI alternatives lead the chips', () => {
    const chips = buildBriefOverlayChips(BRIEF, { headline: ['A week of posts before lunch'] });
    expect(chips.headline[0]).toBe('A week of posts before lunch');
    expect(chips.headline).toContain(BRIEF.mainMessage);
  });

  it('starter chips only when there is truly no content', () => {
    const chips = buildOverlayFieldSuggestions({ type: 'image', writerTitle: '', writerBody: '', topic: '', keyMessage: '', currentHook: '', brief: null });
    expect(chips.hook).toContain('Stop the scroll');
  });

  it('freeform chips: brief-derived, no starters', () => {
    const base = {
      type: 'image' as const, subtype: '', writerAudience: '', writerBody: '', writerTitle: '',
      brandOverrideAudience: '', brandProfileAudience: '', topic: '', overlayHook: '', overlayKeyInsight: '', overlayCta: '',
    };
    const withBrief = buildFreeformFieldSuggestions({ ...base, brief: BRIEF });
    expect(withBrief.keyMessage[0]).toBe(BRIEF.mainMessage);
    expect(withBrief.audience[0]).toBe('Busy SaaS founders');
    expect(withBrief.cta).toContain('Start free');
    for (const c of [...withBrief.keyMessage, ...withBrief.audience, ...withBrief.topic]) expect(allStarters.has(c)).toBe(false);
    const withoutBrief = buildFreeformFieldSuggestions(base);
    expect(withoutBrief.keyMessage.some((c) => allStarters.has(c))).toBe(true);
  });
});

describe('field assist carries the whole brief', () => {
  const req = (over: Partial<FieldAssistRequest> = {}): FieldAssistRequest => ({
    assetFamily: 'image', templateId: imageTpl.id, action: 'generate',
    targets: [{ scope: 'flat', fieldKey: 'subheadline', currentValue: '' }],
    context: { topic: 'Scheduler', mainMessage: BRIEF.mainMessage, cta: 'Start free', offer: 'Omnivyra Scheduler', sourceContent: BRIEF.body, tone: BRIEF.tone },
    ...over,
  });

  it('validation accepts main_message / cta / offer / alternatives (capped)', () => {
    const v = validateFieldAssistRequest({
      asset_family: 'image', template_id: imageTpl.id, action: 'generate', alternatives: 9,
      targets: [{ scope: 'overlay', field_key: 'headline' }],
      context: { main_message: 'M'.repeat(500), cta: 'Start free', offer: 'Offer' },
    });
    expect(v.ok).toBe(true);
    expect(v.request!.context!.mainMessage).toHaveLength(300);
    expect(v.request!.context!.cta).toBe('Start free');
    expect(v.request!.context!.offer).toBe('Offer');
    expect(v.request!.alternatives).toBe(3);
  });

  it('CRITICAL: the prompt names the main message as the key, plus offer, viewer action and source', () => {
    const r = req();
    const field = resolveTemplateField(imageTpl, 'flat', 'subheadline')!;
    const [system, user] = buildFieldAssistMessages(imageTpl, r, [{ target: r.targets[0], field }]);
    expect(system.content).toMatch(/MAIN MESSAGE is given below\. It is the key of this asset/);
    expect(user.content).toContain(`MAIN MESSAGE (the key): ${BRIEF.mainMessage}`);
    expect(user.content).toContain('Offer / product: Omnivyra Scheduler');
    expect(user.content).toContain('Viewer action (use it for any CTA field, keep it short): Start free');
    expect(user.content).toContain('Requested tone: Confident and friendly');
    expect(user.content).toContain('8 hours back');
  });

  it('without a main message the prompt is unchanged in shape (no key line)', () => {
    const r = req({ context: { topic: 'Scheduler' } });
    const field = resolveTemplateField(imageTpl, 'flat', 'subheadline')!;
    const [system, user] = buildFieldAssistMessages(imageTpl, r, [{ target: r.targets[0], field }]);
    expect(system.content).not.toMatch(/MAIN MESSAGE/);
    expect(user.content).not.toMatch(/MAIN MESSAGE/);
  });

  it('alternatives are parsed, validated and returned per field (fake LLM — no provider call)', async () => {
    const llm = async () => JSON.stringify({ updates: [{
      scope: 'overlay', field_key: 'headline', value: 'A week of content by lunch',
      alternatives: ['Plan a week in one afternoon', 'A week of content by lunch', 'Your week, scheduled by 2pm'],
    }] });
    const r = req({ targets: [{ scope: 'overlay', fieldKey: 'headline', currentValue: '' }], alternatives: 3 });
    const field = resolveTemplateField(imageTpl, 'overlay', 'headline')!;
    expect(buildFieldAssistMessages(imageTpl, r, [{ target: r.targets[0], field }])[0].content).toMatch(/"alternatives"/);
    const res = await runCreatorFieldAssist({ template: imageTpl, request: r, llm });
    expect(res.updates[0].value).toBe('A week of content by lunch');
    // Duplicate of the value dropped.
    expect(res.updates[0].alternatives).toEqual(['Plan a week in one afternoon', 'Your week, scheduled by 2pm']);
  });

  it('deterministic fallback: headline = main message, CTA = viewer action', () => {
    const headline = resolveTemplateField(imageTpl, 'flat', 'headline')!;
    const cta = resolveTemplateField(imageTpl, 'flat', 'cta')!;
    expect(deterministicTransform('generate', headline, '', { mainMessage: BRIEF.mainMessage })).toBe(BRIEF.mainMessage);
    expect(deterministicTransform('generate', cta, '', { cta: 'Start free' })).toBe('Start free');
    expect(deterministicTransform('generate', cta, '', {})).toBe('Learn more');
  });

  it('the workspace "Suggest with AI" sends the active company and the typed brief', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../components/creator/AssetCreationWorkspace.tsx'), 'utf8');
    expect(src).toMatch(/company_id: selectedCompanyId \|\| undefined,\s*asset_family: cfg\.family/);
    expect(src).toMatch(/source_content: String\(brief\.freeText/);
    // The draft id travels in the URL so a new tab finds the persisted brief.
    // (PR3 mints the id when the brief step opens and carries it as `draftId`; the
    //  behaviour is asserted end-to-end in creatorIntakeConfirmFlow.test.tsx.)
    expect(src).toMatch(/&composition=\$\{encodeURIComponent\((compositionId|draftId)\)\}/);
  });
});

describe('generation payload', () => {
  function body(over: Record<string, unknown> = {}) {
    return buildCreatorGenerationBody({
      type: 'image', config: WORKFLOW_CONFIG.image,
      answers: { topic: 'Scheduler', keyMessage: 'Seeded long brief text', cta: 'Learn more' },
      selectedAsset: null, selectedSuggestion: null, refinedSuggestion: null, refinePrompt: '',
      writerSource: null, writerSupportingVisual: false, writerEmbeddedCopy: false,
      writerCompositionIntent: null, writerAssetType: null, writerAttachmentMode: null,
      standaloneAttachmentMode: 'embedded_copy',
      overlayText: EMPTY_OVERLAY, brandMode: 'neutral', brandPresence: 'none', brandSelections: {},
      brandProfile: null, brandOverrides: {}, brandContextLines: [],
      selectedPlatform: 'linkedin', selectedCompanyId: 'co-1',
      activeTemplate: null, templateValues: { fields: {} },
      lightweightContext: {}, blueprintId: null, compositionId: 'comp-1', variantPinOverride: null,
      creatorBrief: BRIEF,
      ...over,
    } as never) as Record<string, unknown>;
  }
  const card = (b: Record<string, unknown>) => b.creator_card as Record<string, unknown>;

  it('summary = the main message; the brief rides on creator_card (body capped)', () => {
    const b = body({ creatorBrief: { ...BRIEF, body: 'x'.repeat(5000) } });
    expect(b.summary).toBe(BRIEF.mainMessage);
    const cb = card(b).creator_brief as CreatorBrief;
    expect(cb.mainMessage).toBe(BRIEF.mainMessage);
    expect(cb.body).toHaveLength(1500);
  });

  it('no brief → unchanged payload (no creator_brief, summary from the answers)', () => {
    const b = body({ creatorBrief: null });
    expect(b.summary).toBe('Seeded long brief text');
    expect('creator_brief' in card(b)).toBe(false);
  });

  it('Text Inside Image without a template: overlay headline falls back to the main message', () => {
    const overlay = card(body()).overlay_text as Record<string, string>;
    expect(overlay.headline).toBe(BRIEF.mainMessage);
  });

  it('template Text Inside Image: a blank template slot uses the overlay panel value for THAT slot', () => {
    const overlay = card(body({
      activeTemplate: imageTpl,
      templateValues: { fields: { headline: 'Template headline', subheadline: '', cta: '' } },
      overlayText: { ...EMPTY_OVERLAY, supportingText: 'Panel supporting line', cta: 'Panel CTA', headline: 'Panel headline' },
    })).overlay_text as Record<string, unknown>;
    expect(overlay.headline).toBe('Template headline'); // the template field still wins
    expect(overlay.supportingText).toBe('Panel supporting line');
    expect(overlay.cta).toBe('Panel CTA');
    expect(overlay.__template_authoritative).toBe(true);
  });

  it('Post + Image: still no on-image text (#323), but the brief travels for the scene', () => {
    const c = card(body({ standaloneAttachmentMode: 'supporting_visual', activeTemplate: imageTpl }));
    expect(c.overlay_text).toBeNull();
    expect((c.creator_brief as CreatorBrief).body).toContain('8 hours back');
  });
});

describe('POST + IMAGE — the image prompt is driven by the content', () => {
  const base = (over: Record<string, unknown>) => ({
    title: 'Launch', body: 'Body', eyebrow: 'image', platform: 'linkedin', contentType: 'image', ...over,
  }) as never;

  it('CRITICAL: main message + content excerpt + objective all reach a supporting_visual prompt, as text-free scene intent', () => {
    const { prompt } = composeCreatorImagePrompt(base({
      attachmentMode: 'supporting_visual',
      objective: 'Drive trial signups',
      keyMessage: BRIEF.mainMessage,
      contentExcerpt: 'Busy founders get 8 hours back every week. Click the button for the CTA.',
    }));
    expect(prompt).toContain('Campaign objective: Drive trial signups.');
    expect(prompt).toContain(`Main message the scene must convey (express it visually; do NOT render it as text): ${BRIEF.mainMessage}.`);
    expect(prompt).toContain('Content this image accompanies');
    expect(prompt).toContain('Busy founders get 8 hours back every week');
    // The supporting_visual CTA-leak gate stays green: CTA tokens are scrubbed.
    const flags = validateProviderImageTextSafety({ mode: 'supporting_visual', providerReturnedImage: true, prompt, overlayText: null }).flags;
    expect(flags).not.toContain('supporting_visual_cta_prompt_leak');
  });

  it('no excerpt → no content line (unchanged prompt shape)', () => {
    const { prompt } = composeCreatorImagePrompt(base({ attachmentMode: 'supporting_visual', keyMessage: 'M' }));
    expect(prompt).not.toContain('Content this image accompanies');
  });

  it('the brief body is threaded server-side: engine metadata → renderer → composer', () => {
    const engine = fs.readFileSync(path.resolve(__dirname, '../../services/executionEngines/creatorExecutionEngineRun.ts'), 'utf8');
    expect(engine).toMatch(/content_excerpt: \(\(\) => \{\s*const b = safeObject\(intent\.creatorCard\?\.creator_brief\);/);
    const renderer = fs.readFileSync(path.resolve(__dirname, '../../services/creatorAssetRendererSvg.ts'), 'utf8');
    expect(renderer).toContain('contentExcerpt: compactText(input.metadata.content_excerpt');
  });
});
