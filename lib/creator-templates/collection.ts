/**
 * Template Collections (Design Systems) — pure logic (no DB, no fetch).
 *
 * A Collection GROUPS existing Creator Templates into one reusable visual
 * system. It REFERENCES templates by id — it never duplicates the template
 * model, never owns a rendering path, never re-validates templates itself
 * (it reuses the template validation via the injected resolver). Collections
 * organize templates; they never replace them.
 */

import type { CreatorTemplate, TemplateAssetFamily } from './types';

export type CollectionStatus = 'draft' | 'published' | 'archived';
export type CollectionScope = 'personal' | 'team';

export interface CollectionPreview {
  /** The member template whose rendered preview is the cover (no new render). */
  coverTemplateId: string | null;
  /** Cached cover image URL (resolved from the cover member's preview). */
  coverUrl: string | null;
}

/** A first-class Template Collection. Templates are referenced, not embedded. */
export interface TemplateCollection {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Brand/visual style label (shared design language across members). */
  brandStyle: string;
  ownerUserId: string;
  teamId?: string | null;
  scope: CollectionScope;
  version: number;
  status: CollectionStatus;
  /** Ordered references to existing templates (system OR user). */
  templateIds: string[];
  preview: CollectionPreview;
  tags: string[];
  metadata: Record<string, unknown>;
  ownership: 'user';
  createdAt?: string;
  updatedAt?: string;
}

/** Resolver injected by callers — maps a template id → CreatorTemplate (or null). */
export type TemplateResolver = (id: string) => CreatorTemplate | null;

export interface CreateCollectionOptions {
  id: string;
  ownerUserId: string;
  teamId?: string | null;
  scope?: CollectionScope;
  name?: string;
  description?: string;
  category?: string;
  brandStyle?: string;
  templateIds?: string[];
  now?: string;
}

function uniq(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.trim())));
}

/** Create a new (possibly empty) collection. References are de-duplicated. */
export function createCollection(opts: CreateCollectionOptions): TemplateCollection {
  const templateIds = uniq(opts.templateIds ?? []);
  return {
    id: opts.id,
    name: opts.name?.trim() || 'Untitled collection',
    description: opts.description?.trim() || '',
    category: opts.category?.trim() || 'Custom',
    brandStyle: opts.brandStyle?.trim() || 'corporate',
    ownerUserId: opts.ownerUserId,
    teamId: opts.teamId ?? null,
    scope: opts.scope ?? (opts.teamId ? 'team' : 'personal'),
    version: 1,
    status: 'draft',
    templateIds,
    preview: { coverTemplateId: templateIds[0] ?? null, coverUrl: null },
    tags: ['collection'],
    metadata: { createdAt: opts.now, updatedAt: opts.now },
    ownership: 'user',
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

function touch<T extends TemplateCollection>(c: T, now?: string): T {
  return { ...c, updatedAt: now, metadata: { ...c.metadata, updatedAt: now } };
}

/** Add a template reference (idempotent; never duplicates). */
export function addTemplate(c: TemplateCollection, templateId: string, now?: string): TemplateCollection {
  if (!templateId || c.templateIds.includes(templateId)) return c;
  const templateIds = [...c.templateIds, templateId];
  const preview = c.preview.coverTemplateId ? c.preview : { coverTemplateId: templateId, coverUrl: null };
  return touch({ ...c, templateIds, preview }, now);
}

/** Remove a template reference (the template itself is untouched). */
export function removeTemplate(c: TemplateCollection, templateId: string, now?: string): TemplateCollection {
  if (!c.templateIds.includes(templateId)) return c;
  const templateIds = c.templateIds.filter((id) => id !== templateId);
  const preview = c.preview.coverTemplateId === templateId
    ? { coverTemplateId: templateIds[0] ?? null, coverUrl: null }
    : c.preview;
  return touch({ ...c, templateIds, preview }, now);
}

/** Reorder references. Ids not already present are ignored; missing ones kept. */
export function reorderTemplates(c: TemplateCollection, orderedIds: string[], now?: string): TemplateCollection {
  const present = new Set(c.templateIds);
  const ordered = uniq(orderedIds).filter((id) => present.has(id));
  const remaining = c.templateIds.filter((id) => !ordered.includes(id));
  return touch({ ...c, templateIds: [...ordered, ...remaining] }, now);
}

/** Whitelisted metadata edits: name / description / category / brandStyle / tags / cover. */
export interface CollectionEdits {
  name?: string;
  description?: string;
  category?: string;
  brandStyle?: string;
  tags?: string[];
  coverTemplateId?: string;
}

export function applyCollectionEdits(c: TemplateCollection, edits: CollectionEdits, now?: string): TemplateCollection {
  const next: TemplateCollection = { ...c };
  if (typeof edits.name === 'string' && edits.name.trim()) next.name = edits.name.trim();
  if (typeof edits.description === 'string') next.description = edits.description.trim();
  if (typeof edits.category === 'string' && edits.category.trim()) next.category = edits.category.trim();
  if (typeof edits.brandStyle === 'string' && edits.brandStyle.trim()) next.brandStyle = edits.brandStyle.trim();
  if (Array.isArray(edits.tags)) next.tags = uniq(edits.tags);
  if (typeof edits.coverTemplateId === 'string' && c.templateIds.includes(edits.coverTemplateId)) {
    next.preview = { coverTemplateId: edits.coverTemplateId, coverUrl: null };
  }
  return touch(next, now);
}

/** Duplicate a collection into a new independent copy (references are shared). */
export function duplicateCollection(c: TemplateCollection, opts: { id: string; ownerUserId: string; now?: string }): TemplateCollection {
  return {
    ...c,
    id: opts.id,
    name: `${c.name} (Copy)`,
    ownerUserId: opts.ownerUserId,
    version: 1,
    status: 'draft',
    preview: { coverTemplateId: c.preview.coverTemplateId, coverUrl: null },
    metadata: { ...c.metadata, parentCollectionId: c.id, createdAt: opts.now, updatedAt: opts.now },
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

export function bumpCollectionVersion(c: TemplateCollection): TemplateCollection {
  return { ...c, version: c.version + 1 };
}

/* ── Resolution + validation (reuses template validation via resolver) ── */

/** Resolve referenced templates in order (missing references dropped). */
export function resolveCollectionTemplates(c: TemplateCollection, resolve: TemplateResolver): CreatorTemplate[] {
  return c.templateIds.map(resolve).filter((t): t is CreatorTemplate => t !== null);
}

export interface CollectionValidation {
  ok: boolean;
  errors: string[];
  /** Reference ids that did not resolve to a template. */
  missing: string[];
}

/**
 * Validate ONLY collection-level invariants:
 *  - every referenced template exists (resolves)
 *  - all members are compatible Creator asset families
 *  - no duplicate references
 * Per-template validity is the template system's job (not re-validated here).
 */
export function validateCollection(c: TemplateCollection, resolve: TemplateResolver): CollectionValidation {
  const errors: string[] = [];
  const missing: string[] = [];
  const families: TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];

  if (c.templateIds.length !== new Set(c.templateIds).size) errors.push('Duplicate template references.');

  for (const id of c.templateIds) {
    const t = resolve(id);
    if (!t) { missing.push(id); continue; }
    if (!families.includes(t.assetFamily)) errors.push(`Incompatible asset family for ${id}: ${t.assetFamily}.`);
  }
  if (missing.length) errors.push(`Missing template references: ${missing.join(', ')}.`);

  return { ok: errors.length === 0, errors, missing };
}

/* ── Collection-aware recommendation (Creator flow) ────────────────────── */

/**
 * Given a selected collection and the asset family the user chose, return the
 * collection's template for that family — the cover wins when it matches,
 * otherwise the first member of that family. Null when the collection has no
 * member for the family.
 */
export function recommendTemplateForFamily(
  c: TemplateCollection,
  family: TemplateAssetFamily,
  resolve: TemplateResolver,
): CreatorTemplate | null {
  const cover = c.preview.coverTemplateId ? resolve(c.preview.coverTemplateId) : null;
  if (cover && cover.assetFamily === family) return cover;
  for (const id of c.templateIds) {
    const t = resolve(id);
    if (t && t.assetFamily === family) return t;
  }
  return null;
}

/** Families a collection covers (for badges / completeness in discovery). */
export function collectionFamilies(c: TemplateCollection, resolve: TemplateResolver): TemplateAssetFamily[] {
  const seen = new Set<TemplateAssetFamily>();
  for (const id of c.templateIds) {
    const t = resolve(id);
    if (t) seen.add(t.assetFamily);
  }
  return Array.from(seen);
}
