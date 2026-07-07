import { SYSTEM_TEMPLATES } from '../../../lib/creator-templates/systemTemplates';
import type { TemplateAssetFamily } from '../../../lib/creator-templates/types';
import { CREATOR_OUTCOMES, listOutcomes, getOutcome, creatorOutcomeFirstEnabled } from '../../../lib/creator-outcomes/outcomeRegistry';
import { resolveOutcomeTemplate, outcomeCandidates } from '../../../lib/creator-outcomes/outcomeTemplateMapper';

const FAMILIES: TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];
const allSystemIds = FAMILIES.flatMap((f) => SYSTEM_TEMPLATES[f].map((t) => t.id));
const allMappedIds = CREATOR_OUTCOMES.flatMap((o) => FAMILIES.flatMap((f) => o.templateIds[f] ?? []));

describe('CREATOR-044 — Outcome registry coverage (STEP 8)', () => {
  it('every system template belongs to AT LEAST one outcome (many-to-many; no orphans, no phantoms)', () => {
    const counts = new Map<string, number>();
    for (const id of allMappedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    // Many-to-many membership: a template MAY serve multiple outcomes (no duplicate ban).
    // No orphan templates — every system id is mapped to at least one outcome (full coverage).
    const orphans = allSystemIds.filter((id) => !counts.has(id));
    expect(orphans).toEqual([]);
    // No phantom mappings — every mapped id is a real system template.
    const phantom = allMappedIds.filter((id) => !allSystemIds.includes(id));
    expect(phantom).toEqual([]);
    // Coverage: the set of mapped ids exactly equals the set of system ids (no orphan, no phantom).
    expect(new Set(allMappedIds).size).toBe(allSystemIds.length);
  });

  it('templateIds reference templates of the correct family', () => {
    for (const o of CREATOR_OUTCOMES) {
      for (const f of FAMILIES) {
        for (const id of o.templateIds[f] ?? []) {
          expect(SYSTEM_TEMPLATES[f].some((t) => t.id === id)).toBe(true);
        }
      }
    }
  });

  it('every outcome resolves at least one template, and every supported family resolves', () => {
    for (const o of listOutcomes()) {
      expect(o.supportedFamilies.length).toBeGreaterThan(0);
      for (const f of o.supportedFamilies) {
        expect(outcomeCandidates(o, f).length).toBeGreaterThan(0);
        const res = resolveOutcomeTemplate(o.id, f);
        expect(res).not.toBeNull();
        expect(res!.templateId).toBeTruthy();
        expect((o.templateIds[f] ?? []).includes(res!.templateId)).toBe(true); // always within the outcome
        expect(res!.editorUrl).toBe(`/command-center/creator-content/${f}?template_id=${res!.templateId}`);
      }
    }
  });

  it('resolution is deterministic and falls back to the default template', () => {
    for (const o of listOutcomes()) {
      for (const f of o.supportedFamilies) {
        const a = resolveOutcomeTemplate(o.id, f);
        const b = resolveOutcomeTemplate(o.id, f);
        expect(a!.templateId).toBe(b!.templateId);           // deterministic
      }
    }
    // Unsupported family → null (never a wrong-family template). Robust to many-to-many:
    // assert for EVERY (outcome, family) pair the outcome does not support.
    for (const o of listOutcomes()) {
      for (const f of FAMILIES) {
        if (!o.supportedFamilies.includes(f)) {
          expect(resolveOutcomeTemplate(o.id, f)).toBeNull();
        }
      }
    }
    // Default fallback id is a member of the outcome.
    for (const o of listOutcomes()) {
      for (const f of o.supportedFamilies) {
        expect((o.templateIds[f] ?? []).includes(o.defaultTemplateIds[f]!)).toBe(true);
      }
    }
  });

  it('outcome ids and labels are unique; no duplicate meanings', () => {
    const ids = CREATOR_OUTCOMES.map((o) => o.id);
    const labels = CREATOR_OUTCOMES.map((o) => o.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('flag defaults OFF (current browser preserved)', () => {
    const saved = process.env.NEXT_PUBLIC_CREATOR_OUTCOME_FIRST;
    delete process.env.NEXT_PUBLIC_CREATOR_OUTCOME_FIRST;
    expect(creatorOutcomeFirstEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_CREATOR_OUTCOME_FIRST = '1';
    expect(creatorOutcomeFirstEnabled()).toBe(true);
    if (saved === undefined) delete process.env.NEXT_PUBLIC_CREATOR_OUTCOME_FIRST; else process.env.NEXT_PUBLIC_CREATOR_OUTCOME_FIRST = saved;
  });

  it('reports counts (sanity)', () => {
    expect(CREATOR_OUTCOMES.length).toBe(23);
    expect(allSystemIds.length).toBe(78);
    expect(getOutcome('launch-product')).not.toBeNull();
    expect(getOutcome('nope')).toBeNull();
  });
});
