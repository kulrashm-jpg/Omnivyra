import type { GovernedAssetType, AssetGovernanceProfile, PlatformVisualProfile } from './creatorAssetGovernance';

export type CreatorRendererRegistration = {
  assetType: GovernedAssetType;
  rendererId: string;
  rendererVersion: string;
  templateIds: string[];
};

const rendererRegistry = new Map<GovernedAssetType, CreatorRendererRegistration>();
const governanceRegistry = new Map<GovernedAssetType, AssetGovernanceProfile>();
const platformRegistry = new Map<string, PlatformVisualProfile>();

export function registerCreatorRenderer(registration: CreatorRendererRegistration): void {
  rendererRegistry.set(registration.assetType, registration);
}

export function getCreatorRendererRegistration(assetType: GovernedAssetType): CreatorRendererRegistration {
  const registration = rendererRegistry.get(assetType);
  if (!registration) throw new Error(`creator_renderer_not_registered:${assetType}`);
  return registration;
}

export function registerGovernanceProfile(assetType: GovernedAssetType, profile: AssetGovernanceProfile): void {
  governanceRegistry.set(assetType, profile);
}

export function getRegisteredGovernanceProfile(assetType: GovernedAssetType): AssetGovernanceProfile | null {
  return governanceRegistry.get(assetType) ?? null;
}

export function registerPlatformProfile(platform: string, profile: PlatformVisualProfile): void {
  platformRegistry.set(platform.toLowerCase(), profile);
}

export function getRegisteredPlatformProfile(platform: string): PlatformVisualProfile | null {
  return platformRegistry.get(platform.toLowerCase()) ?? null;
}

export function listRegisteredCreatorRenderers(): CreatorRendererRegistration[] {
  return Array.from(rendererRegistry.values());
}

export function bootstrapCreatorRendererRegistry(): void {
  const registrations: CreatorRendererRegistration[] = [
    { assetType: 'supporting_image', rendererId: 'supporting-image-renderer', rendererVersion: 'enterprise-renderer-v1', templateIds: ['supporting-image-editorial-v1'] },
    { assetType: 'banner', rendererId: 'banner-renderer', rendererVersion: 'enterprise-renderer-v1', templateIds: ['banner-hierarchy-v1'] },
    { assetType: 'infographic', rendererId: 'infographic-renderer', rendererVersion: 'enterprise-renderer-v1', templateIds: ['infographic-stats-v1', 'infographic-timeline-v1', 'infographic-comparison-v1', 'infographic-process-v1', 'infographic-framework-v1', 'infographic-hierarchy-v1'] },
    { assetType: 'carousel', rendererId: 'carousel-renderer', rendererVersion: 'enterprise-renderer-v1', templateIds: ['carousel-native-v1'] },
    { assetType: 'brand_card', rendererId: 'brand-card-renderer', rendererVersion: 'enterprise-renderer-v1', templateIds: ['brand-card-quote-v1'] },
    { assetType: 'pdf', rendererId: 'pdf-renderer', rendererVersion: 'enterprise-renderer-v1', templateIds: ['pdf-brief-v1'] },
    { assetType: 'slider', rendererId: 'slider-renderer', rendererVersion: 'enterprise-renderer-v1', templateIds: ['slider-deck-v1'] },
  ];
  for (const registration of registrations) registerCreatorRenderer(registration);
}

bootstrapCreatorRendererRegistry();
