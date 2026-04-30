import {
  normalizeCompetitorCategory,
  normalizeCompetitorTags,
  type CompetitorSecondaryTag,
  type StandardCompetitorCategory,
} from './competitorTaxonomy';

export type CompetitorProductType = 'AI chatbot' | 'human-led' | 'content-based' | 'software platform' | 'marketplace' | 'unknown';

export type CompetitorScaleSignals = {
  traffic?: string | null;
  installs?: string | null;
  reviews?: string | null;
  funding?: string | null;
  notes?: string | null;
};

export type CompetitorEnrichmentProfile = {
  name: string;
  domain: string | null;
  category: StandardCompetitorCategory;
  tags: CompetitorSecondaryTag[];
  description: string | null;
  icp: {
    age_group: string | null;
    use_case: string | null;
    user_intent: string | null;
  };
  business_model: string | null;
  geography: string | null;
  product_type: CompetitorProductType;
  scale_signals: CompetitorScaleSignals;
  confidence_score: number;
  sources: string[];
};

export type EnrichmentCandidateLike = {
  name: string;
  domain?: string | null;
  category?: string | null;
  tags?: CompetitorSecondaryTag[] | null;
  description?: string | null;
  targetCustomer?: string | null;
  useCase?: string | null;
  geography?: string | null;
  businessModel?: string | null;
  revenueRange?: string | null;
  productSignals?: string[] | null;
  productType?: CompetitorProductType | null;
  scaleSignals?: CompetitorScaleSignals | null;
  confidenceScore?: number | null;
  enrichment?: CompetitorEnrichmentProfile | null;
};

function normalizeKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

function profile(input: Omit<CompetitorEnrichmentProfile, 'category' | 'tags'> & {
  category: string | null;
  tags?: CompetitorSecondaryTag[] | null;
}): CompetitorEnrichmentProfile {
  const category = normalizeCompetitorCategory(input.category, [
    input.name,
    input.description,
    input.icp.use_case,
    input.icp.user_intent,
    input.product_type,
    input.business_model,
  ].filter(Boolean).join(' '));
  return {
    ...input,
    category,
    tags: input.tags ?? normalizeCompetitorTags({
      productType: input.product_type,
      businessModel: input.business_model,
      description: input.description,
      category,
      scaleText: Object.values(input.scale_signals).filter(Boolean).join(' '),
    }),
  };
}

const KNOWN_COMPETITOR_PROFILES: Record<string, CompetitorEnrichmentProfile> = {
  wysa: profile({
    name: 'Wysa',
    domain: 'wysa.com',
    category: 'mental wellness',
    description: 'AI-guided mental health and emotional wellbeing support app with chatbot-led self-care and coaching pathways.',
    icp: {
      age_group: 'adults and working-age users',
      use_case: 'stress, anxiety, emotional wellbeing, self-care, guided reflection',
      user_intent: 'get private emotional support and structured wellbeing guidance',
    },
    business_model: 'B2C and employer/healthcare hybrid',
    geography: 'global, with strong English-speaking market presence',
    product_type: 'AI chatbot',
    scale_signals: {
      installs: 'large mobile app footprint',
      reviews: 'substantial app-store review base',
      notes: 'recognized mental wellness chatbot category player',
    },
    confidence_score: 0.86,
    sources: ['known_category_dataset'],
  }),
  'wysa.com': profile({
    name: 'Wysa',
    domain: 'wysa.com',
    category: 'mental wellness',
    description: 'AI-guided mental health and emotional wellbeing support app with chatbot-led self-care and coaching pathways.',
    icp: {
      age_group: 'adults and working-age users',
      use_case: 'stress, anxiety, emotional wellbeing, self-care, guided reflection',
      user_intent: 'get private emotional support and structured wellbeing guidance',
    },
    business_model: 'B2C and employer/healthcare hybrid',
    geography: 'global, with strong English-speaking market presence',
    product_type: 'AI chatbot',
    scale_signals: {
      installs: 'large mobile app footprint',
      reviews: 'substantial app-store review base',
      notes: 'recognized mental wellness chatbot category player',
    },
    confidence_score: 0.86,
    sources: ['known_category_dataset'],
  }),
  'woebot health': profile({
    name: 'Woebot Health',
    domain: 'woebothealth.com',
    category: 'mental wellness',
    description: 'Conversational mental health support product using chatbot-guided CBT-style interactions and digital therapeutic support.',
    icp: {
      age_group: 'adults and patients',
      use_case: 'mental health support, mood support, CBT-style reflection',
      user_intent: 'receive guided emotional support through conversational self-help',
    },
    business_model: 'healthcare and digital therapeutics',
    geography: 'primarily United States with broader digital reach',
    product_type: 'AI chatbot',
    scale_signals: {
      funding: 'venture-backed digital health company',
      notes: 'known conversational mental health provider',
    },
    confidence_score: 0.86,
    sources: ['known_category_dataset'],
  }),
  'woebothealth.com': profile({
    name: 'Woebot Health',
    domain: 'woebothealth.com',
    category: 'mental wellness',
    description: 'Conversational mental health support product using chatbot-guided CBT-style interactions and digital therapeutic support.',
    icp: {
      age_group: 'adults and patients',
      use_case: 'mental health support, mood support, CBT-style reflection',
      user_intent: 'receive guided emotional support through conversational self-help',
    },
    business_model: 'healthcare and digital therapeutics',
    geography: 'primarily United States with broader digital reach',
    product_type: 'AI chatbot',
    scale_signals: {
      funding: 'venture-backed digital health company',
      notes: 'known conversational mental health provider',
    },
    confidence_score: 0.86,
    sources: ['known_category_dataset'],
  }),
  calm: profile({
    name: 'Calm',
    domain: 'calm.com',
    category: 'meditation and mental wellness',
    description: 'Consumer meditation, sleep, relaxation, and mental wellness app built around guided content and habit formation.',
    icp: {
      age_group: 'broad consumer adult audience',
      use_case: 'sleep, meditation, relaxation, stress reduction',
      user_intent: 'feel calmer, sleep better, and manage stress through guided content',
    },
    business_model: 'B2C subscription with enterprise wellness extensions',
    geography: 'global',
    product_type: 'content-based',
    scale_signals: {
      installs: 'very large consumer app footprint',
      reviews: 'large app-store review base',
      notes: 'category leader in meditation and wellness apps',
    },
    confidence_score: 0.9,
    sources: ['known_category_dataset'],
  }),
  'calm.com': profile({
    name: 'Calm',
    domain: 'calm.com',
    category: 'meditation and mental wellness',
    description: 'Consumer meditation, sleep, relaxation, and mental wellness app built around guided content and habit formation.',
    icp: {
      age_group: 'broad consumer adult audience',
      use_case: 'sleep, meditation, relaxation, stress reduction',
      user_intent: 'feel calmer, sleep better, and manage stress through guided content',
    },
    business_model: 'B2C subscription with enterprise wellness extensions',
    geography: 'global',
    product_type: 'content-based',
    scale_signals: {
      installs: 'very large consumer app footprint',
      reviews: 'large app-store review base',
      notes: 'category leader in meditation and wellness apps',
    },
    confidence_score: 0.9,
    sources: ['known_category_dataset'],
  }),
  headspace: profile({
    name: 'Headspace',
    domain: 'headspace.com',
    category: 'meditation and mental wellness',
    description: 'Meditation, mindfulness, sleep, and mental wellness platform with guided content and enterprise wellbeing offerings.',
    icp: {
      age_group: 'broad consumer adult audience and workplaces',
      use_case: 'mindfulness, meditation, stress, sleep, workplace wellbeing',
      user_intent: 'build a mental wellness habit and reduce stress through guided programs',
    },
    business_model: 'B2C subscription and B2B workplace wellness',
    geography: 'global',
    product_type: 'content-based',
    scale_signals: {
      installs: 'large mobile app footprint',
      reviews: 'large app-store review base',
      notes: 'major meditation and workplace wellbeing brand',
    },
    confidence_score: 0.9,
    sources: ['known_category_dataset'],
  }),
  'headspace.com': profile({
    name: 'Headspace',
    domain: 'headspace.com',
    category: 'meditation and mental wellness',
    description: 'Meditation, mindfulness, sleep, and mental wellness platform with guided content and enterprise wellbeing offerings.',
    icp: {
      age_group: 'broad consumer adult audience and workplaces',
      use_case: 'mindfulness, meditation, stress, sleep, workplace wellbeing',
      user_intent: 'build a mental wellness habit and reduce stress through guided programs',
    },
    business_model: 'B2C subscription and B2B workplace wellness',
    geography: 'global',
    product_type: 'content-based',
    scale_signals: {
      installs: 'large mobile app footprint',
      reviews: 'large app-store review base',
      notes: 'major meditation and workplace wellbeing brand',
    },
    confidence_score: 0.9,
    sources: ['known_category_dataset'],
  }),
  betterhelp: profile({
    name: 'BetterHelp',
    domain: 'betterhelp.com',
    category: 'online therapy marketplace',
    description: 'Online therapy marketplace connecting people with licensed therapists for professional mental health support.',
    icp: {
      age_group: 'adults',
      use_case: 'therapy, counselling, emotional support, mental health care',
      user_intent: 'access professional therapist-led support online',
    },
    business_model: 'B2C marketplace subscription',
    geography: 'primarily English-speaking markets with broad online reach',
    product_type: 'marketplace',
    scale_signals: {
      traffic: 'large consumer therapy marketplace footprint',
      notes: 'major online therapy marketplace',
    },
    confidence_score: 0.88,
    sources: ['known_category_dataset'],
  }),
  'betterhelp.com': profile({
    name: 'BetterHelp',
    domain: 'betterhelp.com',
    category: 'online therapy marketplace',
    description: 'Online therapy marketplace connecting people with licensed therapists for professional mental health support.',
    icp: {
      age_group: 'adults',
      use_case: 'therapy, counselling, emotional support, mental health care',
      user_intent: 'access professional therapist-led support online',
    },
    business_model: 'B2C marketplace subscription',
    geography: 'primarily English-speaking markets with broad online reach',
    product_type: 'marketplace',
    scale_signals: {
      traffic: 'large consumer therapy marketplace footprint',
      notes: 'major online therapy marketplace',
    },
    confidence_score: 0.88,
    sources: ['known_category_dataset'],
  }),
  replika: profile({
    name: 'Replika',
    domain: 'replika.com',
    category: 'AI companion',
    description: 'AI companion chatbot focused on conversation, emotional companionship, and personalized interaction.',
    icp: {
      age_group: 'teens and adults depending on market rules',
      use_case: 'companionship, emotional conversation, reflection, AI chat',
      user_intent: 'talk to an always-available AI companion for support or connection',
    },
    business_model: 'B2C freemium subscription',
    geography: 'global',
    product_type: 'AI chatbot',
    scale_signals: {
      installs: 'large consumer AI companion app footprint',
      reviews: 'substantial app-store review base',
      notes: 'known AI companion category player',
    },
    confidence_score: 0.86,
    sources: ['known_category_dataset'],
  }),
  'replika.com': profile({
    name: 'Replika',
    domain: 'replika.com',
    category: 'AI companion',
    description: 'AI companion chatbot focused on conversation, emotional companionship, and personalized interaction.',
    icp: {
      age_group: 'teens and adults depending on market rules',
      use_case: 'companionship, emotional conversation, reflection, AI chat',
      user_intent: 'talk to an always-available AI companion for support or connection',
    },
    business_model: 'B2C freemium subscription',
    geography: 'global',
    product_type: 'AI chatbot',
    scale_signals: {
      installs: 'large consumer AI companion app footprint',
      reviews: 'substantial app-store review base',
      notes: 'known AI companion category player',
    },
    confidence_score: 0.86,
    sources: ['known_category_dataset'],
  }),
  reflectly: profile({
    name: 'Reflectly',
    domain: 'reflectly.app',
    category: 'journaling and self-reflection',
    description: 'Personal journaling and mood-tracking app focused on self-reflection and emotional awareness.',
    icp: {
      age_group: 'teens and adults',
      use_case: 'journaling, mood tracking, self-reflection, emotional awareness',
      user_intent: 'reflect on feelings and develop self-awareness through guided journaling',
    },
    business_model: 'B2C mobile app subscription',
    geography: 'global',
    product_type: 'content-based',
    scale_signals: {
      installs: 'consumer mobile app footprint',
      notes: 'known guided journaling app',
    },
    confidence_score: 0.82,
    sources: ['known_category_dataset'],
  }),
  'reflectly.app': profile({
    name: 'Reflectly',
    domain: 'reflectly.app',
    category: 'journaling and self-reflection',
    description: 'Personal journaling and mood-tracking app focused on self-reflection and emotional awareness.',
    icp: {
      age_group: 'teens and adults',
      use_case: 'journaling, mood tracking, self-reflection, emotional awareness',
      user_intent: 'reflect on feelings and develop self-awareness through guided journaling',
    },
    business_model: 'B2C mobile app subscription',
    geography: 'global',
    product_type: 'content-based',
    scale_signals: {
      installs: 'consumer mobile app footprint',
      notes: 'known guided journaling app',
    },
    confidence_score: 0.82,
    sources: ['known_category_dataset'],
  }),
  'optimal virtual employee': profile({
    name: 'Optimal Virtual Employee',
    domain: 'optimalvirtualemployee.com',
    category: 'virtual staffing and outsourcing',
    description: 'Remote staffing and virtual employee outsourcing provider for businesses hiring offshore teams.',
    icp: {
      age_group: 'business buyers',
      use_case: 'hire remote staff, outsourcing, offshore delivery capacity',
      user_intent: 'reduce staffing cost or expand delivery capacity',
    },
    business_model: 'B2B services',
    geography: 'global delivery with business-client focus',
    product_type: 'human-led',
    scale_signals: {
      notes: 'service business rather than consumer clarity or wellness product',
    },
    confidence_score: 0.78,
    sources: ['known_category_dataset'],
  }),
  hubspot: profile({
    name: 'HubSpot',
    domain: 'hubspot.com',
    category: 'CRM and marketing automation',
    description: 'CRM, marketing, sales, and customer service software platform for businesses.',
    icp: {
      age_group: 'business buyers',
      use_case: 'CRM, marketing automation, sales pipeline, customer operations',
      user_intent: 'manage growth, marketing, sales, and customer relationships',
    },
    business_model: 'B2B SaaS',
    geography: 'global',
    product_type: 'software platform',
    scale_signals: {
      traffic: 'very large B2B SaaS footprint',
      notes: 'public enterprise-scale software company',
    },
    confidence_score: 0.92,
    sources: ['known_category_dataset'],
  }),
  'hubspot.com': profile({
    name: 'HubSpot',
    domain: 'hubspot.com',
    category: 'CRM and marketing automation',
    description: 'CRM, marketing, sales, and customer service software platform for businesses.',
    icp: {
      age_group: 'business buyers',
      use_case: 'CRM, marketing automation, sales pipeline, customer operations',
      user_intent: 'manage growth, marketing, sales, and customer relationships',
    },
    business_model: 'B2B SaaS',
    geography: 'global',
    product_type: 'software platform',
    scale_signals: {
      traffic: 'very large B2B SaaS footprint',
      notes: 'public enterprise-scale software company',
    },
    confidence_score: 0.92,
    sources: ['known_category_dataset'],
  }),
  salesforce: profile({
    name: 'Salesforce',
    domain: 'salesforce.com',
    category: 'CRM and marketing automation',
    description: 'Enterprise CRM, sales, service, marketing, and customer data platform for revenue teams.',
    icp: {
      age_group: 'business buyers',
      use_case: 'CRM, revenue operations, marketing automation, sales pipeline, customer data',
      user_intent: 'operate sales, marketing, and customer workflows from a central platform',
    },
    business_model: 'B2B SaaS',
    geography: 'global',
    product_type: 'software platform',
    scale_signals: {
      traffic: 'very large enterprise software footprint',
      notes: 'category leader in CRM and customer operations software',
    },
    confidence_score: 0.92,
    sources: ['known_category_dataset'],
  }),
  'salesforce.com': profile({
    name: 'Salesforce',
    domain: 'salesforce.com',
    category: 'CRM and marketing automation',
    description: 'Enterprise CRM, sales, service, marketing, and customer data platform for revenue teams.',
    icp: {
      age_group: 'business buyers',
      use_case: 'CRM, revenue operations, marketing automation, sales pipeline, customer data',
      user_intent: 'operate sales, marketing, and customer workflows from a central platform',
    },
    business_model: 'B2B SaaS',
    geography: 'global',
    product_type: 'software platform',
    scale_signals: {
      traffic: 'very large enterprise software footprint',
      notes: 'category leader in CRM and customer operations software',
    },
    confidence_score: 0.92,
    sources: ['known_category_dataset'],
  }),
  activecampaign: profile({
    name: 'ActiveCampaign',
    domain: 'activecampaign.com',
    category: 'CRM and marketing automation',
    description: 'Marketing automation, email automation, CRM, and customer experience platform for growing businesses.',
    icp: {
      age_group: 'business buyers',
      use_case: 'email marketing, marketing automation, CRM, lifecycle campaigns, customer journeys',
      user_intent: 'automate marketing and sales follow-up across customer segments',
    },
    business_model: 'B2B SaaS',
    geography: 'global',
    product_type: 'software platform',
    scale_signals: {
      traffic: 'large SMB and mid-market software footprint',
      notes: 'known marketing automation and CRM platform',
    },
    confidence_score: 0.9,
    sources: ['known_category_dataset'],
  }),
  'activecampaign.com': profile({
    name: 'ActiveCampaign',
    domain: 'activecampaign.com',
    category: 'CRM and marketing automation',
    description: 'Marketing automation, email automation, CRM, and customer experience platform for growing businesses.',
    icp: {
      age_group: 'business buyers',
      use_case: 'email marketing, marketing automation, CRM, lifecycle campaigns, customer journeys',
      user_intent: 'automate marketing and sales follow-up across customer segments',
    },
    business_model: 'B2B SaaS',
    geography: 'global',
    product_type: 'software platform',
    scale_signals: {
      traffic: 'large SMB and mid-market software footprint',
      notes: 'known marketing automation and CRM platform',
    },
    confidence_score: 0.9,
    sources: ['known_category_dataset'],
  }),
  'adobe marketo engage': profile({
    name: 'Adobe Marketo Engage',
    domain: 'business.adobe.com',
    category: 'marketing automation',
    description: 'B2B marketing automation platform for lead management, campaign orchestration, account-based marketing, and revenue growth teams.',
    icp: {
      age_group: 'business buyers',
      use_case: 'B2B marketing automation, lead nurturing, campaign orchestration, account-based marketing',
      user_intent: 'run and measure sophisticated B2B marketing programs',
    },
    business_model: 'B2B SaaS',
    geography: 'global',
    product_type: 'software platform',
    scale_signals: {
      notes: 'enterprise marketing automation product inside Adobe Experience Cloud',
    },
    confidence_score: 0.9,
    sources: ['known_category_dataset'],
  }),
  'business.adobe.com': profile({
    name: 'Adobe Marketo Engage',
    domain: 'business.adobe.com',
    category: 'marketing automation',
    description: 'B2B marketing automation platform for lead management, campaign orchestration, account-based marketing, and revenue growth teams.',
    icp: {
      age_group: 'business buyers',
      use_case: 'B2B marketing automation, lead nurturing, campaign orchestration, account-based marketing',
      user_intent: 'run and measure sophisticated B2B marketing programs',
    },
    business_model: 'B2B SaaS',
    geography: 'global',
    product_type: 'software platform',
    scale_signals: {
      notes: 'enterprise marketing automation product inside Adobe Experience Cloud',
    },
    confidence_score: 0.9,
    sources: ['known_category_dataset'],
  }),
  semrush: profile({
    name: 'Semrush',
    domain: 'semrush.com',
    category: 'marketing and SEO software',
    description: 'SEO, content marketing, competitive research, and digital marketing intelligence platform for growth teams.',
    icp: {
      age_group: 'business buyers',
      use_case: 'SEO, content strategy, competitive research, market visibility, digital marketing workflows',
      user_intent: 'improve search visibility and understand competitive digital performance',
    },
    business_model: 'B2B SaaS',
    geography: 'global',
    product_type: 'software platform',
    scale_signals: {
      traffic: 'large global marketing software footprint',
      notes: 'known SEO and competitive intelligence platform',
    },
    confidence_score: 0.9,
    sources: ['known_category_dataset'],
  }),
  'semrush.com': profile({
    name: 'Semrush',
    domain: 'semrush.com',
    category: 'marketing and SEO software',
    description: 'SEO, content marketing, competitive research, and digital marketing intelligence platform for growth teams.',
    icp: {
      age_group: 'business buyers',
      use_case: 'SEO, content strategy, competitive research, market visibility, digital marketing workflows',
      user_intent: 'improve search visibility and understand competitive digital performance',
    },
    business_model: 'B2B SaaS',
    geography: 'global',
    product_type: 'software platform',
    scale_signals: {
      traffic: 'large global marketing software footprint',
      notes: 'known SEO and competitive intelligence platform',
    },
    confidence_score: 0.9,
    sources: ['known_category_dataset'],
  }),
  openai: profile({
    name: 'OpenAI',
    domain: 'openai.com',
    category: 'AI platform',
    description: 'AI research and product company providing general-purpose AI models, ChatGPT, and developer APIs.',
    icp: {
      age_group: 'broad consumer, developer, and enterprise audience',
      use_case: 'general AI assistance, automation, content, coding, reasoning, APIs',
      user_intent: 'use general-purpose AI capabilities across many tasks',
    },
    business_model: 'B2C, developer, and enterprise hybrid',
    geography: 'global',
    product_type: 'software platform',
    scale_signals: {
      traffic: 'very large global AI platform footprint',
      notes: 'general AI platform rather than vertical clarity/wellness competitor',
    },
    confidence_score: 0.92,
    sources: ['known_category_dataset'],
  }),
  'clarity ai': profile({
    name: 'Clarity AI',
    domain: 'clarity.ai',
    category: 'sustainability analytics',
    description: 'AI-powered sustainability and impact analytics platform for investors, companies, and institutions.',
    icp: {
      age_group: 'business and institutional buyers',
      use_case: 'ESG analytics, sustainability reporting, impact measurement',
      user_intent: 'evaluate sustainability performance and compliance data',
    },
    business_model: 'B2B SaaS',
    geography: 'global',
    product_type: 'software platform',
    scale_signals: {
      funding: 'venture-backed analytics company',
      notes: 'name overlap with clarity but different ICP and problem category',
    },
    confidence_score: 0.84,
    sources: ['known_category_dataset'],
  }),
};

export function findKnownCompetitorProfile(name: string | null | undefined, domain?: string | null): CompetitorEnrichmentProfile | null {
  const keys = [domain, name].map(normalizeKey).filter(Boolean);
  for (const key of keys) {
    if (KNOWN_COMPETITOR_PROFILES[key]) return KNOWN_COMPETITOR_PROFILES[key];
  }
  return null;
}

export function listKnownCompetitorProfiles(): CompetitorEnrichmentProfile[] {
  const seen = new Set<string>();
  const profiles: CompetitorEnrichmentProfile[] = [];

  for (const profileValue of Object.values(KNOWN_COMPETITOR_PROFILES)) {
    const key = normalizeKey(profileValue.domain ?? profileValue.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    profiles.push(profileValue);
  }

  return profiles;
}

export function buildLowConfidenceProfile(input: {
  name: string;
  domain?: string | null;
  sources?: string[];
}): CompetitorEnrichmentProfile {
  return {
    name: input.name,
    domain: input.domain ?? null,
    category: normalizeCompetitorCategory(null, input.name),
    tags: [],
    description: null,
    icp: {
      age_group: null,
      use_case: null,
      user_intent: null,
    },
    business_model: null,
    geography: null,
    product_type: 'unknown',
    scale_signals: {},
    confidence_score: 0.15,
    sources: input.sources ?? ['fallback_unenriched'],
  };
}

export function applyEnrichmentProfile<T extends EnrichmentCandidateLike>(
  candidate: T,
  profileValue: CompetitorEnrichmentProfile | null,
): T {
  if (!profileValue) return candidate;
  return {
    ...candidate,
    domain: candidate.domain ?? profileValue.domain,
    category: candidate.category ?? profileValue.category,
    tags: candidate.tags ?? profileValue.tags,
    description: candidate.description ?? profileValue.description ?? undefined,
    targetCustomer:
      candidate.targetCustomer
      ?? ((): string | undefined => {
        const joined = [profileValue.icp.age_group, profileValue.icp.user_intent].filter(Boolean).join('; ');
        return joined.length > 0 ? joined : undefined;
      })(),
    useCase: candidate.useCase ?? profileValue.icp.use_case ?? undefined,
    geography: candidate.geography ?? profileValue.geography ?? undefined,
    businessModel: candidate.businessModel ?? profileValue.business_model ?? undefined,
    productSignals: candidate.productSignals ?? [
      profileValue.product_type,
      profileValue.category,
      profileValue.description,
      profileValue.icp.use_case,
      profileValue.icp.user_intent,
    ].filter((item): item is string => Boolean(item)),
    productType: candidate.productType ?? profileValue.product_type,
    scaleSignals: candidate.scaleSignals ?? profileValue.scale_signals,
    confidenceScore: candidate.confidenceScore ?? profileValue.confidence_score,
    enrichment: candidate.enrichment ?? profileValue,
  };
}

export function applyKnownCompetitorEnrichment<T extends EnrichmentCandidateLike>(candidate: T): T {
  return applyEnrichmentProfile(candidate, findKnownCompetitorProfile(candidate.name, candidate.domain));
}
