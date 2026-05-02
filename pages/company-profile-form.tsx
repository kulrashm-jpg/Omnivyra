import React from 'react';
import Link from 'next/link';
import ChatVoiceButton from '../components/ChatVoiceButton';
import AIGenerationProgress from '../components/AIGenerationProgress';
import CompanyStrategyProfileCard from '../components/company/CompanyStrategyProfileCard';
import type { useCompanyProfileState } from '../hooks/useCompanyProfileState';
import type { CompanyProfile } from './company-profile.types';
import { dedupeSocialProfiles, joinList, normalizeProfileSocialUrl, splitToList } from './company-profile.types';

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
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  accent?: 'slate' | 'indigo';
}) {
  const accentClasses =
    accent === 'indigo'
      ? 'border-indigo-200 bg-indigo-50/40'
      : 'border-slate-200 bg-white';

  return (
    <section className={`rounded-2xl border p-5 md:p-6 ${accentClasses}`}>
      <div className="mb-5 flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {description ? <p className="text-sm leading-6 text-slate-600">{description}</p> : null}
      </div>
      {children}
    </section>
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
    draftProfile,
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
    isAdmin,
    isAuthenticated,
    isCompanyAdmin,
    isCompanyLoading,
    isContentArchitect,
    isEditing,
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
    openCampaignPurposePanel,
    openInferProblemTransformationPanel,
    openMarketingIntelligencePanel,
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
    router,
    saveProblemTransformation,
    saveProfile,
    selectedCompanyId,
    selectedCompanyName,
    sendCampaignPurposeMessage,
    sendMarketingIntelligenceMessage,
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
    updateOtherSocial,
    user,
    userRole,
  } = d;

  const marketPulseSettings = activeProfile.report_settings?.market_pulse ?? {};
  const marketAlternativeLabels = (marketPulseSettings.market_alternatives ?? [])
    .slice(0, 3)
    .map((item) => [item.name, item.category].filter(Boolean).join(' - '))
    .filter(Boolean);
  const competitorDetails = (marketPulseSettings.competitor_details ?? []).slice(0, 3);
  const competitorQuality = marketPulseSettings.competitor_quality ?? null;
  const competitorScoreThreshold = Number(competitorQuality?.threshold ?? 90);
  const topCompetitorScore = competitorQuality?.highest_score ?? (
    competitorDetails.length
      ? Math.max(...competitorDetails.map((item) => Number(item.score ?? 0)))
      : null
  );
  const competitorThresholdMet = competitorQuality?.threshold_met ?? (
    topCompetitorScore != null ? topCompetitorScore >= competitorScoreThreshold : null
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
  const intelligenceSettings = activeProfile.report_settings?.intelligence ?? {};
  const displayFieldValue = React.useCallback(
    (primary?: string | null, extracted?: string[] | null) => joinList(extracted, primary) || '',
    [],
  );
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
            </div>
          );
        })}
      </div>
    );
  };

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

        {isLoading ? (
          <div className="text-sm text-gray-500">Loading profile...</div>
        ) : (
          <div className="space-y-6">
            <SectionCard
              title="Profile Basics"
              description="Start with company identity, official links, brand assets, and core firmographic context so Content Architect has a reliable working base."
            >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
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
              <div>
                <label className="text-sm font-medium text-gray-700">Company Name</label>
                <input
                  value={activeProfile.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Industry</label>
                <input
                  value={displayFieldValue(activeProfile.industry, activeProfile.industry_list)}
                  onChange={(e) => handleChange('industry', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {renderInlineRefinementQuestions('industry')}
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
              {businessClassification && (
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
              <div>
                <label className="text-sm font-medium text-gray-700">Website URL</label>
                <input
                  value={activeProfile.website_url || ''}
                  onChange={(e) => handleChange('website_url', e.target.value)}
                  onBlur={(e) => normalizeUrlField('website_url', e.target.value)}
                  placeholder="example.com"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  AI refinement crawls this website, your social profiles, blog, and any additional profiles to enrich all fields below.
                </p>
              </div>
              <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold text-slate-900">Brand Assets</h3>
                  <p className="text-xs text-slate-600">
                    Upload a company logo and favicon so content generation can reuse official brand marks without pulling oversized files into the system. Brand assets stay proportional when rendered, and we do not intentionally recolor or distort them.
                  </p>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
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
              </div>
              <details className="md:col-span-2 rounded-xl border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Social Accounts</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Add primary platform profiles used for crawling, publishing, and readiness checks.
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
                          {account.label}{account.value ? ' connected' : ' pending'}
                        </span>
                      ))}
                      {filledSocialAccounts.length > 2 ? (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">
                          +{filledSocialAccounts.length - 2} more
                        </span>
                      ) : null}
                    </div>
                  </div>
                </summary>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
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
              </details>
              <div>
                <label className="text-sm font-medium text-gray-700">Geography</label>
                <input
                  value={displayFieldValue(activeProfile.geography, activeProfile.geography_list)}
                  onChange={(e) => handleChange('geography', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {renderInlineRefinementQuestions('geography')}
            </div>
            </div>
            </SectionCard>

            <SectionCard
              title="Company Facts"
              description="These confirmed business facts support competitor analysis, market positioning, and downstream recommendation quality."
            >
            <div className="border rounded-xl p-4 bg-slate-50">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Company Facts</h3>
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
              <div className="mt-3 text-xs text-gray-500">
                Last confirmed: {profileReview.last_confirmed_at ? new Date(profileReview.last_confirmed_at).toLocaleDateString() : 'Not confirmed yet'}
                {' · '}
                Next due: {profileReview.next_confirmation_due_at ? new Date(profileReview.next_confirmation_due_at).toLocaleDateString() : 'After first admin confirmation'}
              </div>
            </div>
            </SectionCard>

            <SectionCard
              title="Digital Footprint"
              description="Keep secondary communities, directories, newsletters, and public surfaces together so refinement has a clearer crawl map."
            >
            <div className="border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">Additional Digital Assets</h3>
                <button
                  type="button"
                  onClick={addOtherSocial}
                  className="px-3 py-1 bg-gray-100 text-gray-800 rounded text-xs hover:bg-gray-200"
                >
                  + Add asset
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-2">Add any other digital presence — communities (Slack, Discord, Circle), profile pages (Crunchbase, G2, Clutch), newsletters, podcasts, or other links. Refine with AI will crawl these too.</p>
              {(activeProfile.other_social_links || []).length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-gray-500">
                  No additional profiles added. Use Add asset to enter a label and URL.
                </div>
              )}
              <div className="space-y-2">
                {(activeProfile.other_social_links || []).map((item, index) => (
                  <div key={`social-${index}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
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
                      className="md:col-span-3 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                    {isEditing && (
                      <button
                        type="button"
                        onClick={() => removeOtherSocial(index)}
                        className="md:col-span-1 text-xs text-red-600"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
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
                  value={joinList(activeProfile.competitors_list, activeProfile.competitors) || ''}
                  onChange={(e) => handleChange('competitors', e.target.value)}
                  rows={2}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {competitorDetails.length > 0 ? (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800">
                        Top match: {topCompetitorScore != null ? `${Math.round(topCompetitorScore)}%` : 'Not scored'}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${
                        competitorThresholdMet ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {competitorThresholdMet ? '90%+ match' : `Below ${Math.round(competitorScoreThreshold)}%`}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {competitorDetails.map((competitor) => (
                        <span
                          key={competitor.name}
                          className="rounded-full border border-slate-200 bg-white px-2 py-1"
                        >
                          {competitor.name}: {Math.round(Number(competitor.score ?? 0))}%
                        </span>
                      ))}
                    </div>
                    {!competitorThresholdMet && marketAlternativeLabels.length > 0 ? (
                      <div className="mt-2">
                        <div className="font-semibold text-slate-800">Expanded context</div>
                        <div className="mt-1">{marketAlternativeLabels.join(', ')}</div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
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

            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5">
              {isRefining ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-indigo-700">
                    <svg className="animate-spin h-4 w-4 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    {REFINE_STEPS[(refineStep - 1) % REFINE_STEPS.length]}
                  </div>
                  <div className="flex gap-1">
                    {REFINE_STEPS.map((_, i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                          i < refineStep ? 'bg-indigo-500' : 'bg-gray-200'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">Step {refineStep} of {REFINE_STEPS.length} — this usually takes 20–45 seconds</p>
                </div>
              ) : (
                <button
                  onClick={refineProfile}
                  disabled={isSaving}
                  className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Refine with AI
                </button>
              )}
            </div>

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

            {canViewStrategicSections && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Market Pulse Defaults</h3>
              <p className="text-sm text-gray-600 mb-4">
                Business context used to make Market Pulse more relevant and less noisy. Market focus comes from
                <span className="font-medium text-gray-800"> Geography</span> and competitors come from
                <span className="font-medium text-gray-800"> Competitors</span> in the main company profile, so this section only keeps the extra strategic signals.
              </p>
              <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Market Focus Source</div>
                  <div className="mt-1">{joinList(activeProfile.geography_list, activeProfile.geography) || 'Not set'}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Competitor Source</div>
                  <div className="mt-1">{joinList(activeProfile.competitors_list, activeProfile.competitors) || 'Not set'}</div>
                </div>
              </div>
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
            </div>
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
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Intelligence Operating Target</h3>
              <p className="text-sm text-gray-600 mb-4">
                This is the target the <strong>Intelligence</strong> page should optimize against. Set the main objective, the target metric, and the time horizon so the page can tell whether the company is behind, on track, or capable of surpassing the goal.
              </p>
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
            </div>
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

            {discoveredSocialProfiles.length > 0 && (
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
          </div>
        )}
      </div>
    </>
  );
}
