/**
 * COMPETITOR-TAXONOMY-P2-CALIBRATION-001 — Extended cross-industry validation dataset.
 *
 * A larger, labelled fixture set spanning taxonomy-SEEN and taxonomy-UNSEEN industries, used
 * ONLY for calibration measurement (signal contribution, sensitivity, weight optimization,
 * validation). No architecture or live wiring depends on it. Each industry contributes at
 * least one genuine competitor (positive) and one realistic cross-category near-miss
 * (negative) so false-positive control is actually exercised — negatives are plausibly
 * retrievable, not trivially unrelated.
 *
 * Pure data. Reuses the CalibrationCase contract from competitorQualificationCalibration.ts.
 */

import type { CompanyCompetitiveContext, CompetitorCandidate } from '../../competitorEngineServiceModel';
import type { CalibrationCase } from './competitorQualificationCalibration';

function ctx(partial: Partial<CompanyCompetitiveContext>): CompanyCompetitiveContext {
  return {
    marketFocus: null,
    primaryService: null,
    targetCustomer: null,
    idealCustomerProfile: null,
    brandPositioning: null,
    geography: null,
    teamSize: null,
    foundedYear: null,
    revenueRange: null,
    businessModel: null,
    entityArchetype: null,
    ...partial,
  };
}

function cand(partial: Partial<CompetitorCandidate> & { name: string }): CompetitorCandidate {
  return { source: 'serp_live', confidenceScore: 0.6, ...partial };
}

// ── Company contexts ─────────────────────────────────────────────────────────
// SEEN industries (taxonomy has vocabulary)
const MENTAL_WELLNESS = ctx({
  marketFocus: 'mental wellness AI platform',
  primaryService: 'AI mental wellness chatbot for anxiety and stress, guided clarity and self-reflection',
  targetCustomer: 'individuals seeking emotional wellbeing and mental health support',
  idealCustomerProfile: 'consumers with anxiety, stress, seeking self-reflection',
  brandPositioning: 'clinically-informed emotional wellbeing companion',
  businessModel: 'B2C subscription',
});
const MEDITATION = ctx({
  marketFocus: 'meditation and mindfulness app',
  primaryService: 'guided meditation, mindfulness and sleep stories for relaxation and stress reduction',
  targetCustomer: 'consumers seeking meditation, better sleep and relaxation',
  idealCustomerProfile: 'stressed professionals wanting mindfulness and sleep',
  brandPositioning: 'daily meditation and sleep for calm',
  businessModel: 'B2C subscription',
});
const MARKETING_PLATFORM = ctx({
  marketFocus: 'AI marketing and content platform',
  primaryService: 'AI content generation, SEO copywriting and social media scheduling for brands',
  targetCustomer: 'B2B marketing teams and founders',
  idealCustomerProfile: 'SMB marketing teams doing content marketing and SEO',
  brandPositioning: 'AI marketing intelligence and content automation',
  businessModel: 'B2B SaaS',
});
const CRM = ctx({
  marketFocus: 'CRM and sales automation platform',
  primaryService: 'CRM, sales pipeline automation, lead nurturing and revenue operations for sales teams',
  targetCustomer: 'B2B sales and revenue teams',
  idealCustomerProfile: 'mid-market B2B sales organizations',
  brandPositioning: 'CRM and revenue operations automation',
  businessModel: 'B2B SaaS',
});
const AI_PLATFORM = ctx({
  marketFocus: 'general-purpose AI platform',
  primaryService: 'foundation model and developer API for general-purpose AI applications',
  targetCustomer: 'developers and enterprises building AI applications',
  idealCustomerProfile: 'engineering teams integrating LLMs',
  brandPositioning: 'developer AI platform and foundation models',
  businessModel: 'B2B usage-based',
});
const COACHING = ctx({
  marketFocus: 'coaching and consulting marketplace',
  primaryService: 'human-led coaching, mentoring and consulting for personal growth and life direction',
  targetCustomer: 'individuals seeking coaching, mentoring and life direction',
  idealCustomerProfile: 'professionals seeking career and life coaching',
  brandPositioning: 'human coaches and mentors marketplace',
  businessModel: 'marketplace',
});

// UNSEEN industries (taxonomy has NO vocabulary → P0 abstains to `unknown`)
const LOGISTICS = ctx({
  marketFocus: 'freight logistics visibility platform',
  primaryService: 'real-time shipment tracking and supply chain visibility for freight operators',
  targetCustomer: 'freight forwarders, carriers and logistics operators',
  idealCustomerProfile: 'mid-market logistics and supply chain teams',
  brandPositioning: 'end-to-end freight visibility and shipment tracking',
  businessModel: 'B2B SaaS',
});
const LEGALTECH = ctx({
  marketFocus: 'contract lifecycle management platform',
  primaryService: 'contract lifecycle management, clause automation and legal document review for legal teams',
  targetCustomer: 'in-house legal teams and general counsel',
  idealCustomerProfile: 'enterprise legal operations managing contracts',
  brandPositioning: 'AI contract management and clause automation',
  businessModel: 'B2B SaaS',
});
const AGRITECH = ctx({
  marketFocus: 'precision agriculture analytics platform',
  primaryService: 'precision farming crop analytics, soil sensors and yield prediction for farms',
  targetCustomer: 'farms, growers and agronomists',
  idealCustomerProfile: 'commercial farms adopting precision agriculture',
  brandPositioning: 'data-driven precision agriculture and crop yield analytics',
  businessModel: 'B2B SaaS',
});
const FINTECH_LENDING = ctx({
  marketFocus: 'SMB lending and underwriting platform',
  primaryService: 'automated loan origination, credit underwriting and risk scoring for small business lending',
  targetCustomer: 'banks, lenders and credit unions',
  idealCustomerProfile: 'lenders digitizing loan origination and underwriting',
  brandPositioning: 'automated underwriting and loan origination',
  businessModel: 'B2B SaaS',
});
const HEALTHTECH_EHR = ctx({
  marketFocus: 'electronic health records platform',
  primaryService: 'electronic health records, clinical charting and patient scheduling for medical practices',
  targetCustomer: 'clinics, physicians and medical practices',
  idealCustomerProfile: 'outpatient clinics digitizing patient records',
  brandPositioning: 'cloud EHR and clinical charting',
  businessModel: 'B2B SaaS',
});
const CYBERSECURITY = ctx({
  marketFocus: 'endpoint security platform',
  primaryService: 'endpoint detection and response, threat hunting and malware protection for security teams',
  targetCustomer: 'security operations and IT teams',
  idealCustomerProfile: 'enterprise SOC teams defending endpoints',
  brandPositioning: 'endpoint detection and response security',
  businessModel: 'B2B SaaS',
});
const HR_ATS = ctx({
  marketFocus: 'recruiting and applicant tracking platform',
  primaryService: 'applicant tracking, candidate sourcing and interview scheduling for recruiters',
  targetCustomer: 'recruiters and talent acquisition teams',
  idealCustomerProfile: 'mid-market talent acquisition teams',
  brandPositioning: 'applicant tracking and candidate sourcing',
  businessModel: 'B2B SaaS',
});
const PROPTECH = ctx({
  marketFocus: 'property management software',
  primaryService: 'rental property management, tenant screening and lease accounting for landlords',
  targetCustomer: 'landlords, property managers and real estate operators',
  idealCustomerProfile: 'residential property managers',
  brandPositioning: 'property management and tenant screening',
  businessModel: 'B2B SaaS',
});
const DEVTOOLS = ctx({
  marketFocus: 'observability and monitoring platform',
  primaryService: 'application performance monitoring, distributed tracing and log analytics for engineering teams',
  targetCustomer: 'software engineering and DevOps teams',
  idealCustomerProfile: 'engineering teams monitoring production systems',
  brandPositioning: 'observability, tracing and log analytics',
  businessModel: 'B2B usage-based',
});
const INSURTECH = ctx({
  marketFocus: 'insurance claims automation platform',
  primaryService: 'digital insurance claims processing, fraud detection and policy administration for insurers',
  targetCustomer: 'insurance carriers and claims teams',
  idealCustomerProfile: 'insurers automating claims processing',
  brandPositioning: 'claims automation and fraud detection',
  businessModel: 'B2B SaaS',
});

// ── Dataset ──────────────────────────────────────────────────────────────────
export const EXTENDED_CALIBRATION_CASES: CalibrationCase[] = [
  // SEEN — mental wellness
  { id: 'x-wellness-true', industry: 'mental_wellness', coverage: 'seen', context: MENTAL_WELLNESS, expectedCompetitor: true,
    candidate: cand({ name: 'Woebot', domain: 'woebothealth.com', category: 'mental_wellness_ai', description: 'AI mental health chatbot for anxiety, stress and emotional wellbeing using CBT and self-reflection', targetCustomer: 'individuals seeking mental health support', businessModel: 'B2C subscription' }) },
  { id: 'x-wellness-companion-neg', industry: 'mental_wellness', coverage: 'seen', context: MENTAL_WELLNESS, expectedCompetitor: false,
    candidate: cand({ name: 'Replika', domain: 'replika.com', category: 'ai_companion', description: 'AI companion and virtual friend for romantic relationships, conversation and companionship', targetCustomer: 'people seeking a virtual friend or romantic companion', businessModel: 'B2C subscription' }) },
  { id: 'x-wellness-crm-neg', industry: 'mental_wellness', coverage: 'seen', context: MENTAL_WELLNESS, expectedCompetitor: false,
    candidate: cand({ name: 'HubSpot', domain: 'hubspot.com', category: 'crm_marketing_automation', description: 'CRM, marketing automation and sales pipeline software for B2B revenue teams', targetCustomer: 'B2B sales and marketing teams', businessModel: 'B2B SaaS' }) },
  // SEEN — meditation
  { id: 'x-meditation-true', industry: 'meditation', coverage: 'seen', context: MEDITATION, expectedCompetitor: true,
    candidate: cand({ name: 'Headspace', domain: 'headspace.com', category: 'meditation_mindfulness', description: 'guided meditation, mindfulness and sleep app for stress, relaxation and better sleep', targetCustomer: 'consumers seeking meditation and sleep', businessModel: 'B2C subscription' }) },
  { id: 'x-meditation-crm-neg', industry: 'meditation', coverage: 'seen', context: MEDITATION, expectedCompetitor: false,
    candidate: cand({ name: 'Salesforce', domain: 'salesforce.com', category: 'crm_marketing_automation', description: 'CRM and sales automation for enterprise revenue teams', targetCustomer: 'enterprise sales teams', businessModel: 'B2B SaaS' }) },
  // SEEN — marketing
  { id: 'x-marketing-true', industry: 'marketing_seo', coverage: 'seen', context: MARKETING_PLATFORM, expectedCompetitor: true,
    candidate: cand({ name: 'Jasper', domain: 'jasper.ai', category: 'marketing_seo_software', description: 'AI content generation, SEO copywriting and marketing content platform for brands and marketing teams', targetCustomer: 'B2B marketing teams', businessModel: 'B2B SaaS' }) },
  { id: 'x-marketing-meditation-neg', industry: 'marketing_seo', coverage: 'seen', context: MARKETING_PLATFORM, expectedCompetitor: false,
    candidate: cand({ name: 'Calm', domain: 'calm.com', category: 'meditation_mindfulness', description: 'meditation, mindfulness and sleep app for relaxation and stress reduction', targetCustomer: 'consumers seeking meditation and better sleep', businessModel: 'B2C subscription' }) },
  // SEEN — CRM
  { id: 'x-crm-true', industry: 'crm', coverage: 'seen', context: CRM, expectedCompetitor: true,
    candidate: cand({ name: 'Pipedrive', domain: 'pipedrive.com', category: 'crm_marketing_automation', description: 'CRM and sales pipeline automation with lead nurturing for B2B sales teams', targetCustomer: 'B2B sales teams', businessModel: 'B2B SaaS' }) },
  { id: 'x-crm-wellness-neg', industry: 'crm', coverage: 'seen', context: CRM, expectedCompetitor: false,
    candidate: cand({ name: 'Wysa', domain: 'wysa.io', category: 'mental_wellness_ai', description: 'AI mental wellness chatbot for anxiety and emotional wellbeing', targetCustomer: 'individuals seeking mental health support', businessModel: 'B2C subscription' }) },
  // SEEN — AI platform
  { id: 'x-aiplatform-true', industry: 'ai_platform', coverage: 'seen', context: AI_PLATFORM, expectedCompetitor: true,
    candidate: cand({ name: 'Cohere', domain: 'cohere.com', category: 'ai_platform', description: 'foundation models and developer API for general-purpose AI applications and enterprises', targetCustomer: 'developers and enterprises building AI', businessModel: 'B2B usage-based' }) },
  { id: 'x-aiplatform-crm-neg', industry: 'ai_platform', coverage: 'seen', context: AI_PLATFORM, expectedCompetitor: false,
    candidate: cand({ name: 'Zoho CRM', domain: 'zoho.com', category: 'crm_marketing_automation', description: 'CRM and sales automation suite for small business revenue teams', targetCustomer: 'SMB sales teams', businessModel: 'B2B SaaS' }) },
  // SEEN — coaching
  { id: 'x-coaching-true', industry: 'coaching', coverage: 'seen', context: COACHING, expectedCompetitor: true,
    candidate: cand({ name: 'BetterUp', domain: 'betterup.com', category: 'coaching_consulting', description: 'human-led coaching and mentoring marketplace for personal growth, leadership and life direction', targetCustomer: 'professionals seeking coaching and mentoring', businessModel: 'marketplace' }) },
  { id: 'x-coaching-marketing-neg', industry: 'coaching', coverage: 'seen', context: COACHING, expectedCompetitor: false,
    candidate: cand({ name: 'Semrush', domain: 'semrush.com', category: 'marketing_seo_software', description: 'SEO, content marketing and competitive research software for marketers', targetCustomer: 'marketing teams', businessModel: 'B2B SaaS' }) },

  // UNSEEN — logistics
  { id: 'x-logistics-true', industry: 'logistics', coverage: 'unseen', context: LOGISTICS, expectedCompetitor: true,
    candidate: cand({ name: 'FourKites', domain: 'fourkites.com', category: 'supply chain visibility', description: 'real-time freight shipment tracking and supply chain visibility platform for carriers and logistics operators', targetCustomer: 'freight forwarders, carriers and logistics teams', businessModel: 'B2B SaaS' }) },
  { id: 'x-logistics-marketing-neg', industry: 'logistics', coverage: 'unseen', context: LOGISTICS, expectedCompetitor: false,
    candidate: cand({ name: 'ContentPro', domain: 'contentpro.example', category: 'marketing agency', description: 'digital marketing agency offering SEO, content marketing and social media campaigns for brands', targetCustomer: 'consumer brands and marketing teams', businessModel: 'agency services' }) },
  // UNSEEN — legaltech
  { id: 'x-legaltech-true', industry: 'legaltech', coverage: 'unseen', context: LEGALTECH, expectedCompetitor: true,
    candidate: cand({ name: 'Ironclad', domain: 'ironcladapp.com', category: 'contract management', description: 'contract lifecycle management and clause automation platform for in-house legal teams and general counsel', targetCustomer: 'enterprise legal operations and general counsel', businessModel: 'B2B SaaS' }) },
  { id: 'x-legaltech-wellness-neg', industry: 'legaltech', coverage: 'unseen', context: LEGALTECH, expectedCompetitor: false,
    candidate: cand({ name: 'Headspace', domain: 'headspace.com', category: 'meditation_mindfulness', description: 'meditation and mindfulness app for stress, sleep and relaxation', targetCustomer: 'consumers seeking meditation and mindfulness', businessModel: 'B2C subscription' }) },
  // UNSEEN — agritech
  { id: 'x-agritech-true', industry: 'agritech', coverage: 'unseen', context: AGRITECH, expectedCompetitor: true,
    candidate: cand({ name: 'Granular', domain: 'granular.ag', category: 'precision agriculture', description: 'precision agriculture crop analytics, soil data and yield prediction platform for farms and agronomists', targetCustomer: 'commercial farms, growers and agronomists', businessModel: 'B2B SaaS' }) },
  { id: 'x-agritech-crm-neg', industry: 'agritech', coverage: 'unseen', context: AGRITECH, expectedCompetitor: false,
    candidate: cand({ name: 'Salesforce', domain: 'salesforce.com', category: 'crm_marketing_automation', description: 'CRM and sales automation software for B2B revenue and marketing teams', targetCustomer: 'enterprise sales and marketing teams', businessModel: 'B2B SaaS' }) },
  // UNSEEN — fintech lending
  { id: 'x-fintech-true', industry: 'fintech_lending', coverage: 'unseen', context: FINTECH_LENDING, expectedCompetitor: true,
    candidate: cand({ name: 'Blend', domain: 'blend.com', category: 'lending software', description: 'automated loan origination, credit underwriting and risk scoring platform for banks and lenders', targetCustomer: 'banks, lenders and credit unions', businessModel: 'B2B SaaS' }) },
  { id: 'x-fintech-marketing-neg', industry: 'fintech_lending', coverage: 'unseen', context: FINTECH_LENDING, expectedCompetitor: false,
    candidate: cand({ name: 'Mailchimp', domain: 'mailchimp.com', category: 'marketing_seo_software', description: 'email marketing and marketing automation for small business campaigns', targetCustomer: 'small business marketers', businessModel: 'B2B SaaS' }) },
  // UNSEEN — healthtech EHR
  { id: 'x-healthtech-true', industry: 'healthtech_ehr', coverage: 'unseen', context: HEALTHTECH_EHR, expectedCompetitor: true,
    candidate: cand({ name: 'DrChrono', domain: 'drchrono.com', category: 'ehr software', description: 'electronic health records, clinical charting and patient scheduling platform for medical practices and physicians', targetCustomer: 'clinics, physicians and medical practices', businessModel: 'B2B SaaS' }) },
  { id: 'x-healthtech-wellness-neg', industry: 'healthtech_ehr', coverage: 'unseen', context: HEALTHTECH_EHR, expectedCompetitor: false,
    candidate: cand({ name: 'Calm', domain: 'calm.com', category: 'meditation_mindfulness', description: 'meditation and sleep app for relaxation and mental wellbeing', targetCustomer: 'consumers seeking meditation and sleep', businessModel: 'B2C subscription' }) },
  // UNSEEN — cybersecurity
  { id: 'x-cyber-true', industry: 'cybersecurity', coverage: 'unseen', context: CYBERSECURITY, expectedCompetitor: true,
    candidate: cand({ name: 'CrowdStrike', domain: 'crowdstrike.com', category: 'endpoint security', description: 'endpoint detection and response, threat hunting and malware protection platform for security operations teams', targetCustomer: 'security operations and IT teams', businessModel: 'B2B SaaS' }) },
  { id: 'x-cyber-crm-neg', industry: 'cybersecurity', coverage: 'unseen', context: CYBERSECURITY, expectedCompetitor: false,
    candidate: cand({ name: 'HubSpot', domain: 'hubspot.com', category: 'crm_marketing_automation', description: 'CRM and marketing automation for B2B revenue teams', targetCustomer: 'B2B marketing and sales', businessModel: 'B2B SaaS' }) },
  // UNSEEN — HR / ATS
  { id: 'x-hr-true', industry: 'hr_ats', coverage: 'unseen', context: HR_ATS, expectedCompetitor: true,
    candidate: cand({ name: 'Greenhouse', domain: 'greenhouse.io', category: 'recruiting software', description: 'applicant tracking, candidate sourcing and interview scheduling platform for recruiters and talent teams', targetCustomer: 'recruiters and talent acquisition teams', businessModel: 'B2B SaaS' }) },
  { id: 'x-hr-marketing-neg', industry: 'hr_ats', coverage: 'unseen', context: HR_ATS, expectedCompetitor: false,
    candidate: cand({ name: 'Jasper', domain: 'jasper.ai', category: 'marketing_seo_software', description: 'AI content generation and SEO copywriting for marketing teams', targetCustomer: 'marketing teams', businessModel: 'B2B SaaS' }) },
  // UNSEEN — proptech
  { id: 'x-proptech-true', industry: 'proptech', coverage: 'unseen', context: PROPTECH, expectedCompetitor: true,
    candidate: cand({ name: 'AppFolio', domain: 'appfolio.com', category: 'property management', description: 'rental property management, tenant screening and lease accounting platform for landlords and property managers', targetCustomer: 'landlords and property managers', businessModel: 'B2B SaaS' }) },
  { id: 'x-proptech-wellness-neg', industry: 'proptech', coverage: 'unseen', context: PROPTECH, expectedCompetitor: false,
    candidate: cand({ name: 'Woebot', domain: 'woebothealth.com', category: 'mental_wellness_ai', description: 'AI mental health chatbot for anxiety and emotional wellbeing', targetCustomer: 'individuals seeking mental health support', businessModel: 'B2C subscription' }) },
  // UNSEEN — devtools observability
  { id: 'x-devtools-true', industry: 'devtools', coverage: 'unseen', context: DEVTOOLS, expectedCompetitor: true,
    candidate: cand({ name: 'Datadog', domain: 'datadoghq.com', category: 'observability', description: 'application performance monitoring, distributed tracing and log analytics platform for engineering and DevOps teams', targetCustomer: 'software engineering and DevOps teams', businessModel: 'B2B usage-based' }) },
  { id: 'x-devtools-crm-neg', industry: 'devtools', coverage: 'unseen', context: DEVTOOLS, expectedCompetitor: false,
    candidate: cand({ name: 'Pipedrive', domain: 'pipedrive.com', category: 'crm_marketing_automation', description: 'CRM and sales pipeline automation for B2B sales teams', targetCustomer: 'B2B sales teams', businessModel: 'B2B SaaS' }) },
  // UNSEEN — insurtech
  { id: 'x-insurtech-true', industry: 'insurtech', coverage: 'unseen', context: INSURTECH, expectedCompetitor: true,
    candidate: cand({ name: 'Shift Technology', domain: 'shift-technology.com', category: 'insurance claims', description: 'digital insurance claims automation, fraud detection and policy administration platform for insurance carriers', targetCustomer: 'insurance carriers and claims teams', businessModel: 'B2B SaaS' }) },
  { id: 'x-insurtech-marketing-neg', industry: 'insurtech', coverage: 'unseen', context: INSURTECH, expectedCompetitor: false,
    candidate: cand({ name: 'Semrush', domain: 'semrush.com', category: 'marketing_seo_software', description: 'SEO and content marketing software for digital marketers', targetCustomer: 'marketing teams', businessModel: 'B2B SaaS' }) },
];
