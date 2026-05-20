import type { IntegrationType } from '../integrationService';
import type { CmsAdapter, CmsProvider } from './types';
import { CustomBlogApiAdapter } from './CustomBlogApiAdapter';
import { WordPressAdapter } from './WordPressAdapter';
import { GhostAdapter } from './GhostAdapter';
import { DrupalAdapter } from './DrupalAdapter';
import { JoomlaAdapter } from './JoomlaAdapter';
import { WebflowAdapter } from './WebflowAdapter';
import { ShopifyAdapter } from './ShopifyAdapter';
import { HubSpotCmsAdapter } from './HubSpotCmsAdapter';
import { WixCmsAdapter } from './WixCmsAdapter';
import { SquarespaceAdapter } from './SquarespaceAdapter';
import { getProviderCapabilities } from './cmsEnvironmentFramework';

const adapters: Record<CmsProvider, CmsAdapter> = {
  wordpress: new WordPressAdapter(),
  custom_blog_api: new CustomBlogApiAdapter(),
  ghost: new GhostAdapter(),
  drupal: new DrupalAdapter(),
  joomla: new JoomlaAdapter(),
  webflow: new WebflowAdapter(),
  shopify: new ShopifyAdapter(),
  hubspot: new HubSpotCmsAdapter(),
  wix: new WixCmsAdapter(),
  squarespace: new SquarespaceAdapter(),
};

const ALL_CMS_PROVIDERS = Object.keys(adapters) as CmsProvider[];

/**
 * Provider-specific feature flag. A provider can be disabled at runtime via
 * `CMS_DISABLED_PROVIDERS` (comma-separated) without code changes — WordPress
 * cannot be disabled (core, no-regression guarantee).
 */
function isProviderEnabled(provider: CmsProvider): boolean {
  if (provider === 'wordpress') return true;
  const disabled = String(process.env.CMS_DISABLED_PROVIDERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !disabled.includes(provider);
}

export function isCmsProvider(provider: IntegrationType | string): provider is CmsProvider {
  return (ALL_CMS_PROVIDERS as string[]).includes(provider);
}

export function getCmsAdapter(provider: IntegrationType | string): CmsAdapter {
  if (!isCmsProvider(provider)) {
    throw new Error(`Unsupported CMS provider: ${provider}`);
  }
  if (!isProviderEnabled(provider)) {
    throw new Error(`CMS provider "${provider}" is currently disabled`);
  }
  return adapters[provider];
}

export function listCmsProviders(): CmsProvider[] {
  return ALL_CMS_PROVIDERS.filter(isProviderEnabled);
}

/** Capability + diagnostics linkage for the registry (UI / normalization). */
export function describeCmsProvider(provider: CmsProvider) {
  const caps = getProviderCapabilities(provider);
  return {
    provider,
    enabled: isProviderEnabled(provider),
    label: caps.label,
    authType: caps.authType,
    apiDiscoveryMode: caps.apiDiscoveryMode,
    webhookSupport: caps.webhookSupport,
    localDevSupport: caps.localDevSupport,
  };
}
