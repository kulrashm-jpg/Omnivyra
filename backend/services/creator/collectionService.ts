/**
 * Template Collection Service — persistence for Collections (Design Systems).
 *
 * Collections REFERENCE existing templates (system or user) by id. This service
 * resolves those references (getTemplateById for system, getUserTemplate for
 * user), derives the cover from a member's EXISTING rendered preview (no new
 * render), and validates collection-level invariants via the pure model. No
 * duplicate template model, no rendering path.
 *
 * Best-effort: an unapplied `creator_template_collections` table yields [] / null
 * so the rest of the creator surface is unaffected.
 */

import { supabase } from '../../db/supabaseClient';
import { getTemplateById, type CreatorTemplate } from '../../../lib/creator-templates';
import { blueprintCoverage, type BlueprintCoverage } from '../../../lib/creator-templates/storyBlueprint';
import {
  type TemplateCollection,
  type TemplateResolver,
  type CollectionEdits,
  type CollectionValidation,
  createCollection,
  applyCollectionEdits,
  addTemplate,
  removeTemplate,
  reorderTemplates,
  duplicateCollection,
  bumpCollectionVersion,
  validateCollection,
} from '../../../lib/creator-templates/collection';
import { getUserTemplate } from './userTemplateService';

const TABLE = 'creator_template_collections';
const nowIso = () => new Date().toISOString();

function hydrate(row: Record<string, unknown>): TemplateCollection | null {
  const cj = row.collection_json;
  if (!cj || typeof cj !== 'object') return null;
  const c = JSON.parse(JSON.stringify(cj)) as TemplateCollection;
  c.id = String(row.id);
  c.ownership = 'user';
  c.name = String(row.name ?? c.name);
  c.category = String(row.category ?? c.category);
  c.description = String(row.description ?? c.description ?? '');
  c.brandStyle = String(row.brand_style ?? c.brandStyle);
  c.status = (String(row.status ?? c.status) as TemplateCollection['status']);
  c.version = typeof row.version === 'number' ? row.version : c.version;
  c.ownerUserId = String(row.owner_user_id ?? c.ownerUserId);
  if (typeof row.cover_url === 'string') c.preview = { ...c.preview, coverUrl: row.cover_url };
  return c;
}

function toRow(c: TemplateCollection, companyId: string): Record<string, unknown> {
  return {
    company_id: companyId,
    owner_user_id: c.ownerUserId,
    team_id: c.teamId ?? null,
    name: c.name,
    category: c.category,
    description: c.description,
    brand_style: c.brandStyle,
    status: c.status,
    version: c.version,
    cover_url: c.preview.coverUrl ?? null,
    template_ids: c.templateIds,
    collection_json: c,
    updated_at: nowIso(),
  };
}

/** Build a SYNC resolver over a collection's references (system + user). */
export async function buildResolver(templateIds: string[]): Promise<TemplateResolver> {
  const map = new Map<string, CreatorTemplate>();
  for (const id of templateIds) {
    const sys = getTemplateById(id);
    if (sys) { map.set(id, sys); continue; }
    const usr = await getUserTemplate(id);
    if (usr) map.set(id, usr);
  }
  return (id: string) => map.get(id) ?? getTemplateById(id) ?? null;
}

/** Derive the cover from a member's EXISTING preview (no new render). */
async function refreshCover(c: TemplateCollection): Promise<TemplateCollection> {
  const coverId = c.preview.coverTemplateId ?? c.templateIds[0] ?? null;
  if (!coverId) return { ...c, preview: { coverTemplateId: null, coverUrl: null } };
  const resolve = await buildResolver([coverId]);
  const cover = resolve(coverId);
  return { ...c, preview: { coverTemplateId: coverId, coverUrl: cover?.preview.thumbnailUrl ?? null } };
}

/* ── Reads ───────────────────────────────────────────────────────────── */

export async function listCollections(input: { companyId: string; ownerUserId?: string }): Promise<TemplateCollection[]> {
  try {
    let q = supabase.from(TABLE).select('*').eq('company_id', input.companyId);
    if (input.ownerUserId) q = q.eq('owner_user_id', input.ownerUserId);
    const { data, error } = await q.order('updated_at', { ascending: false });
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(hydrate).filter((c): c is TemplateCollection => c !== null);
  } catch { return []; }
}

export async function getCollection(id: string): Promise<TemplateCollection | null> {
  try {
    const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return hydrate(data as Record<string, unknown>);
  } catch { return null; }
}

/** Resolve a collection + its member templates + validation + blueprint coverage. */
export async function getCollectionDetail(id: string): Promise<{ collection: TemplateCollection; templates: CreatorTemplate[]; validation: CollectionValidation; storyBlueprintCoverage: BlueprintCoverage } | null> {
  const collection = await getCollection(id);
  if (!collection) return null;
  const resolve = await buildResolver(collection.templateIds);
  const templates = collection.templateIds.map(resolve).filter((t): t is CreatorTemplate => t !== null);
  return { collection, templates, validation: validateCollection(collection, resolve), storyBlueprintCoverage: blueprintCoverage(templates) };
}

/* ── Writes (best-effort) ────────────────────────────────────────────── */

async function companyIdFor(id: string): Promise<string | null> {
  try {
    const { data } = await supabase.from(TABLE).select('company_id').eq('id', id).maybeSingle();
    return data ? String((data as Record<string, unknown>).company_id) : null;
  } catch { return null; }
}

/** Resolve a collection's owning company — the API authorization boundary. */
export async function getCollectionCompanyId(id: string): Promise<string | null> {
  return companyIdFor(id);
}

export interface CreateCollectionInput {
  companyId: string;
  ownerUserId: string;
  name?: string;
  description?: string;
  category?: string;
  brandStyle?: string;
  templateIds?: string[];
  teamId?: string | null;
}

export async function createCollectionRecord(input: CreateCollectionInput): Promise<TemplateCollection | null> {
  const now = nowIso();
  try {
    const draft = createCollection({ id: 'pending', ownerUserId: input.ownerUserId, teamId: input.teamId ?? null, name: input.name, description: input.description, category: input.category, brandStyle: input.brandStyle, templateIds: input.templateIds, now });
    const { data, error } = await supabase.from(TABLE).insert(toRow(draft, input.companyId)).select('*').maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    const finalized = await refreshCover({ ...draft, id: String(row.id) });
    await supabase.from(TABLE).update({ collection_json: finalized, cover_url: finalized.preview.coverUrl ?? null }).eq('id', row.id);
    return hydrate({ ...row, collection_json: finalized, cover_url: finalized.preview.coverUrl ?? null });
  } catch { return null; }
}

/** Load → pure mutate → refresh cover → bump version → persist. */
async function applyAndPersist(id: string, mutate: (c: TemplateCollection, now: string) => TemplateCollection): Promise<TemplateCollection | null> {
  const current = await getCollection(id);
  if (!current) return null;
  const companyId = await companyIdFor(id);
  if (!companyId) return null;
  const now = nowIso();
  try {
    const mutated = bumpCollectionVersion(mutate(current, now));
    const finalized = await refreshCover(mutated);
    const { data, error } = await supabase.from(TABLE).update(toRow(finalized, companyId)).eq('id', id).select('*').maybeSingle();
    if (error || !data) return null;
    return hydrate(data as Record<string, unknown>);
  } catch { return null; }
}

export const editCollection = (id: string, edits: CollectionEdits) => applyAndPersist(id, (c, now) => applyCollectionEdits(c, edits, now));
export const addTemplateToCollection = (id: string, templateId: string) => applyAndPersist(id, (c, now) => addTemplate(c, templateId, now));
export const removeTemplateFromCollection = (id: string, templateId: string) => applyAndPersist(id, (c, now) => removeTemplate(c, templateId, now));
export const reorderCollection = (id: string, orderedIds: string[]) => applyAndPersist(id, (c, now) => reorderTemplates(c, orderedIds, now));
/** Replace one member with another in a SINGLE new version (remove + add). */
export const replaceTemplateInCollection = (id: string, oldId: string, newId: string) =>
  applyAndPersist(id, (c, now) => addTemplate(removeTemplate(c, oldId, now), newId, now));

export async function duplicateCollectionRecord(input: { id: string; companyId: string; ownerUserId: string }): Promise<TemplateCollection | null> {
  const source = await getCollection(input.id);
  if (!source) return null;
  const now = nowIso();
  try {
    const draft = duplicateCollection(source, { id: 'pending', ownerUserId: input.ownerUserId, now });
    const { data, error } = await supabase.from(TABLE).insert(toRow(draft, input.companyId)).select('*').maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    const finalized = await refreshCover({ ...draft, id: String(row.id) });
    await supabase.from(TABLE).update({ collection_json: finalized, cover_url: finalized.preview.coverUrl ?? null }).eq('id', row.id);
    return hydrate({ ...row, collection_json: finalized, cover_url: finalized.preview.coverUrl ?? null });
  } catch { return null; }
}

export async function deleteCollection(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    return !error;
  } catch { return false; }
}
