import {
  getRecommendedTemplateDescriptors,
  getSystemTemplateDescriptors,
  type ManagedContentType,
  type SystemTemplateDescriptor,
} from './contentTemplateRegistry';

export interface ContentTemplateCard {
  id: string;
  title: string;
  description: string;
  contentType: ManagedContentType;
  formatType?: string;
  executionStrategy: SystemTemplateDescriptor['executionStrategy'];
  source: SystemTemplateDescriptor['source'];
  recommendedFor: string[];
  isRecommended: boolean;
}

function descriptorToCard(descriptor: SystemTemplateDescriptor, isRecommended: boolean): ContentTemplateCard {
  return {
    id: `${descriptor.contentType}:${descriptor.name.toLowerCase().replace(/\s+/g, '-')}`,
    title: descriptor.name,
    description: descriptor.description,
    contentType: descriptor.contentType,
    formatType: descriptor.formatType,
    executionStrategy: descriptor.executionStrategy,
    source: descriptor.source,
    recommendedFor: descriptor.recommendedFor ?? [],
    isRecommended,
  };
}

export function getTemplateCards(contentType: ManagedContentType): ContentTemplateCard[] {
  return getSystemTemplateDescriptors(contentType).map((descriptor) =>
    descriptorToCard(descriptor, false),
  );
}

export function getRecommendedTemplateCards(contentType: ManagedContentType): ContentTemplateCard[] {
  return getRecommendedTemplateDescriptors(contentType).map((descriptor) =>
    descriptorToCard(descriptor, true),
  );
}
