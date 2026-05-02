import { tokenizeCompetitorText } from '../competitorEngineService';
import type { CompanyProfile, CompanyProfileExtractionOutput } from './types';

export type BusinessModelLevel1 =
  | 'product_company'
  | 'services_company'
  | 'marketplace'
  | 'retailer'
  | 'distributor'
  | 'manufacturer'
  | 'hybrid';

export type BusinessTypeLevel2 =
  | 'saas_product'
  | 'ai_product'
  | 'mobile_app'
  | 'cpg_brand'
  | 'hardware_product'
  | 'it_services'
  | 'marketing_agency'
  | 'consulting'
  | 'coaching'
  | 'outsourcing'
  | 'b2b_marketplace'
  | 'b2c_marketplace'
  | 'retailer'
  | 'distributor'
  | 'manufacturer'
  | 'hybrid';

export type BusinessClassification = {
  level_1: BusinessModelLevel1;
  level_2: BusinessTypeLevel2;
  level_3: string[];
};

export type BusinessClassificationResult = {
  business_classification: BusinessClassification;
  industry: string[];
  category: string;
};

type SignalSet = {
  explicit: string;
  product: string;
  problem: string;
  audience: string;
  lowContext: string;
  all: string;
  signature: string;
};

type DomainKind = 'vertical' | 'function';

type DomainDefinition = {
  key: string;
  kind: DomainKind;
  terms: string[];
  explicit: RegExp[];
  product: RegExp[];
  problem: RegExp[];
  audience?: RegExp[];
};

type ScoredDomain = {
  key: string;
  kind: DomainKind;
  score: number;
  evidenceBuckets: number;
};

type ClassificationMode = 'vertical' | 'function';

type ClassificationDecision = {
  mode: ClassificationMode;
  confidence: number;
  verticalScore: number;
  functionScore: number;
};

type CachedClassification = BusinessClassificationResult & {
  confidence: number;
  signatureTokens: string[];
};

const classificationCache = new Map<string, CachedClassification>();
const STABILITY_CONFIDENCE_IMPROVEMENT = 0.15;
const WELL_DEFINED_VERTICALS = new Set([
  'fintech',
  'edtech',
  'ecommerce',
  'marketplace',
  'supply_chain',
  'healthcare',
  'mental_wellness',
  'real_estate',
  'manufacturing',
  'industrial',
  'marketing_technology',
]);

const GENERIC_INDUSTRY_VALUES = new Set([
  'information_services',
  'productivity',
  'consultation',
  'consulting',
  'technology',
  'software',
  'services',
  'business_services',
  'internet',
  'consumer_services',
]);

const toArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(toArray);
  if (typeof value !== 'string') return [];
  return value
    .split(/[,;/|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

const valueFromExtraction = (field: { value?: unknown; values?: unknown } | undefined): string[] =>
  toArray(field?.value ?? field?.values);

const normalizeKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const cleanList = (values: string[], max: number): string[] => {
  const result: string[] = [];
  values.forEach((value) => {
    const normalized = normalizeKey(value);
    if (!normalized || GENERIC_INDUSTRY_VALUES.has(normalized)) return;
    if (!result.includes(normalized)) result.push(normalized);
  });
  return result.slice(0, max);
};

const has = (text: string, pattern: RegExp) => pattern.test(text);

const NOISE_LINE_PATTERN =
  /\b(testimonials?|reviews?|what our customers say|customer stories|case studies?|blog article|related posts?|recent posts?|seo|keyword|footer|navigation|menu|privacy policy|terms of service|copyright|all rights reserved|subscribe|newsletter|cookie|breadcrumb|read more|share this|posted by|author:)\b/i;

const stripNoise = (value: string): string =>
  value
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line && !NOISE_LINE_PATTERN.test(line))
    .join(' ');

const joinText = (...values: unknown[]): string =>
  values
    .flatMap((value) => toArray(value).length > 0 ? toArray(value) : typeof value === 'string' ? [value] : [])
    .map(stripNoise)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const buildSignals = (
  profile: CompanyProfile,
  extraction?: CompanyProfileExtractionOutput | null,
): SignalSet => {
  const extractionIndustry = extraction ? valueFromExtraction(extraction.industry) : [];
  const extractionCategory = extraction ? valueFromExtraction(extraction.category) : [];
  const extractionProducts = extraction ? valueFromExtraction(extraction.products_services) : [];
  const extractionAudience = extraction ? valueFromExtraction(extraction.target_audience) : [];
  const extractionGoals = extraction ? valueFromExtraction(extraction.goals) : [];
  const extractionUnique = extraction ? valueFromExtraction(extraction.unique_value_proposition) : [];
  const extractionThemes = extraction ? valueFromExtraction(extraction.content_themes) : [];

  const explicit = joinText(
    profile.industry,
    profile.category,
    profile.industry_list,
    profile.category_list,
    extractionIndustry,
    extractionCategory,
  );
  const product = joinText(
    profile.products_services,
    profile.products_services_list,
    profile.unique_value,
    profile.brand_positioning,
    profile.content_strategy,
    profile.marketing_channels,
    extractionProducts,
    extractionUnique,
  );
  const problem = joinText(
    profile.goals,
    profile.goals_list,
    profile.core_problem_statement,
    profile.pain_symptoms,
    profile.desired_transformation,
    profile.authority_domains,
    extractionGoals,
  );
  const lowContext = joinText(profile.content_themes, profile.content_themes_list, extractionThemes);
  const audience = joinText(
    profile.target_audience,
    profile.target_audience_list,
    profile.target_customer_segment,
    profile.ideal_customer_profile,
    extractionAudience,
  );
  const all = joinText(profile.name, explicit, product, problem, audience, lowContext);
  const signature = tokenizeCompetitorText(all).slice(0, 80).join(' ');
  return { explicit, product, problem, audience, lowContext, all, signature };
};

const VERTICAL_DEFINITIONS: DomainDefinition[] = [
  {
    key: 'marketing_technology',
    kind: 'vertical',
    terms: ['marketing', 'campaign', 'crm', 'lead', 'seo', 'demand generation', 'brand visibility'],
    explicit: [/\bmarketing technology\b/, /\bmartech\b/, /\bmarketing automation\b/, /\bcrm\b/, /\bseo\b/],
    product: [/\bcampaign(s)?\b/, /\blead generation\b/, /\bdemand generation\b/, /\bcontent marketing\b/, /\bemail marketing\b/, /\bbrand visibility\b/],
    problem: [/\bconversion\b/, /\bacquisition\b/, /\bgrowth marketing\b/, /\bsearch visibility\b/, /\bpipeline\b/],
    audience: [/\bmarketers?\b/, /\bgrowth teams?\b/, /\bsales teams?\b/],
  },
  {
    key: 'fintech',
    kind: 'vertical',
    terms: ['payments', 'banking', 'finance', 'billing', 'lending', 'insurance', 'wealth'],
    explicit: [/\bfintech\b/, /\bfinancial technology\b/, /\bbanking\b/, /\bpayments?\b/, /\binsurance\b/],
    product: [/\bbilling\b/, /\binvoic(e|ing)\b/, /\bcheckout\b/, /\blending\b/, /\bwealth\b/, /\baccounting\b/],
    problem: [/\btransactions?\b/, /\bpayment processing\b/, /\bfinancial compliance\b/, /\bcash flow\b/],
  },
  {
    key: 'edtech',
    kind: 'vertical',
    terms: ['education', 'learning', 'students', 'courses', 'training', 'school'],
    explicit: [/\bedtech\b/, /\beducation\b/, /\blearning platform\b/, /\bschools?\b/],
    product: [/\bcourses?\b/, /\btraining\b/, /\blms\b/, /\btutoring\b/, /\bcurriculum\b/],
    problem: [/\bskills?\b/, /\bassessment\b/, /\bstudent outcomes?\b/, /\bteaching\b/],
    audience: [/\bstudents?\b/, /\bteachers?\b/, /\blearners?\b/, /\beducators?\b/],
  },
  {
    key: 'ecommerce',
    kind: 'vertical',
    terms: ['ecommerce', 'commerce', 'retail', 'store', 'checkout', 'shopping'],
    explicit: [/\be-?commerce\b/, /\bonline store\b/, /\bretail\b/, /\bcommerce\b/],
    product: [/\bcheckout\b/, /\bshopping\b/, /\bshop\b/, /\bproduct catalog\b/, /\border management\b/],
    problem: [/\bcart\b/, /\border fulfillment\b/, /\bmerchandising\b/, /\bsales channels?\b/],
  },
  {
    key: 'marketplace',
    kind: 'vertical',
    terms: ['marketplace', 'buyers', 'sellers', 'vendors', 'two sided'],
    explicit: [/\bmarketplace\b/, /\btwo[-\s]?sided\b/, /\bbuyers?\s+and\s+sellers?\b/],
    product: [/\bvendors?\b/, /\bsuppliers?\b/, /\blistings?\b/, /\btransactions?\b/],
    problem: [/\bmatching\b/, /\bdiscovery\b/, /\btrust\b/, /\bnetwork\b/],
  },
  {
    key: 'supply_chain',
    kind: 'vertical',
    terms: ['supply chain', 'logistics', 'procurement', 'inventory', 'warehouse', 'shipping'],
    explicit: [/\bsupply chain\b/, /\blogistics\b/, /\bprocurement\b/, /\bwarehouse\b/],
    product: [/\binventory\b/, /\bshipping\b/, /\bfreight\b/, /\bvendor management\b/, /\bfulfillment\b/],
    problem: [/\bstockouts?\b/, /\blead times?\b/, /\broute optimization\b/, /\bdemand planning\b/],
  },
  {
    key: 'healthcare',
    kind: 'vertical',
    terms: ['healthcare', 'clinical', 'patients', 'medical', 'care providers', 'hospital'],
    explicit: [/\bhealthcare\b/, /\bclinical\b/, /\bmedical\b/, /\bhospitals?\b/, /\bpatients?\b/],
    product: [/\bpatient\b/, /\bcare management\b/, /\bclinical workflow\b/, /\bmedical records?\b/, /\btelehealth\b/],
    problem: [/\bcare delivery\b/, /\bdiagnosis\b/, /\btreatment\b/, /\bprovider workflow\b/],
  },
  {
    key: 'mental_wellness',
    kind: 'vertical',
    terms: ['mental health', 'therapy', 'counselling', 'cbt', 'anxiety', 'stress', 'mood'],
    explicit: [/\bmental health\b/, /\bmental wellness\b/, /\btherapy\b/, /\bcounselling\b/, /\bcounseling\b/],
    product: [/\btherapy app\b/, /\bcbt\b/, /\bmood tracking\b/, /\bemotional support\b/, /\bwellbeing app\b/],
    problem: [/\banxiety\b/, /\bstress\b/, /\bdepression\b/, /\bemotional wellbeing\b/, /\bmood\b/],
    audience: [/\bpatients?\b/, /\bindividuals seeking support\b/, /\btherapists?\b/],
  },
  {
    key: 'real_estate',
    kind: 'vertical',
    terms: ['real estate', 'property', 'brokerage', 'tenant', 'landlord', 'mortgage'],
    explicit: [/\breal estate\b/, /\bproperty\b/, /\bbrokerage\b/, /\bmortgage\b/],
    product: [/\blistings?\b/, /\btenant\b/, /\blandlord\b/, /\bleasing\b/, /\bproperty management\b/],
    problem: [/\bhome buying\b/, /\brentals?\b/, /\boccupancy\b/, /\basset management\b/],
  },
  {
    key: 'manufacturing',
    kind: 'vertical',
    terms: ['manufacturing', 'manufacturer', 'factory', 'production', 'assembly'],
    explicit: [/\bmanufactur(er|ing)\b/, /\bfactory\b/, /\bindustrial production\b/],
    product: [/\bproduce(s|d)?\b/, /\bassembly\b/, /\bfabrication\b/, /\bplant\b/, /\bmaterials?\b/],
    problem: [/\bquality control\b/, /\bproduction line\b/, /\bthroughput\b/, /\bmaintenance\b/],
  },
  {
    key: 'industrial',
    kind: 'vertical',
    terms: ['industrial', 'machinery', 'equipment', 'plant', 'factory', 'components'],
    explicit: [/\bindustrial\b/, /\bmachinery\b/, /\bequipment\b/, /\bcomponents?\b/],
    product: [/\bpumps?\b/, /\bvalves?\b/, /\bmotors?\b/, /\bmachines?\b/, /\bparts?\b/],
    problem: [/\bdowntime\b/, /\breliability\b/, /\bmaintenance\b/, /\boperations\b/],
  },
];

const FUNCTION_DEFINITIONS: DomainDefinition[] = [
  {
    key: 'decision_support',
    kind: 'function',
    terms: ['decision', 'guidance', 'clarity', 'recommendation', 'planning', 'direction'],
    explicit: [/\bdecision support\b/, /\bdecision[-\s]?making\b/, /\bguidance\b/, /\bclarity\b/],
    product: [/\brecommendations?\b/, /\bassistant\b/, /\badvisor\b/, /\bplanning\b/, /\bdirection\b/],
    problem: [/\bchoose\b/, /\bchoices\b/, /\buncertainty\b/, /\bfind direction\b/, /\bmake decisions?\b/],
    audience: [/\bfounders?\b/, /\bprofessionals?\b/, /\bstudents?\b/, /\bindividuals?\b/],
  },
  {
    key: 'workflow_automation',
    kind: 'function',
    terms: ['workflow', 'automation', 'operations', 'tasks', 'orchestration', 'approvals'],
    explicit: [/\bworkflow automation\b/, /\bautomation\b/, /\boperations platform\b/],
    product: [/\bautomate(s|d)?\b/, /\borchestrat(e|ion)\b/, /\bapprovals?\b/, /\bscheduling\b/, /\btasks?\b/],
    problem: [/\bmanual work\b/, /\bprocess\b/, /\befficiency\b/, /\boperational bottlenecks?\b/],
  },
  {
    key: 'content_creation',
    kind: 'function',
    terms: ['writing', 'content', 'copy', 'blog', 'article', 'creative', 'caption'],
    explicit: [/\bcontent creation\b/, /\bwriting tool\b/, /\bai writer\b/, /\bcopywriting\b/],
    product: [/\bwrite(s|r)?\b/, /\bgenerate(s|d)? content\b/, /\bblog posts?\b/, /\barticles?\b/, /\bcaptions?\b/, /\bad copy\b/],
    problem: [/\bwriter'?s block\b/, /\bcontent velocity\b/, /\bcreative output\b/, /\bpublishing\b/],
    audience: [/\bcreators?\b/, /\bmarketers?\b/, /\bwriters?\b/],
  },
  {
    key: 'analytics',
    kind: 'function',
    terms: ['analytics', 'insights', 'dashboard', 'reporting', 'forecasting', 'intelligence'],
    explicit: [/\banalytics\b/, /\binsights?\b/, /\breporting\b/, /\bbusiness intelligence\b/],
    product: [/\bdashboards?\b/, /\bforecast(s|ing)?\b/, /\bscorecards?\b/, /\bmetrics?\b/, /\bdata\b/],
    problem: [/\bvisibility\b/, /\bmeasurement\b/, /\bperformance\b/, /\btrend(s)?\b/],
  },
  {
    key: 'communication',
    kind: 'function',
    terms: ['communication', 'messaging', 'chat', 'inbox', 'email', 'collaboration'],
    explicit: [/\bcommunication\b/, /\bmessaging\b/, /\bcollaboration\b/, /\binbox\b/],
    product: [/\bchat\b/, /\bemail\b/, /\bnotifications?\b/, /\bteam conversations?\b/, /\bbroadcasts?\b/],
    problem: [/\bresponse time\b/, /\bcoordination\b/, /\balignment\b/, /\bfollow[-\s]?up\b/],
  },
  {
    key: 'personal_development',
    kind: 'function',
    terms: ['personal growth', 'self reflection', 'life direction', 'habits', 'purpose', 'career clarity'],
    explicit: [/\bpersonal development\b/, /\bpersonal growth\b/, /\bself[-\s]?reflection\b/, /\blife direction\b/],
    product: [/\bjournal(ing)?\b/, /\breflection\b/, /\bcoaching\b/, /\bguidance\b/, /\bhabit(s)?\b/],
    problem: [/\bpurpose\b/, /\bcareer choices?\b/, /\bmental clarity\b/, /\bself[-\s]?improvement\b/],
    audience: [/\bstudents?\b/, /\bprofessionals?\b/, /\bindividuals?\b/],
  },
  {
    key: 'customer_engagement',
    kind: 'function',
    terms: ['customer engagement', 'retention', 'lifecycle', 'support', 'loyalty'],
    explicit: [/\bcustomer engagement\b/, /\bretention\b/, /\bcustomer lifecycle\b/, /\bloyalty\b/],
    product: [/\bengage(s|ment)?\b/, /\bjourneys?\b/, /\bsegments?\b/, /\bsupport\b/, /\bcommunity\b/],
    problem: [/\bchurn\b/, /\badoption\b/, /\bactivation\b/, /\bcustomer experience\b/],
  },
  {
    key: 'business_operations',
    kind: 'function',
    terms: ['operations', 'process', 'management', 'delivery', 'service', 'execution'],
    explicit: [/\boperations?\b/, /\bmanagement platform\b/, /\bservice delivery\b/],
    product: [/\bmanage(s|ment)?\b/, /\bcoordinate\b/, /\btrack\b/, /\bexecute\b/, /\bdeliver\b/],
    problem: [/\befficiency\b/, /\bvisibility\b/, /\bquality\b/, /\bscale\b/],
  },
];

const countMatches = (text: string, patterns: RegExp[] = []): number =>
  patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);

const overlapScore = (text: string, terms: string[]): number => {
  const tokens = new Set(tokenizeCompetitorText(text));
  return terms.reduce((sum, term) => {
    const termTokens = tokenizeCompetitorText(term);
    if (termTokens.length === 0) return sum;
    const overlap = termTokens.filter((token) => tokens.has(token)).length / termTokens.length;
    return sum + overlap;
  }, 0);
};

const scoreDomain = (definition: DomainDefinition, signals: SignalSet): ScoredDomain => {
  const explicit = countMatches(signals.explicit, definition.explicit);
  const product = countMatches(signals.product, definition.product);
  const problem = countMatches(signals.problem, definition.problem);
  const audience = countMatches(signals.audience, definition.audience);
  const lowContextFit = overlapScore(signals.lowContext, definition.terms);
  const tokenFit = overlapScore([signals.explicit, signals.product, signals.problem, signals.audience].join(' '), definition.terms);
  const evidenceBuckets = [explicit, product, problem, audience, lowContextFit >= 1 ? 1 : 0].filter((value) => value > 0).length;
  const score =
    explicit * 2.5 +
    product * 3.4 +
    problem * 3.2 +
    audience * 1.6 +
    tokenFit * 0.55 +
    lowContextFit * 0.18;
  return {
    key: definition.key,
    kind: definition.kind,
    score: Number(score.toFixed(2)),
    evidenceBuckets,
  };
};

const rankedDomains = (definitions: DomainDefinition[], signals: SignalSet): ScoredDomain[] =>
  definitions
    .map((definition) => scoreDomain(definition, signals))
    .filter((domain) => domain.score >= (domain.kind === 'vertical' ? 4.2 : 3.8) && domain.evidenceBuckets >= 1)
    .sort((left, right) =>
      right.score - left.score ||
      right.evidenceBuckets - left.evidenceBuckets ||
      left.key.localeCompare(right.key)
    );

const detectContextGroups = (signals: SignalSet): string[] => {
  const text = signals.all;
  const groups: Array<[string, RegExp]> = [
    ['career', /\bcareer|job|professionals?|students?|work direction\b/],
    ['personal', /\blife|personal|self[-\s]?reflection|purpose|habits?|growth\b/],
    ['business', /\bbusiness|teams?|founders?|sales|marketing|customers?|operations?\b/],
    ['clinical', /\bclinical|patients?|therapy|mental health|medical|care\b/],
    ['education', /\beducation|learning|students?|teachers?|courses?\b/],
  ];
  return groups.filter(([, pattern]) => pattern.test(text)).map(([group]) => group);
};

const isNarrowVerticalUseCase = (
  topVertical: ScoredDomain | undefined,
  secondVertical: ScoredDomain | undefined,
  functions: ScoredDomain[],
  contextGroups: string[],
): boolean => {
  if (!topVertical) return false;
  if (topVertical.score < 6.4 || topVertical.evidenceBuckets < 2) return false;
  if (secondVertical && secondVertical.score > topVertical.score * 0.7) return false;
  if (['manufacturing', 'industrial', 'marketplace', 'ecommerce'].includes(topVertical.key)) return true;
  if (topVertical.score >= 10 && contextGroups.length <= 2) return true;
  return functions.length <= 2 && contextGroups.length <= 1;
};

const scoreRatioWithin = (left: number, right: number, tolerance: number): boolean => {
  const max = Math.max(left, right);
  if (max <= 0) return false;
  return Math.abs(left - right) / max <= tolerance;
};

const chooseClassificationPath = (
  verticals: ScoredDomain[],
  functions: ScoredDomain[],
  contextGroups: string[],
): ClassificationDecision => {
  const [topVertical, secondVertical] = verticals;
  const [topFunction] = functions;
  const verticalScore = topVertical?.score ?? 0;
  const functionScore = topFunction?.score ?? 0;
  const unrelatedContextSpread = contextGroups.length >= 3 ||
    (contextGroups.includes('career') && contextGroups.includes('personal')) ||
    (contextGroups.includes('business') && contextGroups.includes('personal'));
  const multiDomain = verticals.length > 2 || functions.length > 2 || unrelatedContextSpread;
  const closeScores = scoreRatioWithin(verticalScore, functionScore, 0.1);
  const wellDefinedVertical = topVertical ? WELL_DEFINED_VERTICALS.has(topVertical.key) : false;

  let mode: ClassificationMode;
  if (closeScores) {
    mode = wellDefinedVertical && !multiDomain ? 'vertical' : 'function';
  } else if (isNarrowVerticalUseCase(topVertical, secondVertical, functions, contextGroups) && !multiDomain) {
    mode = 'vertical';
  } else if (isNarrowVerticalUseCase(topVertical, secondVertical, functions, contextGroups) && topVertical && topVertical.score >= 10) {
    mode = 'vertical';
  } else {
    mode = functions.length > 0 ? 'function' : 'vertical';
  }

  const selectedScore = mode === 'vertical' ? verticalScore : functionScore;
  const competingScore = mode === 'vertical' ? functionScore : verticalScore;
  const margin = selectedScore <= 0 ? 0 : Math.max(0, selectedScore - competingScore) / selectedScore;
  const confidence = Math.max(0.35, Math.min(0.98, (selectedScore / 14) * 0.7 + margin * 0.3));
  return {
    mode,
    confidence: Number(confidence.toFixed(3)),
    verticalScore: Number(verticalScore.toFixed(2)),
    functionScore: Number(functionScore.toFixed(2)),
  };
};

const inferLevel1 = (text: string): BusinessModelLevel1 => {
  const marketplace = has(text, /\bmarketplace|buyers?\s+and\s+sellers?|vendors?\s+and\s+customers?|two[-\s]?sided\b/);
  const retailer = has(text, /\bshop|store|retail|ecommerce|e-commerce|commerce brand|online store\b/);
  const distributor = has(text, /\bdistributor|distribution|wholesale|reseller|channel partner\b/);
  const manufacturer = has(text, /\bmanufacturer|manufacturing|factory|made in|industrial production|fabrication|assembly line\b/);
  const agency = has(text, /\bagency|consulting|consultant|coaching|outsourcing|staffing|managed services|professional services|done[-\s]?for[-\s]?you|implementation services\b/);
  const services = agency || has(text, /\bservice delivery|advisory|implementation|fractional|retainer\b/);
  const product = has(text, /\bsoftware|saas|platform|app|application|tool|assistant|product|automation|dashboard|analytics|ai\b/);
  const strongProduct = has(text, /\bsoftware platform|saas|mobile app|cloud platform|self[-\s]?serve|api|dashboard|product suite\b/);
  const strongService = has(text, /\bagency|consulting|consultant|coaching|outsourcing|staffing|managed services|professional services\b/);

  if (marketplace) return 'marketplace';
  if (manufacturer) return 'manufacturer';
  if (distributor && !product) return 'distributor';
  if (retailer && !product) return 'retailer';
  if (agency) return 'services_company';
  if (strongProduct && strongService) return 'hybrid';
  if (services) return 'services_company';
  if (product) return 'product_company';
  return 'product_company';
};

const inferLevel2 = (level1: BusinessModelLevel1, text: string): BusinessTypeLevel2 => {
  if (level1 === 'marketplace') {
    return has(text, /\bb2b\b|\bbusinesses\b|\bsuppliers\b|\bprocurement\b|\benterprise\b/)
      ? 'b2b_marketplace'
      : 'b2c_marketplace';
  }
  if (level1 === 'services_company') {
    if (has(text, /\bmarketing|seo|content|growth|demand generation|brand agency|performance marketing\b/)) return 'marketing_agency';
    if (has(text, /\bcoach|coaching|mentor|mentorship|advisor\b/)) return 'coaching';
    if (has(text, /\boutsourcing|staffing|virtual employee|bpo|offshore|remote team\b/)) return 'outsourcing';
    if (has(text, /\bit services|managed it|software development services|web development services|technology services\b/)) return 'it_services';
    return 'consulting';
  }
  if (level1 === 'retailer') return 'retailer';
  if (level1 === 'distributor') return 'distributor';
  if (level1 === 'manufacturer') return 'manufacturer';
  if (level1 === 'hybrid') {
    if (has(text, /\bai|artificial intelligence|machine learning|llm|chatbot|assistant|copilot\b/)) return 'ai_product';
    return 'hybrid';
  }
  if (has(text, /\bai|artificial intelligence|machine learning|llm|chatbot|assistant|copilot\b/)) return 'ai_product';
  if (has(text, /\bmobile app|ios|android|app store|play store\b/)) return 'mobile_app';
  if (has(text, /\bsaas|software as a service|subscription software|cloud platform\b/)) return 'saas_product';
  if (has(text, /\bcpg|consumer packaged|skincare|food|beverage|supplement|cosmetic\b/)) return 'cpg_brand';
  if (has(text, /\bhardware|device|sensor|wearable|iot\b/)) return 'hardware_product';
  return 'saas_product';
};

const titleCaseDomain = (value: string): string =>
  value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const DOMAIN_DISPLAY_LABELS: Record<string, string> = {
  decision_support: 'Decision Support',
  personal_clarity: 'Personal Development',
  personal_development: 'Personal Development',
  content_creation: 'Content Creation',
  marketing_technology: 'Marketing Technology',
  ecommerce: 'E-commerce',
  marketplace: 'Marketplace',
  manufacturing: 'Manufacturing',
  industrial: 'Industrial',
  automation: 'Workflow Automation',
  workflow_automation: 'Workflow Automation',
  analytics: 'Data & Analytics',
  data_analytics: 'Data & Analytics',
  communication: 'Communication',
  customer_engagement: 'Customer Engagement',
  business_operations: 'Business Operations',
  mental_wellness: 'Mental Wellness',
  healthcare: 'Healthcare',
  health_tech: 'Health Technology',
  fintech: 'Financial Technology',
  edtech: 'Education Technology',
  supply_chain: 'Supply Chain',
  real_estate: 'Real Estate',
};

const displayDomainLabel = (value: string): string => {
  const normalized = normalizeKey(value);
  return DOMAIN_DISPLAY_LABELS[normalized] ?? titleCaseDomain(normalized);
};

const displayDomainList = (values: string[], max: number): string[] => {
  const result: string[] = [];
  values.forEach((value) => {
    const label = displayDomainLabel(value);
    if (!label || result.some((item) => item.toLowerCase() === label.toLowerCase())) return;
    result.push(label);
  });
  return result.slice(0, max);
};

const hasDomain = (domains: string[], domain: string): boolean => domains.includes(domain);

const isConsumerContext = (signals: SignalSet): boolean =>
  /\bindividuals?|students?|professionals?|people|personal|career|life|patients?|creators?|writers?\b/.test(signals.audience) &&
  !/\benterprise|b2b|companies|businesses|teams|sales teams|growth teams|operations managers\b/.test(signals.audience);

const isBusinessContext = (signals: SignalSet): boolean =>
  /\benterprise|b2b|companies|businesses|teams|marketers?|sales teams|growth teams|operators|managers|founders\b/.test(signals.audience);

const serviceCategory = (level2: BusinessTypeLevel2, domains: string[]): string => {
  if (level2 === 'marketing_agency') return 'Marketing service for stronger campaigns and measurable growth';
  if (level2 === 'coaching') return 'Coaching service for clearer goals and personal progress';
  if (level2 === 'outsourcing') return 'Outsourcing service for scalable operational support';
  if (level2 === 'it_services') return 'IT service for reliable technology operations';
  if (hasDomain(domains, 'workflow_automation')) return 'Consulting service for smoother workflows and operating efficiency';
  return 'Consulting service for clearer strategy and better execution';
};

const generateCategory = (
  level2: BusinessTypeLevel2,
  domains: string[],
  industry: string[],
  signals: SignalSet,
): string => {
  const keys = cleanList([...domains, ...industry], 6);
  const b2c = isConsumerContext(signals);
  const b2b = isBusinessContext(signals);

  if (level2 === 'marketing_agency' || level2 === 'consulting' || level2 === 'coaching' || level2 === 'outsourcing' || level2 === 'it_services') {
    return serviceCategory(level2, keys);
  }
  if (hasDomain(keys, 'decision_support') && hasDomain(keys, 'personal_development') && level2 === 'ai_product') {
    return 'AI tool for structured thinking and clearer life and career decisions';
  }
  if (hasDomain(keys, 'decision_support') && level2 === 'ai_product') {
    return b2b
      ? 'AI tool for clearer decisions and practical next steps'
      : 'AI tool for clearer personal decisions and next steps';
  }
  if (hasDomain(keys, 'personal_development')) {
    return level2 === 'mobile_app'
      ? 'Personal growth app for reflection, clarity, and habit building'
      : 'Digital assistant for reflection, clarity, and personal growth';
  }
  if (hasDomain(keys, 'mental_wellness')) {
    return level2 === 'mobile_app'
      ? 'Mental wellness app for guided emotional support'
      : 'Mental wellness tool for guided support and healthier routines';
  }
  if (hasDomain(keys, 'content_creation')) {
    return level2 === 'ai_product'
      ? 'AI writing tool for faster, better content creation'
      : 'Content software for faster publishing and stronger creative output';
  }
  if (hasDomain(keys, 'workflow_automation')) {
    return b2c
      ? 'Automation tool for simplifying everyday tasks and routines'
      : 'Workflow software for automating repetitive business operations';
  }
  if (hasDomain(keys, 'analytics')) {
    return 'Analytics software for clearer performance insights';
  }
  if (hasDomain(keys, 'communication')) {
    return 'Communication software for faster response and team coordination';
  }
  if (hasDomain(keys, 'customer_engagement')) {
    return 'Customer engagement software for retention and lifecycle growth';
  }
  if (hasDomain(keys, 'marketing_technology')) {
    return b2b
      ? 'Marketing software for campaign performance and pipeline growth'
      : 'Marketing tool for improving reach and audience growth';
  }
  if (hasDomain(keys, 'manufacturing') || hasDomain(keys, 'industrial')) {
    return 'Manufacturer of industrial components for reliable production operations';
  }
  if (hasDomain(keys, 'ecommerce') && hasDomain(keys, 'marketplace')) {
    return 'Marketplace for trusted online buying and selling';
  }
  if (hasDomain(keys, 'ecommerce')) {
    return 'E-commerce business for streamlined online buying';
  }
  if (hasDomain(keys, 'fintech')) {
    return 'Financial software for smoother payments and money operations';
  }
  if (hasDomain(keys, 'edtech')) {
    return 'Learning software for skill development and better education outcomes';
  }
  if (hasDomain(keys, 'supply_chain')) {
    return 'Supply chain software for inventory, logistics, and fulfillment control';
  }
  if (hasDomain(keys, 'real_estate')) {
    return 'Real estate software for property discovery and management';
  }
  return b2b
    ? 'Business software for clearer operations and measurable growth'
    : 'Digital tool for practical guidance and everyday progress';
};

const removeFallbackDomains = (domains: string[]): string[] => {
  if (domains.length <= 1) return domains;
  return domains.filter((domain) => domain !== 'business_operations');
};

const signatureSimilarity = (left: string[], right: string[]): number => {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const overlap = left.filter((token) => rightSet.has(token)).length;
  return overlap / Math.max(left.length, right.length);
};

const applyDomainStability = (
  companyId: string | null | undefined,
  next: BusinessClassificationResult,
  confidence: number,
  signature: string,
): BusinessClassificationResult => {
  const cacheKey = String(companyId || '').trim();
  const signatureTokens = tokenizeCompetitorText(signature);
  if (!cacheKey) return next;
  const cached = classificationCache.get(cacheKey);
  if (cached) {
    const similarity = signatureSimilarity(cached.signatureTokens, signatureTokens);
    const confidenceImprovement = confidence - cached.confidence;
    const domainsChanged = cached.business_classification.level_3.join('|') !== next.business_classification.level_3.join('|');
    if (domainsChanged && similarity >= 0.35 && confidenceImprovement < STABILITY_CONFIDENCE_IMPROVEMENT) {
      console.info('[company-classification][stability-cache]', {
        company_id: cacheKey,
        action: 'kept_cached_domains',
        previous_confidence: cached.confidence,
        next_confidence: confidence,
        signature_similarity: Number(similarity.toFixed(3)),
        cached_domains: cached.business_classification.level_3,
        next_domains: next.business_classification.level_3,
      });
      return {
        business_classification: {
          ...next.business_classification,
          level_3: cached.business_classification.level_3,
        },
        industry: cached.industry,
        category: cached.category,
      };
    }
  }

  classificationCache.set(cacheKey, {
    ...next,
    confidence,
    signatureTokens,
  });
  return next;
};

export const classifyCompanyBusiness = (
  profile: CompanyProfile,
  extraction?: CompanyProfileExtractionOutput | null,
): BusinessClassificationResult => {
  const signals = buildSignals(profile, extraction);
  const level1 = inferLevel1(signals.all);
  const level2 = inferLevel2(level1, signals.all);
  let verticals = rankedDomains(VERTICAL_DEFINITIONS, signals);
  let functions = rankedDomains(FUNCTION_DEFINITIONS, signals);

  if (level1 === 'marketplace' && !verticals.some((domain) => domain.key === 'marketplace')) {
    verticals = [{ key: 'marketplace', kind: 'vertical', score: 8, evidenceBuckets: 2 }, ...verticals];
  }
  if (level1 === 'manufacturer' && !verticals.some((domain) => domain.key === 'manufacturing')) {
    verticals = [{ key: 'manufacturing', kind: 'vertical', score: 8, evidenceBuckets: 2 }, ...verticals];
  }

  const contextGroups = detectContextGroups(signals);
  const decision = chooseClassificationPath(verticals, functions, contextGroups);
  const path = decision.mode;
  let topVerticals = verticals.map((domain) => domain.key);
  if (level1 === 'manufacturer') {
    topVerticals = [
      ...['manufacturing', 'industrial'].filter((domain) => topVerticals.includes(domain)),
      ...topVerticals.filter((domain) => !['manufacturing', 'industrial'].includes(domain)),
    ];
  }
  if (level1 === 'marketplace') {
    topVerticals = [
      ...['ecommerce', 'marketplace'].filter((domain) => topVerticals.includes(domain)),
      ...topVerticals.filter((domain) => !['ecommerce', 'marketplace'].includes(domain)),
    ];
  }
  const topFunctions = functions.map((domain) => domain.key);
  const selectedIndustries = path === 'vertical'
    ? cleanList(removeFallbackDomains(topVerticals.length > 0 ? topVerticals : ['business_operations']), 2)
    : cleanList(removeFallbackDomains(topFunctions.length > 0 ? topFunctions : ['business_operations']), 2);
  const selectedDomains = cleanList([
    ...(path === 'vertical' ? removeFallbackDomains(topVerticals).slice(0, 2) : removeFallbackDomains(topFunctions).slice(0, 2)),
    ...(path === 'vertical' ? topFunctions.slice(0, 1) : topVerticals.slice(0, 1)),
  ], 3);
  const industry = selectedIndustries.length > 0 ? selectedIndustries : ['business_operations'];
  const domains = selectedDomains.length > 0 ? selectedDomains : industry;
  const category = generateCategory(level2, domains, industry, signals);
  const displayIndustries = displayDomainList(industry, 2);
  const displayDomains = displayDomainList(domains, 3);

  const result = {
    business_classification: {
      level_1: level1,
      level_2: level2,
      level_3: displayDomains,
    },
    industry: displayIndustries,
    category,
  };

  console.info('[company-classification][metrics]', {
    company_id: profile.company_id ?? null,
    vertical_score: decision.verticalScore,
    function_score: decision.functionScore,
    selected_mode: decision.mode,
    confidence: decision.confidence,
    domains_detected: displayDomains,
    internal_domains_detected: domains,
  });

  return applyDomainStability(profile.company_id, result, decision.confidence, signals.signature);
};
