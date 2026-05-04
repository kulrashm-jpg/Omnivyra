import { apiFetch } from '@/lib/apiFetch';
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import ChatVoiceButton from '../components/ChatVoiceButton';
import AIGenerationProgress from '../components/AIGenerationProgress';
import { getAuthToken } from '../utils/getAuthToken';
import {
  type CompanyProfile,
  type CompanyProfileRefinement,
  emptyProfile,
  splitToList,
  joinList,
  buildSocialProfilesFromScalars,
} from '../pages/company-profile.types';

export function useCompanyProfileState() {
  const router = useRouter();
  const {
    user,
    userRole,
    companies,
    selectedCompanyId,
    selectedCompanyName,
    setSelectedCompanyId,
    isLoading: isCompanyLoading,
    isAuthenticated,
    refreshCompanies,
  } = useCompanyContext();
  const isAdmin = useMemo(() => user?.role === 'admin', [user]);
  const isContentArchitect = userRole === 'CONTENT_ARCHITECT';
  const isCompanyAdmin = userRole === 'COMPANY_ADMIN';
  /** Only Super Admin and Content Architect can create companies; Company Admin sees only their company. */
  const canCreateCompany = userRole === 'SUPER_ADMIN' || userRole === 'CONTENT_ARCHITECT';
  /** Show company search and "Create new company" only for roles that manage multiple / new companies. */
  const canSelectMultipleCompanies = canCreateCompany;
  const canViewStrategicSections = useMemo(
    () =>
      userRole === 'SUPER_ADMIN' ||
      userRole === 'CAMPAIGN_ARCHITECT' ||
      userRole === 'CONTENT_ARCHITECT',
    [userRole]
  );
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [draftProfile, setDraftProfile] = useState<CompanyProfile>(emptyProfile);
  const [companyId, setCompanyId] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [refineStep, setRefineStep] = useState(0); // 0 = idle
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [overallProfileCompletion, setOverallProfileCompletion] = useState<number | null>(null);
  const [problemTransformationCompletion, setProblemTransformationCompletion] = useState<number | null>(null);
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
  const [problemTransformationPanelOpen, setProblemTransformationPanelOpen] = useState(false);
  const [problemTransformationQuestions, setProblemTransformationQuestions] = useState<string[]>([]);
  const [problemTransformationAnswers, setProblemTransformationAnswers] = useState<string[]>([]);
  const [problemTransformationLoading, setProblemTransformationLoading] = useState(false);
  const [problemTransformationInferPanelOpen, setProblemTransformationInferPanelOpen] = useState(false);
  const [problemTransformationInferMessages, setProblemTransformationInferMessages] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([]);
  const [problemTransformationInferInput, setProblemTransformationInferInput] = useState('');
  const [problemTransformationInferLoading, setProblemTransformationInferLoading] = useState(false);
  const [pendingProblemTransformationUpdates, setPendingProblemTransformationUpdates] = useState<{
    core_problem_statement?: string | null;
    pain_symptoms?: string[];
    awareness_gap?: string | null;
    problem_impact?: string | null;
    life_with_problem?: string | null;
    life_after_solution?: string | null;
    desired_transformation?: string | null;
    transformation_mechanism?: string | null;
    authority_domains?: string[];
  } | null>(null);
  const [companySearchFilter, setCompanySearchFilter] = useState('');
  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);
  const [createCompanyForm, setCreateCompanyForm] = useState({ name: '', website: '', industry: '' });
  const [createCompanyLoading, setCreateCompanyLoading] = useState(false);
  const [companyIdCopied, setCompanyIdCopied] = useState(false);
  const [createCompanyError, setCreateCompanyError] = useState<string | null>(null);
  const [showCompanyFactReviewPrompt, setShowCompanyFactReviewPrompt] = useState(false);

  const filteredCompanies = useMemo(() => {
    const q = (companySearchFilter || '').trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.company_id || '').toLowerCase().includes(q)
    );
  }, [companies, companySearchFilter]);

  const activeProfile = profile ?? draftProfile;
  const companyFacts = activeProfile.report_settings?.company_facts ?? {};
  const profileReview = activeProfile.report_settings?.profile_review ?? {};
  const profileReviewDue = useMemo(() => {
    if (!profileReview?.next_confirmation_due_at) {
      return Boolean(profileReview?.pending_confirmation);
    }
    const dueAt = new Date(profileReview.next_confirmation_due_at).getTime();
    if (Number.isNaN(dueAt)) return Boolean(profileReview?.pending_confirmation);
    return Boolean(profileReview?.pending_confirmation) || dueAt <= Date.now();
  }, [profileReview]);

  useEffect(() => {
    if (!isCompanyAdmin) return;
    if (!companyId) return;
    if (!profileReviewDue) {
      setShowCompanyFactReviewPrompt(false);
      return;
    }
    setShowCompanyFactReviewPrompt(true);
  }, [isCompanyAdmin, companyId, profileReviewDue]);

  const handleCreateCompany = async () => {
    const { name, website } = createCompanyForm;
    if (!name?.trim() || !website?.trim()) {
      setCreateCompanyError('Name and website are required.');
      return;
    }
    setCreateCompanyError(null);
    setCreateCompanyLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createCompanyForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create company');
      }
      setShowCreateCompanyModal(false);
      setCreateCompanyForm({ name: '', website: '', industry: '' });
      await refreshCompanies();
      if (data?.company?.id) {
        setSelectedCompanyId(data.company.id);
        setCompanyId(data.company.id);
        router.replace(`/company-profile?companyId=${encodeURIComponent(data.company.id)}`);
      }
    } catch (e) {
      setCreateCompanyError((e as Error).message || 'Failed to create company');
    } finally {
      setCreateCompanyLoading(false);
    }
  };

  const notifyCompanyProfileUpdated = (updatedCompanyId: string) => {
    if (typeof window === 'undefined' || !updatedCompanyId) return;
    const updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(`company_profile_updated:${updatedCompanyId}`, updatedAt);
    } catch {
      // ignore storage quota/privacy errors
    }
    window.dispatchEvent(
      new CustomEvent('company-profile-updated', {
        detail: { companyId: updatedCompanyId, updatedAt },
      })
    );
  };

  useEffect(() => {
    if (!router.isReady) return;
    const queryCompanyId =
      typeof router.query.companyId === 'string' ? router.query.companyId : '';
    if (!queryCompanyId) return;
    // Only apply URL companyId if user has access (avoids 403 for Company Admin when URL has wrong/stale id)
    const hasAccess =
      canCreateCompany ||
      companies.some((c) => c.company_id === queryCompanyId);
    if (hasAccess) {
      setSelectedCompanyId(queryCompanyId);
      setCompanyId(queryCompanyId);
      setDraftProfile((prev) => ({ ...prev, company_id: queryCompanyId }));
    }
  }, [router.isReady, router.query.companyId, canCreateCompany, companies]);

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
        if (isCompanyLoading) return;
        if (!isAuthenticated) {
          setErrorMessage('Please sign in to view company profile.');
          return;
        }
        if (!companyId) {
          setErrorMessage('Select a company to continue.');
          return;
        }
        // Company Admin must only view their own company — never request another company
        if (isCompanyAdmin && companies.length > 0 && !companies.some((c) => c.company_id === companyId)) {
          const own = companies[0];
          if (own?.company_id) {
            setSelectedCompanyId(own.company_id);
            setCompanyId(own.company_id);
            setDraftProfile((prev) => ({ ...prev, company_id: own.company_id }));
          }
          setIsLoading(false);
          return;
        }
        const response = await apiFetch(
          `/api/company-profile?companyId=${encodeURIComponent(companyId)}&includeCompleteness=1`
        );
        setLastFetchStatus(response.status);
        if (response.status === 404) {
          setProfile(null);
          setOverallProfileCompletion(null);
          setProblemTransformationCompletion(null);
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
          const message = details === 'FORBIDDEN_ROLE'
            ? 'You don\'t have permission to view this company profile.'
            : (details || 'Failed to load company profile');
          setLastFetchError(message);
          setErrorMessage(message);
          return;
        }
        const data = await response.json();
        setProfile(data.profile || null);
        if (data.profile) {
          setDraftProfile(data.profile);
          setIsEditing(false); // existing profile loads in view mode
        } else {
          setIsEditing(true); // no profile yet — start in edit mode
        }
        setOverallProfileCompletion(data.overall_profile_completion ?? null);
        setProblemTransformationCompletion(data.problem_transformation_completion ?? null);
        setNotFound(false);
        setErrorMessage(null);
        setLastFetchError(null);
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
  }, [companyId, isAuthenticated, isCompanyLoading, isCompanyAdmin, companies]);

  useEffect(() => {
    const loadRefinements = async () => {
      try {
        if (isCompanyLoading || !isAuthenticated) return;
        if (!companyId) return;
        const response = await apiFetch(
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
  }, [companyId, isAuthenticated, isCompanyLoading]);

  const updateActiveProfile = (next: CompanyProfile) => {
    if (profile) {
      setProfile(next);
    } else {
      setDraftProfile(next);
    }
  };


  const handleChange = (field: keyof CompanyProfile, value: string) => {
    if (!isEditing) return;
    updateActiveProfile({ ...activeProfile, [field]: value });
  };

  const handleCompanyFactChange = (
    field: 'team_size' | 'founded_year' | 'revenue_range',
    value: string,
  ) => {
    if (!isEditing) return;
    updateActiveProfile({
      ...activeProfile,
      report_settings: {
        ...(activeProfile.report_settings || {}),
        company_facts: {
          ...(activeProfile.report_settings?.company_facts || {}),
          [field]: value,
        },
      },
    });
  };

  const normalizeUrlField = (field: keyof CompanyProfile, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      updateActiveProfile({ ...activeProfile, [field]: `https://${trimmed}` });
    }
  };

  const handleChangeArray = (field: 'pain_symptoms' | 'authority_domains', value: string) => {
    if (!isEditing) return;
    const arr = splitToList(value);
    updateActiveProfile({ ...activeProfile, [field]: arr });
  };

  const handleMarketPulseSettingChange = (
    field: 'business_model' | 'provider_type' | 'domain_role' | 'operating_model',
    value: string,
  ) => {
    if (!isEditing) return;
    updateActiveProfile({
      ...activeProfile,
      report_settings: {
        ...(activeProfile.report_settings || {}),
        market_pulse: {
          ...(activeProfile.report_settings?.market_pulse || {}),
          [field]: value,
        },
      },
    });
  };

  const handleMarketPulseSettingArrayChange = (
    field:
      | 'primary_operating_markets'
      | 'target_expansion_markets'
      | 'solution_domains'
      | 'core_offerings'
      | 'growth_priorities'
      | 'partnership_priorities'
      | 'critical_hiring_functions'
      | 'regulatory_policy_sensitivity'
      | 'default_categories'
      | 'exclusions'
      | 'preferred_regions',
    value: string,
  ) => {
    if (!isEditing) return;
    updateActiveProfile({
      ...activeProfile,
      report_settings: {
        ...(activeProfile.report_settings || {}),
        market_pulse: {
          ...(activeProfile.report_settings?.market_pulse || {}),
          [field]: splitToList(value),
        },
      },
    });
  };

  const handleIntelligenceSettingChange = (
    field:
      | 'primary_objective'
      | 'primary_target_metric'
      | 'target_value'
      | 'time_horizon'
      | 'target_note',
    value: string,
  ) => {
    if (!isEditing) return;
    updateActiveProfile({
      ...activeProfile,
      report_settings: {
        ...(activeProfile.report_settings || {}),
        intelligence: {
          ...(activeProfile.report_settings?.intelligence || {}),
          [field]: value,
        },
      },
    });
  };

  const updateOtherSocial = (index: number, field: 'label' | 'url', value: string) => {
    if (!isEditing) return;
    const existing = Array.isArray(activeProfile.other_social_links)
      ? [...activeProfile.other_social_links]
      : [];
    const current = existing[index] || {};
    existing[index] = { ...current, [field]: value };
    updateActiveProfile({ ...activeProfile, other_social_links: existing });
  };

  const addOtherSocial = () => {
    if (!isEditing) {
      setIsEditing(true);
    }
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

    if (normalized.includes('competitor')) {
      updated.competitors_list = values;
      updated.competitors = values.join(', ');
      setMissingFieldAnswers((prev) => ({ ...prev, [field]: values }));
      updateActiveProfile(updated);
      return;
    }

    if (normalized.includes('industry')) {
      updated.industry_list = values;
      updated.industry = values.join(', ');
    } else if (normalized.includes('category') || normalized.includes('categories')) {
      updated.category_list = values;
      updated.category = values.join(', ');
    } else if (
      normalized.includes('geography') ||
      normalized.includes('geographic') ||
      normalized.includes('geographical') ||
      normalized.includes('location') ||
      normalized.includes('market_area') ||
      normalized.includes('served_area')
    ) {
      updated.geography_list = values;
      updated.geography = values.join(', ');
    } else if (normalized.includes('content_theme')) {
      updated.content_themes_list = values;
      updated.content_themes = values.join(', ');
    } else if (
      normalized.includes('product') ||
      normalized.includes('service') ||
      normalized.includes('offering')
    ) {
      updated.products_services_list = values;
      updated.products_services = values.join(', ');
    } else if (
      normalized.includes('target_audience') ||
      normalized.includes('audience') ||
      normalized.includes('customer') ||
      normalized.includes('icp') ||
      normalized.includes('segment')
    ) {
      updated.target_audience_list = values;
      updated.target_audience = values.join(', ');
    } else if (
      normalized.includes('goals') ||
      normalized.includes('goal') ||
      normalized.includes('objective')
    ) {
      updated.goals_list = values;
      updated.goals = values.join(', ');
    } else if (
      normalized.includes('brand_voice') ||
      normalized.includes('voice') ||
      normalized.includes('tone')
    ) {
      updated.brand_voice_list = values;
      updated.brand_voice = values.join(', ');
    } else if (normalized.includes('company_name')) {
      updated.name = values[0] || updated.name;
    } else if (
      normalized.includes('unique_value') ||
      normalized.includes('value_proposition') ||
      normalized.includes('differentiator')
    ) {
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
        core_problem_statement: activeProfile.core_problem_statement ?? null,
        pain_symptoms: Array.isArray(activeProfile.pain_symptoms) ? activeProfile.pain_symptoms : splitToList(String(activeProfile.pain_symptoms || '')),
        awareness_gap: activeProfile.awareness_gap ?? null,
        problem_impact: activeProfile.problem_impact ?? null,
        life_with_problem: activeProfile.life_with_problem ?? null,
        life_after_solution: activeProfile.life_after_solution ?? null,
        desired_transformation: activeProfile.desired_transformation ?? null,
        transformation_mechanism: activeProfile.transformation_mechanism ?? null,
        authority_domains: Array.isArray(activeProfile.authority_domains) ? activeProfile.authority_domains : splitToList(String(activeProfile.authority_domains || '')),
      };
      const response = await apiFetch('/api/company-profile', {
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
      setOverallProfileCompletion(
        data.overall_profile_completion ??
          data.profile?.overall_profile_completion ??
          calculateProfileCompletion(data.profile || activeProfile)
      );
      setProblemTransformationCompletion(
        data.problem_transformation_completion ??
          data.profile?.problem_transformation_completion ??
          calculateProblemTransformationCompletion(data.profile || activeProfile)
      );
      if (data.profile?.company_id) {
        setCompanyId(data.profile.company_id);
        setSelectedCompanyId(data.profile.company_id);
        console.log('Profile loaded:', data.profile.company_id);
      }
      setNotFound(false);
      setIsEditing(false);
      setSuccessMessage('Profile saved.');
      notifyCompanyProfileUpdated(data.profile?.company_id || companyId);
    } catch (error) {
      console.error('Error saving company profile:', error);
      setErrorMessage('Failed to save company profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const REFINE_STEPS = [
    'Crawling website…',
    'Reading social profiles & digital assets…',
    'Cleaning and analysing evidence…',
    'Extracting profile fields with AI…',
    'Saving updated profile…',
  ];
  // Advance through steps on a timer; actual API call may finish earlier or later
  const REFINE_STEP_DELAYS = [0, 9000, 20000, 28000, 40000]; // ms from start

  const refineProfile = async () => {
    try {
      setIsRefining(true);
      setRefineStep(1);
      setErrorMessage(null);
      setSuccessMessage(null);

      // Schedule step advances based on typical timing
      const timers: ReturnType<typeof setTimeout>[] = [];
      REFINE_STEP_DELAYS.slice(1).forEach((delay, i) => {
        timers.push(setTimeout(() => setRefineStep(i + 2), delay));
      });
      const clearTimers = () => timers.forEach(clearTimeout);
      if (!companyId) {
        clearTimers();
        setRefineStep(0);
        setErrorMessage('Select a company to continue.');
        return;
      }
      const resetCompetitorsForLoading = (current: CompanyProfile | null): CompanyProfile | null =>
        current
          ? {
              ...current,
              competitors: '',
              competitors_list: [],
            }
          : current;
      setProfile(resetCompetitorsForLoading);
      setDraftProfile((prev) => ({
        ...prev,
        competitors: '',
        competitors_list: [],
      }));

      const {
        competitors: _refineCompetitors,
        competitors_list: _refineCompetitorsList,
        report_settings: activeReportSettings,
        ...activeProfileForRefine
      } = activeProfile;
      const refineReportSettings: Record<string, any> | undefined = activeReportSettings
        ? { ...(activeReportSettings as Record<string, any>) }
        : undefined;
      if (refineReportSettings?.default_inputs && typeof refineReportSettings.default_inputs === 'object') {
        const {
          competitors: _defaultCompetitors,
          competitors_list: _defaultCompetitorsList,
          ...defaultInputs
        } = refineReportSettings.default_inputs as Record<string, any>;
        refineReportSettings.default_inputs = defaultInputs;
      }
      if (refineReportSettings?.market_pulse && typeof refineReportSettings.market_pulse === 'object') {
        const {
          named_competitors: _namedCompetitors,
          competitor_details: _competitorDetails,
          competitor_quality: _competitorQuality,
          market_alternatives: _marketAlternatives,
          ...marketPulse
        } = refineReportSettings.market_pulse as Record<string, any>;
        refineReportSettings.market_pulse = marketPulse;
      }
      const payload = {
        ...activeProfileForRefine,
        report_settings: refineReportSettings,
        companyId: companyId || activeProfile.company_id,
        company_id: companyId || activeProfile.company_id,
        industry_list: activeProfile.industry_list ?? splitToList(activeProfile.industry),
        category_list: activeProfile.category_list ?? splitToList(activeProfile.category),
        geography_list: activeProfile.geography_list ?? splitToList(activeProfile.geography),
        content_themes_list: activeProfile.content_themes_list ?? splitToList(activeProfile.content_themes),
        products_services_list: activeProfile.products_services_list ?? splitToList(activeProfile.products_services),
        target_audience_list: activeProfile.target_audience_list ?? splitToList(activeProfile.target_audience),
        goals_list: activeProfile.goals_list ?? splitToList(activeProfile.goals),
        brand_voice_list: activeProfile.brand_voice_list ?? splitToList(activeProfile.brand_voice),
        social_profiles: buildSocialProfilesFromScalars(activeProfile),
        core_problem_statement: activeProfile.core_problem_statement ?? null,
        pain_symptoms: Array.isArray(activeProfile.pain_symptoms) ? activeProfile.pain_symptoms : splitToList(String(activeProfile.pain_symptoms || '')),
        awareness_gap: activeProfile.awareness_gap ?? null,
        problem_impact: activeProfile.problem_impact ?? null,
        life_with_problem: activeProfile.life_with_problem ?? null,
        life_after_solution: activeProfile.life_after_solution ?? null,
        desired_transformation: activeProfile.desired_transformation ?? null,
        transformation_mechanism: activeProfile.transformation_mechanism ?? null,
        authority_domains: Array.isArray(activeProfile.authority_domains) ? activeProfile.authority_domains : splitToList(String(activeProfile.authority_domains || '')),
      };
      const response = await apiFetch('/api/company-profile/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error || errorBody?.details || 'Failed to refine profile');
      }
      const data = await response.json();
      const refinedProfileFromAPI = data.profile as CompanyProfile | undefined;
      if (!refinedProfileFromAPI) {
        throw new Error('Refine response did not include a profile');
      }
      setProfile(refinedProfileFromAPI);
      setDraftProfile(refinedProfileFromAPI);
      if (refinedProfileFromAPI.company_id) {
        setCompanyId(refinedProfileFromAPI.company_id);
        setSelectedCompanyId(refinedProfileFromAPI.company_id);
        console.log('Profile loaded:', refinedProfileFromAPI.company_id);
      }
      clearTimers();
      setRefineStep(0);
      setNotFound(false);
      setIsEditing(true); // AI updated fields — enter edit mode so user can review and save
      setSuccessMessage('Profile enriched by AI. Review the changes and click Save Profile.');
      if (data?.refinement) {
        setLatestRefinement(data.refinement);
        setRefinementHistory((prev) => [data.refinement, ...prev]);
      }
    } catch (error) {
      console.error('Error refining company profile:', error);
      setErrorMessage('Failed to refine company profile.');
    } finally {
      setIsRefining(false);
      setRefineStep(0);
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
      const response = await apiFetch(
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
      const response = await apiFetch(
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
      const response = await apiFetch(
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

  const openProblemTransformationPanel = async () => {
    if (!companyId) return;
    setProblemTransformationPanelOpen(true);
    setProblemTransformationLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await apiFetch(
        `/api/company-profile/problem-transformation-questions?companyId=${encodeURIComponent(companyId)}`
      );
      if (!res.ok) throw new Error('Failed to load questions');
      const data = await res.json();
      const questions = data?.questions ?? [];
      setProblemTransformationQuestions(questions);
      const p = activeProfile;
      const prefill: string[] = [
        p.core_problem_statement ?? '',
        joinList(p.pain_symptoms),
        p.awareness_gap ?? '',
        p.problem_impact ?? '',
        p.life_with_problem ?? '',
        p.life_after_solution ?? '',
        p.desired_transformation ?? '',
        p.transformation_mechanism ?? '',
        joinList(p.authority_domains),
      ];
      setProblemTransformationAnswers(questions.map((_: string, i: number) => prefill[i] ?? ''));
    } catch (e) {
      setErrorMessage((e as Error).message || 'Failed to load questions');
    } finally {
      setProblemTransformationLoading(false);
    }
  };

  const saveProblemTransformation = async () => {
    if (!companyId) return;
    setProblemTransformationLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiFetch(
        `/api/company-profile/problem-transformation?companyId=${encodeURIComponent(companyId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId, rawAnswers: problemTransformationAnswers }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || err?.details || 'Save failed');
      }
      const data = await res.json();
      const updated = data.profile ?? activeProfile;
      updateActiveProfile({ ...activeProfile, ...updated });
      setProfile(updated);
      setDraftProfile(updated);
      setProblemTransformationPanelOpen(false);
      setSuccessMessage('Problem & Transformation updated. Click Save Profile to lock these fields.');
      notifyCompanyProfileUpdated(updated.company_id || companyId);
    } catch (e) {
      setErrorMessage((e as Error).message || 'Failed to save Problem & Transformation');
    } finally {
      setProblemTransformationLoading(false);
    }
  };

  const openRefineProblemTransformationPanel = () => {
    setProblemTransformationInferPanelOpen(true);
    setProblemTransformationInferMessages([]);
    setProblemTransformationInferInput('');
    setPendingProblemTransformationUpdates(null);
    setProblemTransformationInferLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    sendProblemTransformationRefineMessage(undefined, true);
  };

  const openInferProblemTransformationPanel = async () => {
    if (!companyId) return;
    setProblemTransformationInferPanelOpen(true);
    setProblemTransformationInferMessages([]);
    setProblemTransformationInferInput('');
    setPendingProblemTransformationUpdates(null);
    setProblemTransformationInferLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await apiFetch(
        `/api/company-profile/infer-problem-transformation?companyId=${encodeURIComponent(companyId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || err?.details || 'Infer failed');
      }
      const data = await res.json();
      const sf = data.structuredFields || {};
      const updated = {
        ...activeProfile,
        core_problem_statement: sf.core_problem_statement ?? activeProfile.core_problem_statement,
        pain_symptoms: Array.isArray(sf.pain_symptoms) ? sf.pain_symptoms : activeProfile.pain_symptoms ?? [],
        awareness_gap: sf.awareness_gap ?? activeProfile.awareness_gap,
        problem_impact: sf.problem_impact ?? activeProfile.problem_impact,
        life_with_problem: sf.life_with_problem ?? activeProfile.life_with_problem,
        life_after_solution: sf.life_after_solution ?? activeProfile.life_after_solution,
        desired_transformation: sf.desired_transformation ?? activeProfile.desired_transformation,
        transformation_mechanism: sf.transformation_mechanism ?? activeProfile.transformation_mechanism,
        authority_domains: Array.isArray(sf.authority_domains) ? sf.authority_domains : activeProfile.authority_domains ?? [],
      };
      updateActiveProfile(updated);
      setProfile(updated);
      setDraftProfile(updated);
      await sendProblemTransformationRefineMessage(undefined, true, sf);
    } catch (e) {
      setErrorMessage((e as Error).message || 'Failed to infer from profile');
    } finally {
      setProblemTransformationInferLoading(false);
    }
  };

  const sendProblemTransformationRefineMessage = async (
    userContent?: string,
    isInitial = false,
    inferredFields?: Record<string, unknown>
  ) => {
    const applyPendingProblemTransformationUpdates = (
      updates: NonNullable<typeof pendingProblemTransformationUpdates>
    ) => {
      const applied = {
        ...activeProfile,
        core_problem_statement:
          updates.core_problem_statement !== undefined
            ? updates.core_problem_statement
            : activeProfile.core_problem_statement,
        pain_symptoms: Array.isArray(updates.pain_symptoms)
          ? updates.pain_symptoms
          : activeProfile.pain_symptoms ?? [],
        awareness_gap:
          updates.awareness_gap !== undefined ? updates.awareness_gap : activeProfile.awareness_gap,
        problem_impact:
          updates.problem_impact !== undefined ? updates.problem_impact : activeProfile.problem_impact,
        life_with_problem:
          updates.life_with_problem !== undefined
            ? updates.life_with_problem
            : activeProfile.life_with_problem,
        life_after_solution:
          updates.life_after_solution !== undefined
            ? updates.life_after_solution
            : activeProfile.life_after_solution,
        desired_transformation:
          updates.desired_transformation !== undefined
            ? updates.desired_transformation
            : activeProfile.desired_transformation,
        transformation_mechanism:
          updates.transformation_mechanism !== undefined
            ? updates.transformation_mechanism
            : activeProfile.transformation_mechanism,
        authority_domains: Array.isArray(updates.authority_domains)
          ? updates.authority_domains
          : activeProfile.authority_domains ?? [],
      };
      updateActiveProfile(applied);
      setProfile(applied);
      setDraftProfile(applied);
      setProblemTransformationCompletion(calculateProblemTransformationCompletion(applied));
      setOverallProfileCompletion(calculateProfileCompletion(applied));
      setPendingProblemTransformationUpdates(null);
      setSuccessMessage('Applied suggested updates. Click Save Profile to persist these changes.');
    };

    const content = (userContent ?? problemTransformationInferInput).trim();
    const isAgreement =
      /^(yes|y|agree|agreed|approved?|ok|okay|apply|accept|go ahead|do it|proceed|sure)\b/i.test(
        content
      );
    if (!isInitial && pendingProblemTransformationUpdates && isAgreement) {
      const updates = pendingProblemTransformationUpdates;
      applyPendingProblemTransformationUpdates(updates);
      setProblemTransformationInferMessages((prev) => [
        ...prev,
        { role: 'user' as const, content },
        {
          role: 'assistant' as const,
          content: 'Approved. I applied the suggested updates. Continue if you want deeper refinement.',
        },
      ]);
      setProblemTransformationInferInput('');
      return;
    }
    const isFirst = problemTransformationInferMessages.length === 0 && !content;
    if (!content && !isFirst && !isInitial) return;
    if (!companyId) return;

    const nextMessages = isFirst || isInitial
      ? problemTransformationInferMessages
      : [...problemTransformationInferMessages, { role: 'user' as const, content }];
    if (!isFirst && !isInitial && content) setProblemTransformationInferMessages(nextMessages);
    setProblemTransformationInferInput('');
    setProblemTransformationInferLoading(true);
    setErrorMessage(null);
    try {
      const source = inferredFields ?? activeProfile;
      const currentFields = {
        core_problem_statement: source.core_problem_statement ?? '',
        pain_symptoms: source.pain_symptoms ?? [],
        awareness_gap: source.awareness_gap ?? '',
        problem_impact: source.problem_impact ?? '',
        life_with_problem: source.life_with_problem ?? '',
        life_after_solution: source.life_after_solution ?? '',
        desired_transformation: source.desired_transformation ?? '',
        transformation_mechanism: source.transformation_mechanism ?? '',
        authority_domains: source.authority_domains ?? [],
      };
      const conversation = nextMessages.map((m) => ({ role: m.role, content: m.content }));
      const res = await apiFetch(
        `/api/company-profile/define-problem-transformation?companyId=${encodeURIComponent(companyId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            conversation: isInitial ? [] : conversation,
            currentFields,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || err?.details || 'Refine failed');
      }
      const data = await res.json();
      const buildPreviewSummary = (pv: Record<string, any>): string => {
        const rows = Object.entries(pv || {})
          .filter(([, v]) => v != null && (!Array.isArray(v) || v.length > 0) && String(v).trim() !== '')
          .map(([k, v]) => {
            const label = k.replace(/_/g, ' ');
            const value = Array.isArray(v) ? v.join(', ') : String(v);
            return `- ${label}: ${value}`;
          });
        if (rows.length === 0) return '';
        return `Proposed updates:\n${rows.join('\n')}`;
      };
      if (data.previewUpdates) {
        const pv = data.previewUpdates;
        setPendingProblemTransformationUpdates({
          core_problem_statement:
            pv.core_problem_statement !== undefined ? pv.core_problem_statement : undefined,
          pain_symptoms: Array.isArray(pv.pain_symptoms) ? pv.pain_symptoms : undefined,
          awareness_gap: pv.awareness_gap !== undefined ? pv.awareness_gap : undefined,
          problem_impact: pv.problem_impact !== undefined ? pv.problem_impact : undefined,
          life_with_problem: pv.life_with_problem !== undefined ? pv.life_with_problem : undefined,
          life_after_solution:
            pv.life_after_solution !== undefined ? pv.life_after_solution : undefined,
          desired_transformation:
            pv.desired_transformation !== undefined ? pv.desired_transformation : undefined,
          transformation_mechanism:
            pv.transformation_mechanism !== undefined ? pv.transformation_mechanism : undefined,
          authority_domains: Array.isArray(pv.authority_domains) ? pv.authority_domains : undefined,
        });
      }
      if (data.done && data.structuredFields) {
        const sf = data.structuredFields;
        const updated = {
          ...activeProfile,
          core_problem_statement: sf.core_problem_statement ?? activeProfile.core_problem_statement,
          pain_symptoms: Array.isArray(sf.pain_symptoms) ? sf.pain_symptoms : activeProfile.pain_symptoms ?? [],
          awareness_gap: sf.awareness_gap ?? activeProfile.awareness_gap,
          problem_impact: sf.problem_impact ?? activeProfile.problem_impact,
          life_with_problem: sf.life_with_problem ?? activeProfile.life_with_problem,
          life_after_solution: sf.life_after_solution ?? activeProfile.life_after_solution,
          desired_transformation: sf.desired_transformation ?? activeProfile.desired_transformation,
          transformation_mechanism: sf.transformation_mechanism ?? activeProfile.transformation_mechanism,
          authority_domains: Array.isArray(sf.authority_domains) ? sf.authority_domains : activeProfile.authority_domains ?? [],
        };
        updateActiveProfile(updated);
        setProfile(updated);
        setDraftProfile(updated);
        setPendingProblemTransformationUpdates(null);
        setProblemTransformationInferPanelOpen(false);
        setSuccessMessage('Problem & Transformation updated. Click Save Profile to lock these fields.');
      } else if (data.nextQuestion) {
        const previewSummary = data.previewUpdates
          ? buildPreviewSummary(data.previewUpdates as Record<string, any>)
          : '';
        const strategicInsights = Array.isArray(data.strategic_insights) && data.strategic_insights.length > 0
          ? `\n\nStrategic insights:\n${(data.strategic_insights as string[]).slice(0, 4).map((s) => `- ${s}`).join('\n')}`
          : '';
        setProblemTransformationInferMessages((prev) => [
          ...prev,
          {
            role: 'assistant' as const,
            content: data.previewUpdates
              ? `${previewSummary}\n\n${data.nextQuestion}${strategicInsights}\n\nReply "apply" to accept these updates.`
              : data.nextQuestion,
          },
        ]);
      } else if (data.previewUpdates) {
        const previewSummary = buildPreviewSummary(data.previewUpdates as Record<string, any>);
        setProblemTransformationInferMessages((prev) => [
          ...prev,
          {
            role: 'assistant' as const,
            content: `${previewSummary}\n\nReply "apply" to accept these updates.`,
          },
        ]);
      }
    } catch (e) {
      setErrorMessage((e as Error).message || 'Failed to refine Problem & Transformation');
    } finally {
      setProblemTransformationInferLoading(false);
    }
  };

  const generateMarketingIntelligence = async () => {
    if (!companyId) return;
    setMarketingIntelligenceLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const response = await apiFetch(
        `/api/company-profile/generate-marketing-intelligence?companyId=${encodeURIComponent(companyId)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, company_id: companyId }) }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || 'Generate failed');
      }
      const data = await response.json();
      const structuredFields = data.structuredFields || {};
      updateActiveProfile({
        ...activeProfile,
        ...structuredFields,
      });
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
  const calculateProblemTransformationCompletion = (profileData: CompanyProfile): number => {
    const filled = [
      profileData.core_problem_statement,
      Array.isArray(profileData.pain_symptoms) ? profileData.pain_symptoms.join(', ') : '',
      profileData.awareness_gap,
      profileData.problem_impact,
      profileData.life_with_problem,
      profileData.life_after_solution,
      profileData.desired_transformation,
      profileData.transformation_mechanism,
      Array.isArray(profileData.authority_domains) ? profileData.authority_domains.join(', ') : '',
    ].filter((v) => String(v ?? '').trim().length > 0).length;
    return Math.round((filled / 9) * 100);
  };
  const calculateProfileCompletion = (profileData: CompanyProfile): number => {
    const checkpoints = [
      profileData.name,
      profileData.industry || (profileData.industry_list ?? []).join(', '),
      profileData.category || (profileData.category_list ?? []).join(', '),
      profileData.target_audience || (profileData.target_audience_list ?? []).join(', '),
      profileData.unique_value,
      profileData.content_themes || (profileData.content_themes_list ?? []).join(', '),
      profileData.brand_positioning,
      profileData.campaign_focus,
      profileData.core_problem_statement,
      profileData.desired_transformation,
    ];
    const complete = checkpoints.filter((v) => String(v ?? '').trim().length > 0).length;
    return Math.round((complete / checkpoints.length) * 100);
  };
  const uiProblemTransformationCompletion = calculateProblemTransformationCompletion(activeProfile);
  const uiOverallProfileCompletion = calculateProfileCompletion(activeProfile);
  const uiConfidence = Math.max(
    0,
    Math.min(
      100,
      Number(
        activeProfile.overall_confidence ??
          activeProfile.confidence_score ??
          Math.round(uiOverallProfileCompletion * 0.85)
      )
    )
  );
  const toTitleCase = (value: string): string =>
    value
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const normalizeFieldKey = (value: string): string => value.toLowerCase().replace(/[^a-z]/g, '');
  const canonicalFieldLabel = (rawLabel: string): string => {
    const normalized = normalizeFieldKey(rawLabel);
    const aliases: Array<{ label: string; keys: string[] }> = [
      { label: 'Core Problem Statement', keys: ['coreproblemstatement', 'coreproblem'] },
      { label: 'Pain Symptoms', keys: ['painsymptoms', 'painsymptom'] },
      { label: 'Awareness Gap', keys: ['awarenessgap', 'misconception'] },
      { label: 'Problem Impact', keys: ['problemimpact', 'impact'] },
      { label: 'Life With Problem', keys: ['lifewithproblem', 'beforestate'] },
      { label: 'Life After Solution', keys: ['lifeaftersolution', 'afterstate'] },
      {
        label: 'Desired Transformation',
        keys: ['desiredtransformation', 'transformationgoal', 'transformation'],
      },
      {
        label: 'Transformation Mechanism',
        keys: ['transformationmechanism', 'transformatinmechanissm', 'mechanism'],
      },
      { label: 'Authority Domains', keys: ['authoritydomains', 'authoritydomain'] },
    ];
    const found = aliases.find((entry) => entry.keys.some((k) => normalized.includes(k)));
    return found?.label ?? toTitleCase(rawLabel);
  };
  const renderProblemTransformationAssistantMessage = (content: string): React.ReactNode => {
    const lines = content.split('\n');
    const rendered: React.ReactNode[] = [];
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      const proposedMatch = line.match(/^\s*-\s*([^:]+):\s*(.*)$/);
      if (line.trim().toLowerCase() === 'proposed updates:') {
        rendered.push(
          <div key={`line-${idx}`} className="font-semibold text-gray-900 mb-2">
            Proposed updates:
          </div>
        );
        continue;
      }
      if (proposedMatch) {
        const fieldLabel = canonicalFieldLabel(proposedMatch[1]);
        const valueLines = [proposedMatch[2]];
        while (idx + 1 < lines.length && !/^\s*-\s*[^:]+:\s*/.test(lines[idx + 1])) {
          if (lines[idx + 1].trim().toLowerCase() === 'proposed updates:') break;
          if (lines[idx + 1].trim() === '') break;
          valueLines.push(lines[idx + 1].trim());
          idx += 1;
        }
        rendered.push(
          <div key={`line-${idx}`} className="mb-4 rounded-md border border-gray-200 p-3 bg-white/70">
            <div className="font-bold text-gray-900">{fieldLabel}</div>
            <div className="mt-2 text-gray-800 whitespace-pre-wrap">{valueLines.join('\n')}</div>
          </div>
        );
        continue;
      }
      if (!line.trim()) {
        rendered.push(<div key={`line-${idx}`} className="h-2" />);
        continue;
      }
      rendered.push(
        <div key={`line-${idx}`} className="whitespace-pre-wrap">
          {line}
        </div>
      );
    }
    return (
      <div>
        {rendered}
      </div>
    );
  };
  const completionPercent = (value: number | null | undefined): number => {
    if (value == null) return 0;
    return Math.round(value <= 1 ? value * 100 : value);
  };


  return {
    REFINE_STEPS,
    REFINE_STEP_DELAYS,
    activeProfile,
    addOtherSocial,
    calculateProblemTransformationCompletion,
    calculateProfileCompletion,
    campaignPurposeInput,
    campaignPurposeLoading,
    campaignPurposeMessages,
    campaignPurposePanelOpen,
    canCreateCompany,
    canSelectMultipleCompanies,
    canViewStrategicSections,
    canonicalFieldLabel,
    companies,
    companyFacts,
    companyId,
    companyIdCopied,
    companySearchFilter,
    completionPercent,
    createCompanyError,
    createCompanyForm,
    createCompanyLoading,
    draftProfile,
    errorMessage,
    apiFetch,
    filteredCompanies,
    generateMarketingIntelligence,
    handleChange,
    handleChangeArray,
    handleCompanyFactChange,
    handleIntelligenceSettingChange,
    handleMarketPulseSettingArrayChange,
    handleMarketPulseSettingChange,
    handleCreateCompany,
    handleMissingAnswer,
    isAdmin,
    isAuthenticated,
    isCompanyAdmin,
    isCompanyLoading,
    isContentArchitect,
    isEditing,
    isLoading,
    isRefining,
    isSaving,
    lastFetchError,
    lastFetchStatus,
    lastRefined,
    latestRefinement,
    marketingIntelligenceChatLoading,
    marketingIntelligenceInput,
    marketingIntelligenceLoading,
    marketingIntelligenceMessages,
    marketingIntelligencePanelOpen,
    missingFieldAnswers,
    normalizeFieldKey,
    normalizeUrlField,
    notFound,
    notifyCompanyProfileUpdated,
    openCampaignPurposePanel,
    openInferProblemTransformationPanel,
    openMarketingIntelligencePanel,
    openProblemTransformationPanel,
    openRefineProblemTransformationPanel,
    openTargetCustomerPanel,
    overallProfileCompletion,
    pendingProblemTransformationUpdates,
    problemTransformationAnswers,
    problemTransformationCompletion,
    problemTransformationInferInput,
    problemTransformationInferLoading,
    problemTransformationInferMessages,
    problemTransformationInferPanelOpen,
    problemTransformationLoading,
    problemTransformationPanelOpen,
    problemTransformationQuestions,
    profile,
    profileReview,
    profileReviewDue,
    refineProfile,
    refineStep,
    refinementHistory,
    refreshCompanies,
    removeOtherSocial,
    renderProblemTransformationAssistantMessage,
    router,
    saveProblemTransformation,
    saveProfile,
    selectedCompanyId,
    selectedCompanyName,
    sendCampaignPurposeMessage,
    sendMarketingIntelligenceMessage,
    sendProblemTransformationRefineMessage,
    sendTargetCustomerMessage,
    setCampaignPurposeInput,
    setCampaignPurposeLoading,
    setCampaignPurposeMessages,
    setCampaignPurposePanelOpen,
    setCompanyId,
    setCompanyIdCopied,
    setCompanySearchFilter,
    setCreateCompanyError,
    setCreateCompanyForm,
    setCreateCompanyLoading,
    setDraftProfile,
    setErrorMessage,
    setIsEditing,
    setIsLoading,
    setIsRefining,
    setIsSaving,
    setLastFetchError,
    setLastFetchStatus,
    setLatestRefinement,
    setMarketingIntelligenceChatLoading,
    setMarketingIntelligenceInput,
    setMarketingIntelligenceLoading,
    setMarketingIntelligenceMessages,
    setMarketingIntelligencePanelOpen,
    setMissingFieldAnswers,
    setNotFound,
    setOverallProfileCompletion,
    setPendingProblemTransformationUpdates,
    setProblemTransformationAnswers,
    setProblemTransformationCompletion,
    setProblemTransformationInferInput,
    setProblemTransformationInferLoading,
    setProblemTransformationInferMessages,
    setProblemTransformationInferPanelOpen,
    setProblemTransformationLoading,
    setProblemTransformationPanelOpen,
    setProblemTransformationQuestions,
    setProfile,
    setRefineStep,
    setRefinementHistory,
    setSelectedCompanyId,
    setShowCompanyFactReviewPrompt,
    setShowCreateCompanyModal,
    setSuccessMessage,
    setTargetCustomerInput,
    setTargetCustomerLoading,
    setTargetCustomerMessages,
    setTargetCustomerPanelOpen,
    showCompanyFactReviewPrompt,
    showCreateCompanyModal,
    successMessage,
    targetCustomerInput,
    targetCustomerLoading,
    targetCustomerMessages,
    targetCustomerPanelOpen,
    toTitleCase,
    uiConfidence,
    uiOverallProfileCompletion,
    uiProblemTransformationCompletion,
    updateActiveProfile,
    updateOtherSocial,
    user,
    userRole,
  };
}
