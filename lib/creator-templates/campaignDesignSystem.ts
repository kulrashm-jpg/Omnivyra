/**
 * Campaign Design Systems — pure logic (no DB, no fetch).
 *
 * A Campaign adopts ONE Template Collection as its design system. The
 * association is VERSION-AWARE: the campaign pins the collection's version AND a
 * frozen snapshot of it at attach time, so the campaign's visual system never
 * shifts when the collection evolves. Upgrading re-pins to the latest version.
 *
 * This module REUSES the collection model (validation + recommendation) — it
 * never duplicates the template or collection model and owns no rendering path.
 */

import type { CreatorTemplate, TemplateAssetFamily } from './types';
import {
  type TemplateCollection,
  type TemplateResolver,
  validateCollection,
  recommendTemplateForFamily,
  collectionFamilies,
} from './collection';
import { blueprintCoverage, type BlueprintCoverage } from './storyBlueprint';

const ALL_FAMILIES: TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];

function clone<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
}

export interface CampaignDesignSystem {
  campaignId: string;
  collectionId: string;
  /** The collection version this campaign is pinned to. */
  pinnedVersion: number;
  /** Frozen collection at pin time — the campaign's canonical visual system. */
  pinnedSnapshot: TemplateCollection;
  /** Asset families this campaign requires the collection to cover. */
  requiredFamilies: TemplateAssetFamily[];
  status: 'active' | 'detached';
  attachedAt?: string;
  updatedAt?: string;
}

/* ── Attach (with reused validation) ───────────────────────────────────── */

export interface AttachValidation {
  ok: boolean;
  errors: string[];
  missingFamilies: TemplateAssetFamily[];
}

/**
 * Gate attachment: the collection must pass collection validation (references
 * exist, compatible families, no duplicates) AND cover all required families.
 */
export function canAttachCollection(
  collection: TemplateCollection,
  resolve: TemplateResolver,
  requiredFamilies: TemplateAssetFamily[] = [],
): AttachValidation {
  const validation = validateCollection(collection, resolve);
  const present = new Set(collectionFamilies(collection, resolve));
  const missingFamilies = requiredFamilies.filter((f) => !present.has(f));
  const errors = [...validation.errors];
  if (missingFamilies.length) errors.push(`Collection is missing required asset families: ${missingFamilies.join(', ')}.`);
  return { ok: errors.length === 0, errors, missingFamilies };
}

/** Attach a collection to a campaign — pins version + frozen snapshot. */
export function attachCollection(input: {
  campaignId: string;
  collection: TemplateCollection;
  requiredFamilies?: TemplateAssetFamily[];
  now?: string;
}): CampaignDesignSystem {
  return {
    campaignId: input.campaignId,
    collectionId: input.collection.id,
    pinnedVersion: input.collection.version,
    pinnedSnapshot: clone(input.collection),
    requiredFamilies: input.requiredFamilies ?? [],
    status: 'active',
    attachedAt: input.now,
    updatedAt: input.now,
  };
}

/* ── Creator integration: recommend from the PINNED snapshot ────────────── */

/**
 * Recommend the campaign's template for a chosen asset family — resolved from
 * the PINNED snapshot (not the live collection), so generation is version-stable.
 * Returns null when the pinned collection has no member for that family (the
 * caller then preserves a manual override / blank selection).
 */
export function resolveCampaignTemplate(
  ds: CampaignDesignSystem,
  family: TemplateAssetFamily,
  resolve: TemplateResolver,
): CreatorTemplate | null {
  if (ds.status !== 'active') return null;
  return recommendTemplateForFamily(ds.pinnedSnapshot, family, resolve);
}

/* ── Dashboard: health ─────────────────────────────────────────────────── */

export interface CampaignDesignHealth {
  ok: boolean;
  /** All referenced templates in the pinned snapshot resolve + validate. */
  collectionValid: boolean;
  errors: string[];
  brokenRefs: string[];
  presentFamilies: TemplateAssetFamily[];
  /** Required families not covered by the pinned collection. */
  missingFamilies: TemplateAssetFamily[];
  /** Story Blueprint (communication-pattern) coverage — guidance only. */
  storyBlueprintCoverage: BlueprintCoverage;
  pinnedVersion: number;
}

export function campaignDesignHealth(ds: CampaignDesignSystem, resolve: TemplateResolver): CampaignDesignHealth {
  const validation = validateCollection(ds.pinnedSnapshot, resolve);
  const present = collectionFamilies(ds.pinnedSnapshot, resolve);
  const presentSet = new Set(present);
  const missingFamilies = ds.requiredFamilies.filter((f) => !presentSet.has(f));
  const members = ds.pinnedSnapshot.templateIds.map(resolve).filter((t): t is CreatorTemplate => t !== null);
  return {
    ok: validation.ok && missingFamilies.length === 0,
    collectionValid: validation.ok,
    errors: validation.errors,
    brokenRefs: validation.missing,
    presentFamilies: present,
    missingFamilies,
    storyBlueprintCoverage: blueprintCoverage(members),
    pinnedVersion: ds.pinnedVersion,
  };
}

/* ── Evolution: deterministic version comparison + upgrade ──────────────── */

export interface CollectionVersionDiff {
  fromVersion: number;
  toVersion: number;
  upgradeAvailable: boolean;
  addedTemplateIds: string[];
  removedTemplateIds: string[];
  reordered: boolean;
  coverChanged: boolean;
  addedFamilies: TemplateAssetFamily[];
  removedFamilies: TemplateAssetFamily[];
}

/**
 * Deterministic diff between the pinned snapshot and the latest collection.
 * Same inputs always yield the same diff (sorted outputs).
 */
export function compareCollectionVersions(
  pinned: TemplateCollection,
  latest: TemplateCollection,
  resolve: TemplateResolver,
): CollectionVersionDiff {
  const pinnedIds = pinned.templateIds;
  const latestIds = latest.templateIds;
  const pinnedSet = new Set(pinnedIds);
  const latestSet = new Set(latestIds);

  const added = latestIds.filter((id) => !pinnedSet.has(id)).sort();
  const removed = pinnedIds.filter((id) => !latestSet.has(id)).sort();
  // Reordered = same membership, different order.
  const sameMembership = added.length === 0 && removed.length === 0;
  const reordered = sameMembership && pinnedIds.join(',') !== latestIds.join(',');

  const pinnedFams = new Set(collectionFamilies(pinned, resolve));
  const latestFams = new Set(collectionFamilies(latest, resolve));
  const addedFamilies = ALL_FAMILIES.filter((f) => latestFams.has(f) && !pinnedFams.has(f));
  const removedFamilies = ALL_FAMILIES.filter((f) => pinnedFams.has(f) && !latestFams.has(f));

  return {
    fromVersion: pinned.version,
    toVersion: latest.version,
    upgradeAvailable: latest.version > pinned.version,
    addedTemplateIds: added,
    removedTemplateIds: removed,
    reordered,
    coverChanged: pinned.preview.coverTemplateId !== latest.preview.coverTemplateId,
    addedFamilies,
    removedFamilies,
  };
}

/** Re-pin the campaign to the latest collection version (replaces the snapshot). */
export function upgradeCampaign(ds: CampaignDesignSystem, latest: TemplateCollection, now?: string): CampaignDesignSystem {
  return {
    ...ds,
    collectionId: latest.id,
    pinnedVersion: latest.version,
    pinnedSnapshot: clone(latest),
    updatedAt: now,
  };
}
