export type ContentGenerationIntent = {
  organizationId: string;
  companyId: string;
  campaignId?: string;
  contentBlockId: string;
  topic: string;
  platform: string;
  contentType: string;
  brief?: Record<string, unknown>;
};

export type MasterContent = {
  id?: string;
  contentBlockId: string;
  title: string;
  body: string;
  fingerprint: string;
};

export type PlatformContentVariant = {
  id?: string;
  masterContentFingerprint: string;
  platform: string;
  contentType: string;
  body: string;
  fingerprint: string;
};

export type ContentGenerationResult = {
  master: MasterContent;
  variants: PlatformContentVariant[];
  deduped: boolean;
};

export interface ContentGenerationPipelineContract {
  generate(intent: ContentGenerationIntent): Promise<ContentGenerationResult>;
}
