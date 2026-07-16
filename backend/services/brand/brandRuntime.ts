/**
 * Unified Brand Runtime — Phase 1B (runtime foundation).
 *
 * Resolves a tenant's brand into a single `BrandRuntime` from the Phase-1A
 * tables (company_brand_identity + company_brand_identity_pointer) layered over
 * company_profiles and a defaults layer that EXACTLY matches today's hardcoded
 * constants (so a tenant with no brand data resolves byte-identically to current
 * behavior once anything adopts it).
 *
 * SCOPE — this phase builds ONLY the runtime: contract, resolveBrand(),
 * validation, completeness, version-aware cache, draft/published/preview.
 *   - It carries brand DATA only (governance facets are data, no enforcement).
 *   - NOTHING consumes it (no resolver/adapter wiring; no renderer / content /
 *     report / campaign / engagement change). It is dead, importable code until
 *     Phase 1C (adapter) + adoption.
 *
 * Testability: all IO is behind an injectable `BrandDataLoader`, so the pure
 * layering / completeness / validation / cache logic is fully unit-testable
 * without the (not-yet-applied) tables.
 */
import { contrastRatio } from '../creatorBrandKit';
import { runBrandCacheInvalidators } from './brandCacheRegistry';

/* ── Contract ───────────────────────────────────────────────────────── */

export type BrandRuntimeStatus = 'draft' | 'published';

export interface BrandRuntime {
  companyId: string;
  name: string;
  domain?: string;
  industry?: string;
  tagline?: string;
  logo: { primary?: string; mark?: string; light?: string; dark?: string; favicon?: string };
  colors: {
    primary: string;
    accent: string;          // WCAG-validated, derived
    secondary?: string;
    tertiary?: string;
    background: string;
    surface: string;
    text: string;
    mutedText: string;
    palette: string[];
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    headingWeight: number;
    bodyWeight: number;
    pdfFont: string;
  };
  voice: { tone?: string; descriptors?: string[]; ctaStyle?: string };
  vocabulary: { prohibitedPhrases: string[]; requiredTerms: string[] };
  compliance: { regulated: boolean; disclaimers: string[]; prohibitedClaims: string[] };
  designLanguage: { radius?: number; spacingScale?: number; motif?: string };
  meta: {
    version: number;
    status: BrandRuntimeStatus;
    completeness: number;     // 0..1
    source: 'brand_identity' | 'company_profiles' | 'defaults';
    identityHash: string;
    updatedAt: string | null;
    publishedAt: string | null;
    resolvedAt: string;
    warnings: string[];
  };
}

/* ── Defaults layer — MUST equal current constants (parity) ─────────── */

const DEFAULT_PALETTE = ['#111827', '#2563eb', '#14b8a6'];
const DEFAULTS = {
  primary: '#2563eb',
  background: '#0f172a',
  surface: '#ffffff',
  text: '#111827',
  mutedText: '#334155',
  headingFont: 'Arial, Helvetica, sans-serif',
  bodyFont: 'Inter, Arial',
  headingWeight: 900,
  bodyWeight: 600,
  pdfFont: 'Helvetica',
};

/* ── IO seam (injectable) ───────────────────────────────────────────── */

export interface BrandIdentityRow {
  version: number;
  status: BrandRuntimeStatus;
  colors?: Record<string, unknown> | null;
  typography?: Record<string, unknown> | null;
  logo_assets?: Record<string, unknown> | null;
  voice?: Record<string, unknown> | null;
  vocabulary?: Record<string, unknown> | null;
  compliance?: Record<string, unknown> | null;
  design_language?: Record<string, unknown> | null;
  tagline?: string | null;
  identity_hash?: string | null;
  updated_at?: string | null;
  published_at?: string | null;
}
export interface BrandProfileLite {
  name?: string | null;
  domain?: string | null;
  industry?: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  brandVoice?: string | null;
  brandVoiceList?: string[] | null;
  tagline?: string | null;
  regulated?: boolean;
}
export interface BrandDataLoad {
  version: BrandIdentityRow | null;     // the resolved version row (or null → defaults/profile only)
  profile: BrandProfileLite | null;
}
export type BrandDataLoader = (
  companyId: string,
  opts: ResolveBrandOptions,
) => Promise<BrandDataLoad>;

export interface ResolveBrandOptions {
  status?: BrandRuntimeStatus;   // default 'published'
  preview?: boolean;             // true → resolve the draft version
  version?: number;              // version-pin
}

/* ── Pure helpers (exported for tests) ──────────────────────────────── */

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHex(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v.trim());
}

function sanitizeFont(v: unknown, fallback: string): string {
  if (typeof v !== 'string' || !v.trim()) return fallback;
  // Quote-safe for the double-quoted SVG font-family attribute.
  return v.trim().replace(/"/g, "'");
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
}

/** WCAG-aware accent selection (mirrors creatorBrandKit.chooseAccent). */
export function selectAccentColor(palette: string[]): string {
  return (
    palette.find((c) => contrastRatio(c, '#020617') >= 3.2) ||
    palette.find((c) => contrastRatio(c, '#ffffff') >= 3.2) ||
    palette[1] ||
    DEFAULTS.primary
  );
}

function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/**
 * Completeness 0..1. Regulated industries include a compliance weight in the
 * denominator; non-regulated tenants are not penalized for empty compliance.
 */
export function scoreBrandCompleteness(rt: BrandRuntime): number {
  const checks: Array<{ ok: boolean; weight: number }> = [
    { ok: Boolean(rt.logo.primary), weight: 0.20 },
    { ok: rt.colors.palette.join() !== DEFAULT_PALETTE.join(), weight: 0.25 },
    { ok: rt.typography.bodyFont !== DEFAULTS.bodyFont && rt.typography.bodyFont !== DEFAULTS.headingFont, weight: 0.15 },
    { ok: Boolean(rt.voice.tone), weight: 0.20 },
    { ok: Boolean(rt.tagline), weight: 0.05 },
    { ok: Boolean(rt.voice.ctaStyle), weight: 0.05 },
  ];
  if (rt.compliance.regulated) {
    checks.push({ ok: rt.compliance.disclaimers.length > 0, weight: 0.10 });
  }
  const applicable = checks.reduce((s, c) => s + c.weight, 0);
  const achieved = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  const score = applicable > 0 ? achieved / applicable : 0;
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

/* ── Assembly (pure) ────────────────────────────────────────────────── */

/** Layer version-row JSONB > profile > defaults into a BrandRuntime. Never
 *  throws; invalid values are dropped to defaults and recorded as warnings. */
export function assembleBrandRuntime(
  companyId: string,
  load: BrandDataLoad,
  opts: ResolveBrandOptions,
  nowIso: string,
): BrandRuntime {
  const warnings: string[] = [];
  const v = load.version ?? null;
  const p = load.profile ?? null;
  const obj = (x: unknown): Record<string, unknown> =>
    x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};

  const c = obj(v?.colors);
  const t = obj(v?.typography);
  const lg = obj(v?.logo_assets);
  const vc = obj(v?.voice);
  const vocab = obj(v?.vocabulary);
  const comp = obj(v?.compliance);
  const dl = obj(v?.design_language);

  // Palette: brand colors (validated hex) → default.
  const rawPalette = asStringArray(c.palette).filter((x) => {
    const ok = isValidHex(x);
    if (!ok && x) warnings.push(`dropped_invalid_color:${x}`);
    return ok;
  });
  const palette = rawPalette.length > 0 ? rawPalette.slice(0, 5) : [...DEFAULT_PALETTE];

  const pickHex = (val: unknown, fallback: string, label: string): string => {
    if (val == null) return fallback;
    if (isValidHex(val)) return (val as string).trim();
    warnings.push(`dropped_invalid_color:${label}`);
    return fallback;
  };

  const colors: BrandRuntime['colors'] = {
    primary: pickHex(c.primary, palette[1] ?? DEFAULTS.primary, 'primary'),
    accent: selectAccentColor(palette),
    secondary: isValidHex(c.secondary) ? (c.secondary as string) : (palette[2] ?? undefined),
    tertiary: isValidHex(c.tertiary) ? (c.tertiary as string) : (palette[3] ?? undefined),
    background: pickHex(c.background, DEFAULTS.background, 'background'),
    surface: pickHex(c.surface, DEFAULTS.surface, 'surface'),
    text: pickHex(c.text, DEFAULTS.text, 'text'),
    mutedText: pickHex(c.mutedText, DEFAULTS.mutedText, 'mutedText'),
    palette,
  };

  const typography: BrandRuntime['typography'] = {
    headingFont: sanitizeFont(t.headingFont, DEFAULTS.headingFont),
    bodyFont: sanitizeFont(t.bodyFont, DEFAULTS.bodyFont),
    headingWeight: typeof t.headingWeight === 'number' ? t.headingWeight : DEFAULTS.headingWeight,
    bodyWeight: typeof t.bodyWeight === 'number' ? t.bodyWeight : DEFAULTS.bodyWeight,
    pdfFont: sanitizeFont(t.pdfFont, DEFAULTS.pdfFont),
  };

  const validUrl = (u: unknown): string | undefined => {
    if (typeof u !== 'string' || !u.trim()) return undefined;
    if (!/^https?:\/\//i.test(u.trim())) { warnings.push('dropped_invalid_logo_url'); return undefined; }
    return u.trim();
  };
  const logo: BrandRuntime['logo'] = {
    primary: validUrl(lg.primary) ?? validUrl(p?.logoUrl),
    mark: validUrl(lg.mark),
    light: validUrl(lg.light),
    dark: validUrl(lg.dark),
    favicon: validUrl(lg.favicon) ?? validUrl(p?.faviconUrl),
  };

  const descriptors = asStringArray(vc.descriptors).length > 0
    ? asStringArray(vc.descriptors)
    : asStringArray(p?.brandVoiceList);
  const voice: BrandRuntime['voice'] = {
    tone: (typeof vc.tone === 'string' && vc.tone.trim()) ? vc.tone.trim()
      : (p?.brandVoice?.trim() || undefined),
    descriptors: descriptors.length > 0 ? descriptors : undefined,
    ctaStyle: (typeof vc.ctaStyle === 'string' && vc.ctaStyle.trim()) ? vc.ctaStyle.trim() : undefined,
  };

  const prohibitedPhrases = asStringArray(vocab.prohibitedPhrases).map((x) => x.toLowerCase());
  const requiredTerms = asStringArray(vocab.requiredTerms);
  if (prohibitedPhrases.some((x) => requiredTerms.map((r) => r.toLowerCase()).includes(x))) {
    warnings.push('vocabulary_conflict_prohibited_vs_required');
  }

  const compliance: BrandRuntime['compliance'] = {
    regulated: comp.regulated === true || p?.regulated === true,
    disclaimers: asStringArray(comp.disclaimers),
    prohibitedClaims: asStringArray(comp.prohibitedClaims),
  };

  const designLanguage: BrandRuntime['designLanguage'] = {
    radius: typeof dl.radius === 'number' ? dl.radius : undefined,
    spacingScale: typeof dl.spacingScale === 'number' ? dl.spacingScale : undefined,
    motif: typeof dl.motif === 'string' ? dl.motif : undefined,
  };

  const source: BrandRuntime['meta']['source'] = v ? 'brand_identity' : (p ? 'company_profiles' : 'defaults');
  const tagline = (typeof v?.tagline === 'string' && v.tagline.trim())
    ? v.tagline.trim()
    : (p?.tagline?.trim() || undefined);

  const rt: BrandRuntime = {
    companyId,
    name: p?.name?.trim() || 'Brand',
    domain: p?.domain?.trim() || undefined,
    industry: p?.industry?.trim() || undefined,
    tagline,
    logo,
    colors,
    typography,
    voice,
    vocabulary: { prohibitedPhrases, requiredTerms },
    compliance,
    designLanguage,
    meta: {
      version: v?.version ?? 0,
      status: (opts.preview || opts.status === 'draft') ? 'draft' : (v?.status ?? 'published'),
      completeness: 0, // set below
      source,
      identityHash: '',
      updatedAt: v?.updated_at ?? null,
      publishedAt: v?.published_at ?? null,
      resolvedAt: nowIso,
      warnings,
    },
  };
  rt.meta.completeness = scoreBrandCompleteness(rt);
  rt.meta.identityHash = djb2(JSON.stringify({
    colors: rt.colors, typography: rt.typography, logo: rt.logo, tagline: rt.tagline,
    voice: rt.voice, vocabulary: rt.vocabulary, compliance: rt.compliance,
  }));
  return rt;
}

/* ── Version-aware cache (in-process) ───────────────────────────────── */

/** Key by (company, status) for the live published/draft head, or by pinned
 *  version (immutable). All keys share the `brand:rt:${companyId}:` prefix so a
 *  single company can be invalidated wholesale on publish. */
export function brandCacheKey(companyId: string, status: BrandRuntimeStatus, version?: number): string {
  return version != null ? `brand:rt:${companyId}:v:${version}` : `brand:rt:${companyId}:${status}`;
}

const VERSION_TTL_MS = 6 * 60 * 60 * 1000; // pinned version → immutable, long
const PUBLISHED_TTL_MS = 5 * 60 * 1000;    // published head → 5 min (mirrors brandKit)
const DRAFT_TTL_MS = 60 * 1000;            // draft head → short
const cache = new Map<string, { value: BrandRuntime; expiresAt: number }>();

export function resetBrandRuntimeCache(): void {
  cache.clear();
}

/** Drop every cached entry for a company. Call this when a brand is published
 *  or a draft is saved so the next resolve reflects it immediately. */
export function invalidateBrandRuntime(companyId: string): void {
  const prefix = `brand:rt:${companyId}:`;
  for (const k of Array.from(cache.keys())) if (k.startsWith(prefix)) cache.delete(k);
}

/* ── Cross-module cache invalidation (Phase 3C) ──────────────────────────
 * The registry primitive lives in the dependency-free ./brandCacheRegistry
 * module (so caches in other modules can register without an import cycle).
 * Re-exported here for back-compat. `invalidateBrandCaches` (publish/rollback)
 * fans out to the runtime cache PLUS every registered downstream cache, so no
 * layer serves pre-publish brand state in this process. Cross-process caches
 * converge by TTL.
 */
export { registerBrandCacheInvalidator, unregisterBrandCacheInvalidator } from './brandCacheRegistry';

/** Full company-scoped invalidation: runtime cache + every registered
 *  downstream cache. Use on brand publish/rollback. */
export function invalidateBrandCaches(companyId: string): void {
  invalidateBrandRuntime(companyId);
  runBrandCacheInvalidators(companyId);
}

/* ── Resolver ───────────────────────────────────────────────────────── */

export interface ResolveBrandDeps {
  load?: BrandDataLoader;
  now?: () => number;
}

/**
 * Resolve a tenant's brand. Defaults to the PUBLISHED version; `preview`/
 * `status:'draft'` resolves the draft; `version` pins a specific version.
 * Never throws on missing/invalid data — falls back through profile → defaults.
 * UNUSED by any consumer in this phase.
 */
export async function resolveBrand(
  companyId: string,
  options: ResolveBrandOptions = {},
  deps: ResolveBrandDeps = {},
): Promise<BrandRuntime> {
  const load = deps.load ?? defaultLoadBrandData;
  const nowMs = (deps.now ?? Date.now)();
  const isDraft = Boolean(options.preview) || options.status === 'draft';
  const status: BrandRuntimeStatus = isDraft ? 'draft' : 'published';

  // Key is computable WITHOUT loading → a hit skips IO entirely. Draft/preview
  // and published use distinct keys (isolation); a pinned version is immutable.
  const key = brandCacheKey(companyId, status, options.version);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > nowMs) return hit.value;

  const data = await load(companyId, options).catch(() => ({ version: null, profile: null }));
  const rt = assembleBrandRuntime(companyId, data, options, new Date(nowMs).toISOString());
  const ttl = options.version != null ? VERSION_TTL_MS : (isDraft ? DRAFT_TTL_MS : PUBLISHED_TTL_MS);
  cache.set(key, { value: rt, expiresAt: nowMs + ttl });
  return rt;
}

/* ── Default IO loader (production) ─────────────────────────────────────
 * Reads the Phase-1A tables + company_profiles. The brand tables are not yet
 * applied in non-prod, and NOTHING calls resolveBrand yet, so this loader is
 * inert until adoption. Table access is cast-loose because the generated DB
 * types do not yet include the new tables.
 */
export const defaultLoadBrandData: BrandDataLoader = async (companyId, opts) => {
  const { supabase } = await import('../../db/supabaseClient');
  const { getCanonicalProfile: getProfile } = await import('@/backend/services/context/canonicalProfileAdapter');
  // Cast-loose: the Phase-1A tables are not in the generated DB types yet, and
  // this loader is inert (nothing calls resolveBrand) until adoption.
  const db = supabase as unknown as { from: (t: string) => any };

  const profileRaw = await getProfile(companyId).catch(() => null);
  const profile: BrandProfileLite | null = profileRaw
    ? {
        name: profileRaw.name ?? null,
        industry: profileRaw.industry ?? null,
        logoUrl: (profileRaw as { logo_url?: string }).logo_url ?? null,
        faviconUrl: (profileRaw as { favicon_url?: string }).favicon_url ?? null,
        brandVoice: (profileRaw as { brand_voice?: string }).brand_voice ?? null,
        brandVoiceList: (profileRaw as { brand_voice_list?: string[] }).brand_voice_list ?? null,
      }
    : null;

  const pointer = await db.from('company_brand_identity_pointer').select('published_version, draft_version').eq('company_id', companyId).maybeSingle().then((r) => r.data).catch(() => null);
  const targetVersion = opts.version
    ?? (opts.preview || opts.status === 'draft'
      ? (pointer?.draft_version as number | undefined)
      : (pointer?.published_version as number | undefined));

  let version: BrandIdentityRow | null = null;
  if (targetVersion != null) {
    const row = await db.from('company_brand_identity')
      .select('version, status, colors, typography, logo_assets, voice, vocabulary, compliance, design_language, tagline, identity_hash, updated_at, published_at')
      .eq('company_id', companyId).eq('version', targetVersion).maybeSingle().then((r) => r.data).catch(() => null);
    version = (row as unknown as BrandIdentityRow) ?? null;
  }
  return { version, profile };
};
