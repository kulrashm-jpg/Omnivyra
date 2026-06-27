import {
  listTemplatesForFamily, ALL_SYSTEM_TEMPLATES,
  validateTemplateForSave, assertTemplateDeletable, assertTemplateMutable,
  computeChangeImpact, buildAuditEntry, ZERO_REFERENCES,
} from '../../../lib/creator-templates';
import { cloneTemplate, bumpVersion, snapshotVersion, restoreVersion, applyTemplateEdits } from '../../../lib/creator-templates/userTemplate';

describe('TEMPLATE-020 governance (deterministic)', () => {
  const img = listTemplatesForFamily('image').find((t) => t.imageStyle)!;
  const info = listTemplatesForFamily('infographic')[0];
  const car = listTemplatesForFamily('carousel')[0];

  // ── Part A — reference integrity ──
  it('blocks delete of a referenced template with explicit per-surface errors', () => {
    expect(assertTemplateDeletable(ZERO_REFERENCES).ok).toBe(true);
    const r = assertTemplateDeletable({ drafts: 2, scheduled: 1, published: 0, calendar: 0, history: 3 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/2 draft/);
    expect(r.errors.join(' ')).toMatch(/1 scheduled/);
    expect(r.errors.join(' ')).toMatch(/3 asset history/);
    // modify + archive are always allowed (versioning protects history).
    expect(assertTemplateMutable('modify', { drafts: 9, scheduled: 9, published: 9, calendar: 9, history: 9 }).ok).toBe(true);
    expect(assertTemplateMutable('archive', { drafts: 9, scheduled: 9, published: 9, calendar: 9, history: 9 }).ok).toBe(true);
  });

  // ── Part C — compatibility validation ──
  it('accepts every system template', () => {
    for (const t of ALL_SYSTEM_TEMPLATES) {
      const v = validateTemplateForSave(t);
      expect(v.ok).toBe(true);
    }
  });
  it('rejects family mismatch / bad layout / foreign-family style / no fields', () => {
    const badFamily = cloneTemplate(img, 'image', { id: 'bad1', ownerUserId: 'u' });
    (badFamily.renderingContract as any).family = 'carousel';
    expect(validateTemplateForSave(badFamily).ok).toBe(false);

    const badLayout = cloneTemplate(info, 'infographic', { id: 'bad2', ownerUserId: 'u' });
    (badLayout.renderingContract as any).infographicLayout = 'not-a-layout';
    expect(validateTemplateForSave(badLayout).ok).toBe(false);

    const foreignStyle = cloneTemplate(img, 'image', { id: 'bad3', ownerUserId: 'u' });
    (foreignStyle as any).infographicStyle = { color_scheme: {}, card_style: {}, typography: {} };
    expect(validateTemplateForSave(foreignStyle).ok).toBe(false);

    const noFields = cloneTemplate(img, 'image', { id: 'bad4', ownerUserId: 'u' });
    noFields.formDefinition = { fields: [] };
    expect(validateTemplateForSave(noFields).ok).toBe(false);

    const carNoSlides = cloneTemplate(car, 'carousel', { id: 'bad5', ownerUserId: 'u' });
    carNoSlides.formDefinition = { fields: [{ key: 'x', label: 'X', control: 'text', required: true, aiAssist: {} as any }] };
    expect(validateTemplateForSave(carNoSlides).ok).toBe(false);
  });

  // ── Part B — immutable versions ──
  it('every save is a new version; historical snapshots never mutate', () => {
    const v1 = cloneTemplate(info, 'infographic', { id: 'ver', ownerUserId: 'u' });
    expect(v1.version).toBe(1);
    const snap1 = snapshotVersion(v1, 'u', 't1');
    const v2 = bumpVersion(applyTemplateEdits(v1, { name: 'Edited' }).template);
    expect(v2.version).toBe(2);
    expect(v1.name).not.toBe('Edited');         // editing didn't mutate v1
    expect(snap1.template.name).toBe(v1.name);   // snapshot intact
    const restored = restoreVersion(v2, snap1, 't2');
    expect(restored.version).toBe(3);            // restore is a NEW version (history not rewritten)
    expect(restored.name).toBe(v1.name);         // restored content == snapshot
  });

  // ── Part D — change impact (no AI) ──
  it('computes a deterministic change impact', () => {
    const i = computeChangeImpact({ drafts: 2, scheduled: 3, published: 5, calendar: 1, history: 4 });
    expect(i.draftsAffected).toBe(2);
    expect(i.scheduledAffected).toBe(3);
    expect(i.futureRendersAffected).toBe(6); // drafts + scheduled + calendar
    expect(i.historicalUnaffected).toBe(true);
    expect(i.historicalCount).toBe(9);       // published + history
    expect(typeof i.summary).toBe('string');
  });

  // ── Part E — audit trail ──
  it('builds a deterministic audit entry', () => {
    const e = buildAuditEntry('published', { templateId: 'ut-1', templateVersion: 4, actorUserId: 'u9', at: '2026-06-25T00:00:00Z' });
    expect(e).toEqual({ action: 'published', templateId: 'ut-1', templateVersion: 4, actorUserId: 'u9', at: '2026-06-25T00:00:00Z', detail: undefined });
  });
});
