import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import { setUserScopedLocalStorage } from '../utils/authStorage';
import ChatVoiceButton from '../components/ChatVoiceButton';
import AIGenerationProgress from '../components/AIGenerationProgress';
import { getAuthToken } from '../utils/getAuthToken';
import {
  type CompanyProfile,
  type CompanyContextIntelligence,
  type CompanyContextEnrichmentSuggestion,
  type CompanyContextQuality,
  type CompanyProfileRefinement,
  type IntelligenceReadiness,
  type UserGuidedIntelligence,
  emptyProfile,
  splitToList,
  joinList,
  buildSocialProfilesFromScalars,
} from '../pages/company-profile.types';
import { normalizeCanonicalWebsite } from '../utils/companyProfileValidation';

const ONBOARDING_CHECKPOINT_PREFIX = 'company_profile_onboarding:';
const ONBOARDING_REFINE_STALE_MS = 2 * 60 * 1000;

type OnboardingCheckpoint = {
  continuationVisible?: boolean;
  skipped?: boolean;
  refined?: boolean;
  inFlight?: boolean;
  refineStartedAt?: string;
  updatedAt?: string;
};

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
  const [hasProfileLoadSettled, setHasProfileLoadSettled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [refineStep, setRefineStep] = useState(0); // 0 = idle
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [overallProfileCompletion, setOverallProfileCompletion] = useState<number | null>(null);
  const [problemTransformationCompletion, setProblemTransformationCompletion] = useState<number | null>(null);
  const [intelligenceContext, setIntelligenceContext] = useState<CompanyContextIntelligence | null>(null);
  const [intelligenceReadiness, setIntelligenceReadiness] = useState<IntelligenceReadiness | null>(null);
  const [contextQuality, setContextQuality] = useState<CompanyContextQuality | null>(null);
  const [enrichmentSuggestions, setEnrichmentSuggestions] = useState<CompanyContextEnrichmentSuggestion[]>([]);
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);
  const [enrichmentReviewingId, setEnrichmentReviewingId] = useState<string | null>(null);
  const [intelligenceContextLoading, setIntelligenceContextLoading] = useState(false);
  const [intelligenceContextSaving, setIntelligenceContextSaving] = useState(false);
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
  const [contextIntelligencePanelOpen, setContextIntelligencePanelOpen] = useState(false);
  const [contextIntelligenceMessages, setContextIntelligenceMessages] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([]);
  const [contextIntelligenceInput, setContextIntelligenceInput] = useState('');
  const [contextIntelligenceChatLoading, setContextIntelligenceChatLoading] = useState(false);
  // Set when the chat is done with its questions: holds the merged context that
  // is saved only when the user confirms via the "Save context" action.
  const [contextIntelligencePendingSave, setContextIntelligencePendingSave] = useState<CompanyContextIntelligence | null>(null);
  // Set when a guided-capture chat finishes: the fields are staged into the
  // profile draft and a "Save" action persists them so the panel never closes
  // silently before the user knows it was recorded.
  const [targetCustomerPendingSave, setTargetCustomerPendingSave] = useState(false);
  const [marketingIntelligencePendingSave, setMarketingIntelligencePendingSave] = useState(false);
  const [competitorChatOpen, setCompetitorChatOpen] = useState(false);
  const [competitorChatMessages, setCompetitorChatMessages] = useState<Array<{ role: 'assistant' | 'user'; content: string }>>([]);
  const [competitorChatInput, setCompetitorChatInput] = useState('');
  const [competitorChatLoading, setCompetitorChatLoading] = useState(false);
  const [competitorSuggestions, setCompetitorSuggestions] = useState<Array<{ name: string; domain?: string; offering?: string }>>([]);
  const [competitorPendingSave, setCompetitorPendingSave] = useState<Array<{ name: string; domain?: string; offering?: string }> | null>(null);
  // The latest "company understanding" produced/refined in the chat, staged to persist on save.
  const [competitorUnderstandingPending, setCompetitorUnderstandingPending] = useState<string | null>(null);
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
  const onboardingRequested = router.isReady && router.query.onboarding === 'company-profile';
  const roleHydrated = !isCompanyLoading && Boolean(userRole);
  const profileHydrated = !isLoading && hasProfileLoadSettled;
  const isOnboardingResolving = Boolean(onboardingRequested && (!roleHydrated || !profileHydrated));
  const isOnboardingMode = useMemo(
    () =>
      onboardingRequested &&
      roleHydrated &&
      isCompanyAdmin &&
      !canCreateCompany,
    [onboardingRequested, roleHydrated, isCompanyAdmin, canCreateCompany]
  );
  const [onboardingContinuationVisible, setOnboardingContinuationVisible] = useState(false);
  const refineInFlightRef = useRef(false);

  // SECURITY: clear all server-fetched company-profile state when the
  // authenticated identity changes. Prevents the previous user's profile
  // drafts, chat threads, and refinement history from being visible after a
  // sign-out → sign-in in the same tab.
  const previousUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentUserId = user?.userId ?? null;
    const previousUserId = previousUserIdRef.current;
    if (previousUserId && previousUserId !== currentUserId) {
      setProfile(null);
      setDraftProfile(emptyProfile);
      setCompanyId('');
      setNotFound(false);
      setHasProfileLoadSettled(false);
      setOverallProfileCompletion(null);
      setProblemTransformationCompletion(null);
      setLatestRefinement(null);
      setRefinementHistory([]);
      setMissingFieldAnswers({});
      setTargetCustomerMessages([]);
      setTargetCustomerInput('');
      setCampaignPurposeMessages([]);
      setCampaignPurposeInput('');
      setMarketingIntelligenceMessages([]);
      setMarketingIntelligenceInput('');
      setProblemTransformationQuestions([]);
      setProblemTransformationAnswers([]);
      setProblemTransformationInferMessages([]);
      setProblemTransformationInferInput('');
      setPendingProblemTransformationUpdates(null);
      setShowCompanyFactReviewPrompt(false);
      setOnboardingContinuationVisible(false);
      setErrorMessage(null);
      setSuccessMessage(null);
      setLastFetchStatus(null);
      setLastFetchError(null);
      setCreateCompanyError(null);
      setCreateCompanyForm({ name: '', website: '', industry: '' });
    }
    previousUserIdRef.current = currentUserId;
  }, [user?.userId]);

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
      const res = await fetch('/api/super-admin/companies', {
        method: 'POST',
        credentials: 'include',
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
    const userId = user?.userId;
    if (userId) {
      try {
        // Scope by user so a different signed-in user can never read or be
        // signaled by another user's profile-updated marker.
        localStorage.setItem(
          `company_profile_updated:${userId}:${updatedCompanyId}`,
          updatedAt,
        );
      } catch {
        // ignore storage quota/privacy errors
      }
    }
    window.dispatchEvent(
      new CustomEvent('company-profile-updated', {
        detail: { companyId: updatedCompanyId, updatedAt },
      })
    );
  };

  const getOnboardingCheckpointKey = (id = companyId || activeProfile.company_id) => {
    if (!id) return '';
    const userId = user?.userId;
    if (!userId) return '';
    // Scope by user so onboarding checkpoint state never leaks across
    // identities sharing the same browser or company id.
    return `${ONBOARDING_CHECKPOINT_PREFIX}${userId}:${id}`;
  };

  const readOnboardingCheckpoint = (id = companyId || activeProfile.company_id): OnboardingCheckpoint | null => {
    if (typeof window === 'undefined') return null;
    const key = getOnboardingCheckpointKey(id);
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) as OnboardingCheckpoint : null;
    } catch {
      return null;
    }
  };

  const writeOnboardingCheckpoint = (
    patch: OnboardingCheckpoint,
    id = companyId || activeProfile.company_id,
  ) => {
    if (typeof window === 'undefined') return;
    const key = getOnboardingCheckpointKey(id);
    if (!key) return;
    const next = {
      ...(readOnboardingCheckpoint(id) ?? {}),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(next));
  };

  const isRecentOnboardingRefineInFlight = (checkpoint: OnboardingCheckpoint | null) => {
    if (!checkpoint?.inFlight || !checkpoint.refineStartedAt) return false;
    const startedAt = new Date(checkpoint.refineStartedAt).getTime();
    return !Number.isNaN(startedAt) && Date.now() - startedAt < ONBOARDING_REFINE_STALE_MS;
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
        setHasProfileLoadSettled(false);
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
        const response = await fetchWithAuth(
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
          setIsEditing(isOnboardingMode ? true : false); // onboarding collects social links before refinement
        } else {
          setIsEditing(true); // no profile yet — start in edit mode
        }
        setOverallProfileCompletion(data.overall_profile_completion ?? null);
        setProblemTransformationCompletion(data.problem_transformation_completion ?? null);
        // Only set readiness when this response carries it (some profile-load
        // branches omit it); the intelligence-context load is the authoritative
        // source, so never null a good value here.
        if (data.intelligence_readiness != null) setIntelligenceReadiness(data.intelligence_readiness);
        setNotFound(false);
        setErrorMessage(null);
        setLastFetchError(null);
        if (data.profile?.company_id) {
          setCompanyId(data.profile.company_id);
          setUserScopedLocalStorage('company_id', user?.userId ?? null, data.profile.company_id);
        }
      } catch (error) {
        console.error('Error loading company profile:', error);
        setLastFetchError((error as Error)?.message || 'Failed to load company profile');
        setErrorMessage('Failed to load company profile.');
      } finally {
        setHasProfileLoadSettled(true);
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [companyId, isAuthenticated, isCompanyLoading, isCompanyAdmin, companies, isOnboardingMode, user?.userId]);

  useEffect(() => {
    const loadIntelligenceContext = async () => {
      if (isCompanyLoading || !isAuthenticated || !companyId) {
        setIntelligenceContext(null);
        setIntelligenceReadiness(null);
        setContextQuality(null);
        setEnrichmentSuggestions([]);
        return;
      }
      setIntelligenceContextLoading(true);
      try {
        const response = await fetchWithAuth(
          `/api/company-profile/intelligence-context?companyId=${encodeURIComponent(companyId)}`
        );
        if (!response.ok) return;
        const data = await response.json();
        setIntelligenceContext(data.intelligence_context ?? null);
        setIntelligenceReadiness(data.intelligence_readiness ?? null);
        setContextQuality(data.context_quality ?? null);
      } catch {
        console.warn('Failed to load company intelligence context');
      } finally {
        setIntelligenceContextLoading(false);
      }
    };
    loadIntelligenceContext();
  }, [companyId, isAuthenticated, isCompanyLoading]);

  useEffect(() => {
    const loadEnrichmentSuggestions = async () => {
      if (isCompanyLoading || !isAuthenticated || !companyId) return;
      setEnrichmentLoading(true);
      try {
        const response = await fetchWithAuth(
          `/api/company-profile/intelligence-enrichment?companyId=${encodeURIComponent(companyId)}`
        );
        if (!response.ok) return;
        const data = await response.json();
        setEnrichmentSuggestions(data.suggestions ?? []);
        // The suggestions-only GET (no run=1) does NOT return readiness/quality.
        // Never null out the good values the intelligence-context load already set —
        // only overwrite when this response actually carries a value.
        if (data.context_quality != null) setContextQuality(data.context_quality);
        if (data.intelligence_readiness != null) setIntelligenceReadiness(data.intelligence_readiness);
      } catch {
        console.warn('Failed to load intelligence enrichment suggestions');
      } finally {
        setEnrichmentLoading(false);
      }
    };
    loadEnrichmentSuggestions();
  }, [companyId, isAuthenticated, isCompanyLoading]);

  useEffect(() => {
    const loadRefinements = async () => {
      try {
        if (isCompanyLoading || !isAuthenticated) return;
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
  }, [companyId, isAuthenticated, isCompanyLoading]);

  useEffect(() => {
    if (!isOnboardingMode || !companyId) return;
    const checkpoint = readOnboardingCheckpoint(companyId);
    if (checkpoint?.continuationVisible || checkpoint?.skipped || checkpoint?.refined) {
      setOnboardingContinuationVisible(true);
      return;
    }
    if (checkpoint?.refineStartedAt && refinementHistory.length > 0) {
      const startedAt = new Date(checkpoint.refineStartedAt).getTime();
      const completedForSession = refinementHistory.some((entry) => {
        const createdAt = new Date((entry as any).created_at || '').getTime();
        return !Number.isNaN(startedAt) && !Number.isNaN(createdAt) && createdAt >= startedAt;
      });
      if (completedForSession) {
        writeOnboardingCheckpoint({ continuationVisible: true, refined: true, inFlight: false }, companyId);
        setOnboardingContinuationVisible(true);
      }
    }
  }, [isOnboardingMode, companyId, refinementHistory]);

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
    if (normalized.includes('competitor')) {
      setMissingFieldAnswers((prev) => ({ ...prev, [field]: values }));
      return;
    }
    const updated: CompanyProfile = { ...activeProfile };

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

  // Returns true only when the profile was actually persisted, so callers (e.g.
  // confirmSaveCompetitors) can avoid discarding their staged data on a failed save.
  const saveProfile = async (override?: CompanyProfile): Promise<boolean> => {
    try {
      setIsSaving(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      if (!companyId) {
        setErrorMessage('Select a company to continue.');
        return false;
      }
      // `override` lets a guided-capture flow persist the exact fields it just
      // staged without waiting for the activeProfile state to settle.
      const source = override ?? activeProfile;
      const payload = {
        ...source,
        companyId: companyId || source.company_id,
        company_id: companyId || source.company_id,
        industry_list: source.industry_list ?? splitToList(source.industry),
        category_list: source.category_list ?? splitToList(source.category),
        geography_list: source.geography_list ?? splitToList(source.geography),
        competitors_list: source.competitors_list ?? splitToList(source.competitors),
        content_themes_list: source.content_themes_list ?? splitToList(source.content_themes),
        products_services_list: source.products_services_list ?? splitToList(source.products_services),
        target_audience_list: source.target_audience_list ?? splitToList(source.target_audience),
        goals_list: source.goals_list ?? splitToList(source.goals),
        brand_voice_list: source.brand_voice_list ?? splitToList(source.brand_voice),
        social_profiles: buildSocialProfilesFromScalars(source),
        core_problem_statement: source.core_problem_statement ?? null,
        pain_symptoms: Array.isArray(source.pain_symptoms) ? source.pain_symptoms : splitToList(String(source.pain_symptoms || '')),
        awareness_gap: source.awareness_gap ?? null,
        problem_impact: source.problem_impact ?? null,
        life_with_problem: source.life_with_problem ?? null,
        life_after_solution: source.life_after_solution ?? null,
        desired_transformation: source.desired_transformation ?? null,
        transformation_mechanism: source.transformation_mechanism ?? null,
        authority_domains: Array.isArray(source.authority_domains) ? source.authority_domains : splitToList(String(source.authority_domains || '')),
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
      setProfile(data.profile || source);
      setDraftProfile(data.profile || source);
      setOverallProfileCompletion(
        data.overall_profile_completion ??
          data.profile?.overall_profile_completion ??
          calculateProfileCompletion(data.profile || source)
      );
      setProblemTransformationCompletion(
        data.problem_transformation_completion ??
          data.profile?.problem_transformation_completion ??
          calculateProblemTransformationCompletion(data.profile || source)
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
      return true;
    } catch (error) {
      console.error('Error saving company profile:', error);
      setErrorMessage('Failed to save company profile.');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  // Competitive-intelligence chat: the assistant shares its understanding of the
  // company, the user confirms/refines, then it returns named competitors with
  // domains. Deterministic 2-turn flow (understanding → competitors on reply).
  const sendCompetitorMessage = async (userContent?: string) => {
    const content = (userContent ?? competitorChatInput).trim();
    const isInitial = competitorChatMessages.length === 0 && !content;
    if (!content && !isInitial) return;
    if (!companyId) return;

    const nextMessages = isInitial
      ? []
      : [...competitorChatMessages, { role: 'user' as const, content }];
    if (!isInitial && content) setCompetitorChatMessages(nextMessages);
    setCompetitorChatInput('');
    setCompetitorChatLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetchWithAuth(
        `/api/company-profile/suggest-competitors?companyId=${encodeURIComponent(companyId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            company_id: companyId,
            conversation: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          }),
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || 'Request failed');
      }
      const data = await response.json();
      if (data.done) {
        const comps: Array<{ name: string; domain?: string; offering?: string }> =
          Array.isArray(data.competitors) ? data.competitors : [];
        setCompetitorSuggestions(comps);
        setCompetitorPendingSave(comps);
        const listText = comps
          .map((c) => `• ${c.name}${c.domain ? ` (${c.domain})` : ''}${c.offering ? ` — ${c.offering}` : ''}`)
          .join('\n');
        const takeText = String(data.final_take || '').trim();
        // Stage the refined understanding — persisted alongside the competitors on save.
        if (takeText) setCompetitorUnderstandingPending(takeText);
        setCompetitorChatMessages((prev) => [
          ...prev,
          {
            role: 'assistant' as const,
            content: `${takeText ? `${takeText}\n\n` : ''}Direct competitors I'd track:\n${listText || '(none I can confidently name)'}\n\nClick "Save competitors" to add them to your profile (they'll be locked from auto-refinement).`,
          },
        ]);
      } else if (data.nextQuestion) {
        if (data.understanding) setCompetitorUnderstandingPending(String(data.understanding).trim());
        setCompetitorChatMessages((prev) =>
          isInitial
            ? [{ role: 'assistant' as const, content: data.nextQuestion }]
            : [...prev, { role: 'assistant' as const, content: data.nextQuestion }],
        );
      }
    } catch (e) {
      setErrorMessage((e as Error).message || 'Competitor intelligence failed');
    } finally {
      setCompetitorChatLoading(false);
    }
  };

  const openCompetitorChat = () => {
    setCompetitorChatMessages([]);
    setCompetitorChatInput('');
    setCompetitorPendingSave(null);
    setCompetitorChatOpen(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setCompetitorChatLoading(true);
    sendCompetitorMessage();
  };

  const confirmSaveCompetitors = async () => {
    const pending = competitorPendingSave;
    if (!pending || pending.length === 0) return;
    const names = pending.map((c) => String(c.name || '').trim()).filter(Boolean);
    if (names.length === 0) return;

    // 1) Save the names to the (auto-locked) Competitors field. Only clear the staged
    //    suggestions AFTER the write is confirmed — otherwise a failed save (e.g. an
    //    expired session) silently loses them with no way to retry.
    const updated = { ...activeProfile, competitors: names.join(', '), competitors_list: names };
    updateActiveProfile(updated);
    const saved = await saveProfile(updated);
    if (!saved) {
      // Keep competitorPendingSave + the chat open so the user can retry; saveProfile
      // has already surfaced the error. Do NOT persist guidance against an unsaved profile.
      return;
    }
    setCompetitorChatOpen(false);
    setCompetitorPendingSave(null);

    // 2) Persist the domains + offerings as user-guided competitor intelligence so
    //    the full card survives reloads and feeds refinement as a trusted signal.
    //    The guidance endpoint does a targeted report_settings update, so it does
    //    not clobber the competitors field saved above.
    const currentGuidance = activeProfile.report_settings?.user_guidance ?? null;
    const now = new Date().toISOString();
    const keyOf = (v?: string | null) => String(v || '').trim().toLowerCase();
    const savedKeys = new Set(names.map((n) => keyOf(n)));
    const preserved = (currentGuidance?.competitors ?? []).filter((c) => !savedKeys.has(keyOf(c.name)));
    const guidedComps = pending
      .filter((c) => String(c.name || '').trim())
      .map((c) => ({
        name: String(c.name).trim(),
        ...(c.domain ? { domain: String(c.domain).trim() } : {}),
        state: 'user_added' as const,
        source: 'user_guided',
        rationale: c.offering ? String(c.offering).trim() : null,
        updated_at: now,
      }));
    // Persist the refined "company understanding" from the chat alongside the competitors,
    // so the next session resumes from it. A user's manual edit (edited_by_user) is never
    // overwritten by the AI's chat take.
    const existingCU = currentGuidance?.competitor_understanding ?? null;
    const understanding = String(competitorUnderstandingPending || '').trim();
    const nextCU = existingCU?.edited_by_user
      ? existingCU
      : (understanding ? { statement: understanding, updated_at: now, edited_by_user: false } : existingCU);
    await saveUserGuidance(
      {
        ...(currentGuidance || { version: 1 }),
        competitors: [...preserved, ...guidedComps],
        ...(nextCU ? { competitor_understanding: nextCU } : {}),
      },
      'competitor_user_added',
    );
    setCompetitorUnderstandingPending(null);
  };

  // Manual edit of the persisted "company understanding" — user-authored, so it's marked
  // edited_by_user and protected from being overwritten by the AI chat take.
  const saveCompetitorUnderstanding = async (text: string): Promise<boolean> => {
    const statement = String(text || '').trim();
    const currentGuidance = activeProfile.report_settings?.user_guidance ?? null;
    const result = await saveUserGuidance(
      {
        ...(currentGuidance || { version: 1 }),
        competitor_understanding: statement
          ? { statement, updated_at: new Date().toISOString(), edited_by_user: true }
          : null,
      },
      'competitor_understanding_edited',
    );
    return Boolean(result);
  };

  const updateIntelligenceContext = (patch: Partial<CompanyContextIntelligence>) => {
    setIntelligenceContext((current) => ({
      revenue_segments: [],
      geographic_exposures: [],
      dependencies: [],
      regulatory_exposures: [],
      workforce_profile: null,
      technology_dependencies: [],
      ...(current || {}),
      ...patch,
    }));
    if (!isEditing) setIsEditing(true);
  };

  const saveIntelligenceContext = async (nextContext?: CompanyContextIntelligence | null) => {
    const resolvedCompanyId = companyId || activeProfile.company_id;
    if (!resolvedCompanyId) {
      setErrorMessage('Select a company before saving intelligence context.');
      return null;
    }
    const payload = nextContext ?? intelligenceContext;
    setIntelligenceContextSaving(true);
    setErrorMessage(null);
    try {
      const response = await fetchWithAuth('/api/company-profile/intelligence-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          intelligence_context: payload ?? {
            revenue_segments: [],
            geographic_exposures: [],
            dependencies: [],
            regulatory_exposures: [],
            workforce_profile: null,
            technology_dependencies: [],
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to save intelligence context');
      setIntelligenceContext(data.intelligence_context ?? null);
      setIntelligenceReadiness(data.intelligence_readiness ?? null);
      setContextQuality(data.context_quality ?? null);
      setSuccessMessage('Intelligence context saved.');
      notifyCompanyProfileUpdated(resolvedCompanyId);
      return data.intelligence_context as CompanyContextIntelligence | null;
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to save intelligence context');
      return null;
    } finally {
      setIntelligenceContextSaving(false);
    }
  };

  const runIntelligenceEnrichment = async () => {
    const resolvedCompanyId = companyId || activeProfile.company_id;
    if (!resolvedCompanyId) return null;
    setEnrichmentLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetchWithAuth('/api/company-profile/intelligence-enrichment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, action: 'run' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to run intelligence enrichment');
      setEnrichmentSuggestions(data.suggestions ?? []);
      setContextQuality(data.context_quality ?? null);
      setIntelligenceReadiness(data.intelligence_readiness ?? null);
      return data.suggestions as CompanyContextEnrichmentSuggestion[];
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to run intelligence enrichment');
      return null;
    } finally {
      setEnrichmentLoading(false);
    }
  };

  const reviewIntelligenceEnrichment = async (
    suggestionId: string,
    action: 'accepted' | 'rejected' | 'modified' | 'snoozed',
    modifiedPayload?: Record<string, unknown> | null,
  ) => {
    const resolvedCompanyId = companyId || activeProfile.company_id;
    if (!resolvedCompanyId) return null;
    setEnrichmentReviewingId(suggestionId);
    setErrorMessage(null);
    try {
      const response = await fetchWithAuth('/api/company-profile/intelligence-enrichment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          suggestionId,
          action,
          modifiedPayload: modifiedPayload ?? null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to review enrichment suggestion');
      setEnrichmentSuggestions(data.suggestions ?? []);
      setIntelligenceContext(data.intelligence_context ?? intelligenceContext);
      setIntelligenceReadiness(data.intelligence_readiness ?? intelligenceReadiness);
      setContextQuality(data.context_quality ?? contextQuality);
      if (action === 'accepted') setSuccessMessage('Inference added for review.');
      if (action === 'rejected') setSuccessMessage('Inference rejected.');
      if (action === 'snoozed') setSuccessMessage('Suggestion snoozed.');
      return data;
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to review enrichment suggestion');
      return null;
    } finally {
      setEnrichmentReviewingId(null);
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

  const getValidCanonicalWebsite = (profileData: CompanyProfile): string | null => {
    return normalizeCanonicalWebsite(profileData.website_url);
  };

  const saveUserGuidance = async (
    userGuidance: UserGuidedIntelligence | null,
    action = 'update_guidance',
    target?: string | null,
  ) => {
    const resolvedCompanyId = companyId || activeProfile.company_id;
    if (!resolvedCompanyId) {
      setErrorMessage('Select a company before saving guidance.');
      return null;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const response = await fetchWithAuth('/api/company-profile/guidance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          action,
          target,
          user_guidance: userGuidance,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to save intelligence guidance');
      const next = data.profile || {
        ...activeProfile,
        report_settings: {
          ...(activeProfile.report_settings || {}),
          user_guidance: userGuidance,
        },
      };
      setProfile(next);
      setDraftProfile(next);
      setSuccessMessage('Intelligence guidance saved.');
      return next as CompanyProfile;
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to save intelligence guidance');
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const persistProfileBeforeRefine = async (): Promise<CompanyProfile> => {
    const canonicalWebsite = getValidCanonicalWebsite(activeProfile);
    if (!canonicalWebsite) {
      throw new Error('A valid company website is required before refinement.');
    }
    const payload: Record<string, unknown> = {
      companyId: companyId || activeProfile.company_id,
      company_id: companyId || activeProfile.company_id,
      website_url: canonicalWebsite,
    };
    ([
      'linkedin_url',
      'facebook_url',
      'instagram_url',
      'x_url',
      'youtube_url',
      'tiktok_url',
      'reddit_url',
      'pinterest_url',
      'whatsapp_url',
      'blog_url',
    ] as Array<keyof CompanyProfile>).forEach((field) => {
      const normalized = normalizeCanonicalWebsite(activeProfile[field]);
      if (normalized) payload[field] = normalized;
    });
    const response = await fetchWithAuth('/api/company-profile/onboarding-presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.error || errorBody?.details || 'Failed to save profile before refinement');
    }
    const data = await response.json();
    const persisted = data.profile || payload;
    setProfile(persisted);
    setDraftProfile(persisted);
    notifyCompanyProfileUpdated(persisted.company_id || companyId);
    return persisted;
  };

  const refineProfile = async () => {
    if (isRefining || refineInFlightRef.current) return;
    const checkpoint = isOnboardingMode ? readOnboardingCheckpoint() : null;
    if (isOnboardingMode && isRecentOnboardingRefineInFlight(checkpoint)) {
      setErrorMessage('AI refinement is already running for this onboarding session. Wait a moment before retrying.');
      return;
    }
    const canonicalWebsite = getValidCanonicalWebsite(activeProfile);
    if (!canonicalWebsite) {
      setErrorMessage('Add a valid company website before using Refine with AI.');
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const clearTimers = () => timers.forEach(clearTimeout);
    try {
      refineInFlightRef.current = true;
      const refineStartedAt = new Date().toISOString();
      if (isOnboardingMode) {
        writeOnboardingCheckpoint({
          inFlight: true,
          refineStartedAt,
          continuationVisible: false,
          skipped: false,
          refined: false,
        });
      }
      setIsRefining(true);
      setRefineStep(1);
      setErrorMessage(null);
      setSuccessMessage(null);

      if (!isOnboardingMode) {
        // Schedule step advances based on typical timing for the existing editor flow.
        REFINE_STEP_DELAYS.slice(1).forEach((delay, i) => {
          timers.push(setTimeout(() => setRefineStep(i + 2), delay));
        });
      }
      if (!companyId) {
        clearTimers();
        setRefineStep(0);
        setErrorMessage('Select a company to continue.');
        return;
      }
      const persistedProfile = await persistProfileBeforeRefine();
      const {
        competitors: _refineCompetitors,
        competitors_list: _refineCompetitorsList,
        report_settings: activeReportSettings,
        ...activeProfileForRefine
      } = persistedProfile;
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
        companyId: companyId || persistedProfile.company_id,
        company_id: companyId || persistedProfile.company_id,
        onboarding: isOnboardingMode ? 'company-profile' : undefined,
        onboardingMode: isOnboardingMode,
        website_url: canonicalWebsite,
        industry_list: persistedProfile.industry_list ?? splitToList(persistedProfile.industry),
        category_list: persistedProfile.category_list ?? splitToList(persistedProfile.category),
        geography_list: persistedProfile.geography_list ?? splitToList(persistedProfile.geography),
        content_themes_list: persistedProfile.content_themes_list ?? splitToList(persistedProfile.content_themes),
        products_services_list: persistedProfile.products_services_list ?? splitToList(persistedProfile.products_services),
        target_audience_list: persistedProfile.target_audience_list ?? splitToList(persistedProfile.target_audience),
        goals_list: persistedProfile.goals_list ?? splitToList(persistedProfile.goals),
        brand_voice_list: persistedProfile.brand_voice_list ?? splitToList(persistedProfile.brand_voice),
        social_profiles: buildSocialProfilesFromScalars({ ...persistedProfile, website_url: canonicalWebsite }),
        core_problem_statement: persistedProfile.core_problem_statement ?? null,
        pain_symptoms: Array.isArray(persistedProfile.pain_symptoms) ? persistedProfile.pain_symptoms : splitToList(String(persistedProfile.pain_symptoms || '')),
        awareness_gap: persistedProfile.awareness_gap ?? null,
        problem_impact: persistedProfile.problem_impact ?? null,
        life_with_problem: persistedProfile.life_with_problem ?? null,
        life_after_solution: persistedProfile.life_after_solution ?? null,
        desired_transformation: persistedProfile.desired_transformation ?? null,
        transformation_mechanism: persistedProfile.transformation_mechanism ?? null,
        authority_domains: Array.isArray(persistedProfile.authority_domains) ? persistedProfile.authority_domains : splitToList(String(persistedProfile.authority_domains || '')),
      };
      const response = await fetchWithAuth(isOnboardingMode
        ? `/api/company-profile/refine?onboarding=company-profile&companyId=${encodeURIComponent(companyId || persistedProfile.company_id || '')}`
        : '/api/company-profile/refine', {
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
      setOnboardingContinuationVisible(true);
      if (isOnboardingMode) {
        writeOnboardingCheckpoint({ continuationVisible: true, refined: true, inFlight: false });
      }
      setSuccessMessage(
        isOnboardingMode
          ? 'Profile enriched and saved by AI. Review the populated sections, then continue to business details.'
          : 'Profile enriched and saved by AI. Review and edit any fields that need adjustment.'
      );
      if (data?.refinement) {
        setLatestRefinement(data.refinement);
        setRefinementHistory((prev) => [data.refinement, ...prev]);
      }
    } catch (error) {
      console.error('Error refining company profile:', error);
      if (isOnboardingMode) {
        writeOnboardingCheckpoint({ inFlight: false });
      }
      setErrorMessage((error as Error).message || 'Failed to refine company profile.');
    } finally {
      clearTimers();
      refineInFlightRef.current = false;
      setIsRefining(false);
      setRefineStep(0);
    }
  };

  const skipOnboardingRefinement = () => {
    if (!isOnboardingMode) return;
    writeOnboardingCheckpoint({ continuationVisible: true, skipped: true, inFlight: false });
    setOnboardingContinuationVisible(true);
    setSuccessMessage('AI refinement skipped. Continue with business details and save when finished.');
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
        setTargetCustomerPendingSave(true);
        setTargetCustomerMessages((prev) => [
          ...prev,
          { role: 'assistant' as const, content: 'That’s everything I need. Click “Save” below to record these customer details to your profile.' },
        ]);
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

  const confirmSaveTargetCustomer = async () => {
    await saveProfile();
    setTargetCustomerPendingSave(false);
    setTargetCustomerPanelOpen(false);
    setTargetCustomerMessages([]);
  };

  const openTargetCustomerPanel = () => {
    setTargetCustomerMessages([]);
    setTargetCustomerInput('');
    setTargetCustomerPendingSave(false);
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
        setMarketingIntelligencePendingSave(true);
        setMarketingIntelligenceMessages((prev) => [
          ...prev,
          { role: 'assistant' as const, content: 'That’s everything — click “Save” below to record these marketing fields to your profile.' },
        ]);
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

  const confirmSaveMarketingIntelligence = async () => {
    await saveProfile();
    setMarketingIntelligencePendingSave(false);
    setMarketingIntelligencePanelOpen(false);
    setMarketingIntelligenceMessages([]);
  };

  const openMarketingIntelligencePanel = () => {
    setMarketingIntelligenceMessages([]);
    setMarketingIntelligenceInput('');
    setMarketingIntelligencePendingSave(false);
    setMarketingIntelligencePanelOpen(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setMarketingIntelligenceChatLoading(true);
    sendMarketingIntelligenceMessage();
  };

  const sendContextIntelligenceMessage = async (userContent?: string) => {
    const content = (userContent ?? contextIntelligenceInput).trim();
    const isInitial = contextIntelligenceMessages.length === 0 && !content;
    if (!content && !isInitial) return;
    if (!companyId) return;

    const nextMessages = isInitial
      ? []
      : [...contextIntelligenceMessages, { role: 'user' as const, content }];
    if (!isInitial && content) setContextIntelligenceMessages(nextMessages);
    setContextIntelligenceInput('');
    setContextIntelligenceChatLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetchWithAuth(
        `/api/company-profile/define-context-intelligence?companyId=${encodeURIComponent(companyId)}`,
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
      if (data.done && data.structuredContext) {
        const base = intelligenceContext ?? {
          revenue_segments: [],
          geographic_exposures: [],
          dependencies: [],
          regulatory_exposures: [],
          workforce_profile: null,
          technology_dependencies: [],
        };
        const sc = data.structuredContext as Partial<CompanyContextIntelligence>;
        const norm = (v: unknown) => String(v ?? '').toLowerCase().trim();
        // Append new rows, keyed dedup — never replace/erase already-captured rows.
        const mergeArray = <T,>(existing: T[] | undefined, incoming: unknown, keyOf: (row: any) => string): T[] => {
          const out: T[] = Array.isArray(existing) ? [...existing] : [];
          const seen = new Set(out.map((row) => keyOf(row)));
          for (const row of Array.isArray(incoming) ? incoming : []) {
            const key = keyOf(row);
            if (key && seen.has(key)) continue;
            seen.add(key);
            out.push(row as T);
          }
          return out;
        };
        const nextContext = {
          ...base,
          revenue_segments: mergeArray(base.revenue_segments, sc.revenue_segments, (r) => `${norm(r.customer_segment ?? r.customer_segment_key)}:${norm(r.customer_industry ?? r.customer_industry_key)}`),
          geographic_exposures: mergeArray(base.geographic_exposures, sc.geographic_exposures, (r) => `${norm(r.geography ?? r.geography_key)}:${norm(r.exposure_type ?? r.exposure_type_key)}`),
          dependencies: mergeArray(base.dependencies, sc.dependencies, (r) => `${norm(r.dependency_type ?? r.dependency_type_key)}:${norm(r.dependency_name)}`),
          regulatory_exposures: mergeArray(base.regulatory_exposures, sc.regulatory_exposures, (r) => `${norm(r.regulation_type ?? r.regulation_type_key)}:${norm(r.jurisdiction)}`),
          technology_dependencies: mergeArray(base.technology_dependencies, sc.technology_dependencies, (r) => `${norm(r.provider_category ?? r.provider_category_key)}:${norm(r.provider_name)}`),
          workforce_profile: sc.workforce_profile != null
            ? { ...(base.workforce_profile ?? {}), ...(sc.workforce_profile as object) }
            : base.workforce_profile,
        } as CompanyContextIntelligence;
        // Done with questions: stage the merged context and tell the user, but
        // don't save until they confirm via the "Save context" button.
        setIntelligenceContext(nextContext);
        setContextIntelligencePendingSave(nextContext);
        setContextIntelligenceMessages((prev) => [
          ...prev,
          {
            role: 'assistant' as const,
            content: 'That’s everything I need. Click “Save context” below to save your answers, or keep typing to add more detail.',
          },
        ]);
      } else if (data.nextQuestion) {
        setContextIntelligenceMessages((prev) =>
          isInitial
            ? [{ role: 'assistant' as const, content: data.nextQuestion }]
            : [...prev, { role: 'assistant' as const, content: data.nextQuestion }]
        );
      }
    } catch (e) {
      setErrorMessage((e as Error).message || 'Context intelligence capture failed');
    } finally {
      setContextIntelligenceChatLoading(false);
    }
  };

  const confirmSaveContextIntelligence = async () => {
    const pending = contextIntelligencePendingSave;
    if (!pending) return;
    await saveIntelligenceContext(pending);
    setContextIntelligencePendingSave(null);
    setContextIntelligencePanelOpen(false);
    setContextIntelligenceMessages([]);
    setSuccessMessage('Context intelligence saved.');
  };

  const openContextIntelligencePanel = () => {
    setContextIntelligenceMessages([]);
    setContextIntelligenceInput('');
    setContextIntelligencePendingSave(null);
    setContextIntelligencePanelOpen(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setContextIntelligenceChatLoading(true);
    sendContextIntelligenceMessage();
  };

  const openProblemTransformationPanel = async () => {
    if (!companyId) return;
    setProblemTransformationPanelOpen(true);
    setProblemTransformationLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetchWithAuth(
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
      const res = await fetchWithAuth(
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
      const res = await fetchWithAuth(
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
    const applyPendingProblemTransformationUpdates = async (
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
      // Persist the applied fields immediately — a real save, not just staged.
      await saveProfile(applied);
      setProblemTransformationInferPanelOpen(false);
    };

    const content = (userContent ?? problemTransformationInferInput).trim();
    const isAgreement =
      /^(yes|y|agree|agreed|approved?|ok|okay|apply|accept|go ahead|do it|proceed|sure)\b/i.test(
        content
      );
    if (!isInitial && pendingProblemTransformationUpdates && isAgreement) {
      const updates = pendingProblemTransformationUpdates;
      await applyPendingProblemTransformationUpdates(updates);
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
      const res = await fetchWithAuth(
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
  // Unified completion: blend the core profile fields (which sit near max once the
  // profile is set up) with Context Intelligence readiness, so ALL enrichment work
  // — revenue/geography/workforce/dependencies — moves the headline number. It dips
  // when context is sparse and climbs to the core level as context is captured.
  const uiCoreCompletion = overallProfileCompletion ?? uiOverallProfileCompletion;
  const uiIntelligenceReadinessScore = intelligenceReadiness?.score ?? 0;
  const uiUnifiedCompletion = Math.round(
    0.7 * uiCoreCompletion + 0.3 * uiIntelligenceReadinessScore
  );
  const uiConfidence = Math.max(
    0,
    Math.min(
      100,
      Number(
        activeProfile.overall_confidence ??
          activeProfile.confidence_score ??
          Math.round(uiUnifiedCompletion * 0.85)
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
    contextIntelligenceChatLoading,
    contextIntelligenceInput,
    contextIntelligenceMessages,
    contextIntelligencePanelOpen,
    contextIntelligencePendingSave,
    confirmSaveContextIntelligence,
    targetCustomerPendingSave,
    confirmSaveTargetCustomer,
    marketingIntelligencePendingSave,
    confirmSaveMarketingIntelligence,
    contextQuality,
    draftProfile,
    enrichmentLoading,
    enrichmentReviewingId,
    enrichmentSuggestions,
    errorMessage,
    fetchWithAuth,
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
    intelligenceContext,
    intelligenceContextLoading,
    intelligenceContextSaving,
    intelligenceReadiness,
    isAdmin,
    isAuthenticated,
    isCompanyAdmin,
    isCompanyLoading,
    isContentArchitect,
    isEditing,
    isOnboardingMode,
    isOnboardingResolving,
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
    onboardingContinuationVisible,
    openCampaignPurposePanel,
    openInferProblemTransformationPanel,
    openMarketingIntelligencePanel,
    openContextIntelligencePanel,
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
    reviewIntelligenceEnrichment,
    runIntelligenceEnrichment,
    router,
    saveProblemTransformation,
    saveIntelligenceContext,
    saveProfile,
    openCompetitorChat,
    sendCompetitorMessage,
    confirmSaveCompetitors,
    competitorChatOpen,
    setCompetitorChatOpen,
    competitorChatMessages,
    competitorChatInput,
    setCompetitorChatInput,
    competitorChatLoading,
    competitorSuggestions,
    competitorPendingSave,
    competitorUnderstanding: activeProfile.report_settings?.user_guidance?.competitor_understanding?.statement ?? '',
    saveCompetitorUnderstanding,
    saveUserGuidance,
    selectedCompanyId,
    selectedCompanyName,
    sendCampaignPurposeMessage,
    sendMarketingIntelligenceMessage,
    sendContextIntelligenceMessage,
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
    setContextIntelligenceChatLoading,
    setContextIntelligenceInput,
    setContextIntelligenceMessages,
    setContextIntelligencePanelOpen,
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
    skipOnboardingRefinement,
    successMessage,
    targetCustomerInput,
    targetCustomerLoading,
    targetCustomerMessages,
    targetCustomerPanelOpen,
    toTitleCase,
    uiConfidence,
    uiOverallProfileCompletion,
    uiUnifiedCompletion,
    uiProblemTransformationCompletion,
    updateActiveProfile,
    updateIntelligenceContext,
    updateOtherSocial,
    user,
    userRole,
  };
}
