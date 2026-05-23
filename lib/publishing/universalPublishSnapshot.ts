// Universal Publish Snapshot Layer
//
// Freezes a long-form content state into an immutable, hash-addressed publish
// snapshot. Every publish destination (WordPress, Ghost, Webflow, Shopify,
// HubSpot, custom website, headless CMS, internal API) publishes from the SAME
// governed snapshot.
//
// Snapshots are immutable after creation (deep-frozen) and carry a deterministic
// `publishVersionHash`. This module is non-executing: it produces a frozen
// source-of-truth only — it does not publish, schedule, or mutate anything.

import { createHash } from 'crypto';

export type UniversalPublishSnapshotVersion = 'universal-publish-snapshot-v1';
export type PublishIntent = 'publish_now' | 'schedule' | 'cms_draft';

export interface PublishSeoMetadata {
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
}

export interface PublishCanonicalFields {
  canonicalUrl: string;
  slugLocked: boolean;
}

export interface PublishMediaReference {
  ref: string;
  role: string;
  alt: string;
}

export interface PublishMediaReferences {
  featuredImageUrl: string;
  media: readonly PublishMediaReference[];
}

export interface PublishTaxonomy {
  category: string;
  tags: readonly string[];
}

export interface PublishAuthorAttribution {
  authorId: string;
  authorName: string;
}

export interface PublishCompanyContext {
  companyId: string;
  websiteId: string;
  integrationId: string;
}

export interface PublishTargetMetadata {
  publishTargetType: string;
  externalId: string;
}

export interface UniversalPublishSnapshotInput {
  renderedHtml: string;
  contentBlocks: readonly unknown[];
  seoMetadata: PublishSeoMetadata;
  slug: string;
  canonicalFields: PublishCanonicalFields;
  mediaReferences: PublishMediaReferences;
  taxonomy: PublishTaxonomy;
  authorAttribution: PublishAuthorAttribution;
  companyContext: PublishCompanyContext;
  contentType: string;
  generationMetadata: Record<string, unknown>;
  publishTargetMetadata: PublishTargetMetadata;
  scheduledTimestamp: string | null;
  publishIntent: PublishIntent;
}

export interface UniversalPublishSnapshot extends UniversalPublishSnapshotInput {
  version: UniversalPublishSnapshotVersion;
  snapshotId: string;
  generatedAt: string;
  publishVersionHash: string;
  immutable: true;
}

// ── Deterministic hashing helpers (shared across the publishing layer) ────────

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      output[key] = canonicalize(source[key]);
    }
    return output;
  }
  return value;
}

export function stablePublishStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function publishSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function snapshotContentPayload(source: UniversalPublishSnapshotInput): Record<string, unknown> {
  return {
    renderedHtml: source.renderedHtml,
    contentBlocks: source.contentBlocks,
    seoMetadata: source.seoMetadata,
    slug: source.slug,
    canonicalFields: source.canonicalFields,
    mediaReferences: source.mediaReferences,
    taxonomy: source.taxonomy,
    authorAttribution: source.authorAttribution,
    companyContext: source.companyContext,
    contentType: source.contentType,
    generationMetadata: source.generationMetadata,
    publishTargetMetadata: source.publishTargetMetadata,
    scheduledTimestamp: source.scheduledTimestamp,
    publishIntent: source.publishIntent,
  };
}

// Deterministic content hash — identical content always yields the same hash.
export function computeSnapshotHash(source: UniversalPublishSnapshotInput): string {
  return publishSha256(stablePublishStringify(snapshotContentPayload(source)));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

// ── Snapshot creation ─────────────────────────────────────────────────────────

export function createUniversalPublishSnapshot(
  input: UniversalPublishSnapshotInput,
): UniversalPublishSnapshot {
  const publishVersionHash = computeSnapshotHash(input);
  const snapshot: UniversalPublishSnapshot = {
    version: 'universal-publish-snapshot-v1',
    snapshotId: `snap_${publishVersionHash.slice(0, 24)}`,
    generatedAt: new Date(0).toISOString(),
    renderedHtml: input.renderedHtml,
    contentBlocks: input.contentBlocks,
    seoMetadata: input.seoMetadata,
    slug: input.slug,
    canonicalFields: input.canonicalFields,
    mediaReferences: input.mediaReferences,
    taxonomy: input.taxonomy,
    authorAttribution: input.authorAttribution,
    companyContext: input.companyContext,
    contentType: input.contentType,
    generationMetadata: input.generationMetadata,
    publishTargetMetadata: input.publishTargetMetadata,
    scheduledTimestamp: input.scheduledTimestamp,
    publishIntent: input.publishIntent,
    publishVersionHash,
    immutable: true,
  };
  return deepFreeze(snapshot);
}

export function serializeUniversalPublishSnapshot(snapshot: UniversalPublishSnapshot): string {
  return [
    '## UNIVERSAL PUBLISH SNAPSHOT',
    `Version: ${snapshot.version}`,
    `Snapshot id: ${snapshot.snapshotId}`,
    `Publish version hash: ${snapshot.publishVersionHash}`,
    `Content type: ${snapshot.contentType}`,
    `Slug: ${snapshot.slug}`,
    `Publish intent: ${snapshot.publishIntent}`,
    `Scheduled timestamp: ${snapshot.scheduledTimestamp ?? 'none'}`,
    `Company: ${snapshot.companyContext.companyId} / website ${snapshot.companyContext.websiteId}`,
    `Immutable: ${snapshot.immutable}`,
  ].join('\n');
}
