import { URL } from 'node:url';
import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionSourceEntityType,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { clamp, normalizeText, roundNumber, safeAverage, stableUuid } from './intelligenceEngineUtils';

type PageRow = {
  id: string;
  url: string;
  page_type: string;
  title: string | null;
  headings: string[] | null;
  ctas: unknown[] | null;
  internal_link_count: number | null;
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
  is_internal: boolean;
};

type ClusterBucket = {
  clusterId: string;
  topic: string;
  pageIds: string[];
  wordCount: number;
  headingCount: number;
  ctaCount: number;
  supportLinks: number;
};

function deriveClusterTopic(page: PageRow): string {
  try {
    const pathname = new URL(page.url).pathname;
    const firstSegment = pathname.split('/').filter(Boolean)[0];
    if (firstSegment) {
      return firstSegment.replace(/[-_]+/g, ' ').trim().toLowerCase();
    }
  } catch {
    // ignore URL parsing problems
  }

  const title = normalizeText(page.title);
  if (title) {
    return title.split(/\s+/).slice(0, 3).join(' ');
  }

  return normalizeText(page.page_type) || 'site';
}

async function loadContentAuthorityContext(companyId: string): Promise<{
  pages: PageRow[];
  pageContent: PageContentRow[];
  pageLinks: PageLinkRow[];
}> {
  const { data: pages, error: pagesError } = await supabase
    .from('canonical_pages')
    .select('id, url, page_type, title, headings, ctas, internal_link_count')
    .eq('company_id', companyId)
    .order('last_crawled_at', { ascending: false })
    .limit(500);

  if (pagesError) {
    throw new Error(`Failed to load canonical pages for ${companyId}: ${pagesError.message}`);
  }

  const pageIds = ((pages ?? []) as PageRow[]).map((row) => row.id);
  if (pageIds.length === 0) {
    return { pages: [], pageContent: [], pageLinks: [] };
  }

  const [pageContentRes, pageLinksRes] = await Promise.all([
    supabase
      .from('page_content')
      .select('page_id, block_type, content_text, heading_level')
      .eq('company_id', companyId)
      .in('page_id', pageIds),
    supabase
      .from('page_links')
      .select('from_page_id, to_page_id, is_internal')
      .eq('company_id', companyId)
      .in('from_page_id', pageIds),
  ]);

  if (pageContentRes.error) {
    throw new Error(`Failed to load page content for ${companyId}: ${pageContentRes.error.message}`);
  }
  if (pageLinksRes.error) {
    throw new Error(`Failed to load page links for ${companyId}: ${pageLinksRes.error.message}`);
  }

  return {
    pages: (pages ?? []) as PageRow[],
    pageContent: (pageContentRes.data ?? []) as PageContentRow[],
    pageLinks: (pageLinksRes.data ?? []) as PageLinkRow[],
  };
}

export async function generateContentAuthorityDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('contentAuthorityService');

  const { pages, pageContent, pageLinks } = await loadContentAuthorityContext(companyId);
  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'contentAuthorityService',
    entity_type: 'content_cluster',
    changed_by: 'system',
  });

  if (pages.length === 0) return [];

  const contentByPageId = new Map<string, PageContentRow[]>();
  for (const row of pageContent) {
    const current = contentByPageId.get(row.page_id) ?? [];
    current.push(row);
    contentByPageId.set(row.page_id, current);
  }

  const clusterByPageId = new Map<string, string>();
  const buckets = new Map<string, ClusterBucket>();

  for (const page of pages) {
    const topic = deriveClusterTopic(page);
    const clusterId = stableUuid([companyId, 'content_cluster', topic]);
    clusterByPageId.set(page.id, clusterId);
    const blocks = contentByPageId.get(page.id) ?? [];
    const words = blocks.reduce((sum, block) => sum + String(block.content_text ?? '').split(/\s+/).filter(Boolean).length, 0);
    const headingCount = blocks.filter((block) => block.block_type === 'heading').length + (Array.isArray(page.headings) ? page.headings.length : 0);
    const current = buckets.get(clusterId) ?? {
      clusterId,
      topic,
      pageIds: [],
      wordCount: 0,
      headingCount: 0,
      ctaCount: 0,
      supportLinks: 0,
    };
    current.pageIds.push(page.id);
    current.wordCount += words;
    current.headingCount += headingCount;
    current.ctaCount += Array.isArray(page.ctas) ? page.ctas.length : 0;
    buckets.set(clusterId, current);
  }

  for (const link of pageLinks) {
    if (!link.is_internal || !link.to_page_id) continue;
    const fromClusterId = clusterByPageId.get(link.from_page_id);
    const toClusterId = clusterByPageId.get(link.to_page_id);
    if (!fromClusterId || !toClusterId || fromClusterId !== toClusterId) continue;
    const bucket = buckets.get(fromClusterId);
    if (bucket) bucket.supportLinks += 1;
  }

  const decisions = [];
  for (const bucket of buckets.values()) {
    const pageCount = bucket.pageIds.length;
    const avgWords = safeAverage(bucket.wordCount, pageCount);
    const avgHeadings = safeAverage(bucket.headingCount, pageCount);
    const avgCtas = safeAverage(bucket.ctaCount, pageCount);

    if (pageCount === 1 && avgWords < 450) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'contentAuthorityService',
        entity_type: 'content_cluster' as const,
        entity_id: bucket.clusterId,
        issue_type: 'topic_gap',
        title: 'Topic cluster exists as a thin single-page surface',
        description: `Cluster "${bucket.topic}" only has one lightweight page, which is not enough to establish authority.`,
        evidence: {
          content_cluster: bucket.topic,
          cluster_id: bucket.clusterId,
          page_count: pageCount,
          avg_word_count: roundNumber(avgWords, 1),
          avg_heading_count: roundNumber(avgHeadings, 1),
        },
        impact_traffic: 58,
        impact_conversion: 30,
        impact_revenue: 26,
        priority_score: 60,
        effort_score: 24,
        confidence_score: 0.81,
        recommendation: 'Expand this topic into supporting pages, FAQs, and intent-specific subpages so it can become an authority cluster.',
        action_type: 'improve_content',
        action_payload: {
          content_cluster: bucket.topic,
          cluster_id: bucket.clusterId,
          optimization_focus: 'topic_gap',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (avgWords < 300 || avgHeadings < 3) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'contentAuthorityService',
        entity_type: 'content_cluster' as const,
        entity_id: bucket.clusterId,
        issue_type: 'weak_content_depth',
        title: 'Cluster content depth is too shallow',
        description: `Cluster "${bucket.topic}" lacks the structural depth needed to signal expertise and support ranking growth.`,
        evidence: {
          content_cluster: bucket.topic,
          cluster_id: bucket.clusterId,
          page_count: pageCount,
          avg_word_count: roundNumber(avgWords, 1),
          avg_heading_count: roundNumber(avgHeadings, 1),
          avg_cta_count: roundNumber(avgCtas, 1),
        },
        impact_traffic: clamp(40 + Math.round((300 - Math.min(avgWords, 300)) / 12), 0, 100),
        impact_conversion: 24,
        impact_revenue: 20,
        priority_score: clamp(44 + Math.round((3 - Math.min(avgHeadings, 3)) * 10), 0, 100),
        effort_score: 18,
        confidence_score: 0.78,
        recommendation: 'Increase topical coverage with stronger section depth, supporting headings, and evidence-rich content blocks.',
        action_type: 'improve_content',
        action_payload: {
          content_cluster: bucket.topic,
          cluster_id: bucket.clusterId,
          optimization_focus: 'content_depth',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (pageCount <= 2 && bucket.supportLinks <= 1) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'contentAuthorityService',
        entity_type: 'content_cluster' as const,
        entity_id: bucket.clusterId,
        issue_type: 'missing_cluster_support',
        title: 'Cluster lacks internal support structure',
        description: `Cluster "${bucket.topic}" does not have enough supporting pages or internal links to behave like an authority system.`,
        evidence: {
          content_cluster: bucket.topic,
          cluster_id: bucket.clusterId,
          page_count: pageCount,
          support_links: bucket.supportLinks,
          avg_cta_count: roundNumber(avgCtas, 1),
        },
        impact_traffic: 36,
        impact_conversion: 26,
        impact_revenue: 22,
        priority_score: 46,
        effort_score: 20,
        confidence_score: 0.8,
        recommendation: 'Create linked supporting pages inside this topic so authority and conversion intent reinforce each other.',
        action_type: 'improve_content',
        action_payload: {
          content_cluster: bucket.topic,
          cluster_id: bucket.clusterId,
          optimization_focus: 'cluster_support',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    // NEW: weak_cluster_depth — established cluster (many pages) but shallow individual page depth
    if (pageCount >= 3 && (avgWords < 400 || avgHeadings < 4)) {
      if (!decisions.some((d) => d.entity_id === bucket.clusterId && d.issue_type === 'weak_content_depth')) {
        decisions.push({
          company_id: companyId,
          report_tier: 'deep' as const,
          source_service: 'contentAuthorityService',
          entity_type: 'content_cluster' as const,
          entity_id: bucket.clusterId,
          issue_type: 'weak_cluster_depth',
          title: 'Cluster has multiple pages but each is individually shallow',
          description: `Cluster "${bucket.topic}" has ${pageCount} pages but average depth is insufficient. Individual pages lack the substance to rank as authority.`,
          evidence: {
            content_cluster: bucket.topic,
            cluster_id: bucket.clusterId,
            page_count: pageCount,
            avg_word_count: roundNumber(avgWords, 1),
            avg_heading_count: roundNumber(avgHeadings, 1),
            total_words: bucket.wordCount,
          },
          impact_traffic: clamp(46 + Math.round((5 - Math.min(avgHeadings, 5)) * 8), 0, 100),
          impact_conversion: 28,
          impact_revenue: 24,
          priority_score: clamp(50 + Math.round((5 - Math.min(avgHeadings, 5)) * 10), 0, 100),
          effort_score: 22,
          confidence_score: 0.76,
          recommendation: 'Increase depth on each page in the cluster: add more substantive sections, evidence, and expert-level detail.',
          action_type: 'improve_content',
          action_payload: {
            content_cluster: bucket.topic,
            cluster_id: bucket.clusterId,
            optimization_focus: 'cluster_page_depth',
          },
          status: 'open' as const,
          last_changed_by: 'system' as const,
        });
      }
    }

    // NEW: missing_supporting_content — detect implicit missing support page types
    if (pageCount >= 2 && pageCount <= 4) {
      const pageTypes = new Set(pages.filter((p) => buckets.get(clusterByPageId.get(p.id) ?? '')?.clusterId === bucket.clusterId).map((p) => p.page_type));
      const hasHowTo = pageTypes.has('guide') || pageTypes.has('how-to') || Array.from(pageTypes).some((t) => /how|guide|tutorial/i.test(t));
      const hasFaq = pageTypes.has('faq') || Array.from(pageTypes).some((t) => /faq|q&a/i.test(t));
      const hasComparison = pageTypes.has('comparison') || Array.from(pageTypes).some((t) => /compar|vs\b/i.test(t));

      let missingTypes = [];
      if (!hasHowTo && pageCount >= 2) missingTypes.push('how-to guide');
      if (!hasFaq && pageCount >= 3) missingTypes.push('FAQ page');
      if (!hasComparison && pageCount >= 3) missingTypes.push('comparison page');

      if (missingTypes.length > 0) {
        decisions.push({
          company_id: companyId,
          report_tier: 'growth' as const,
          source_service: 'contentAuthorityService',
          entity_type: 'content_cluster' as const,
          entity_id: bucket.clusterId,
          issue_type: 'missing_supporting_content',
          title: `Cluster is missing supporting content types`,
          description: `Cluster "${bucket.topic}" would benefit from ${missingTypes.join(', ')} to round out the user journey and improve search visibility across intents.`,
          evidence: {
            content_cluster: bucket.topic,
            cluster_id: bucket.clusterId,
            page_count: pageCount,
            existing_page_types: Array.from(pageTypes),
            missing_content_types: missingTypes,
          },
          impact_traffic: clamp(40 + Math.round(missingTypes.length * 15), 0, 100),
          impact_conversion: 32,
          impact_revenue: 28,
          priority_score: clamp(48 + Math.round(missingTypes.length * 12), 0, 100),
          effort_score: 20,
          confidence_score: 0.8,
          recommendation: `Create the following pages within the "${bucket.topic}" cluster: ${missingTypes.join(', ')}. Link them internally to strengthen the cluster.`,
          action_type: 'improve_content',
          action_payload: {
            content_cluster: bucket.topic,
            cluster_id: bucket.clusterId,
            missing_content_types: missingTypes,
            optimization_focus: 'supporting_content',
          },
          status: 'open' as const,
          last_changed_by: 'system' as const,
        });
      }
    }
  }

  // NEW: content_gap — detect topics that should exist based on keyword signals but don't have content clusters
  if (pages.length > 0) {
    // Extract potential topics from existing clusters
    const existingTopics = new Set(buckets.values().map((b) => b.topic.toLowerCase()));

    // Infer missing topics from keyword patterns (simplified: keywords that don't match any cluster topic)
    const { data: allKeywords, error: keywordsError } = await supabase
      .from('canonical_keywords')
      .select('keyword')
      .eq('company_id', companyId)
      .limit(100);

    if (!keywordsError && allKeywords && allKeywords.length > 0) {
      const keywordThemes = new Map<string, number>();
      for (const kw of allKeywords as any[]) {
        const words = String(kw.keyword || '').split(/\s+/)[0].toLowerCase();
        if (words) {
          keywordThemes.set(words, (keywordThemes.get(words) ?? 0) + 1);
        }
      }

      // Find high-frequency keyword themes not in existing clusters
      for (const [theme, count] of keywordThemes.entries()) {
        if (count >= 3 && !existingTopics.has(theme)) {
          // This theme appears in multiple keywords but has no content cluster
          const representativePageId = Array.from(buckets.values())[0]?.pageIds[0];
          decisions.push({
            company_id: companyId,
            report_tier: 'growth' as const,
            source_service: 'contentAuthorityService',
            entity_type: 'page' as const,
            entity_id: representativePageId || stableUuid([companyId, 'content_gap', theme]),
            issue_type: 'content_gap',
            title: `No dedicated content cluster for "${theme}" despite keyword interest`,
            description: `Keyword signals show demand for "${theme}" content (${count} keywords), but no dedicated content cluster exists for this topic.`,
            evidence: {
              missing_topic: theme,
              keyword_signal_count: count,
              existing_clusters: Array.from(existingTopics),
            },
            impact_traffic: clamp(54 + Math.round(count * 4), 0, 100),
            impact_conversion: 32,
            impact_revenue: 28,
            priority_score: clamp(60 + Math.round(count * 3), 0, 100),
            effort_score: 30,
            confidence_score: 0.77,
            recommendation: `Build a new content cluster around "${theme}" with 3-5 interlinked pages to capture the existing keyword demand.`,
            action_type: 'improve_content',
            action_payload: {
              missing_topic: theme,
              keyword_signal_count: count,
              optimization_focus: 'content_gap',
            },
            status: 'open' as const,
            last_changed_by: 'system' as const,
          });
        }
      }
    }
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
