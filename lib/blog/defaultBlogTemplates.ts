import {
  getDefaultTemplates,
  instantiateTemplate,
  type DefaultTemplate,
} from './defaultBlockTemplates';
import type { ContentBlock } from './blockTypes';

export type BlogTemplate = DefaultTemplate;

export function getDefaultBlogTemplates(): BlogTemplate[] {
  return getDefaultTemplates('blog').filter((template) => template.content_type === 'blog');
}

export function instantiateBlogTemplate(
  template: BlogTemplate,
  targetWords?: number,
): ContentBlock[] {
  return instantiateTemplate(template, targetWords);
}
