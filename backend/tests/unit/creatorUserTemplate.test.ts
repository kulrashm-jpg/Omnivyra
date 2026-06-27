import { getTemplateById } from '../../../lib/creator-templates';
import {
  cloneTemplate,
  applyTemplateEdits,
  bumpVersion,
  snapshotVersion,
  restoreVersion,
  canModify,
  canPublishTemplate,
  publishTemplate,
  archiveTemplate,
  filterUserTemplates,
  isSystemTemplate,
  isUserTemplate,
  userMeta,
} from '../../../lib/creator-templates/userTemplate';

const sys = getTemplateById('sys-image-headline-sub-cta')!;

function passingDiagnostic() {
  return { reportVersion: 'creator-diagnostic-v1', visualValidation: { passed: true, failures: [] }, scores: { overallReadiness: { value: 88, reason: 'ok' } } };
}

describe('User templates — clone (independent copy)', () => {
  it('clones a system template into an editable, independent user template', () => {
    const t = cloneTemplate(sys, 'image', { id: 'usr-1', ownerUserId: 'u1', now: 'T0' });
    expect(t.ownership).toBe('user');
    expect(t.status).toBe('draft');
    expect(t.version).toBe(1);
    expect(userMeta(t)?.ownerUserId).toBe('u1');
    expect(userMeta(t)?.parentTemplateId).toBe(sys.id);
    expect(isUserTemplate(t)).toBe(true);
    // Independent — mutating the copy never affects the source.
    t.formDefinition.fields[0].label = 'CHANGED';
    expect(sys.formDefinition.fields[0].label).not.toBe('CHANGED');
    expect(isSystemTemplate(sys)).toBe(true);
  });

  it('creates a valid blank template per family', () => {
    const img = cloneTemplate(null, 'image', { id: 'b1', ownerUserId: 'u1' });
    expect(img.assetFamily).toBe('image');
    expect(img.formDefinition.fields.length).toBeGreaterThan(0);
    const car = cloneTemplate(null, 'carousel', { id: 'b2', ownerUserId: 'u1' });
    expect(car.formDefinition.slides?.defaultCount).toBe(5);
    const info = cloneTemplate(null, 'infographic', { id: 'b3', ownerUserId: 'u1' });
    expect(info.formDefinition.sections?.min).toBe(2);
  });
});

describe('User templates — editable whitelist (no contract edits)', () => {
  it('applies editable props and rejects rendering-contract / version edits', () => {
    const t = cloneTemplate(sys, 'image', { id: 'usr-2', ownerUserId: 'u1' });
    const r = applyTemplateEdits(t, {
      name: 'My Promo',
      category: 'Marketing',
      visualLanguage: { ...t.visualLanguage, accent: '#ff0000' },
      renderingContract: { family: 'carousel' }, // must be rejected
      ownership: 'system', // must be rejected
      version: 99, // must be rejected
    });
    expect(r.template.name).toBe('My Promo');
    expect(r.template.category).toBe('Marketing');
    expect(r.template.visualLanguage.accent).toBe('#ff0000');
    expect(r.template.renderingContract.family).toBe('image'); // unchanged
    expect(r.template.ownership).toBe('user');
    expect(r.template.version).toBe(1);
    expect(r.rejected).toEqual(expect.arrayContaining(['renderingContract', 'ownership', 'version']));
  });

  it('applies only whitelisted metadata sub-keys', () => {
    const t = cloneTemplate(sys, 'image', { id: 'usr-3', ownerUserId: 'u1' });
    const r = applyTemplateEdits(t, { metadata: { aspectSupport: ['square'], ownerUserId: 'HACKER' } });
    expect((r.template.metadata as any).aspectSupport).toEqual(['square']);
    expect((r.template.metadata as any).ownerUserId).toBe('u1'); // not overwritten
    expect(r.rejected).toContain('metadata.ownerUserId');
  });
});

describe('User templates — versioning + restore', () => {
  it('bumps version and restores prior content as a new version', () => {
    let t = cloneTemplate(sys, 'image', { id: 'usr-4', ownerUserId: 'u1' });
    const v1 = snapshotVersion(t, 'u1', 'T1');
    t = applyTemplateEdits(t, { name: 'V2 name' }).template;
    t = bumpVersion(t);
    expect(t.version).toBe(2);
    const restored = restoreVersion(t, v1, 'T2');
    expect(restored.version).toBe(3); // restore is a new version
    expect(restored.name).toBe(v1.template.name); // content restored from v1 snapshot
    expect(restored.name).not.toBe('V2 name');
    expect((restored.metadata as any).restoredFromVersion).toBe(1);
  });
});

describe('User templates — permissions', () => {
  it('owner/editor can modify; viewer cannot; system templates immutable', () => {
    const t = cloneTemplate(sys, 'image', { id: 'usr-5', ownerUserId: 'u1' });
    expect(canModify('owner', t)).toBe(true);
    expect(canModify('editor', t)).toBe(true);
    expect(canModify('viewer', t)).toBe(false);
    expect(canModify('owner', sys)).toBe(false); // system immutable
  });
});

describe('User templates — publish gating', () => {
  it('blocks publish without a passing diagnostic', () => {
    expect(canPublishTemplate(undefined).ok).toBe(false);
    expect(canPublishTemplate({ reportVersion: 'x', visualValidation: { passed: false }, scores: { overallReadiness: { value: 90 } } }).ok).toBe(false);
    expect(canPublishTemplate({ reportVersion: 'x', visualValidation: { passed: true }, scores: { overallReadiness: { value: 40 } } }).ok).toBe(false);
  });

  it('publishes only when the diagnostic passes', () => {
    const t = cloneTemplate(sys, 'image', { id: 'usr-6', ownerUserId: 'u1' });
    const blocked = publishTemplate(t, { reportVersion: 'x', visualValidation: { passed: false }, scores: {} });
    expect(blocked.gate.ok).toBe(false);
    expect(blocked.template.status).toBe('draft'); // unchanged
    const ok = publishTemplate(t, passingDiagnostic());
    expect(ok.gate.ok).toBe(true);
    expect(ok.template.status).toBe('published');
  });
});

describe('User templates — organization filtering', () => {
  const mk = (id: string, owner: string, status: string, scope: string, team?: string) => {
    const t = cloneTemplate(sys, 'image', { id, ownerUserId: owner, teamId: team ?? null, scope: scope as any });
    (t.metadata as any).status = status;
    return t;
  };
  const list = [mk('a', 'u1', 'draft', 'personal'), mk('b', 'u1', 'published', 'personal'), mk('c', 'u1', 'archived', 'personal'), mk('d', 'u2', 'published', 'team', 'tA')];

  it('filters by owner / status / scope / archived', () => {
    expect(filterUserTemplates(list, { ownerUserId: 'u1' }).map((t) => t.id).sort()).toEqual(['a', 'b']); // archived excluded by default
    expect(filterUserTemplates(list, { ownerUserId: 'u1', status: 'archived' }).map((t) => t.id)).toEqual(['c']);
    expect(filterUserTemplates(list, { scope: 'team' }).map((t) => t.id)).toEqual(['d']);
    expect(filterUserTemplates(list, { status: 'published' }).map((t) => t.id).sort()).toEqual(['b', 'd']);
  });
});
