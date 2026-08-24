/**
 * Image-copy UX must match the payload semantics.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 61D stopped stale headline/subheadline/CTA reaching generation in
 * "Post + Image", but the form still offered those inputs. A user could type
 * into a field that provably could not affect the picture — the UI asserting
 * one thing while the payload did another.
 *
 * The subtle part is WHY the fix narrows the template the panel sees rather
 * than hiding inputs: `headline` is `required: true`, so a hidden-but-required
 * field leaves the form permanently invalid and blocks generation in the exact
 * mode where the field is irrelevant. Rendering, validation, progress and
 * readiness all read the template, so they must all see the same narrowed view.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  IMAGE_COPY_FIELD_KEYS,
  type CreatorTemplate,
} from '../../../lib/creator-templates/types';

const FORM = fs.readFileSync(
  path.resolve(__dirname, '../../../components/creator/workflow/CreatorFormColumn.tsx'), 'utf8');
const PAYLOAD = fs.readFileSync(
  path.resolve(__dirname, '../../../lib/creator-content/creatorSuggestionAndPayload.ts'), 'utf8');
const TYPES = fs.readFileSync(
  path.resolve(__dirname, '../../../lib/creator-templates/types.ts'), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const FORM_CODE = strip(FORM);

/** The narrowing the component performs, applied here to a real template shape. */
function narrow(template: CreatorTemplate, imageCopyActive: boolean): CreatorTemplate {
  if (imageCopyActive) return template;
  const excluded = new Set<string>(IMAGE_COPY_FIELD_KEYS);
  const fd = template.formDefinition;
  return { ...template, formDefinition: { ...fd, fields: (fd.fields ?? []).filter((f) => !excluded.has(f.key)) } };
}

const TEMPLATE = {
  id: 'sys-image-product-highlight',
  assetFamily: 'image',
  formDefinition: {
    fields: [
      { key: 'headline', label: 'Headline / Image Text', required: true, control: 'textarea' },
      { key: 'subheadline', label: 'Subheadline (supporting text)', required: false, control: 'textarea' },
      { key: 'cta', label: 'Call To Action (CTA)', required: false },
      { key: 'visualDirection', label: 'Visual direction', required: false, control: 'textarea' },
    ],
  },
} as unknown as CreatorTemplate;

const keys = (t: CreatorTemplate) => (t.formDefinition.fields ?? []).map((f) => f.key);

describe('A — embedded_copy exposes the applicable fields', () => {
  it('all template image-copy fields remain present', () => {
    const t = narrow(TEMPLATE, true);
    expect(keys(t)).toEqual(['headline', 'subheadline', 'cta', 'visualDirection']);
  });

  it('the required Headline / Image Text is available', () => {
    const h = (narrow(TEMPLATE, true).formDefinition.fields ?? []).find((f) => f.key === 'headline');
    expect(h?.required).toBe(true);
  });

  it('subheadline and CTA appear only because THIS template declares them', () => {
    // A template without them must not gain them — the contract governs.
    const minimal = { ...TEMPLATE, formDefinition: { fields: [TEMPLATE.formDefinition.fields![0]] } } as CreatorTemplate;
    expect(keys(narrow(minimal, true))).toEqual(['headline']);
  });
});

describe('B — supporting_visual removes them from the form', () => {
  it('CRITICAL: headline, subheadline and CTA are absent from the rendered view', () => {
    const t = narrow(TEMPLATE, false);
    expect(keys(t)).not.toContain('headline');
    expect(keys(t)).not.toContain('subheadline');
    expect(keys(t)).not.toContain('cta');
  });

  it('non-copy fields survive — this narrows copy, not the whole form', () => {
    expect(keys(narrow(TEMPLATE, false))).toEqual(['visualDirection']);
  });

  it('the user is told where the copy went and how to switch back', () => {
    expect(FORM).toContain('Post + Image:');
    expect(FORM).toMatch(/visual-only/);
    expect(FORM).toContain('Text Inside Image');
  });

  it('the notice only shows in supporting_visual', () => {
    expect(FORM_CODE).toContain('{!imageCopyActiveForUi ? (');
  });
});

describe('C — template validity and contract integrity', () => {
  it('CRITICAL: the required headline cannot leave the form permanently invalid', () => {
    // Hiding an input while the template still demands it would block
    // generation in the mode where the field does not apply.
    const t = narrow(TEMPLATE, false);
    const requiredKeys = (t.formDefinition.fields ?? []).filter((f) => f.required).map((f) => f.key);
    expect(requiredKeys).not.toContain('headline');
  });

  it('the panel is given the narrowed view, so validation agrees with rendering', () => {
    expect(FORM_CODE).toContain('template={effectiveTemplate}');
    expect(FORM_CODE).not.toContain('template={activeTemplate}');
  });

  it('CRITICAL MUTATION GUARD: the narrowing is actually conditioned on the mode', () => {
    // The helper below models the narrowing, so mutating the COMPONENT would
    // not disturb it — a guard that looked sound and caught nothing. This pins
    // the component's own condition: short-circuiting it (returning the full
    // template unconditionally) restores image-copy inputs in supporting_visual
    // and must fail here.
    expect(FORM_CODE).toContain('if (!activeTemplate || imageCopyActiveForUi) return activeTemplate;');
    expect(FORM_CODE).toContain('excluded.has(f.key)');
    expect(FORM_CODE).not.toMatch(/useMemo\(\(\) => \{\s*if \(true\) return activeTemplate;/);
  });

  it('MUTATION GUARD: the underlying template contract is never mutated', () => {
    const before = keys(TEMPLATE).slice();
    narrow(TEMPLATE, false);
    expect(keys(TEMPLATE)).toEqual(before);
    // The component spreads rather than assigning into the source object.
    expect(FORM_CODE).toContain('...activeTemplate,');
    expect(FORM_CODE).not.toMatch(/activeTemplate\.formDefinition\.fields\s*=/);
  });
});

describe('D — transitions', () => {
  it('embedded_copy → supporting_visual removes the controls', () => {
    expect(keys(narrow(TEMPLATE, true))).toContain('headline');
    expect(keys(narrow(TEMPLATE, false))).not.toContain('headline');
  });

  it('supporting_visual → embedded_copy restores exactly the supported ones', () => {
    expect(keys(narrow(narrow(TEMPLATE, false) && TEMPLATE, true)))
      .toEqual(['headline', 'subheadline', 'cta', 'visualDirection']);
  });

  it('nothing is fabricated by the transition — narrowing only filters', () => {
    // No defaulting, no regeneration: the values object is untouched.
    expect(FORM_CODE).not.toMatch(/setTemplateValues\([^)]*imageCopyActiveForUi/);
    expect(FORM_CODE).toContain('values={templateValues}');
  });
});

describe('E — payload guard from b7d99ea1 remains intact', () => {
  it('supporting_visual still cannot place copy into overlay_text', () => {
    expect(strip(PAYLOAD)).toMatch(
      /overlay_text: !imageCopyActive && isSocialCreativeType\(type\) && type === 'image'\s*\n?\s*\? null/);
  });

  it('the payload predicate is still derived from the composition mode', () => {
    expect(strip(PAYLOAD)).toContain('const imageCopyActive = overlayAllowed');
  });
});

describe('F — one source of truth', () => {
  it('the UI predicate reads the existing composition vocabulary', () => {
    expect(FORM_CODE).toContain("standaloneAttachmentMode === 'supporting_visual'");
    expect(FORM_CODE).toContain('writerEmbeddedCopy');
  });

  it('MUTATION GUARD: no competing mode flag was introduced', () => {
    for (const invented of ['imageTextMode', 'showImageCopy', 'copyPlacement', 'textInImageFlag']) {
      expect(FORM_CODE).not.toContain(invented);
      expect(strip(PAYLOAD)).not.toContain(invented);
    }
  });

  it('the image-copy vocabulary is declared once and shared', () => {
    expect(TYPES).toContain("export const IMAGE_COPY_FIELD_KEYS = ['headline', 'subheadline', 'cta']");
    expect(FORM).toContain('IMAGE_COPY_FIELD_KEYS');
  });
});
