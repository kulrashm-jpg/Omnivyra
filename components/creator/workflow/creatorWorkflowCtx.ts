/**
 * CreatorWorkflowCtx — the typed contract between the creator type-workflow page
 * (pages/command-center/creator-content/[type].tsx) and its two extracted render
 * columns (CreatorFormColumn / CreatorResultsColumn).
 *
 * The page owns ALL state, effects and handlers; it builds this object once per
 * render and passes it to both columns. The columns destructure what they use —
 * their JSX moved out VERBATIM, so behavior (including re-render scope, which was
 * always whole-page) is unchanged.
 */
import type React from 'react';
import type { NextRouter } from 'next/router';
import type { WriterOverlayText, WriterCreatorSourcePayload } from '../../../lib/content/writerCreatorAssetLaunch';
import type { AttachmentMode, AssetCompositionIntent } from '../../../lib/content/writerCreatorAttachmentContracts';
import type { CreatorTemplate } from '../../../lib/creator-templates';
import type { TemplateFieldValues } from '../../../lib/creator-templates/values';
import type { TemplateAiAssistContext } from '../TemplateFieldsPanel';
import type { VariantExecutionResult, VariantFamily } from '../../variant-experience/useVariantApi';
import type {
  CreatorTypeId,
  WorkflowConfig,
  CreatorBrandMode,
  BrandPresence,
  BrandContextSelections,
  SavedCreatorAsset,
  SavedBlockReference,
  SuggestionOption,
  CreatorResult,
} from '../../../lib/creator-content/creatorTypeWorkflow';
import type {
  buildOverlayFieldSuggestions,
  buildFreeformFieldSuggestions,
} from '../../../lib/creator-content/creatorTypeWorkflow';

export interface CreatorWorkflowCtx {
  /* ── routing / identity ── */
  router: NextRouter;
  type: CreatorTypeId | null;
  /** Narrowed non-null by the page's `if (!config) return` guard before render. */
  config: WorkflowConfig;
  selectedCompanyId: string | null | undefined;

  /* ── intake state ── */
  answers: Record<string, string>;
  setAnswer: (id: string, value: string) => void;
  topicFieldRef: React.MutableRefObject<HTMLDivElement | null>;
  topicMissing: boolean;
  availablePlatforms: string[];
  connectedPlatforms: string[] | null;
  selectedPlatform: string;
  setSelectedPlatform: React.Dispatch<React.SetStateAction<string>>;
  freeformFieldSuggestions: ReturnType<typeof buildFreeformFieldSuggestions>;

  /* ── overlay text ── */
  overlayText: WriterOverlayText;
  setOverlayField: (id: keyof WriterOverlayText, value: string) => void;
  overlayFieldSuggestions: ReturnType<typeof buildOverlayFieldSuggestions>;
  handleOverlayAi: (fieldId: keyof WriterOverlayText, action?: 'generate' | 'rewrite') => Promise<void>;

  /* ── template foundation ── */
  activeTemplate: CreatorTemplate | null;
  templateValues: TemplateFieldValues;
  handleEditorChange: (next: TemplateFieldValues) => void;
  handleTemplateAiAssist: (ctx: TemplateAiAssistContext) => Promise<void>;
  aiBusyKey: string | null;
  generatedSnapshot: TemplateFieldValues | null;

  /* ── writer attachment ── */
  writerSource: WriterCreatorSourcePayload | null;
  writerCompositionIntent: AssetCompositionIntent | null;
  writerAttachmentMode: AttachmentMode | null;
  writerSupportingVisual: boolean;
  writerEmbeddedCopy: boolean;
  standaloneAttachmentMode: AttachmentMode;
  setStandaloneAttachmentMode: React.Dispatch<React.SetStateAction<AttachmentMode>>;
  recommendedAttachmentMode: AttachmentMode | null;
  attachmentSessionTokenRef: React.MutableRefObject<string>;

  /* ── brand context ── */
  brandMode: CreatorBrandMode;
  setBrandMode: React.Dispatch<React.SetStateAction<CreatorBrandMode>>;
  brandPresence: BrandPresence;
  setBrandPresence: React.Dispatch<React.SetStateAction<BrandPresence>>;
  brandSelections: BrandContextSelections;
  setBrandSelection: (id: keyof BrandContextSelections, value: boolean) => void;
  brandProfile: import('../../../lib/creator-content/creatorTypeWorkflow').CreatorBrandProfile | null;
  brandOverrides: Record<string, string>;
  setBrandOverride: (id: string, value: string) => void;
  brandPanelOpen: boolean;
  setBrandPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  hasBrandProfile: boolean;
  isLoadingBrandProfile: boolean;

  /* ── saved assets ── */
  savedAssets: SavedCreatorAsset[];
  selectedAsset: SavedCreatorAsset | null;
  selectedAssetId: string | null;
  setSelectedAssetId: React.Dispatch<React.SetStateAction<string | null>>;
  isLoadingAssets: boolean;
  handleUseExistingAsset: (asset: SavedCreatorAsset) => void;

  /* ── suggestions / refine ── */
  suggestionOptions: SuggestionOption[];
  selectedSuggestionId: string;
  setSelectedSuggestionId: React.Dispatch<React.SetStateAction<string>>;
  refinePrompt: string;
  setRefinePrompt: React.Dispatch<React.SetStateAction<string>>;
  refinedSuggestion: string | null;
  setRefinedSuggestion: React.Dispatch<React.SetStateAction<string | null>>;
  handleRefineSuggestion: () => void;
  proposalLine: string;

  /* ── generation lifecycle ── */
  isGenerating: boolean;
  generationStage: number;
  generationModeLabel: string;
  showProgress: boolean;
  generationInFlightRef: React.MutableRefObject<boolean>;
  handleGenerate: () => Promise<void>;
  buildGenerationBody: (variantPinOverride: VariantFamily | null) => Record<string, unknown> | null;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  notice: string | null;
  setNotice: React.Dispatch<React.SetStateAction<string | null>>;
  regenCount: number;
  renderJobProgress: {
    percent: number;
    status: 'queued' | 'active' | 'completed' | 'failed' | 'cancelled' | 'dead_letter' | 'waiting';
    attempts: number;
    queuedSeconds: number;
  } | null;
  inlineRenderInFlight: boolean;
  inlineRenderError: string | null;
  handleRenderInline: () => Promise<void>;

  /* ── variant experience ── */
  variantPin: VariantFamily | null;
  setVariantPin: React.Dispatch<React.SetStateAction<VariantFamily | null>>;
  variantPlan: VariantExecutionResult | null;
  setVariantPlan: React.Dispatch<React.SetStateAction<VariantExecutionResult | null>>;
  variantFanOutInFlight: boolean;
  setVariantFanOutInFlight: React.Dispatch<React.SetStateAction<boolean>>;
  variantFanOutSummary: string | null;
  setVariantFanOutSummary: React.Dispatch<React.SetStateAction<string | null>>;

  /* ── result + preview ── */
  result: CreatorResult | null;
  resultPanelRef: React.MutableRefObject<HTMLDivElement | null>;
  mediaUrls: string[];
  slides: Array<Record<string, unknown>>;
  socialActionLabel: string;
  previewKind: string;
  previewAspectRatio: string;
  isDirectionCardPreview: boolean;
  isProviderImagePreview: boolean;
  isThemeTreatment: boolean;
  overlayQuality: { score?: number; flags?: string[]; preset?: string } | null;
  creatorQuality: { cleanliness?: number; readability?: number; clutterRisk?: number; warnings?: string[] } | null;
  visualGovernanceWarnings: string[];
  documentUrl: string;
  documentFallbackReason: string;
  pdfDocumentStatus: string;
  conditionReferenceFallbackCategory: string;
  conditionReferenceStatus: string;
  conditionReferenceUserMessage: string;
  pdfDocumentFallbackCategory: string;
  pdfDocumentUserMessage: string;
  pdfPreviewPagesAvailable: number;
  themeHookScene: Record<string, unknown>;
  themeCtaScene: Record<string, unknown>;
  themeScenes: Array<Record<string, unknown>>;
  themePlatformNotes: Record<string, unknown>;
  themeDurationSeconds: number;
  themeAspectRatio: string;

  /* ── result actions ── */
  actionInProgress: string | null;
  isSavingBlock: boolean;
  savedBlock: SavedBlockReference | null;
  handleOpenScheduler: (intent?: 'schedule' | 'publish') => void;
  handleSaveAsBlock: () => Promise<void>;
  handleDownloadBrief: () => Promise<void>;
}
