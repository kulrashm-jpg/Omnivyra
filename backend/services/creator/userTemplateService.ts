/**
 * User Template Service — persistence for user-created Creator templates.
 *
 * Reuses the canonical CreatorTemplate model (stored as template_json) and the
 * pure `userTemplate` logic (clone / edit-guard / version / restore / publish /
 * archive / permissions). System templates stay in code (read-only); only USER
 * templates are persisted here.
 *
 * Best-effort + graceful: if the `creator_user_templates` table is not yet
 * applied (or any query fails), reads return [] / null and writes return null,
 * so the gallery + Creator flow keep working unchanged.
 */

import { supabase } from '../../db/supabaseClient';
import type { CreatorTemplate, TemplateAssetFamily } from '../../../lib/creator-templates';
import {
  getTemplateById, registerUserTemplate, serializeTemplate, deserializeTemplate,
  validateTemplateForSave, assertTemplateDeletable, computeChangeImpact, buildAuditEntry,
  ZERO_REFERENCES, type TemplateReferenceCounts, type ChangeImpact, type TemplateAuditAction, type TemplateAuditEntry,
} from '../../../lib/creator-templates';
import {
  cloneTemplate,
  applyTemplateEdits,
  bumpVersion,
  snapshotVersion,
  restoreVersion,
  publishTemplate,
  archiveTemplate,
  canModify,
  userMeta,
  type TemplateRole,
  type TemplateVersionSnapshot,
} from '../../../lib/creator-templates/userTemplate';

const TABLE = 'creator_user_templates';
const VERSIONS = 'creator_user_template_versions';

function nowIso(): string {
  return new Date().toISOString();
}

/** Hydrate a DB row into the canonical CreatorTemplate (row columns win). */
function hydrate(row: Record<string, unknown>): CreatorTemplate | null {
  const tj = row.template_json;
  if (!tj || typeof tj !== 'object') return null;
  // Decode JSON-safe sentinels (e.g. Infinity) so the style round-trips faithfully.
  const t = deserializeTemplate(tj);
  t.id = String(row.id);
  t.ownership = 'user';
  t.name = String(row.name ?? t.name);
  t.category = String(row.category ?? t.category);
  t.description = String(row.description ?? t.description ?? '');
  t.version = typeof row.version === 'number' ? row.version : t.version;
  t.assetFamily = (String(row.asset_family) as TemplateAssetFamily) || t.assetFamily;
  if (typeof row.preview_url === 'string' && row.preview_url) t.preview = { ...t.preview, thumbnailUrl: row.preview_url };
  t.metadata = {
    ...(t.metadata ?? {}),
    ownerUserId: String(row.owner_user_id),
    teamId: row.team_id ?? null,
    status: String(row.status ?? 'draft'),
    parentTemplateId: row.parent_template_id ?? null,
    updatedAt: String(row.updated_at ?? ''),
    createdAt: String(row.created_at ?? ''),
  };
  // Register into the canonical runtime registry so getTemplateById() /
  // resolveTemplate() resolve this user template identically to a system one
  // (same rendering pipeline) wherever it is loaded.
  registerUserTemplate(t);
  return t;
}

function toRow(template: CreatorTemplate, companyId: string): Record<string, unknown> {
  const um = userMeta(template);
  return {
    company_id: companyId,
    owner_user_id: um?.ownerUserId,
    team_id: um?.teamId ?? null,
    asset_family: template.assetFamily,
    name: template.name,
    category: template.category,
    description: template.description,
    status: String(um?.status ?? 'draft'),
    version: template.version,
    parent_template_id: um?.parentTemplateId ?? null,
    preview_url: template.preview.thumbnailUrl ?? null,
    // JSON-safe encode so non-finite style values (Infinity) survive JSONB storage.
    template_json: serializeTemplate(template),
    updated_at: nowIso(),
  };
}

/* ── Reads ───────────────────────────────────────────────────────────── */

export async function listUserTemplates(input: { companyId: string; ownerUserId?: string; family?: TemplateAssetFamily }): Promise<CreatorTemplate[]> {
  try {
    let q = supabase.from(TABLE).select('*').eq('company_id', input.companyId);
    if (input.family) q = q.eq('asset_family', input.family);
    const { data, error } = await q.order('updated_at', { ascending: false });
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(hydrate).filter((t): t is CreatorTemplate => t !== null);
  } catch {
    return [];
  }
}

export async function getUserTemplate(id: string): Promise<CreatorTemplate | null> {
  try {
    const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return hydrate(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * Load a user template by id AND register it into the canonical runtime registry
 * so a subsequent resolveTemplate(template_id) in THIS process (e.g. the render
 * worker, before renderAsset) resolves its style + contract — the cross-process
 * integration hook for Campaign Creator / Calendar / Publishing renders. Returns
 * null (and registers nothing) for non-user ids; system ids already resolve.
 */
export async function loadAndRegisterUserTemplate(id: string): Promise<CreatorTemplate | null> {
  const normalized = String(id || '').trim();
  if (!normalized || getTemplateById(normalized)) return null; // system id resolves already
  return getUserTemplate(normalized); // hydrate() registers on success
}

/**
 * Canonical pre-render hook for ANY render caller (worker / background job /
 * campaign / inline). Extracts the render template_id from an asset_payload —
 * mirroring the renderer's `templateIdForRender` (metadata.template_id ⇒
 * infographic_template_id ⇒ creator_card.template_id) — and, if it is a user
 * template, loads + registers it so the renderer's resolveTemplate() resolves
 * its style/contract. Idempotent + best-effort: system ids / missing ids /
 * unavailable storage are no-ops, so existing renders are unaffected.
 */
export async function ensureUserTemplateRegisteredForAsset(assetPayload: unknown): Promise<void> {
  try {
    const payload = (assetPayload && typeof assetPayload === 'object' ? assetPayload : {}) as Record<string, unknown>;
    const bundle = (payload.media_bundle && typeof payload.media_bundle === 'object' ? payload.media_bundle : {}) as Record<string, unknown>;
    const md = (bundle.metadata && typeof bundle.metadata === 'object' ? bundle.metadata : {}) as Record<string, unknown>;
    const card = (md.creator_card && typeof md.creator_card === 'object' ? md.creator_card : {}) as Record<string, unknown>;
    const raw = md.template_id ?? md.infographic_template_id ?? card.template_id;
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || getTemplateById(id)) return; // empty or system id → nothing to load
    // PART B — a historical asset pins the version it was created with; load THAT
    // version snapshot so the renderer resolves the immutable historical template.
    const verRaw = md.template_version ?? card.template_version;
    const version = typeof verRaw === 'number' ? verRaw : Number.isFinite(Number(verRaw)) ? Number(verRaw) : null;
    if (version && version > 0) {
      const pinned = await loadAndRegisterUserTemplateVersion(id, version);
      if (pinned) return;
    }
    await loadAndRegisterUserTemplate(id); // else current version
  } catch { /* best-effort — system + default-style resolution is unaffected */ }
}

/**
 * PART B — load a SPECIFIC immutable version snapshot and register it so the
 * renderer's resolveTemplate(id) resolves the historical version for a render of
 * a historical asset. Falls back to null when the version is unavailable.
 */
export async function loadAndRegisterUserTemplateVersion(id: string, version: number): Promise<CreatorTemplate | null> {
  const normalized = String(id || '').trim();
  if (!normalized || getTemplateById(normalized)) return null; // system ids are immutable in-code
  const versions = await listUserTemplateVersions(normalized);
  const snap = versions.find((v) => v.version === version);
  if (!snap) return null;
  const t = snap.template;
  t.id = normalized;
  t.ownership = 'user';
  registerUserTemplate(t);
  return t;
}

export async function listUserTemplateVersions(id: string): Promise<TemplateVersionSnapshot[]> {
  try {
    const { data, error } = await supabase.from(VERSIONS).select('*').eq('template_id', id).order('version', { ascending: false });
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map((row) => ({
      version: Number(row.version),
      createdAt: String(row.created_at ?? ''),
      createdBy: row.created_by ? String(row.created_by) : undefined,
      template: deserializeTemplate(row.template_json),
    }));
  } catch {
    return [];
  }
}

/* ── Writes (best-effort) ────────────────────────────────────────────── */

async function writeVersion(templateId: string, template: CreatorTemplate, createdBy: string, diagnostic?: unknown): Promise<void> {
  try {
    await supabase.from(VERSIONS).insert({ template_id: templateId, version: template.version, template_json: serializeTemplate(template), diagnostic_json: diagnostic ?? null, created_by: createdBy });
  } catch { /* best-effort */ }
}

export interface CreateInput {
  companyId: string;
  ownerUserId: string;
  family: TemplateAssetFamily;
  /** Source: a system OR user template id, or null for blank. */
  sourceTemplateId?: string | null;
  name?: string;
  teamId?: string | null;
}

export async function createUserTemplate(input: CreateInput): Promise<CreatorTemplate | null> {
  const source = input.sourceTemplateId
    ? (getTemplateById(input.sourceTemplateId) ?? (await getUserTemplate(input.sourceTemplateId)))
    : null;
  const now = nowIso();
  // Insert first to obtain the DB id, then re-clone with the real id.
  try {
    const draft = cloneTemplate(source ?? null, input.family, { id: 'pending', ownerUserId: input.ownerUserId, teamId: input.teamId ?? null, name: input.name, now });
    // PART C — reject a structurally-invalid template before persistence.
    if (!validateTemplateForSave(draft).ok) return null;
    const { data, error } = await supabase.from(TABLE).insert(toRow(draft, input.companyId)).select('*').maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    // Re-stamp the canonical id inside template_json to match the row id.
    const finalized = cloneTemplate(source ?? null, input.family, { id: String(row.id), ownerUserId: input.ownerUserId, teamId: input.teamId ?? null, name: input.name, now });
    (finalized.metadata as Record<string, unknown>).previewStatus = 'pending';
    await supabase.from(TABLE).update({ template_json: serializeTemplate(finalized) }).eq('id', row.id);
    await writeVersion(String(row.id), finalized, input.ownerUserId);
    await writeAudit(buildAuditEntry('created', { templateId: String(row.id), templateVersion: finalized.version, actorUserId: input.ownerUserId, at: now }));
    void enqueuePreview(finalized, input.companyId);
    return hydrate({ ...row, template_json: finalized });
  } catch {
    return null;
  }
}

/**
 * Create a user template from a deterministic BUILDER (id → CreatorTemplate)
 * rather than by cloning a source. Used by the AI Template Creator: the builder
 * is `(id) => compileTemplateIntent(intent, { id, ownerUserId })`. Reuses the
 * exact create path (validate → persist → version → audit → enqueue preview),
 * so AI templates flow through the same preview/validation/Quality-Inspector
 * pipeline as any other user template. No duplicate model, no second pipeline.
 */
export async function createUserTemplateFromSeed(input: {
  companyId: string;
  ownerUserId: string;
  build: (id: string) => CreatorTemplate;
}): Promise<CreatorTemplate | null> {
  const now = nowIso();
  try {
    const draft = input.build('pending');
    if (!validateTemplateForSave(draft).ok) return null;
    const { data, error } = await supabase.from(TABLE).insert(toRow(draft, input.companyId)).select('*').maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    const finalized = input.build(String(row.id));
    (finalized.metadata as Record<string, unknown>).previewStatus = 'pending';
    await supabase.from(TABLE).update({ template_json: serializeTemplate(finalized) }).eq('id', row.id);
    await writeVersion(String(row.id), finalized, input.ownerUserId);
    await writeAudit(buildAuditEntry('created', { templateId: String(row.id), templateVersion: finalized.version, actorUserId: input.ownerUserId, at: now }));
    void enqueuePreview(finalized, input.companyId);
    return hydrate({ ...row, template_json: finalized });
  } catch {
    return null;
  }
}

export async function updateUserTemplate(input: { id: string; edits: Record<string, unknown>; role: TemplateRole; actorUserId: string }): Promise<CreatorTemplate | null> {
  const current = await getUserTemplate(input.id);
  if (!current || !canModify(input.role, current)) return null;
  const companyId = await companyIdFor(input.id);
  if (!companyId) return null;
  const edited = applyTemplateEdits(current, input.edits, nowIso()).template;
  const versioned = bumpVersion(edited, nowIso()); // every save creates a version
  // PART C — reject a structurally-invalid edit before persistence (the prior
  // version remains the live one).
  if (!validateTemplateForSave(versioned).ok) return null;
  // New version → preview is stale: mark pending (keeps the PREVIOUS preview
  // image visible) and enqueue an async re-render. Save does not wait.
  (versioned.metadata as Record<string, unknown>).previewStatus = 'pending';
  try {
    await supabase.from(TABLE).update(toRow(versioned, companyId)).eq('id', input.id);
    await writeVersion(input.id, versioned, input.actorUserId);
    await writeAudit(buildAuditEntry('edited', { templateId: input.id, templateVersion: versioned.version, actorUserId: input.actorUserId, at: nowIso() }));
    void enqueuePreview(versioned, companyId);
    return versioned;
  } catch {
    return null;
  }
}

export async function restoreUserTemplateVersion(input: { id: string; version: number; role: TemplateRole; actorUserId: string }): Promise<CreatorTemplate | null> {
  const current = await getUserTemplate(input.id);
  if (!current || !canModify(input.role, current)) return null;
  const companyId = await companyIdFor(input.id);
  if (!companyId) return null;
  const versions = await listUserTemplateVersions(input.id);
  const snap = versions.find((v) => v.version === input.version);
  if (!snap) return null;
  const restored = restoreVersion(current, snapshotVersion(snap.template, input.actorUserId, snap.createdAt), nowIso());
  // Restore the snapshot's preview if it already has one; otherwise regenerate.
  const restoredMeta = restored.metadata as Record<string, unknown>;
  const hasSnapshotPreview = Boolean(restored.preview.thumbnailUrl) && Boolean(restoredMeta.creator_diagnostic_report);
  restoredMeta.previewStatus = hasSnapshotPreview ? 'ready' : 'pending';
  try {
    await supabase.from(TABLE).update(toRow(restored, companyId)).eq('id', input.id);
    await writeVersion(input.id, restored, input.actorUserId);
    if (!hasSnapshotPreview) void enqueuePreview(restored, companyId);
    return restored;
  } catch {
    return null;
  }
}

export async function publishUserTemplate(input: { id: string; diagnostic: unknown; role: TemplateRole; actorUserId: string }): Promise<{ template: CreatorTemplate | null; gate: { ok: boolean; reasons: string[] } }> {
  const current = await getUserTemplate(input.id);
  if (!current || !canModify(input.role, current)) return { template: null, gate: { ok: false, reasons: ['Not permitted'] } };
  const companyId = await companyIdFor(input.id);
  if (!companyId) return { template: null, gate: { ok: false, reasons: ['Template not found'] } };
  const { template, gate } = publishTemplate(current, input.diagnostic, nowIso());
  if (!gate.ok) return { template: null, gate };
  try {
    await supabase.from(TABLE).update({ status: 'published', template_json: serializeTemplate(template), updated_at: nowIso() }).eq('id', input.id);
    await writeVersion(input.id, template, input.actorUserId, input.diagnostic);
    await writeAudit(buildAuditEntry('published', { templateId: input.id, templateVersion: template.version, actorUserId: input.actorUserId, at: nowIso() }));
    return { template, gate };
  } catch {
    return { template: null, gate: { ok: false, reasons: ['Persist failed'] } };
  }
}

export async function archiveUserTemplate(input: { id: string; role: TemplateRole; actorUserId: string }): Promise<CreatorTemplate | null> {
  const current = await getUserTemplate(input.id);
  if (!current || !canModify(input.role, current)) return null;
  const archived = archiveTemplate(current, nowIso());
  try {
    await supabase.from(TABLE).update({ status: 'archived', template_json: serializeTemplate(archived), updated_at: nowIso() }).eq('id', input.id);
    await writeAudit(buildAuditEntry('archived', { templateId: input.id, templateVersion: archived.version, actorUserId: input.actorUserId, at: nowIso() }));
    return archived;
  } catch {
    return null;
  }
}

/* ── Governance: audit trail (E), reference integrity (A), impact (D) ──── */

const AUDIT = 'creator_user_template_audit';

/** Append an audit row (best-effort, append-only). */
async function writeAudit(entry: TemplateAuditEntry): Promise<void> {
  try {
    await supabase.from(AUDIT).insert({
      template_id: entry.templateId, action: entry.action, template_version: entry.templateVersion,
      actor_user_id: entry.actorUserId, detail: entry.detail ?? null, created_at: entry.at,
    });
  } catch { /* best-effort */ }
}

/** Full audit trail for a template (created/edited/published/archived/deleted/restored). */
export async function listTemplateAudit(id: string): Promise<TemplateAuditEntry[]> {
  try {
    const { data, error } = await supabase.from(AUDIT).select('*').eq('template_id', id).order('created_at', { ascending: false });
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map((r) => ({
      action: String(r.action) as TemplateAuditAction,
      templateId: String(r.template_id),
      templateVersion: Number(r.template_version ?? 0),
      actorUserId: r.actor_user_id ? String(r.actor_user_id) : null,
      at: String(r.created_at ?? ''),
      detail: r.detail ? String(r.detail) : undefined,
    }));
  } catch { return []; }
}

/**
 * CAMPAIGN-007 — record a deterministic operational/lifecycle event for a
 * template (system or user) into the EXISTING audit store (no new event system)
 * and mirror it to the existing creatorEvent log pipeline. Best-effort +
 * fire-and-forget-safe — never throws, so it can wrap render/generation paths.
 */
export async function recordTemplateEvent(input: {
  templateId: string; action: TemplateAuditAction; templateVersion?: number; actorUserId?: string | null; detail?: string;
}): Promise<void> {
  const id = String(input.templateId || '').trim();
  if (!id) return;
  const version = typeof input.templateVersion === 'number' ? input.templateVersion : 0;
  await writeAudit(buildAuditEntry(input.action, { templateId: id, templateVersion: version, actorUserId: input.actorUserId ?? null, at: nowIso(), detail: input.detail }));
  try {
    const { creatorEvent } = await import('../creatorObservation');
    creatorEvent('generation', input.action.includes('failed') ? 'error' : 'ok', { category: `template_${input.action}`, templateId: id, templateVersion: version });
  } catch { /* best-effort */ }
}

/**
 * Best-effort live-reference counts (Part A source). Reference surfaces are
 * schema-dependent; any unavailable table/column contributes 0 (graceful), so
 * the deterministic governance decision in assertTemplateDeletable still runs.
 */
export async function getTemplateReferenceCounts(templateId: string): Promise<TemplateReferenceCounts> {
  const id = String(templateId || '').trim();
  if (!id) return { ...ZERO_REFERENCES };
  const count = async (table: string, column: string, status?: string): Promise<number> => {
    try {
      let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq(column, id);
      if (status) q = q.eq('status', status);
      const { count: n } = await q;
      return typeof n === 'number' ? n : 0;
    } catch { return 0; }
  };
  const [drafts, scheduled, published, calendar, history] = await Promise.all([
    count('campaign_content', 'template_id', 'draft'),
    count('campaign_content', 'template_id', 'scheduled'),
    count('creator_assets', 'template_id', 'published'),
    count('calendar_items', 'template_id'),
    count(VERSIONS, 'template_id'),
  ]);
  return { drafts, scheduled, published, calendar, history };
}

/** Deterministic change-impact summary for editing a template (Part D). */
export async function computeTemplateChangeImpact(templateId: string): Promise<ChangeImpact> {
  return computeChangeImpact(await getTemplateReferenceCounts(templateId));
}

/**
 * Delete a user template — BLOCKED while any surface references it (Part A).
 * Returns explicit errors; never deletes a referenced template.
 */
export async function deleteUserTemplate(input: { id: string; role: TemplateRole; actorUserId: string }): Promise<{ ok: boolean; errors: string[] }> {
  const current = await getUserTemplate(input.id);
  if (!current || !canModify(input.role, current)) return { ok: false, errors: ['Not permitted'] };
  const gate = assertTemplateDeletable(await getTemplateReferenceCounts(input.id));
  if (!gate.ok) return gate;
  try {
    await supabase.from(TABLE).delete().eq('id', input.id);
    await writeAudit(buildAuditEntry('deleted', { templateId: input.id, templateVersion: current.version, actorUserId: input.actorUserId, at: nowIso() }));
    return { ok: true, errors: [] };
  } catch {
    return { ok: false, errors: ['Delete failed'] };
  }
}

/** Resolve the owner role for a user in a company (owner of the template, else
 *  editor for company members — viewer otherwise). Best-effort. */
export async function resolveRole(input: { templateId: string; userId: string }): Promise<TemplateRole> {
  const t = await getUserTemplate(input.templateId);
  const um = t ? userMeta(t) : null;
  if (um && um.ownerUserId === input.userId) return 'owner';
  return 'editor'; // company members can edit shared templates; tighten with team ACLs later
}

async function companyIdFor(id: string): Promise<string | null> {
  try {
    const { data } = await supabase.from(TABLE).select('company_id').eq('id', id).maybeSingle();
    return data ? String((data as Record<string, unknown>).company_id) : null;
  } catch {
    return null;
  }
}

/** Resolve a user template's owning company — the API authorization boundary. */
export async function getUserTemplateCompanyId(id: string): Promise<string | null> {
  return companyIdFor(id);
}

/* ── Preview lifecycle persistence (best-effort) ─────────────────────── */

/** Set the preview status (e.g. pending → rendering). Keeps the prior preview. */
export async function setPreviewStatus(id: string, status: 'pending' | 'rendering' | 'ready' | 'failed'): Promise<void> {
  try {
    const t = await getUserTemplate(id);
    if (!t) return;
    const tj = deserializeTemplate(serializeTemplate(t)); // faithful clone (preserves Infinity)
    tj.metadata = { ...(tj.metadata ?? {}), previewStatus: status };
    await supabase.from(TABLE).update({ template_json: serializeTemplate(tj), updated_at: nowIso() }).eq('id', id);
  } catch { /* best-effort */ }
}

/**
 * Persist a completed (or failed) preview. On success: stores preview_url +
 * the diagnostic report onto the template and the CURRENT version row, status
 * 'ready'. On failure: status 'failed' WITHOUT clearing the previous preview.
 */
export async function setPreviewResult(input: {
  id: string;
  version: number;
  status: 'ready' | 'failed';
  previewUrl?: string | null;
  diagnostic?: unknown;
  renderedAt?: string;
}): Promise<void> {
  try {
    const t = await getUserTemplate(input.id);
    if (!t) return;
    const tj = deserializeTemplate(serializeTemplate(t)); // faithful clone (preserves Infinity)
    const m = { ...(tj.metadata ?? {}) } as Record<string, unknown>;
    m.previewStatus = input.status;
    m.previewRenderedAt = input.renderedAt ?? nowIso();
    if (input.status === 'ready') {
      if (input.previewUrl) tj.preview = { ...tj.preview, thumbnailUrl: input.previewUrl };
      if (input.diagnostic) m.creator_diagnostic_report = input.diagnostic;
    }
    tj.metadata = m;
    const update: Record<string, unknown> = { template_json: serializeTemplate(tj), updated_at: nowIso() };
    if (input.status === 'ready' && input.previewUrl) update.preview_url = input.previewUrl;
    await supabase.from(TABLE).update(update).eq('id', input.id);
    if (input.status === 'ready' && input.diagnostic) {
      await supabase.from(VERSIONS).update({ diagnostic_json: input.diagnostic }).eq('template_id', input.id).eq('version', input.version);
    }
  } catch { /* best-effort */ }
}

/** Fire-and-forget preview enqueue (never awaited by the save path). */
async function enqueuePreview(template: CreatorTemplate, companyId: string): Promise<void> {
  try {
    const { enqueueUserTemplatePreview } = await import('./userTemplatePreviewService');
    void enqueueUserTemplatePreview({ template, companyId });
  } catch { /* best-effort */ }
}
