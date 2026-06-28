import { SYSTEM_TEMPLATES } from '../../../lib/creator-templates/systemTemplates';
import { templateVisualFamily, templateBusinessTitle, VISUAL_FAMILY_LABELS, hasBusinessTitleOverride } from '../../../lib/creator-outcomes/visualTemplateTaxonomy';

const FAMILIES = ['image', 'carousel', 'infographic'] as const;
const allTemplates = FAMILIES.flatMap((f) => SYSTEM_TEMPLATES[f]);

describe('CREATOR-049 — Visual template taxonomy + business titles', () => {
  it('STEP 2 — every template maps to EXACTLY one visual family', () => {
    for (const t of allTemplates) {
      const vf = templateVisualFamily(t.id);
      expect(vf).not.toBeNull();
      expect(VISUAL_FAMILY_LABELS[vf!]).toBeTruthy();
    }
  });

  it('STEP 3 — every template gets a business-language title (no implementation jargon)', () => {
    const jargon = /\b(headline|logo only|checklist 2|before after 3|sub-cta|sys-)\b/i;
    for (const t of allTemplates) {
      const title = templateBusinessTitle(t.id, t.name);
      expect(title.trim().length).toBeGreaterThan(2);
      if (hasBusinessTitleOverride(t.id)) expect(jargon.test(title)).toBe(false); // overridden titles are clean
    }
  });

  it('reuses the outcome registry (no duplicate ownership) — visual family is deterministic', () => {
    for (const t of allTemplates) expect(templateVisualFamily(t.id)).toBe(templateVisualFamily(t.id));
    // Implementation-named examples are reframed in business language.
    expect(templateBusinessTitle('sys-image-headline', 'Bold Headline')).toBe('Bold Statement');
    expect(templateBusinessTitle('sys-image-before-after', 'Before / After')).toBe('Product Transformation');
    expect(templateBusinessTitle('sys-image-checklist', 'Checklist')).toBe('Action Checklist');
  });

  it('unknown template resolves safely', () => {
    expect(templateVisualFamily('does-not-exist')).toBeNull();
    expect(templateBusinessTitle('does-not-exist')).toBe('does-not-exist');
    expect(templateBusinessTitle('does-not-exist', 'Fallback')).toBe('Fallback');
  });
});
