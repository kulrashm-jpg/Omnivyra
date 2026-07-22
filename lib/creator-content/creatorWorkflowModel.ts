/**
 * Creator workflow domain model — results, saved assets, brand-context model,
 * writer-source → answers mapping, repurpose paths, suggestion options. Pure.
 * ENFORCEMENT: part of the asset-id-minting forbidden-pattern scan (creatorAssetIdFactory.test.ts).
 */
import {
  type WriterOverlayText,
  type WriterCreatorSourcePayload,
} from '../content/writerCreatorAssetLaunch';
import type { MarketingBrief } from '../content/unifiedCreationModel';
import { getCreationGoal } from '../content/unifiedCreationModel';
import type { AttachmentMode } from '../content/writerCreatorAttachmentContracts';
import type { CreatorDiagnosticReport } from '../../backend/services/creator/creatorDiagnosticReport';
import {
  type CreatorTypeId,
  type WorkflowConfig,
  type WorkflowField,
  type ChoiceOption,
  EMPTY_OVERLAY_TEXT,
  isSocialCreativeType,
  isDeterministicStructuredType,
  getStarterChips,
  deriveOverlayFromContent,
  WORKFLOW_CONFIG,
  DEFAULT_CTA_PRESETS,
} from './creatorWorkflowConfig';

export type CreatorResult = {
  success: boolean;
  primary_platform: string;
  output: {
    asset_type: string;
    asset_instruction: {
      template_id?: string | null;
      structure?: Record<string, unknown>;
    };
    asset_payload: {
      media_bundle?: {
        url?: string;
        files?: string[];
        metadata?: {
          preview_kind?: string;
          provider_model?: string;
          provider_rendered?: boolean;
          fallback_reason?: string;
          document_url?: string;
          document_fallback_reason?: string;
          /** Part 3 — PDF graceful degradation block. */
          pdf_document_status?: 'available' | 'preview_only';
          pdf_document_fallback_category?: 'storage_mime_blocked' | 'storage_permission' | 'storage_unavailable' | 'unknown_storage_error';
          pdf_document_user_message?: string;
          pdf_preview_pages_available?: number;
          width?: number;
          height?: number;
          overlay_quality?: {
            score?: number;
            flags?: string[];
            preset?: string;
          };
          creator_quality_score?: {
            cleanliness?: number;
            readability?: number;
            clutterRisk?: number;
            warnings?: string[];
          };
          visual_governance_warnings?: string[];
        };
      };
      slides?: Array<Record<string, unknown>>;
      caption_blueprint?: { hook?: string; body?: string; cta?: string };
      visual_descriptor?: { headline?: string; visual_description?: string };
    };
    packaging: {
      caption: string;
      hashtags: string[];
      cta: string;
      meta_description: string;
    };
  };
};

export type SuggestionOption = {
  id: string;
  label: string;
  summary: string;
  rationale: string;
  badges: string[];
};

export type SavedBlockReference = {
  id: string;
  reference: string;
  name: string;
};

/**
 * Canonical resolution of a saved creator asset's image URL(s). Different write
 * paths populate different fields — the `url` column, the `files` column,
 * top-level `metadata.files`, or (legacy Creator flow)
 * `metadata.creator_continuity.files`. The UI reconciles them here in a fixed
 * deterministic priority so historical AND newly generated assets render.
 * Read-only: no write path, storage, or schema is changed.
 */
export function resolveSavedAssetMedia(row: Record<string, unknown>): string[] {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  const meta = (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata))
    ? row.metadata as Record<string, unknown>
    : {};
  const continuity = (meta.creator_continuity && typeof meta.creator_continuity === 'object' && !Array.isArray(meta.creator_continuity))
    ? meta.creator_continuity as Record<string, unknown>
    : {};
  const continuityFiles = arr(continuity.files);  // 1. legacy Creator-flow reader path
  if (continuityFiles.length > 0) return continuityFiles;
  const metaFiles = arr(meta.files);               // 2. top-level metadata.files
  if (metaFiles.length > 0) return metaFiles;
  const columnFiles = arr(row.files);              // 3. files column
  if (columnFiles.length > 0) return columnFiles;
  return typeof row.url === 'string' && row.url.trim() ? [row.url.trim()] : [];  // 4. url column
}

export type SavedCreatorAsset = {
  id: string;
  name: string;
  description: string | null;
  format_type?: string | null;
  tags: string[];
  usage_count: number;
  created_at?: string;
  /**
   * Canonical resolved image URL(s) for the saved asset. The render/persistence
   * pipeline writes the URL to different places depending on path (the `url`
   * column, the `files` column, or `metadata.files`), while older Creator-flow
   * assets used `metadata.creator_continuity.files`. This field reconciles all
   * of them at read time via a deterministic priority order (see
   * resolveSavedAssetMedia) so every asset — historical or new — renders.
   */
  media_files?: string[];
  /**
   * Continuity metadata surfaced by the saved-templates API. Populated
   * when the saved template was created by the Creator flow; null for
   * legacy / non-Creator templates. Mirrors the
   * `CreatorContinuityMetadata` shape in backend/services/blockTemplateService.
   */
  creator_metadata?: {
    asset_type?:             string | null;
    attachment_mode?:        AttachmentMode | null;
    asset_composition_intent?: Record<string, unknown> | null;
    copy_policy?: Record<string, unknown> | null;
    source_text_transform?: string | null;
    overlay_text?: {
      hook?:           string;
      headline?:       string;
      keyInsight?:     string;
      cta?:            string;
      supportingText?: string;
    } | null;
    subtype?:        string | null;
    brand_mode?:     'brand-aware' | 'independent' | null;
    brand_presence?: 'minimal' | 'balanced' | 'strong' | null;
    platform?:       string | null;
    files?:          string[] | null;
    preview_kind?:   string | null;
    platformContext?: string | null;
    renderIdentityHash?: string | null;
    renderer_metadata?: Record<string, unknown> | null;
    schema_version?: number;
  } | null;
};

export type CreatorBrandMode = 'brand-aware' | 'independent';
export type BrandPresence = 'minimal' | 'balanced' | 'strong';

export type BrandContextSelections = {
  companyContext: boolean;
  logo: boolean;
  favicon: boolean;
  tagline: boolean;
  brandTone: boolean;
  brandColors: boolean;
  audience: boolean;
  campaign: boolean;
};

export type CreatorBrandProfile = {
  companyName?: string;
  industry?: string;
  audience?: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  tagline?: string;
  brandTone?: string;
  brandColors?: string[];
  campaignAssociation?: string;
  uniqueValue?: string;
  positioning?: string;
};

export type RepurposePath = {
  id: 'blog' | 'linkedin-post' | 'thread' | 'blog-section' | 'long-form-outline';
  label: string;
  description: string;
};

export const DEFAULT_BRAND_SELECTIONS: BrandContextSelections = {
  companyContext: true,
  logo: true,
  favicon: false,
  tagline: true,
  brandTone: true,
  brandColors: true,
  audience: true,
  campaign: false,
};

export type BrandAssetSize = 'small' | 'medium' | 'large';

// Each step up is 80% bigger than the previous: small = 1.0x (current size on
// the rendered asset), medium = 1.8x, large = ~3.24x. The numeric factor is
// surfaced in the brief so the renderer can scale logo / favicon proportionally.
export const BRAND_ASSET_SIZE_PRESETS: ReadonlyArray<{ value: BrandAssetSize; label: string; scale: number }> = [
  { value: 'small',  label: 'Small',  scale: 1.0  },
  { value: 'medium', label: 'Medium', scale: 1.8  },
  { value: 'large',  label: 'Large',  scale: 3.24 },
];

export const DEFAULT_BRAND_ASSET_SIZE: BrandAssetSize = 'small';

// "Small" is the current rendered baseline per asset class. Medium / large
// derive from this base via the scale factor in BRAND_ASSET_SIZE_PRESETS.
export const BRAND_ASSET_BASE_PX: Readonly<Record<'logo' | 'favicon', number>> = {
  logo:    96,
  favicon: 32,
};

export function normalizeBrandAssetSize(value: unknown): BrandAssetSize {
  return BRAND_ASSET_SIZE_PRESETS.some((p) => p.value === value)
    ? (value as BrandAssetSize)
    : DEFAULT_BRAND_ASSET_SIZE;
}

export function brandAssetSizePx(asset: 'logo' | 'favicon', size: BrandAssetSize): number {
  const preset = BRAND_ASSET_SIZE_PRESETS.find((p) => p.value === size) ?? BRAND_ASSET_SIZE_PRESETS[0];
  return Math.round(BRAND_ASSET_BASE_PX[asset] * preset.scale);
}

export function describeBrandAssetSize(asset: 'logo' | 'favicon', size: BrandAssetSize): string {
  const preset = BRAND_ASSET_SIZE_PRESETS.find((p) => p.value === size) ?? BRAND_ASSET_SIZE_PRESETS[0];
  return `${preset.label.toLowerCase()} (~${brandAssetSizePx(asset, size)}px on the asset)`;
}

export function buildDefaultAnswers(config: WorkflowConfig): Record<string, string> {
  const defaults: Record<string, string> = {
    subtype: config.subtypeOptions[0]?.value || '',
  };
  config.fields.forEach((field) => {
    if (field.kind === 'single-select') {
      defaults[field.id] = field.options[0]?.value || '';
      return;
    }
    // Pre-populate preset-backed fields — notably the CTA ("What action should
    // the viewer take?") — with a sensible default so the creative always ships
    // WITH a call-to-action instead of a blank field. Any campaign/workspace
    // prefill or restored value overrides this in the setAnswers merge.
    const presets = (field as { presets?: ReadonlyArray<string> }).presets;
    if (Array.isArray(presets) && presets.length > 0) {
      defaults[field.id] = String(presets[0]);
    }
  });
  return defaults;
}

export function getCreatorDraftStorageKey(type: CreatorTypeId): string {
  return `creator_flow_draft_${type}`;
}

/**
 * CREATOR-106: seed the editor's text fields from the Marketing Workspace brief so the
 * user doesn't re-enter what they already gave (Who is it for / core message / topic /
 * constraints). Only fields that exist in this asset's config are set, and all stay
 * editable. Lossy by design — the workspace brief is freeform, so structured fields
 * (e.g. dataPoints) seed from the same description and the user refines.
 */
export function mapBriefToEditorAnswers(brief: MarketingBrief, config: WorkflowConfig): Record<string, string> {
  const ids = new Set<string>(config.fields.map((f) => f.id));
  const out: Record<string, string> = {};
  const set = (id: string, v: string | null | undefined) => { const t = (v ?? '').trim(); if (t && ids.has(id)) out[id] = t; };
  const message = (brief.freeText ?? '').trim();
  const firstSentence = message ? message.split(/[.!?\n]/)[0].slice(0, 90).trim() : '';

  set('audience', brief.audience);
  set('topic', (brief.offer ?? '').trim() || firstSentence);
  // Core-message style fields across asset types.
  for (const id of ['keyMessage', 'message', 'coreMessage', 'mainMessage', 'headline']) set(id, message);
  set('cta', brief.cta);
  set('offer', brief.offer);
  // Objective Preservation (Wave 0): seed `objective` from the brief's
  // substantive intent (goal label → specific offer → conversational brief) so
  // the user's real objective reaches generation instead of the workflow's
  // silent select default ('awareness'). This is merged into `answers` AFTER
  // buildDefaultAnswers in the lifecycle, so a brief-derived objective always
  // overrides that UI default. (Refining this to a matching select option is
  // Wave-1 UI work — here we simply preserve the intent.)
  const goalLabel = brief.goalId ? (getCreationGoal(brief.goalId)?.label ?? '') : '';
  set('objective', goalLabel || (brief.offer ?? '').trim() || message);
  // NOTE: do NOT seed dataPoints/stats from the freeform brief — the infographic
  // renderer extracts metrics from that field and mangles freeform text (e.g. the
  // year "2026" rendered as a giant "2026B" numeral). Leave it for the user / AI.
  if (brief.tone && ids.has('refinement')) out.refinement = `Tone: ${brief.tone}`;
  set('tone', brief.tone);
  return out;
}

export const CREATOR_DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
export const CREATOR_GENERATION_TIMEOUT_MS = 1000 * 90;

export function hasUsableCreatorOutput(result: CreatorResult | null): result is CreatorResult {
  return Boolean(
    result?.output &&
    result.output.asset_payload &&
    result.output.packaging &&
    (
      String(result.output.packaging.caption || '').trim() ||
      String(result.output.packaging.meta_description || '').trim() ||
      Array.isArray(result.output.asset_payload.slides)
    ),
  );
}

export function summarizeMediaUrls(result: CreatorResult | null): string[] {
  if (!result) return [];
  const mediaBundle = result.output.asset_payload.media_bundle || {};
  const files = Array.isArray(mediaBundle.files) ? mediaBundle.files.filter(Boolean) : [];
  const url = typeof mediaBundle.url === 'string' && mediaBundle.url.trim() ? [mediaBundle.url.trim()] : [];
  return Array.from(new Set([...url, ...files]));
}

export function getMediaPreviewMetadata(result: CreatorResult | null) {
  const mediaBundle = result?.output.asset_payload.media_bundle || {};
  return mediaBundle.metadata || {};
}

/** Read-only: extract the deterministic diagnostic report from asset metadata. */
export function getDiagnosticReport(result: CreatorResult | null): CreatorDiagnosticReport | null {
  const meta = getMediaPreviewMetadata(result) as Record<string, unknown>;
  const r = meta.creator_diagnostic_report;
  return r && typeof r === 'object' && !Array.isArray(r) ? (r as CreatorDiagnosticReport) : null;
}

export function pickOptionValue(field: WorkflowField | undefined, candidates: string[]): string | null {
  if (!field || field.kind !== 'single-select') return null;
  const normalizedCandidates = candidates.map((candidate) => candidate.toLowerCase());
  const match = field.options.find((option) => {
    const haystack = `${option.value} ${option.label} ${option.description}`.toLowerCase();
    return normalizedCandidates.some((candidate) => candidate && haystack.includes(candidate));
  });
  return match?.value || null;
}

export function setIfFieldExists(
  config: WorkflowConfig,
  answers: Record<string, string>,
  id: string,
  value?: string | null,
): void {
  if (!value || !config.fields.some((field) => field.id === id)) return;
  answers[id] = value;
}

export function splitWriterSourcePoints(source: WriterCreatorSourcePayload): string[] {
  const bodyPoints = String(source.body || '')
    .replace(/https?:\/\/\S+/gi, '')
    .split(/\n{2,}|\n(?=[-*\d])|(?<=[.!?])\s+/)
    .map((segment) => segment.replace(/^[-*\d.)\s]+/, '').replace(/\s+/g, ' ').trim())
    .filter((segment) => segment.length >= 18)
    .slice(0, 5);
  return bodyPoints.slice(0, 7);
}

export function buildWriterStructureGuidance(
  source: WriterCreatorSourcePayload,
  creatorType: CreatorTypeId,
): string {
  const points = splitWriterSourcePoints(source);
  const transform = source.compositionIntent.copyPolicy?.sourceTextTransform ?? 'none';
  const isDeck = creatorType === 'carousel' || creatorType === 'slider';
  const opener = source.sourceType === 'thread'
    ? `Transform the imported thread with the ${transform} policy before creating visual structure; do not map raw thread posts directly to slides.`
    : `Transform the imported post with the ${transform} policy before creating visual structure; keep source text outside provider image generation.`;
  const labels = isDeck
    ? ['Hook slide', 'Insight slide', 'Proof slide', 'Action slide', 'Closing slide']
    : ['Title section', 'Context section', 'Insight section', 'Proof section', 'Footer'];
  return [
    opener,
    ...points.map((point, index) => `${labels[index] || `Section ${index + 1}`}: ${point}`),
    creatorType === 'pdf'
      ? 'Render as a downloadable branded insight document, not a raw text dump.'
      : creatorType === 'slider'
        ? 'Render as a lightweight presentation deck with a title slide, section slides, and CTA ending.'
        : 'Render with consistent visual language and transformed source continuity.',
  ].join('\n');
}

export function buildCreatorAnswersFromWriterSource(
  config: WorkflowConfig,
  creatorType: CreatorTypeId,
  source: WriterCreatorSourcePayload,
): Record<string, string> {
  const answers: Record<string, string> = {};
  const fieldById = new Map(config.fields.map((field) => [field.id, field]));
  const sourceLabel = source.sourceType === 'thread' ? 'Thread' : 'Post';
  const attachmentMode = source.compositionIntent.attachmentMode;
  const transform = source.compositionIntent.copyPolicy?.sourceTextTransform ?? 'none';
  const snippet = isSocialCreativeType(creatorType)
    ? source.body.slice(0, 360)
    : source.body.slice(0, 700);
  const platform = source.platform || config.primaryPlatforms[0] || 'linkedin';
  const visualPersonality = source.tone || (source.sourceType === 'thread' ? 'editorial' : 'premium');
  const structureGuidance = buildWriterStructureGuidance(source, creatorType);

  setIfFieldExists(config, answers, 'topic', source.title);
  setIfFieldExists(config, answers, 'audience', source.audience || 'Audience from the source content');
  setIfFieldExists(config, answers, 'keyMessage', snippet);
  setIfFieldExists(config, answers, 'headline', source.title);
  setIfFieldExists(config, answers, 'dataPoints', transform === 'none' ? '' : snippet);
  setIfFieldExists(config, answers, 'slideDirection', structureGuidance);
  setIfFieldExists(config, answers, 'sectionDirection', structureGuidance);
  setIfFieldExists(config, answers, 'refinement', [
    `Imported from ${sourceLabel}.`,
    `Platform-aware direction: optimize for ${platform}.`,
    `Attachment mode: ${attachmentMode}.`,
    `Source transform: ${transform}.`,
    attachmentMode === 'supporting_visual'
      ? 'Visual must complement the source without visible text, CTA, paragraph overlays, or thread restatement.'
      : 'Creator layer owns deterministic typography and any embedded copy.',
    structureGuidance,
    source.hashtags?.length ? `Hashtag context: ${source.hashtags.join(' ')}` : '',
  ].filter(Boolean).join('\n'));

  const objective = pickOptionValue(fieldById.get('objective'), [
    source.sourceType === 'thread' ? 'education' : 'attention',
    'clarity',
  ]);
  if (objective) answers.objective = objective;

  const styleDirection = pickOptionValue(fieldById.get('styleDirection'), [
    visualPersonality,
    visualPersonality.toLowerCase().includes('premium') ? 'premium' : '',
    source.sourceType === 'thread' ? 'editorial' : 'bold',
  ]);
  if (styleDirection) answers.styleDirection = styleDirection;

  const hierarchy = pickOptionValue(fieldById.get('hierarchy'), [
    'headline',
  ]);
  if (hierarchy) answers.hierarchy = hierarchy;

  const continuity = pickOptionValue(fieldById.get('continuity'), [
    source.sourceType === 'thread' ? 'narrative' : 'modular',
    'progressive',
  ]);
  if (continuity) answers.continuity = continuity;

  const density = pickOptionValue(fieldById.get('density'), [
    source.sourceType === 'thread' ? 'balanced' : 'minimal',
  ]);
  if (density) answers.density = density;

  const subtype = pickOptionValue({ ...config.subtypeOptions[0], id: 'subtype', label: config.subtypeLabel, kind: 'single-select', options: config.subtypeOptions } as WorkflowField, [
    creatorType === 'carousel' ? 'authority' : '',
    creatorType === 'banner' ? 'promo' : '',
    creatorType === 'infographic' ? 'framework' : '',
    creatorType === 'image' ? 'educational' : '',
  ]);
  if (subtype) answers.subtype = subtype;

  return answers;
}

export function humanizeValue(value: string | undefined): string {
  return String(value || '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

export function buildBlockReference(templateId: string): string {
  const compact = String(templateId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase();
  return compact ? `BLK-${compact}` : 'BLK-PENDING';
}

export function getSavedAssetCreatorType(asset: SavedCreatorAsset): string {
  const sourceTag = asset.tags.find((tag) => tag.startsWith('source:'));
  if (sourceTag) return humanizeValue(sourceTag.replace(/^source:/, ''));
  return humanizeValue(asset.format_type || 'creator asset');
}

export function getSavedAssetAttachmentLabel(asset: SavedCreatorAsset): string | null {
  const metadata = asset.creator_metadata;
  if (!metadata || metadata.asset_type !== 'image') return null;
  if (metadata.attachment_mode === 'embedded_copy') return 'Text Inside Image';
  if (metadata.attachment_mode === 'supporting_visual') return 'Post + Image';
  return null;
}

export function getRepurposePaths(type: CreatorTypeId, assetSubtype?: string): RepurposePath[] {
  if (type === 'carousel') {
    return [
      { id: 'blog', label: 'Carousel -> Blog', description: 'Open this as a long-form blog draft.' },
      { id: 'linkedin-post', label: 'Carousel -> LinkedIn Post', description: 'Use the caption and slide logic as a post.' },
    ];
  }
  if (type === 'infographic') {
    return [
      { id: 'blog-section', label: 'Infographic -> Blog Section', description: 'Turn the visual logic into a reusable article section.' },
      { id: 'linkedin-post', label: 'Infographic -> LinkedIn Post', description: 'Use the insight as a social post.' },
    ];
  }
  if (type === 'post') {
    return [
      { id: 'blog', label: 'Post -> Blog', description: 'Expand the post direction into a blog draft.' },
      { id: 'thread', label: 'Post -> Thread', description: 'Turn the post into a connected sequence.' },
    ];
  }
  if (type === 'thread') {
    return [
      { id: 'blog', label: 'Thread -> Blog', description: 'Expand the thread narrative into a blog draft.' },
      { id: 'linkedin-post', label: 'Thread -> LinkedIn Post', description: 'Condense the sequence into one post.' },
    ];
  }
  if (assetSubtype === 'video' || assetSubtype === 'short' || assetSubtype === 'reel') {
    return [
      { id: 'thread', label: 'Reel Concept -> Thread', description: 'Turn the media concept into a written sequence.' },
      { id: 'long-form-outline', label: 'Video Script -> Long-Form Outline', description: 'Use the production brief as a long-form outline.' },
    ];
  }
  return [
    { id: 'blog-section', label: `${humanizeValue(type)} -> Blog Section`, description: 'Attach this asset as a long-form supporting section.' },
    { id: 'linkedin-post', label: `${humanizeValue(type)} -> LinkedIn Post`, description: 'Use the asset packaging as social copy.' },
  ];
}

export function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function pickFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return undefined;
}

export function mapCreatorBrandProfile(profile: Record<string, unknown> | null | undefined): CreatorBrandProfile {
  const safeProfile = profile || {};
  const reportSettings = safeProfile.report_settings && typeof safeProfile.report_settings === 'object'
    ? (safeProfile.report_settings as Record<string, unknown>)
    : {};
  const brandColors = [
    ...splitList(safeProfile.brand_colors),
    ...splitList(safeProfile.color_palette),
    ...splitList(reportSettings.brand_colors),
  ];
  return {
    companyName: pickFirstString(safeProfile.name, safeProfile.company_name),
    industry: pickFirstString(safeProfile.industry, safeProfile.category),
    audience: pickFirstString(safeProfile.target_audience, safeProfile.target_customer_segment, safeProfile.ideal_customer_profile),
    logoUrl: pickFirstString(safeProfile.logo_url, safeProfile.brand_logo_url, safeProfile.company_logo_url) || null,
    faviconUrl: pickFirstString(safeProfile.favicon_url, safeProfile.brand_favicon_url) || null,
    tagline: pickFirstString(safeProfile.tagline, safeProfile.homepage_headline, safeProfile.unique_value, safeProfile.brand_positioning),
    brandTone: pickFirstString(safeProfile.brand_voice, safeProfile.brand_tone),
    brandColors: Array.from(new Set(brandColors)).slice(0, 8),
    campaignAssociation: pickFirstString(safeProfile.campaign_focus, safeProfile.campaign_name),
    uniqueValue: pickFirstString(safeProfile.unique_value),
    positioning: pickFirstString(safeProfile.brand_positioning, safeProfile.content_strategy),
  };
}

export function buildBrandContextLines(input: {
  mode: CreatorBrandMode;
  presence: BrandPresence;
  selections: BrandContextSelections;
  profile: CreatorBrandProfile | null;
  overrides: Record<string, string>;
}): string[] {
  if (input.mode !== 'brand-aware') {
    return [
      'Generation mode: Independent Creative Generation',
      'Do not use company identity, logo, favicon, tagline, brand colors, brand tone, audience profile, or campaign context.',
      'Keep the output portable, category-native, and concept-led rather than company-led.',
    ];
  }

  const profile = input.profile || {};
  const lines = [
    'Generation mode: Brand-Aware Generation',
    `Brand presence: ${input.presence}`,
    input.presence === 'minimal'
      ? 'Use brand as a subtle quality filter: tone and audience fit matter more than visible branding.'
      : input.presence === 'strong'
        ? 'Make brand identity visibly influence language, visual hierarchy, CTA framing, and supporting references.'
        : 'Balance brand consistency with platform-native creative quality.',
  ];
  if (input.selections.companyContext) {
    const companyLine = [
      input.overrides.companyName || profile.companyName,
      profile.industry ? `Industry: ${profile.industry}` : '',
      profile.uniqueValue ? `Value: ${profile.uniqueValue}` : '',
      profile.positioning ? `Positioning: ${profile.positioning}` : '',
    ].filter(Boolean).join(' | ');
    if (companyLine) lines.push(`Company context: ${companyLine}`);
  }
  if (input.selections.logo) {
    const logo = input.overrides.logoUrl || profile.logoUrl;
    if (logo) {
      const size = normalizeBrandAssetSize(input.overrides.logoSize);
      lines.push(`Company logo reference: ${logo} (render size: ${describeBrandAssetSize('logo', size)}, aligned to the asset)`);
    }
  }
  if (input.selections.favicon) {
    const favicon = input.overrides.faviconUrl || profile.faviconUrl;
    if (favicon) {
      const size = normalizeBrandAssetSize(input.overrides.faviconSize);
      lines.push(`Company favicon reference: ${favicon} (render size: ${describeBrandAssetSize('favicon', size)}, aligned to the asset)`);
    }
  }
  if (input.selections.tagline) {
    const tagline = input.overrides.tagline || profile.tagline;
    if (tagline) lines.push(`Tagline: ${tagline}`);
  }
  if (input.selections.brandTone) {
    const tone = input.overrides.brandTone || profile.brandTone;
    if (tone) lines.push(`Brand tone: ${tone}`);
  }
  if (input.selections.brandColors) {
    const colors = splitList(input.overrides.brandColors).length > 0
      ? splitList(input.overrides.brandColors)
      : profile.brandColors || [];
    if (colors.length > 0) lines.push(`Brand colors: ${colors.join(', ')}`);
  }
  if (input.selections.audience) {
    const audience = input.overrides.audience || profile.audience;
    if (audience) lines.push(`Audience context: ${audience}`);
  }
  if (input.selections.campaign) {
    const campaign = input.overrides.campaign || profile.campaignAssociation;
    if (campaign) lines.push(`Campaign association: ${campaign}`);
  }
  return lines;
}

export function getOptionLabel(config: WorkflowConfig, fieldId: string, value: string | undefined): string {
  const field = config.fields.find(
    (entry): entry is Extract<WorkflowField, { kind: 'single-select' }> =>
      entry.id === fieldId && entry.kind === 'single-select',
  );
  if (!field || !value) return humanizeValue(value);
  return field.options.find((option) => option.value === value)?.label || humanizeValue(value);
}

export function buildSuggestionOptions(
  config: WorkflowConfig,
  answers: Record<string, string>,
  context: {
    brandMode: CreatorBrandMode;
    brandPresence: BrandPresence;
    brandProfile: CreatorBrandProfile | null;
    /** Resolved target platform when a writer source supplied one; null on
     *  the direct creator route (no inherent platform — keep copy generic). */
    targetPlatform: string | null;
  },
): SuggestionOption[] {
  const subtypeLabel = config.subtypeOptions.find((option) => option.value === answers.subtype)?.label || config.title;
  const objective = getOptionLabel(config, 'objective', answers.objective) || 'engagement';
  const style = getOptionLabel(config, 'styleDirection', answers.styleDirection) || 'brand-led';
  const continuity =
    getOptionLabel(config, 'continuity', answers.continuity) ||
    getOptionLabel(config, 'visualSystem', answers.visualSystem) ||
    getOptionLabel(config, 'structureMode', answers.structureMode) ||
    getOptionLabel(config, 'hierarchy', answers.hierarchy) ||
    'clear visual continuity';
  const audience = String(answers.audience || 'your target audience').trim();
  const message = String(answers.keyMessage || answers.headline || answers.topic || config.title).trim();
  // Platform-aware copy ONLY when a real target platform is supplied (writer
  // route). Direct creator route → platform-agnostic so the asset can be
  // reused anywhere without LinkedIn (or any single platform) bias.
  const platformLabel = context.targetPlatform
    ? (context.targetPlatform.toLowerCase() === 'linkedin' ? 'LinkedIn' : humanizeValue(context.targetPlatform))
    : null;
  const platformPrefix = platformLabel ? `${platformLabel}-friendly ` : '';
  const platformSuffix = platformLabel ? ` for ${platformLabel}` : ' across your distribution channels';
  // Brand-aware → weave the company into every suggestion so all three
  // directions align with the selected company context. Independent → keep
  // copy generic.
  const brandAware = context.brandMode === 'brand-aware';
  const companyName = brandAware ? (context.brandProfile?.companyName || '').trim() : '';
  const brandClause = companyName ? `for ${companyName} ` : '';
  const companySignal = brandAware
    ? (companyName
        ? `${companyName}'s ${context.brandPresence} brand presence`
        : `${context.brandPresence} brand presence`)
    : 'independent creative territory';
  const industrySignal = context.brandProfile?.industry ? `${context.brandProfile.industry} positioning` : 'category positioning';
  const assetSignal = answers.assetSubtype && answers.assetSubtype !== 'none'
    ? ` with ${humanizeValue(answers.assetSubtype)} support`
    : '';
  const objectiveSignal = objective.toLowerCase().includes('conversion')
    ? 'CTA emphasis and decision momentum'
    : objective.toLowerCase().includes('education') || objective.toLowerCase().includes('authority')
      ? 'retention, clarity, and trust'
      : 'reach, recall, and scroll-stopping clarity';

  // Ensure every suggestion summary opens with a capital letter regardless
  // of whether the leading token is a platform/brand label or a workflow
  // word like "promotional".
  const capFirst = (sentence: string): string =>
    sentence.length === 0 ? sentence : sentence.charAt(0).toUpperCase() + sentence.slice(1);

  return [
    {
      id: 'safe-fit',
      label: 'Authority Direction',
      summary: capFirst(
        `${platformPrefix}${subtypeLabel.toLowerCase()} ${config.title.toLowerCase()} ${brandClause}for ${objective.toLowerCase()} that frames "${message}" through ${companySignal}, ${industrySignal}, and ${objectiveSignal}${assetSignal}.`,
      ),
      rationale: `Use this when ${audience} needs a polished, credible direction with strong retention and low execution risk.`,
      badges: platformLabel
        ? ['Brand Safe', `${platformLabel} Friendly`, 'Educational']
        : ['Brand Safe', 'Multi-Platform', 'Educational'],
    },
    {
      id: 'standout',
      label: 'Standout Direction',
      summary: capFirst(
        `high-attention ${config.title.toLowerCase()} ${brandClause}that leads with a sharper hook around "${message}", uses ${style.toLowerCase()} personality, and makes the first-screen payoff unmistakable${platformSuffix}.`,
      ),
      rationale: `Best when the priority is stopping attention quickly without turning the output into generic hype.`,
      badges: ['High Attention', style.toLowerCase().includes('premium') ? 'Premium' : 'Bold', 'High CTR'],
    },
    {
      id: 'educator',
      label: 'Conversion Direction',
      summary: capFirst(
        `structured ${config.title.toLowerCase()} ${brandClause}that turns "${message}" into a clear sequence, keeps ${continuity.toLowerCase()}, and gives the CTA a specific next-step role instead of generic closing copy.`,
      ),
      rationale: `Best when clarity, downstream reuse, and action are more important than novelty alone.`,
      badges: ['Conversion Focused', 'Educational', objective.toLowerCase().includes('conversion') ? 'High CTR' : 'Reusable'],
    },
  ];
}


/* ── Suggestion-chip builders (extracted from the page's useMemo bodies) ──
 * Pure functions over explicit inputs; the page keeps thin useMemo wrappers
 * with the same dependency arrays, so recompute behavior is unchanged. */

/** Overlay-field chips (hook / headline / supportingText / keyInsight) derived from the
 *  Writer body with cross-field allocation + global dedupe + starter fallback. */
