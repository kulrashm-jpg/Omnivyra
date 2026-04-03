import { supabase } from '../db/supabaseClient';
import type { PersistedDecisionObject } from './decisionObjectService';
import type { ResolvedReportInput } from './reportInputResolver';
import { clamp } from './intelligenceEngineUtils';

type AuditReportTier = 'snapshot' | 'deep';

type CanonicalPageRow = {
  id: string;
  url: string;
  page_type: string | null;
  title: string | null;
  meta_title: string | null;
  meta_description: string | null;
  headings: Array<{ level?: number; text?: string }> | string[] | null;
  ctas: Array<{ text?: string; href?: string | null }> | null;
  internal_link_count: number | null;
  http_status: number | null;
  crawl_depth: number | null;
  crawl_metadata: Record<string, unknown> | null;
};

type PageContentRow = {
  page_id: string;
  block_type: string;
  content_text: string | null;
  heading_level: number | null;
};

type PageLinkRow = {
  from_page_id: string;
  to_page_id: string | null;
  to_url: string | null;
  anchor_text: string | null;
  is_internal: boolean;
};

type PublicAuditContext = {
  pages: CanonicalPageRow[];
  content: PageContentRow[];
  links: PageLinkRow[];
};

export type PublicAuditDecision = PersistedDecisionObject;

export type PublicAuditResult = {
  site_structure: {
    homepage: string | null;
    product_pages: string[];
    pricing_pages: string[];
    blog_pages: string[];
    contact_pages: string[];
    geo_pages: string[];
  };
  geo_aeo_context: {
    queries: Array<{
      query: string;
      coverage: 'full' | 'partial' | 'missing';
      answer_quality_score: number;
    }>;
    entities: Array<{
      entity: string;
      relevance_score: number;
      coverage_score: number;
    }>;
    answerable_content_pct: number | null;
    structured_content_pct: number | null;
    citation_ready_pct: number | null;
    answer_coverage_score: number | null;
    entity_clarity_score: number | null;
    topical_authority_score: number | null;
    citation_readiness_score: number | null;
    content_structure_score: number | null;
    freshness_score: number | null;
  };
  decisions: PublicAuditDecision[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function safeWords(text: string | null | undefined): number {
  return String(text ?? '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean).length;
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function textLength(value: string | null | undefined): number {
  return String(value ?? '').trim().length;
}

function hasLikelyGeoSlug(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /(\/locations?\/|\/service-area\/|\/near-me|\/(new-york|london|dubai|singapore|toronto|mumbai)|-[a-z]+$)/i.test(pathname);
  } catch {
    return false;
  }
}

function domainRoot(url: string | null | undefined): string {
  try {
    const host = new URL(String(url ?? '')).hostname.replace(/^www\./i, '');
    return host.split('.').slice(0, -1).join(' ') || host;
  } catch {
    return '';
  }
}

function sentenceSplit(text: string): string[] {
  return text
    .split(/[.!?]\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 20);
}

function titleWords(value: string): string[] {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 4 && !['with', 'that', 'from', 'this', 'your', 'what', 'when', 'where', 'which'].includes(item));
}

async function loadAuditContext(companyId: string): Promise<PublicAuditContext> {
  const { data: pages, error: pagesError } = await supabase
    .from('canonical_pages')
    .select('id, url, page_type, title, meta_title, meta_description, headings, ctas, internal_link_count, http_status, crawl_depth, crawl_metadata')
    .eq('company_id', companyId)
    .order('last_crawled_at', { ascending: false })
    .limit(300);

  if (pagesError) {
    throw new Error(`Failed to load canonical pages for public audit: ${pagesError.message}`);
  }

  const pageRows = (pages ?? []) as CanonicalPageRow[];
  const pageIds = pageRows.map((page) => page.id);
  if (pageIds.length === 0) {
    return { pages: [], content: [], links: [] };
  }

  const [contentRes, linksRes] = await Promise.all([
    supabase
      .from('page_content')
      .select('page_id, block_type, content_text, heading_level')
      .eq('company_id', companyId)
      .in('page_id', pageIds),
    supabase
      .from('page_links')
      .select('from_page_id, to_page_id, to_url, anchor_text, is_internal')
      .eq('company_id', companyId)
      .in('from_page_id', pageIds),
  ]);

  if (contentRes.error) {
    throw new Error(`Failed to load page content for public audit: ${contentRes.error.message}`);
  }
  if (linksRes.error) {
    throw new Error(`Failed to load page links for public audit: ${linksRes.error.message}`);
  }

  return {
    pages: pageRows,
    content: (contentRes.data ?? []) as PageContentRow[],
    links: (linksRes.data ?? []) as PageLinkRow[],
  };
}

function inferGeoPages(pages: CanonicalPageRow[], resolvedInput?: ResolvedReportInput | null): string[] {
  const geography = normalizeText(resolvedInput?.resolved.geography);
  return pages
    .filter((page) => {
      const haystack = `${page.url} ${page.title ?? ''} ${page.meta_description ?? ''}`.toLowerCase();
      if (/(locations?|service-area|region|city|country|near-me|local)/.test(haystack)) return true;
      if (geography && haystack.includes(geography)) return true;
      return false;
    })
    .map((page) => page.url);
}

function createDecision(params: {
  companyId: string;
  reportTier: AuditReportTier;
  issueType: PersistedDecisionObject['issue_type'];
  title: string;
  description: string;
  recommendation: string;
  actionType: PersistedDecisionObject['action_type'];
  actionPayload: Record<string, unknown>;
  impactTraffic: number;
  impactConversion: number;
  impactRevenue: number;
  priorityScore: number;
  effortScore: number;
  confidenceScore: number;
  evidence: Record<string, unknown>;
}): PersistedDecisionObject {
  const now = nowIso();
  return {
    id: `public_audit_${params.issueType}_${Math.random().toString(36).slice(2, 10)}`,
    company_id: params.companyId,
    report_tier: params.reportTier,
    source_service: 'publicDomainAuditService',
    entity_type: 'global',
    entity_id: null,
    issue_type: params.issueType,
    title: params.title,
    description: params.description,
    evidence: params.evidence,
    impact_traffic: params.impactTraffic,
    impact_conversion: params.impactConversion,
    impact_revenue: params.impactRevenue,
    priority_score: params.priorityScore,
    effort_score: params.effortScore,
    execution_score: clamp(params.priorityScore * 0.55 + Math.max(params.impactTraffic, params.impactConversion, params.impactRevenue) * 0.45, 0, 100),
    confidence_score: params.confidenceScore,
    recommendation: params.recommendation,
    action_type: params.actionType,
    action_payload: params.actionPayload,
    status: 'open',
    last_changed_by: 'system',
    created_at: now,
    updated_at: now,
    resolved_at: null,
    ignored_at: null,
  };
}

export async function buildPublicDomainAuditDecisions(params: {
  companyId: string;
  reportTier?: AuditReportTier;
  resolvedInput?: ResolvedReportInput | null;
}): Promise<PublicAuditResult> {
  const reportTier = params.reportTier ?? 'snapshot';
  const context = await loadAuditContext(params.companyId);
  const { pages, content, links } = context;

  const structure = {
    homepage: pages.find((page) => normalizeText(page.page_type) === 'home')?.url ?? pages[0]?.url ?? null,
    product_pages: pages.filter((page) => /product|feature|solution/i.test(`${page.page_type ?? ''} ${page.url}`)).map((page) => page.url),
    pricing_pages: pages.filter((page) => /pricing/i.test(`${page.page_type ?? ''} ${page.url}`)).map((page) => page.url),
    blog_pages: pages.filter((page) => /blog/i.test(`${page.page_type ?? ''} ${page.url}`)).map((page) => page.url),
    contact_pages: pages.filter((page) => /contact|get-in-touch|book/i.test(`${page.page_type ?? ''} ${page.url}`)).map((page) => page.url),
    geo_pages: inferGeoPages(pages, params.resolvedInput),
  };

  if (pages.length === 0) {
    return {
      site_structure: structure,
      geo_aeo_context: {
        queries: [],
        entities: [],
        answerable_content_pct: null,
        structured_content_pct: null,
        citation_ready_pct: null,
        answer_coverage_score: null,
        entity_clarity_score: null,
        topical_authority_score: null,
        citation_readiness_score: null,
        content_structure_score: null,
        freshness_score: null,
      },
      decisions: [],
    };
  }

  const contentByPage = new Map<string, PageContentRow[]>();
  content.forEach((row) => {
    const current = contentByPage.get(row.page_id) ?? [];
    current.push(row);
    contentByPage.set(row.page_id, current);
  });

  const totalWords = content.reduce((sum, row) => sum + safeWords(row.content_text), 0);
  const ctaCount = pages.reduce((sum, page) => sum + (Array.isArray(page.ctas) ? page.ctas.length : 0), 0);
  const headingTexts = pages.flatMap((page) => {
    if (!Array.isArray(page.headings)) return [];
    return page.headings.map((heading) => typeof heading === 'string' ? heading : String(heading?.text ?? ''));
  });
  const pageTitles = pages.map((page) => `${page.title ?? ''} ${page.meta_title ?? ''} ${page.meta_description ?? ''}`.trim());
  const pricingExists = structure.pricing_pages.length > 0;
  const contactExists = structure.contact_pages.length > 0;
  const blogExists = structure.blog_pages.length > 0;
  const geoExists = structure.geo_pages.length > 0;
  const productExists = structure.product_pages.length > 0;
  const testimonialMentions = content.filter((row) => /(testimonial|review|trusted by|what customers say|social proof)/i.test(row.content_text ?? '')).length;
  const caseStudyMentions = content.filter((row) => /(case study|case studies|customer story|success story|results)/i.test(row.content_text ?? '')).length;
  const proofMentions = content.filter((row) => /(clients|customers|users|companies|awards|certified|verified|roi|outcome)/i.test(row.content_text ?? '')).length;
  const faqMentions = content.filter((row) => /(faq|frequently asked|questions)/i.test(row.content_text ?? '')).length;
  const directAnswerMentions = content.filter((row) => /(what is|how to|why |when |best way|in summary|quick answer)/i.test(row.content_text ?? '')).length;
  const comparisonMentions = content.filter((row) => /(compare|comparison|vs\.?|versus|alternative|best for)/i.test(row.content_text ?? '')).length;
  const awarenessMentions = content.filter((row) => /(guide|learn|overview|introduction|benefits)/i.test(row.content_text ?? '')).length;
  const conversionMentions = content.filter((row) => /(demo|pricing|contact sales|get started|book|sign up|trial)/i.test(row.content_text ?? '')).length;
  const trustMentions = testimonialMentions + caseStudyMentions + proofMentions;
  const productPageWordAvg = structure.product_pages.length > 0
    ? structure.product_pages.reduce((sum, url) => {
        const page = pages.find((item) => item.url === url);
        if (!page) return sum;
        return sum + (contentByPage.get(page.id) ?? []).reduce((inner, row) => inner + safeWords(row.content_text), 0);
      }, 0) / Math.max(1, structure.product_pages.length)
    : 0;
  const internalLinkAvg = pages.reduce((sum, page) => sum + Number(page.internal_link_count ?? 0), 0) / Math.max(1, pages.length);
  const pagesMissingTitles = pages.filter((page) => textLength(page.meta_title) === 0 && textLength(page.title) === 0);
  const pagesMissingMeta = pages.filter((page) => textLength(page.meta_description) === 0);
  const pagesWithThinMeta = pages.filter((page) => textLength(page.meta_description) > 0 && textLength(page.meta_description) < 70);
  const pagesWithDuplicateMetaTitles = pages.filter((page, index, allPages) => {
    const current = normalizeText(page.meta_title || page.title);
    if (!current) return false;
    return allPages.findIndex((candidate) => normalizeText(candidate.meta_title || candidate.title) === current) !== index;
  });
  const pagesWithoutH1 = pages.filter((page) => {
    if (!Array.isArray(page.headings) || page.headings.length === 0) return true;
    return !page.headings.some((heading) => typeof heading !== 'string' && Number(heading?.level ?? 0) === 1 && textLength(heading?.text) > 0);
  });
  const thinPages = pages.filter((page) => {
    const wordCount = (contentByPage.get(page.id) ?? []).reduce((sum, row) => sum + safeWords(row.content_text), 0);
    const importantPage = /home|pricing|product|feature|landing|contact/.test(normalizeText(page.page_type));
    return importantPage && wordCount > 0 && wordCount < 120;
  });
  const pagesWithStatusErrors = pages.filter((page) => Number(page.http_status ?? 200) >= 400 || Number(page.http_status ?? 200) === 0);
  const orphanLikePages = pages.filter((page) => {
    const incomingLinks = links.filter((link) => link.to_page_id === page.id || normalizeText(link.to_url) === normalizeText(page.url));
    const importantPage = /pricing|product|feature|landing|blog/.test(normalizeText(page.page_type));
    return importantPage && incomingLinks.length === 0;
  });
  const geoPageSlugCoverage = structure.geo_pages.filter((url) => hasLikelyGeoSlug(url)).length;
  const rootEntity = domainRoot(structure.homepage);
  const headingQuestions = headingTexts
    .filter((text) => /^(what|how|why|when|which|best|can|should)\b/i.test(text.trim()) || text.includes('?'))
    .slice(0, 8);
  const synthesizedQueries = pages
    .slice(0, 6)
    .map((page) => page.title || page.meta_title || '')
    .filter(Boolean)
    .map((title) => `What is ${String(title).replace(/\?+$/, '').trim()}?`);
  const queryCandidates = dedupe([...headingQuestions, ...synthesizedQueries]).slice(0, 8);
  const queryCoverage = queryCandidates.map((query) => {
    const queryTerms = titleWords(query);
    const matchingPage = pages.find((page) => {
      const pageText = `${page.title ?? ''} ${page.meta_description ?? ''} ${Array.isArray(page.headings) ? page.headings.map((heading) => typeof heading === 'string' ? heading : heading?.text ?? '').join(' ') : ''}`.toLowerCase();
      return queryTerms.some((term) => pageText.includes(term));
    });
    const pageContent = matchingPage ? (contentByPage.get(matchingPage.id) ?? []) : [];
    const wordCount = pageContent.reduce((sum, row) => sum + safeWords(row.content_text), 0);
    const directAnswersOnPage = pageContent.filter((row) => /(what is|how to|why |in summary|quick answer|faq)/i.test(row.content_text ?? '')).length;
    const coverage: 'full' | 'partial' | 'missing' =
      matchingPage && wordCount >= 180 && directAnswersOnPage >= 1
        ? 'full'
        : matchingPage && wordCount >= 70
          ? 'partial'
          : 'missing';
    const answerQualityScore =
      coverage === 'full'
        ? clamp(65 + Math.min(wordCount / 10, 30) + directAnswersOnPage * 4, 0, 100)
        : coverage === 'partial'
          ? clamp(35 + Math.min(wordCount / 12, 25), 0, 100)
          : 0;
    return {
      query,
      coverage,
      answer_quality_score: Math.round(answerQualityScore),
    };
  });
  const fullAnswerCount = queryCoverage.filter((item) => item.coverage === 'full').length;
  const answerableContentPct = pages.length > 0
    ? Math.round((pages.filter((page) => {
        const pageContent = contentByPage.get(page.id) ?? [];
        const wordCount = pageContent.reduce((sum, row) => sum + safeWords(row.content_text), 0);
        return wordCount >= 120;
      }).length / pages.length) * 100)
    : null;
  const structuredContentPct = pages.length > 0
    ? Math.round((pages.filter((page) => Array.isArray(page.headings) && page.headings.length >= 2).length / pages.length) * 100)
    : null;
  const citationReadyPct = pages.length > 0
    ? Math.round((pages.filter((page) => {
        const pageContent = contentByPage.get(page.id) ?? [];
        const text = pageContent.map((row) => row.content_text ?? '').join(' ');
        return /(according to|research|study|customer|case study|verified|certified|roi|outcome)/i.test(text) &&
          /(in summary|faq|what is|how to)/i.test(text);
      }).length / pages.length) * 100)
    : null;
  const titleTokenCounts = new Map<string, number>();
  [...headingTexts, ...pageTitles, rootEntity].forEach((text) => {
    titleWords(text).forEach((word) => {
      titleTokenCounts.set(word, (titleTokenCounts.get(word) ?? 0) + 1);
    });
  });
  const entityCandidates = [...titleTokenCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([entity, count]) => {
      const pagesContaining = pages.filter((page) => {
        const pageText = `${page.title ?? ''} ${page.meta_description ?? ''} ${Array.isArray(page.headings) ? page.headings.map((heading) => typeof heading === 'string' ? heading : heading?.text ?? '').join(' ') : ''}`.toLowerCase();
        return pageText.includes(entity);
      }).length;
      return {
        entity,
        relevance_score: clamp(Math.round((count / Math.max(2, headingTexts.length || 2)) * 140), 0, 100),
        coverage_score: pages.length > 0 ? Math.round((pagesContaining / pages.length) * 100) : 0,
      };
    });
  const geoAeoContext: PublicAuditResult['geo_aeo_context'] = {
    queries: queryCoverage,
    entities: entityCandidates,
    answerable_content_pct: answerableContentPct,
    structured_content_pct: structuredContentPct,
    citation_ready_pct: citationReadyPct,
    answer_coverage_score: queryCoverage.length > 0 ? Math.round((fullAnswerCount / queryCoverage.length) * 100) : null,
    entity_clarity_score: entityCandidates.length > 0 ? Math.round(entityCandidates.reduce((sum, item) => sum + ((item.relevance_score * 0.6) + (item.coverage_score * 0.4)), 0) / entityCandidates.length) : null,
    topical_authority_score: Math.round(clamp((trustMentions * 6) + (comparisonMentions * 4) + Math.min(productPageWordAvg / 4, 35), 0, 100)),
    citation_readiness_score: citationReadyPct,
    content_structure_score: structuredContentPct,
    freshness_score: pages.length > 0
      ? Math.round(
          clamp(
            pages.filter((page) => /\/20\d{2}\//.test(page.url) || /20\d{2}/.test(`${page.title ?? ''} ${page.meta_title ?? ''}`)).length / pages.length * 100 +
            (blogExists ? 18 : 0),
            0,
            100,
          )
        )
      : null,
  };

  const decisions: PersistedDecisionObject[] = [];

  const homepageCopy = pageTitles[0] ?? '';
  const audienceSignal = /(for|teams|businesses|companies|agencies|buyers|operators|founders|marketers)/i.test(homepageCopy + ' ' + headingTexts.join(' '));
  const valueSignal = /(helps|increase|reduce|improve|grow|save|automate|scale|faster|clear)/i.test(homepageCopy + ' ' + headingTexts.join(' '));
  if (!audienceSignal || !valueSignal) {
    decisions.push(createDecision({
      companyId: params.companyId,
      reportTier,
      issueType: 'intent_gap',
      title: 'Homepage positioning does not clearly tell the right buyer who this is for and why it matters',
      description: 'Public website copy does not make the target audience and value proposition explicit enough on first impression.',
      recommendation: 'Rewrite the homepage hero and first supporting sections so they state the buyer, outcome, and differentiator within seconds.',
      actionType: 'adjust_strategy',
      actionPayload: { optimization_focus: 'positioning_clarity', structure },
      impactTraffic: 42,
      impactConversion: 61,
      impactRevenue: 56,
      priorityScore: 70,
      effortScore: 32,
      confidenceScore: 0.79,
      evidence: { audience_signal: audienceSignal, value_signal: valueSignal, homepage: structure.homepage },
    }));
  }

  if (ctaCount < Math.max(2, Math.round(pages.length * 0.4)) || !pricingExists || !contactExists) {
    decisions.push(createDecision({
      companyId: params.companyId,
      reportTier,
      issueType: 'cta_clarity_gap',
      title: 'The site does not give buyers a strong enough next step',
      description: 'CTA coverage across public pages is too thin or too indirect, which weakens conversion readiness.',
      recommendation: 'Add clearer primary CTAs on the homepage and key product pages, and make pricing/contact routes easier to reach.',
      actionType: 'fix_cta',
      actionPayload: { optimization_focus: 'conversion_path', cta_count: ctaCount, has_pricing: pricingExists, has_contact: contactExists },
      impactTraffic: 24,
      impactConversion: 68,
      impactRevenue: 61,
      priorityScore: 73,
      effortScore: 28,
      confidenceScore: 0.83,
      evidence: { cta_count: ctaCount, pricing_exists: pricingExists, contact_exists: contactExists },
    }));
  }

  if (internalLinkAvg < 2 || (!pricingExists && !contactExists) || !productExists) {
    decisions.push(createDecision({
      companyId: params.companyId,
      reportTier,
      issueType: 'weak_conversion_path',
      title: 'User journey from discovery to action has visible friction',
      description: 'Public site structure suggests the path from homepage to product understanding to action is too fragmented.',
      recommendation: 'Tighten the journey from homepage to product pages to pricing/contact, and reduce dead-end navigation patterns.',
      actionType: 'fix_distribution',
      actionPayload: { optimization_focus: 'user_journey', internal_link_avg: internalLinkAvg },
      impactTraffic: 22,
      impactConversion: 66,
      impactRevenue: 58,
      priorityScore: 69,
      effortScore: 36,
      confidenceScore: 0.76,
      evidence: { internal_link_avg: internalLinkAvg, product_exists: productExists, pricing_exists: pricingExists, contact_exists: contactExists },
    }));
  }

  if (!blogExists || comparisonMentions < 2 || awarenessMentions < 4 || conversionMentions < 2) {
    decisions.push(createDecision({
      companyId: params.companyId,
      reportTier,
      issueType: 'content_gap',
      title: 'Content strategy does not cover enough of the buyer journey',
      description: 'Public content appears thin across awareness, comparison, and conversion-stage intent, limiting discoverability and persuasion.',
      recommendation: 'Build a tighter content spine: educational pages, comparison content, and proof-driven decision-stage assets.',
      actionType: 'improve_content',
      actionPayload: { optimization_focus: 'content_strategy', blog_exists: blogExists },
      impactTraffic: 64,
      impactConversion: 48,
      impactRevenue: 44,
      priorityScore: 74,
      effortScore: 42,
      confidenceScore: 0.81,
      evidence: { blog_exists: blogExists, awareness_mentions: awarenessMentions, comparison_mentions: comparisonMentions, conversion_mentions: conversionMentions },
    }));
  }

  if (pagesMissingTitles.length > 0 || pagesMissingMeta.length >= 2 || pagesWithThinMeta.length >= 2 || pagesWithDuplicateMetaTitles.length >= 2) {
    decisions.push(createDecision({
      companyId: params.companyId,
      reportTier,
      issueType: 'seo_gap',
      title: 'Metadata coverage is too weak to support strong search visibility',
      description: 'Several crawled pages are missing titles or descriptions, or reuse titles so heavily that search snippets are unlikely to differentiate the right pages.',
      recommendation: 'Give each core page a distinct title and fuller meta description that matches page intent and the click promise in search.',
      actionType: 'improve_content',
      actionPayload: {
        optimization_focus: 'metadata_coverage',
        missing_title_pages: pagesMissingTitles.map((page) => page.url).slice(0, 5),
        missing_meta_pages: pagesMissingMeta.map((page) => page.url).slice(0, 5),
      },
      impactTraffic: 58,
      impactConversion: 24,
      impactRevenue: 21,
      priorityScore: 67,
      effortScore: 18,
      confidenceScore: 0.84,
      evidence: {
        missing_title_count: pagesMissingTitles.length,
        missing_meta_count: pagesMissingMeta.length,
        thin_meta_count: pagesWithThinMeta.length,
        duplicate_meta_title_count: pagesWithDuplicateMetaTitles.length,
      },
    }));
  }

  if (trustMentions < 3 || caseStudyMentions === 0) {
    decisions.push(createDecision({
      companyId: params.companyId,
      reportTier,
      issueType: 'credibility_gap',
      title: 'Trust proof is too light for a high-confidence buying decision',
      description: 'Testimonials, case studies, and proof elements are underrepresented across public pages.',
      recommendation: 'Add visible trust layers such as testimonials, quantified proof, case studies, and customer outcomes on core pages.',
      actionType: 'adjust_strategy',
      actionPayload: { optimization_focus: 'trust_layer', trust_mentions: trustMentions },
      impactTraffic: 18,
      impactConversion: 63,
      impactRevenue: 59,
      priorityScore: 68,
      effortScore: 26,
      confidenceScore: 0.8,
      evidence: { testimonial_mentions: testimonialMentions, case_study_mentions: caseStudyMentions, proof_mentions: proofMentions },
    }));
  }

  if (!productExists || productPageWordAvg < 220) {
    decisions.push(createDecision({
      companyId: params.companyId,
      reportTier,
      issueType: 'weak_content_depth',
      title: 'Product structure and hierarchy are not clear enough on the public site',
      description: 'Product or solution pages are too few or too thin to explain the offer clearly and support comparison-stage buyers.',
      recommendation: 'Clarify product hierarchy with stronger solution pages, clearer page grouping, and proof-led explanations of what each offer does.',
      actionType: 'adjust_strategy',
      actionPayload: { optimization_focus: 'product_structure', product_pages: structure.product_pages },
      impactTraffic: 33,
      impactConversion: 58,
      impactRevenue: 54,
      priorityScore: 66,
      effortScore: 38,
      confidenceScore: 0.74,
      evidence: { product_page_count: structure.product_pages.length, product_page_word_avg: Math.round(productPageWordAvg) },
    }));
  }

  if (pagesWithoutH1.length >= 1 || thinPages.length >= 2) {
    decisions.push(createDecision({
      companyId: params.companyId,
      reportTier,
      issueType: 'weak_content_depth',
      title: 'Core pages are too thin or weakly structured to perform well in search',
      description: 'Important pages lack enough depth or heading structure to clearly explain the topic, which weakens both ranking potential and user clarity.',
      recommendation: 'Strengthen each important page with a clear H1, stronger section structure, and enough content depth to answer the real buyer question.',
      actionType: 'improve_content',
      actionPayload: {
        optimization_focus: 'page_depth',
        thin_pages: thinPages.map((page) => page.url).slice(0, 5),
        pages_without_h1: pagesWithoutH1.map((page) => page.url).slice(0, 5),
      },
      impactTraffic: 61,
      impactConversion: 31,
      impactRevenue: 27,
      priorityScore: 71,
      effortScore: 32,
      confidenceScore: 0.82,
      evidence: {
        thin_page_count: thinPages.length,
        pages_without_h1_count: pagesWithoutH1.length,
      },
    }));
  }

  if (pagesWithStatusErrors.length > 0 || orphanLikePages.length >= 2 || internalLinkAvg < 1.5) {
    decisions.push(createDecision({
      companyId: params.companyId,
      reportTier,
      issueType: 'seo_gap',
      title: 'Technical crawlability and internal linking are leaving pages under-supported',
      description: 'Some pages show crawl errors or sit with too little internal link support, which makes them harder for search engines and users to reach reliably.',
      recommendation: 'Fix crawl errors first, then add stronger internal links from the homepage and core pages to the pages that should rank and convert.',
      actionType: 'fix_distribution',
      actionPayload: {
        optimization_focus: 'crawlability_internal_links',
        error_pages: pagesWithStatusErrors.map((page) => page.url).slice(0, 5),
        orphan_like_pages: orphanLikePages.map((page) => page.url).slice(0, 5),
      },
      impactTraffic: 56,
      impactConversion: 22,
      impactRevenue: 20,
      priorityScore: 69,
      effortScore: 24,
      confidenceScore: 0.8,
      evidence: {
        status_error_count: pagesWithStatusErrors.length,
        orphan_like_page_count: orphanLikePages.length,
        internal_link_avg: Number(internalLinkAvg.toFixed(2)),
      },
    }));
  }

  if (!geoExists && Boolean(params.resolvedInput?.resolved.geography)) {
    decisions.push(createDecision({
      companyId: params.companyId,
      reportTier,
      issueType: 'localized_content_gap',
      title: 'The site is not signalling location relevance strongly enough',
      description: 'Public pages do not show enough geo-specific coverage for the stated market, weakening local relevance.',
      recommendation: 'Create geo-relevant landing pages or localized proof sections that match the markets you most want to win.',
      actionType: 'fix_distribution',
      actionPayload: { optimization_focus: 'geo_relevance', target_geo: params.resolvedInput?.resolved.geography ?? null },
      impactTraffic: 38,
      impactConversion: 34,
      impactRevenue: 31,
      priorityScore: 59,
      effortScore: 29,
      confidenceScore: 0.71,
      evidence: { geo_pages: structure.geo_pages, stated_geo: params.resolvedInput?.resolved.geography ?? null },
    }));
  }

  if (geoExists && geoPageSlugCoverage === 0 && Boolean(params.resolvedInput?.resolved.geography)) {
    decisions.push(createDecision({
      companyId: params.companyId,
      reportTier,
      issueType: 'localized_content_gap',
      title: 'Location pages exist but are not clearly targeted enough for local search',
      description: 'The crawl suggests geo intent is present, but the page structure does not strongly signal location-specific targeting or dedicated local coverage.',
      recommendation: 'Tighten location page structure with clearer geographic naming, local proof, and stronger service-plus-location relevance on the page.',
      actionType: 'fix_distribution',
      actionPayload: {
        optimization_focus: 'geo_page_targeting',
        geo_pages: structure.geo_pages.slice(0, 5),
      },
      impactTraffic: 43,
      impactConversion: 28,
      impactRevenue: 24,
      priorityScore: 61,
      effortScore: 26,
      confidenceScore: 0.68,
      evidence: {
        geo_page_count: structure.geo_pages.length,
        geo_slug_coverage: geoPageSlugCoverage,
        target_geo: params.resolvedInput?.resolved.geography ?? null,
      },
    }));
  }

  if (faqMentions === 0 || directAnswerMentions < 3) {
    decisions.push(createDecision({
      companyId: params.companyId,
      reportTier,
      issueType: 'seo_gap',
      title: 'The site is not structured strongly for AI and answer-engine discovery',
      description: 'Public content lacks enough FAQ, summary, and direct-answer patterns to perform well in answer-style search experiences.',
      recommendation: 'Add FAQ blocks, direct answers, summary sections, and structured comparison language to key pages.',
      actionType: 'improve_content',
      actionPayload: { optimization_focus: 'aeo_readiness', faq_mentions: faqMentions, direct_answers: directAnswerMentions },
      impactTraffic: 55,
      impactConversion: 29,
      impactRevenue: 26,
      priorityScore: 65,
      effortScore: 24,
      confidenceScore: 0.77,
      evidence: { faq_mentions: faqMentions, direct_answer_mentions: directAnswerMentions, total_words: totalWords },
    }));
  }

  return {
    site_structure: {
      homepage: structure.homepage,
      product_pages: dedupe(structure.product_pages).slice(0, 12),
      pricing_pages: dedupe(structure.pricing_pages).slice(0, 12),
      blog_pages: dedupe(structure.blog_pages).slice(0, 12),
      contact_pages: dedupe(structure.contact_pages).slice(0, 12),
      geo_pages: dedupe(structure.geo_pages).slice(0, 12),
    },
    geo_aeo_context: geoAeoContext,
    decisions,
  };
}
