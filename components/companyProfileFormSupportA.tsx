/** Part 1/3 of company-profile-form.tsx — verbatim split (barrel preserved; importers unchanged). */
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
} from '../pages/company-profile.types';
import { dedupeSocialProfiles, joinList, normalizeProfileSocialUrl, splitToList } from '../pages/company-profile.types';
import { isValidCanonicalWebsite } from '../utils/companyProfileValidation';


export type ProfileState = ReturnType<typeof useCompanyProfileState>;

export type BrandAssetField = 'logo_url' | 'favicon_url';
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
export type InlineQuestionFieldKey =
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

export const normalizeQuestionFieldKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const isBlockedRefinementQuestion = (question: MissingFieldQuestion) => {
  const normalized = normalizeQuestionFieldKey(`${question.field} ${question.question}`);
  return BLOCKED_REFINEMENT_QUESTION_TOKENS.some((token) => normalized.includes(token));
};

export const questionMatchesInlineField = (
  question: MissingFieldQuestion,
  fieldKey: InlineQuestionFieldKey,
) => {
  if (isBlockedRefinementQuestion(question)) return false;
  const normalized = normalizeQuestionFieldKey(`${question.field} ${question.question}`);
  return INLINE_QUESTION_FIELD_MATCHERS[fieldKey].some((token) => normalized.includes(token));
};

export const questionMatchesAnyInlineField = (question: MissingFieldQuestion) =>
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

export const formatBusinessClassificationLabel = (value?: string | null): string =>
  BUSINESS_CLASSIFICATION_LABELS[String(value || '').toLowerCase()] ||
  String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const BRAND_ASSET_SPECS: Record<
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

export const BRAND_ASSET_ACCEPT = 'image/png,image/jpeg,image/jpg,image/webp';

export const SOCIAL_ACCOUNT_FIELDS: Array<{
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

export const formatFileSize = (bytes: number) => {
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

export const prepareTransparentBrandAsset = async (
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

export function StatCard({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'slate' | 'indigo' | 'amber';
}) {
  const toneClasses =
    tone === 'indigo'
      ? 'border-indigo-200 bg-indigo-50 text-indigo-900'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-slate-200 bg-slate-50 text-slate-900';

  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClasses}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}

export function SectionCard({
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

export function GuidedChatPanel({
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

