/**
 * Campaign Package Assembler — deterministic, reference-only (NO AI, NO pixels).
 *
 * Groups ALREADY-GENERATED creator assets into one reusable campaign deliverable:
 * family slots, metadata, a consistency check, a read-only timeline, and an export
 * manifest. It references existing assets (urls/ids) — it never duplicates storage,
 * regenerates, re-renders, or inspects pixels. Pure + deterministic.
 */

export type AssetFamily = 'image' | 'carousel' | 'infographic' | 'banner' | 'other';

export interface PackageAsset {
  id: string | null;
  assetType: string;
  template: string | null;
  templateId: string | null;
  variant: string | null;
  platform: string | null;
  cta: string | null;
  branding: string | null;
  status: string; // 'completed' | 'failed' | 'processing' | …
  previewUrl: string | null;
  url: string | null;
  files: string[];
  caption: string | null;
  generatedAt: string | null;
  edited?: boolean;
  regenerations?: number;
  published?: boolean;
  scheduledAt?: string | null;
}

export interface CampaignPackageInput {
  campaign: {
    name?: string | null;
    objective?: string | null;
    audience?: string | null;
    platforms?: string[];
  };
  assets: PackageAsset[];
}

export interface ConsistencyCheck { key: string; label: string; ok: boolean; detail?: string }
export type TimelineKind = 'generated' | 'edited' | 'regenerated' | 'published' | 'scheduled';
export interface PackageTimelineEntry { kind: TimelineKind; label: string; timestamp: string | null }

export interface CampaignPackageMetadata {
  name: string;
  objective: string | null;
  audience: string | null;
  platforms: string[];
  generatedAt: string | null;
  templates: string[];
  variants: string[];
  assetCount: number;
  status: 'complete' | 'partial' | 'empty';
}

export interface CampaignPackage {
  metadata: CampaignPackageMetadata;
  slots: { hero: PackageAsset | null; carousel: PackageAsset | null; infographic: PackageAsset | null; banner: PackageAsset | null };
  caption: string | null;
  cta: string | null;
  publishingNotes: string[];
  summary: string;
  includedAssets: PackageAsset[];
  missingAssets: string[];
  warnings: string[];
  readyForPublishing: boolean;
  readyForScheduling: boolean;
  consistency: ConsistencyCheck[];
  timeline: PackageTimelineEntry[];
}

/* ── helpers ─────────────────────────────────────────────────────────── */

export function assetFamily(assetType: string): AssetFamily {
  const t = String(assetType ?? '').toLowerCase();
  if (t === 'carousel' || t === 'slider') return 'carousel';
  if (t === 'infographic') return 'infographic';
  if (t === 'banner') return 'banner';
  if (t === 'image') return 'image';
  return 'other';
}
function distinct<T>(xs: Array<T | null | undefined>): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    if (x == null || x === '') continue;
    const k = String(x);
    if (!seen.has(k)) { seen.add(k); out.push(x as T); }
  }
  return out;
}
function earliest(times: Array<string | null>): string | null {
  const valid = times.filter((t): t is string => !!t).sort();
  return valid[0] ?? null;
}

/* ── consistency (metadata only) ─────────────────────────────────────── */

export function checkPackageConsistency(assets: PackageAsset[], campaign: CampaignPackageInput['campaign']): ConsistencyCheck[] {
  const done = assets.filter((a) => a.status === 'completed');
  const ctas = distinct(done.map((a) => a.cta));
  const brandings = distinct(done.map((a) => a.branding));
  const platforms = distinct(done.map((a) => a.platform));
  const campaignPlatforms = campaign.platforms ?? [];
  const platformCompatible = campaignPlatforms.length > 0
    ? done.every((a) => !a.platform || campaignPlatforms.includes(a.platform))
    : platforms.length <= 1;
  const allHaveTemplate = done.length > 0 && done.every((a) => !!a.templateId || !!a.template);

  return [
    { key: 'objective', label: 'Campaign objective', ok: !!(campaign.objective && campaign.objective.trim()), detail: campaign.objective ?? 'not set' },
    { key: 'cta', label: 'CTA consistency', ok: ctas.length <= 1, detail: ctas.length <= 1 ? (ctas[0] ?? 'none') : `${ctas.length} different CTAs` },
    { key: 'branding', label: 'Branding consistency', ok: brandings.length <= 1, detail: brandings.length <= 1 ? (brandings[0] ?? 'default') : `${brandings.length} branding profiles` },
    { key: 'platform', label: 'Platform compatibility', ok: platformCompatible, detail: platforms.join(', ') || '—' },
    { key: 'template', label: 'Template compatibility', ok: allHaveTemplate, detail: distinct(done.map((a) => a.template)).join(', ') || '—' },
  ];
}

/* ── timeline (read-only; reuses existing per-asset history) ─────────── */

export function buildPackageTimeline(assets: PackageAsset[]): PackageTimelineEntry[] {
  const entries: PackageTimelineEntry[] = [];
  const gen = earliest(assets.map((a) => a.generatedAt));
  entries.push({ kind: 'generated', label: 'Generated', timestamp: gen });
  if (assets.some((a) => a.edited)) entries.push({ kind: 'edited', label: 'Edited', timestamp: null });
  const regens = assets.reduce((n, a) => n + Math.max(0, a.regenerations ?? 0), 0);
  if (regens > 0) entries.push({ kind: 'regenerated', label: `Regenerated (${regens})`, timestamp: null });
  if (assets.some((a) => a.published)) entries.push({ kind: 'published', label: 'Published', timestamp: null });
  const scheduled = earliest(assets.map((a) => a.scheduledAt ?? null));
  if (assets.some((a) => a.scheduledAt)) entries.push({ kind: 'scheduled', label: 'Scheduled', timestamp: scheduled });
  return entries;
}

/* ── assemble ────────────────────────────────────────────────────────── */

export function buildCampaignPackage(input: CampaignPackageInput): CampaignPackage {
  const assets = input.assets ?? [];
  const done = assets.filter((a) => a.status === 'completed');
  const failed = assets.filter((a) => a.status === 'failed');
  const processing = assets.filter((a) => a.status !== 'completed' && a.status !== 'failed');

  const firstOfFamily = (fam: AssetFamily): PackageAsset | null => done.find((a) => assetFamily(a.assetType) === fam) ?? null;
  const slots = {
    hero: firstOfFamily('image'),
    carousel: firstOfFamily('carousel'),
    infographic: firstOfFamily('infographic'),
    banner: firstOfFamily('banner'),
  };

  const platforms = distinct([...(input.campaign.platforms ?? []), ...done.map((a) => a.platform)]);
  const templates = distinct(done.map((a) => a.template));
  const variants = distinct(done.map((a) => a.variant));
  const cta = distinct(done.map((a) => a.cta))[0] ?? null;
  const caption = done.map((a) => a.caption).find((c) => !!c) ?? null;

  const status: CampaignPackageMetadata['status'] = assets.length === 0 ? 'empty' : (failed.length > 0 || processing.length > 0 ? 'partial' : 'complete');
  const metadata: CampaignPackageMetadata = {
    name: input.campaign.name?.trim() || 'Untitled campaign',
    objective: input.campaign.objective ?? null,
    audience: input.campaign.audience ?? null,
    platforms,
    generatedAt: earliest(assets.map((a) => a.generatedAt)),
    templates,
    variants,
    assetCount: assets.length,
    status,
  };

  const consistency = checkPackageConsistency(assets, input.campaign);
  const ctaOk = consistency.find((c) => c.key === 'cta')!.ok;
  const brandingOk = consistency.find((c) => c.key === 'branding')!.ok;
  const platformOk = consistency.find((c) => c.key === 'platform')!.ok;

  const canonicalFamilies: AssetFamily[] = ['image', 'carousel', 'infographic', 'banner'];
  const presentFamilies = new Set(done.map((a) => assetFamily(a.assetType)));
  const missingAssets = canonicalFamilies.filter((f) => !presentFamilies.has(f)).map((f) => f.charAt(0).toUpperCase() + f.slice(1));

  const warnings: string[] = [];
  if (failed.length > 0) warnings.push(`${failed.length} asset${failed.length === 1 ? '' : 's'} failed to generate.`);
  if (processing.length > 0) warnings.push(`${processing.length} asset${processing.length === 1 ? '' : 's'} still processing.`);
  if (!ctaOk) warnings.push('CTAs differ across assets — align them before publishing.');
  if (!brandingOk) warnings.push('Branding differs across assets.');
  if (!platformOk) warnings.push('Some assets target platforms outside the campaign.');
  if (!metadata.objective) warnings.push('Campaign objective is not set.');

  const readyForPublishing = done.length > 0 && failed.length === 0 && processing.length === 0 && ctaOk && brandingOk;
  const readyForScheduling = readyForPublishing && platforms.length > 0;

  const publishingNotes: string[] = [];
  if (platforms.length) publishingNotes.push(`Publish to ${platforms.join(', ')}.`);
  publishingNotes.push(`${done.length} asset${done.length === 1 ? '' : 's'} ready${missingAssets.length ? `; ${missingAssets.join(', ')} not generated` : ''}.`);
  if (cta) publishingNotes.push(`Shared CTA: “${cta}”.`);
  if (!readyForPublishing) publishingNotes.push('Resolve the warnings above before publishing.');

  const summary = `${metadata.assetCount} asset${metadata.assetCount === 1 ? '' : 's'}`
    + (templates.length ? ` · ${templates.length} template${templates.length === 1 ? '' : 's'}` : '')
    + (platforms.length ? ` · ${platforms.join(', ')}` : '')
    + ` · ${status}`;

  return {
    metadata,
    slots,
    caption,
    cta,
    publishingNotes,
    summary,
    includedAssets: done,
    missingAssets,
    warnings,
    readyForPublishing,
    readyForScheduling,
    consistency,
    timeline: buildPackageTimeline(assets),
  };
}

/* ── export manifest (references only; no new renderer) ──────────────── */

export interface PackageExportManifest {
  campaign: CampaignPackageMetadata;
  summary: string;
  assets: Array<{ id: string | null; assetType: string; template: string | null; variant: string | null; platform: string | null; status: string; url: string | null; files: string[] }>;
  consistency: ConsistencyCheck[];
  warnings: string[];
  exportedAt: string | null;
}

/** Build a JSON manifest bundling asset references + metadata + summary (no pixels). */
export function buildPackageExportManifest(pkg: CampaignPackage, exportedAt: string | null = null): PackageExportManifest {
  return {
    campaign: pkg.metadata,
    summary: pkg.summary,
    assets: pkg.includedAssets.map((a) => ({ id: a.id, assetType: a.assetType, template: a.template, variant: a.variant, platform: a.platform, status: a.status, url: a.url, files: a.files })),
    consistency: pkg.consistency,
    warnings: pkg.warnings,
    exportedAt,
  };
}
