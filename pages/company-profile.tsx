import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import Header from '../components/Header';
import ChatVoiceButton from '../components/ChatVoiceButton';
import { supabase } from '../utils/supabaseClient';

type CompanyProfile = {
  company_id?: string;
  name?: string;
  industry?: string;
  category?: string;
  website_url?: string;
  industry_list?: string[];
  category_list?: string[];
  geography_list?: string[];
  competitors_list?: string[];
  content_themes_list?: string[];
  products_services_list?: string[];
  target_audience_list?: string[];
  goals_list?: string[];
  brand_voice_list?: string[];
  social_profiles?: Array<{ platform: string; url: string; source?: string; confidence?: string }>;
  field_confidence?: Record<string, string>;
  overall_confidence?: number;
  source_urls?: string[];
  linkedin_url?: string;
  facebook_url?: string;
  instagram_url?: string;
  x_url?: string;
  youtube_url?: string;
  tiktok_url?: string;
  reddit_url?: string;
  blog_url?: string;
  other_social_links?: Array<{ label?: string; url?: string }>;
  products_services?: string;
  target_audience?: string;
  geography?: string;
  brand_voice?: string;
  goals?: string;
  competitors?: string;
  unique_value?: string;
  content_themes?: string;
  confidence_score?: number;
  source?: string;
  last_refined_at?: string | null;
  target_customer_segment?: string | null;
  ideal_customer_profile?: string | null;
  pricing_model?: string | null;
  sales_motion?: string | null;
  avg_deal_size?: string | null;
  sales_cycle?: string | null;
  key_metrics?: string | null;
  user_locked_fields?: string[] | null;
  last_edited_by?: string | null;
  marketing_channels?: string | null;
  content_strategy?: string | null;
  campaign_focus?: string | null;
  key_messages?: string | null;
  brand_positioning?: string | null;
  competitive_advantages?: string | null;
  growth_priorities?: string | null;
  campaign_purpose_intent?: {
    primary_objective?: string | null;
    campaign_intent?: string | null;
    monetization_intent?: string | null;
    dominant_problem_domains?: string[];
    brand_positioning_angle?: string | null;
  } | null;
};

type CompanyProfileRefinement = {
  id?: string;
  company_id?: string;
  before_profile?: any;
  after_profile?: any;
  source_urls?: Array<{ label: string; url: string }>;
  source_summaries?: Array<{ label: string; url: string; summary: string }>;
  changed_fields?: Array<{ field: string; before: any; after: any }>;
  extraction_output?: any;
  missing_fields_questions?: Array<{ field: string; question: string; options: string[]; allow_multiple?: boolean }>;
  created_at?: string;
};

const emptyProfile: CompanyProfile = {
  name: '',
  industry: '',
  category: '',
  website_url: '',
  linkedin_url: '',
  facebook_url: '',
  instagram_url: '',
  x_url: '',
  youtube_url: '',
  tiktok_url: '',
  reddit_url: '',
  blog_url: '',
  other_social_links: [],
  products_services: '',
  target_audience: '',
  geography: '',
  brand_voice: '',
  goals: '',
  competitors: '',
  unique_value: '',
  content_themes: '',
  target_customer_segment: '',
  ideal_customer_profile: '',
  pricing_model: '',
  sales_motion: '',
  avg_deal_size: '',
  sales_cycle: '',
  key_metrics: '',
  marketing_channels: '',
  content_strategy: '',
  campaign_focus: '',
  key_messages: '',
  brand_positioning: '',
  competitive_advantages: '',
  growth_priorities: '',
};

const splitToList = (value?: string): string[] => {
  if (!value) return [];
  return value
    .split(/[,;/|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

const joinList = (value?: string[] | null, fallback?: string | null): string => {
  if (Array.isArray(value) && value.length > 0) {
    return value.join(', ');
  }
  return fallback || '';
};

const buildSocialProfilesFromScalars = (
  profile: CompanyProfile
): Array<{ platform: string; url: string; source?: string; confidence?: string }> => {
  const candidates = [
    { platform: 'linkedin', url: profile.linkedin_url },
    { platform: 'facebook', url: profile.facebook_url },
    { platform: 'instagram', url: profile.instagram_url },
    { platform: 'x', url: profile.x_url },
    { platform: 'youtube', url: profile.youtube_url },
    { platform: 'tiktok', url: profile.tiktok_url },
    { platform: 'reddit', url: profile.reddit_url },
    { platform: 'blog', url: profile.blog_url },
  ].filter((entry) => entry.url);

  const merged = [...(profile.social_profiles || []), ...candidates];
  const deduped = new Map<string, { platform: string; url: string; source?: string; confidence?: string }>();
  merged.forEach((entry) => {
    if (!entry.url) return;
    const key = entry.url.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, { ...entry });
    }
  });
  return Array.from(deduped.values());
};

export default function CompanyProfilePage() {
  const router = useRouter();
  const {
    user,
    companies,
    selectedCompanyId,
    selectedCompanyName,
    setSelectedCompanyId,
    isLoading: isCompanyLoading,
  } = useCompanyContext();
  const isAdmin = useMemo(() => user?.role === 'admin', [user]);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [draftProfile, setDraftProfile] = useState<CompanyProfile>(emptyProfile);
  const [companyId, setCompanyId] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastFetchStatus, setLastFetchStatus] = useState<number | null>(null);
  const [lastFetchError, setLastFetchError] = useState<string | null>(null);
  const [latestRefinement, setLatestRefinement] = useState<CompanyProfileRefinement | null>(null);
  const [refinementHistory, setRefinementHistory] = useState<CompanyProfileRefinement[]>([]);
  const [missingFieldAnswers, setMissingFieldAnswers] = useState<Record<string, string[]>>({});
  const [targetCustomerPanelOpen, setTargetCustomerPanelOpen] = useState(false);
  const [targetCustomerMessages, setTargetCustomerMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [targetCustomerInput, setTargetCustomerInput] = useState('');
  const [targetCustomerLoading, setTargetCustomerLoading] = useState(false);
  const [campaignPurposePanelOpen, setCampaignPurposePanelOpen] = useState(false);
  const [campaignPurposeMessages, setCampaignPurposeMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [campaignPurposeInput, setCampaignPurposeInput] = useState('');
  const [campaignPurposeLoading, setCampaignPurposeLoading] = useState(false);
  const [marketingIntelligenceLoading, setMarketingIntelligenceLoading] = useState(false);
  const [marketingIntelligencePanelOpen, setMarketingIntelligencePanelOpen] = useState(false);
  const [marketingIntelligenceMessages, setMarketingIntelligenceMessages] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([]);
  const [marketingIntelligenceInput, setMarketingIntelligenceInput] = useState('');
  const [marketingIntelligenceChatLoading, setMarketingIntelligenceChatLoading] = useState(false);

  const activeProfile = profile ?? draftProfile;

  useEffect(() => {
    if (!router.isReady) return;
    const queryCompanyId =
      typeof router.query.companyId === 'string' ? router.query.companyId : '';
    if (queryCompanyId) {
      setSelectedCompanyId(queryCompanyId);
      setCompanyId(queryCompanyId);
      setDraftProfile((prev) => ({ ...prev, company_id: queryCompanyId }));
    }
  }, [router.isReady, router.query.companyId]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    setCompanyId(selectedCompanyId);
    setDraftProfile((prev) => ({ ...prev, company_id: selectedCompanyId }));
  }, [selectedCompanyId]);

  useEffect(() => {
    if (selectedCompanyId || companies.length !== 1) return;
    const fallbackCompany = companies[0]?.company_id;
    if (!fallbackCompany) return;
    setSelectedCompanyId(fallbackCompany);
    setCompanyId(fallbackCompany);
    setDraftProfile((prev) => ({ ...prev, company_id: fallbackCompany }));
  }, [companies, selectedCompanyId, setSelectedCompanyId]);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        setIsLoading(true);
        if (!companyId) {
          setErrorMessage('Select a company to continue.');
          return;
        }
        const response = await fetchWithAuth(
          `/api/company-profile?companyId=${encodeURIComponent(companyId)}`
        );
        setLastFetchStatus(response.status);
        if (response.status === 404) {
          setProfile(null);
          setNotFound(true);
          return;
        }
        if (!response.ok) {
          let details = '';
          try {
            const errorBody = await response.json();
            details = errorBody?.error || errorBody?.details || '';
          } catch {
            details = '';
          }
          throw new Error(details || 'Failed to load company profile');
        }
        const data = await response.json();
        setProfile(data.profile || null);
        if (data.profile) {
          setDraftProfile(data.profile);
        }
        setNotFound(false);
        if (data.profile?.company_id) {
          setCompanyId(data.profile.company_id);
          localStorage.setItem('company_id', data.profile.company_id);
        }
      } catch (error) {
        console.error('Error loading company profile:', error);
        setLastFetchError((error as Error)?.message || 'Failed to load company profile');
        setErrorMessage('Failed to load company profile.');
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [companyId]);

  useEffect(() => {
    const loadRefinements = async () => {
      try {
        if (!companyId) return;
        const response = await fetchWithAuth(
          companyId
            ? `/api/company-profile/refinements?companyId=${encodeURIComponent(companyId)}`
            : '/api/company-profile/refinements'
        );
        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          console.warn('Failed to load profile refinements', errorBody?.error || response.status);
          return;
        }
        const data = await response.json();
        const refinements = data?.refinements || [];
        setRefinementHistory(refinements);
        if (refinements.length > 0) {
          setLatestRefinement(refinements[0]);
        }
      } catch (error) {
        console.warn('Failed to load profile refinements');
      }
    };
    loadRefinements();
  }, [companyId]);

  const updateActiveProfile = (next: CompanyProfile) => {
    if (profile) {
      setProfile(next);
    } else {
      setDraftProfile(next);
    }
  };

  const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      throw new Error('Not authenticated');
    }
    return fetch(input, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  };

  const handleChange = (field: keyof CompanyProfile, value: string) => {
    updateActiveProfile({ ...activeProfile, [field]: value });
  };

  const updateOtherSocial = (index: number, field: 'label' | 'url', value: string) => {
    const existing = Array.isArray(activeProfile.other_social_links)
      ? [...activeProfile.other_social_links]
      : [];
    const current = existing[index] || {};
    existing[index] = { ...current, [field]: value };
    updateActiveProfile({ ...activeProfile, other_social_links: existing });
  };

  const addOtherSocial = () => {
    updateActiveProfile({
      ...activeProfile,
      other_social_links: [...(activeProfile.other_social_links || []), { label: '', url: '' }],
    });
  };

  const removeOtherSocial = (index: number) => {
    updateActiveProfile({
      ...activeProfile,
      other_social_links: (activeProfile.other_social_links || []).filter((_, i) => i !== index),
    });
  };

  const handleMissingAnswer = (field: string, values: string[]) => {
    const normalized = field.toLowerCase().replace(/\s+/g, '_');
    const updated: CompanyProfile = { ...activeProfile };

    if (normalized.includes('industry')) {
      updated.industry_list = values;
      updated.industry = values.join(', ');
    } else if (normalized.includes('category')) {
      updated.category_list = values;
      updated.category = values.join(', ');
    } else if (normalized.includes('geography')) {
      updated.geography_list = values;
      updated.geography = values.join(', ');
    } else if (normalized.includes('competitor')) {
      updated.competitors_list = values;
      updated.competitors = values.join(', ');
    } else if (normalized.includes('content_theme')) {
      updated.content_themes_list = values;
      updated.content_themes = values.join(', ');
    } else if (normalized.includes('product')) {
      updated.products_services_list = values;
      updated.products_services = values.join(', ');
    } else if (normalized.includes('target_audience')) {
      updated.target_audience_list = values;
      updated.target_audience = values.join(', ');
    } else if (normalized.includes('goals')) {
      updated.goals_list = values;
      updated.goals = values.join(', ');
    } else if (normalized.includes('brand_voice')) {
      updated.brand_voice_list = values;
      updated.brand_voice = values.join(', ');
    } else if (normalized.includes('company_name')) {
      updated.name = values[0] || updated.name;
    } else if (normalized.includes('unique_value')) {
      updated.unique_value = values[0] || updated.unique_value;
    }

    setMissingFieldAnswers((prev) => ({ ...prev, [field]: values }));
    updateActiveProfile(updated);
  };

  const saveProfile = async () => {
    try {
      setIsSaving(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      if (!companyId) {
        setErrorMessage('Select a company to continue.');
        return;
      }
      const payload = {
        ...activeProfile,
        companyId: companyId || activeProfile.company_id,
        company_id: companyId || activeProfile.company_id,
        industry_list: activeProfile.industry_list ?? splitToList(activeProfile.industry),
        category_list: activeProfile.category_list ?? splitToList(activeProfile.category),
        geography_list: activeProfile.geography_list ?? splitToList(activeProfile.geography),
        competitors_list: activeProfile.competitors_list ?? splitToList(activeProfile.competitors),
        content_themes_list: activeProfile.content_themes_list ?? splitToList(activeProfile.content_themes),
        products_services_list: activeProfile.products_services_list ?? splitToList(activeProfile.products_services),
        target_audience_list: activeProfile.target_audience_list ?? splitToList(activeProfile.target_audience),
        goals_list: activeProfile.goals_list ?? splitToList(activeProfile.goals),
        brand_voice_list: activeProfile.brand_voice_list ?? splitToList(activeProfile.brand_voice),
        social_profiles: buildSocialProfilesFromScalars(activeProfile),
      };
      const response = await fetchWithAuth('/api/company-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error || errorBody?.details || 'Failed to save profile');
      }
      const data = await response.json();
      setProfile(data.profile || activeProfile);
      setDraftProfile(data.profile || activeProfile);
      if (data.profile?.company_id) {
        setCompanyId(data.profile.company_id);
        setSelectedCompanyId(data.profile.company_id);
        console.log('Profile loaded:', data.profile.company_id);
      }
      setNotFound(false);
      setSuccessMessage('Company profile saved.');
    } catch (error) {
      console.error('Error saving company profile:', error);
      setErrorMessage('Failed to save company profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const refineProfile = async () => {
    try {
      setIsRefining(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      if (!companyId) {
        setErrorMessage('Select a company to continue.');
        return;
      }
      const payload = {
        ...activeProfile,
        companyId: companyId || activeProfile.company_id,
        company_id: companyId || activeProfile.company_id,
        industry_list: activeProfile.industry_list ?? splitToList(activeProfile.industry),
        category_list: activeProfile.category_list ?? splitToList(activeProfile.category),
        geography_list: activeProfile.geography_list ?? splitToList(activeProfile.geography),
        competitors_list: activeProfile.competitors_list ?? splitToList(activeProfile.competitors),
        content_themes_list: activeProfile.content_themes_list ?? splitToList(activeProfile.content_themes),
        products_services_list: activeProfile.products_services_list ?? splitToList(activeProfile.products_services),
        target_audience_list: activeProfile.target_audience_list ?? splitToList(activeProfile.target_audience),
        goals_list: activeProfile.goals_list ?? splitToList(activeProfile.goals),
        brand_voice_list: activeProfile.brand_voice_list ?? splitToList(activeProfile.brand_voice),
        social_profiles: buildSocialProfilesFromScalars(activeProfile),
      };
      const response = await fetchWithAuth('/api/company-profile/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error || errorBody?.details || 'Failed to refine profile');
      }
      const data = await response.json();
      setProfile(data.profile || activeProfile);
      setDraftProfile(data.profile || activeProfile);
      if (data.profile?.company_id) {
        setCompanyId(data.profile.company_id);
        setSelectedCompanyId(data.profile.company_id);
        console.log('Profile loaded:', data.profile.company_id);
      }
      setNotFound(false);
      setSuccessMessage('Company profile refined.');
      if (data?.refinement) {
        setLatestRefinement(data.refinement);
        setRefinementHistory((prev) => [data.refinement, ...prev]);
      }
    } catch (error) {
      console.error('Error refining company profile:', error);
      setErrorMessage('Failed to refine company profile.');
    } finally {
      setIsRefining(false);
    }
  };

  const sendTargetCustomerMessage = async (userContent?: string) => {
    const content = (userContent ?? targetCustomerInput).trim();
    const isInitial = targetCustomerMessages.length === 0 && !content;
    if (!content && !isInitial) return;
    if (!companyId) return;

    const nextMessages = isInitial
      ? []
      : [...targetCustomerMessages, { role: 'user' as const, content }];
    if (!isInitial && content) setTargetCustomerMessages(nextMessages);
    setTargetCustomerInput('');
    setTargetCustomerLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetchWithAuth(
        `/api/company-profile/define-target-customer?companyId=${encodeURIComponent(companyId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            company_id: companyId,
            conversation: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          }),
        }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || 'Request failed');
      }
      const data = await response.json();
      if (data.done && data.structuredFields) {
        const updated = {
          ...activeProfile,
          ...data.structuredFields,
          ...(data.campaign_purpose_intent != null ? { campaign_purpose_intent: data.campaign_purpose_intent } : {}),
        };
        updateActiveProfile(updated);
        setTargetCustomerPanelOpen(false);
        setTargetCustomerMessages([]);
        setSuccessMessage('Target customer fields updated. Click Save Profile to lock them.');
      } else if (data.nextQuestion) {
        setTargetCustomerMessages((prev) =>
          isInitial ? [{ role: 'assistant' as const, content: data.nextQuestion }] : [...prev, { role: 'assistant' as const, content: data.nextQuestion }]
        );
      }
    } catch (e) {
      setErrorMessage((e as Error).message || 'Define target customer failed');
    } finally {
      setTargetCustomerLoading(false);
    }
  };

  const openTargetCustomerPanel = () => {
    setTargetCustomerMessages([]);
    setTargetCustomerInput('');
    setTargetCustomerPanelOpen(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setTargetCustomerLoading(true);
    sendTargetCustomerMessage();
  };

  const sendCampaignPurposeMessage = async (userContent?: string) => {
    const content = (userContent ?? campaignPurposeInput).trim();
    const isInitial = campaignPurposeMessages.length === 0 && !content;
    if (!content && !isInitial) return;
    if (!companyId) return;

    const nextMessages = isInitial
      ? []
      : [...campaignPurposeMessages, { role: 'user' as const, content }];
    if (!isInitial && content) setCampaignPurposeMessages(nextMessages);
    setCampaignPurposeInput('');
    setCampaignPurposeLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetchWithAuth(
        `/api/company-profile/define-campaign-purpose?companyId=${encodeURIComponent(companyId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            company_id: companyId,
            conversation: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          }),
        }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || 'Request failed');
      }
      const data = await response.json();
      if (data.done && data.campaign_purpose_intent) {
        updateActiveProfile({ ...activeProfile, campaign_purpose_intent: data.campaign_purpose_intent });
        setCampaignPurposePanelOpen(false);
        setCampaignPurposeMessages([]);
        setSuccessMessage('Campaign purpose updated. Click Save Profile to lock it.');
      } else if (data.nextQuestion) {
        setCampaignPurposeMessages((prev) =>
          isInitial ? [{ role: 'assistant' as const, content: data.nextQuestion }] : [...prev, { role: 'assistant' as const, content: data.nextQuestion }]
        );
      }
    } catch (e) {
      setErrorMessage((e as Error).message || 'Define campaign purpose failed');
    } finally {
      setCampaignPurposeLoading(false);
    }
  };

  const openCampaignPurposePanel = () => {
    setCampaignPurposeMessages([]);
    setCampaignPurposeInput('');
    setCampaignPurposePanelOpen(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setCampaignPurposeLoading(true);
    sendCampaignPurposeMessage();
  };

  const sendMarketingIntelligenceMessage = async (userContent?: string) => {
    const content = (userContent ?? marketingIntelligenceInput).trim();
    const isInitial = marketingIntelligenceMessages.length === 0 && !content;
    if (!content && !isInitial) return;
    if (!companyId) return;

    const nextMessages = isInitial
      ? []
      : [...marketingIntelligenceMessages, { role: 'user' as const, content }];
    if (!isInitial && content) setMarketingIntelligenceMessages(nextMessages);
    setMarketingIntelligenceInput('');
    setMarketingIntelligenceChatLoading(true);
    setErrorMessage(null);
    try {
      const currentFields = {
        marketing_channels: activeProfile.marketing_channels ?? '',
        content_strategy: activeProfile.content_strategy ?? '',
        campaign_focus: activeProfile.campaign_focus ?? '',
        key_messages: activeProfile.key_messages ?? '',
        brand_positioning: activeProfile.brand_positioning ?? '',
        competitive_advantages: activeProfile.competitive_advantages ?? '',
        growth_priorities: activeProfile.growth_priorities ?? '',
      };
      const response = await fetchWithAuth(
        `/api/company-profile/define-marketing-intelligence?companyId=${encodeURIComponent(companyId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            company_id: companyId,
            conversation: nextMessages.map((m) => ({ role: m.role, content: m.content })),
            currentFields,
          }),
        }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || 'Request failed');
      }
      const data = await response.json();
      if (data.done && data.structuredFields) {
        const updated = { ...activeProfile, ...data.structuredFields };
        updateActiveProfile(updated);
        setMarketingIntelligencePanelOpen(false);
        setMarketingIntelligenceMessages([]);
        setSuccessMessage('Marketing intelligence updated. Click Save Profile to lock these fields.');
      } else if (data.nextQuestion) {
        setMarketingIntelligenceMessages((prev) =>
          isInitial
            ? [{ role: 'assistant' as const, content: data.nextQuestion }]
            : [...prev, { role: 'assistant' as const, content: data.nextQuestion }]
        );
      }
    } catch (e) {
      setErrorMessage((e as Error).message || 'Define marketing intelligence failed');
    } finally {
      setMarketingIntelligenceChatLoading(false);
    }
  };

  const openMarketingIntelligencePanel = () => {
    setMarketingIntelligenceMessages([]);
    setMarketingIntelligenceInput('');
    setMarketingIntelligencePanelOpen(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setMarketingIntelligenceChatLoading(true);
    sendMarketingIntelligenceMessage();
  };

  const generateMarketingIntelligence = async () => {
    if (!companyId) return;
    setMarketingIntelligenceLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const response = await fetchWithAuth(
        `/api/company-profile/generate-marketing-intelligence?companyId=${encodeURIComponent(companyId)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, company_id: companyId }) }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || 'Generate failed');
      }
      const data = await response.json();
      const structuredFields = data.structuredFields || {};
      updateActiveProfile({ ...activeProfile, ...structuredFields });
      setSuccessMessage('Marketing intelligence generated. Review, edit if needed, then click Save Profile to persist and lock.');
    } catch (e) {
      setErrorMessage((e as Error).message || 'Failed to generate marketing intelligence');
    } finally {
      setMarketingIntelligenceLoading(false);
    }
  };

  const lastRefined = activeProfile.last_refined_at
    ? new Date(activeProfile.last_refined_at).toLocaleString()
    : 'Never';

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-4xl mx-auto bg-white shadow rounded-lg p-6 mt-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Company Profile</h1>
            <p className="text-sm text-gray-600">
              Keep your company profile current for trend relevance and recommendations.
            </p>
          </div>
          <div className="text-right text-sm text-gray-600">
            <div>Last refined: {lastRefined}</div>
            <div>
              Confidence: {activeProfile.overall_confidence ?? activeProfile.confidence_score ?? 0}%
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm p-3">
            {errorMessage}
          </div>
        )}
        {notFound && (
          <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm p-3">
            Company profile not found. Please create one.
          </div>
        )}
        {successMessage && (
          <div className="mb-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm p-3">
            {successMessage}
          </div>
        )}

        {latestRefinement && (
          <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900 space-y-3">
            <div className="font-semibold">Latest Refinement Insights</div>
            {latestRefinement.changed_fields && latestRefinement.changed_fields.length > 0 ? (
              <div>
                <div className="text-xs uppercase text-indigo-700 mb-2">Fields Updated</div>
                <ul className="list-disc list-inside space-y-1">
                  {latestRefinement.changed_fields.map((field) => (
                    <li key={field.field}>
                      <span className="font-medium">{field.field}</span> → {String(field.after)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-xs text-indigo-700">
                No field changes detected in the latest refinement.
              </div>
            )}
            {latestRefinement.source_summaries && latestRefinement.source_summaries.length > 0 && (
              <details className="bg-white rounded border border-indigo-200 p-3">
                <summary className="cursor-pointer text-sm font-medium">Sources used</summary>
                <div className="mt-2 space-y-2 text-xs text-gray-700">
                  {Array.from(
                    new Map(
                      latestRefinement.source_summaries.map((source) => [source.url, source])
                    ).values()
                  ).map((source, index) => (
                    <div key={`website_page-${source.url}-${index}`}>
                      <div className="font-semibold">{source.label}</div>
                      <div className="text-gray-500">{source.url}</div>
                      <div className="mt-1">{source.summary}</div>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {latestRefinement.missing_fields_questions &&
              latestRefinement.missing_fields_questions.length > 0 && (
                <details className="bg-white rounded border border-indigo-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium">Missing fields</summary>
                  <div className="mt-2 space-y-3 text-xs text-gray-700">
                    {latestRefinement.missing_fields_questions.map((question, index) => (
                      <div key={`missing-${question.field}-${index}`} className="space-y-1">
                        <div className="font-semibold">{question.field}</div>
                        <div>{question.question}</div>
                        <div className="text-gray-500">
                          Options: {question.options?.join(', ') || 'N/A'}
                        </div>
                        {question.allow_multiple && (
                          <div className="text-gray-400">Multiple selections allowed</div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
          </div>
        )}

        {isLoading ? (
          <div className="text-sm text-gray-500">Loading profile...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Company</label>
                <select
                  value={companyId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedCompanyId(nextId);
                    setCompanyId(nextId);
                    updateActiveProfile({ ...activeProfile, company_id: nextId });
                  }}
                  disabled={!isAdmin || isCompanyLoading}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100"
                >
                  <option value="">Select company</option>
                  {companies.map((company) => (
                    <option key={company.company_id} value={company.company_id}>
                      {company.name}
                    </option>
                  ))}
                </select>
                {!isAdmin && selectedCompanyName && (
                  <div className="text-xs text-gray-500 mt-1">Company locked for your role.</div>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Company Name</label>
                <input
                  value={activeProfile.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Industry</label>
                <input
                  value={activeProfile.industry || ''}
                  onChange={(e) => handleChange('industry', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <div className="text-xs text-gray-500 mt-1">
                  Extracted: {joinList(activeProfile.industry_list, activeProfile.industry)}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Category</label>
                <input
                  value={activeProfile.category || ''}
                  onChange={(e) => handleChange('category', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <div className="text-xs text-gray-500 mt-1">
                  Extracted: {joinList(activeProfile.category_list, activeProfile.category)}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Website URL</label>
                <input
                  value={activeProfile.website_url || ''}
                  onChange={(e) => handleChange('website_url', e.target.value)}
                  placeholder="https://example.com"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  AI refinement can use this website to improve profile accuracy.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">LinkedIn</label>
                <input
                  value={activeProfile.linkedin_url || ''}
                  onChange={(e) => handleChange('linkedin_url', e.target.value)}
                  placeholder="https://linkedin.com/company/yourpage"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Facebook</label>
                <input
                  value={activeProfile.facebook_url || ''}
                  onChange={(e) => handleChange('facebook_url', e.target.value)}
                  placeholder="https://facebook.com/yourpage"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Instagram</label>
                <input
                  value={activeProfile.instagram_url || ''}
                  onChange={(e) => handleChange('instagram_url', e.target.value)}
                  placeholder="https://instagram.com/yourhandle"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">X (Twitter)</label>
                <input
                  value={activeProfile.x_url || ''}
                  onChange={(e) => handleChange('x_url', e.target.value)}
                  placeholder="https://x.com/yourhandle"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">YouTube</label>
                <input
                  value={activeProfile.youtube_url || ''}
                  onChange={(e) => handleChange('youtube_url', e.target.value)}
                  placeholder="https://youtube.com/@yourchannel"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">TikTok</label>
                <input
                  value={activeProfile.tiktok_url || ''}
                  onChange={(e) => handleChange('tiktok_url', e.target.value)}
                  placeholder="https://tiktok.com/@yourhandle"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Reddit</label>
                <input
                  value={activeProfile.reddit_url || ''}
                  onChange={(e) => handleChange('reddit_url', e.target.value)}
                  placeholder="https://reddit.com/r/yourcommunity"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Blog / Website Page</label>
                <input
                  value={activeProfile.blog_url || ''}
                  onChange={(e) => handleChange('blog_url', e.target.value)}
                  placeholder="https://example.com/blog"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Geography</label>
                <input
                  value={activeProfile.geography || ''}
                  onChange={(e) => handleChange('geography', e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <div className="text-xs text-gray-500 mt-1">
                  Extracted: {joinList(activeProfile.geography_list, activeProfile.geography)}
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">Additional Social Profiles</h3>
                <button
                  type="button"
                  onClick={addOtherSocial}
                  className="px-3 py-1 bg-gray-100 text-gray-800 rounded text-xs"
                >
                  + Add profile
                </button>
              </div>
              {(activeProfile.other_social_links || []).length === 0 && (
                <div className="text-xs text-gray-500">No additional profiles added.</div>
              )}
              <div className="space-y-2">
                {(activeProfile.other_social_links || []).map((item, index) => (
                  <div key={`social-${index}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    <input
                      value={item?.label || ''}
                      onChange={(e) => updateOtherSocial(index, 'label', e.target.value)}
                      placeholder="Label (e.g. Pinterest)"
                      className="md:col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                    <input
                      value={item?.url || ''}
                      onChange={(e) => updateOtherSocial(index, 'url', e.target.value)}
                      placeholder="https://..."
                      className="md:col-span-3 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => removeOtherSocial(index)}
                      className="md:col-span-1 text-xs text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Products & Services</label>
              <textarea
                value={activeProfile.products_services || ''}
                onChange={(e) => handleChange('products_services', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">
                Extracted: {joinList(activeProfile.products_services_list, activeProfile.products_services)}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Target Audience</label>
              <textarea
                value={activeProfile.target_audience || ''}
                onChange={(e) => handleChange('target_audience', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">
                Extracted: {joinList(activeProfile.target_audience_list, activeProfile.target_audience)}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Brand Voice</label>
              <textarea
                value={activeProfile.brand_voice || ''}
                onChange={(e) => handleChange('brand_voice', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">
                Extracted: {joinList(activeProfile.brand_voice_list, activeProfile.brand_voice)}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Goals</label>
              <textarea
                value={activeProfile.goals || ''}
                onChange={(e) => handleChange('goals', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">
                Extracted: {joinList(activeProfile.goals_list, activeProfile.goals)}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Competitors</label>
              <textarea
                value={activeProfile.competitors || ''}
                onChange={(e) => handleChange('competitors', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">
                Extracted: {joinList(activeProfile.competitors_list, activeProfile.competitors)}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Unique Value</label>
              <textarea
                value={activeProfile.unique_value || ''}
                onChange={(e) => handleChange('unique_value', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Content Themes</label>
              <textarea
                value={activeProfile.content_themes || ''}
                onChange={(e) => handleChange('content_themes', e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">
                Extracted: {joinList(activeProfile.content_themes_list, activeProfile.content_themes)}
              </div>
            </div>

            <div className="border-t pt-6 mt-6">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Commercial Strategy</h3>
              <p className="text-sm text-gray-600 mb-4">
                Define your target customer and commercial model. These fields are locked from AI overwrite once you save.
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={openTargetCustomerPanel}
                  className="px-4 py-2 bg-indigo-100 text-indigo-800 rounded-lg text-sm font-medium hover:bg-indigo-200"
                >
                  Define Target Customer
                </button>
              </div>
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-800 mb-2">Campaign Purpose & Strategic Intent</h4>
                {activeProfile.campaign_purpose_intent ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-700">Primary Objective:</span>{' '}
                      {activeProfile.campaign_purpose_intent.primary_objective || '—'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Campaign Intent:</span>{' '}
                      {activeProfile.campaign_purpose_intent.campaign_intent || '—'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Monetization Intent:</span>{' '}
                      {activeProfile.campaign_purpose_intent.monetization_intent || '—'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Dominant Problems:</span>{' '}
                      {(activeProfile.campaign_purpose_intent.dominant_problem_domains ?? []).length > 0
                        ? activeProfile.campaign_purpose_intent.dominant_problem_domains!.join(', ')
                        : '—'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Positioning Angle:</span>{' '}
                      {activeProfile.campaign_purpose_intent.brand_positioning_angle || '—'}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openCampaignPurposePanel}
                    className="px-4 py-2 bg-amber-100 text-amber-800 rounded-lg text-sm font-medium hover:bg-amber-200"
                  >
                    Define Strategic Purpose
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Target customer segment</label>
                  <input
                    value={activeProfile.target_customer_segment || ''}
                    onChange={(e) => handleChange('target_customer_segment', e.target.value)}
                    placeholder="e.g. SMB, enterprise"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Ideal customer profile</label>
                  <textarea
                    value={activeProfile.ideal_customer_profile || ''}
                    onChange={(e) => handleChange('ideal_customer_profile', e.target.value)}
                    placeholder="1–2 sentences"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Pricing model</label>
                  <input
                    value={activeProfile.pricing_model || ''}
                    onChange={(e) => handleChange('pricing_model', e.target.value)}
                    placeholder="e.g. subscription, usage-based"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Sales motion</label>
                  <input
                    value={activeProfile.sales_motion || ''}
                    onChange={(e) => handleChange('sales_motion', e.target.value)}
                    placeholder="e.g. self-serve, sales-led"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Avg deal size</label>
                  <input
                    value={activeProfile.avg_deal_size || ''}
                    onChange={(e) => handleChange('avg_deal_size', e.target.value)}
                    placeholder="e.g. $5k, $50k"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Sales cycle</label>
                  <input
                    value={activeProfile.sales_cycle || ''}
                    onChange={(e) => handleChange('sales_cycle', e.target.value)}
                    placeholder="e.g. 2 weeks, 3 months"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Key metrics</label>
                  <input
                    value={activeProfile.key_metrics || ''}
                    onChange={(e) => handleChange('key_metrics', e.target.value)}
                    placeholder="e.g. MRR, CAC, LTV"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {activeProfile.last_edited_by === 'user' && (
                <p className="text-xs text-gray-500 mt-2">
                  Last edited by you; refinement will not overwrite locked commercial fields.
                </p>
              )}
            </div>

            <div className="border-t pt-6 mt-6">
              <h3 className="text-base font-semibold text-gray-900 mb-2">Marketing Intelligence</h3>
              <p className="text-sm text-gray-600 mb-4">
                AI-generated marketing insights from your profile and commercial strategy. Use <strong>Refine with AI</strong> to answer guided questions in a chat, or <strong>Generate Marketing Intelligence</strong> to fill from profile in one shot. Save to persist and lock from refinement overwrite.
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={openMarketingIntelligencePanel}
                  disabled={marketingIntelligenceLoading || marketingIntelligenceChatLoading}
                  className="px-4 py-2 bg-emerald-100 text-emerald-800 rounded-lg text-sm font-medium hover:bg-emerald-200 disabled:opacity-50"
                >
                  Refine with AI
                </button>
                <button
                  type="button"
                  onClick={generateMarketingIntelligence}
                  disabled={marketingIntelligenceLoading || marketingIntelligenceChatLoading}
                  className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                >
                  {marketingIntelligenceLoading ? 'Generating...' : 'Generate Marketing Intelligence'}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Marketing channels</label>
                  <input
                    value={activeProfile.marketing_channels || ''}
                    onChange={(e) => handleChange('marketing_channels', e.target.value)}
                    placeholder="e.g. social, email, events"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Content strategy</label>
                  <textarea
                    value={activeProfile.content_strategy || ''}
                    onChange={(e) => handleChange('content_strategy', e.target.value)}
                    placeholder="High-level content approach"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Campaign focus</label>
                  <input
                    value={activeProfile.campaign_focus || ''}
                    onChange={(e) => handleChange('campaign_focus', e.target.value)}
                    placeholder="What campaigns typically focus on"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Key messages</label>
                  <textarea
                    value={activeProfile.key_messages || ''}
                    onChange={(e) => handleChange('key_messages', e.target.value)}
                    placeholder="Core messages to convey"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Brand positioning</label>
                  <textarea
                    value={activeProfile.brand_positioning || ''}
                    onChange={(e) => handleChange('brand_positioning', e.target.value)}
                    placeholder="How the brand wants to be perceived"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Competitive advantages</label>
                  <textarea
                    value={activeProfile.competitive_advantages || ''}
                    onChange={(e) => handleChange('competitive_advantages', e.target.value)}
                    placeholder="Differentiators vs competitors"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Growth priorities</label>
                  <textarea
                    value={activeProfile.growth_priorities || ''}
                    onChange={(e) => handleChange('growth_priorities', e.target.value)}
                    placeholder="Marketing/growth priorities"
                    rows={2}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>

            {latestRefinement?.missing_fields_questions &&
              latestRefinement.missing_fields_questions.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                  <div className="text-sm font-semibold text-amber-900">
                    Help us improve your company profile
                  </div>
                  {latestRefinement.missing_fields_questions.map((question, index) => {
                    const selected = missingFieldAnswers[question.field] || [];
                    return (
                      <div key={`${question.field}-${index}`} className="space-y-1">
                        <label className="text-xs font-medium text-amber-900">
                          {question.question}
                        </label>
                        {question.allow_multiple ? (
                          <select
                            multiple
                            value={selected}
                            onChange={(event) => {
                              const values = Array.from(event.target.selectedOptions).map(
                                (option) => option.value
                              );
                              handleMissingAnswer(question.field, values);
                            }}
                            className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white"
                          >
                            {question.options?.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <select
                            value={selected[0] || ''}
                            onChange={(event) =>
                              handleMissingAnswer(
                                question.field,
                                event.target.value ? [event.target.value] : []
                              )
                            }
                            className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white"
                          >
                            <option value="">Select an option</option>
                            {question.options?.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

            {activeProfile.social_profiles && activeProfile.social_profiles.length > 0 && (
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm font-semibold text-gray-800 mb-2">Discovered Social Profiles</div>
                <ul className="text-xs text-gray-600 space-y-1">
                  {activeProfile.social_profiles.map((entry, index) => (
                    <li key={`${entry.platform}-${entry.url}-${index}`}>
                      <a
                        href={entry.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 hover:underline"
                      >
                        {entry.platform}: {entry.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={saveProfile}
                disabled={isSaving || isRefining}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save Profile'}
              </button>
              <button
                onClick={refineProfile}
                disabled={isSaving || isRefining}
                className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {isRefining ? 'Refining...' : 'Refine with AI'}
              </button>
            </div>
          </div>
        )}
      </div>

      {targetCustomerPanelOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30" onClick={() => setTargetCustomerPanelOpen(false)} aria-hidden />
          <div className="relative ml-auto w-full max-w-md bg-white shadow-xl flex flex-col h-full">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Define Target Customer</h3>
              <button
                type="button"
                onClick={() => setTargetCustomerPanelOpen(false)}
                className="p-2 text-gray-500 hover:text-gray-700 rounded"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {targetCustomerMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-3 text-sm ${
                    msg.role === 'user'
                      ? 'ml-8 bg-indigo-100 text-indigo-900'
                      : 'mr-8 bg-gray-100 text-gray-900'
                  }`}
                >
                  {msg.content}
                </div>
              ))}
              {targetCustomerLoading && (
                <div className="mr-8 rounded-lg p-3 text-sm bg-gray-100 text-gray-600">Thinking...</div>
              )}
            </div>
            <div className="p-4 border-t">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendTargetCustomerMessage();
                }}
                className="flex gap-2 items-center"
              >
                <input
                  type="text"
                  value={targetCustomerInput}
                  onChange={(e) => setTargetCustomerInput(e.target.value)}
                  placeholder="Type your answer..."
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  disabled={targetCustomerLoading}
                />
                <ChatVoiceButton
                  onTranscription={(text) => setTargetCustomerInput(text)}
                  disabled={targetCustomerLoading}
                  context="company-profile"
                  title={undefined}
                />
                <button
                  type="submit"
                  disabled={targetCustomerLoading}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {campaignPurposePanelOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30" onClick={() => setCampaignPurposePanelOpen(false)} aria-hidden />
          <div className="relative ml-auto w-full max-w-md bg-white shadow-xl flex flex-col h-full">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Campaign Purpose & Strategic Intent</h3>
              <button
                type="button"
                onClick={() => setCampaignPurposePanelOpen(false)}
                className="p-2 text-gray-500 hover:text-gray-700 rounded"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {campaignPurposeMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-3 text-sm ${
                    msg.role === 'user'
                      ? 'ml-8 bg-amber-100 text-amber-900'
                      : 'mr-8 bg-gray-100 text-gray-900'
                  }`}
                >
                  {msg.content}
                </div>
              ))}
              {campaignPurposeLoading && (
                <div className="mr-8 rounded-lg p-3 text-sm bg-gray-100 text-gray-600">Thinking...</div>
              )}
            </div>
            <div className="p-4 border-t">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendCampaignPurposeMessage();
                }}
                className="flex gap-2 items-center"
              >
                <input
                  type="text"
                  value={campaignPurposeInput}
                  onChange={(e) => setCampaignPurposeInput(e.target.value)}
                  placeholder="Type your answer..."
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  disabled={campaignPurposeLoading}
                />
                <ChatVoiceButton
                  onTranscription={(text) => setCampaignPurposeInput(text)}
                  disabled={campaignPurposeLoading}
                  context="company-profile"
                  title={undefined}
                />
                <button
                  type="submit"
                  disabled={campaignPurposeLoading}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {marketingIntelligencePanelOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setMarketingIntelligencePanelOpen(false)}
            aria-hidden
          />
          <div className="relative ml-auto w-full max-w-md bg-white shadow-xl flex flex-col h-full">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Refine Marketing Intelligence</h3>
              <button
                type="button"
                onClick={() => setMarketingIntelligencePanelOpen(false)}
                className="p-2 text-gray-500 hover:text-gray-700 rounded"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {marketingIntelligenceMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-3 text-sm ${
                    msg.role === 'user'
                      ? 'ml-8 bg-emerald-100 text-emerald-900'
                      : 'mr-8 bg-gray-100 text-gray-900'
                  }`}
                >
                  {msg.content}
                </div>
              ))}
              {marketingIntelligenceChatLoading && (
                <div className="mr-8 rounded-lg p-3 text-sm bg-gray-100 text-gray-600">
                  Thinking...
                </div>
              )}
            </div>
            <div className="p-4 border-t">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMarketingIntelligenceMessage();
                }}
                className="flex gap-2 items-center"
              >
                <input
                  type="text"
                  value={marketingIntelligenceInput}
                  onChange={(e) => setMarketingIntelligenceInput(e.target.value)}
                  placeholder="Type your answer..."
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  disabled={marketingIntelligenceChatLoading}
                />
                <ChatVoiceButton
                  onTranscription={(text) => setMarketingIntelligenceInput(text)}
                  disabled={marketingIntelligenceChatLoading}
                  context="company-profile"
                />
                <button
                  type="submit"
                  disabled={marketingIntelligenceChatLoading}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {refinementHistory.length > 0 && (
        <div className="max-w-4xl mx-auto bg-white shadow rounded-lg p-6 mt-6 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Refinement History</h2>
          <div className="space-y-2 text-sm">
            {refinementHistory.map((entry) => (
              <div key={entry.id || entry.created_at} className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">
                  {entry.created_at ? new Date(entry.created_at).toLocaleString() : 'Unknown time'}
                </div>
                <div className="mt-1">
                  {(entry.changed_fields || []).length} fields updated
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
