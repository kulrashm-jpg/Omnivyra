import {
  getDefaultBlogTemplatesRegistry,
  instantiateBlogDefaultTemplate,
  type DefaultTemplate,
} from './defaultBlockTemplates';
import type { ContentBlock } from './blockTypes';

export type BlogTemplate = DefaultTemplate;

export function getDefaultBlogTemplates(): BlogTemplate[] {
  return getDefaultBlogTemplatesRegistry();
}

export function instantiateBlogTemplate(
  template: BlogTemplate,
  targetWords?: number,
): ContentBlock[] {
  return instantiateBlogDefaultTemplate(template, targetWords);
}
