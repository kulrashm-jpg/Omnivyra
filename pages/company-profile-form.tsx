import React from 'react';
import Link from 'next/link';
import ChatVoiceButton from '../components/ChatVoiceButton';
import AIGenerationProgress from '../components/AIGenerationProgress';
import CompanyStrategyProfileCard from '../components/company/CompanyStrategyProfileCard';
import type { useCompanyProfileState } from '../hooks/useCompanyProfileState';
import type {
  CompanyContextIntelligence,
  CompanyDependency,
  CompanyGeographicExposure,
  CompanyProfile,
  CompanyRegulatoryExposure,
  CompanyRevenueSegment,
  CompanyTechnologyDependency,
  CompanyWorkforceProfile,
} from './company-profile.types';
import { dedupeSocialProfiles, joinList, normalizeProfileSocialUrl, splitToList } from './company-profile.types';
import { isValidCanonicalWebsite } from '../utils/companyProfileValidation';

type ProfileState = ReturnType<typeof useCompanyProfileState>;

type BrandAssetField = 'logo_url' | 'favicon_url';
type SocialAccountField = Extract<
  keyof CompanyProfile,
  | 'linkedin_url'
  | 'facebook_url'
  | 'instagram_url'
  | 'x_url'
  | 'youtube_url'
  | 'tiktok_url'
  | 'reddit_url'
  | 'pinterest_url'
  | 'whatsapp_url'
  | 'blog_url'
>;
type MissingFieldQuestion = {
  field: string;
  question: string;
  options?: string[];
  allow_multiple?: boolean;
};
type InlineQuestionFieldKey =
  | 'industry'
  | 'category'
  | 'geography'
  | 'products_services'
  | 'target_audience'
  | 'brand_voice'
  | 'goals'
  | 'unique_value'
  | 'content_themes';

const INLINE_QUESTION_FIELD_MATCHERS: Record<InlineQuestionFieldKey, string[]> = {
  industry: ['industry'],
  category: ['category', 'categories'],
  geography: ['geography', 'geographic', 'geographical', 'location', 'market_area', 'served_area'],
  products_services: ['product', 'products', 'service', 'services', 'offering', 'offerings'],
  target_audience: ['target_audience', 'audience', 'customer', 'icp', 'segment'],
  brand_voice: ['brand_voice', 'voice', 'tone'],
  goals: ['goal', 'goals', 'objective', 'objectives'],
  unique_value: ['unique_value', 'unique_value_proposition', 'value_proposition', 'differentiator'],
  content_themes: ['content_theme', 'content_themes', 'theme', 'themes', 'topic', 'topics'],
};

const BLOCKED_REFINEMENT_QUESTION_TOKENS = [
  'competitor',
  'competitors',
  'social',
  'social_profile',
  'linkedin',
  'facebook',
  'instagram',
  'twitter',
  'youtube',
  'tiktok',
  'reddit',
  'blog',
  'website',
  'url',
  'link',
];

const normalizeQuestionFieldKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const isBlockedRefinementQuestion = (question: MissingFieldQuestion) => {
  const normalized = normalizeQuestionFieldKey(`${question.field} ${question.question}`);
  return BLOCKED_REFINEMENT_QUESTION_TOKENS.some((token) => normalized.includes(token));
};

const questionMatchesInlineField = (
  question: MissingFieldQuestion,
  fieldKey: InlineQuestionFieldKey,
) => {
  if (isBlockedRefinementQuestion(question)) return false;
  const normalized = normalizeQuestionFieldKey(`${question.field} ${question.question}`);
  return INLINE_QUESTION_FIELD_MATCHERS[fieldKey].some((token) => normalized.includes(token));
};

const questionMatchesAnyInlineField = (question: MissingFieldQuestion) =>
  (Object.keys(INLINE_QUESTION_FIELD_MATCHERS) as InlineQuestionFieldKey[]).some((fieldKey) =>
    questionMatchesInlineField(question, fieldKey)
  );

const BUSINESS_CLASSIFICATION_LABELS: Record<string, string> = {
  product_company: 'Product Company',
  services_company: 'Services Company',
  marketplace: 'Marketplace',
  retailer: 'Retailer',
  distributor: 'Distributor',
  manufacturer: 'Manufacturer',
  hybrid: 'Hybrid',
  saas_product: 'Software Product',
  ai_product: 'AI Tool',
  mobile_app: 'Mobile App',
  cpg_brand: 'Consumer Brand',
  hardware_product: 'Hardware Product',
  it_services: 'IT Services',
  marketing_agency: 'Marketing Agency',
  consulting: 'Consulting',
  coaching: 'Coaching',
  outsourcing: 'Outsourcing',
  b2b_marketplace: 'B2B Marketplace',
  b2c_marketplace: 'Consumer Marketplace',
};

const formatBusinessClassificationLabel = (value?: string | null): string =>
  BUSINESS_CLASSIFICATION_LABELS[String(value || '').toLowerCase()] ||
  String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const BRAND_ASSET_SPECS: Record<
  BrandAssetField,
  {
    label: string;
    helper: string;
    recommendedSize: string;
    maxBytes: number;
    square: boolean;
  }
> = {
  logo_url: {
    label: 'Company Logo',
    helper: 'Transparent output is required. If you upload a logo on a simple flat background, we will try to remove that background automatically and store a transparent PNG.',
    recommendedSize: 'Transparent PNG output, recommended up to 1200 x 1200 px and 2 MB max',
    maxBytes: 2 * 1024 * 1024,
    square: false,
  },
  favicon_url: {
    label: 'Favicon',
    helper: 'Transparent output is required. Keep it as a simple square mark that still reads at small sizes.',
    recommendedSize: 'Transparent square PNG output, recommended 256 x 256 or 512 x 512 px and 512 KB max',
    maxBytes: 512 * 1024,
    square: true,
  },
};

const BRAND_ASSET_ACCEPT = 'image/png,image/jpeg,image/jpg,image/webp';

const SOCIAL_ACCOUNT_FIELDS: Array<{
  field: SocialAccountField;
  platform: string;
  label: string;
  placeholder: string;
}> = [
  {
    field: 'linkedin_url',
    platform: 'linkedin',
    label: 'LinkedIn',
    placeholder: 'https://linkedin.com/company/yourpage',
  },
  {
    field: 'instagram_url',
    platform: 'instagram',
    label: 'Instagram',
    placeholder: 'https://instagram.com/yourhandle',
  },
  {
    field: 'facebook_url',
    platform: 'facebook',
    label: 'Facebook',
    placeholder: 'https://facebook.com/yourpage',
  },
  {
    field: 'x_url',
    platform: 'x',
    label: 'X (Twitter)',
    placeholder: 'https://x.com/yourhandle',
  },
  {
    field: 'youtube_url',
    platform: 'youtube',
    label: 'YouTube',
    placeholder: 'https://youtube.com/@yourchannel',
  },
  {
    field: 'tiktok_url',
    platform: 'tiktok',
    label: 'TikTok',
    placeholder: 'https://tiktok.com/@yourhandle',
  },
  {
    field: 'pinterest_url',
    platform: 'pinterest',
    label: 'Pinterest',
    placeholder: 'https://pinterest.com/yourprofile',
  },
  {
    field: 'whatsapp_url',
    platform: 'whatsapp',
    label: 'WhatsApp',
    placeholder: 'https://wa.me/15551234567',
  },
  {
    field: 'reddit_url',
    platform: 'reddit',
    label: 'Reddit',
    placeholder: 'https://reddit.com/r/yourcommunity',
  },
  {
    field: 'blog_url',
    platform: 'blog',
    label: 'Blog / Website Page',
    placeholder: 'https://example.com/blog',
  },
];

const formatFileSize = (bytes: number) => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
};

const loadImageDimensions = (file: File): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(objectUrl);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to read image dimensions.'));
    };
    image.src = objectUrl;
  });

const loadImageElement = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve(image);
      URL.revokeObjectURL(objectUrl);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to load image.'));
    };
    image.src = objectUrl;
  });

const hasTransparentPixels = (data: Uint8ClampedArray) => {
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) {
      return true;
    }
  }
  return false;
};

const colorDistance = (
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
) => Math.sqrt(((a.r - b.r) ** 2) + ((a.g - b.g) ** 2) + ((a.b - b.b) ** 2));

const sampleCornerAverage = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  sampleSize: number,
) => {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let y = startY; y < Math.min(startY + sampleSize, height); y += 1) {
    for (let x = startX; x < Math.min(startX + sampleSize, width); x += 1) {
      const pixelIndex = ((y * width) + x) * 4;
      red += data[pixelIndex];
      green += data[pixelIndex + 1];
      blue += data[pixelIndex + 2];
      count += 1;
    }
  }

  return {
    r: Math.round(red / Math.max(count, 1)),
    g: Math.round(green / Math.max(count, 1)),
    b: Math.round(blue / Math.max(count, 1)),
  };
};

const detectFlatBackground = (data: Uint8ClampedArray, width: number, height: number) => {
  const sampleSize = Math.max(1, Math.min(12, Math.floor(Math.min(width, height) / 8)));
  const corners = [
    sampleCornerAverage(data, width, height, 0, 0, sampleSize),
    sampleCornerAverage(data, width, height, Math.max(width - sampleSize, 0), 0, sampleSize),
    sampleCornerAverage(data, width, height, 0, Math.max(height - sampleSize, 0), sampleSize),
    sampleCornerAverage(
      data,
      width,
      height,
      Math.max(width - sampleSize, 0),
      Math.max(height - sampleSize, 0),
      sampleSize,
    ),
  ];

  let maxDistance = 0;
  for (let index = 0; index < corners.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < corners.length; compareIndex += 1) {
      maxDistance = Math.max(maxDistance, colorDistance(corners[index], corners[compareIndex]));
    }
  }

  if (maxDistance > 24) {
    return null;
  }

  return corners.reduce(
    (acc, current) => ({
      r: Math.round(acc.r + current.r / corners.length),
      g: Math.round(acc.g + current.g / corners.length),
      b: Math.round(acc.b + current.b / corners.length),
    }),
    { r: 0, g: 0, b: 0 },
  );
};

const canvasToPngFile = async (canvas: HTMLCanvasElement, originalName: string) => {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((nextBlob) => resolve(nextBlob), 'image/png');
  });

  if (!blob) {
    throw new Error('Unable to prepare transparent PNG.');
  }

  const baseName = originalName.replace(/\.[^.]+$/, '') || 'brand-asset';
  return new File([blob], `${baseName}-transparent.png`, { type: 'image/png' });
};

const prepareTransparentBrandAsset = async (
  file: File,
  field: BrandAssetField,
): Promise<{ file: File; width: number; height: number; autoRemovedBackground: boolean }> => {
  const image = await loadImageElement(file);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  if (field === 'favicon_url' && width !== height) {
    throw new Error(`Favicon must be square. Uploaded image is ${width} x ${height}px.`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Canvas is unavailable for brand asset preparation.');
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);

  if (hasTransparentPixels(imageData.data)) {
    return {
      file: file.type === 'image/png' ? file : await canvasToPngFile(canvas, file.name),
      width,
      height,
      autoRemovedBackground: false,
    };
  }

  const backgroundColor = detectFlatBackground(imageData.data, width, height);
  if (!backgroundColor) {
    throw new Error(
      'This image has an opaque background. Upload a transparent asset, or use a logo on a flat background so we can remove it automatically.',
    );
  }

  const updated = new Uint8ClampedArray(imageData.data);
  let removedPixels = 0;
  const threshold = 34;

  for (let index = 0; index < updated.length; index += 4) {
    const distance = colorDistance(
      { r: updated[index], g: updated[index + 1], b: updated[index + 2] },
      backgroundColor,
    );
    if (distance <= threshold) {
      updated[index + 3] = 0;
      removedPixels += 1;
    }
  }

  if (removedPixels === 0) {
    throw new Error('This image stayed fully opaque after background cleanup. Upload a transparent asset instead.');
  }

  context.putImageData(new ImageData(updated, width, height), 0, 0);

  if (!hasTransparentPixels(updated)) {
    throw new Error('Transparent output could not be produced from this image.');
  }

  return {
    file: await canvasToPngFile(canvas, file.name),
    width,
    height,
    autoRemovedBackground: true,
  };
};

function StatCard({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'slate' | 'indigo';
}) {
  const toneClasses =
    tone === 'indigo'
      ? 'border-indigo-200 bg-indigo-50 text-indigo-900'
      : 'border-slate-200 bg-slate-50 text-slate-900';

  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClasses}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
  accent = 'slate',
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  accent?: 'slate' | 'indigo';
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const isOpen = collapsible ? open : true;
  const accentClasses =
    accent === 'indigo'
      ? 'border-indigo-200 bg-indigo-50/40'
      : 'border-slate-200 bg-white';

  return (
    <section className={`rounded-2xl border p-5 md:p-6 ${accentClasses}`}>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={isOpen}
          className={`flex w-full items-start justify-between gap-4 text-left ${isOpen ? 'mb-5' : ''}`}
        >
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {description ? <p className="text-sm leading-6 text-slate-600">{description}</p> : null}
          </div>
          <svg
            className={`mt-1 h-5 w-5 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </button>
      ) : (
        <div className="mb-5 flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {description ? <p className="text-sm leading-6 text-slate-600">{description}</p> : null}
        </div>
      )}
      {isOpen ? children : null}
    </section>
  );
}

function GuidedChatPanel({
  title,
  description,
  open,
  messages,
  input,
  loading,
  onInputChange,
  onSend,
  onClose,
  extraActions,
  renderAssistantMessage,
}: {
  title: string;
  description: string;
  open: boolean;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  input: string;
  loading: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
  extraActions?: React.ReactNode;
  renderAssistantMessage?: (content: string) => React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
              <p className="mt-1 text-sm text-slate-600">{description}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700"
            >
              Close
            </button>
          </div>
        </div>
        <div className="max-h-[52vh] space-y-3 overflow-y-auto bg-slate-50 px-5 py-4">
          {messages.length === 0 && loading ? (
            <div className="rounded-xl border border-indigo-100 bg-white px-4 py-3 text-sm text-slate-600">
              Preparing the first question...
            </div>
          ) : null}
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`rounded-xl px-4 py-3 text-sm ${
                message.role === 'assistant'
                  ? 'border border-slate-200 bg-white text-slate-700'
                  : 'ml-auto max-w-[85%] bg-indigo-600 text-white'
              }`}
            >
              {message.role === 'assistant' && renderAssistantMessage
                ? renderAssistantMessage(message.content)
                : message.content}
            </div>
          ))}
          {loading && messages.length > 0 ? (
            <div className="text-xs font-medium text-slate-500">Thinking...</div>
          ) : null}
        </div>
        <div className="border-t border-slate-200 p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <textarea
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              rows={2}
              placeholder="Answer the question here"
              className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  onSend();
                }
              }}
            />
            <button
              type="button"
              onClick={onSend}
              disabled={loading || !input.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Send
            </button>
          </div>
          {extraActions ? <div className="mt-3 flex flex-wrap gap-2">{extraActions}</div> : null}
        </div>
      </div>
    </div>
  );
}

const emptyIntelligenceContext = (): CompanyContextIntelligence => ({
  revenue_segments: [],
  geographic_exposures: [],
  dependencies: [],
  regulatory_exposures: [],
  workforce_profile: null,
  technology_dependencies: [],
});

const metadataDefaults = () => ({
  source: 'user',
  review_status: 'needs_review',
  user_confirmed: false,
  confidence: null,
});

function MetadataBadge({ row }: { row?: { source?: string | null; review_status?: string | null; confidence?: number | null; user_confirmed?: boolean | null } | null }) {
  const status = row?.user_confirmed ? 'user_confirmed' : row?.review_status || row?.source || 'unknown';
  const shouldShow =
    row?.user_confirmed ||
    typeof row?.confidence === 'number' ||
    ['inferred', 'stale', 'conflicting', 'deprecated', 'system_generated'].includes(String(status));
  if (!shouldShow) return null;
  const confidence = typeof row?.confidence === 'number' ? `${Math.round(row.confidence * 100)}%` : 'unknown';
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
      {status.replace(/_/g, ' ')} · confidence {confidence}
    </span>
  );
}

function MiniInput({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
    </label>
  );
}

function MiniSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      >
        <option value="">Unknown</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function IntelligenceContextSections({
  context,
  readiness,
  loading,
  saving,
  isEditing,
  quality,
  suggestions,
  enrichmentLoading,
  enrichmentReviewingId,
  onChange,
  onSave,
  onRunEnrichment,
  onOpenGuidedCapture,
  onReviewSuggestion,
  onRequestEdit,
}: {
  context: CompanyContextIntelligence | null;
  readiness: ProfileState['intelligenceReadiness'];
  loading: boolean;
  saving: boolean;
  isEditing: boolean;
  quality: ProfileState['contextQuality'];
  suggestions: ProfileState['enrichmentSuggestions'];
  enrichmentLoading: boolean;
  enrichmentReviewingId: string | null;
  onChange: (patch: Partial<CompanyContextIntelligence>) => void;
  onSave: () => void;
  onRunEnrichment: () => void;
  onOpenGuidedCapture: () => void;
  onReviewSuggestion: (suggestionId: string, action: 'accepted' | 'rejected' | 'snoozed') => void;
  onRequestEdit: () => void;
}) {
  const ctx = context ?? emptyIntelligenceContext();
  const updateRows = <K extends keyof CompanyContextIntelligence>(key: K, rows: CompanyContextIntelligence[K]) => {
    onChange({ [key]: rows } as Partial<CompanyContextIntelligence>);
  };
  // Adding a row shouldn't require the user to first find the global "Edit" button
  // (that made these sections look frozen in view mode). Clicking "Add" enters
  // edit mode and appends the new row in one step.
  const addRow = <K extends keyof CompanyContextIntelligence>(key: K, row: unknown) => {
    if (!isEditing) onRequestEdit();
    const existing = Array.isArray(ctx[key]) ? (ctx[key] as unknown[]) : [];
    updateRows(key, [...existing, row] as CompanyContextIntelligence[K]);
  };
  const updateRow = <T,>(rows: T[], index: number, patch: Partial<T>) =>
    rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row);
  const removeRow = <T,>(rows: T[], index: number) => rows.filter((_, rowIndex) => rowIndex !== index);
  const readinessScores = readiness?.section_scores;
  const readinessScore = readiness?.score ?? 0;
  const recommendations = [
    ctx.revenue_segments.length === 0 ? 'Add your primary customer markets' : null,
    ctx.geographic_exposures.length === 0 ? 'Add the geographies that influence revenue or operations' : null,
    !ctx.workforce_profile ? 'Add workforce dependency' : null,
    ctx.dependencies.length === 0 ? 'Add operational vendor, labor, platform, or logistics dependencies' : null,
    ctx.technology_dependencies.length === 0 ? 'Add cloud/platform dependencies' : null,
    ctx.regulatory_exposures.length === 0 ? 'Add regulatory jurisdictions if they affect operations or customers' : null,
  ].filter((item): item is string => Boolean(item)).slice(0, 4);
  const validationWarnings = ctx.validation_warnings ?? [];

  return (
    <SectionCard
      title="Context Intelligence"
      description="Optional enrichment used by future exposure-aware recommendations, AI reasoning, and dependency intelligence. Empty sections are treated as missing, not as not relevant."
      accent="indigo"
      collapsible
      defaultOpen={false}
    >
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          ['Market', readinessScores?.market_exposure],
          ['Dependency', readinessScores?.dependency],
          ['Workforce', readinessScores?.workforce],
          ['Regulatory', readinessScores?.regulatory],
          ['Geography', readinessScores?.geographic],
          ['Strategy', readinessScores?.strategic_state],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-indigo-100 bg-white px-3 py-2">
            <div className="text-[11px] font-semibold uppercase text-slate-500">{label}</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{typeof value === 'number' ? `${value}%` : '0%'}</div>
          </div>
        ))}
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-indigo-100">
        <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${Math.max(0, Math.min(100, readinessScore))}%` }} />
      </div>

      {quality ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Density', quality.intelligence_density_score],
            ['Reliability', quality.context_reliability_score],
            ['Inference', quality.inference_coverage_score],
            ['Stale', quality.stale_context_score],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="text-[11px] font-semibold uppercase text-slate-500">{label}</div>
              <div className="mt-1 text-base font-semibold text-slate-900">{value}%</div>
            </div>
          ))}
        </div>
      ) : null}

      {recommendations.length > 0 ? (
        <div className="mb-4 rounded-xl border border-indigo-100 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">Recommended next context</div>
          <div className="mt-2 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
            {recommendations.map((item) => (
              <div key={item} className="rounded-lg bg-indigo-50 px-3 py-2">{item}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Guided context capture</div>
            <p className="mt-1 text-sm text-slate-500">Use chat for missing market, dependency, workforce, regulatory, and technology context, then review inferred suggestions before saving.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenGuidedCapture}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
            >
              Capture with chat
            </button>
            <button
              type="button"
              onClick={onRunEnrichment}
              disabled={enrichmentLoading}
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50"
            >
              {enrichmentLoading ? 'Checking...' : 'Find suggestions'}
            </button>
          </div>
        </div>
        {suggestions.length > 0 ? (
          <div className="mt-3 space-y-2">
            {suggestions.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{item.inference_reason}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {item.inference_strength} inference · confidence {Math.round((item.confidence || 0) * 100)}% · readiness impact +{Math.round(item.readiness_impact_estimate || 0)}%
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" disabled={enrichmentReviewingId === item.id} onClick={() => onReviewSuggestion(item.id, 'accepted')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Accept</button>
                    <button type="button" disabled={enrichmentReviewingId === item.id} onClick={() => onReviewSuggestion(item.id, 'snoozed')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50">Snooze</button>
                    <button type="button" disabled={enrichmentReviewingId === item.id} onClick={() => onReviewSuggestion(item.id, 'rejected')} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50">Reject</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-sm text-slate-500">No pending inference suggestions.</div>
        )}
      </div>

      {validationWarnings.length > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-900">Review suggested</div>
          <div className="mt-2 space-y-1 text-sm text-amber-800">
            {validationWarnings.map((warning) => (
              <div key={warning.code}>{warning.message}</div>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? <div className="text-sm text-slate-500">Loading intelligence context...</div> : null}

      <div className="space-y-3">
        <details className="rounded-xl border border-slate-200 bg-white p-4" open>
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Customer & Revenue Exposure</summary>
          <p className="mt-2 text-sm text-slate-500">Used to separate revenue dependency from generic audience descriptions.</p>
          <div className="mt-4 space-y-3">
            {ctx.revenue_segments.map((row, index) => (
              <div key={row.id || index} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <MetadataBadge row={row} />
                  <button type="button" disabled={!isEditing} onClick={() => updateRows('revenue_segments', removeRow(ctx.revenue_segments, index))} className="text-xs font-medium text-rose-700 disabled:opacity-50">Remove</button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <MiniInput label="Customer industry" value={row.customer_industry} onChange={(value) => updateRows('revenue_segments', updateRow(ctx.revenue_segments, index, { customer_industry: value }))} />
                  <MiniInput label="Customer segment" value={row.customer_segment} onChange={(value) => updateRows('revenue_segments', updateRow(ctx.revenue_segments, index, { customer_segment: value }))} />
                  <MiniInput label="Geography" value={row.geography} onChange={(value) => updateRows('revenue_segments', updateRow(ctx.revenue_segments, index, { geography: value }))} />
                  <MiniInput label="Revenue %" value={row.revenue_percentage} type="number" onChange={(value) => updateRows('revenue_segments', updateRow(ctx.revenue_segments, index, { revenue_percentage: value }))} />
                  <MiniSelect label="Strategic priority" value={row.strategic_priority} options={['low', 'medium', 'high', 'critical']} onChange={(value) => updateRows('revenue_segments', updateRow(ctx.revenue_segments, index, { strategic_priority: value }))} />
                  <MiniInput label="Notes" value={row.notes} onChange={(value) => updateRows('revenue_segments', updateRow(ctx.revenue_segments, index, { notes: value }))} />
                </div>
              </div>
            ))}
            <button type="button" disabled={saving} onClick={() => addRow('revenue_segments', { ...metadataDefaults() } as CompanyRevenueSegment)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50">Add revenue segment</button>
          </div>
        </details>

        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Market Exposure</summary>
          <p className="mt-2 text-sm text-slate-500">Used to distinguish customer, workforce, vendor, and operational exposure by geography.</p>
          <div className="mt-4 space-y-3">
            {ctx.geographic_exposures.map((row, index) => (
              <div key={row.id || index} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <MetadataBadge row={row} />
                  <button type="button" disabled={!isEditing} onClick={() => updateRows('geographic_exposures', removeRow(ctx.geographic_exposures, index))} className="text-xs font-medium text-rose-700 disabled:opacity-50">Remove</button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <MiniInput label="Geography" value={row.geography} onChange={(value) => updateRows('geographic_exposures', updateRow(ctx.geographic_exposures, index, { geography: value }))} />
                  <MiniSelect label="Exposure type" value={row.exposure_type} options={['revenue', 'operations', 'workforce', 'customers', 'vendors']} onChange={(value) => updateRows('geographic_exposures', updateRow(ctx.geographic_exposures, index, { exposure_type: value as CompanyGeographicExposure['exposure_type'] }))} />
                  <MiniInput label="Exposure %" value={row.exposure_percentage} type="number" onChange={(value) => updateRows('geographic_exposures', updateRow(ctx.geographic_exposures, index, { exposure_percentage: value }))} />
                  <MiniSelect label="Criticality" value={row.criticality} options={['low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => updateRows('geographic_exposures', updateRow(ctx.geographic_exposures, index, { criticality: value }))} />
                </div>
              </div>
            ))}
            <button type="button" disabled={saving} onClick={() => addRow('geographic_exposures', { exposure_type: 'revenue', ...metadataDefaults() } as CompanyGeographicExposure)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50">Add geography exposure</button>
          </div>
        </details>

        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Operational Dependencies</summary>
          <p className="mt-2 text-sm text-slate-500">Used to capture non-technology dependencies that can disrupt delivery, channels, or costs.</p>
          <div className="mt-4 space-y-3">
            {ctx.dependencies.map((row, index) => (
              <div key={row.id || index} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <MetadataBadge row={row} />
                  <button type="button" disabled={!isEditing} onClick={() => updateRows('dependencies', removeRow(ctx.dependencies, index))} className="text-xs font-medium text-rose-700 disabled:opacity-50">Remove</button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <MiniSelect label="Dependency type" value={row.dependency_type} options={['cloud', 'vendor', 'supplier', 'logistics', 'labor', 'platform', 'channel', 'regulatory', 'technology', 'other']} onChange={(value) => updateRows('dependencies', updateRow(ctx.dependencies, index, { dependency_type: value as CompanyDependency['dependency_type'] }))} />
                  <MiniInput label="Name" value={row.dependency_name} onChange={(value) => updateRows('dependencies', updateRow(ctx.dependencies, index, { dependency_name: value }))} />
                  <MiniInput label="Region" value={row.dependency_region} onChange={(value) => updateRows('dependencies', updateRow(ctx.dependencies, index, { dependency_region: value }))} />
                  <MiniSelect label="Criticality" value={row.criticality} options={['low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => updateRows('dependencies', updateRow(ctx.dependencies, index, { criticality: value }))} />
                  <MiniInput label="Operational sensitivity" value={row.operational_sensitivity} onChange={(value) => updateRows('dependencies', updateRow(ctx.dependencies, index, { operational_sensitivity: value }))} />
                  <MiniInput label="Notes" value={row.notes} onChange={(value) => updateRows('dependencies', updateRow(ctx.dependencies, index, { notes: value }))} />
                </div>
              </div>
            ))}
            <button type="button" disabled={saving} onClick={() => addRow('dependencies', { dependency_type: 'vendor', ...metadataDefaults() } as CompanyDependency)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50">Add dependency</button>
          </div>
        </details>

        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Workforce & Hiring</summary>
          <p className="mt-2 text-sm text-slate-500">Used to model labor, immigration, contractor, remote-work, and skill-market sensitivity.</p>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {(() => {
              const row = ctx.workforce_profile ?? { ...metadataDefaults() } as CompanyWorkforceProfile;
              const setWorkforce = (patch: Partial<CompanyWorkforceProfile>) => updateRows('workforce_profile', { ...row, ...patch });
              return (
                <>
                  <MiniInput label="Workforce model" value={row.workforce_model} onChange={(value) => setWorkforce({ workforce_model: value })} />
                  <MiniInput label="Hiring markets" value={Array.isArray(row.hiring_markets) ? row.hiring_markets.join(', ') : row.hiring_markets} onChange={(value) => setWorkforce({ hiring_markets: value })} />
                  <MiniInput label="Key skill dependencies" value={Array.isArray(row.key_skill_dependencies) ? row.key_skill_dependencies.join(', ') : row.key_skill_dependencies} onChange={(value) => setWorkforce({ key_skill_dependencies: value })} />
                  <MiniSelect label="Contractor dependency" value={row.contractor_dependency_level} options={['none', 'low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => setWorkforce({ contractor_dependency_level: value })} />
                  <MiniSelect label="Immigration dependency" value={row.immigration_dependency_level} options={['none', 'low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => setWorkforce({ immigration_dependency_level: value })} />
                  <MiniSelect label="Labor sensitivity" value={row.labor_sensitivity_level} options={['low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => setWorkforce({ labor_sensitivity_level: value })} />
                  <MiniSelect label="Remote dependency" value={row.remote_dependency_level} options={['none', 'low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => setWorkforce({ remote_dependency_level: value })} />
                  <div className="flex items-end"><MetadataBadge row={row} /></div>
                </>
              );
            })()}
          </div>
        </details>

        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Regulatory Exposure</summary>
          <p className="mt-2 text-sm text-slate-500">Used to capture jurisdictions and rule families that need future relevance filtering.</p>
          <div className="mt-4 space-y-3">
            {ctx.regulatory_exposures.map((row, index) => (
              <div key={row.id || index} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <MetadataBadge row={row} />
                  <button type="button" disabled={!isEditing} onClick={() => updateRows('regulatory_exposures', removeRow(ctx.regulatory_exposures, index))} className="text-xs font-medium text-rose-700 disabled:opacity-50">Remove</button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <MiniInput label="Jurisdiction" value={row.jurisdiction} onChange={(value) => updateRows('regulatory_exposures', updateRow(ctx.regulatory_exposures, index, { jurisdiction: value }))} />
                  <MiniInput label="Regulation type" value={row.regulation_type} onChange={(value) => updateRows('regulatory_exposures', updateRow(ctx.regulatory_exposures, index, { regulation_type: value }))} />
                  <MiniInput label="Applicability" value={row.applicability} onChange={(value) => updateRows('regulatory_exposures', updateRow(ctx.regulatory_exposures, index, { applicability: value }))} />
                  <MiniSelect label="Severity" value={row.severity} options={['low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => updateRows('regulatory_exposures', updateRow(ctx.regulatory_exposures, index, { severity: value }))} />
                  <MiniInput label="Notes" value={row.notes} onChange={(value) => updateRows('regulatory_exposures', updateRow(ctx.regulatory_exposures, index, { notes: value }))} />
                </div>
              </div>
            ))}
            <button type="button" disabled={saving} onClick={() => addRow('regulatory_exposures', { ...metadataDefaults() } as CompanyRegulatoryExposure)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50">Add regulatory exposure</button>
          </div>
        </details>

        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Technology Dependencies</summary>
          <p className="mt-2 text-sm text-slate-500">Used to identify platform, cloud, AI, payments, analytics, and security dependency sensitivity.</p>
          <div className="mt-4 space-y-3">
            {ctx.technology_dependencies.map((row, index) => (
              <div key={row.id || index} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <MetadataBadge row={row} />
                  <button type="button" disabled={!isEditing} onClick={() => updateRows('technology_dependencies', removeRow(ctx.technology_dependencies, index))} className="text-xs font-medium text-rose-700 disabled:opacity-50">Remove</button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <MiniInput label="Provider" value={row.provider_name} onChange={(value) => updateRows('technology_dependencies', updateRow(ctx.technology_dependencies, index, { provider_name: value }))} />
                  <MiniInput label="Category" value={row.provider_category} onChange={(value) => updateRows('technology_dependencies', updateRow(ctx.technology_dependencies, index, { provider_category: value }))} />
                  <MiniSelect label="Criticality" value={row.criticality} options={['low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => updateRows('technology_dependencies', updateRow(ctx.technology_dependencies, index, { criticality: value }))} />
                  <MiniSelect label="Spend sensitivity" value={row.spend_sensitivity} options={['low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => updateRows('technology_dependencies', updateRow(ctx.technology_dependencies, index, { spend_sensitivity: value }))} />
                  <MiniInput label="Operational dependency" value={row.operational_dependency} onChange={(value) => updateRows('technology_dependencies', updateRow(ctx.technology_dependencies, index, { operational_dependency: value }))} />
                  <MiniInput label="Notes" value={row.notes} onChange={(value) => updateRows('technology_dependencies', updateRow(ctx.technology_dependencies, index, { notes: value }))} />
                </div>
              </div>
            ))}
            <button type="button" disabled={saving} onClick={() => addRow('technology_dependencies', { ...metadataDefaults() } as CompanyTechnologyDependency)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50">Add technology dependency</button>
          </div>
        </details>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          Overall intelligence readiness: <span className="font-semibold text-slate-800">{readinessScore}%</span>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={!isEditing || saving}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save intelligence context'}
        </button>
      </div>
    </SectionCard>
  );
}

export default function CompanyProfileForm({ d }: { d: ProfileState }) {
  const {
    REFINE_STEPS,
    REFINE_STEP_DELAYS,
    activeProfile,
    addOtherSocial,
    calculateProblemTransformationCompletion,
    calculateProfileCompletion,
    campaignPurposeInput,
    campaignPurposeLoading,
    campaignPurposeMessages,
    campaignPurposePanelOpen,
    canCreateCompany,
    canSelectMultipleCompanies,
    canViewStrategicSections,
    canonicalFieldLabel,
    companies,
    companyFacts,
    companyId,
    companyIdCopied,
    companySearchFilter,
    completionPercent,
    createCompanyError,
    createCompanyForm,
    createCompanyLoading,
    contextIntelligenceChatLoading,
    contextIntelligenceInput,
    contextIntelligenceMessages,
    contextIntelligencePanelOpen,
    contextQuality,
    draftProfile,
    enrichmentLoading,
    enrichmentReviewingId,
    enrichmentSuggestions,
    errorMessage,
    fetchWithAuth,
    filteredCompanies,
    generateMarketingIntelligence,
    handleChange,
    handleChangeArray,
    handleCompanyFactChange,
    handleIntelligenceSettingChange,
    handleMarketPulseSettingArrayChange,
    handleMarketPulseSettingChange,
    handleCreateCompany,
    handleMissingAnswer,
    intelligenceContext,
    intelligenceContextLoading,
    intelligenceContextSaving,
    intelligenceReadiness,
    isAdmin,
    isAuthenticated,
    isCompanyAdmin,
    isCompanyLoading,
    isContentArchitect,
    isEditing,
    isOnboardingMode,
    isOnboardingResolving,
    isLoading,
    isRefining,
    isSaving,
    lastFetchError,
    lastFetchStatus,
    lastRefined,
    latestRefinement,
    marketingIntelligenceChatLoading,
    marketingIntelligenceInput,
    marketingIntelligenceLoading,
    marketingIntelligenceMessages,
    marketingIntelligencePanelOpen,
    missingFieldAnswers,
    normalizeFieldKey,
    normalizeUrlField,
    notFound,
    notifyCompanyProfileUpdated,
    onboardingContinuationVisible,
    openCampaignPurposePanel,
    openInferProblemTransformationPanel,
    openMarketingIntelligencePanel,
    openContextIntelligencePanel,
    openProblemTransformationPanel,
    openRefineProblemTransformationPanel,
    openTargetCustomerPanel,
    overallProfileCompletion,
    pendingProblemTransformationUpdates,
    problemTransformationAnswers,
    problemTransformationCompletion,
    problemTransformationInferInput,
    problemTransformationInferLoading,
    problemTransformationInferMessages,
    problemTransformationInferPanelOpen,
    problemTransformationLoading,
    problemTransformationPanelOpen,
    problemTransformationQuestions,
    profile,
    profileReview,
    profileReviewDue,
    refineProfile,
    refineStep,
    refinementHistory,
    refreshCompanies,
    removeOtherSocial,
    renderProblemTransformationAssistantMessage,
    reviewIntelligenceEnrichment,
    runIntelligenceEnrichment,
    router,
    saveProblemTransformation,
    saveIntelligenceContext,
    saveProfile,
    saveUserGuidance,
    selectedCompanyId,
    selectedCompanyName,
    sendCampaignPurposeMessage,
    sendMarketingIntelligenceMessage,
    sendContextIntelligenceMessage,
    sendProblemTransformationRefineMessage,
    sendTargetCustomerMessage,
    setCampaignPurposeInput,
    setCampaignPurposeLoading,
    setCampaignPurposeMessages,
    setCampaignPurposePanelOpen,
    setCompanyId,
    setCompanyIdCopied,
    setCompanySearchFilter,
    setCreateCompanyError,
    setCreateCompanyForm,
    setCreateCompanyLoading,
    setDraftProfile,
    setErrorMessage,
    setIsEditing,
    setIsLoading,
    setIsRefining,
    setIsSaving,
    setLastFetchError,
    setLastFetchStatus,
    setLatestRefinement,
    setMarketingIntelligenceChatLoading,
    setMarketingIntelligenceInput,
    setMarketingIntelligenceLoading,
    setMarketingIntelligenceMessages,
    setMarketingIntelligencePanelOpen,
    setContextIntelligenceChatLoading,
    setContextIntelligenceInput,
    setContextIntelligenceMessages,
    setContextIntelligencePanelOpen,
    setMissingFieldAnswers,
    setNotFound,
    setOverallProfileCompletion,
    setPendingProblemTransformationUpdates,
    setProblemTransformationAnswers,
    setProblemTransformationCompletion,
    setProblemTransformationInferInput,
    setProblemTransformationInferLoading,
    setProblemTransformationInferMessages,
    setProblemTransformationInferPanelOpen,
    setProblemTransformationLoading,
    setProblemTransformationPanelOpen,
    setProblemTransformationQuestions,
    setProfile,
    setRefineStep,
    setRefinementHistory,
    setSelectedCompanyId,
    setShowCompanyFactReviewPrompt,
    setShowCreateCompanyModal,
    setSuccessMessage,
    setTargetCustomerInput,
    setTargetCustomerLoading,
    setTargetCustomerMessages,
    setTargetCustomerPanelOpen,
    showCompanyFactReviewPrompt,
    showCreateCompanyModal,
    skipOnboardingRefinement,
    successMessage,
    targetCustomerInput,
    targetCustomerLoading,
    targetCustomerMessages,
    targetCustomerPanelOpen,
    toTitleCase,
    uiConfidence,
    uiOverallProfileCompletion,
    uiProblemTransformationCompletion,
    updateActiveProfile,
    updateIntelligenceContext,
    updateOtherSocial,
    user,
    userRole,
  } = d;

  const [factsLookupLoading, setFactsLookupLoading] = React.useState(false);
  const fillFactsFromWikidata = async () => {
    if (!companyId) return;
    setFactsLookupLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const response = await fetchWithAuth(
        `/api/company-profile/company-facts-lookup?companyId=${encodeURIComponent(companyId)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      const data = (await response.json().catch(() => null)) as
        | { facts?: { founded_year?: string | null; team_size?: string | null; revenue_range?: string | null }; matched_label?: string | null }
        | null;
      if (!response.ok || !data) throw new Error('Lookup failed');
      const facts = data.facts || {};
      const filled: string[] = [];
      // Only fill blanks — never overwrite what the user already entered.
      if (!companyFacts.founded_year && facts.founded_year) { handleCompanyFactChange('founded_year', facts.founded_year); filled.push('founded year'); }
      if (!companyFacts.team_size && facts.team_size) { handleCompanyFactChange('team_size', facts.team_size); filled.push('team size'); }
      if (!companyFacts.revenue_range && facts.revenue_range) { handleCompanyFactChange('revenue_range', facts.revenue_range); filled.push('revenue range'); }
      setIsEditing(true);
      setSuccessMessage(
        filled.length > 0
          ? `Filled ${filled.join(', ')} from Wikidata${data.matched_label ? ` (${data.matched_label})` : ''}. Review, add anything missing, then Save.`
          : 'No public firmographics found on Wikidata for this company — please fill these facts in manually, then Save.',
      );
    } catch (e) {
      setErrorMessage((e as Error).message || 'Could not look up company facts.');
    } finally {
      setFactsLookupLoading(false);
    }
  };

  const marketPulseSettings = activeProfile.report_settings?.market_pulse ?? {};
  const marketAlternativeLabels = (marketPulseSettings.market_alternatives ?? [])
    .slice(0, 3)
    .map((item) => [item.name, item.domain, item.category].filter(Boolean).join(' - '))
    .filter(Boolean);
  const competitorDetails = (marketPulseSettings.competitor_details ?? []).slice(0, 3);
  const competitorQuality = marketPulseSettings.competitor_quality ?? null;
  const unifiedCompetitorIntelligence = marketPulseSettings.unified_competitor_intelligence ?? null;
  const unifiedCompetitors = (unifiedCompetitorIntelligence?.competitors ?? []).slice(0, 5);
  const unifiedCompetitorOpportunities = (unifiedCompetitorIntelligence?.opportunities ?? []).slice(0, 3);
  const competitorScoreThreshold = Number(competitorQuality?.threshold ?? 85);
  const topCompetitorScore = competitorQuality?.highest_score ?? (
    competitorDetails.length
      ? Math.max(...competitorDetails.map((item) => Number(item.score ?? 0)))
      : null
  );
  const competitorThresholdMet = competitorQuality?.threshold_met ?? (
    topCompetitorScore != null ? topCompetitorScore >= competitorScoreThreshold : null
  );
  const displayedCompetitorText =
    joinList(activeProfile.competitors_list, activeProfile.competitors) ||
    competitorDetails.map((competitor) => competitor.name).filter(Boolean).join(', ');
  const lowConfidenceDomainContext = !competitorThresholdMet && (
    Boolean(marketPulseSettings.provider_type) ||
    Boolean(marketPulseSettings.domain_role) ||
    Boolean(marketPulseSettings.operating_model) ||
    Boolean((marketPulseSettings.solution_domains ?? []).length) ||
    marketAlternativeLabels.length > 0
  );
  const businessClassification =
    activeProfile.business_classification && typeof activeProfile.business_classification === 'object'
      ? activeProfile.business_classification
      : null;
  const filledSocialAccounts = SOCIAL_ACCOUNT_FIELDS
    .map((account) => ({
      ...account,
      value: String(activeProfile[account.field] || '').trim(),
    }))
    .filter((account) => account.value.length > 0);
  const socialPreviewAccounts = [
    ...filledSocialAccounts,
    ...SOCIAL_ACCOUNT_FIELDS.filter(
      (account) => !filledSocialAccounts.some((filled) => filled.field === account.field)
    ).map((account) => ({ ...account, value: '' })),
  ].slice(0, 2);
  const primarySocialKeys = new Set(
    SOCIAL_ACCOUNT_FIELDS
      .map((account) => {
        const normalized = normalizeProfileSocialUrl(String(activeProfile[account.field] || ''));
        return normalized ? `${account.platform}:${normalized}` : null;
      })
      .filter((key): key is string => Boolean(key)),
  );
  const discoveredSocialProfiles = dedupeSocialProfiles(activeProfile.social_profiles)
    .filter((entry) => !primarySocialKeys.has(`${entry.platform}:${entry.url}`));
  const hasValidCanonicalWebsite = React.useMemo(() => {
    return isValidCanonicalWebsite(activeProfile.website_url);
  }, [activeProfile.website_url]);
  const showOnboardingContinuation = !isOnboardingMode
    ? !isOnboardingResolving
    : onboardingContinuationVisible;
  const showStandardProfileActions = !isOnboardingMode || onboardingContinuationVisible;
  const isOnboardingPreRefine = isOnboardingMode && !showOnboardingContinuation;
  const intelligenceSettings = activeProfile.report_settings?.intelligence ?? {};
  const userGuidance = activeProfile.report_settings?.user_guidance ?? null;
  const industryReview = activeProfile.report_settings?.industry_review ?? null;
  const isPrivilegedWebsiteEditor = ['SUPER_ADMIN', 'CONTENT_ARCHITECT'].includes(String(userRole || '').toUpperCase());
  // Soft fallback: in onboarding, if no canonical website was auto-derived from the
  // verified work-email domain (e.g. the domain hosts no resolvable website), let the
  // user provide their own instead of being stuck on a read-only field. The server
  // (/api/company-profile) validates it and locks it once set — mirrored here.
  const canEditWebsiteUrl = isPrivilegedWebsiteEditor || (isOnboardingMode && !activeProfile.website_url);
  const guidedCompetitors = userGuidance?.competitors ?? [];
  const pinnedGuidedCompetitors = guidedCompetitors.filter((competitor) =>
    ['pinned', 'user_added', 'restored'].includes(competitor.state)
  );
  const rejectedGuidedCompetitors = guidedCompetitors.filter((competitor) =>
    ['rejected', 'removed'].includes(competitor.state)
  );
  const [guidedCompetitorName, setGuidedCompetitorName] = React.useState('');
  const [guidedCompetitorNote, setGuidedCompetitorNote] = React.useState('');
  const [identityGuidanceNote, setIdentityGuidanceNote] = React.useState('');
  const displayFieldValue = React.useCallback(
    (primary?: string | null, extracted?: string[] | null) => joinList(extracted, primary) || '',
    [],
  );
  const guidanceCompetitorKey = (value?: string | null) =>
    String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const saveGuidanceDraft = (
    nextGuidance: NonNullable<CompanyProfile['report_settings']>['user_guidance'],
    action: string,
    target?: string | null,
  ) => saveUserGuidance(nextGuidance ?? null, action, target);
  const updateGuidedCompetitor = (
    name: string,
    state: 'user_added' | 'pinned' | 'rejected' | 'removed' | 'restored',
    rationale?: string | null,
  ) => {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    const key = guidanceCompetitorKey(normalizedName);
    const existing = guidedCompetitors.filter((competitor) => guidanceCompetitorKey(competitor.name) !== key);
    saveGuidanceDraft({
      ...(userGuidance || { version: 1 }),
      competitors: [
        ...existing,
        {
          name: normalizedName,
          state,
          source: state === 'rejected' || state === 'removed' ? 'rejected' : 'user_guided',
          rationale: rationale?.trim() || null,
          updated_at: new Date().toISOString(),
        },
      ],
    }, `competitor_${state}`, normalizedName);
  };
  const approveStrategicField = (
    section: 'positioning' | 'differentiation' | 'messaging',
    field: 'brand_positioning' | 'competitive_advantages' | 'key_messages',
  ) => {
    const value = String(activeProfile[field] || '').trim();
    if (!value) return;
    saveGuidanceDraft({
      ...(userGuidance || { version: 1 }),
      messaging: {
        ...(userGuidance?.messaging || {}),
        [section]: {
          ai_value: value,
          approved_value: value,
          status: 'approved',
          updated_at: new Date().toISOString(),
        },
      },
    }, `approve_${section}`, field);
  };
  const addIdentityGuidance = () => {
    const text = identityGuidanceNote.trim();
    if (!text) return;
    saveGuidanceDraft({
      ...(userGuidance || { version: 1 }),
      guidance_notes: [
        ...(userGuidance?.guidance_notes || []),
        {
          id: `guidance-${Date.now()}`,
          text,
          category: 'identity',
          status: 'active',
          created_at: new Date().toISOString(),
        },
      ],
    }, 'add_identity_guidance', 'identity');
    setIdentityGuidanceNote('');
  };
  const actionableRefinementQuestions = React.useMemo(() => {
    const questions = latestRefinement?.missing_fields_questions ?? [];
    const seen = new Set<string>();

    return questions.filter((question) => {
      if (!question?.field || !question?.question) return false;
      if (!questionMatchesAnyInlineField(question)) return false;

      const key = normalizeQuestionFieldKey(`${question.field}:${question.question}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [latestRefinement]);

  const getRefinementQuestionsForField = React.useCallback(
    (fieldKey: InlineQuestionFieldKey) =>
      actionableRefinementQuestions.filter((question) =>
        questionMatchesInlineField(question, fieldKey)
      ),
    [actionableRefinementQuestions],
  );
  const [brandAssetUploading, setBrandAssetUploading] = React.useState<Record<BrandAssetField, boolean>>({
    logo_url: false,
    favicon_url: false,
  });
  const [brandAssetErrors, setBrandAssetErrors] = React.useState<Record<BrandAssetField, string | null>>({
    logo_url: null,
    favicon_url: null,
  });

  const setBrandAssetError = (field: BrandAssetField, message: string | null) => {
    setBrandAssetErrors((prev) => ({ ...prev, [field]: message }));
  };

  const clearBrandAsset = (field: BrandAssetField) => {
    if (!isEditing) {
      setIsEditing(true);
    }
    updateActiveProfile({ ...activeProfile, [field]: '' });
    setBrandAssetError(field, null);
    setSuccessMessage(`${BRAND_ASSET_SPECS[field].label} removed. Click Save Profile to persist the change.`);
  };

  const uploadBrandAsset = async (field: BrandAssetField, file: File | null) => {
    if (!file) return;
    if (!isEditing) {
      setIsEditing(true);
    }
    if (!user?.userId) {
      setBrandAssetError(field, 'Your session is missing a user id, so upload is unavailable right now.');
      return;
    }

    const spec = BRAND_ASSET_SPECS[field];
    const normalizedType = file.type.toLowerCase();
    const isAllowedType = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(normalizedType);
    if (!isAllowedType) {
      setBrandAssetError(field, 'Only PNG, JPG, or WebP images are supported here.');
      return;
    }
    if (file.size > spec.maxBytes) {
      setBrandAssetError(field, `${spec.label} must be ${formatFileSize(spec.maxBytes)} or smaller.`);
      return;
    }

    setBrandAssetError(field, null);
    setBrandAssetUploading((prev) => ({ ...prev, [field]: true }));

    try {
      const preparedAsset = await prepareTransparentBrandAsset(file, field);
      const { width, height } = preparedAsset;

      const formData = new FormData();
      formData.append('file', preparedAsset.file);
      formData.append('width', String(width));
      formData.append('height', String(height));

      const response = await fetchWithAuth('/api/media/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = Array.isArray(data?.details) && data.details.length > 0
          ? data.details.join(', ')
          : (typeof data?.message === 'string' && data.message.trim())
            ? data.message.trim()
            : (typeof data?.error === 'string' && data.error.trim())
              ? data.error.trim()
              : null;
        throw new Error(detail || `Failed to upload ${spec.label.toLowerCase()}.`);
      }

      const fileUrl =
        data?.data?.file_url ||
        data?.data?.storage_url ||
        data?.file_url ||
        data?.storage_url;
      if (!fileUrl) {
        throw new Error('Upload completed but no file URL was returned.');
      }

      const nextProfile = { ...activeProfile, [field]: fileUrl };
      updateActiveProfile(nextProfile);

      if (!companyId) {
        throw new Error('Select a company before uploading brand assets.');
      }

      const saveResponse = await fetchWithAuth('/api/company-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          company_id: companyId,
          [field]: fileUrl,
        }),
      });
      const saveData = await saveResponse.json().catch(() => null);
      if (!saveResponse.ok) {
        const detail =
          (typeof saveData?.error === 'string' && saveData.error.trim())
            ? saveData.error.trim()
            : (typeof saveData?.details === 'string' && saveData.details.trim())
              ? saveData.details.trim()
              : `Failed to save ${spec.label.toLowerCase()} to the company profile.`;
        throw new Error(detail);
      }

      const persistedProfile = saveData?.profile || nextProfile;
      updateActiveProfile(persistedProfile);
      setDraftProfile(persistedProfile);
      setProfile(persistedProfile);
      setNotFound(false);
      notifyCompanyProfileUpdated(persistedProfile?.company_id || companyId);
      setSuccessMessage(
        preparedAsset.autoRemovedBackground
          ? `${spec.label} uploaded, converted to a transparent PNG, and saved to this company profile.`
          : `${spec.label} uploaded and saved to this company profile.`,
      );
    } catch (error) {
      setBrandAssetError(
        field,
        error instanceof Error ? error.message : `Failed to upload ${spec.label.toLowerCase()}.`,
      );
    } finally {
      setBrandAssetUploading((prev) => ({ ...prev, [field]: false }));
    }
  };

  const renderInlineRefinementQuestions = (fieldKey: InlineQuestionFieldKey) => {
    const questions = getRefinementQuestionsForField(fieldKey);
    if (questions.length === 0) return null;

    return (
      <div className="mt-2 space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2">
        {questions.map((question, index) => {
          const selected = missingFieldAnswers[question.field] || [];
          const options = (question.options ?? []).filter(Boolean);

          return (
            <div key={`${fieldKey}-${question.field}-${index}`} className="space-y-1">
              <div className="text-xs font-medium text-indigo-900">{question.question}</div>
              {options.length > 0 ? (
                question.allow_multiple ? (
                  <select
                    multiple
                    value={selected}
                    onChange={(event) => {
                      const values = Array.from(event.target.selectedOptions).map(
                        (option) => option.value
                      );
                      handleMissingAnswer(question.field, values);
                    }}
                    className="w-full rounded-md border border-indigo-100 bg-white px-2 py-1 text-xs text-slate-800"
                  >
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={selected[0] || ''}
                    onChange={(event) =>
                      handleMissingAnswer(
                        question.field,
                        event.target.value ? [event.target.value] : []
                      )
                    }
                    className="w-full rounded-md border border-indigo-100 bg-white px-2 py-1 text-xs text-slate-800"
                  >
                    <option value="">Select an option</option>
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                )
              ) : (
                <div className="text-xs text-indigo-700">
                  Type the answer directly in this field.
                </div>
              )}
              {options.length > 0 && selected.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-slate-500">Selected:</span>
                  {selected.map((value) => (
                    <span
                      key={value}
                      className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white"
                    >
                      {value}
                      <button
                        type="button"
                        onClick={() => handleMissingAnswer(question.field, selected.filter((v) => v !== value))}
                        className="leading-none text-indigo-100 hover:text-white"
                        aria-label={`Remove ${value}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderOnboardingRefineAction = () => (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5">
      {isRefining ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-indigo-700">
            <svg className="animate-spin h-4 w-4 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Saving social links and enriching from your website
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-indigo-100">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-indigo-500" />
          </div>
          <p className="text-xs text-slate-600">This can take a short moment. The website remains locked and will not be overwritten.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h3 className="text-base font-semibold text-slate-900">Refine company profile with AI</h3>
            <p className="mt-1 text-sm text-slate-600">
              Share the company website and any public social URLs first. AI will use those sources to generate category, industry details, audience, positioning, products, content themes, and follow-up questions.
            </p>
            {!hasValidCanonicalWebsite && (
              <p className="mt-2 text-xs font-medium text-rose-700">A valid company website is required before refinement.</p>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row md:shrink-0">
            <button
              type="button"
              onClick={refineProfile}
              disabled={isSaving || isRefining || !hasValidCanonicalWebsite}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refine with AI
            </button>
            {isOnboardingMode && (
              <button
                type="button"
                onClick={skipOnboardingRefinement}
                disabled={isSaving || isRefining}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Skip for now
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="mx-auto mt-6 max-w-5xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <div className="mb-6 space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h1 className="text-3xl font-bold tracking-tight text-slate-950">Company Profile</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Keep your company profile current for trend relevance, recommendations, and Content Architect planning.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Last refined</div>
              <div className="mt-1 font-medium text-slate-900">{lastRefined}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Profile confidence"
              value={`${completionPercent(uiConfidence)}%`}
              tone="indigo"
            />
            <StatCard
              label="Profile completion"
              value={`${completionPercent(
                overallProfileCompletion ?? uiOverallProfileCompletion
              )}%`}
            />
            {canViewStrategicSections && (
              <StatCard
                label="Problem & transformation"
                value={`${completionPercent(
                  problemTransformationCompletion ?? uiProblemTransformationCompletion
                )}%`}
              />
            )}
            <StatCard
              label="Editing mode"
              value={isEditing ? 'Editing' : 'Viewing saved profile'}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-4">
            {[
              ['1', 'Source intake', 'Website, social accounts, public proof'],
              ['2', 'AI profile', 'Industry, audience, competitors, themes'],
              ['3', 'Guided chat', 'Customer, context, marketing, transformation'],
              ['4', 'Operating targets', 'Market Pulse and intelligence goals'],
            ].map(([step, title, detail]) => (
              <div key={step} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600">Step {step}</div>
                <div className="mt-1 font-semibold text-slate-950">{title}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{detail}</div>
              </div>
            ))}
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm p-3">
            {errorMessage}
          </div>
        )}
        {notFound && (
          <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm p-3">
            Company profile not found. Please create one.
          </div>
        )}
        {successMessage && (
          <div className="mb-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm p-3">
            {successMessage}
          </div>
        )}

        {latestRefinement && (
          <div className="mb-6 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5 text-sm text-indigo-900 space-y-4">
            <div className="space-y-1">
              <div className="text-lg font-semibold text-slate-900">Latest Refinement Insights</div>
              <div className="text-sm text-slate-600">
                Review the latest AI changes first, then open sources or unanswered questions only if you need deeper context.
              </div>
            </div>
            {latestRefinement.changed_fields && latestRefinement.changed_fields.length > 0 ? (
              <div>
                <div className="text-xs uppercase text-indigo-700 mb-2">Fields Updated</div>
                <ul className="list-disc list-inside space-y-1">
                  {latestRefinement.changed_fields.map((field) => (
                    <li key={field.field}>
                      <span className="font-medium">{field.field}</span> → {String(field.after)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-xs text-indigo-700">
                No field changes detected in the latest refinement.
              </div>
            )}
            {latestRefinement.source_summaries && latestRefinement.source_summaries.length > 0 && (
              <details className="bg-white rounded border border-indigo-200 p-3">
                <summary className="cursor-pointer text-sm font-medium">Sources used</summary>
                <div className="mt-2 space-y-2 text-xs text-gray-700">
                  {Array.from(
                    new Map(
                      latestRefinement.source_summaries.map((source) => [source.url, source])
                    ).values()
                  ).map((source, index) => (
                    <div key={`website_page-${source.url}-${index}`}>
                      <div className="font-semibold">{source.label}</div>
                      <div className="text-gray-500">{source.url}</div>
                      <div className="mt-1">{source.summary}</div>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {actionableRefinementQuestions.length > 0 && (
                <details className="bg-white rounded border border-indigo-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium">Missing fields</summary>
                  <div className="mt-2 space-y-3 text-xs text-gray-700">
                    {actionableRefinementQuestions.map((question, index) => (
                      <div key={`missing-${question.field}-${index}`} className="space-y-1">
                        <div className="font-semibold">{question.field}</div>
                        <div>{question.question}</div>
                        <div className="text-gray-500">
                          Options: {question.options?.join(', ') || 'N/A'}
                        </div>
                        {question.allow_multiple && (
                          <div className="text-gray-400">Multiple selections allowed</div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
          </div>
        )}

        {isLoading || isOnboardingResolving ? (
          <div className="text-sm text-gray-500">Loading profile...</div>
        ) : (
          <div className="space-y-6">
            <SectionCard
              title="Please Provide This Information"
              description="Provide the company website and public URLs AI should use. The generated company profile sections appear below after refinement."
            >
              <div className="space-y-5">
                <div>
                  <label className="text-sm font-medium text-gray-700">Website URL</label>
                  <input
                    value={activeProfile.website_url || ''}
                    readOnly={!canEditWebsiteUrl}
                    aria-readonly={!canEditWebsiteUrl}
                    onChange={(e) => {
                      if (canEditWebsiteUrl) handleChange('website_url', e.target.value);
                    }}
                    onBlur={(e) => {
                      if (canEditWebsiteUrl) normalizeUrlField('website_url', e.target.value);
                    }}
                    placeholder="https://yourcompany.com"
                    className={`mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm ${
                      canEditWebsiteUrl
                        ? 'bg-white text-slate-900'
                        : 'bg-slate-100 text-slate-600 cursor-not-allowed'
                    }`}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {isPrivilegedWebsiteEditor
                      ? 'Super admin and ContentArchi can update the canonical website. Other users can add social URLs but cannot edit this website.'
                      : canEditWebsiteUrl
                      ? "Enter your company website (e.g. https://yourcompany.com). We'll verify it and use it as the canonical AI refinement source. It locks once saved."
                      : activeProfile.website_url
                      ? 'Locked from company setup. For work emails, this is derived from the verified email domain and used as the canonical AI refinement source.'
                      : 'No canonical website is available. This should only happen for a super-admin approved exception; ask a super admin to add or approve the website before AI refinement.'}
                  </p>
                </div>

                <details className="rounded-xl border border-slate-200 bg-white p-4" open={isOnboardingPreRefine}>
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Social Accounts & Digital Footprint</div>
                        <div className="mt-1 text-xs text-slate-500">
                          Add LinkedIn, Facebook, Instagram, YouTube, blogs, newsletters, directories, communities, or other public URLs in one place. Refine with AI will also crawl the website and fill social accounts it discovers.
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {socialPreviewAccounts.map((account) => (
                          <span
                            key={account.field}
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                              account.value
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-slate-50 text-slate-500'
                            }`}
                            title={account.value || `Add ${account.label}`}
                          >
                            {account.label}{account.value ? ' added' : ' pending'}
                          </span>
                        ))}
                      </div>
                    </div>
                  </summary>
                  <div className="mt-4 space-y-5 border-t border-slate-100 pt-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {SOCIAL_ACCOUNT_FIELDS.map((account) => (
                        <div key={account.field}>
                          <label className="text-sm font-medium text-gray-700">{account.label}</label>
                          <input
                            value={String(activeProfile[account.field] || '')}
                            onChange={(e) => handleChange(account.field, e.target.value)}
                            onBlur={(e) => normalizeUrlField(account.field, e.target.value)}
                            placeholder={account.placeholder}
                            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium text-slate-800">Other public URLs</div>
                          <p className="mt-1 text-xs text-slate-500">Use this for blogs, newsletters, Crunchbase, G2, Clutch, podcasts, communities, or profile pages.</p>
                        </div>
                        <button
                          type="button"
                          onClick={addOtherSocial}
                          className="rounded bg-white px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100 hover:bg-indigo-50"
                        >
                          + Add URL
                        </button>
                      </div>
                      {(activeProfile.other_social_links || []).length === 0 && (
                        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-gray-500">
                          No additional public URLs added.
                        </div>
                      )}
                      <div className="space-y-2">
                        {(activeProfile.other_social_links || []).map((item, index) => (
                          <div key={`intake-social-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-5">
                            <input
                              value={item?.label || ''}
                              onChange={(e) => updateOtherSocial(index, 'label', e.target.value)}
                              placeholder="Label (e.g. Crunchbase)"
                              className="md:col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            />
                            <input
                              value={item?.url || ''}
                              onChange={(e) => updateOtherSocial(index, 'url', e.target.value)}
                              placeholder="https://..."
                              className="md:col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            />
                            {isEditing && (
                              <button
                                type="button"
                                onClick={() => removeOtherSocial(index)}
                                className="text-xs font-medium text-red-600"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>

              </div>
            </SectionCard>

            <SectionCard
              title="Brand Assets"
              description="Upload official logo and favicon assets after source intake so downstream content has the right brand marks."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {(['logo_url', 'favicon_url'] as BrandAssetField[]).map((field) => {
                  const spec = BRAND_ASSET_SPECS[field];
                  const assetUrl = activeProfile[field] || '';
                  const isUploading = brandAssetUploading[field];
                  const uploadError = brandAssetErrors[field];
                  const inputId = `brand-asset-${field}`;

                  return (
                    <div key={field} className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-slate-900">{spec.label}</div>
                          <div className="mt-1 text-xs text-slate-500">{spec.helper}</div>
                          <div className="mt-1 text-xs font-medium text-slate-700">{spec.recommendedSize}</div>
                        </div>
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                          {assetUrl ? (
                            <img
                              src={assetUrl}
                              alt={spec.label}
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] font-medium uppercase tracking-wide text-slate-400">
                              {field === 'logo_url' ? 'Logo' : 'Icon'}
                            </div>
                          )}
                        </div>
                      </div>

                      <input
                        id={inputId}
                        type="file"
                        accept={BRAND_ASSET_ACCEPT}
                        className="hidden"
                        onChange={(event) => {
                          void uploadBrandAsset(field, event.target.files?.[0] ?? null);
                          event.currentTarget.value = '';
                        }}
                      />

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <label
                          htmlFor={inputId}
                          className={`inline-flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm font-medium ${
                            !isUploading
                              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                              : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {isUploading ? 'Uploading...' : assetUrl ? `Replace ${spec.label}` : `Upload ${spec.label}`}
                        </label>
                        {assetUrl && isEditing && (
                          <button
                            type="button"
                            onClick={() => clearBrandAsset(field)}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Remove
                          </button>
                        )}
                        {assetUrl && (
                          <a
                            href={assetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-medium text-indigo-600 hover:underline"
                          >
                            Open asset
                          </a>
                        )}
                      </div>

                      {uploadError && (
                        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                          {uploadError}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            {renderOnboardingRefineAction()}

            {showOnboardingContinuation && (
              <SectionCard
                title="Guided Capture"
                description="Use chat when a section needs business judgment instead of website extraction. Each flow writes back to its own section for review before saving."
                accent="indigo"
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  {([
                    ['Customer', 'ICP and sales model', openTargetCustomerPanel],
                    ['Context', 'Markets and dependencies', openContextIntelligencePanel],
                    ['Marketing', 'Positioning and campaigns', openMarketingIntelligencePanel],
                    ['Transformation', 'Problem and authority', openRefineProblemTransformationPanel],
                  ] as Array<[string, string, () => void]>).map(([label, detail, action]) => (
                    <button
                      key={String(label)}
                      type="button"
                      onClick={action}
                      className="rounded-xl border border-indigo-100 bg-white px-4 py-3 text-left shadow-sm hover:border-indigo-300"
                    >
                      <div className="text-sm font-semibold text-slate-950">{label}</div>
                      <div className="mt-1 text-xs text-slate-500">{detail}</div>
                    </button>
                  ))}
                </div>
              </SectionCard>
            )}

            <SectionCard
              title="AI-Populated Company Profile"
              description={
                isOnboardingPreRefine
                  ? 'These fields appear after AI refinement uses the website and public URLs above.'
                  : 'Start with company identity, official links, and core firmographic context so Content Architect has a reliable working base.'
              }
            >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className={isOnboardingPreRefine ? 'md:col-span-2' : ''}>
                <label className="text-sm font-medium text-gray-700">Company</label>
                {canSelectMultipleCompanies && (
                  <input
                    type="text"
                    placeholder="Search companies..."
                    value={companySearchFilter}
                    onChange={(e) => setCompanySearchFilter(e.target.value)}
                    className="mt-1 mb-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                )}
                <select
                  value={companyId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedCompanyId(nextId);
                    setCompanyId(nextId);
                    updateActiveProfile({ ...activeProfile, company_id: nextId });
                  }}
                  disabled={(!isAdmin && !isContentArchitect) || isCompanyLoading}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100"
                >
                  <option value="">Select company</option>
                  {filteredCompanies.map((company) => (
                    <option key={company.company_id} value={company.company_id}>
                      {company.name}
                    </option>
                  ))}
                </select>
                {canCreateCompany && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateCompanyModal(true)}
                      className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      + Create new company
                    </button>
                  </div>
                )}
                {companyId && (isAdmin || isContentArchitect) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      href="/campaigns"
                      className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      View campaigns &amp; weekly/daily plans →
                    </Link>
                  </div>
                )}
                {!isAdmin && !isContentArchitect && selectedCompanyName && (
                  <div className="text-xs text-gray-500 mt-1">Company locked for your role.</div>
                )}
                {isCompanyAdmin && companies.length > 0 && !companyId && (
                  <div className="text-xs text-amber-600 mt-1">Select your company above to view limited profile and go to campaigns.</div>
                )}
                {companyId && (
                  <div className="mt-3 pt-2 border-t border-gray-100">
                    <label className="text-sm font-medium text-gray-500 block mb-1">Company ID</label>
                    <div className="flex items-center gap-2">
                      <code
                        className="text-xs bg-gray-100 text-gray-800 px-2 py-1.5 rounded font-mono truncate flex-1"
                        title={companyId}
                      >
                        {companyId}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                            navigator.clipboard.writeText(companyId);
                            setCompanyIdCopied(true);
                            setTimeout(() => setCompanyIdCopied(false), 2000);
                          }
                        }}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium shrink-0"
                      >
                        {companyIdCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Use this ID to open this company from Content Architect search or share the profile link.</p>
                  </div>
                )}
              </div>
              {/* View/Edit mode indicator */}
              {!isEditing && (
                <div className="col-span-full flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  Viewing saved profile — click <strong className="text-gray-700 mx-1">Edit Profile</strong> below to make changes.
                </div>
              )}
              {!isOnboardingPreRefine && (
              <div>
                <label className="text-sm font-medium text-gray-700">Company Name</label>
                <input
                  value={activeProfile.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              )}
              {!isOnboardingPreRefine && (
                <>
              <div>
                <label className="text-sm font-medium text-gray-700">Industry</label>
                <input
                  value={displayFieldValue(activeProfile.industry, activeProfile.industry_list)}
                  onChange={(e) => handleChange('industry', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {renderInlineRefinementQuestions('industry')}
                {industryReview?.conflict && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <div className="font-semibold">Industry review needed</div>
                    <div className="mt-1">
                      User profile industry is <span className="font-medium">{industryReview.user_industry || 'not set'}</span>, while website/social evidence suggests <span className="font-medium">{industryReview.ai_suggested_industry || 'a different industry'}</span>.
                    </div>
                    {industryReview.ai_suggested_industry ? (
                      <button
                        type="button"
                        onClick={() => handleChange('industry', industryReview.ai_suggested_industry || '')}
                        className="mt-2 rounded border border-amber-300 bg-white px-2 py-1 font-medium text-amber-900 hover:bg-amber-100"
                      >
                        Use AI-suggested industry
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Category</label>
                <input
                  value={displayFieldValue(activeProfile.category, activeProfile.category_list)}
                  onChange={(e) => handleChange('category', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {renderInlineRefinementQuestions('category')}
              </div>
                </>
              )}
              {!isOnboardingPreRefine && businessClassification && (
                <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-sm font-semibold text-slate-900">Business Classification</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                      Business model: {formatBusinessClassificationLabel(businessClassification.level_1)}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                      Type: {formatBusinessClassificationLabel(businessClassification.level_2)}
                    </span>
                    {(businessClassification.level_3 || []).slice(0, 2).map((domain) => (
                      <span
                        key={domain}
                        className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700"
                      >
                        Domain: {formatBusinessClassificationLabel(domain)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {!isOnboardingPreRefine && (
              <div>
                <label className="text-sm font-medium text-gray-700">Geography</label>
                <input
                  value={displayFieldValue(activeProfile.geography, activeProfile.geography_list)}
                  onChange={(e) => handleChange('geography', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {renderInlineRefinementQuestions('geography')}
            </div>
              )}
            </div>
            </SectionCard>

            {showOnboardingContinuation ? (
              <>
            <SectionCard
              title="Company Facts"
              description="These confirmed business facts support competitor analysis, market positioning, and downstream recommendation quality."
            >
            <div className="border rounded-xl p-4 bg-slate-50">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between mb-3">
                <div>
                  <p className="text-xs text-gray-500">
                    These are firmographic facts used in competitor intelligence and should be confirmed by a company admin every 6 months.
                  </p>
                </div>
                <div className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                  profileReviewDue ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {profileReviewDue ? 'Admin confirmation due' : 'Admin confirmed'}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Team size</label>
                  <input
                    value={companyFacts.team_size || ''}
                    onChange={(e) => handleCompanyFactChange('team_size', e.target.value)}
                    placeholder="e.g. 11-50"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Founded year</label>
                  <input
                    value={companyFacts.founded_year || ''}
                    onChange={(e) => handleCompanyFactChange('founded_year', e.target.value)}
                    placeholder="e.g. 2022"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Revenue range</label>
                  <input
                    value={companyFacts.revenue_range || ''}
                    onChange={(e) => handleCompanyFactChange('revenue_range', e.target.value)}
                    placeholder="e.g. $1M-$5M"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { void fillFactsFromWikidata(); }}
                  disabled={factsLookupLoading}
                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 disabled:opacity-50"
                >
                  {factsLookupLoading ? 'Checking Wikidata…' : 'Fill from Wikidata'}
                </button>
                <span className="text-[11px] text-gray-500">Pulls founded year / size / revenue from public data where available; fill the rest in yourself.</span>
              </div>
              <div className="mt-3 text-xs text-gray-500">
                Last confirmed: {profileReview.last_confirmed_at ? new Date(profileReview.last_confirmed_at).toLocaleDateString() : 'Not confirmed yet'}
                {' · '}
                Next due: {profileReview.next_confirmation_due_at ? new Date(profileReview.next_confirmation_due_at).toLocaleDateString() : 'After first admin confirmation'}
              </div>
            </div>
            </SectionCard>

            <SectionCard
              title="Messaging & Audience"
              description="These are the main inputs Content Architect will keep revisiting when building messaging, themes, and competitor-aware campaign directions."
            >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-gray-700">Products & Services</label>
              <textarea
                value={displayFieldValue(activeProfile.products_services, activeProfile.products_services_list)}
                onChange={(e) => handleChange('products_services', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {renderInlineRefinementQuestions('products_services')}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Target Audience</label>
              <textarea
                value={displayFieldValue(activeProfile.target_audience, activeProfile.target_audience_list)}
                onChange={(e) => handleChange('target_audience', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {renderInlineRefinementQuestions('target_audience')}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Brand Voice</label>
              <textarea
                value={displayFieldValue(activeProfile.brand_voice, activeProfile.brand_voice_list)}
                onChange={(e) => handleChange('brand_voice', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {renderInlineRefinementQuestions('brand_voice')}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Goals</label>
              <textarea
                value={displayFieldValue(activeProfile.goals, activeProfile.goals_list)}
                onChange={(e) => handleChange('goals', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {renderInlineRefinementQuestions('goals')}
            </div>
            {(canViewStrategicSections || isCompanyAdmin) && (
              <div>
                <label className="text-sm font-medium text-gray-700">Competitors</label>
                <textarea
                  value={displayedCompetitorText}
                  onChange={(e) => handleChange('competitors', e.target.value)}
                  rows={2}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {(competitorDetails.length > 0 || lowConfidenceDomainContext) ? (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800">
                        Top match: {topCompetitorScore != null ? `${Math.round(topCompetitorScore)}%` : 'Not scored'}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${
                        competitorThresholdMet ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {competitorThresholdMet ? `${Math.round(competitorScoreThreshold)}%+ match` : `Below ${Math.round(competitorScoreThreshold)}%`}
                      </span>
                    </div>
                    {competitorDetails.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {competitorDetails.map((competitor) => (
                        <span
                          key={competitor.name}
                          className="rounded-full border border-slate-200 bg-white px-2 py-1"
                        >
                          {competitor.name}: {Math.round(Number(competitor.score ?? 0))}%
                          {!competitorThresholdMet && competitor.domain ? (
                            <span className="ml-1 text-slate-500">({competitor.domain})</span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                    ) : null}
                    {lowConfidenceDomainContext ? (
                      <div className="mt-2">
                        <div className="font-semibold text-slate-800">Domain context</div>
                        <div className="mt-1 space-y-1">
                          {marketPulseSettings.provider_type ? <div>Provider type: {marketPulseSettings.provider_type}</div> : null}
                          {marketPulseSettings.domain_role ? <div>Domain role: {marketPulseSettings.domain_role}</div> : null}
                          {marketPulseSettings.operating_model ? <div>Operating model: {marketPulseSettings.operating_model}</div> : null}
                          {(marketPulseSettings.solution_domains ?? []).length > 0 ? (
                            <div>Solution domains: {(marketPulseSettings.solution_domains ?? []).join(', ')}</div>
                          ) : null}
                          {marketAlternativeLabels.length > 0 ? (
                            <div>Expanded context: {marketAlternativeLabels.join(', ')}</div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {unifiedCompetitorIntelligence ? (
                  <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50/70 p-3 text-xs text-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-sky-950">Live competitor intelligence</div>
                        <div className="mt-0.5 text-sky-800">{unifiedCompetitorIntelligence.summary}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 font-semibold ${
                        unifiedCompetitorIntelligence.status === 'ready'
                          ? 'bg-emerald-100 text-emerald-700'
                          : unifiedCompetitorIntelligence.status === 'limited'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                      }`}>
                        {unifiedCompetitorIntelligence.status}
                      </span>
                    </div>
                    {unifiedCompetitors.length > 0 ? (
                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {unifiedCompetitors.map((competitor) => (
                          <div key={`${competitor.domain || competitor.name}-unified`} className="rounded-lg border border-sky-100 bg-white p-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-semibold text-slate-900">{competitor.name}</div>
                                <div className="text-slate-500">{competitor.domain || 'Profile competitor'}</div>
                              </div>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                                {competitor.confidence}
                              </span>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-1 text-slate-700">
                              <div>Visibility: {competitor.scores.visibility_share}</div>
                              <div>Threat: {competitor.scores.discoverability_threat}</div>
                              <div>Authority gap: {competitor.scores.authority_gap}</div>
                              <div>Lead intent: {competitor.scores.commercial_overlap}</div>
                            </div>
                            <div className="mt-1 text-slate-500">
                              {competitor.sources.join(', ')} · {competitor.freshness}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 rounded-lg border border-sky-100 bg-white px-2 py-2 text-slate-600">
                        No verified live competitor overlap yet.
                      </div>
                    )}
                    {unifiedCompetitorOpportunities.length > 0 ? (
                      <div className="mt-3">
                        <div className="font-semibold text-sky-950">Competitor opportunities</div>
                        <div className="mt-2 space-y-2">
                          {unifiedCompetitorOpportunities.map((opportunity) => (
                            <div key={opportunity.id} className="rounded-lg border border-sky-100 bg-white px-2 py-2">
                              <div className="font-semibold text-slate-900">{opportunity.title}</div>
                              <div className="mt-1 text-slate-700">{opportunity.recommendation}</div>
                              <div className="mt-1 text-slate-500">
                                Priority {opportunity.priority_score} · {opportunity.confidence} confidence
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-indigo-950">AI competitor corrections</div>
                      <div className="text-xs text-indigo-800">Pin real competitors or mark weak suggestions so future refinement uses the signal.</div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                    <input
                      value={guidedCompetitorName}
                      onChange={(e) => setGuidedCompetitorName(e.target.value)}
                      placeholder="Competitor name or domain"
                      className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"
                    />
                    <input
                      value={guidedCompetitorNote}
                      onChange={(e) => setGuidedCompetitorNote(e.target.value)}
                      placeholder="Why it matters, optional"
                      className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        updateGuidedCompetitor(guidedCompetitorName, 'pinned', guidedCompetitorNote);
                        setGuidedCompetitorName('');
                        setGuidedCompetitorNote('');
                      }}
                      disabled={!guidedCompetitorName.trim() || isSaving}
                      className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Pin
                    </button>
                  </div>
                  {competitorDetails.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {competitorDetails.map((competitor) => (
                        <span key={`guide-${competitor.name}`} className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-2 py-1 text-xs text-indigo-900">
                          {competitor.name}
                          <button
                            type="button"
                            onClick={() => updateGuidedCompetitor(competitor.name, 'pinned', competitor.rationale || null)}
                            className="font-semibold text-emerald-700"
                          >
                            Pin
                          </button>
                          <button
                            type="button"
                            onClick={() => updateGuidedCompetitor(competitor.name, 'rejected', 'Marked irrelevant by user.')}
                            className="font-semibold text-rose-700"
                          >
                            Reject
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {(pinnedGuidedCompetitors.length > 0 || rejectedGuidedCompetitors.length > 0) && (
                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-indigo-900 md:grid-cols-2">
                      <div>
                        <div className="font-semibold">Pinned</div>
                        <div className="mt-1">{pinnedGuidedCompetitors.map((competitor) => competitor.name).join(', ') || 'None'}</div>
                      </div>
                      <div>
                        <div className="font-semibold">Rejected</div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {rejectedGuidedCompetitors.length === 0 ? 'None' : rejectedGuidedCompetitors.map((competitor) => (
                            <button
                              key={`restore-${competitor.name}`}
                              type="button"
                              onClick={() => updateGuidedCompetitor(competitor.name, 'restored', 'Restored by user.')}
                              className="rounded-full border border-indigo-200 bg-white px-2 py-1"
                            >
                              Restore {competitor.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-gray-700">Unique Value</label>
              <textarea
                value={activeProfile.unique_value || ''}
                onChange={(e) => handleChange('unique_value', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {renderInlineRefinementQuestions('unique_value')}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Content Themes</label>
              <textarea
                value={displayFieldValue(activeProfile.content_themes, activeProfile.content_themes_list)}
                onChange={(e) => handleChange('content_themes', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {renderInlineRefinementQuestions('content_themes')}
            </div>
            </div>
            </SectionCard>

            <CompanyStrategyProfileCard
              companyId={companyId || activeProfile.company_id}
              profile={activeProfile}
              latestRefinement={latestRefinement}
              fetchWithAuth={fetchWithAuth}
              onProfileUpdated={updateActiveProfile}
              onNotifyUpdated={notifyCompanyProfileUpdated}
              onSuccess={setSuccessMessage}
              onError={setErrorMessage}
            />

            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Commercial Strategy</h3>
              <p className="text-sm text-gray-600 mb-4">
                Define your target customer and commercial model. These fields are locked from AI overwrite once you save.
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={openTargetCustomerPanel}
                  className="px-4 py-2 bg-indigo-100 text-indigo-800 rounded-lg text-sm font-medium hover:bg-indigo-200"
                >
                  Define Target Customer
                </button>
              </div>
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-800 mb-2">Campaign Purpose & Strategic Intent</h4>
                {activeProfile.campaign_purpose_intent ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-700">Primary Objective:</span>{' '}
                      {activeProfile.campaign_purpose_intent.primary_objective || '—'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Campaign Intent:</span>{' '}
                      {activeProfile.campaign_purpose_intent.campaign_intent || '—'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Monetization Intent:</span>{' '}
                      {activeProfile.campaign_purpose_intent.monetization_intent || '—'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Dominant Problems:</span>{' '}
                      {(activeProfile.campaign_purpose_intent.dominant_problem_domains ?? []).length > 0
                        ? activeProfile.campaign_purpose_intent.dominant_problem_domains!.join(', ')
                        : '—'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Positioning Angle:</span>{' '}
                      {activeProfile.campaign_purpose_intent.brand_positioning_angle || '—'}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openCampaignPurposePanel}
                    className="px-4 py-2 bg-amber-100 text-amber-800 rounded-lg text-sm font-medium hover:bg-amber-200"
                  >
                    Define Strategic Purpose
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Target customer segment</label>
                  <input
                    value={activeProfile.target_customer_segment || ''}
                    onChange={(e) => handleChange('target_customer_segment', e.target.value)}
                    placeholder="e.g. SMB, enterprise"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Ideal customer profile</label>
                  <textarea
                    value={activeProfile.ideal_customer_profile || ''}
                    onChange={(e) => handleChange('ideal_customer_profile', e.target.value)}
                    placeholder="1–2 sentences"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Pricing model</label>
                  <input
                    value={activeProfile.pricing_model || ''}
                    onChange={(e) => handleChange('pricing_model', e.target.value)}
                    placeholder="e.g. subscription, usage-based"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Sales motion</label>
                  <input
                    value={activeProfile.sales_motion || ''}
                    onChange={(e) => handleChange('sales_motion', e.target.value)}
                    placeholder="e.g. self-serve, sales-led"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Avg deal size</label>
                  <input
                    value={activeProfile.avg_deal_size || ''}
                    onChange={(e) => handleChange('avg_deal_size', e.target.value)}
                    placeholder="e.g. $5k, $50k"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Sales cycle</label>
                  <input
                    value={activeProfile.sales_cycle || ''}
                    onChange={(e) => handleChange('sales_cycle', e.target.value)}
                    placeholder="e.g. 2 weeks, 3 months"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Key metrics</label>
                  <input
                    value={activeProfile.key_metrics || ''}
                    onChange={(e) => handleChange('key_metrics', e.target.value)}
                    placeholder="e.g. MRR, CAC, LTV"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {activeProfile.last_edited_by === 'user' && (
                <p className="text-xs text-gray-500 mt-2">
                  Last edited by you; refinement will not overwrite locked commercial fields.
                </p>
              )}
            </div>

            {(canViewStrategicSections || isCompanyAdmin) && (
              <IntelligenceContextSections
                context={intelligenceContext}
                readiness={intelligenceReadiness}
                loading={intelligenceContextLoading}
                saving={intelligenceContextSaving}
                isEditing={isEditing}
                quality={contextQuality}
                suggestions={enrichmentSuggestions}
                enrichmentLoading={enrichmentLoading}
                enrichmentReviewingId={enrichmentReviewingId}
                onChange={updateIntelligenceContext}
                onSave={() => { void saveIntelligenceContext(); }}
                onRunEnrichment={() => { void runIntelligenceEnrichment(); }}
                onOpenGuidedCapture={openContextIntelligencePanel}
                onReviewSuggestion={(suggestionId, action) => { void reviewIntelligenceEnrichment(suggestionId, action); }}
                onRequestEdit={() => setIsEditing(true)}
              />
            )}

            {canViewStrategicSections && (
            <SectionCard
              title="Market Pulse Defaults"
              description="Business context used to make Market Pulse more relevant and less noisy — market focus comes from Geography and competitors from Competitors above; this only keeps the extra strategic signals."
              collapsible
              defaultOpen={false}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Business model</label>
                  <input
                    value={marketPulseSettings.business_model || ''}
                    onChange={(e) => handleMarketPulseSettingChange('business_model', e.target.value)}
                    placeholder="e.g. SaaS, services, marketplace"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Provider type</label>
                  <input
                    value={marketPulseSettings.provider_type || ''}
                    onChange={(e) => handleMarketPulseSettingChange('provider_type', e.target.value)}
                    placeholder="e.g. AI-powered solution provider"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Domain role</label>
                  <input
                    value={marketPulseSettings.domain_role || ''}
                    onChange={(e) => handleMarketPulseSettingChange('domain_role', e.target.value)}
                    placeholder="e.g. AI-powered problem-solution provider"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Operating model</label>
                  <input
                    value={marketPulseSettings.operating_model || ''}
                    onChange={(e) => handleMarketPulseSettingChange('operating_model', e.target.value)}
                    placeholder="e.g. AI software platform"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Solution domains</label>
                  <textarea
                    value={joinList(marketPulseSettings.solution_domains)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('solution_domains', e.target.value)}
                    placeholder="Comma-separated: mental clarity, decision support"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Market alternatives</label>
                  <textarea
                    value={marketAlternativeLabels.join(', ')}
                    readOnly
                    placeholder="Generated during refinement"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Core offerings</label>
                  <textarea
                    value={joinList(marketPulseSettings.core_offerings)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('core_offerings', e.target.value)}
                    placeholder="Comma-separated: recruitment services, visa support"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Growth priorities</label>
                  <textarea
                    value={joinList(marketPulseSettings.growth_priorities)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('growth_priorities', e.target.value)}
                    placeholder="Comma-separated: expansion, partnerships, demand growth"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Partnership priorities</label>
                  <textarea
                    value={joinList(marketPulseSettings.partnership_priorities)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('partnership_priorities', e.target.value)}
                    placeholder="Comma-separated: channel partners, integration partners"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Critical hiring functions</label>
                  <textarea
                    value={joinList(marketPulseSettings.critical_hiring_functions)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('critical_hiring_functions', e.target.value)}
                    placeholder="Comma-separated: engineering, delivery, immigration consultants"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Regulatory / policy sensitivity</label>
                  <textarea
                    value={joinList(marketPulseSettings.regulatory_policy_sensitivity)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('regulatory_policy_sensitivity', e.target.value)}
                    placeholder="Comma-separated: visas, labor laws, data privacy"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Default Market Pulse categories</label>
                  <textarea
                    value={joinList(marketPulseSettings.default_categories)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('default_categories', e.target.value)}
                    placeholder="Comma-separated: competitor_moves, growth_expansion"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Preferred regions</label>
                  <textarea
                    value={joinList(marketPulseSettings.preferred_regions)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('preferred_regions', e.target.value)}
                    placeholder="Comma-separated: US, CA, UK"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Exclusions</label>
                  <textarea
                    value={joinList(marketPulseSettings.exclusions)}
                    onChange={(e) => handleMarketPulseSettingArrayChange('exclusions', e.target.value)}
                    placeholder="Comma-separated: crypto, consumer retail, LATAM"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </SectionCard>
            )}

            {canViewStrategicSections && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Marketing Intelligence</h3>
              <p className="text-sm text-gray-600 mb-4">
                AI-generated marketing insights from your profile and commercial strategy. Use <strong>Refine with AI</strong> to answer guided questions in a chat, or <strong>Generate Marketing Intelligence</strong> to fill from profile in one shot. Save to persist and lock from refinement overwrite.
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={openMarketingIntelligencePanel}
                  disabled={marketingIntelligenceLoading || marketingIntelligenceChatLoading}
                  className="px-4 py-2 bg-emerald-100 text-emerald-800 rounded-lg text-sm font-medium hover:bg-emerald-200 disabled:opacity-50"
                >
                  Refine with AI
                </button>
                <button
                  type="button"
                  onClick={generateMarketingIntelligence}
                  disabled={marketingIntelligenceLoading || marketingIntelligenceChatLoading}
                  className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                >
                  {marketingIntelligenceLoading ? 'Generating...' : 'Generate Marketing Intelligence'}
                </button>
              </div>
              {marketingIntelligenceLoading && (
                <div className="mb-4">
                  <AIGenerationProgress
                    isActive={true}
                    message="Generating marketing intelligence…"
                    expectedSeconds={50}
                  />
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Marketing channels</label>
                  <input
                    value={activeProfile.marketing_channels || ''}
                    onChange={(e) => handleChange('marketing_channels', e.target.value)}
                    placeholder="e.g. social, email, events"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Content strategy</label>
                  <textarea
                    value={activeProfile.content_strategy || ''}
                    onChange={(e) => handleChange('content_strategy', e.target.value)}
                    placeholder="High-level content approach"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Campaign focus</label>
                  <input
                    value={activeProfile.campaign_focus || ''}
                    onChange={(e) => handleChange('campaign_focus', e.target.value)}
                    placeholder="What campaigns typically focus on"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Key messages</label>
                  <textarea
                    value={activeProfile.key_messages || ''}
                    onChange={(e) => handleChange('key_messages', e.target.value)}
                    placeholder="Core messages to convey"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Brand positioning</label>
                  <textarea
                    value={activeProfile.brand_positioning || ''}
                    onChange={(e) => handleChange('brand_positioning', e.target.value)}
                    placeholder="How the brand wants to be perceived"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Competitive advantages</label>
                  <textarea
                    value={activeProfile.competitive_advantages || ''}
                    onChange={(e) => handleChange('competitive_advantages', e.target.value)}
                    placeholder="Differentiators vs competitors"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-indigo-950">AI messaging corrections</div>
                      <div className="text-xs text-indigo-800">Approve or guide the generated identity so future refinement keeps the intended positioning.</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => approveStrategicField('messaging', 'key_messages')}
                        disabled={!String(activeProfile.key_messages || '').trim() || isSaving}
                        className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-800 disabled:opacity-50"
                      >
                        Approve messages
                      </button>
                      <button
                        type="button"
                        onClick={() => approveStrategicField('positioning', 'brand_positioning')}
                        disabled={!String(activeProfile.brand_positioning || '').trim() || isSaving}
                        className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-800 disabled:opacity-50"
                      >
                        Approve positioning
                      </button>
                      <button
                        type="button"
                        onClick={() => approveStrategicField('differentiation', 'competitive_advantages')}
                        disabled={!String(activeProfile.competitive_advantages || '').trim() || isSaving}
                        className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-800 disabled:opacity-50"
                      >
                        Approve differentiation
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                    <input
                      value={identityGuidanceNote}
                      onChange={(e) => setIdentityGuidanceNote(e.target.value)}
                      placeholder="Example: avoid corporate tone, publication-first, target operators not startups"
                      className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={addIdentityGuidance}
                      disabled={!identityGuidanceNote.trim() || isSaving}
                      className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Add guidance
                    </button>
                  </div>
                  {(userGuidance?.guidance_notes?.length || Object.keys(userGuidance?.messaging || {}).length) ? (
                    <div className="mt-2 text-xs text-indigo-900">
                      Saved guidance active for future refinement.
                    </div>
                  ) : null}
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Growth priorities</label>
                  <textarea
                    value={activeProfile.growth_priorities || ''}
                    onChange={(e) => handleChange('growth_priorities', e.target.value)}
                    placeholder="Marketing/growth priorities"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
            )}

            {canViewStrategicSections && (
            <SectionCard
              title="Intelligence Operating Target"
              description="The target the Intelligence page optimizes against — set the main objective, target metric, and time horizon so it can tell whether the company is behind, on track, or ahead."
              collapsible
              defaultOpen={false}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Primary objective</label>
                  <select
                    value={intelligenceSettings.primary_objective || ''}
                    onChange={(e) => handleIntelligenceSettingChange('primary_objective', e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Select objective</option>
                    <option value="authority_growth">Authority growth</option>
                    <option value="engagement_growth">Engagement growth</option>
                    <option value="lead_generation">Lead generation</option>
                    <option value="pipeline_growth">Pipeline growth</option>
                    <option value="revenue_acceleration">Revenue acceleration</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Primary target metric</label>
                  <select
                    value={intelligenceSettings.primary_target_metric || ''}
                    onChange={(e) => handleIntelligenceSettingChange('primary_target_metric', e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Select metric</option>
                    <option value="qualified_leads">Qualified leads</option>
                    <option value="active_leads">Active leads</option>
                    <option value="engagement_rate">Engagement rate</option>
                    <option value="campaigns_ready_to_scale">Campaigns ready to scale</option>
                    <option value="content_velocity">Content velocity</option>
                    <option value="authority_depth">Authority depth</option>
                    <option value="pipeline_value">Pipeline value</option>
                    <option value="revenue">Revenue</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Target value</label>
                  <input
                    value={intelligenceSettings.target_value || ''}
                    onChange={(e) => handleIntelligenceSettingChange('target_value', e.target.value)}
                    placeholder="e.g. 30 leads, 12 opportunities, $100k"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Time horizon</label>
                  <select
                    value={intelligenceSettings.time_horizon || 'monthly'}
                    onChange={(e) => handleIntelligenceSettingChange('time_horizon', e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Target note</label>
                  <textarea
                    value={intelligenceSettings.target_note || ''}
                    onChange={(e) => handleIntelligenceSettingChange('target_note', e.target.value)}
                    placeholder="Explain what success looks like, what kind of leads matter, or what commercial outcome should improve."
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </SectionCard>
            )}

            {canViewStrategicSections && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Problem & Transformation</h3>
              <p className="text-sm text-gray-600 mb-4">
                Core problem, pain symptoms, and desired transformation used for recommendation alignment.
                <br />
                <strong>Fill with AI</strong> asks guided questions and structures answers.
                <strong> Refine with AI</strong> suggests improvements and applies only after your agreement.
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={openInferProblemTransformationPanel}
                  disabled={!companyId || problemTransformationInferLoading}
                  className="px-4 py-2 bg-indigo-100 text-indigo-800 rounded-lg text-sm font-medium hover:bg-indigo-200 disabled:opacity-50"
                >
                  Infer from Profile
                </button>
                <button
                  type="button"
                  onClick={openProblemTransformationPanel}
                  disabled={!companyId || problemTransformationLoading}
                  className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                >
                  Fill with AI
                </button>
                <button
                  type="button"
                  onClick={openRefineProblemTransformationPanel}
                  disabled={!companyId || problemTransformationInferLoading}
                  className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                >
                  Refine with AI
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Core Problem Statement</label>
                  <textarea
                    value={activeProfile.core_problem_statement || ''}
                    onChange={(e) => handleChange('core_problem_statement', e.target.value)}
                    placeholder="One sentence: the core problem you solve"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Pain Symptoms</label>
                  <textarea
                    value={joinList(activeProfile.pain_symptoms)}
                    onChange={(e) => handleChangeArray('pain_symptoms', e.target.value)}
                    placeholder="Comma-separated: scope creep, delays, resource conflicts"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Awareness Gap</label>
                  <input
                    value={activeProfile.awareness_gap || ''}
                    onChange={(e) => handleChange('awareness_gap', e.target.value)}
                    placeholder="What target audience doesn't yet know"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Problem Impact</label>
                  <input
                    value={activeProfile.problem_impact || ''}
                    onChange={(e) => handleChange('problem_impact', e.target.value)}
                    placeholder="Business impact of the problem"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Life With Problem</label>
                  <textarea
                    value={activeProfile.life_with_problem || ''}
                    onChange={(e) => handleChange('life_with_problem', e.target.value)}
                    placeholder="Current state before solution"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Life After Solution</label>
                  <textarea
                    value={activeProfile.life_after_solution || ''}
                    onChange={(e) => handleChange('life_after_solution', e.target.value)}
                    placeholder="Desired state with solution"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Desired Transformation</label>
                  <textarea
                    value={activeProfile.desired_transformation || ''}
                    onChange={(e) => handleChange('desired_transformation', e.target.value)}
                    placeholder="Transformation you enable"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Transformation Mechanism</label>
                  <input
                    value={activeProfile.transformation_mechanism || ''}
                    onChange={(e) => handleChange('transformation_mechanism', e.target.value)}
                    placeholder="How you achieve the transformation"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Authority Domains</label>
                  <textarea
                    value={joinList(activeProfile.authority_domains)}
                    onChange={(e) => handleChangeArray('authority_domains', e.target.value)}
                    placeholder="Comma-separated: project management, agile, prioritization"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
            )}
              </>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                Add optional social links, then refine with AI to reveal the generated company profile sections and continue to business details.
              </div>
            )}

            {showOnboardingContinuation && discoveredSocialProfiles.length > 0 && (
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm font-semibold text-gray-800 mb-2">Discovered Social Profiles</div>
                <ul className="text-xs text-gray-600 space-y-1">
                  {discoveredSocialProfiles.map((entry, index) => (
                    <li key={`${entry.platform}-${entry.url}-${index}`}>
                      <a
                        href={entry.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 hover:underline"
                      >
                        {entry.platform}: {entry.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {showStandardProfileActions && (
            <div className="flex items-center gap-3 pt-2 border-t mt-6">
              {isEditing ? (
                <>
                  <button
                    onClick={saveProfile}
                    disabled={isSaving || isRefining}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save Profile'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setDraftProfile(profile || activeProfile);
                      updateActiveProfile(profile || activeProfile);
                    }}
                    disabled={isSaving}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-200"
                >
                  Edit Profile
                </button>
              )}
            </div>
            )}
          </div>
        )}
      </div>
      <GuidedChatPanel
        title="Define target customer"
        description="Capture customer segment, ICP, pricing, sales motion, and commercial details through guided questions."
        open={targetCustomerPanelOpen}
        messages={targetCustomerMessages}
        input={targetCustomerInput}
        loading={targetCustomerLoading}
        onInputChange={setTargetCustomerInput}
        onSend={() => { void sendTargetCustomerMessage(); }}
        onClose={() => {
          setTargetCustomerPanelOpen(false);
          setTargetCustomerLoading(false);
        }}
        renderAssistantMessage={renderProblemTransformationAssistantMessage}
      />
      <GuidedChatPanel
        title="Campaign purpose"
        description="Capture campaign objective, monetization intent, problem domains, and positioning angle."
        open={campaignPurposePanelOpen}
        messages={campaignPurposeMessages}
        input={campaignPurposeInput}
        loading={campaignPurposeLoading}
        onInputChange={setCampaignPurposeInput}
        onSend={() => { void sendCampaignPurposeMessage(); }}
        onClose={() => {
          setCampaignPurposePanelOpen(false);
          setCampaignPurposeLoading(false);
        }}
      />
      <GuidedChatPanel
        title="Marketing intelligence"
        description="Refine channels, content strategy, campaign focus, positioning, messages, advantages, and growth priorities."
        open={marketingIntelligencePanelOpen}
        messages={marketingIntelligenceMessages}
        input={marketingIntelligenceInput}
        loading={marketingIntelligenceChatLoading}
        onInputChange={setMarketingIntelligenceInput}
        onSend={() => { void sendMarketingIntelligenceMessage(); }}
        onClose={() => {
          setMarketingIntelligencePanelOpen(false);
          setMarketingIntelligenceChatLoading(false);
        }}
      />
      <GuidedChatPanel
        title="Context intelligence"
        description="Capture markets, dependencies, workforce, regulatory exposure, and technology context for better relevance filtering."
        open={contextIntelligencePanelOpen}
        messages={contextIntelligenceMessages}
        input={contextIntelligenceInput}
        loading={contextIntelligenceChatLoading}
        onInputChange={setContextIntelligenceInput}
        onSend={() => { void sendContextIntelligenceMessage(); }}
        onClose={() => {
          setContextIntelligencePanelOpen(false);
          setContextIntelligenceChatLoading(false);
        }}
      />
      <GuidedChatPanel
        title="Problem and transformation"
        description="Refine the problem, symptoms, transformation, mechanism, and authority domains."
        open={problemTransformationInferPanelOpen}
        messages={problemTransformationInferMessages}
        input={problemTransformationInferInput}
        loading={problemTransformationInferLoading}
        onInputChange={setProblemTransformationInferInput}
        onSend={() => { void sendProblemTransformationRefineMessage(); }}
        onClose={() => {
          setProblemTransformationInferPanelOpen(false);
          setProblemTransformationInferLoading(false);
        }}
        extraActions={pendingProblemTransformationUpdates ? (
          <button
            type="button"
            onClick={() => { void sendProblemTransformationRefineMessage('apply'); }}
            disabled={problemTransformationInferLoading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Apply updates
          </button>
        ) : null}
      />
    </>
  );
}
