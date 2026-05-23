// Multi-Platform Publishing Preparation
//
// Advisory, contract-only capability matrix describing how publish targets
// differ in supported publish modes, metadata, media, scheduling, and
// reconciliation. No execution — this informs future multi-destination
// publishing without performing it.

import type { PublishMode, PublishTargetType } from './universalPublishingContract';

export type PublishMediaCapability = 'none' | 'featured_only' | 'full';
export type PublishSchedulingCapability = 'none' | 'native' | 'queue_emulated';
export type PublishReconciliationCapability = 'none' | 'webhook' | 'polling' | 'webhook_and_polling';

export interface PublishTargetCapability {
  targetType: PublishTargetType;
  supportedPublishModes: readonly PublishMode[];
  supportedMetadata: readonly string[];
  mediaCapability: PublishMediaCapability;
  schedulingCapability: PublishSchedulingCapability;
  reconciliationCapability: PublishReconciliationCapability;
}

const ALL_MODES: readonly PublishMode[] = ['publish_now', 'schedule', 'cms_draft'];
const NO_SCHEDULE: readonly PublishMode[] = ['publish_now', 'cms_draft'];

const RICH_METADATA = [
  'title',
  'slug',
  'excerpt',
  'seo_title',
  'seo_description',
  'canonical',
  'categories',
  'tags',
  'author',
  'featured_image',
] as const;

export const PUBLISH_TARGET_TYPES: readonly PublishTargetType[] = [
  'wordpress',
  'ghost',
  'webflow',
  'shopify',
  'hubspot',
  'custom_api',
  'headless_cms',
  'generic_website',
];

export const PUBLISH_TARGET_COMPATIBILITY: Record<PublishTargetType, PublishTargetCapability> = {
  wordpress: {
    targetType: 'wordpress',
    supportedPublishModes: ALL_MODES,
    supportedMetadata: [...RICH_METADATA],
    mediaCapability: 'full',
    schedulingCapability: 'native',
    reconciliationCapability: 'webhook_and_polling',
  },
  ghost: {
    targetType: 'ghost',
    supportedPublishModes: ALL_MODES,
    supportedMetadata: ['title', 'slug', 'excerpt', 'seo_title', 'seo_description', 'canonical', 'tags', 'author', 'featured_image'],
    mediaCapability: 'full',
    schedulingCapability: 'native',
    reconciliationCapability: 'webhook',
  },
  webflow: {
    targetType: 'webflow',
    supportedPublishModes: NO_SCHEDULE,
    supportedMetadata: ['title', 'slug', 'seo_title', 'seo_description', 'categories', 'tags', 'author', 'featured_image'],
    mediaCapability: 'full',
    schedulingCapability: 'queue_emulated',
    reconciliationCapability: 'polling',
  },
  shopify: {
    targetType: 'shopify',
    supportedPublishModes: ALL_MODES,
    supportedMetadata: ['title', 'slug', 'excerpt', 'seo_title', 'seo_description', 'tags', 'author', 'featured_image'],
    mediaCapability: 'full',
    schedulingCapability: 'native',
    reconciliationCapability: 'webhook',
  },
  hubspot: {
    targetType: 'hubspot',
    supportedPublishModes: ALL_MODES,
    supportedMetadata: ['title', 'slug', 'seo_description', 'canonical', 'tags', 'author', 'featured_image'],
    mediaCapability: 'full',
    schedulingCapability: 'native',
    reconciliationCapability: 'polling',
  },
  custom_api: {
    targetType: 'custom_api',
    supportedPublishModes: ALL_MODES,
    supportedMetadata: [...RICH_METADATA],
    mediaCapability: 'full',
    schedulingCapability: 'queue_emulated',
    reconciliationCapability: 'polling',
  },
  headless_cms: {
    targetType: 'headless_cms',
    supportedPublishModes: ALL_MODES,
    supportedMetadata: ['title', 'slug', 'seo_title', 'seo_description', 'canonical', 'categories', 'tags', 'author', 'featured_image'],
    mediaCapability: 'full',
    schedulingCapability: 'queue_emulated',
    reconciliationCapability: 'webhook_and_polling',
  },
  generic_website: {
    targetType: 'generic_website',
    supportedPublishModes: NO_SCHEDULE,
    supportedMetadata: ['title', 'slug', 'seo_title', 'seo_description', 'featured_image'],
    mediaCapability: 'featured_only',
    schedulingCapability: 'queue_emulated',
    reconciliationCapability: 'none',
  },
};

export function getPublishTargetCompatibility(targetType: PublishTargetType): PublishTargetCapability {
  return PUBLISH_TARGET_COMPATIBILITY[targetType];
}

export function isPublishModeSupported(targetType: PublishTargetType, mode: PublishMode): boolean {
  return getPublishTargetCompatibility(targetType).supportedPublishModes.includes(mode);
}

export function isMetadataFieldSupported(targetType: PublishTargetType, field: string): boolean {
  return getPublishTargetCompatibility(targetType).supportedMetadata.includes(field);
}

export function serializePublishTargetCompatibility(capability: PublishTargetCapability): string {
  return [
    '## PUBLISH TARGET COMPATIBILITY',
    `Target: ${capability.targetType}`,
    `Publish modes: ${capability.supportedPublishModes.join(', ')}`,
    `Metadata: ${capability.supportedMetadata.join(', ')}`,
    `Media capability: ${capability.mediaCapability}`,
    `Scheduling capability: ${capability.schedulingCapability}`,
    `Reconciliation capability: ${capability.reconciliationCapability}`,
  ].join('\n');
}
