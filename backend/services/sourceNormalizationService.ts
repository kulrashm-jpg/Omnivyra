export type UnifiedSourceCategory =
  | 'analytics'
  | 'crm'
  | 'email'
  | 'webinar'
  | 'ads'
  | 'engagement'
  | 'event'
  | 'internal'
  | 'file';

export type UnifiedSource = {
  provider: string;
  category: UnifiedSourceCategory;
  channel?: string;
  origin?: string;
};

export type SourceNormalizationContext = {
  sourceType?: 'file' | 'integration' | 'internal';
  provider?: string | null;
  category?: UnifiedSourceCategory | null;
  channel?: string | null;
  origin?: string | null;
  adapter?: string | null;
  metadata?: Record<string, unknown> | null;
};

const CHANNEL_ALIASES: Record<string, string> = {
  organic: 'organic',
  organic_search: 'organic',
  seo: 'organic',
  paid: 'paid',
  cpc: 'paid',
  ppc: 'paid',
  ads: 'paid',
  social: 'social',
  paid_social: 'social',
  email: 'email',
  direct: 'direct',
  referral: 'referral',
};

const SOURCE_ALIASES: Record<string, UnifiedSource> = {
  ga: { provider: 'ga4', category: 'analytics', origin: 'integration' },
  ga4: { provider: 'ga4', category: 'analytics', origin: 'integration' },
  google_analytics: { provider: 'ga4', category: 'analytics', origin: 'integration' },
  googleanalytics: { provider: 'ga4', category: 'analytics', origin: 'integration' },
  gsc: { provider: 'gsc', category: 'analytics', origin: 'integration' },
  google_search_console: { provider: 'gsc', category: 'analytics', origin: 'integration' },
  crawler: { provider: 'crawler', category: 'internal', origin: 'crawler' },
  website_crawl: { provider: 'crawler', category: 'internal', origin: 'crawler' },
  manual: { provider: 'manual', category: 'internal', origin: 'manual' },
  manual_entry: { provider: 'manual', category: 'internal', origin: 'manual' },
  webhook: { provider: 'webhook', category: 'internal', origin: 'webhook' },
  form_embed: { provider: 'manual', category: 'internal', origin: 'form_embed' },
  form: { provider: 'manual', category: 'internal', origin: 'form_embed' },
  crm: { provider: 'crm', category: 'crm', origin: 'integration' },
  hubspot: { provider: 'hubspot', category: 'crm', origin: 'integration' },
  salesforce: { provider: 'salesforce', category: 'crm', origin: 'integration' },
  csv: { provider: 'csv', category: 'file', origin: 'import' },
  upload: { provider: 'csv', category: 'file', origin: 'import' },
  data_upload: { provider: 'csv', category: 'file', origin: 'import' },
  api: { provider: 'api', category: 'internal', origin: 'api' },
  rpa: { provider: 'rpa', category: 'internal', origin: 'rpa' },
  extension: { provider: 'extension', category: 'engagement', origin: 'extension' },
  ads: { provider: 'ads', category: 'ads', origin: 'integration' },
  google_ads: { provider: 'google_ads', category: 'ads', origin: 'integration' },
  meta_ads: { provider: 'meta_ads', category: 'ads', origin: 'integration' },
  mailchimp: { provider: 'mailchimp', category: 'email', origin: 'integration' },
  email: { provider: 'email', category: 'email', channel: 'email', origin: 'integration' },
  webinar: { provider: 'webinar', category: 'webinar', origin: 'integration' },
  zoom: { provider: 'zoom', category: 'webinar', origin: 'integration' },
  event: { provider: 'event', category: 'event', origin: 'integration' },
  engagement: { provider: 'engagement', category: 'engagement', origin: 'internal' },
  comments: { provider: 'engagement', category: 'engagement', origin: 'comments' },
  dms: { provider: 'engagement', category: 'engagement', origin: 'dms' },
};

function normalizeToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function cleanValue(value: unknown): string | undefined {
  const normalized = normalizeToken(value);
  return normalized || undefined;
}

function normalizeChannel(value: unknown): string | undefined {
  const normalized = normalizeToken(value);
  if (!normalized) return undefined;
  return CHANNEL_ALIASES[normalized] ?? normalized;
}

function categoryFromSourceType(sourceType?: SourceNormalizationContext['sourceType']): UnifiedSourceCategory {
  if (sourceType === 'file') return 'file';
  return 'internal';
}

function originFromSourceType(sourceType?: SourceNormalizationContext['sourceType']): string | undefined {
  if (sourceType === 'file') return 'import';
  if (sourceType === 'integration') return 'integration';
  if (sourceType === 'internal') return 'internal';
  return undefined;
}

export function normalizeSource(source: unknown, context: SourceNormalizationContext = {}): UnifiedSource {
  const raw = normalizeToken(source);
  const alias = SOURCE_ALIASES[raw];
  const metadata = context.metadata ?? {};
  const metadataChannel = typeof metadata.channel === 'string' ? metadata.channel : null;
  const metadataOrigin = typeof metadata.origin === 'string' ? metadata.origin : null;
  const metadataProvider = typeof metadata.provider === 'string' ? metadata.provider : null;

  const provider =
    cleanValue(context.provider) ??
    cleanValue(metadataProvider) ??
    alias?.provider ??
    cleanValue(raw) ??
    cleanValue(context.adapter) ??
    'unknown';

  const category =
    context.category ??
    alias?.category ??
    categoryFromSourceType(context.sourceType);

  const channel =
    normalizeChannel(context.channel) ??
    normalizeChannel(metadataChannel) ??
    alias?.channel ??
    CHANNEL_ALIASES[raw];

  const sourceTypeOrigin = originFromSourceType(context.sourceType);
  const origin =
    cleanValue(context.origin) ??
    cleanValue(metadataOrigin) ??
    (context.sourceType === 'file' ? sourceTypeOrigin : undefined) ??
    alias?.origin ??
    sourceTypeOrigin;

  return {
    provider,
    category,
    ...(channel ? { channel } : {}),
    ...(origin ? { origin } : {}),
  };
}
