/**
 * Unified Brand Runtime — Phase 3B (voice-first write path).
 *
 * The smallest production-safe service to create / edit / preview / publish /
 * rollback a tenant's brand-identity record over the Phase-1A tables. VOICE
 * ONLY: only voice.tone, voice.descriptors, and tagline are writable; colors /
 * typography / logo / compliance are out of scope and ignored.
 *
 * All IO is behind an injectable BrandIdentityStore + profile loader + cache
 * invalidator + resolver, so the create/update/publish/rollback transitions are
 * unit-testable without the (not-yet-applied) tables. A supabase-backed store
 * factory is provided for the API handler.
 *
 * Boundary: this persists VOICE into the authoritative row. Messaging
 * (positioning / key_messages / audience) is surfaced as operator prefill
 * context but NOT persisted — it stays owned by CompanyIdentity (compose, not
 * absorb), so there is a single source of truth for messaging.
 */
import { invalidateBrandRuntime, resolveBrand, type BrandRuntime, type BrandIdentityRow } from './brandRuntime';

export class BrandWriteError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'BrandWriteError';
  }
}

export interface BrandPointer { published_version: number | null; draft_version: number | null }

export interface BrandIdentityStore {
  getPointer(companyId: string): Promise<BrandPointer | null>;
  getVersion(companyId: string, version: number): Promise<BrandIdentityRow | null>;
  nextVersion(companyId: string): Promise<number>;
  insertVersion(companyId: string, row: BrandIdentityRow): Promise<void>;
  updateVersionVoice(companyId: string, version: number, patch: { voice: Record<string, unknown>; tagline: string | null }): Promise<void>;
  setPublished(companyId: string, version: number, publishedAtIso: string): Promise<void>;
  /** Merge the provided keys into the pointer (absent keys are untouched). */
  upsertPointer(companyId: string, p: Partial<BrandPointer>): Promise<void>;
}

export interface BrandProfileVoiceSource {
  brandVoice?: string | null;
  brandVoiceList?: string[] | null;
  brandPositioning?: string | null;
  keyMessages?: string | null;
  targetAudience?: string | null;
}

export interface BrandWriteDeps {
  store: BrandIdentityStore;
  loadProfile: (companyId: string) => Promise<BrandProfileVoiceSource | null>;
  invalidate?: (companyId: string) => void;
  resolve?: (companyId: string, opts?: { preview?: boolean }) => Promise<BrandRuntime>;
  nowIso?: () => string;
}

const DESCRIPTOR_CAP = 12;
const sanitizeStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const sanitizeDescriptors = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const arr = v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, DESCRIPTOR_CAP);
  return arr.length ? arr : undefined;
};
const now = (deps: BrandWriteDeps) => (deps.nowIso ?? (() => new Date().toISOString()))();
const invalidate = (deps: BrandWriteDeps, companyId: string) => (deps.invalidate ?? invalidateBrandRuntime)(companyId);

export interface CreateDraftResult {
  draft: BrandIdentityRow;
  created: boolean;
  /** Operator reference — NOT persisted (messaging stays in CompanyIdentity). */
  prefillContext: { brand_positioning: string | null; key_messages: string | null; target_audience: string | null } | null;
}

/** Create a v1 draft (prefilled from company_profiles voice) or return the
 *  existing draft. Prefill preserves voice parity: voice.tone = brand_voice. */
export async function createDraft(companyId: string, deps: BrandWriteDeps): Promise<CreateDraftResult> {
  const pointer = await deps.store.getPointer(companyId);
  if (pointer?.draft_version != null) {
    const existing = await deps.store.getVersion(companyId, pointer.draft_version);
    if (existing) return { draft: existing, created: false, prefillContext: null };
  }
  const profile = await deps.loadProfile(companyId);
  const voice: Record<string, unknown> = {};
  const tone = sanitizeStr(profile?.brandVoice);
  const descriptors = sanitizeDescriptors(profile?.brandVoiceList);
  if (tone) voice.tone = tone;
  if (descriptors) voice.descriptors = descriptors;

  const version = await deps.store.nextVersion(companyId);
  const row: BrandIdentityRow = { version, status: 'draft', voice, tagline: null, updated_at: now(deps) };
  await deps.store.insertVersion(companyId, row);
  await deps.store.upsertPointer(companyId, { draft_version: version });

  return {
    draft: row,
    created: true,
    prefillContext: {
      brand_positioning: profile?.brandPositioning ?? null,
      key_messages: profile?.keyMessages ?? null,
      target_audience: profile?.targetAudience ?? null,
    },
  };
}

/** Update ONLY voice.tone / voice.descriptors / tagline on the active draft.
 *  Visual fields in the patch are ignored. */
export async function updateDraft(
  companyId: string,
  patch: { voice?: { tone?: unknown; descriptors?: unknown }; tagline?: unknown },
  deps: BrandWriteDeps,
): Promise<{ draft: BrandIdentityRow }> {
  const pointer = await deps.store.getPointer(companyId);
  if (pointer?.draft_version == null) throw new BrandWriteError('no_draft');
  const version = pointer.draft_version;
  const current = await deps.store.getVersion(companyId, version);
  if (!current) throw new BrandWriteError('draft_missing');

  const voice: Record<string, unknown> = { ...((current.voice as Record<string, unknown>) ?? {}) };
  if (patch.voice && 'tone' in patch.voice) {
    const tone = sanitizeStr(patch.voice.tone);
    if (tone) voice.tone = tone; else delete voice.tone;
  }
  if (patch.voice && 'descriptors' in patch.voice) {
    const d = sanitizeDescriptors(patch.voice.descriptors);
    if (d) voice.descriptors = d; else delete voice.descriptors;
  }
  const tagline = 'tagline' in patch ? (sanitizeStr(patch.tagline) ?? null) : (current.tagline ?? null);

  await deps.store.updateVersionVoice(companyId, version, { voice, tagline });
  return { draft: { ...current, voice, tagline } };
}

/** Resolve the DRAFT brand (preview) without publishing. */
export async function previewBrand(companyId: string, deps: BrandWriteDeps): Promise<BrandRuntime> {
  const resolve = deps.resolve ?? ((id, opts) => resolveBrand(id, opts));
  invalidate(deps, companyId); // bust stale draft cache so preview reflects latest edits
  return resolve(companyId, { preview: true });
}

/** Publish the active draft: mark published, move the pointer, clear the draft
 *  pointer, invalidate the cache. */
export async function publishDraft(companyId: string, deps: BrandWriteDeps): Promise<{ publishedVersion: number }> {
  const pointer = await deps.store.getPointer(companyId);
  if (pointer?.draft_version == null) throw new BrandWriteError('no_draft');
  const version = pointer.draft_version;
  await deps.store.setPublished(companyId, version, now(deps));
  await deps.store.upsertPointer(companyId, { published_version: version, draft_version: null });
  invalidate(deps, companyId);
  return { publishedVersion: version };
}

/** Roll back to a prior published version — POINTER FLIP ONLY (no row mutation). */
export async function rollbackPublished(companyId: string, version: number, deps: BrandWriteDeps): Promise<{ publishedVersion: number }> {
  const target = await deps.store.getVersion(companyId, version);
  if (!target) throw new BrandWriteError('version_not_found');
  await deps.store.upsertPointer(companyId, { published_version: version });
  invalidate(deps, companyId);
  return { publishedVersion: version };
}

/* ── Supabase-backed store (production IO; cast-loose — the Phase-1A tables are
 *    not in the generated DB types). Inert until the migration is applied and
 *    the API handler calls it. ─────────────────────────────────────────────── */
export function createSupabaseBrandIdentityStore(db: { from: (t: string) => any }): BrandIdentityStore {
  const T = 'company_brand_identity';
  const P = 'company_brand_identity_pointer';
  const COLS = 'version, status, colors, typography, logo_assets, voice, vocabulary, compliance, design_language, tagline, identity_hash, updated_at, published_at';
  return {
    async getPointer(companyId) {
      const { data } = await db.from(P).select('published_version, draft_version').eq('company_id', companyId).maybeSingle();
      return data ? { published_version: data.published_version ?? null, draft_version: data.draft_version ?? null } : null;
    },
    async getVersion(companyId, version) {
      const { data } = await db.from(T).select(COLS).eq('company_id', companyId).eq('version', version).maybeSingle();
      return (data as BrandIdentityRow) ?? null;
    },
    async nextVersion(companyId) {
      const { data } = await db.from(T).select('version').eq('company_id', companyId).order('version', { ascending: false }).limit(1).maybeSingle();
      return (Number(data?.version) || 0) + 1;
    },
    async insertVersion(companyId, row) {
      await db.from(T).insert({ company_id: companyId, ...row });
    },
    async updateVersionVoice(companyId, version, patch) {
      await db.from(T).update({ voice: patch.voice, tagline: patch.tagline, updated_at: new Date().toISOString() }).eq('company_id', companyId).eq('version', version);
    },
    async setPublished(companyId, version, publishedAtIso) {
      await db.from(T).update({ status: 'published', published_at: publishedAtIso, updated_at: publishedAtIso }).eq('company_id', companyId).eq('version', version);
    },
    async upsertPointer(companyId, p) {
      const current = await this.getPointer(companyId);
      const merged = {
        company_id: companyId,
        published_version: 'published_version' in p ? p.published_version ?? null : current?.published_version ?? null,
        draft_version: 'draft_version' in p ? p.draft_version ?? null : current?.draft_version ?? null,
        updated_at: new Date().toISOString(),
      };
      await db.from(P).upsert(merged, { onConflict: 'company_id' });
    },
  };
}
