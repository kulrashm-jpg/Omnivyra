import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import { supabase } from '../db/supabaseClient';
import { IMAGE_BUCKET, DOCUMENT_BUCKET } from './creatorAssetRendererContracts';
import { trackEvent } from './telemetry/telemetryDispatcher';

type IntegritySeverity = 'ok' | 'warning' | 'error';

export type CreatorAssetIntegrityReport = {
  status: IntegritySeverity;
  errors: string[];
  warnings: string[];
  checks: Record<string, boolean>;
  storageReferences: Array<{
    url: string;
    bucket: string | null;
    path: string | null;
    deterministicPath: boolean;
    tenantScoped: boolean;
  }>;
  checkedAt: string;
};

type PersistenceAvailability = {
  available: boolean;
  missingTables: string[];
  checkedAt: string;
  error?: string;
};

export type CreatorAttachmentInput = {
  tenantId?: string | null;
  companyId: string;
  userId: string;
  sourceType: 'post' | 'thread';
  sourceId: string;
  creatorAssetId?: string | null;
  creatorType: string;
  title: string;
  url?: string | null;
  files?: string[];
  previewKind?: string | null;
  platformContext?: string | null;
  attachmentOrder?: number | null;
  metadata?: Record<string, unknown>;
  sourceContent?: Record<string, unknown>;
  renderIdentityHash?: string | null;
};

export type CreatorAssetRecordInput = {
  tenantId?: string | null;
  companyId: string;
  userId: string;
  sourceType?: 'post' | 'thread' | null;
  sourceId?: string | null;
  creatorType: string;
  title: string;
  url?: string | null;
  files?: string[];
  previewKind?: string | null;
  platformContext?: string | null;
  metadata?: Record<string, unknown>;
  sourceContent?: Record<string, unknown>;
  renderIdentityHash?: string | null;
  blockTemplateId?: string | null;
};

let persistenceAvailabilityCache: { value: PersistenceAvailability; expiresAt: number } | null = null;

function compact(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeFiles(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => compact(item)).filter(Boolean).slice(0, 24) : [];
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function logCreatorPersistenceDiagnostic(event: string, details: Record<string, unknown>, level: 'warn' | 'error' = 'warn'): void {
  const payload = {
    event,
    component: 'creator-asset-persistence',
    at: new Date().toISOString(),
    ...details,
  };
  if (level === 'error') {
    console.error('[creator-persistence]', payload);
  } else {
    console.warn('[creator-persistence]', payload);
  }
}

function parseStorageReference(url: string): { bucket: string | null; path: string | null } {
  try {
    const parsed = new URL(url);
    const marker = parsed.pathname.includes('/storage/v1/object/sign/')
      ? '/storage/v1/object/sign/'
      : '/storage/v1/object/public/';
    const index = parsed.pathname.indexOf(marker);
    if (index < 0) return { bucket: null, path: null };
    const remainder = parsed.pathname.slice(index + marker.length);
    const [bucket, ...pathParts] = remainder.split('/').filter(Boolean);
    return { bucket: bucket || null, path: pathParts.join('/') || null };
  } catch {
    return { bucket: null, path: null };
  }
}

export async function regenerateCreatorAssetSignedUrl(input: {
  url: string;
  expiresInSeconds?: number;
}): Promise<{ signedUrl: string | null; bucket: string | null; path: string | null; error?: string }> {
  const reference = parseStorageReference(input.url);
  if (!reference.bucket || !reference.path) {
    return { signedUrl: null, bucket: reference.bucket, path: reference.path, error: 'unparseable_storage_reference' };
  }
  const { data, error } = await supabase.storage
    .from(reference.bucket)
    .createSignedUrl(reference.path, input.expiresInSeconds ?? 3600);
  if (error) {
    logCreatorPersistenceDiagnostic('signed_url_regeneration_failed', {
      bucket: reference.bucket,
      path: reference.path,
      message: error.message,
    }, 'warn');
    return { signedUrl: null, bucket: reference.bucket, path: reference.path, error: error.message };
  }
  return { signedUrl: data?.signedUrl || null, bucket: reference.bucket, path: reference.path };
}

/**
 * EVERY storage URL a creator asset row owns — the one definition.
 *
 * A single-visual render owns exactly `url`. A carousel owns N slides in
 * `files[]` (with `url` being `files[0]`) AND a separate PDF in
 * `metadata.document_url`. Deletion previously read `url` alone, so removing a
 * carousel left N-1 slides and the document behind permanently.
 *
 * Extracted from `buildStorageReferences`, which already collected exactly this
 * set for the integrity report, so the report and the deletion path cannot
 * disagree about what a row owns. Deduplicated: the same object may legitimately
 * appear in more than one field (`url` IS `files[0]`), and it must be removed
 * at most once.
 */
function renderedObjectUrlsForRow(row: {
  url?: string | null;
  files?: unknown;
  metadata?: unknown;
}): string[] {
  const metadata = safeObject(row.metadata);
  const urls = [
    typeof row.url === 'string' ? row.url : null,
    ...normalizeFiles(row.files),
    typeof metadata.document_url === 'string' ? metadata.document_url : null,
  ].filter((value): value is string => Boolean(value && value.trim()));
  return Array.from(new Set(urls));
}

function buildStorageReferences(input: {
  url?: string | null;
  files?: string[];
  metadata?: Record<string, unknown>;
  companyId: string;
  userId: string;
}): CreatorAssetIntegrityReport['storageReferences'] {
  return renderedObjectUrlsForRow(input).map((url) => {
    const parsed = parseStorageReference(url);
    const path = parsed.path || '';
    return {
      url,
      bucket: parsed.bucket,
      path: parsed.path,
      deterministicPath: /^creator\/[^/]+\/[^/]+\/[^/]+\/[^/]+-[0-9a-f]{12}\.[a-z0-9]+$/i.test(path),
      tenantScoped: path.includes(`/creator/${input.companyId}/`) || path.startsWith(`creator/${input.companyId}/`),
    };
  });
}

export async function checkCreatorPersistenceAvailability(force = false): Promise<PersistenceAvailability> {
  const now = Date.now();
  if (!force && persistenceAvailabilityCache && persistenceAvailabilityCache.expiresAt > now) {
    return persistenceAvailabilityCache.value;
  }

  const missingTables: string[] = [];
  let errorMessage = '';
  for (const table of ['creator_assets', 'creator_asset_attachments']) {
    const { error } = await ownedDbTable(table).select('id').limit(1);
    if (error) {
      missingTables.push(table);
      errorMessage = error.message;
    }
  }
  const value: PersistenceAvailability = {
    available: missingTables.length === 0,
    missingTables,
    checkedAt: new Date().toISOString(),
    error: errorMessage || undefined,
  };
  persistenceAvailabilityCache = { value, expiresAt: now + 60_000 };
  if (!value.available) {
    logCreatorPersistenceDiagnostic('migration_readiness_failed', value, 'warn');
  }
  return value;
}

function stableAssetId(input: {
  companyId: string;
  userId: string;
  sourceType?: string | null;
  sourceId?: string | null;
  creatorType: string;
  renderIdentityHash?: string | null;
  url?: string | null;
  title?: string | null;
}): string {
  const key = [
    input.companyId,
    input.userId,
    input.sourceType || 'standalone',
    input.sourceId || 'none',
    input.creatorType,
    input.renderIdentityHash || input.url || input.title || 'asset',
  ].join('|');
  return createHash('sha1').update(key).digest('hex').slice(0, 32);
}

function buildReconstructionMetadata(input: {
  metadata?: Record<string, unknown>;
  sourceContent?: Record<string, unknown>;
  platformContext?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  renderIdentityHash?: string | null;
}): Record<string, unknown> {
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const integrity = validateCreatorAssetIntegrity({
    companyId: compact(metadata.companyId || metadata.company_id) || '',
    userId: compact(metadata.userId || metadata.user_id) || '',
    url: typeof metadata.url === 'string' ? metadata.url : undefined,
    files: normalizeFiles(metadata.files),
    metadata,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    renderIdentityHash: input.renderIdentityHash,
  });
  const reconstruction = validateCreatorAssetReconstruction({
    metadata,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    platformContext: input.platformContext,
  });
  const parity = validateRenderExportParity(metadata);
  return {
    ...metadata,
    platformContext: input.platformContext ?? metadata.platformContext ?? metadata.platform_context ?? null,
    renderIdentityHash: input.renderIdentityHash ?? metadata.renderIdentityHash ?? metadata.render_identity_hash ?? null,
    sourceWriterRelationship: {
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      title: input.sourceContent?.title ?? null,
    },
    sourceContent: input.sourceContent ?? metadata.sourceContent ?? null,
    generationTimestamp: metadata.generationTimestamp ?? metadata.generated_at ?? new Date().toISOString(),
    reconstructionVersion: 'creator-asset-reconstruction-v1',
    persistenceCompletion: {
      status: integrity.status === 'error' || reconstruction.status === 'error' || parity.status === 'error' ? 'partial' : 'complete',
      completedAt: new Date().toISOString(),
      integrityStatus: integrity.status,
      reconstructionStatus: reconstruction.status,
      parityStatus: parity.status,
    },
    recovery: {
      recoveryVersion: 'creator-asset-recovery-v1',
      canRecoverFromPreview: Boolean(metadata.url || (Array.isArray(metadata.files) && metadata.files.length > 0)),
      canRegenerateSignedUrls: true,
      cleanupPolicy: 'detect_only',
    },
    integrity,
    reconstruction,
    parity,
  };
}

export function validateCreatorAssetReconstruction(input: {
  metadata?: Record<string, unknown>;
  sourceType?: string | null;
  sourceId?: string | null;
  platformContext?: string | null;
}): Omit<CreatorAssetIntegrityReport, 'storageReferences'> {
  const metadata = safeObject(input.metadata);
  const brandKit = safeObject(metadata.creatorBrandKit);
  const overlay = safeObject(metadata.overlayConfiguration);
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks = {
    brandKitRestorable: Object.keys(brandKit).length > 0 && Boolean(brandKit.rendererIdentityVersion),
    typographyRestorable: Boolean(safeObject(brandKit.typography).fontFamily || safeObject(brandKit.typography).pdfFont),
    overlayRestorable: Object.keys(overlay).length > 0,
    layoutVariantRestorable: Boolean(metadata.layoutVariantId || safeObject(metadata.creatorBrandKit).layoutVariantId),
    platformRestorable: Boolean(input.platformContext || metadata.platformContext || metadata.platform_context),
    renderHashRestorable: Boolean(metadata.renderIdentityHash || metadata.render_identity_hash),
    sourceRelationshipRestorable: Boolean(input.sourceType && input.sourceId) || Object.keys(safeObject(metadata.sourceWriterRelationship)).length > 0,
    previewExportParityRestorable: Boolean(metadata.preview_export_parity || metadata.pdf_document_status || Array.isArray(metadata.exportCapabilities)),
  };
  Object.entries(checks).forEach(([key, ok]) => {
    if (!ok && ['brandKitRestorable', 'layoutVariantRestorable', 'renderHashRestorable'].includes(key)) errors.push(key);
    else if (!ok) warnings.push(key);
  });
  return {
    status: errors.length ? 'error' : warnings.length ? 'warning' : 'ok',
    errors,
    warnings,
    checks,
    checkedAt: new Date().toISOString(),
  };
}

export function validateCreatorAssetIntegrity(input: {
  companyId: string;
  userId: string;
  url?: string | null;
  files?: string[];
  metadata?: Record<string, unknown>;
  sourceType?: string | null;
  sourceId?: string | null;
  renderIdentityHash?: string | null;
}): CreatorAssetIntegrityReport {
  const metadata = safeObject(input.metadata);
  const renderHash = compact(input.renderIdentityHash || metadata.renderIdentityHash || metadata.render_identity_hash);
  const storageReferences = buildStorageReferences({
    url: input.url,
    files: input.files,
    metadata,
    companyId: input.companyId,
    userId: input.userId,
  });
  const hasPreview = Boolean(input.url || normalizeFiles(input.files).length > 0);
  const brandKit = safeObject(metadata.creatorBrandKit);
  const checks = {
    attachmentReferencesExist: hasPreview,
    brandKitSnapshotExists: Object.keys(brandKit).length > 0,
    renderIdentityHashExists: Boolean(renderHash),
    sourceRelationshipExists: Boolean(input.sourceType && input.sourceId) || Object.keys(safeObject(metadata.sourceWriterRelationship)).length > 0,
    tenantOwnershipPresent: Boolean(input.companyId && input.userId),
    deterministicStoragePaths: storageReferences.length === 0 || storageReferences.every((item) => item.deterministicPath),
    storageTenantScoped: storageReferences.length === 0 || storageReferences.every((item) => item.tenantScoped),
    exportCapabilitiesPresent: Array.isArray(metadata.exportCapabilities) || Array.isArray(metadata.export_capabilities),
  };
  const errors: string[] = [];
  const warnings: string[] = [];
  Object.entries(checks).forEach(([key, ok]) => {
    if (ok) return;
    if (['attachmentReferencesExist', 'brandKitSnapshotExists', 'renderIdentityHashExists', 'tenantOwnershipPresent', 'storageTenantScoped'].includes(key)) {
      errors.push(key);
    } else {
      warnings.push(key);
    }
  });
  if (metadata.pdf_document_status === 'preview_only') {
    warnings.push('pdf_export_preview_only');
  }
  return {
    status: errors.length ? 'error' : warnings.length ? 'warning' : 'ok',
    errors,
    warnings: Array.from(new Set(warnings)),
    checks,
    storageReferences,
    checkedAt: new Date().toISOString(),
  };
}

export function validateRenderExportParity(metadataInput: unknown): Omit<CreatorAssetIntegrityReport, 'storageReferences'> {
  const metadata = safeObject(metadataInput);
  const brandKit = safeObject(metadata.creatorBrandKit);
  const overlay = safeObject(metadata.overlayConfiguration);
  const exportCapabilities = Array.isArray(metadata.exportCapabilities) ? metadata.exportCapabilities.map(String) : [];
  const checks = {
    brandKitParity: Boolean(brandKit.rendererIdentityVersion && metadata.rendererVersion === brandKit.rendererIdentityVersion),
    paletteParity: JSON.stringify(metadata.paletteUsed || []) === JSON.stringify(brandKit.normalizedPalette || []),
    typographyParity: Boolean(safeObject(brandKit.typography).fontFamily || safeObject(brandKit.typography).pdfFont),
    overlayParity: Object.keys(overlay).length > 0,
    logoParity: Boolean(metadata.logoSource || brandKit.resolvedBrandMarkType),
    footerIdentityParity: Boolean(brandKit.companyName || brandKit.domain),
    exportStatusAligned: metadata.pdf_document_status === 'available'
      ? exportCapabilities.includes('pdf_document')
      : metadata.pdf_document_status === 'preview_only'
        ? !exportCapabilities.includes('pdf_document')
        : true,
  };
  const errors = Object.entries(checks)
    .filter(([key, ok]) => !ok && ['brandKitParity', 'exportStatusAligned'].includes(key))
    .map(([key]) => key);
  const warnings = Object.entries(checks)
    .filter(([key, ok]) => !ok && !errors.includes(key))
    .map(([key]) => key);
  return {
    status: errors.length ? 'error' : warnings.length ? 'warning' : 'ok',
    errors,
    warnings,
    checks,
    checkedAt: new Date().toISOString(),
  };
}

export async function upsertCreatorAssetRecord(input: CreatorAssetRecordInput): Promise<Record<string, unknown>> {
  const availability = await checkCreatorPersistenceAvailability();
  if (!availability.available) {
    throw new Error(`CREATOR_PERSISTENCE_UNAVAILABLE:${availability.missingTables.join(',')}`);
  }
  const files = normalizeFiles(input.files);
  const renderIdentityHash = compact(input.renderIdentityHash || input.metadata?.renderIdentityHash || input.metadata?.render_identity_hash) || null;
  const id = stableAssetId({
    companyId: input.companyId,
    userId: input.userId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    creatorType: input.creatorType,
    renderIdentityHash,
    url: input.url,
    title: input.title,
  });
  const baseMetadata = {
    ...safeObject(input.metadata),
    companyId: input.companyId,
    userId: input.userId,
    url: input.url ?? null,
    files,
  };
  const metadata = buildReconstructionMetadata({
    metadata: baseMetadata,
    sourceContent: input.sourceContent,
    platformContext: input.platformContext,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    renderIdentityHash,
  });
  const row = {
    id,
    tenant_id: input.tenantId || input.companyId,
    company_id: input.companyId,
    user_id: input.userId,
    source_type: input.sourceType ?? null,
    source_id: input.sourceId ?? null,
    creator_type: input.creatorType,
    title: input.title,
    url: input.url ?? null,
    files,
    preview_kind: input.previewKind ?? null,
    platform_context: input.platformContext ?? null,
    metadata,
    source_content: input.sourceContent ?? null,
    render_identity_hash: renderIdentityHash,
    block_template_id: input.blockTemplateId ?? null,
    updated_at: new Date().toISOString(),
  };
  if (safeObject(metadata.integrity).status === 'error') {
    logCreatorPersistenceDiagnostic('asset_integrity_validation_failed', {
      companyId: input.companyId,
      userId: input.userId,
      creatorType: input.creatorType,
      errors: safeObject(metadata.integrity).errors,
    }, 'warn');
  }

  const { data, error } = await ownedDbTable('creator_assets')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw new Error(`Failed to persist creator asset: ${error.message}`);
  const asset = data as Record<string, unknown>;
  // Adoption telemetry (append-only, fail-soft): an AI-produced creator asset
  // was persisted. Deduped per asset id (upsert is idempotent).
  trackEvent({
    type: 'ai.generated',
    organizationId: input.companyId,
    actorId: input.userId ?? null,
    entityId: typeof asset.id === 'string' ? asset.id : null,
    metadata: { creatorType: input.creatorType ?? '', assetType: input.sourceType ?? '' },
  });
  return asset;
}

export async function attachCreatorAsset(input: CreatorAttachmentInput): Promise<Record<string, unknown>> {
  const availability = await checkCreatorPersistenceAvailability();
  if (!availability.available) {
    throw new Error(`CREATOR_PERSISTENCE_UNAVAILABLE:${availability.missingTables.join(',')}`);
  }
  const asset = await upsertCreatorAssetRecord({
    tenantId: input.tenantId,
    companyId: input.companyId,
    userId: input.userId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    creatorType: input.creatorType,
    title: input.title,
    url: input.url,
    files: input.files,
    previewKind: input.previewKind,
    platformContext: input.platformContext,
    metadata: input.metadata,
    sourceContent: input.sourceContent,
    renderIdentityHash: input.renderIdentityHash,
  });
  const creatorAssetId = compact(input.creatorAssetId || asset.id) || String(asset.id);
  const normalizedFiles = normalizeFiles(input.files);
  const baseMetadata = {
    ...safeObject(input.metadata),
    companyId: input.companyId,
    userId: input.userId,
    url: input.url ?? null,
    files: normalizedFiles,
  };
  const metadata = buildReconstructionMetadata({
    metadata: baseMetadata,
    sourceContent: input.sourceContent,
    platformContext: input.platformContext,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    renderIdentityHash: input.renderIdentityHash,
  });

  const { data, error } = await ownedDbTable('creator_asset_attachments')
    .upsert({
      tenant_id: input.tenantId || input.companyId,
      company_id: input.companyId,
      user_id: input.userId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      creator_asset_id: creatorAssetId,
      creator_type: input.creatorType,
      title: input.title,
      url: input.url ?? null,
      files: normalizedFiles,
      preview_kind: input.previewKind ?? null,
      platform_context: input.platformContext ?? null,
      attachment_order: input.attachmentOrder ?? 0,
      metadata,
      source_content: input.sourceContent ?? null,
      render_identity_hash: input.renderIdentityHash ?? metadata.renderIdentityHash ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,user_id,source_type,source_id,creator_asset_id' })
    .select()
    .single();
  if (error) throw new Error(`Failed to persist creator attachment: ${error.message}`);
  return data as Record<string, unknown>;
}

export async function listCreatorAssetAttachments(input: {
  companyId: string;
  userId: string;
  sourceType: 'post' | 'thread';
  sourceId: string;
}): Promise<Record<string, unknown>[]> {
  const availability = await checkCreatorPersistenceAvailability();
  if (!availability.available) {
    throw new Error(`CREATOR_PERSISTENCE_UNAVAILABLE:${availability.missingTables.join(',')}`);
  }
  const { data, error } = await ownedDbTable('creator_asset_attachments')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('user_id', input.userId)
    .eq('source_type', input.sourceType)
    .eq('source_id', input.sourceId)
    .order('attachment_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(24);
  if (error) throw new Error(`Failed to load creator attachments: ${error.message}`);
  return (data || []) as Record<string, unknown>[];
}

export async function listCreatorAssets(input: {
  companyId: string;
  userId: string;
  creatorTypes?: string[];
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const availability = await checkCreatorPersistenceAvailability();
  if (!availability.available) {
    throw new Error(`CREATOR_PERSISTENCE_UNAVAILABLE:${availability.missingTables.join(',')}`);
  }
  let query = ownedDbTable('creator_assets')
    .select('*')
    .eq('company_id', input.companyId)
    .order('created_at', { ascending: false })
    .limit(input.limit ?? 48);
  if (input.creatorTypes && input.creatorTypes.length > 0) {
    query = query.in('creator_type', Array.from(new Set(input.creatorTypes)));
  }
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load creator assets: ${error.message}`);
  return (data || []) as Record<string, unknown>[];
}

export async function validatePersistedCreatorAsset(input: {
  companyId: string;
  userId: string;
  assetId: string;
}): Promise<{
  asset: Record<string, unknown> | null;
  integrity: CreatorAssetIntegrityReport | null;
  reconstruction: Omit<CreatorAssetIntegrityReport, 'storageReferences'> | null;
  parity: Omit<CreatorAssetIntegrityReport, 'storageReferences'> | null;
}> {
  const availability = await checkCreatorPersistenceAvailability();
  if (!availability.available) {
    throw new Error(`CREATOR_PERSISTENCE_UNAVAILABLE:${availability.missingTables.join(',')}`);
  }
  const { data, error } = await ownedDbTable('creator_assets')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('user_id', input.userId)
    .eq('id', input.assetId)
    .maybeSingle();
  if (error) throw new Error(`Failed to validate creator asset: ${error.message}`);
  if (!data) return { asset: null, integrity: null, reconstruction: null, parity: null };
  const row = data as Record<string, unknown>;
  const metadata = safeObject(row.metadata);
  const integrity = validateCreatorAssetIntegrity({
    companyId: input.companyId,
    userId: input.userId,
    url: typeof row.url === 'string' ? row.url : undefined,
    files: normalizeFiles(row.files),
    metadata,
    sourceType: typeof row.source_type === 'string' ? row.source_type : null,
    sourceId: typeof row.source_id === 'string' ? row.source_id : null,
    renderIdentityHash: typeof row.render_identity_hash === 'string' ? row.render_identity_hash : null,
  });
  const reconstruction = validateCreatorAssetReconstruction({
    metadata,
    sourceType: typeof row.source_type === 'string' ? row.source_type : null,
    sourceId: typeof row.source_id === 'string' ? row.source_id : null,
    platformContext: typeof row.platform_context === 'string' ? row.platform_context : null,
  });
  const parity = validateRenderExportParity(metadata);
  return { asset: row, integrity, reconstruction, parity };
}

export async function detectCreatorAssetStaleState(input: {
  companyId: string;
  userId: string;
  assetId?: string;
  limit?: number;
}): Promise<{
  candidates: Array<{
    id: string;
    reason: string[];
    cleanupMode: 'detect_only';
  }>;
  checkedAt: string;
}> {
  const availability = await checkCreatorPersistenceAvailability();
  if (!availability.available) {
    throw new Error(`CREATOR_PERSISTENCE_UNAVAILABLE:${availability.missingTables.join(',')}`);
  }
  let query = ownedDbTable('creator_assets')
    .select('id, url, files, metadata, render_identity_hash')
    .eq('company_id', input.companyId)
    .eq('user_id', input.userId)
    .order('created_at', { ascending: false })
    .limit(input.limit ?? 50);
  if (input.assetId) query = query.eq('id', input.assetId);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to detect stale creator assets: ${error.message}`);
  const candidates = (data || []).map((row: Record<string, unknown>) => {
    const metadata = safeObject(row.metadata);
    const reasons: string[] = [];
    const completion = safeObject(metadata.persistenceCompletion);
    const integrity = validateCreatorAssetIntegrity({
      companyId: input.companyId,
      userId: input.userId,
      url: typeof row.url === 'string' ? row.url : undefined,
      files: normalizeFiles(row.files),
      metadata,
      renderIdentityHash: typeof row.render_identity_hash === 'string' ? row.render_identity_hash : null,
    });
    if (completion.status === 'partial') reasons.push('partial_persistence');
    if (integrity.status === 'error') reasons.push(...integrity.errors);
    if (metadata.pdf_document_status === 'preview_only') reasons.push('pdf_export_missing');
    return {
      id: String(row.id),
      reason: Array.from(new Set(reasons)),
      cleanupMode: 'detect_only' as const,
    };
  }).filter((item) => item.reason.length > 0);
  return { candidates, checkedAt: new Date().toISOString() };
}

/**
 * Delete a creator_assets row PLUS any attachment-table rows that
 * reference it. Scoped strictly to (assetId, companyId) so a caller
 * can never delete a row outside their tenant. Returns the number of
 * deleted rows in each table for the API response.
 */
export async function deleteCreatorAssetRecord(input: {
  assetId: string;
  companyId: string;
}): Promise<{ deletedAsset: boolean; deletedAttachments: number }> {
  const availability = await checkCreatorPersistenceAvailability();
  if (!availability.available) {
    throw new Error(`CREATOR_PERSISTENCE_UNAVAILABLE:${availability.missingTables.join(',')}`);
  }

  // Detach any creator_asset_attachments rows first — keeps writer
  // attachment lists consistent if the asset was previously embedded.
  let deletedAttachments = 0;
  try {
    const { data: attachRows } = await ownedDbTable('creator_asset_attachments')
      .delete()
      .eq('company_id', input.companyId)
      .eq('creator_asset_id', input.assetId)
      .select('id');
    deletedAttachments = Array.isArray(attachRows) ? attachRows.length : 0;
  } catch {
    // Best-effort: attachment cleanup failure must not block asset delete.
  }

  // `url`, `files` and `metadata` are projected so the DELETE itself hands back
  // every location the row owned. Reading them from the deleted row — rather
  // than from a caller — is what makes an arbitrary storage path unexpressible
  // here. Projecting `url` alone was the defect: a carousel owns N slides and a
  // document, and only the first slide was ever removed.
  const { data, error } = await ownedDbTable('creator_assets')
    .delete()
    .eq('id', input.assetId)
    .eq('company_id', input.companyId)
    .select('id, url, files, metadata');
  if (error) throw new Error(`Failed to delete creator asset: ${error.message}`);

  const deletedAsset = Array.isArray(data) && data.length > 0;
  if (deletedAsset) {
    // Row first, objects second — the ordering Phase 64 settled. Supabase gives
    // no transaction across database and storage, so the question is only which
    // residue is safer: orphaned bytes nothing reads (a cost), or a row
    // pointing at bytes that are gone (a defect the renderer would hit).
    await removeRenderedObjectsForDeletedAsset(
      input.companyId,
      renderedObjectUrlsForRow((data as Array<Record<string, unknown>>)[0] ?? {}),
    );
  }

  return { deletedAsset, deletedAttachments };
}

/**
 * Bound on the sharer scan.
 *
 * The scan must SEE every remaining row to be sure an object is unreferenced.
 * If a company has more rows than this, the answer would be incomplete — and an
 * incomplete "nothing references it" is precisely the false negative that would
 * widen deletion. So a truncated scan skips deletion rather than guessing.
 */
const SHARER_SCAN_LIMIT = 2000;

/**
 * Every `bucket/path` still referenced by the company's REMAINING creator
 * assets, or `null` when that cannot be established completely.
 *
 * Read in JS rather than filtered in the query because `files` and `metadata`
 * are jsonb: PostgREST cannot substring-match inside them, and matching on the
 * full URL would not work either — a render's stored URL is normally SIGNED, so
 * two rows pointing at the same object can carry different URL strings. The
 * object identity is the bucket and key, which only parsing yields.
 */
async function referencedRenderPathsForCompany(companyId: string): Promise<Set<string> | null> {
  try {
    const { data, error } = await ownedDbTable('creator_assets')
      .select('id, url, files, metadata')
      .eq('company_id', companyId)
      .limit(SHARER_SCAN_LIMIT);
    if (error) return null;
    const rows = Array.isArray(data) ? data : [];
    if (rows.length >= SHARER_SCAN_LIMIT) return null;   // possibly truncated → refuse
    const referenced = new Set<string>();
    for (const row of rows as Array<Record<string, unknown>>) {
      for (const url of renderedObjectUrlsForRow(row)) {
        const { bucket, path } = parseStorageReference(url);
        if (bucket && path) referenced.add(`${bucket}/${path}`);
      }
    }
    return referenced;
  } catch {
    return null;
  }
}

/** Buckets a creator render is ever written to (`creatorAssetRendererMedia`). */
const RENDER_BUCKETS: ReadonlySet<string> = new Set([IMAGE_BUCKET, DOCUMENT_BUCKET]);
/** The only key prefix a creator render occupies. */
const RENDER_NAMESPACE = 'creator/';

/**
 * Remove EVERY rendered object belonging to a creator asset that was just
 * deleted.
 *
 * WHY THIS EXISTS
 * ---------------
 * Deleting a creator asset removed the row and its attachments but left the
 * rendered images in storage forever. Nothing swept them: the janitor scans
 * `media-uploads`, renders live in `media-images`/`media-documents`, and it is
 * dormant regardless.
 *
 * Phase 74 closed that for single-visual assets. It read `url` alone, so a
 * CAROUSEL — which owns N slides in `files[]` and a separate PDF in
 * `metadata.document_url` — still orphaned everything except its first slide.
 * This closes the rest.
 *
 * PER OBJECT, NOT ALL-OR-NOTHING. Each object is judged on its own: a shared
 * slide is retained while its unshared siblings and the document are removed.
 * That is the faithful extension of the single-object rule, not a new policy.
 *
 * FAIL-SOFT, MATCHING ITS SIBLINGS. The row is already gone and that deletion
 * is committed; `deleteMediaFile` and `deleteCanonicalMediaAsset` both warn and
 * continue when storage removal fails, so this does too. One object's failure
 * never stops the others.
 *
 * REFUSES ANYTHING IT CANNOT PROVE. Locations come from the deleted row, are
 * parsed by the existing `parseStorageReference` (which already understands
 * both the signed and public URL shapes renders use), and must land inside the
 * creator render namespace OF THIS COMPANY in a known render bucket. Anything
 * else is skipped — deleting the wrong object is far worse than leaving one.
 */
async function removeRenderedObjectsForDeletedAsset(
  companyId: string,
  urls: string[],
): Promise<void> {
  if (!Array.isArray(urls) || urls.length === 0) return;   // nothing was rendered
  const skip = (reason: string) =>
    console.warn('[creator-asset][rendered-object-skipped]', { companyId, reason });

  // Validate first, so a malformed sibling cannot cost the others their turn.
  const targets = new Map<string, { bucket: string; path: string }>();
  for (const url of urls) {
    const { bucket, path } = parseStorageReference(url);
    if (!bucket || !path) { skip('unparseable storage reference'); continue; }
    if (!RENDER_BUCKETS.has(bucket)) { skip(`bucket "${bucket}" is not a render bucket`); continue; }
    if (path.split('/').some((seg) => seg === '..' || seg === '.')) { skip('path contains traversal'); continue; }
    // TENANT-SCOPED, not merely namespaced. `buildStorageReferences` already
    // treats `creator/<companyId>/…` as the tenant-scoped shape; requiring it
    // here means a row whose url somehow named another company's render still
    // cannot reach that company's object.
    if (!path.startsWith(`${RENDER_NAMESPACE}${companyId}/`)) {
      skip("path is outside this company's creator render namespace"); continue;
    }
    targets.set(`${bucket}/${path}`, { bucket, path });   // dedup: remove at most once
  }
  if (targets.size === 0) return;

  /*
   * SHARED OBJECT CHECK. The object key ends in a sha1 of the rendered bytes,
   * so two byte-identical renders for the same company/campaign/user resolve to
   * the SAME path — a regenerate or a variant fan-out can legitimately produce
   * one. Removing it while another row still points at it would leave that row
   * dangling, which is the failure this whole change exists to avoid.
   *
   * The deleted row is already gone, so whatever remains IS the set of other
   * owners. An indeterminate answer skips every object rather than guessing.
   */
  const referenced = await referencedRenderPathsForCompany(companyId);
  if (referenced === null) {
    return skip('could not confirm the objects are unreferenced');
  }

  for (const [key, { bucket, path }] of targets) {
    if (referenced.has(key)) { skip('another creator asset still references this object'); continue; }
    try {
      const { error } = await supabase.storage.from(bucket).remove([path]);
      if (error) skip(`storage remove failed: ${error.message}`);
    } catch (err) {
      skip(`storage remove threw: ${(err as Error)?.message?.slice(0, 120)}`);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Strategic Mix P2 — Asset Library (SPEC-001 §1 "Asset" entity).
 *
 * The `library` jsonb column holds the client CreatorAsset envelope
 * (versions[] / currentVersion / selectedVariant / discovery metadata) — the
 * client library logic (register / version / duplicate / restore / rename)
 * is pure over a storage backend, and these functions make the SERVER that
 * backend. ONE asset model: rows stay the canonical flat asset (every
 * existing reader unchanged); the envelope is its version history.
 *
 * Legacy rows (library IS NULL) are surfaced by SYNTHESIZING a v1 envelope
 * from the flat columns, so every pre-P2 creator asset appears in the
 * library with history from day one. Soft delete / archive / usage live on
 * flat columns.
 * ════════════════════════════════════════════════════════════════════════ */

export interface LibraryAssetRecord {
  /** The client CreatorAsset envelope (authoritative version history). */
  envelope: Record<string, unknown>;
  /** Server-owned facts the client cannot fabricate. */
  serverMeta: {
    archivedAt: string | null;
    usageCount: number;
    lastUsedAt: string | null;
    updatedAt: string | null;
    createdAt: string | null;
  };
}

function rowToLibraryRecord(row: Record<string, unknown>): LibraryAssetRecord {
  const lib = safeObject(row.library);
  const hasEnvelope = Array.isArray(lib.versions) && lib.versions.length > 0;
  const createdAt = typeof row.created_at === 'string' ? row.created_at : new Date().toISOString();
  const envelope = hasEnvelope
    ? lib
    : (() => {
        // Legacy row → synthesized v1 envelope from flat columns.
        const metadata = safeObject(row.metadata);
        const payload = {
          id: String(row.id),
          creatorType: String(row.creator_type || 'asset'),
          title: String(row.title || 'Creator asset'),
          url: typeof row.url === 'string' ? row.url : undefined,
          files: Array.isArray(row.files) ? (row.files as unknown[]).map(String) : undefined,
          previewKind: typeof row.preview_kind === 'string' ? row.preview_kind : undefined,
          platformContext: typeof row.platform_context === 'string' ? row.platform_context : undefined,
          renderIdentityHash: typeof row.render_identity_hash === 'string' ? row.render_identity_hash : undefined,
          metadata,
          createdAt,
        };
        return {
          id: String(row.id),
          currentVersion: 1,
          versions: [{ version: 1, op: 'generate', payload, createdAt }],
          selectedVariant: null,
          metadata: {
            organizationId: typeof row.company_id === 'string' ? row.company_id : null,
            campaignId: null,
            creatorSource: 'creator',
            assetType: String(row.creator_type || 'asset'),
            templateId: typeof metadata.template_id === 'string' ? metadata.template_id : null,
            createdBy: typeof row.user_id === 'string' ? row.user_id : null,
            createdAt,
            tags: Array.isArray(metadata.tags) ? (metadata.tags as unknown[]).map(String).filter(Boolean) : [],
            status: 'ready',
            platform: typeof row.platform_context === 'string' ? row.platform_context : null,
            version: 1,
          },
          createdAt,
          updatedAt: typeof row.updated_at === 'string' ? row.updated_at : createdAt,
        };
      })();
  return {
    envelope,
    serverMeta: {
      archivedAt: typeof row.archived_at === 'string' ? row.archived_at : null,
      usageCount: Number(row.usage_count ?? 0),
      lastUsedAt: typeof row.last_used_at === 'string' ? row.last_used_at : null,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
      createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    },
  };
}

/** Current-version payload of an envelope (for flat-column sync). */
function envelopeCurrentPayload(envelope: Record<string, unknown>): Record<string, unknown> {
  const versions = Array.isArray(envelope.versions) ? (envelope.versions as Record<string, unknown>[]) : [];
  const current = Number(envelope.currentVersion ?? versions.length);
  const hit = versions.find((v) => Number(v.version) === current) ?? versions[versions.length - 1];
  return safeObject(hit?.payload);
}

/** Write (upsert) a library envelope. Flat columns sync from the CURRENT
 *  version so every legacy reader (reuse picker, workflow recent-8, GET list)
 *  reflects library edits. The row `metadata` column is NOT overwritten for
 *  rows that already carry the reconstruction envelope. */
/**
 * Raised when a compare-and-set write loses to a concurrent writer.
 *
 * Only reachable by callers that opt into `expectedCurrentVersion` — every
 * existing caller keeps the blind-upsert behaviour and can never see this.
 */
export class LibraryVersionConflictError extends Error {
  readonly assetId: string;
  readonly expectedCurrentVersion: number;
  constructor(assetId: string, expectedCurrentVersion: number) {
    super(`library asset ${assetId} changed concurrently (expected version ${expectedCurrentVersion})`);
    this.name = 'LibraryVersionConflictError';
    this.assetId = assetId;
    this.expectedCurrentVersion = expectedCurrentVersion;
  }
}

export async function libraryWriteAsset(input: {
  companyId: string;
  userId: string;
  envelope: Record<string, unknown>;
  /**
   * The `currentVersion` this write was computed from. When supplied, the
   * write becomes a compare-and-set and only lands if the stored envelope is
   * still on that version — see the CAS block below.
   */
  expectedCurrentVersion?: number;
}): Promise<LibraryAssetRecord> {
  const availability = await checkCreatorPersistenceAvailability();
  if (!availability.available) {
    throw new Error(`CREATOR_PERSISTENCE_UNAVAILABLE:${availability.missingTables.join(',')}`);
  }
  const id = compact(input.envelope.id);
  if (!id) throw new Error('library asset envelope requires an id');
  const payload = envelopeCurrentPayload(input.envelope);
  const nowIso = new Date().toISOString();

  const { data: existing } = await ownedDbTable('creator_assets')
    .select('id, metadata')
    .eq('id', id)
    .eq('company_id', input.companyId)
    .maybeSingle();

  const row: Record<string, unknown> = {
    id,
    tenant_id: input.companyId,
    company_id: input.companyId,
    user_id: input.userId,
    creator_type: compact(payload.creatorType) || 'asset',
    title: compact(payload.title) || 'Creator asset',
    url: typeof payload.url === 'string' ? payload.url : null,
    files: normalizeFiles(payload.files as string[] | undefined),
    preview_kind: compact(payload.previewKind) || null,
    platform_context: compact(payload.platformContext) || null,
    render_identity_hash: compact(payload.renderIdentityHash) || null,
    library: input.envelope,
    updated_at: nowIso,
  };
  if (!existing) {
    // Brand-new library-origin row: give it a minimal metadata column so the
    // legacy list mapper has something coherent to read.
    row.metadata = { ...safeObject(payload.metadata), companyId: input.companyId, userId: input.userId };
    row.source_type = null;
    row.source_id = null;
  }

  // Optional compare-and-set, the same idiom `updateScheduledPostOnPublish`
  // uses for its G12 guard: when the caller supplies the version it read, the
  // UPDATE only applies while the stored envelope is still on that version.
  //
  // This matters because the envelope is one JSONB document written whole. Two
  // refinements that both start from vN both compute vN+1, and the second
  // blind write — assembled from a snapshot that never contained the first —
  // replaces the row and discards it. Guarding on the version the write was
  // derived from turns that silent loss into a detectable conflict.
  //
  // Callers that omit `expectedCurrentVersion` keep the original upsert, which
  // is still what creation and non-versioned writes need.
  if (typeof input.expectedCurrentVersion === 'number') {
    const { data, error } = await ownedDbTable('creator_assets')
      .update(row)
      .eq('id', id)
      .eq('company_id', input.companyId)
      .eq('library->>currentVersion', String(input.expectedCurrentVersion))
      .select()
      .maybeSingle();
    if (error) throw new Error(`Failed to persist library asset: ${error.message}`);
    // No row matched: another writer moved currentVersion on. Refuse rather
    // than overwrite — the caller decides whether to retry.
    if (!data) throw new LibraryVersionConflictError(id, input.expectedCurrentVersion);
    return rowToLibraryRecord(data as Record<string, unknown>);
  }

  const { data, error } = await ownedDbTable('creator_assets')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw new Error(`Failed to persist library asset: ${error.message}`);
  return rowToLibraryRecord(data as Record<string, unknown>);
}

export async function libraryReadAsset(input: {
  companyId: string;
  assetId: string;
}): Promise<LibraryAssetRecord | null> {
  const availability = await checkCreatorPersistenceAvailability();
  if (!availability.available) {
    throw new Error(`CREATOR_PERSISTENCE_UNAVAILABLE:${availability.missingTables.join(',')}`);
  }
  const { data, error } = await ownedDbTable('creator_assets')
    .select('*')
    .eq('id', input.assetId)
    .eq('company_id', input.companyId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`Failed to load library asset: ${error.message}`);
  return data ? rowToLibraryRecord(data as Record<string, unknown>) : null;
}

export async function libraryListAssets(input: {
  companyId: string;
  q?: string;
  creatorTypes?: string[];
  tags?: string[];
  includeArchived?: boolean;
  limit?: number;
}): Promise<LibraryAssetRecord[]> {
  const availability = await checkCreatorPersistenceAvailability();
  if (!availability.available) {
    throw new Error(`CREATOR_PERSISTENCE_UNAVAILABLE:${availability.missingTables.join(',')}`);
  }
  let query = ownedDbTable('creator_assets')
    .select('*')
    .eq('company_id', input.companyId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(input.limit ?? 200);
  if (!input.includeArchived) query = query.is('archived_at', null);
  if (input.creatorTypes && input.creatorTypes.length > 0) {
    query = query.in('creator_type', Array.from(new Set(input.creatorTypes)));
  }
  if (input.q && input.q.trim()) {
    query = query.ilike('title', `%${input.q.trim().replace(/[%_]/g, '')}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list library assets: ${error.message}`);
  let records = ((data || []) as Record<string, unknown>[]).map(rowToLibraryRecord);
  if (input.tags && input.tags.length > 0) {
    const want = new Set(input.tags.map((t) => t.toLowerCase()));
    records = records.filter((r) => {
      const tags = safeObject(r.envelope.metadata).tags;
      return Array.isArray(tags) && (tags as unknown[]).some((t) => want.has(String(t).toLowerCase()));
    });
  }
  return records;
}

/** Hard remove — used ONLY by identity convergence (temp-id → canonical id).
 *  User-facing deletion is soft (softDeleteLibraryAsset). */
export async function libraryRemoveAsset(input: { companyId: string; assetId: string }): Promise<boolean> {
  const result = await deleteCreatorAssetRecord({ assetId: input.assetId, companyId: input.companyId });
  return result.deletedAsset;
}

export async function archiveLibraryAsset(input: {
  companyId: string;
  assetId: string;
  archived: boolean;
}): Promise<boolean> {
  const { data, error } = await ownedDbTable('creator_assets')
    .update({ archived_at: input.archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq('id', input.assetId)
    .eq('company_id', input.companyId)
    .select('id');
  if (error) throw new Error(`Failed to ${input.archived ? 'archive' : 'unarchive'} asset: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

export async function softDeleteLibraryAsset(input: {
  companyId: string;
  assetId: string;
}): Promise<boolean> {
  const { data, error } = await ownedDbTable('creator_assets')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', input.assetId)
    .eq('company_id', input.companyId)
    .select('id');
  if (error) throw new Error(`Failed to delete asset: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

export async function recordLibraryAssetUsage(input: {
  companyId: string;
  assetId: string;
}): Promise<void> {
  // Read-then-write increment; usage is a coarse indicator, races are fine.
  const { data } = await ownedDbTable('creator_assets')
    .select('usage_count')
    .eq('id', input.assetId)
    .eq('company_id', input.companyId)
    .maybeSingle();
  if (!data) return;
  await ownedDbTable('creator_assets')
    .update({
      usage_count: Number((data as { usage_count?: number }).usage_count ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', input.assetId)
    .eq('company_id', input.companyId);
}
