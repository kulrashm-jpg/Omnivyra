import { useEffect, useMemo, useState } from 'react';
import type { CardSelectionBundle, CardSuggestions, ExistingItem, ManagedIntelligenceProps, RecommendationCard } from './types';
import { buildDefaultRecommendations } from './recommendations';
import { fetchCardSuggestions } from './briefSuggestionsFetcher';

type UseManagedIntelligenceDataInput = {
  contentType: ManagedIntelligenceProps['contentType'];
  formatLabel: string;
  targetWords: number;
  depthLabel: string;
  selectedCompanyId: string | null | undefined;
  selectedCompanyName: string | null | undefined;
};

export function useManagedIntelligenceData(input: UseManagedIntelligenceDataInput) {
  const { contentType, formatLabel, targetWords, depthLabel, selectedCompanyId, selectedCompanyName } = input;
  const suggestionCount = targetWords <= 900 ? 3 : targetWords <= 1600 ? 5 : targetWords <= 2500 ? 6 : 8;

  const [loading, setLoading] = useState(true);
  const [companyName, setCompanyName] = useState(selectedCompanyName || 'Your Company');
  const [companyContext, setCompanyContext] = useState('');
  const [existingItems, setExistingItems] = useState<ExistingItem[]>([]);
  const [customCards, setCustomCards] = useState<RecommendationCard[]>([]);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [cardSuggestions, setCardSuggestions] = useState<Record<number, CardSuggestions>>({});
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  useEffect(() => {
    if (selectedCompanyName) {
      setCompanyName((current) => (current === 'Your Company' ? selectedCompanyName : current));
    }
  }, [selectedCompanyName]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/company/blogs?company_id=${selectedCompanyId}&content_type=${contentType}`, { credentials: 'include' })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
      fetch(`/api/company-profile?company_id=${selectedCompanyId}`, { credentials: 'include' })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
    ])
      .then(([contentData, profileData]) => {
        if (Array.isArray(contentData?.blogs)) {
          setExistingItems(contentData.blogs);
        }
        if (profileData?.profile?.name) {
          setCompanyName(profileData.profile.name);
        }
        if (profileData?.profile) {
          const parts = [
            profileData.profile.industry,
            profileData.profile.category,
            profileData.profile.products_services,
            profileData.profile.target_audience,
            profileData.profile.goals,
            profileData.profile.content_themes,
            profileData.profile.brand_voice,
          ].filter(Boolean);
          setCompanyContext(parts.join(' | '));
        }
      })
      .finally(() => setLoading(false));
  }, [contentType, selectedCompanyId]);

  const cards = useMemo(() => {
    const defaults = buildDefaultRecommendations(contentType, formatLabel, companyName, existingItems.length);
    return [...customCards, ...defaults];
  }, [companyName, contentType, customCards, existingItems.length, formatLabel]);

  useEffect(() => {
    if (!selectedCompanyId || cards.length === 0 || suggestionsLoading) return;
    if (cardSuggestions[0]) return;
    // P1.8 — the page no longer blocks on `loading`, so wait for the profile /
    // library reads here instead. This keeps the request body byte-identical to
    // the previous behaviour (chips always saw resolved company context) while
    // the rest of the page stays interactive.
    if (loading) return;

    const currentContent = existingItems.length > 0
      ? `Existing ${contentType.replace('-', ' ')} library: ${existingItems.slice(0, 3).map((item) => item.title).join(' · ')}${existingItems.length > 3 ? ' · ...' : ''}`
      : `No ${contentType.replace('-', ' ')} pieces yet. This piece should set a strong initial quality bar.`;

    const writingStyle = [
      `Target approximately ${targetWords.toLocaleString()} words.`,
      `Aim for ${depthLabel.toLowerCase()} with strong specificity and real substance.`,
      'Use a modern, credible structure with less filler and clearer decision-useful detail.',
    ].join(' ');

    setSuggestionsLoading(true);
    // P1.8 — the per-card requests are independent, so they run concurrently
    // instead of one-at-a-time. Body shape, endpoint and count are unchanged.
    const fetchAll = async () => {
      const results = await fetchCardSuggestions(
        cards.map((card, index) => ({
          index,
          body: {
            company_id: selectedCompanyId,
            topic: card.topic,
            reason: card.reason,
            brief: {
              company_id: selectedCompanyId,
              company_name: companyName,
              company_context: companyContext || 'Company profile context available.',
              current_content: currentContent,
              writing_style: writingStyle,
              related_titles: existingItems.slice(0, 3).map((item) => item.title),
              intent: card.intent,
              tone: 'Specific, modern, and high-signal',
            },
            currentValues: {},
            count: suggestionCount,
          },
        })),
      );
      setCardSuggestions(results);
      setSuggestionsLoading(false);
    };

    void fetchAll();
  }, [
    cardSuggestions,
    cards,
    companyContext,
    companyName,
    contentType,
    depthLabel,
    existingItems,
    loading,
    selectedCompanyId,
    suggestionCount,
    suggestionsLoading,
    targetWords,
  ]);

  const publishedCount = existingItems.filter((item) => item.status === 'published').length;
  const draftCount = existingItems.filter((item) => item.status !== 'published').length;
  const totalViews = existingItems.reduce((sum, item) => sum + (item.views_count || 0), 0);
  const topPerforming = [...existingItems].sort((a, b) => (b.views_count || 0) - (a.views_count || 0))[0];

  const actionItems = useMemo(() => {
    const actions: string[] = [];
    if (existingItems.length === 0) {
      actions.push(`Start with one strong ${contentType.replace('-', ' ')} built around a durable strategic angle.`);
      actions.push('Use the recommended cards below to choose a direction before selecting the final template.');
    } else {
      actions.push(`Publish the next ${contentType.replace('-', ' ')} in a way that clearly deepens, not repeats, your existing library.`);
      if (draftCount > 0) {
        actions.push(`You already have ${draftCount} draft${draftCount === 1 ? '' : 's'}; finish the strongest one or create a sharper replacement.`);
      }
    }
    actions.push('After choosing a card, pick the best template structure so the draft starts with enough depth and shape.');
    return actions.slice(0, 3);
  }, [contentType, draftCount, existingItems.length]);

  const buildCardBundle = (card: RecommendationCard, index: number): CardSelectionBundle => {
    const currentContent = existingItems.length > 0
      ? `Existing ${contentType.replace('-', ' ')} library: ${existingItems.slice(0, 3).map((item) => item.title).join(' · ')}${existingItems.length > 3 ? ' · ...' : ''}`
      : `No ${contentType.replace('-', ' ')} pieces yet. This is a good time to set the quality bar with a strong first asset.`;

    return {
      topic: card.topic,
      reason: card.reason,
      targetWords,
      depthLabel,
      formatLabel,
      suggestions: cardSuggestions[index],
      brief: {
        company_id: selectedCompanyId || '',
        company_context: companyContext || `Shape this ${contentType.replace('-', ' ')} around your market, audience, and brand point of view.`,
        current_content: currentContent,
        writing_style: `Target approximately ${targetWords.toLocaleString()} words. Aim for ${depthLabel.toLowerCase()} with strong specificity and real substance.`,
        related_titles: existingItems.slice(0, 3).map((item) => item.title),
        intent: card.intent,
        tone: 'Specific, modern, and high-signal',
      },
    };
  };

  return {
    loading,
    companyName,
    companyContext,
    existingItems,
    cards,
    cardSuggestions,
    suggestionsLoading,
    isAIModalOpen,
    setIsAIModalOpen,
    setCustomCards,
    buildCardBundle,
    publishedCount,
    draftCount,
    totalViews,
    topPerforming,
    actionItems,
  };
}
