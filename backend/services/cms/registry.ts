import type { IntegrationType } from '../integrationService';
import type { CmsAdapter, CmsProvider } from './types';
import { CustomBlogApiAdapter } from './CustomBlogApiAdapter';
import { WordPressAdapter } from './WordPressAdapter';

const adapters: Record<CmsProvider, CmsAdapter> = {
  wordpress: new WordPressAdapter(),
  custom_blog_api: new CustomBlogApiAdapter(),
};

export function isCmsProvider(provider: IntegrationType | string): provider is CmsProvider {
  return provider === 'wordpress' || provider === 'custom_blog_api';
}

export function getCmsAdapter(provider: IntegrationType | string): CmsAdapter {
  if (!isCmsProvider(provider)) {
    throw new Error(`Unsupported CMS provider: ${provider}`);
  }
  return adapters[provider];
}

export function listCmsProviders(): CmsProvider[] {
  return Object.keys(adapters) as CmsProvider[];
}
