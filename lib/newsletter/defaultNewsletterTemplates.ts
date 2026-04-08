import {
  NEWSLETTER_DEFAULT_TEMPLATES,
  type NewsletterTemplateDefinition,
} from './newsletterTemplateDefinitions';
import type { ContentBlock } from '../content/blockTypes';

export type NewsletterTemplate = NewsletterTemplateDefinition;

export function getDefaultNewsletterTemplates(): NewsletterTemplate[] {
  return NEWSLETTER_DEFAULT_TEMPLATES;
}

export function instantiateNewsletterTemplate(
  template: NewsletterTemplate,
  targetWords?: number,
): ContentBlock[] {
  return template.blocks(targetWords);
}
