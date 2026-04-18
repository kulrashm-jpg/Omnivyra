import { getDefaultBlogTemplates } from '../blog/defaultBlogTemplates';
import { getDefaultNewsletterTemplates } from '../newsletter/defaultNewsletterTemplates';
import { getDefaultArticleTemplates } from '../article/defaultArticleTemplates';
import { getDefaultGuideTemplates } from '../guide/defaultGuideTemplates';
import { getDefaultStoryTemplates } from '../story/defaultStoryTemplates';
import { getDefaultWhitepaperTemplates } from '../whitepaper/defaultWhitepaperTemplates';
import { getDefaultPostTemplates } from '../post/defaultPostTemplates';
import { getDefaultThreadTemplates } from '../thread/defaultThreadTemplates';
import { getDefaultCaseStudyTemplates } from '../case-study/defaultCaseStudyTemplates';

export type ManagedContentType =
  | 'blog'
  | 'newsletter'
  | 'article'
  | 'guide'
  | 'story'
  | 'whitepaper'
  | 'post'
  | 'thread'
  | 'case-study';

export type ExecutionStrategy =
  | 'dedicated-template-runner'
  | 'shared-template-runner'
  | 'shared-content-runner'
  | 'short-form-platform-runner'
  | 'planned';

export interface SystemTemplateDescriptor {
  name: string;
  description: string;
  contentType: ManagedContentType;
  formatType?: string;
  executionStrategy: ExecutionStrategy;
  source: 'system' | 'planned';
  recommendedFor?: string[];
}

function resolveBlogExecutionStrategy(templateName: string): ExecutionStrategy {
  const normalized = templateName.trim().toLowerCase();
  if (normalized === 'classic' || normalized === 'tutorial' || normalized === 'comparison') {
    return 'dedicated-template-runner';
  }
  if (normalized === 'visual feature' || normalized === 'magazine') {
    return 'dedicated-template-runner';
  }
  return 'shared-template-runner';
}

function resolveNewsletterExecutionStrategy(templateName: string): ExecutionStrategy {
  const normalized = templateName.trim().toLowerCase();
  if (
    normalized === 'minimal thesis' ||
    normalized === 'split-screen insight' ||
    normalized === 'signal radar' ||
    normalized === 'analyst board' ||
    normalized === 'market map' ||
    normalized === 'strategy memo' ||
    normalized === 'operator playbook' ||
    normalized === 'sprint sheet'
  ) {
    return 'dedicated-template-runner';
  }
  return 'shared-template-runner';
}

export function getSystemTemplateDescriptors(contentType: ManagedContentType): SystemTemplateDescriptor[] {
  if (contentType === 'blog') {
    return getDefaultBlogTemplates().map((template) => ({
      name: template.name,
      description: template.description,
      contentType,
      formatType: template.format_type,
      executionStrategy: resolveBlogExecutionStrategy(template.name),
      source: 'system',
    }));
  }

  if (contentType === 'newsletter') {
    return getDefaultNewsletterTemplates().map((template) => ({
      name: template.name,
      description: template.description,
      contentType,
      formatType: template.format_type,
      executionStrategy: resolveNewsletterExecutionStrategy(template.name),
      source: 'system',
    }));
  }

  if (contentType === 'article') {
    return getDefaultArticleTemplates().map((template) => ({
      name: template.name,
      description: template.description,
      contentType,
      formatType: template.format_type,
      executionStrategy: 'shared-content-runner',
      source: 'system',
      recommendedFor: template.recommended_for,
    }));
  }

  if (contentType === 'guide') {
    return getDefaultGuideTemplates().map((template) => ({
      name: template.name,
      description: template.description,
      contentType,
      formatType: template.format_type,
      executionStrategy: 'shared-content-runner',
      source: 'system',
      recommendedFor: template.recommended_for,
    }));
  }

  if (contentType === 'story') {
    return getDefaultStoryTemplates().map((template) => ({
      name: template.name,
      description: template.description,
      contentType,
      formatType: template.format_type,
      executionStrategy: 'shared-content-runner',
      source: 'system',
      recommendedFor: template.recommended_for,
    }));
  }

  if (contentType === 'whitepaper') {
    return getDefaultWhitepaperTemplates().map((template) => ({
      name: template.name,
      description: template.description,
      contentType,
      formatType: template.format_type,
      executionStrategy: 'shared-content-runner',
      source: 'system',
      recommendedFor: template.recommended_for,
    }));
  }

  if (contentType === 'post') {
    return getDefaultPostTemplates().map((template) => ({
      name: template.name,
      description: template.description,
      contentType,
      formatType: template.format_type,
      executionStrategy: 'short-form-platform-runner',
      source: 'system',
      recommendedFor: template.recommended_for,
    }));
  }

  if (contentType === 'thread') {
    return getDefaultThreadTemplates().map((template) => ({
      name: template.name,
      description: template.description,
      contentType,
      formatType: template.format_type,
      executionStrategy: 'short-form-platform-runner',
      source: 'system',
      recommendedFor: template.recommended_for,
    }));
  }

  if (contentType === 'case-study') {
    return getDefaultCaseStudyTemplates().map((template) => ({
      name: template.name,
      description: template.description,
      contentType,
      formatType: template.format_type,
      executionStrategy: 'shared-content-runner',
      source: 'system',
      recommendedFor: template.recommended_for,
    }));
  }

  return [];
}

export function getRecommendedTemplateDescriptors(contentType: ManagedContentType): SystemTemplateDescriptor[] {
  return getSystemTemplateDescriptors(contentType).filter((template) => (template.recommendedFor?.length ?? 0) > 0);
}

export function getManagedContentTypes(): ManagedContentType[] {
  return [
    'blog',
    'newsletter',
    'article',
    'guide',
    'story',
    'whitepaper',
    'post',
    'thread',
    'case-study',
  ];
}
