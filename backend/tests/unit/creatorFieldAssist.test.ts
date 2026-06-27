import { getTemplateById } from '../../../lib/creator-templates';
import {
  validateFieldAssistRequest,
  runCreatorFieldAssist,
  resolveTemplateField,
  fieldAllowsAction,
  deterministicTransform,
  parseAssistResponse,
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
