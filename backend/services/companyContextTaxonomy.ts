export type CompanyContextTaxonomyName =
  | 'customer_industry'
  | 'customer_segment'
  | 'geography'
  | 'dependency_type'
  | 'provider_category'
  | 'regulation_type'
  | 'workforce_model'
  | 'strategic_priority'
  | 'exposure_type'
  | 'criticality'
  | 'operational_sensitivity';

export type TaxonomyEntry = {
  key: string;
  label: string;
  aliases?: string[];
};

const entries = <T extends Record<string, TaxonomyEntry[]>>(value: T) => value;

export const COMPANY_CONTEXT_TAXONOMY = entries({
  customer_industry: [
    { key: 'technology_software', label: 'Technology & Software', aliases: ['software', 'saas', 'tech'] },
    { key: 'financial_services', label: 'Financial Services', aliases: ['finance', 'banking', 'fintech'] },
    { key: 'healthcare', label: 'Healthcare', aliases: ['health', 'medical', 'pharma'] },
    { key: 'retail_ecommerce', label: 'Retail & E-commerce', aliases: ['retail', 'ecommerce', 'commerce'] },
    { key: 'manufacturing', label: 'Manufacturing', aliases: ['industrial', 'factory'] },
    { key: 'professional_services', label: 'Professional Services', aliases: ['consulting', 'agency', 'services'] },
    { key: 'education', label: 'Education', aliases: ['edtech', 'learning'] },
    { key: 'public_sector', label: 'Public Sector', aliases: ['government'] },
    { key: 'other', label: 'Other' },
    { key: 'unknown', label: 'Unknown' },
  ],
  customer_segment: [
    { key: 'smb', label: 'SMB', aliases: ['small business', 'small businesses'] },
    { key: 'mid_market', label: 'Mid-market', aliases: ['midmarket'] },
    { key: 'enterprise', label: 'Enterprise' },
    { key: 'consumer', label: 'Consumer', aliases: ['b2c'] },
    { key: 'developer', label: 'Developer', aliases: ['developers', 'engineering'] },
    { key: 'creator', label: 'Creator' },
    { key: 'public_sector', label: 'Public Sector', aliases: ['government'] },
    { key: 'unknown', label: 'Unknown' },
  ],
  geography: [
    { key: 'global', label: 'Global', aliases: ['worldwide', 'international'] },
    { key: 'us', label: 'United States', aliases: ['usa', 'united states', 'america'] },
    { key: 'canada', label: 'Canada', aliases: ['ca'] },
    { key: 'uk', label: 'United Kingdom', aliases: ['gb', 'great britain', 'england'] },
    { key: 'eu', label: 'European Union', aliases: ['europe'] },
    { key: 'india', label: 'India', aliases: ['in'] },
    { key: 'apac', label: 'APAC', aliases: ['asia pacific'] },
    { key: 'latam', label: 'LATAM', aliases: ['latin america'] },
    { key: 'unknown', label: 'Unknown' },
  ],
  dependency_type: [
    { key: 'cloud', label: 'Cloud' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'logistics', label: 'Logistics' },
    { key: 'labor', label: 'Labor' },
    { key: 'platform', label: 'Platform' },
    { key: 'channel', label: 'Channel' },
    { key: 'regulatory', label: 'Regulatory' },
    { key: 'technology', label: 'Technology' },
    { key: 'other', label: 'Other' },
  ],
  provider_category: [
    { key: 'cloud_infrastructure', label: 'Cloud Infrastructure', aliases: ['cloud', 'hosting'] },
    { key: 'ai_model_provider', label: 'AI Model Provider', aliases: ['llm', 'ai api', 'model'] },
    { key: 'analytics', label: 'Analytics' },
    { key: 'payments', label: 'Payments' },
    { key: 'crm', label: 'CRM' },
    { key: 'marketing_platform', label: 'Marketing Platform' },
    { key: 'security', label: 'Security' },
    { key: 'collaboration', label: 'Collaboration' },
    { key: 'other', label: 'Other' },
    { key: 'unknown', label: 'Unknown' },
  ],
  regulation_type: [
    { key: 'data_privacy', label: 'Data Privacy', aliases: ['privacy', 'gdpr', 'ccpa'] },
    { key: 'labor_employment', label: 'Labor & Employment', aliases: ['labor', 'employment'] },
    { key: 'immigration_visa', label: 'Immigration & Visa', aliases: ['visa', 'immigration'] },
    { key: 'financial_compliance', label: 'Financial Compliance', aliases: ['finra', 'payments', 'banking'] },
    { key: 'healthcare_compliance', label: 'Healthcare Compliance', aliases: ['hipaa', 'health'] },
    { key: 'trade_import_export', label: 'Trade / Import / Export', aliases: ['trade', 'tariff', 'import', 'export'] },
    { key: 'sector_specific', label: 'Sector Specific' },
    { key: 'unknown', label: 'Unknown' },
  ],
  workforce_model: [
    { key: 'fully_remote', label: 'Fully Remote', aliases: ['remote'] },
    { key: 'hybrid', label: 'Hybrid' },
    { key: 'onsite', label: 'Onsite' },
    { key: 'distributed_global', label: 'Distributed Global', aliases: ['distributed'] },
    { key: 'contractor_heavy', label: 'Contractor Heavy', aliases: ['contractor'] },
    { key: 'unknown', label: 'Unknown' },
  ],
  strategic_priority: [
    { key: 'low', label: 'Low' },
    { key: 'medium', label: 'Medium' },
    { key: 'high', label: 'High' },
    { key: 'critical', label: 'Critical' },
    { key: 'unknown', label: 'Unknown' },
  ],
  exposure_type: [
    { key: 'revenue', label: 'Revenue' },
    { key: 'operations', label: 'Operations' },
    { key: 'workforce', label: 'Workforce' },
    { key: 'customers', label: 'Customers' },
    { key: 'vendors', label: 'Vendors' },
  ],
  criticality: [
    { key: 'none', label: 'None' },
    { key: 'low', label: 'Low' },
    { key: 'medium', label: 'Medium' },
    { key: 'high', label: 'High' },
    { key: 'critical', label: 'Critical' },
    { key: 'unknown', label: 'Unknown' },
  ],
  operational_sensitivity: [
    { key: 'low', label: 'Low' },
    { key: 'medium', label: 'Medium' },
    { key: 'high', label: 'High' },
    { key: 'critical', label: 'Critical' },
    { key: 'unknown', label: 'Unknown' },
  ],
} satisfies Record<CompanyContextTaxonomyName, TaxonomyEntry[]>);

function canonicalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeTaxonomyKey(
  taxonomy: CompanyContextTaxonomyName,
  value: unknown,
): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const canonical = canonicalize(raw);
  const list: TaxonomyEntry[] = COMPANY_CONTEXT_TAXONOMY[taxonomy] ?? [];
  const match = list.find((entry) => {
    if (entry.key === canonical || canonicalize(entry.label) === canonical) return true;
    return (entry.aliases ?? []).some((alias) => canonicalize(alias) === canonical);
  });
  return match?.key ?? canonical;
}

export function taxonomyOptions(taxonomy: CompanyContextTaxonomyName): TaxonomyEntry[] {
  return COMPANY_CONTEXT_TAXONOMY[taxonomy] ?? [];
}
