import { runCompletionWithOperation } from '../aiGateway';
import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import type { CompanyProfile, StrategyProfile } from './types';

type StrategyProfileDraft = {
  strategyProfile: StrategyProfile | null;
  signalSummary: {
    websiteSourcesUsed: number;
    blogSamplesUsed: number;
    postSamplesUsed: number;
  };
};

type RawStrategyExtraction = {
  worldview?: string | null;
  contrarianBeliefs?: string[] | null;
  primaryFocus?: string[] | null;
  differentiation?: string[] | null;
  typicalAngles?: string[] | null;
  repeatedThemes?: string[] | null;
  emphasizedOutcomes?: string[] | null;
  implicitBeliefs?: string[] | null;
  differentiationLanguage?: string[] | null;
};

const MAX_BLOG_SAMPLES = 8;
const MAX_POST_SAMPLES = 10;
const MAX_SAMPLE_CHARS = 700;

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function containsMeaningfulSignal(text: string): boolean {
  if (!text) return false;
  if (text.split(/\s+/).length < 3) return false;
  return !/\b(innovative|cutting-edge|end-to-end|world-class|best-in-class|results-driven|tailored solutions|we help businesses|businesses grow|unlock growth|drive results)\b/i.test(text);
}

function normalizeList(values: unknown, min = 0, max = 5): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = Array.from(new Set(
    values
      .map((value) => cleanText(value))
      .map((value) => value.replace(/^[-*•]\s*/, '').replace(/\.$/, '').trim())
      .filter((value) => containsMeaningfulSignal(value)),
  ));
  if (normalized.length < min) return normalized;
  return normalized.slice(0, max);
}

function normalizeWorldview(value: unknown): string | null {
  const cleaned = cleanText(value);
  if (!containsMeaningfulSignal(cleaned)) return null;
  return cleaned.split(/\s+/).length > 28 ? cleaned.split(/\s+/).slice(0, 28).join(' ') : cleaned;
}

function extractTextFromContentBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const chunks: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const candidate = block as Record<string, unknown>;
    for (const key of ['text', 'body', 'html', 'content']) {
      const value = cleanText(candidate[key]);
      if (!value) continue;
      chunks.push(value.replace(/<[^>]+>/g, ' '));
    }
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

function truncateSample(text: string, limit = MAX_SAMPLE_CHARS): string {
  const cleaned = cleanText(text);
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit).trim()}...`;
}

async function fetchCompanyBlogSamples(companyId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('blogs')
      .select('title, excerpt, content_type, content_html, content_blocks, content_markdown')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
      .limit(MAX_BLOG_SAMPLES);
    if (error || !Array.isArray(data)) return [];

    return data
      .map((row) => {
        const title = cleanText((row as Record<string, unknown>).title);
        const excerpt = cleanText((row as Record<string, unknown>).excerpt);
        const markdown = cleanText((row as Record<string, unknown>).content_markdown);
        const html = cleanText((row as Record<string, unknown>).content_html).replace(/<[^>]+>/g, ' ');
        const blocks = extractTextFromContentBlocks((row as Record<string, unknown>).content_blocks);
        const contentType = cleanText((row as Record<string, unknown>).content_type) || 'blog';
        const sample = truncateSample([title, excerpt, markdown, html, blocks].filter(Boolean).join(' '));
        return sample ? `[${contentType}] ${sample}` : '';
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchCompanyPostSamples(companyId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('title, content, content_type, platform, status')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
      .limit(MAX_POST_SAMPLES);
    if (error || !Array.isArray(data)) return [];

    return data
      .map((row) => {
        const title = cleanText((row as Record<string, unknown>).title);
        const content = truncateSample(cleanText((row as Record<string, unknown>).content));
        const contentType = cleanText((row as Record<string, unknown>).content_type) || 'post';
        const platform = cleanText((row as Record<string, unknown>).platform);
        const status = cleanText((row as Record<string, unknown>).status);
        const parts = [
          platform ? `[${platform}]` : '',
          contentType ? `[${contentType}]` : '',
          status ? `[${status}]` : '',
          title,
          content,
        ].filter(Boolean);
        return parts.join(' ');
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildStrategyDerivationPrompt(input: {
  profile: CompanyProfile;
  websiteSummaries: Array<{ label: string; url: string; summary: string }>;
  blogSamples: string[];
  postSamples: string[];
}): { systemPrompt: string; userPrompt: string } {
  const websiteEvidence = input.websiteSummaries
    .slice(0, 12)
    .map((entry, index) => `WEBSITE ${index + 1} (${entry.label} | ${entry.url}):\n${entry.summary}`)
    .join('\n\n');
  const blogEvidence = input.blogSamples.map((sample, index) => `BLOG ${index + 1}: ${sample}`).join('\n');
  const postEvidence = input.postSamples.map((sample, index) => `POST ${index + 1}: ${sample}`).join('\n');

  const profileContext = [
    input.profile.name ? `Company: ${input.profile.name}` : null,
    input.profile.industry ? `Industry: ${input.profile.industry}` : null,
    input.profile.target_audience ? `Audience: ${input.profile.target_audience}` : null,
    input.profile.ideal_customer_profile ? `ICP: ${input.profile.ideal_customer_profile}` : null,
    input.profile.products_services ? `Products/services: ${input.profile.products_services}` : null,
    input.profile.core_problem_statement ? `Core problem: ${input.profile.core_problem_statement}` : null,
    input.profile.unique_value ? `Unique value: ${input.profile.unique_value}` : null,
    input.profile.competitive_advantages ? `Competitive advantages: ${input.profile.competitive_advantages}` : null,
  ].filter(Boolean).join('\n');

  return {
    systemPrompt:
      'You are a strategy signal extraction engine.\n\n' +
      'Derive a structured company strategy profile from website pages and existing content.\n' +
      'Rules:\n' +
      '1. Prefer repeated signals over one-off statements.\n' +
      '2. Remove generic marketing fluff.\n' +
      '3. Do not copy raw website text.\n' +
      '4. Keep only specific, repeatable strategic signals.\n' +
      '5. Base the profile on what the company consistently emphasizes, promotes, criticizes, or differentiates.\n' +
      '6. If evidence is weak, return fewer items rather than generic filler.\n\n' +
      'Return JSON with this exact shape:\n' +
      '{\n' +
      '  "worldview": string | null,\n' +
      '  "contrarianBeliefs": string[],\n' +
      '  "primaryFocus": string[],\n' +
      '  "differentiation": string[],\n' +
      '  "typicalAngles": string[],\n' +
      '  "repeatedThemes": string[],\n' +
      '  "emphasizedOutcomes": string[],\n' +
      '  "implicitBeliefs": string[],\n' +
      '  "differentiationLanguage": string[]\n' +
      '}',
    userPrompt:
      `${profileContext ? `COMPANY CONTEXT:\n${profileContext}\n\n` : ''}` +
      `WEBSITE EVIDENCE:\n${websiteEvidence || 'None'}\n\n` +
      `BLOG / NEWSLETTER EVIDENCE:\n${blogEvidence || 'None'}\n\n` +
      `POST EVIDENCE:\n${postEvidence || 'None'}\n\n` +
      'Build a usable strategy profile from repeated signals only.',
  };
}

function finalizeStrategyProfile(raw: RawStrategyExtraction): StrategyProfile | null {
  const worldview = normalizeWorldview(raw.worldview);
  const contrarianBeliefs = normalizeList(raw.contrarianBeliefs, 0, 5);
  const primaryFocus = normalizeList(raw.primaryFocus, 0, 5);
  const differentiation = normalizeList(raw.differentiation, 0, 3);
  const typicalAngles = normalizeList(raw.typicalAngles, 0, 5);

  if (!worldview && contrarianBeliefs.length === 0 && primaryFocus.length === 0 && differentiation.length === 0 && typicalAngles.length === 0) {
    return null;
  }

  return {
    worldview,
    contrarianBeliefs,
    primaryFocus,
    differentiation,
    typicalAngles,
  };
}

export async function deriveStrategyProfileDraft(
  profile: CompanyProfile,
  sourceSummaries: Array<{ label: string; url: string; summary: string }> = [],
): Promise<StrategyProfileDraft> {
  const companyId = cleanText(profile.company_id);
  if (!companyId) {
    return {
      strategyProfile: null,
      signalSummary: { websiteSourcesUsed: 0, blogSamplesUsed: 0, postSamplesUsed: 0 },
    };
  }

  const websiteSummaries = sourceSummaries
    .filter((entry) => cleanText(entry.summary))
    .slice(0, 12);
  const [blogSamples, postSamples] = await Promise.all([
    fetchCompanyBlogSamples(companyId),
    fetchCompanyPostSamples(companyId),
  ]);

  if (websiteSummaries.length === 0 && blogSamples.length === 0 && postSamples.length === 0) {
    return {
      strategyProfile: null,
      signalSummary: { websiteSourcesUsed: 0, blogSamplesUsed: 0, postSamplesUsed: 0 },
    };
  }

  const prompt = buildStrategyDerivationPrompt({
    profile,
    websiteSummaries,
    blogSamples,
    postSamples,
  });

  try {
    const result = await runCompletionWithOperation({
      companyId,
      campaignId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      operation: 'profileExtraction',
      messages: [
        { role: 'system', content: prompt.systemPrompt },
        { role: 'user', content: prompt.userPrompt },
      ],
    });
    const parsed = JSON.parse(result.output?.trim() || '{}') as RawStrategyExtraction;
    return {
      strategyProfile: finalizeStrategyProfile(parsed),
      signalSummary: {
        websiteSourcesUsed: websiteSummaries.length,
        blogSamplesUsed: blogSamples.length,
        postSamplesUsed: postSamples.length,
      },
    };
  } catch {
    return {
      strategyProfile: null,
      signalSummary: {
        websiteSourcesUsed: websiteSummaries.length,
        blogSamplesUsed: blogSamples.length,
        postSamplesUsed: postSamples.length,
      },
    };
  }
}
