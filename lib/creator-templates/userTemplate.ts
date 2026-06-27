/**
 * User Template System — pure logic (no DB, no fetch).
 *
 * User templates REUSE the canonical `CreatorTemplate` model — they are simply
 * templates with `ownership: 'user'` plus user-scoped metadata (owner/team/
 * status/version lineage). No duplicate template model. The discovery engine,
 * gallery, renderer, validation, and Quality Inspector consume them exactly
 * like system templates.
 *
 * This module owns: cloning (independent copies), the editable-property
 * whitelist (rendering contracts are NOT directly editable), versioning,
 * restore, permissions, publish gating (on the deterministic diagnostic), and
 * organization filtering. All pure + deterministic + testable.
 */

import {
  type CreatorTemplate,
  type TemplateAssetFamily,
  type TemplateRenderingContract,
  CREATOR_TEMPLATE_CONTRACT_VERSION,
  defaultAiAssist,
} from './types';

export type TemplateRole = 'owner' | 'editor' | 'viewer';
export type UserTemplateStatus = 'draft' | 'published' | 'archived';
export type TeamScope = 'personal' | 'team';

/** User-scoped metadata carried in `CreatorTemplate.metadata` for user templates. */
export interface UserTemplateMeta {
  ownerUserId: string;
  teamId?: string | null;
  scope: TeamScope;
  status: UserTemplateStatus;
  parentTemplateId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Library metadata is preserved (keywords/difficulty/aspectSupport/etc.). */
  [k: string]: unknown;
}

function clone<T>(v: T): T {
  // structuredClone preserves canonical style values that JSON corrupts
  // (e.g. `Infinity` in fontMultiplierScale bands → JSON turns it into null),
  // so a cloned user template's style is byte-faithful to its source.
  return typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
}
function meta(t: CreatorTemplate): Record<string, unknown> {
  return (t.metadata ?? {}) as Record<string, unknown>;
}

export function isSystemTemplate(t: CreatorTemplate): boolean {
  return t.ownership === 'system';
}
export function isUserTemplate(t: CreatorTemplate): boolean {
  return t.ownership === 'user';
}
export function userMeta(t: CreatorTemplate): UserTemplateMeta | null {
  const m = meta(t);
  return isUserTemplate(t) && typeof m.ownerUserId === 'string'
    ? (m as unknown as UserTemplateMeta)
    : null;
}

/* ── Blank defaults per family (valid, minimal, render-clean) ────────── */

function blankRenderingContract(family: TemplateAssetFamily): TemplateRenderingContract {
  if (family === 'image') return { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family, purposeKey: 'promotional-image', subtype: 'promotional-image', attachmentMode: 'embedded_copy', writerAssetType: 'banner' };
  if (family === 'carousel') return { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family, purposeKey: 'educational-carousel', frameCount: 5 };
  return { renderingContractVersion: CREATOR_TEMPLATE_CONTRACT_VERSION, family, infographicLayout: 'stats', purposeKey: 'data-visualization' };
}

function blankFormDefinition(family: TemplateAssetFamily): CreatorTemplate['formDefinition'] {
  const ai = defaultAiAssist();
  if (family === 'image') {
    return { fields: [{ key: 'headline', label: 'Headline / Image Text', control: 'textarea', required: true, helperText: 'The main text rendered inside the image.', maxLength: 80, aiAssist: ai }] };
  }
  if (family === 'carousel') {
    return {
      fields: [],
      slides: { countOptions: [5, 7, 10], defaultCount: 5, fields: [
        { key: 'title', label: 'Slide title', control: 'text', required: true, helperText: 'The headline shown on this slide.', maxLength: 70, aiAssist: ai },
        { key: 'body', label: 'Slide body', control: 'textarea', required: false, helperText: 'Supporting copy.', maxLength: 220, aiAssist: ai },
      ] },
    };
  }
  return {
    fields: [{ key: 'headline', label: 'Infographic title', control: 'text', required: true, helperText: 'Title at the top.', maxLength: 70, aiAssist: ai }],
    sections: { kind: 'repeatable', min: 2, max: 6, sectionLabel: 'Statistic', fields: [
      { key: 'metric', label: 'Metric', control: 'text', required: true, helperText: 'The number/stat.', maxLength: 12, aiAssist: ai },
      { key: 'description', label: 'Description', control: 'text', required: true, helperText: 'What it means.', maxLength: 80, aiAssist: ai },
    ] },
  };
}

/* ── Create / clone (independent copies — NO shared references) ──────── */

export interface CloneOptions {
  id: string;
  ownerUserId: string;
  teamId?: string | null;
  scope?: TeamScope;
  name?: string;
  now?: string;
}

/**
 * Create a NEW independent user template from a source (system or user) or from
 * blank (`source === null`). The result is a deep copy — mutating it never
 * affects the source. The rendering contract is copied (not editable later).
 */
export function cloneTemplate(source: CreatorTemplate | null, family: TemplateAssetFamily, opts: CloneOptions): CreatorTemplate {
  const base: CreatorTemplate = source
    ? clone(source)
    : {
        id: opts.id,
        assetFamily: family,
        name: 'Untitled template',
        category: 'Custom',
        description: '',
        preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: {} },
        visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#2563eb', surface: '#0b1220' },
        formDefinition: blankFormDefinition(family),
        renderingContract: blankRenderingContract(family),
        version: 1,
        status: 'draft',
        ownership: 'user',
        tags: ['custom'],
        metadata: {},
      };

  const sourceMeta = meta(base);
  const userMetadata: UserTemplateMeta = {
    ...sourceMeta,
    ownerUserId: opts.ownerUserId,
    teamId: opts.teamId ?? null,
    scope: opts.scope ?? (opts.teamId ? 'team' : 'personal'),
    status: 'draft',
    parentTemplateId: source ? source.id : null,
    createdAt: opts.now,
    updatedAt: opts.now,
  };

  return {
    ...base,
    id: opts.id,
    name: opts.name ?? (source ? `${source.name} (Copy)` : base.name),
    assetFamily: source ? source.assetFamily : family,
    ownership: 'user',
    status: 'draft',
    version: 1,
    metadata: userMetadata as unknown as Record<string, unknown>,
  };
}

/* ── Editable property whitelist (NO direct rendering-contract edits) ── */

export const EDITABLE_TEMPLATE_KEYS = [
  'name', 'category', 'description', 'preview', 'visualLanguage', 'formDefinition', 'tags',
] as const;
export type EditableTemplateKey = typeof EDITABLE_TEMPLATE_KEYS[number];

/** Editable metadata sub-keys (aspect support, AI capability defaults, etc.). */
export const EDITABLE_METADATA_KEYS = ['aspectSupport', 'recommendedUseCases', 'difficulty', 'keywords', 'defaultValues'] as const;

export interface ApplyEditsResult {
  template: CreatorTemplate;
  applied: string[];
  rejected: string[];
}

/**
 * Apply ONLY whitelisted edits. Rendering-contract / ownership / version edits
 * are rejected (never applied directly). Returns the new template + audit.
 */
export function applyTemplateEdits(template: CreatorTemplate, edits: Record<string, unknown>, now?: string): ApplyEditsResult {
  const next = clone(template);
  const applied: string[] = [];
  const rejected: string[] = [];

  for (const [k, v] of Object.entries(edits)) {
    if (k === 'metadata' && v && typeof v === 'object') {
      const m = meta(next);
      for (const [mk, mv] of Object.entries(v as Record<string, unknown>)) {
        if ((EDITABLE_METADATA_KEYS as readonly string[]).includes(mk)) { m[mk] = mv; applied.push(`metadata.${mk}`); }
        else rejected.push(`metadata.${mk}`);
      }
      next.metadata = m;
      continue;
    }
    if ((EDITABLE_TEMPLATE_KEYS as readonly string[]).includes(k)) {
      (next as unknown as Record<string, unknown>)[k] = v;
      applied.push(k);
    } else {
      rejected.push(k); // renderingContract / ownership / version / id / status etc.
    }
  }

  const m = meta(next);
  m.updatedAt = now ?? m.updatedAt;
  next.metadata = m;
  return { template: next, applied, rejected };
}

/* ── Versioning ──────────────────────────────────────────────────────── */

export interface TemplateVersionSnapshot {
  version: number;
  createdAt?: string;
  createdBy?: string;
  template: CreatorTemplate;
}

/** Increment the version (every save creates a version). */
export function bumpVersion(template: CreatorTemplate, now?: string): CreatorTemplate {
  const next = clone(template);
  next.version = (template.version ?? 1) + 1;
  const m = meta(next);
  m.updatedAt = now ?? m.updatedAt;
  next.metadata = m;
  return next;
}

export function snapshotVersion(template: CreatorTemplate, createdBy?: string, now?: string): TemplateVersionSnapshot {
  return { version: template.version, createdAt: now, createdBy, template: clone(template) };
}

/**
 * Restore a prior version's CONTENT while advancing the version counter (a
 * restore is itself a new version — history is never rewritten).
 */
export function restoreVersion(current: CreatorTemplate, snapshot: TemplateVersionSnapshot, now?: string): CreatorTemplate {
  const restored = clone(snapshot.template);
  restored.id = current.id;
  restored.ownership = 'user';
  restored.version = (current.version ?? 1) + 1;
  const m = { ...meta(current), ...meta(restored) };
  m.updatedAt = now ?? m.updatedAt;
  m.restoredFromVersion = snapshot.version;
  restored.metadata = m;
  return restored;
}

/* ── Permissions ─────────────────────────────────────────────────────── */

export function canModify(role: TemplateRole, template: CreatorTemplate): boolean {
  if (isSystemTemplate(template)) return false; // system templates are immutable
  return role === 'owner' || role === 'editor';
}
export function canPublishRole(role: TemplateRole, template: CreatorTemplate): boolean {
  return canModify(role, template);
}

/* ── Publish gating (deterministic diagnostic) ───────────────────────── */

export interface PublishGate {
  ok: boolean;
  reasons: string[];
}

/**
 * A template may publish only when the deterministic diagnostic passes visual
 * validation and clears the readiness floor. Reuses the existing diagnostic
 * report shape (visualValidation.passed + scores.overallReadiness.value).
 */
export function canPublishTemplate(diagnostic: unknown, minReadiness = 70): PublishGate {
  const d = (diagnostic && typeof diagnostic === 'object' ? diagnostic : {}) as Record<string, unknown>;
  const vv = (d.visualValidation && typeof d.visualValidation === 'object' ? d.visualValidation : {}) as Record<string, unknown>;
  const scores = (d.scores && typeof d.scores === 'object' ? d.scores : {}) as Record<string, unknown>;
  const readiness = (scores.overallReadiness && typeof scores.overallReadiness === 'object' ? scores.overallReadiness : {}) as Record<string, unknown>;
  const reasons: string[] = [];
  if (!d.reportVersion) reasons.push('No diagnostic report — generate a preview first.');
  if (vv.passed !== true) reasons.push('Visual validation failed — fix layout/contrast/typography before publishing.');
  const value = typeof readiness.value === 'number' ? readiness.value : 0;
  if (value < minReadiness) reasons.push(`Overall readiness ${value} is below the ${minReadiness} publish threshold.`);
  return { ok: reasons.length === 0, reasons };
}

/** Transition a user template to published (gated). Pure — caller persists. */
export function publishTemplate(template: CreatorTemplate, diagnostic: unknown, now?: string): { template: CreatorTemplate; gate: PublishGate } {
  const gate = canPublishTemplate(diagnostic);
  if (!gate.ok) return { template, gate };
  const next = clone(template);
  next.status = 'published';
  const m = meta(next);
  m.status = 'published';
  m.publishedAt = now ?? m.updatedAt;
  next.metadata = m;
  return { template: next, gate };
}

export function archiveTemplate(template: CreatorTemplate, now?: string): CreatorTemplate {
  const next = clone(template);
  const m = meta(next);
  m.status = 'archived';
  m.archivedAt = now ?? m.updatedAt;
  next.metadata = m;
  // Keep CreatorTemplate.status within its union; archive is tracked in meta.
  next.status = 'draft';
  return next;
}

/* ── Organization filtering ──────────────────────────────────────────── */

export interface OrganizationFilter {
  scope?: TeamScope | 'all';
  status?: UserTemplateStatus | 'all';
  ownerUserId?: string;
  teamId?: string;
  includeArchived?: boolean;
}

export function filterUserTemplates(templates: readonly CreatorTemplate[], f: OrganizationFilter = {}): CreatorTemplate[] {
  return templates.filter((t) => {
    const um = userMeta(t);
    if (!um) return false;
    if (f.ownerUserId && um.ownerUserId !== f.ownerUserId) return false;
    if (f.teamId && um.teamId !== f.teamId) return false;
    if (f.scope && f.scope !== 'all' && um.scope !== f.scope) return false;
    const status = um.status;
    if (!f.includeArchived && status === 'archived' && f.status !== 'archived') return false;
    if (f.status && f.status !== 'all' && status !== f.status) return false;
    return true;
  });
}
