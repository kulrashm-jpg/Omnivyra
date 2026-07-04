import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import { supabase } from '../db/supabaseClient';
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

function buildStorageReferences(input: {
  url?: string | null;
  files?: string[];
  metadata?: Record<string, unknown>;
  companyId: string;
  userId: string;
}): CreatorAssetIntegrityReport['storageReferences'] {
  const metadata = safeObject(input.metadata);
  const urls = [
    input.url,
    ...normalizeFiles(input.files),
    typeof metadata.document_url === 'string' ? metadata.document_url : null,
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(urls)).map((url) => {
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

  const { data, error } = await ownedDbTable('creator_assets')
    .delete()
    .eq('id', input.assetId)
    .eq('company_id', input.companyId)
    .select('id');
  if (error) throw new Error(`Failed to delete creator asset: ${error.message}`);
  return {
    deletedAsset: Array.isArray(data) && data.length > 0,
    deletedAttachments,
  };
}
