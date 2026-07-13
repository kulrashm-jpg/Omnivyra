/**
 * companyBootstrapService.ts — ONBOARD-004: canonical company profile bootstrap.
 *
 * ONE reusable, deterministic, idempotent authority that pre-fills a newly
 * created company's profile from data the platform ALREADY has — the
 * verified website/domain and the crawl metadata the onboarding crawl already
 * discovered and stored in `report_settings.discovered_metadata`. The goal
 * (ONBOARD-004): a user never starts from an empty company — everything
 * derivable already exists, immediately after company creation.
 *
 * What this service is:
 *   - `deriveBootstrapFields`   — PURE. No AI, no network, no DB. Given the
 *                                 discovered metadata + the current profile,
 *                                 returns the fill-empty column candidates,
 *                                 the discovered-metadata bundle, provenance,
 *                                 and the field classification (§4).
 *   - `bootstrapCompanyProfile` — idempotent apply. Reads the existing profile
 *                                 + discovered metadata, MERGE-writes ONLY still
 *                                 empty canonical columns (never overwrites a
 *                                 user/AI value), ensures the discovered bundle
 *                                 exists, stamps an idempotency marker, and
 *                                 records the completeness read from the CANONICAL
 *                                 profile-completeness authority (§7).
 *   - `classifyProfileFields`   — §4 read-model: Auto-filled / User-required /
 *                                 Optional buckets for the Company Profile UI.
 *
 * What this service is NOT (scope guard, ONBOARD-004): it never creates a
 * company, never introduces a new domain model, never re-crawls, never calls
 * AI, and never touches `field_confidence` (owned by the AI refiner). It only
 * consolidates the deterministic, already-available derivation into one
 * idempotent unit and persists through the EXISTING `company_profiles`
 * authority.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DiscoveredWebsiteMetadata } from './companyProfile/websiteMetadataExtractor';
import {
  buildDiscoveredProvenance,
  type FieldProvenance,
} from './companyProfile/enrichmentProvenance';
import {
  isComplete as profileIsComplete,
  profileGaps,
  type ProfileCompany,
} from './profileCompletionIntelligenceService';

/** Current bootstrap contract version — bumped only on a shape change. */
export const COMPANY_BOOTSTRAP_VERSION = 1;

/** Canonical columns that carry a discovered/derivable value (fill-empty). */
const AUTOFILLABLE_COLUMNS = [
  'website_url',
  'geography',
  'logo_url',
  'favicon_url',
  'linkedin_url',
  'facebook_url',
  'instagram_url',
  'x_url',
  'youtube_url',
  'tiktok_url',
  'reddit_url',
  'pinterest_url',
  'whatsapp_url',
] as const;

/** Critical columns (mirror the canonical `isComplete` authority: name/website/industry). */
const CRITICAL_COLUMNS = ['name', 'website_url', 'industry'] as const;

/** Non-critical columns a user may optionally complete later. */
const OPTIONAL_COLUMNS = [
  'geography',
  'logo_url',
  'favicon_url',
  'linkedin_url',
  'facebook_url',
  'instagram_url',
  'x_url',
  'youtube_url',
  'tiktok_url',
  'reddit_url',
  'pinterest_url',
  'whatsapp_url',
  'brand_voice',
  'unique_value',
  'target_audience',
  'products_services',
  'content_themes',
  'competitors',
] as const;

/** The discovered-metadata bundle stored under `report_settings.discovered_metadata`. */
export interface DiscoveredMetadataBundle {
  source: string;
  discovered_at: string;
  discovered_fields: string[];
  provenance: Record<string, FieldProvenance>;
  title: string | null;
  description: string | null;
  site_name: string | null;
  language: string | null;
  country: string | null;
  brand_color: string | null;
  seo_keywords: string[];
  open_graph: Record<string, string>;
  logo_url: string | null;
  favicon_url: string | null;
}

/** §4 read-model: how each field should be presented in the Company Profile UI. */
export interface ProfileFieldClassification {
  /** Filled automatically from the crawl (system-discovered) and present. */
  autoFilled: string[];
  /** Critical fields still empty — the user must provide these. */
  userRequired: string[];
  /** Non-critical fields still empty — nice to have. */
  optional: string[];
}

/** The subset of the profile row the bootstrap reads/derives against. */
export interface ExistingProfileSnapshot {
  [column: string]: unknown;
  report_settings?: Record<string, unknown> | null;
  user_locked_fields?: string[] | null;
}

export interface DeriveBootstrapInput {
  /** In-hand discovered metadata (setup-company path), if available. */
  discovered?: DiscoveredWebsiteMetadata | null;
  /** Already-stored discovered bundle (replay/backfill path), if present. */
  discoveredBundle?: DiscoveredMetadataBundle | null;
  /** Current profile column values (what is already set). */
  existingProfile: ExistingProfileSnapshot;
  /** The verified canonical website (§3 — reuse, no new domain model). */
  verifiedWebsite?: string | null;
  /** ISO timestamp, injected for determinism. */
  now: string;
}

export interface BootstrapDerivation {
  /** Fill-empty column values to apply (only for columns currently empty). */
  columnUpdates: Record<string, unknown>;
  /** The discovered-metadata bundle to ensure present (null when nothing discovered). */
  discoveredBundle: DiscoveredMetadataBundle | null;
  /** Per-field provenance for the discovered values. */
  provenance: Record<string, FieldProvenance>;
  /** Names of the system-discovered fields (mirrors setup-company's list). */
  systemDiscoveredFields: string[];
  /** §4 classification computed against the profile AFTER the fill-empty updates. */
  classification: ProfileFieldClassification;
}

const isEmpty = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

/** Build the discovered bundle from freshly extracted metadata (setup-company shape parity). */
export function buildDiscoveredBundle(
  meta: DiscoveredWebsiteMetadata,
  now: string,
): DiscoveredMetadataBundle {
  const discovered_fields: string[] = [];
  if (meta.faviconUrl) discovered_fields.push('favicon_url');
  if (meta.logoUrl) discovered_fields.push('logo_url');
  if (meta.country) discovered_fields.push('geography');
  if (meta.description) discovered_fields.push('description');
  if (meta.language) discovered_fields.push('language');
  if (meta.brandColor) discovered_fields.push('brand_color');
  return {
    source: 'system_discovered',
    discovered_at: now,
    discovered_fields,
    provenance: buildDiscoveredProvenance(meta, now),
    title: meta.title,
    description: meta.description,
    site_name: meta.siteName,
    language: meta.language,
    country: meta.country,
    brand_color: meta.brandColor,
    seo_keywords: meta.keywords,
    open_graph: meta.openGraph,
    logo_url: meta.logoUrl,
    favicon_url: meta.faviconUrl,
  };
}

/**
 * PURE derivation. No AI, no IO. Returns the fill-empty column candidates, the
 * discovered bundle, provenance, and the §4 classification. Nothing here
 * overwrites a value that is already present (fill-empty), and user-locked
 * fields are never proposed for update.
 */
export function deriveBootstrapFields(input: DeriveBootstrapInput): BootstrapDerivation {
  const { discovered, existingProfile, verifiedWebsite, now } = input;
  const locked = new Set(
    Array.isArray(existingProfile.user_locked_fields) ? existingProfile.user_locked_fields : [],
  );

  const bundle: DiscoveredMetadataBundle | null =
    input.discoveredBundle ?? (discovered ? buildDiscoveredBundle(discovered, now) : null);

  // Fill-empty candidates for the canonical columns backed by discovered data.
  // website_url comes ONLY from the verified website/domain (§3) — never
  // inferred from crawl HTML, so we never fabricate a primary domain.
  const candidates: Record<string, unknown> = {
    website_url: verifiedWebsite ?? null,
    geography: bundle?.country ?? null,
    logo_url: bundle?.logo_url ?? null,
    favicon_url: bundle?.favicon_url ?? null,
  };

  const columnUpdates: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(candidates)) {
    if (isEmpty(value)) continue; // nothing derivable → leave empty (§2)
    if (locked.has(col)) continue; // never touch a user-locked field
    if (!isEmpty(existingProfile[col])) continue; // fill-empty only (idempotent, no overwrite)
    columnUpdates[col] = value;
  }

  // The profile as it will look AFTER the fill-empty updates (for classification).
  const effective: ExistingProfileSnapshot = { ...existingProfile, ...columnUpdates };
  const classification = classifyProfileFields(effective, bundle);

  return {
    columnUpdates,
    discoveredBundle: bundle,
    provenance: bundle?.provenance ?? {},
    systemDiscoveredFields: bundle?.discovered_fields ?? [],
    classification,
  };
}

/**
 * §4 read-model. Buckets fields into Auto-filled / User-required / Optional so
 * the Company Profile UI can highlight what came from the crawl and what the
 * user still needs to supply. Auto-filled = a present column value whose origin
 * is system-discovered (present in the discovered bundle / provenance). Pure.
 */
export function classifyProfileFields(
  profile: ExistingProfileSnapshot,
  bundle?: DiscoveredMetadataBundle | null,
): ProfileFieldClassification {
  // A present derivable column reads as auto-filled: it was set by the
  // deterministic crawl path. The bundle's provenance / discovered_fields
  // corroborate origin when present, but presence in an autofillable column is
  // sufficient to surface it as "Auto-filled" in the profile UI.
  void bundle;
  const autoFilled: string[] = AUTOFILLABLE_COLUMNS.filter((col) => !isEmpty(profile[col]));

  const userRequired = CRITICAL_COLUMNS.filter((c) => isEmpty(profile[c]));
  const optional = OPTIONAL_COLUMNS.filter(
    (c) => isEmpty(profile[c]) && !autoFilled.includes(c),
  );

  return { autoFilled, userRequired, optional };
}

/**
 * Reuse the CANONICAL profile-completeness authority (§7 — no duplicate
 * calculation). Maps the raw profile row into `ProfileCompany` and returns the
 * canonical gaps + complete flag from `profileCompletionIntelligenceService`.
 */
export function bootstrapCompleteness(
  companyId: string,
  companyName: string,
  profile: ExistingProfileSnapshot,
  opts?: { domainVerified?: boolean; identityVerified?: boolean; createdAt?: string | null },
): { isComplete: boolean; gaps: string[] } {
  const confidence = Number(profile.overall_confidence ?? profile.confidence_score ?? 0) || 0;
  const c: ProfileCompany = {
    company_id: companyId,
    company_name: companyName,
    created_at: opts?.createdAt ?? null,
    is_active: true,
    profile_exists: true,
    has_name: !isEmpty(profile.name),
    has_website: !isEmpty(profile.website_url),
    has_industry: !isEmpty(profile.industry),
    confidence,
    domain_verified: opts?.domainVerified ?? true,
    identity_verified: opts?.identityVerified ?? true,
  };
  return { isComplete: profileIsComplete(c), gaps: profileGaps(c) };
}

/** The idempotency marker stored at `report_settings.bootstrap`. */
export interface BootstrapMarker {
  version: number;
  bootstrapped_at: string;
  source: 'company_bootstrap_service';
  applied_fields: string[];
  classification: ProfileFieldClassification;
  completeness: { isComplete: boolean; gaps: string[] };
}

export interface BootstrapDeps {
  supabase?: SupabaseClient;
  /** Freshly extracted metadata (setup-company path) — avoids re-reading. */
  discovered?: DiscoveredWebsiteMetadata | null;
  /** The verified canonical website (§3). */
  verifiedWebsite?: string | null;
  now?: string;
}

export interface BootstrapResult {
  ok: boolean;
  applied: boolean;
  reason:
    | 'bootstrapped'
    | 'already_bootstrapped'
    | 'no_profile'
    | 'no_write_needed'
    | 'error';
  appliedFields: string[];
  classification: ProfileFieldClassification | null;
  completeness: { isComplete: boolean; gaps: string[] } | null;
}

const EMPTY_CLASSIFICATION: ProfileFieldClassification = {
  autoFilled: [],
  userRequired: [],
  optional: [],
};

/**
 * Idempotently bootstrap a company's profile. Safe to call from company
 * creation, a verification replay, a resume, or a backfill: it reads the
 * current profile, fills ONLY still-empty canonical columns, ensures the
 * discovered-metadata bundle exists, stamps the idempotency marker, and never
 * overwrites a user/AI value. Best-effort by contract — callers should not let
 * a failure here block onboarding.
 */
export async function bootstrapCompanyProfile(
  companyId: string,
  deps: BootstrapDeps = {},
): Promise<BootstrapResult> {
  const now = deps.now ?? new Date().toISOString();
  let supabase = deps.supabase;
  if (!supabase) {
    supabase = (await import('../db/supabaseClient')).supabase;
  }

  try {
    const { data: profile, error } = await supabase
      .from('company_profiles')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      return { ok: false, applied: false, reason: 'error', appliedFields: [], classification: null, completeness: null };
    }
    if (!profile) {
      // Company bootstrap fills an EXISTING profile — it never creates a company
      // or a profile row (§1/§9). Nothing to do.
      return { ok: true, applied: false, reason: 'no_profile', appliedFields: [], classification: null, completeness: null };
    }

    const existing = profile as ExistingProfileSnapshot;
    const reportSettings = (existing.report_settings ?? {}) as Record<string, unknown>;
    const priorMarker = reportSettings.bootstrap as BootstrapMarker | undefined;
    const existingBundle = (reportSettings.discovered_metadata ?? null) as DiscoveredMetadataBundle | null;

    const derivation = deriveBootstrapFields({
      discovered: deps.discovered ?? null,
      discoveredBundle: existingBundle,
      existingProfile: existing,
      verifiedWebsite: deps.verifiedWebsite ?? (existing.website_url as string | null) ?? null,
      now,
    });

    const completeness = bootstrapCompleteness(
      companyId,
      String(existing.name ?? ''),
      { ...existing, ...derivation.columnUpdates },
      { createdAt: (existing.created_at as string | null) ?? null },
    );

    const hasColumnUpdates = Object.keys(derivation.columnUpdates).length > 0;
    const needsBundle = !existingBundle && derivation.discoveredBundle !== null;
    const alreadyMarked = priorMarker?.version === COMPANY_BOOTSTRAP_VERSION;

    // True idempotent fast path: previously bootstrapped at this version and
    // nothing left to fill or backfill → no write at all.
    if (alreadyMarked && !hasColumnUpdates && !needsBundle) {
      return {
        ok: true,
        applied: false,
        reason: 'already_bootstrapped',
        appliedFields: [],
        classification: derivation.classification,
        completeness,
      };
    }

    const marker: BootstrapMarker = {
      version: COMPANY_BOOTSTRAP_VERSION,
      bootstrapped_at: now,
      source: 'company_bootstrap_service',
      applied_fields: Object.keys(derivation.columnUpdates),
      classification: derivation.classification,
      completeness,
    };

    const nextReportSettings: Record<string, unknown> = {
      ...reportSettings,
      // Backfill the discovered bundle only when absent (never clobber a richer
      // stored one).
      ...(needsBundle && derivation.discoveredBundle
        ? { discovered_metadata: derivation.discoveredBundle }
        : {}),
      bootstrap: marker,
    };

    const { error: writeError } = await supabase
      .from('company_profiles')
      .update({
        ...derivation.columnUpdates,
        report_settings: nextReportSettings,
        updated_at: now,
      })
      .eq('company_id', companyId);

    if (writeError) {
      return { ok: false, applied: false, reason: 'error', appliedFields: [], classification: derivation.classification, completeness };
    }

    return {
      ok: true,
      applied: hasColumnUpdates || needsBundle,
      reason: hasColumnUpdates || needsBundle ? 'bootstrapped' : 'no_write_needed',
      appliedFields: Object.keys(derivation.columnUpdates),
      classification: derivation.classification,
      completeness,
    };
  } catch {
    return { ok: false, applied: false, reason: 'error', appliedFields: [], classification: EMPTY_CLASSIFICATION, completeness: null };
  }
}
