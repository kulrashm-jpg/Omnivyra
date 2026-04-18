import type { ManagedContentType, ExecutionStrategy } from './contentTemplateRegistry';

export interface ContentArchitectureSnapshot {
  contentType: ManagedContentType;
  hasDedicatedDispatcher: boolean;
  hasTemplateCatalog: boolean;
  hasPromotedTemplateRunners: boolean;
  supportsCustomTemplates: boolean;
  defaultExecutionStrategy: ExecutionStrategy;
}

export function getContentArchitectureSnapshot(
  contentType: ManagedContentType,
): ContentArchitectureSnapshot {
  switch (contentType) {
    case 'newsletter':
      return {
        contentType,
        hasDedicatedDispatcher: true,
        hasTemplateCatalog: true,
        hasPromotedTemplateRunners: true,
        supportsCustomTemplates: true,
        defaultExecutionStrategy: 'shared-template-runner',
      };
    case 'blog':
      return {
        contentType,
        hasDedicatedDispatcher: true,
        hasTemplateCatalog: true,
        hasPromotedTemplateRunners: true,
        supportsCustomTemplates: true,
        defaultExecutionStrategy: 'shared-template-runner',
      };
    case 'article':
    case 'guide':
    case 'story':
    case 'whitepaper':
      return {
        contentType,
        hasDedicatedDispatcher: true,
        hasTemplateCatalog: true,
        hasPromotedTemplateRunners: false,
        supportsCustomTemplates: true,
        defaultExecutionStrategy: 'shared-content-runner',
      };
    case 'post':
    case 'thread':
      return {
        contentType,
        hasDedicatedDispatcher: true,
        hasTemplateCatalog: true,
        hasPromotedTemplateRunners: false,
        supportsCustomTemplates: false,
        defaultExecutionStrategy: 'short-form-platform-runner',
      };
    case 'case-study':
      return {
        contentType,
        hasDedicatedDispatcher: true,
        hasTemplateCatalog: true,
        hasPromotedTemplateRunners: false,
        supportsCustomTemplates: false,
        defaultExecutionStrategy: 'shared-content-runner',
      };
  }
}
