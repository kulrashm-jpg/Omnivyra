import { getTemplateById } from '../../../lib/creator-templates';
import {
  validateFieldAssistRequest,
  runCreatorFieldAssist,
  resolveTemplateField,
  fieldAllowsAction,
  deterministicTransform,
  parseAssistResponse,
  buildFieldAssistMessages,
  type FieldAssistRequest,
  type AssistLlm,
} from '../../services/creator/creatorFieldAssistService';

const imageTpl = getTemplateById('sys-image-headline-sub-cta')!; // headline / subheadline / cta
const carouselTpl = getTemplateById('sys-carousel-educational-5')!; // slide: title / body
const infographicTpl = getTemplateById('sys-infographic-statistics')!; // section: metric / description

function req(partial: Partial<FieldAssistRequest>): FieldAssistRequest {
  return {
    assetFamily: 'image',
    templateId: imageTpl.id,
    action: 'generate',
    targets: [{ scope: 'flat', fieldKey: 'headline', currentValue: '' }],
    context: { topic: 'Onboarding automation' },
    ...partial,
  };
}

const jsonLlm = (updates: Array<Record<string, unknown>>): AssistLlm => async () => JSON.stringify({ updates });
const throwingLlm: AssistLlm = async () => { throw new Error('llm down'); };

describe('Field assist — validation', () => {
  it('accepts a well-formed request', () => {
    const v = validateFieldAssistRequest({ asset_family: 'image', template_id: 'x', action: 'rewrite', targets: [{ scope: 'flat', field_key: 'headline' }] });
    expect(v.ok).toBe(true);
    expect(v.request?.targets[0].fieldKey).toBe('headline');
  });
  it('rejects bad family / action / empty targets', () => {
    expect(validateFieldAssistRequest({ asset_family: 'video', template_id: 'x', action: 'generate', targets: [{ scope: 'flat', field_key: 'h' }] }).ok).toBe(false);
    expect(validateFieldAssistRequest({ asset_family: 'image', template_id: 'x', action: 'nope', targets: [{ scope: 'flat', field_key: 'h' }] }).ok).toBe(false);
    expect(validateFieldAssistRequest({ asset_family: 'image', template_id: 'x', action: 'generate', targets: [] }).ok).toBe(false);
    expect(validateFieldAssistRequest({ asset_family: 'image', template_id: '', action: 'generate', targets: [{ scope: 'flat', field_key: 'h' }] }).ok).toBe(false);
  });
});

describe('Field assist — field resolution + permissions', () => {
  it('resolves template fields by scope', () => {
    expect(resolveTemplateField(imageTpl, 'flat', 'headline')?.label).toMatch(/Headline/);
    expect(resolveTemplateField(carouselTpl, 'slide', 'title')?.key).toBe('title');
    expect(resolveTemplateField(infographicTpl, 'section', 'metric')?.key).toBe('metric');
    expect(resolveTemplateField(imageTpl, 'flat', 'nope')).toBeNull();
  });
  it('expand/shorten/improve default-on when generate is enabled', () => {
    const f = resolveTemplateField(imageTpl, 'flat', 'headline')!;
    for (const a of ['generate', 'rewrite', 'expand', 'shorten', 'improve'] as const) {
      expect(fieldAllowsAction(f, a)).toBe(true);
    }
  });
});

describe('Field assist — image field generation + rewrite (only targeted field)', () => {
  it('IMAGE generate: updates only the headline, returns just that field', async () => {
    const res = await runCreatorFieldAssist({
      template: imageTpl,
      request: req({ action: 'generate', targets: [{ scope: 'flat', fieldKey: 'headline', currentValue: '' }] }),
      llm: jsonLlm([{ scope: 'flat', field_key: 'headline', value: 'Automate onboarding in minutes' }]),
    });
    expect(res.updates).toHaveLength(1);
    expect(res.updates[0]).toMatchObject({ scope: 'flat', fieldKey: 'headline', value: 'Automate onboarding in minutes' });
    expect(res.usedFallback).toBe(false);
  });

  it('IMAGE rewrite: a non-targeted field (cta) is never returned', async () => {
    const res = await runCreatorFieldAssist({
      template: imageTpl,
      request: req({ action: 'rewrite', targets: [{ scope: 'flat', fieldKey: 'subheadline', currentValue: 'save time' }] }),
      // LLM tries to also rewrite cta — must be IGNORED (not a requested target).
      llm: jsonLlm([
        { scope: 'flat', field_key: 'subheadline', value: 'Save eight hours a week' },
        { scope: 'flat', field_key: 'cta', value: 'Buy now' },
      ]),
    });
    expect(res.updates.map((u) => u.fieldKey)).toEqual(['subheadline']);
    expect(res.updates.map((u) => u.fieldKey)).not.toContain('cta');
  });

  it('clamps the returned value to the field max length', async () => {
    const long = 'x'.repeat(500);
    const res = await runCreatorFieldAssist({
      template: imageTpl,
      request: req({ targets: [{ scope: 'flat', fieldKey: 'headline', currentValue: '' }] }),
      llm: jsonLlm([{ scope: 'flat', field_key: 'headline', value: long }]),
    });
    const max = resolveTemplateField(imageTpl, 'flat', 'headline')!.maxLength!;
    expect(res.updates[0].value.length).toBeLessThanOrEqual(max);
  });
});

describe('Field assist — carousel single + batch', () => {
  it('CAROUSEL single-slide generate: only slide index 2 updated', async () => {
    const res = await runCreatorFieldAssist({
      template: carouselTpl,
      request: { assetFamily: 'carousel', templateId: carouselTpl.id, action: 'generate', context: { topic: 'SEO' }, targets: [{ scope: 'slide', fieldKey: 'title', index: 2, currentValue: '' }] },
      llm: jsonLlm([{ scope: 'slide', field_key: 'title', index: 2, value: 'On-page basics' }]),
    });
    expect(res.updates).toHaveLength(1);
    expect(res.updates[0]).toMatchObject({ scope: 'slide', fieldKey: 'title', index: 2, value: 'On-page basics' });
  });

  it('CAROUSEL selected-slide rewrite (batch): every requested target returned, none extra', async () => {
    const targets = [
      { scope: 'slide' as const, fieldKey: 'title', index: 0, currentValue: 'Hook' },
      { scope: 'slide' as const, fieldKey: 'title', index: 1, currentValue: 'Concept' },
    ];
    const res = await runCreatorFieldAssist({
      template: carouselTpl,
      request: { assetFamily: 'carousel', templateId: carouselTpl.id, action: 'rewrite', targets, context: {} },
      llm: jsonLlm([
        { scope: 'slide', field_key: 'title', index: 0, value: 'A bolder hook' },
        { scope: 'slide', field_key: 'title', index: 1, value: 'The core concept' },
      ]),
    });
    expect(res.updates).toHaveLength(2);
    expect(res.updates.map((u) => `${u.index}:${u.value}`)).toEqual(['0:A bolder hook', '1:The core concept']);
  });
});

describe('Field assist — infographic single + selected sections', () => {
  it('INFOGRAPHIC single-section generate', async () => {
    const res = await runCreatorFieldAssist({
      template: infographicTpl,
      request: { assetFamily: 'infographic', templateId: infographicTpl.id, action: 'generate', context: { topic: 'growth' }, targets: [{ scope: 'section', fieldKey: 'metric', index: 0, currentValue: '' }] },
      llm: jsonLlm([{ scope: 'section', field_key: 'metric', index: 0, value: '92%' }]),
    });
    expect(res.updates).toEqual([{ scope: 'section', fieldKey: 'metric', index: 0, value: '92%' }]);
  });
});

describe('Field assist — graceful fallback + manual preservation', () => {
  it('LLM failure → deterministic fallback, still returns updated values', async () => {
    const res = await runCreatorFieldAssist({
      template: imageTpl,
      request: req({ action: 'generate', targets: [{ scope: 'flat', fieldKey: 'headline', currentValue: '' }] }),
      llm: throwingLlm,
    });
    expect(res.usedFallback).toBe(true);
    expect(res.updates).toHaveLength(1);
    expect(res.updates[0].value.length).toBeGreaterThan(0);
  });

  it('no LLM provided → deterministic transforms per action', () => {
    const f = resolveTemplateField(imageTpl, 'flat', 'headline')!;
    expect(deterministicTransform('generate', f, '', { topic: 'sales' })).toBe('Sales');
    expect(deterministicTransform('shorten', f, 'Hello world. Extra detail here.', {})).toBe('Hello world.');
    expect(deterministicTransform('improve', f, 'hello   world', {})).toBe('Hello world');
    const cta = resolveTemplateField(imageTpl, 'flat', 'cta')!;
    expect(deterministicTransform('generate', cta, '', {})).toBe('Learn more');
  });

  it('unknown/disallowed target is skipped, never returned', async () => {
    const res = await runCreatorFieldAssist({
      template: imageTpl,
      request: req({ targets: [{ scope: 'flat', fieldKey: 'does_not_exist', currentValue: '' }] }),
      llm: jsonLlm([{ scope: 'flat', field_key: 'does_not_exist', value: 'x' }]),
    });
    expect(res.updates).toHaveLength(0);
    expect(res.invalidTargets).toHaveLength(1);
  });

  it('never returns more updates than targets requested', async () => {
    const res = await runCreatorFieldAssist({
      template: imageTpl,
      request: req({ targets: [{ scope: 'flat', fieldKey: 'headline', currentValue: '' }] }),
      llm: jsonLlm([
        { scope: 'flat', field_key: 'headline', value: 'A' },
        { scope: 'flat', field_key: 'subheadline', value: 'B' },
        { scope: 'flat', field_key: 'cta', value: 'C' },
      ]),
    });
    expect(res.updates).toHaveLength(1);
  });
});

describe('Field assist — canonical deterministic validation applied to every response', () => {
  it('repairs forbidden words in the LLM output and reports the violation', async () => {
    const res = await runCreatorFieldAssist({
      template: imageTpl,
      request: req({
        action: 'generate',
        context: { topic: 'Onboarding', brandVoice: { prohibitedPhrases: ['synergy'] } },
        targets: [{ scope: 'flat', fieldKey: 'headline', currentValue: '' }],
      }),
      llm: jsonLlm([{ scope: 'flat', field_key: 'headline', value: 'Unlock world-class synergy today' }]),
    });
    expect(res.updates[0].value.toLowerCase()).not.toContain('synergy');
    expect(res.updates[0].value).not.toMatch(/world-class/i);
    expect(res.violations.length).toBeGreaterThan(0);
  });

  it('falls back to a deterministic value when validation empties the AI output', async () => {
    const res = await runCreatorFieldAssist({
      template: imageTpl,
      request: { assetFamily: 'image', templateId: imageTpl.id, action: 'generate', context: { topic: 'sales', brandVoice: { prohibitedPhrases: ['synergy'] } }, targets: [{ scope: 'flat', fieldKey: 'headline', currentValue: '' }] },
      llm: jsonLlm([{ scope: 'flat', field_key: 'headline', value: 'synergy' }]),
    });
    expect(res.updates[0].value.length).toBeGreaterThan(0);
    expect(res.updates[0].value.toLowerCase()).not.toBe('synergy');
    expect(res.usedFallback).toBe(true);
  });
});

describe('Field assist — tolerant response parsing', () => {
  it('parses JSON wrapped in prose / code fences', () => {
    const resolved = [{ target: { scope: 'flat' as const, fieldKey: 'headline', currentValue: '' }, field: resolveTemplateField(imageTpl, 'flat', 'headline')! }];
    const m = parseAssistResponse('Sure! ```json\n{"updates":[{"scope":"flat","field_key":"headline","value":"Hi"}]}\n```', resolved);
    expect(m.get('flat::headline')).toBe('Hi');
  });
});

describe('Field assist — distinctness (no duplicate sibling copy)', () => {
  it('validator preserves siblings context', () => {
    const v = validateFieldAssistRequest({
      asset_family: 'image', template_id: imageTpl.id, action: 'generate',
      targets: [{ scope: 'flat', field_key: 'subheadline' }],
      context: { topic: 'X', siblings: [{ label: 'Headline', value: 'Launching Omnivyra' }] },
    });
    expect(v.ok).toBe(true);
    expect(v.request?.context?.siblings).toEqual([{ label: 'Headline', value: 'Launching Omnivyra' }]);
  });

  it('prompt shows sibling values and instructs the model not to duplicate them', () => {
    const headline = resolveTemplateField(imageTpl, 'flat', 'headline')!;
    const request = req({
      targets: [{ scope: 'flat', fieldKey: 'subheadline', currentValue: '' }],
      context: { topic: 'Launching Omnivyra', siblings: [{ label: headline.label, value: 'Launching Omnivyra on September 2026' }] },
    });
    const resolved = [{ target: request.targets[0], field: resolveTemplateField(imageTpl, 'flat', 'subheadline')! }];
    const all = buildFieldAssistMessages(imageTpl, request, resolved).map((m) => m.content).join('\n');
    expect(all).toContain('DISTINCT');
    expect(all).toContain('Launching Omnivyra on September 2026'); // sibling headline surfaced
    expect(all).toMatch(/do NOT repeat|not restate/i);
  });

  it('does not list the field being written as its own sibling', () => {
    const headline = resolveTemplateField(imageTpl, 'flat', 'headline')!;
    const request = req({
      targets: [{ scope: 'flat', fieldKey: 'headline', currentValue: '' }],
      context: { siblings: [{ label: headline.label, value: 'An old headline' }] },
    });
    const resolved = [{ target: request.targets[0], field: headline }];
    const user = buildFieldAssistMessages(imageTpl, request, resolved).find((m) => m.role === 'user')!.content;
    expect(user).not.toContain('Already on this asset'); // only sibling equals the target → filtered out
  });
});

describe('Field assist — overlay scope (baked-on creative copy, role-framed)', () => {
  it('validator accepts the overlay scope + role field_key', () => {
    const v = validateFieldAssistRequest({
      asset_family: 'image', template_id: imageTpl.id, action: 'generate',
      targets: [{ scope: 'overlay', field_key: 'keyInsight' }],
    });
    expect(v.ok).toBe(true);
    expect(v.request?.targets[0]).toMatchObject({ scope: 'overlay', fieldKey: 'keyInsight' });
  });

  it('resolves synthetic role fields with role-specific label + max length', () => {
    const ki = resolveTemplateField(imageTpl, 'overlay', 'keyInsight')!;
    expect(ki.label).toMatch(/key insight/i);
    expect(ki.maxLength).toBe(132);
    const hook = resolveTemplateField(imageTpl, 'overlay', 'hook')!;
    expect(hook.label).toMatch(/hook/i);
    expect(resolveTemplateField(imageTpl, 'overlay', 'not-a-role')).toBeNull();
  });

  it('generates an overlay field (only that role returned) and frames the prompt by role + siblings', async () => {
    const request: FieldAssistRequest = {
      assetFamily: 'image', templateId: imageTpl.id, action: 'generate',
      targets: [{ scope: 'overlay', fieldKey: 'supportingText', currentValue: '' }],
      context: { topic: 'Launch', siblings: [{ label: 'Hook', value: 'Launching Omnivyra in September 2026' }] },
    };
    const resolved = [{ target: request.targets[0], field: resolveTemplateField(imageTpl, 'overlay', 'supportingText')! }];
    const prompt = buildFieldAssistMessages(imageTpl, request, resolved).map((m) => m.content).join('\n');
    expect(prompt).toMatch(/supporting text/i);           // role-framed
    expect(prompt).toContain('Launching Omnivyra in September 2026'); // sibling shown, must stay distinct

    const res = await runCreatorFieldAssist({
      template: imageTpl, request,
      llm: jsonLlm([{ scope: 'overlay', field_key: 'supportingText', value: 'Backed by a 40% founding-member discount' }]),
    });
    expect(res.updates).toEqual([{ scope: 'overlay', fieldKey: 'supportingText', index: undefined, value: 'Backed by a 40% founding-member discount' }]);
    expect(res.usedFallback).toBe(false);
  });
});

describe('Field assist — carousel slides are arc-aware (thread structure)', () => {
  it('validator parses per-slide role + role_intent', () => {
    const v = validateFieldAssistRequest({
      asset_family: 'carousel', template_id: carouselTpl.id, action: 'generate',
      targets: [{ scope: 'slide', field_key: 'title', index: 0, role: 'hook', role_intent: 'Open with a curiosity gap' }],
    });
    expect(v.ok).toBe(true);
    expect(v.request?.targets[0]).toMatchObject({ scope: 'slide', fieldKey: 'title', index: 0, role: 'hook', roleIntent: 'Open with a curiosity gap' });
  });

  it('prompt frames each slide by its arc role + intent and adds the narrative-sequence rule', () => {
    const request: FieldAssistRequest = {
      assetFamily: 'carousel', templateId: carouselTpl.id, action: 'generate',
      context: { topic: 'Launch' },
      targets: [
        { scope: 'slide', fieldKey: 'title', index: 0, currentValue: '', role: 'hook', roleIntent: 'Open with a curiosity gap' },
        { scope: 'slide', fieldKey: 'title', index: 3, currentValue: '', role: 'cta', roleIntent: 'Close with a next step' },
      ],
    };
    const resolved = request.targets.map((t) => ({ target: t, field: resolveTemplateField(carouselTpl, 'slide', 'title')! }));
    const prompt = buildFieldAssistMessages(carouselTpl, request, resolved).map((m) => m.content).join('\n');
    expect(prompt).toContain('arc role: hook');
    expect(prompt).toContain('Open with a curiosity gap');
    expect(prompt).toContain('arc role: cta');
    expect(prompt).toMatch(/narrative carousel|advance the story/i);
  });

  it('no arc roles → no narrative-sequence rule (plain per-slide generation unchanged)', () => {
    const request: FieldAssistRequest = {
      assetFamily: 'carousel', templateId: carouselTpl.id, action: 'generate',
      targets: [{ scope: 'slide', fieldKey: 'title', index: 0, currentValue: '' }],
      context: {},
    };
    const resolved = [{ target: request.targets[0], field: resolveTemplateField(carouselTpl, 'slide', 'title')! }];
    const prompt = buildFieldAssistMessages(carouselTpl, request, resolved).map((m) => m.content).join('\n');
    expect(prompt).not.toMatch(/narrative carousel/i);
    expect(prompt).not.toContain('arc role:');
  });
});

describe('Field assist — builds from source content (writer / campaign card / brief)', () => {
  it('validator accepts source_content (snake or camel) and caps it', () => {
    const v = validateFieldAssistRequest({
      asset_family: 'carousel', template_id: carouselTpl.id, action: 'generate',
      targets: [{ scope: 'slide', field_key: 'title', index: 0 }],
      context: { source_content: 'The Writer post body about launching Omnivyra.' },
    });
    expect(v.ok).toBe(true);
    expect(v.request?.context?.sourceContent).toContain('launching Omnivyra');
  });

  it('carousel: source content is framed as the material to turn into the slide sequence', () => {
    const request: FieldAssistRequest = {
      assetFamily: 'carousel', templateId: carouselTpl.id, action: 'generate',
      context: { sourceContent: 'Point one. Point two. Point three.' },
      targets: [
        { scope: 'slide', fieldKey: 'title', index: 0, role: 'hook', roleIntent: 'Open' },
        { scope: 'slide', fieldKey: 'title', index: 1, role: 'cta', roleIntent: 'Close' },
      ],
    };
    const resolved = request.targets.map((t) => ({ target: t, field: resolveTemplateField(carouselTpl, 'slide', 'title')! }));
    const prompt = buildFieldAssistMessages(carouselTpl, request, resolved).map((m) => m.content).join('\n');
    expect(prompt).toContain('Point one. Point two. Point three.');
    expect(prompt).toMatch(/turn this into the slide sequence/i);
  });

  it('non-arc field: source content is framed as ground truth to draw from', () => {
    const request: FieldAssistRequest = {
      assetFamily: 'image', templateId: imageTpl.id, action: 'generate',
      context: { sourceContent: 'Founding members get 40% off.' },
      targets: [{ scope: 'flat', fieldKey: 'headline', currentValue: '' }],
    };
    const resolved = [{ target: request.targets[0], field: resolveTemplateField(imageTpl, 'flat', 'headline')! }];
    const prompt = buildFieldAssistMessages(imageTpl, request, resolved).map((m) => m.content).join('\n');
    expect(prompt).toContain('Founding members get 40% off.');
    expect(prompt).toMatch(/do not contradict or invent beyond it/i);
  });
});
