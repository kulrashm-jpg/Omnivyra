import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildTopicClusters,
  detectContentGaps,
  generateRecommendations,
  PLATFORM_DEFAULT_PILLARS,
  type ContentGap,
  type Recommendation,
  type ExistingPostMeta,
} from '../../../lib/blog/topicDetection';
import { computeAllMetrics, type PostPerformance } from '../../../lib/blog/performanceEngine';
import {
  buildWritingStyleProfile,
  formatStyleInstructions,
  type WritingStyleProfile,
} from '../../../lib/content/writingStyleEngine';
import type { CompanyProfile } from '../../../backend/services/companyProfileService';
import type { BriefInsight, EnrichedGap } from '../../../pages/blogs.types';

export interface PostMeta extends ExistingPostMeta {
  views_count: number;
  likes_count: number;
  status: string;
  has_summary: boolean;
  internal_links: number;
  references_count: number;
  published_at: string | null;
}

export interface SeriesRow {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  blog_series_posts: { blog_id: string; position: number; title: string; slug: string; status: string }[];
}

export type CardSuggestions = {
  uniqueness_directive_options: string[];
  must_include_points_options: string[];
  campaign_objective_options: string[];
  trend_context_options: string[];
};

type UseBlogIntelligenceInput = {
  selectedCompanyId: string | null | undefined;
  suggestionCount: number;
};

export function useBlogIntelligence(input: UseBlogIntelligenceInput) {
  const { selectedCompanyId, suggestionCount } = input;
  const [posts, setPosts] = useState<PostMeta[]>([]);
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [companyContextNote, setCompanyContextNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAICardModalOpen, setIsAICardModalOpen] = useState(false);
  const [cardSuggestions, setCardSuggestions] = useState<Record<number, CardSuggestions>>({});
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const fetchIntelligence = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    setError('');

    try {
      const qs = `company_id=${selectedCompanyId}`;
      const [intelligenceRes, profileRes] = await Promise.all([
        fetch(`/api/company/blog/intelligence?${qs}`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`/api/company-profile?company_id=${selectedCompanyId}`, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);

      const blogsData = intelligenceRes.posts || [];
      const seriesData = intelligenceRes.series || [];

      setPosts(
        blogsData.map((b: any) => ({
          id: b.id,
          title: b.title,
          slug: b.slug || '',
          status: b.status,
          excerpt: b.excerpt || '',
          tags: b.tags || [],
          category: b.category || '',
          views_count: b.views_count || 0,
          likes_count: b.likes_count || 0,
          has_summary: b.has_summary || false,
          internal_links: b.internal_links || 0,
          references_count: b.references_count || 0,
          published_at: b.published_at,
        })),
      );
      setSeries(seriesData);
      setCompanyProfile(profileRes?.profile || null);

      if (profileRes?.profile) {
        const { industry, target_audience, brand_voice } = profileRes.profile;
        const parts = [industry, target_audience, brand_voice].filter(Boolean);
        setCompanyContextNote(parts.join(' • ') || '');
      }
    } catch {
      setError('Failed to load blog intelligence. Please refresh and try again.');
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    void fetchIntelligence();
  }, [fetchIntelligence]);

  const viewModel = useMemo(() => {
    if (posts.length === 0) {
      const defaultGaps: ContentGap[] = [
        {
          topic: 'Category entry guide for first-time buyers',
          slug: 'category-entry-guide',
          reason: 'Give new buyers a credible starting point that explains the landscape, the stakes, and how to evaluate solutions clearly.',
          priority: 'high',
          relatedTo: [],
        },
        {
          topic: 'The operational pain points your audience is still tolerating',
          slug: 'operational-pain-points',
          reason: 'Pain-driven topics convert attention into action because they articulate the cost of inaction with clarity.',
          priority: 'high',
          relatedTo: [],
        },
        {
          topic: 'Strategic case examples that prove your point of view',
          slug: 'strategic-case-examples',
          reason: 'Decision-makers trust brands that can translate advice into measurable business outcomes.',
          priority: 'medium',
          relatedTo: [],
        },
        {
          topic: 'What is changing in your market right now',
          slug: 'market-shifts',
          reason: 'Timely opinion and analysis helps position your team as current, informed, and commercially aware.',
          priority: 'medium',
          relatedTo: [],
        },
        {
          topic: 'How your approach compares to alternatives',
          slug: 'approach-vs-alternatives',
          reason: 'Comparison content supports late-stage evaluation and makes your differentiation easier to defend.',
          priority: 'medium',
          relatedTo: [],
        },
      ];

      const enrichedGaps: (ContentGap & { brief?: BriefInsight })[] = defaultGaps.map((gap) => ({
        ...gap,
        brief: {
          company_id: selectedCompanyId || 'default',
          company_name: companyProfile?.name || 'Your Company',
          company_context: 'No prior blog history was detected, so we are prioritizing authority-building topics that establish credibility quickly.',
          current_content: 'No existing blog coverage yet. These topics create the strongest early editorial foundation.',
          writing_style: companyProfile?.brand_voice || 'Clear, commercial, and professionally authoritative',
          writing_style_profile: {
            tone: 'Professional',
            voice: 'Clear and authoritative',
            formality: 'Semi-formal',
            complexity: 'Business-friendly',
          } as unknown as WritingStyleProfile,
          related_titles: [],
          intent: gap.priority === 'high' ? 'authority' : 'awareness',
          tone: 'Executive, credible, and practical',
        },
      }));

      const defaultRecs: Recommendation[] = [
        {
          type: 'write',
          action: 'Publish one flagship authority piece that defines your market point of view.',
          reason: 'A strong cornerstone asset gives the rest of your content program a more credible center of gravity.',
          priority: 'high',
          targetSlug: null,
        },
        {
          type: 'write',
          action: 'Build a cluster of problem-solution blogs around the top pains your buyers are feeling.',
          reason: 'This creates a more commercially useful path from awareness content into consideration-stage intent.',
          priority: 'high',
          targetSlug: null,
        },
        {
          type: 'optimize',
          action: 'Set a repeatable editorial cadence with clearer topic ownership and publishing priorities.',
          reason: 'Consistency signals quality internally and externally, especially for a brand selling expertise.',
          priority: 'medium',
          targetSlug: null,
        },
      ];

      return { gaps: enrichedGaps as ContentGap[], recommendations: defaultRecs, allMetrics: [] };
    }

    const seriesPostIdSet = new Set(series.flatMap((s) => (s.blog_series_posts ?? []).map((sp) => sp.blog_id)));
    const clusters = buildTopicClusters(posts as ExistingPostMeta[]);
    const gapResult = detectContentGaps(clusters, posts as ExistingPostMeta[], PLATFORM_DEFAULT_PILLARS);
    const recommendations = generateRecommendations(gapResult.gaps, clusters, posts as any[]);
    const allMetrics = computeAllMetrics(posts as PostPerformance[], seriesPostIdSet);

    const topTags = posts.flatMap((p: any) => p.tags || []).reduce<Record<string, number>>((acc, tag) => {
      const key = String(tag || '').trim().toLowerCase();
      if (!key) return acc;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const frequentTags = Object.entries(topTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag]) => tag);

    let styleProfile: WritingStyleProfile | null = null;
    let writingStyleText: string;
    if (companyProfile) {
      styleProfile = buildWritingStyleProfile(companyProfile);
      writingStyleText = formatStyleInstructions(styleProfile);
      if (frequentTags.length > 0) writingStyleText += ` Maintain continuity with recurring themes: ${frequentTags.join(', ')}.`;
    } else {
      writingStyleText = [
        'Lead with a business problem or tension worth solving.',
        'Write with commercial clarity, not generic inspiration.',
        frequentTags.length > 0
          ? `Maintain continuity with recurring themes: ${frequentTags.join(', ')}.`
          : 'Use terminology consistent with your current market positioning.',
        'End each piece with a clear takeaway or next-best action.',
      ].join(' ');
    }

    const toneText = styleProfile?.tone_summary || 'Confident, analytical, and commercially practical';
    const gaps: EnrichedGap[] = gapResult.gaps.map((gap) => {
      const relatedTitles = posts
        .filter((p: any) =>
          gap.relatedTo.some(
            (r) => p.title.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(p.title.toLowerCase()),
          ),
        )
        .slice(0, 3)
        .map((p: any) => p.title);

      const bestPerformers = [...posts]
        .filter((p: any) => p.status === 'published')
        .sort((a: any, b: any) => ((b as any).views_count || 0) - ((a as any).views_count || 0))
        .slice(0, 3)
        .map((p: any) => p.title);

      const currentContent = relatedTitles.length > 0
        ? `Existing coverage includes ${relatedTitles.join('; ')}. The next draft should add a sharper angle rather than repeat familiar framing.`
        : `No direct coverage yet. Strong adjacent performers include ${bestPerformers.join('; ') || 'no published examples yet'}.`;

      return {
        ...gap,
        brief: {
          company_id: selectedCompanyId || '',
          company_name: companyProfile?.name || 'Your Company',
          company_context: companyContextNote || 'Company profile context is available and should guide positioning.',
          current_content: currentContent,
          writing_style: writingStyleText,
          writing_style_profile: styleProfile,
          related_titles: relatedTitles,
          intent: gap.priority === 'high' ? 'authority' : gap.priority === 'medium' ? 'conversion' : 'awareness',
          tone: toneText,
        },
      };
    });

    return { gaps, recommendations, allMetrics };
  }, [posts, series, selectedCompanyId, companyContextNote, companyProfile]);

  useEffect(() => {
    if (!selectedCompanyId || viewModel.gaps.length === 0 || suggestionsLoading) return;
    if (cardSuggestions[0]) return;

    setSuggestionsLoading(true);
    const fetchAll = async () => {
      const results: Record<number, CardSuggestions> = {};
      for (let i = 0; i < viewModel.gaps.length; i += 1) {
        const gap = viewModel.gaps[i];
        const brief = (gap as any).brief;
        try {
          const res = await fetch('/api/company/blog/brief-suggestions', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_id: selectedCompanyId,
              topic: gap.topic,
              reason: gap.reason,
              brief: brief || {},
              currentValues: {},
              count: suggestionCount,
            }),
          });
          if (res.ok) {
            results[i] = await res.json();
          }
        } catch {
          // Keep the rest of the page usable even if one request fails.
        }
      }
      setCardSuggestions(results);
      setSuggestionsLoading(false);
    };

    void fetchAll();
  }, [cardSuggestions, selectedCompanyId, suggestionCount, suggestionsLoading, viewModel.gaps]);

  return {
    posts,
    companyProfile,
    companyContextNote,
    loading,
    error,
    isAICardModalOpen,
    setIsAICardModalOpen,
    cardSuggestions,
    suggestionsLoading,
    fetchIntelligence,
    gaps: viewModel.gaps,
    recommendations: viewModel.recommendations,
    allMetrics: viewModel.allMetrics,
  };
}
