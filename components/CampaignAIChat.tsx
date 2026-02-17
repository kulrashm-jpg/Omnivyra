import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Send, 
  Upload, 
  FileText, 
  Image, 
  Video, 
  Link,
  X,
  Minimize2,
  Maximize2,
  Settings,
  Key,
  Zap,
  AlertCircle,
  CheckCircle,
  Loader2,
  Brain,
  Sparkles,
  BookOpen,
  TrendingUp,
  Target,
  Calendar,
  Save
} from 'lucide-react';
import ChatVoiceButton from './ChatVoiceButton';
import { fetchWithAuth } from './community-ai/fetchWithAuth';

/** Renders AI message with proper structure: greeting, objective, theme, formats, reach, question */
function FormattedAIMessage({ message, className = '' }: { message: string; className?: string }) {
  const renderInline = (text: string): React.ReactNode => {
    const segments: React.ReactNode[] = [];
    let s = text;
    while (s) {
      const bi = s.indexOf('**');
      const ii = s.indexOf('*');
      const nextBi = bi >= 0 ? bi : s.length;
      const nextIi = (ii >= 0 && (ii !== 0 || s[1] !== '*')) ? ii : s.length;
      const next = Math.min(nextBi, nextIi);
      if (next < s.length) {
        if (next > 0) segments.push(s.slice(0, next));
        if (s[next] === '*') {
          if (s[next + 1] === '*') {
            const end = s.indexOf('**', next + 2);
            if (end >= 0) {
              segments.push(<strong key={segments.length}>{s.slice(next + 2, end)}</strong>);
              s = s.slice(end + 2);
              continue;
            }
          } else {
            const end = s.indexOf('*', next + 1);
            if (end >= 0 && end !== next + 1) {
              segments.push(<em key={segments.length}>{s.slice(next + 1, end)}</em>);
              s = s.slice(end + 1);
              continue;
            }
          }
        }
      }
      segments.push(s);
      break;
    }
    return <>{segments}</>;
  };
  const paragraphs = message.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className={`text-sm space-y-4 leading-relaxed ${className}`}>
      {paragraphs.map((p, i) => {
        const isGreeting = p.startsWith('Hello!') || (i === 0 && p.includes('help you turn'));
        const isTheme = p.startsWith('I see your theme:');
        const isSection = /^\*\*(Target regions|Suggested formats|Estimated reach)/.test(p);
        const isQuestion = /^\*\*(First question|Next question|Question \d+):/i.test(p);
        return (
          <div
            key={i}
            className={
              isGreeting ? 'font-semibold text-gray-900' :
              isTheme ? 'italic text-gray-700 pl-1 border-l-2 border-indigo-200' :
              isSection ? 'text-gray-800' :
              isQuestion ? 'font-semibold text-indigo-800 mt-2 pt-2 border-t border-gray-200' :
              'text-gray-700'
            }
          >
            {renderInline(p)}
          </div>
        );
      })}
    </div>
  );
}

interface ChatMessage {
  id: number;
  type: 'user' | 'ai';
  message: string;
  timestamp: string;
  attachments?: string[];
  provider?: string;
  campaignId?: string;
}

interface CampaignLearning {
  campaignId: string;
  campaignName: string;
  goals: any[];
  performance: {
    engagement: number;
    reach: number;
    conversions: number;
    actualResults: any[];
  };
  learnings: string[];
  improvements: string[];
}

interface RecommendationContext {
  target_regions?: string[] | null;
  context_payload?: Record<string, unknown> | null;
  source_opportunity_id?: string | null;
}

interface AIChatProps {
  isOpen: boolean;
  onClose: () => void;
  onMinimize: () => void;
  context?: string;
  companyId?: string;
  campaignId?: string;
  campaignData?: any;
  recommendationContext?: RecommendationContext | null;
  onProgramGenerated?: (program: any) => void;
  /** Stage 29: Governance lockdown — schedule button disabled */
  governanceLocked?: boolean;
  /** Stage 35: ROI + optimization headlines for AI context injection */
  optimizationContext?: { roiScore: number; headlines: string[] };
  /** Pre-filled planning context from campaign setup — AI will skip these questions */
  prefilledPlanning?: Record<string, unknown> | null;
}

type AIProvider = 'gpt' | 'claude' | 'demo';

const CAMPAIGN_AI_PROVIDER_KEY = 'virality-campaign-ai-provider';

function getStoredProvider(): AIProvider {
  if (typeof window === 'undefined') return 'claude';
  const s = localStorage.getItem(CAMPAIGN_AI_PROVIDER_KEY);
  if (s === 'gpt' || s === 'claude' || s === 'demo') return s;
  return 'claude';
}

type StructuredDay = {
  day: string;
  objective: string;
  content: string;
  platforms: Record<string, string>;
  hashtags?: string[];
  seo_keywords?: string[];
  meta_title?: string;
  meta_description?: string;
  hook?: string;
  cta?: string;
  best_time?: string;
  effort_score?: number;
  success_projection?: number;
};

type StructuredWeek = {
  week: number;
  theme?: string;
  daily?: StructuredDay[];
  /** Blueprint format fields */
  phase_label?: string;
  theme?: string;
  primary_objective?: string;
  platform_allocation?: Record<string, number>;
  content_type_mix?: string[];
  cta_type?: string;
  total_weekly_content_count?: number;
  weekly_kpi_focus?: string;
  daily?: Array<{
    day: string;
    objective?: string;
    content?: string;
    platforms?: Record<string, string>;
  }>;
};

type StructuredPlan = {
  weeks: StructuredWeek[];
  format?: 'blueprint' | 'legacy';
};

type RefinedDay = {
  week: number;
  day: string;
  objective: string;
  content: string;
  platforms: Record<string, string>;
  hashtags?: string[];
  seo_keywords?: string[];
  meta_title?: string;
  meta_description?: string;
  hook?: string;
  cta?: string;
  best_time?: string;
  effort_score?: number;
  success_projection?: number;
};

type PlatformCustomization = {
  day: string;
  platforms: Record<string, string>;
};

type AiHistoryEntry = {
  snapshot_hash: string;
  omnivyre_decision: any;
  structured_plan: StructuredPlan;
  scheduled_posts: Array<{
    id: string;
    platform: string;
    content: string;
    scheduled_for: string;
    status: string;
    created_at: string;
  }>;
  created_at: string;
};

export default function AIChat({ isOpen, onClose, onMinimize, context = "general", companyId, campaignId, campaignData, recommendationContext, onProgramGenerated, governanceLocked, optimizationContext, prefilledPlanning }: AIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showLearning, setShowLearning] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(getStoredProvider);
  const [isLoading, setIsLoading] = useState(false);
  const [modeLoading, setModeLoading] = useState<Record<string, boolean>>({});
  const [uiErrorMessage, setUiErrorMessage] = useState<string | null>(null);
  const [campaignLearnings, setCampaignLearnings] = useState<CampaignLearning[]>([]);
  const [showDateSelection, setShowDateSelection] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [showPlanPreview, setShowPlanPreview] = useState(false);
  const [structuredPlan, setStructuredPlan] = useState<StructuredPlan | null>(null);
  const [structuredPlanMessageId, setStructuredPlanMessageId] = useState<number | null>(null);
  const [showScheduleConfirm, setShowScheduleConfirm] = useState(false);
  const [isSchedulingPlan, setIsSchedulingPlan] = useState(false);
  const [uiSuccessMessage, setUiSuccessMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'history' | 'audit' | 'execution' | 'content' | 'performance' | 'memory' | 'business' | 'platform'>('chat');
  const [aiHistory, setAiHistory] = useState<AiHistoryEntry[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [auditReport, setAuditReport] = useState<any>(null);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [healthReport, setHealthReport] = useState<any>(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [optimizeWeekNumber, setOptimizeWeekNumber] = useState<number>(1);
  const [optimizeReason, setOptimizeReason] = useState<string>('');
  const [isOptimizingWeek, setIsOptimizingWeek] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<any>(null);
  const [executionPlan, setExecutionPlan] = useState<any>(null);
  const [isExecutionLoading, setIsExecutionLoading] = useState(false);
  const [executionWeekNumber, setExecutionWeekNumber] = useState<number>(1);
  const [schedulerPayload, setSchedulerPayload] = useState<any>(null);
  const [contentAssets, setContentAssets] = useState<any[]>([]);
  const [isContentLoading, setIsContentLoading] = useState(false);
  const [contentWeekNumber, setContentWeekNumber] = useState<number>(1);
  const [regenerateInstruction, setRegenerateInstruction] = useState<string>('');
  const [analyticsReport, setAnalyticsReport] = useState<any>(null);
  const [learningInsights, setLearningInsights] = useState<any>(null);
  const [isPerformanceLoading, setIsPerformanceLoading] = useState(false);
  const [performanceWeekNumber, setPerformanceWeekNumber] = useState<number>(1);
  const [campaignMemory, setCampaignMemory] = useState<any>(null);
  const [memoryOverlap, setMemoryOverlap] = useState<any>(null);
  const [forecastReport, setForecastReport] = useState<any>(null);
  const [roiReport, setRoiReport] = useState<any>(null);
  const [businessReport, setBusinessReport] = useState<any>(null);
  const [isBusinessLoading, setIsBusinessLoading] = useState(false);
  const [platformIntelAssetId, setPlatformIntelAssetId] = useState<string>('');
  const [platformIntelPlatform, setPlatformIntelPlatform] = useState<string>('linkedin');
  const [platformIntelContentType, setPlatformIntelContentType] = useState<string>('text');
  const [platformIntelData, setPlatformIntelData] = useState<any>(null);
  const [isPlatformIntelLoading, setIsPlatformIntelLoading] = useState(false);
  const [hasViewedPlanMessageId, setHasViewedPlanMessageId] = useState<number | null>(null);
  const [showPlanOverview, setShowPlanOverview] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resolvedCompanyId = useMemo(() => {
    if (companyId) return companyId;
    if (typeof window === 'undefined') return '';
    return (
      window.localStorage.getItem('selected_company_id') ||
      window.localStorage.getItem('company_id') ||
      ''
    );
  }, [companyId]);

  const ensureCompanyId = (): boolean => {
    if (!resolvedCompanyId) {
      setUiErrorMessage('Please select or create a campaign first.');
      return false;
    }
    return true;
  };

  // Debug: Log props when component mounts or props change
  useEffect(() => {
    console.log('CampaignAIChat props:', { isOpen, context, campaignId, hasCampaignData: !!campaignData });
  }, [isOpen, context, campaignId, campaignData]);

  // Initialize campaign-specific conversation
  useEffect(() => {
    if (campaignId && campaignData) {
      initializeCampaignThread(campaignId, campaignData);
    }
  }, [campaignId, campaignData, recommendationContext]);

  useEffect(() => {
    if (activeTab === 'history' && campaignId) {
      loadAiHistory(campaignId);
    }
  }, [activeTab, campaignId]);

  useEffect(() => {
    if (activeTab === 'audit' && campaignId) {
      loadAuditReport(campaignId);
    }
  }, [activeTab, campaignId, campaignData]);

  useEffect(() => {
    if (activeTab === 'audit' && campaignId) {
      loadHealthReport(campaignId);
    }
  }, [activeTab, campaignId, campaignData]);

  useEffect(() => {
    if (activeTab === 'execution' && campaignId) {
      loadExecutionPlan(campaignId);
    }
  }, [activeTab, campaignId, executionWeekNumber]);

  useEffect(() => {
    if (activeTab === 'content' && campaignId) {
      loadContentAssets(campaignId);
    }
  }, [activeTab, campaignId, contentWeekNumber]);

  useEffect(() => {
    if (activeTab === 'performance' && campaignId) {
      loadPerformanceInsights(campaignId);
    }
  }, [activeTab, campaignId, performanceWeekNumber]);

  useEffect(() => {
    if (activeTab === 'memory' && campaignId) {
      loadCampaignMemory(campaignId);
    }
  }, [activeTab, campaignId]);

  useEffect(() => {
    if (activeTab === 'business' && campaignId) {
      loadBusinessReports(campaignId);
    }
  }, [activeTab, campaignId]);

  useEffect(() => {
    if (activeTab === 'platform' && campaignId) {
      setPlatformIntelData(null);
      loadContentAssets(campaignId);
    }
  }, [activeTab, campaignId]);

  // Load campaign learnings
  useEffect(() => {
    loadCampaignLearnings();
  }, []);

  const handleProviderChange = (provider: AIProvider) => {
    setSelectedProvider(provider);
    if (typeof window !== 'undefined') {
      localStorage.setItem(CAMPAIGN_AI_PROVIDER_KEY, provider);
    }
  };

  useEffect(() => {
    const loadAdminStatus = async () => {
      try {
        const response = await fetch('/api/admin/check-super-admin');
        if (!response.ok) return;
        const data = await response.json();
        setIsAdmin(!!data?.isSuperAdmin);
      } catch (error) {
        console.warn('Unable to load admin status');
      }
    };
    loadAdminStatus();
  }, []);

  const saveAIContentForPlan = async (aiMessage: string) => {
    if (!campaignId) return;
    try {
      const response = await fetch('/api/campaigns/save-ai-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          aiContent: aiMessage,
          timestamp: new Date().toISOString(),
          provider: selectedProvider
        })
      });

      if (response.ok) {
        if (typeof window !== 'undefined') {
          try {
            window.sessionStorage.setItem(
              `campaign_chat_draft_${campaignId}`,
              JSON.stringify({ messages, savedAt: new Date().toISOString() })
            );
          } catch (e) {
            console.warn('Could not persist chat to sessionStorage', e);
          }
        }
        const successMessage: ChatMessage = {
          id: Date.now(),
          type: 'ai',
          message: '✅ Chat saved! Open Campaign planning (draft or edit) to continue with this conversation on the same page.',
          timestamp: new Date().toLocaleTimeString(),
          provider: getProviderName(selectedProvider),
          campaignId
        };
        setMessages(prev => [...prev, successMessage]);
      } else {
        throw new Error('Failed to save content');
      }
    } catch (error) {
      console.error('Error saving AI content:', error);
      const errorMessage: ChatMessage = {
        id: Date.now(),
        type: 'ai',
        message: '❌ Failed to save AI content. Please try again.',
        timestamp: new Date().toLocaleTimeString(),
        provider: getProviderName(selectedProvider),
        campaignId
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  };

  const serializeStructuredPlanToText = (plan: StructuredPlan): string => {
    return plan.weeks.map((w) => {
      const theme = w.theme || w.phase_label || `Week ${w.week}`;
      const platforms = w.platform_allocation
        ? Object.entries(w.platform_allocation).map(([p, n]) => `${p}: ${n}`).join(', ')
        : '';
      const content = (w.content_type_mix || []).join(', ');
      return `Week ${w.week}: ${theme}\nPlatforms: ${platforms || '—'}\nContent: ${content || '—'}`;
    }).join('\n\n');
  };

  const commitPlan = (aiMessage?: string) => {
    if (structuredPlan) {
      setSelectedPlan(serializeStructuredPlanToText(structuredPlan));
    } else if (aiMessage) {
      setSelectedPlan(aiMessage);
    }
    setShowPlanOverview(false);
    setShowPlanPreview(false);
    setShowDateSelection(true);
  };

  const viewPlan = (aiMessage?: string, messageId?: number) => {
    if (aiMessage) setSelectedPlan(aiMessage);
    if (messageId != null) setHasViewedPlanMessageId(messageId);
    if (structuredPlan) {
      setShowPlanOverview(true);
    } else {
      setShowPlanPreview(true);
    }
  };

  const requestDailyPlanForWeek = (weekNum: number) => {
    setNewMessage(`Generate the daily plan for Week ${weekNum} with specific content for each day (Monday–Sunday).`);
    setShowPlanOverview(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const generateDefaultPlan = () => {
    return `Social Media Campaign Plan

Weeks 1-3: Foundation & Brand Awareness
- Establish brand voice and visual identity
- Create foundational content themes
- Build initial audience engagement
- Focus on educational and value-driven content

Weeks 4-6: Content Diversification
- Introduce user-generated content
- Implement storytelling strategies
- Add interactive elements (polls, Q&As)
- Cross-platform content adaptation

Weeks 7-9: Community Building
- Foster deeper audience connections
- Launch community challenges
- Feature customer testimonials
- Engage with trending topics

Weeks 10-12: Optimization & Growth
- Analyze performance metrics
- Refine top-performing content
- Scale successful strategies
- Prepare for next campaign phase

This comprehensive approach ensures consistent growth and engagement across all platforms.`;
  };

  const create12WeekPlan = async (startDate: string) => {
    try {
      setIsLoading(true);
      
      // Check if we have a plan selected, if not create a default one
      const aiContent = selectedPlan || generateDefaultPlan();
      
      // Validate all required fields
      if (!campaignId) {
        console.error('Campaign ID is missing. Props received:', { campaignId, isOpen, context });
        throw new Error('Campaign ID is missing. Please refresh the page and try again.');
      }
      if (!startDate) {
        throw new Error('Start date is missing');
      }
      if (!aiContent) {
        throw new Error('AI content is missing');
      }
      
      console.log('Sending request with:', { 
        campaignId, 
        startDate, 
        aiContent: aiContent?.substring(0, 100) + '...', 
        provider: selectedProvider,
        hasSelectedPlan: !!selectedPlan,
        campaignIdType: typeof campaignId,
        startDateType: typeof startDate,
        aiContentLength: aiContent?.length
      });
      
      const response = await fetch('/api/campaigns/create-12week-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          startDate,
          aiContent,
          provider: selectedProvider
        })
      });

      if (response.ok) {
        const result = await response.json();
        
        // Show success message
        const successMessage: ChatMessage = {
          id: Date.now(),
          type: 'ai',
          message: `🎉 Campaign plan created successfully! Starting from ${new Date(startDate).toLocaleDateString()}. You can now view your plan in the hierarchical navigation.`,
          timestamp: new Date().toLocaleTimeString(),
          provider: getProviderName(selectedProvider),
          campaignId
        };
        setMessages(prev => [...prev, successMessage]);
        
        setShowDateSelection(false);
        setSelectedPlan('');
      } else {
        // Get the actual error message from the API response
        const errorData = await response.json();
        console.error('API Error Response:', errorData);
        throw new Error(`Failed to create plan: ${errorData.error || errorData.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error creating campaign plan:', error);
      const errorMessage: ChatMessage = {
        id: Date.now(),
        type: 'ai',
        message: '❌ Failed to create campaign plan. Please try again.',
        timestamp: new Date().toLocaleTimeString(),
        provider: getProviderName(selectedProvider),
        campaignId
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const buildRecommendationWelcome = (campaignData: any): string => {
    const name = campaignData?.name || 'this campaign';
    const desc = campaignData?.description || campaignData?.objective || '';
    const regions = recommendationContext?.target_regions?.filter(Boolean);
    const payload = recommendationContext?.context_payload as Record<string, unknown> | undefined;
    const formats = payload?.formats as string[] | undefined;
    const reachEst = payload?.reach_estimate;
    const parts: string[] = [
      `Hello! I'm here to help you turn **"${name}"** into a complete content marketing plan.`,
    ];
    if (prefilledPlanning && Object.keys(prefilledPlanning).length > 0) {
      parts.push('\n\nI already have from your setup:\n' + Object.entries(prefilledPlanning).map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`).join('\n'));
      parts.push(`\n\nI'll ask only what's still needed. Send any message to continue.`);
      return parts.join('');
    }
    if (desc) {
      parts.push(`\n\nI see your theme: *${desc.slice(0, 200)}${desc.length > 200 ? '...' : ''}*`);
    }
    if (regions && regions.length > 0) {
      parts.push(`\n\n**Target regions:** ${regions.join(', ')}`);
    }
    if (formats && formats.length > 0) {
      parts.push(`\n**Suggested formats:** ${formats.join(', ')}`);
    }
    if (reachEst) {
      parts.push(`\n**Estimated reach:** ${reachEst}`);
    }
    parts.push(`\n\nI'll ask you one question at a time. We need: target audience, available content (if any—and if you have content, which campaign objective it should serve and which week(s) to slot it into), tentative start date (YY-MM-DD format), campaign types, content & production capacity, duration, platforms, key messages, success metrics. Then say "Create my plan" or "I'm ready".\n\n**First question:** Who is your primary target audience? (e.g., professionals, entrepreneurs, parents, educators)`);
    return parts.join('');
  };

  const buildPrefilledWelcome = (name: string): string => {
    const pre = prefilledPlanning;
    if (!pre || Object.keys(pre).length === 0) return '';
    const items = Object.entries(pre).map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`).join('\n');
    return `Hello! I'm your AI assistant for "${name}".

I already have these from your campaign setup:
${items}

I'll ask only what's still needed. Send any message to continue—I'll skip the questions you've already answered.\n\n`;
  };

  const GENERIC_WELCOME = (name: string) => {
    const prefilledIntro = buildPrefilledWelcome(name);
    const base = prefilledIntro || `Hello! I'm your AI assistant for "${name}". I'll ask you one question at a time to build your campaign plan.

**Planning checklist:** target audience, available content (if any—if you have content, we'll ask which objective it serves and which week(s) to slot it into), tentative start date (YY-MM-DD format), campaign types, content & production capacity, duration, platforms, key messages, success metrics. Each week will have a concrete theme decided by AI before scheduling.

When we have everything, say "Create my plan" or "I'm ready" and I'll generate it.

`;
    return base + (prefilledIntro ? '' : '**First question:** Who is your primary target audience? (e.g., professionals, entrepreneurs, parents, educators)');
  };

  const initializeCampaignThread = async (campaignId: string, campaignData: any) => {
    // Load existing conversation for this campaign
    const existingMessages = await loadCampaignMessages(campaignId);
    
    if (existingMessages.length === 0) {
      const welcomeText = recommendationContext && (recommendationContext.target_regions?.length || recommendationContext.context_payload)
        ? buildRecommendationWelcome(campaignData)
        : GENERIC_WELCOME(campaignData?.name || 'this campaign');
      const welcomeMessage: ChatMessage = {
        id: Date.now(),
        type: 'ai',
        message: welcomeText,
        timestamp: new Date().toLocaleTimeString(),
        provider: getProviderName(selectedProvider),
        campaignId
      };
      setMessages([welcomeMessage]);
    } else {
      setMessages(existingMessages);
    }
  };

  const loadCampaignMessages = async (campaignId: string): Promise<ChatMessage[]> => {
    if (typeof window !== 'undefined') {
      try {
        const stored = window.sessionStorage.getItem(`campaign_chat_draft_${campaignId}`);
        if (stored) {
          const parsed = JSON.parse(stored) as { messages?: ChatMessage[] };
          if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
            return parsed.messages;
          }
        }
      } catch (e) {
        console.warn('Could not load saved chat draft', e);
      }
    }
    try {
      const response = await fetch(`/api/ai/campaign-messages?campaignId=${campaignId}`);
      if (response.ok) {
        const data = await response.json();
        return data.messages || [];
      }
    } catch (error) {
      console.error('Error loading campaign messages:', error);
    }
    return [];
  };

  const isWeeklyPlanMessage = (msg: string): boolean => {
    if (!msg || msg.length < 100) return false;
    const hasWeekStructure = /\bWeek\s+\d+/i.test(msg) || /\bWeeks\s+\d+\s*[-–]\s*\d+/i.test(msg);
    const hasPlatformOrContent = /\b(LinkedIn|Facebook|Instagram|Twitter|TikTok|YouTube|Blog|Video|Post|Carousel|Reel)\b/i.test(msg);
    return hasWeekStructure && (hasPlatformOrContent || msg.length > 500);
  };

  const saveCampaignMessage = async (message: ChatMessage) => {
    try {
      await fetch('/api/ai/campaign-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, campaignId })
      });
    } catch (error) {
      console.error('Error saving campaign message:', error);
    }
  };

  const loadCampaignLearnings = async () => {
    try {
      const response = await fetch('/api/ai/campaign-learnings');
      if (response.ok) {
        const data = await response.json();
        setCampaignLearnings(data.learnings || []);
      }
    } catch (error) {
      console.error('Error loading campaign learnings:', error);
    }
  };

  const extractProgramFromResponse = (response: string) => {
    try {
      // Look for structured program data in the response
      const weeks = [];
      const platforms = ['LinkedIn', 'Facebook', 'Instagram', 'Twitter', 'YouTube', 'TikTok'];
      
      // Extract week-by-week content
      for (let i = 1; i <= 12; i++) {
        const weekMatch = response.match(new RegExp(`Week ${i}[\\s\\S]*?(?=Week ${i + 1}|$)`, 'i'));
        if (weekMatch) {
          const weekContent = weekMatch[0];
          const content = [];
          
          // Extract content types and platforms
          platforms.forEach(platform => {
            if (weekContent.toLowerCase().includes(platform.toLowerCase())) {
              content.push({
                type: 'post',
                platform: platform.toLowerCase(),
                description: `Week ${i} ${platform} content`
              });
            }
          });
          
          weeks.push({
            weekNumber: i,
            theme: `Week ${i} Theme`,
            content: content.length > 0 ? content : [{
              type: 'post',
              platform: 'linkedin',
              description: `Week ${i} content`
            }]
          });
        }
      }
      
      return {
        description: 'AI-generated campaign content program',
        totalContent: weeks.reduce((sum, week) => sum + week.content.length, 0),
        platforms: platforms,
        weeks: weeks.length > 0 ? weeks : generateDefaultProgram()
      };
    } catch (error) {
      console.error('Error extracting program:', error);
      return generateDefaultProgram();
    }
  };

  const generateDefaultProgram = () => {
    const weeks = [];
    const platforms = ['linkedin', 'facebook', 'instagram', 'twitter', 'youtube', 'tiktok'];
    
    for (let i = 1; i <= 12; i++) {
      weeks.push({
        weekNumber: i,
        theme: `Week ${i} Theme`,
        content: platforms.map(platform => ({
          type: 'post',
          platform: platform,
          description: `Week ${i} ${platform} content`
        }))
      });
    }
    
    return {
      description: 'AI-generated 12-week content program',
      totalContent: weeks.reduce((sum, week) => sum + week.content.length, 0),
      platforms: platforms.map(p => p.charAt(0).toUpperCase() + p.slice(1)),
      weeks: weeks
    };
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!newMessage.trim() && attachments.length === 0) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      type: 'user',
      message: newMessage,
      timestamp: new Date().toLocaleTimeString(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      campaignId
    };

    setMessages(prev => [...prev, userMessage]);
    await saveCampaignMessage(userMessage);
    
    setNewMessage('');
    setAttachments([]);
    setIsTyping(true);
    setIsLoading(true);
    setUiErrorMessage(null);

    try {
      let response: string = '';
      let provider: string;
      let structuredPlanFromResponse: StructuredPlan | undefined;

      // Create AI response message placeholder for streaming
      const aiResponseId = Date.now() + 1;
      const aiResponse: ChatMessage = {
        id: aiResponseId,
        type: 'ai',
        message: '',
        timestamp: new Date().toLocaleTimeString(),
        provider: '',
        campaignId
      };

      if (selectedProvider === 'demo') {
        await new Promise(resolve => setTimeout(resolve, 1500));
        response = generateDemoResponse(newMessage, context, campaignData, campaignLearnings);
        provider = 'Demo AI';
        aiResponse.message = response;
        aiResponse.provider = provider;
        setMessages(prev => [...prev, aiResponse]);
        await saveCampaignMessage(aiResponse);
      } else if (selectedProvider === 'gpt' || selectedProvider === 'claude') {
        provider = selectedProvider === 'gpt' ? 'GPT-4' : 'Claude 3.5 Sonnet';
        aiResponse.provider = provider;
        setMessages(prev => [...prev, aiResponse]);

        const mode = context.toLowerCase().includes('daily')
          ? 'refine_day'
          : context.toLowerCase().includes('campaign-planning')
          ? 'generate_plan'
          : 'platform_customize';

        setModeLoading((prev) => ({ ...prev, [mode]: true }));

        const targetDay = extractTargetDay(newMessage);
        const platforms = extractPlatforms(newMessage);

        const conversationHistory = [...messages, userMessage].map((m) => ({
          type: m.type as 'user' | 'ai',
          message: m.message,
        }));

        const planResponse = await callCampaignPlanAPI(
          newMessage,
          mode,
          {
            durationWeeks: mode === 'generate_plan' ? 12 : undefined,
            targetDay: mode !== 'generate_plan' ? targetDay : undefined,
            platforms: mode === 'platform_customize' ? platforms : undefined,
            conversationHistory: mode === 'generate_plan' ? conversationHistory : undefined,
          }
        );

        if (planResponse.conversationalResponse) {
          response = planResponse.conversationalResponse;
        } else if (planResponse.plan) {
          structuredPlanFromResponse = planResponse.plan;
          setStructuredPlan(planResponse.plan);
          setStructuredPlanMessageId(aiResponseId);
          console.log('Structured plan received', planResponse.plan);
          response = 'Structured plan generated.';
        } else if (planResponse.day) {
          setStructuredPlan((prev) =>
            prev ? updatePlanWithRefinedDay(prev, planResponse.day) : prev
          );
          console.log('Refined day received', planResponse.day);
          response = `Updated ${planResponse.day.day} for week ${planResponse.day.week}.`;
        } else if (planResponse.platform_content) {
          setStructuredPlan((prev) =>
            prev ? updatePlanWithPlatformCustomization(prev, planResponse.platform_content) : prev
          );
          console.log('Platform customization received', planResponse.platform_content);
          response = `Updated platform versions for ${planResponse.platform_content.day}.`;
        } else {
          setUiErrorMessage(
            'We did not receive a structured response. Please try again.'
          );
          response = 'No structured response received.';
        }

        setMessages(prev => prev.map(msg =>
          msg.id === aiResponseId
            ? { ...msg, message: response }
            : msg
        ));
        await saveCampaignMessage({ ...aiResponse, message: response });
        setModeLoading((prev) => ({ ...prev, [mode]: false }));
      } else {
        throw new Error('Invalid provider');
      }

      // Check if AI generated a campaign program
      if (onProgramGenerated && context === 'campaign-planning') {
        const planForProgram = structuredPlanFromResponse || structuredPlan;
        if (planForProgram) {
          const programData = convertStructuredPlanToProgram(planForProgram);
          onProgramGenerated(programData);
        } else {
          const programMatch = response.match(/(\d+.*week.*program|week.*program|campaign.*program|weekly.*program)/i);
          if (programMatch || response.includes('Week 1') || response.includes('Week 2')) {
            const programData = extractProgramFromResponse(response);
            if (programData) {
              onProgramGenerated(programData);
            }
          }
        }
      }
      
      setIsTyping(false);
      setIsLoading(false);
    } catch (error) {
      console.error('Error calling AI API:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const isSchemaError =
        errorMessage.toLowerCase().includes('schema') ||
        errorMessage.toLowerCase().includes('validation');
      setUiErrorMessage(
        isSchemaError
          ? 'We could not parse the AI response. Please try again.'
          : 'We could not complete that request. Please try again in a moment.'
      );
      const errorResponse: ChatMessage = {
        id: Date.now() + 1,
        type: 'ai',
        message: `Sorry, I encountered an error with ${selectedProvider.toUpperCase()}. Please check your API key and try again.`,
        timestamp: new Date().toLocaleTimeString(),
        provider: 'Error',
        campaignId
      };
      setMessages(prev => [...prev, errorResponse]);
      setIsTyping(false);
      setIsLoading(false);
      setModeLoading({});
    }
  };

  const callCampaignPlanAPI = async (
    message: string,
    mode: 'generate_plan' | 'refine_day' | 'platform_customize',
    options?: {
      durationWeeks?: number;
      targetDay?: string;
      platforms?: string[];
      conversationHistory?: Array<{ type: 'user' | 'ai'; message: string }>;
    }
  ): Promise<{
    plan?: StructuredPlan;
    day?: RefinedDay;
    platform_content?: PlatformCustomization;
    conversationalResponse?: string;
  }> => {
    const response = await fetchWithAuth('/api/campaigns/ai/plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        campaignId,
        mode,
        message,
        durationWeeks: options?.durationWeeks,
        targetDay: options?.targetDay,
        platforms: options?.platforms,
        messages: options?.conversationHistory,
        recommendationContext,
        optimizationContext,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'AI plan API error' }));
      throw new Error(errorData.error || 'AI plan API error');
    }

    const data = await response.json();
    return {
      plan: data.plan,
      day: data.day,
      platform_content: data.platform_content,
      conversationalResponse: data.conversationalResponse,
    };
  };

  const generateDemoResponse = (userMessage: string, context: string, campaignData: any, learnings: CampaignLearning[]): string => {
    const responses = {
      'campaign-planning': [
        `Based on your campaign "${campaignData?.name || 'current campaign'}" and learnings from ${learnings.length} previous campaigns, I recommend focusing on high-engagement content types. Your past campaigns showed that video content performed 25% better than text posts.`,
        `Looking at your campaign goals and historical data, I suggest creating a content mix of 60% educational, 30% promotional, and 10% entertaining content. This ratio worked well in your previous campaigns.`,
        `I can see from your past campaigns that LinkedIn and Twitter performed best for your audience. Let me help you optimize your content strategy based on this data.`
      ],
      'market-analysis': [
        `Analyzing trends for your campaign "${campaignData?.name || 'current campaign'}" and comparing with your ${learnings.length} previous campaigns, I see opportunities in AI content creation (+45% growth). Your past campaigns in this area showed 30% higher engagement.`,
        `Based on your campaign history, I notice that competitor analysis helped improve your reach by 40% in previous campaigns. Let me analyze current competitors for your industry.`,
        `Your past campaigns showed that posting on Tuesday-Thursday at 2-4 PM generated the highest engagement. I'll factor this into your current campaign analysis.`
      ],
      'content-creation': [
        `For your campaign "${campaignData?.name || 'current campaign'}", I'll create content based on what worked in your ${learnings.length} previous campaigns. Your audience responded best to storytelling posts and how-to guides.`,
        `Looking at your campaign goals and past performance, I suggest creating 3 LinkedIn articles, 5 Twitter posts, and 2 Instagram stories. This mix generated 35% higher engagement in your previous campaigns.`,
        `Based on your campaign data, I'll adapt content for each platform using the strategies that worked best in your past campaigns.`
      ],
      'schedule-review': [
        `Reviewing your campaign schedule against ${learnings.length} previous campaigns, I notice optimal posting times that could increase engagement by 25%. Your past campaigns showed best results on weekdays.`,
        `Based on your campaign history, I suggest adjusting Instagram posts to peak hours (2-4 PM) as this timing worked best in your previous campaigns.`,
        `Your past campaigns showed that spreading content across 3-4 days per week generated 40% higher reach. Let me optimize your current schedule accordingly.`
      ],
      'general': [
        `I'm here to help with your campaign "${campaignData?.name || 'current campaign'}" using insights from your ${learnings.length} previous campaigns. What specific area would you like assistance with?`,
        `I can help with campaign planning, market analysis, content creation, or scheduling optimization, all informed by your past campaign performance data.`,
        `Let me know what you'd like to work on, and I'll provide guidance based on your campaign history and proven strategies.`
      ]
    };

    const contextResponses = responses[context as keyof typeof responses] || responses.general;
    return contextResponses[Math.floor(Math.random() * contextResponses.length)];
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const fileNames = Array.from(files).map(file => file.name);
      setAttachments(prev => [...prev, ...fileNames]);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const getProviderIcon = (provider: AIProvider) => {
    switch (provider) {
      case 'gpt': return <Zap className="h-4 w-4" />;
      case 'claude': return <Brain className="h-4 w-4" />;
      case 'demo': return <Sparkles className="h-4 w-4" />;
      default: return <Zap className="h-4 w-4" />;
    }
  };

  const getProviderName = (provider: AIProvider) => {
    switch (provider) {
      case 'gpt': return 'GPT-4';
      case 'claude': return 'Claude 3.5 Sonnet';
      case 'demo': return 'Demo AI';
      default: return 'AI Assistant';
    }
  };

  const updatePlanWithRefinedDay = (plan: StructuredPlan, refinedDay: RefinedDay): StructuredPlan => {
    return {
      weeks: plan.weeks.map((week) => {
        if (week.week !== refinedDay.week) return week;
        return {
          ...week,
          daily: week.daily.map((day) =>
            day.day.toLowerCase() === refinedDay.day.toLowerCase()
              ? {
                  day: refinedDay.day,
                  objective: refinedDay.objective,
                  content: refinedDay.content,
                  platforms: refinedDay.platforms,
                }
              : day
          ),
        };
      }),
    };
  };

  const updatePlanWithPlatformCustomization = (
    plan: StructuredPlan,
    customization: PlatformCustomization
  ): StructuredPlan => {
    const targetDay = customization.day.toLowerCase();
    return {
      weeks: plan.weeks.map((week) => ({
        ...week,
        daily: week.daily.map((day) =>
          day.day.toLowerCase() === targetDay
            ? {
                ...day,
                platforms: {
                  ...day.platforms,
                  ...customization.platforms,
                },
              }
            : day
        ),
      })),
    };
  };

  const renderStructuredPlan = (plan: StructuredPlan) => {
    return (
      <div className="space-y-4">
        {plan.weeks.map((week) => {
          const isBlueprint = week.platform_allocation && Object.keys(week.platform_allocation).length > 0;
          const themeLabel = week.phase_label || week.theme || `Week ${week.week}`;
          return (
          <div key={week.week} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-gray-900">Week {week.week}</div>
              <div className="text-xs text-gray-500">{themeLabel}</div>
            </div>
            {isBlueprint ? (
              <div className="space-y-2 text-xs">
                {week.primary_objective && <div className="text-gray-600">{week.primary_objective}</div>}
                {week.platform_allocation && (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(week.platform_allocation).map(([p, n]) => (
                      <span key={p} className="bg-gray-100 px-2 py-0.5 rounded">{p}: {n}</span>
                    ))}
                  </div>
                )}
                {week.cta_type && <div>CTA: {week.cta_type}</div>}
                {week.weekly_kpi_focus && <div>KPI: {week.weekly_kpi_focus}</div>}
              </div>
            ) : (
            <div className="space-y-3">
              {(week.daily || []).map((day) => (
                <div key={`${week.week}-${day.day}`} className="border-t pt-3">
                  <div className="text-sm font-medium text-gray-800">{day.day}</div>
                  <div className="text-xs text-gray-600 mt-1">Objective: {day.objective}</div>
                  <div className="text-xs text-gray-700 mt-1">{day.content}</div>
                  {(day.hook || day.cta || day.best_time) && (
                    <div className="mt-2 text-xs text-gray-600 space-y-1">
                      {day.hook && <div>Hook: {day.hook}</div>}
                      {day.cta && <div>CTA: {day.cta}</div>}
                      {day.best_time && <div>Best time: {day.best_time}</div>}
                    </div>
                  )}
                  {(day.meta_title || day.meta_description || day.seo_keywords?.length) && (
                    <div className="mt-2 text-xs text-gray-600 space-y-1">
                      {day.meta_title && <div>Meta title: {day.meta_title}</div>}
                      {day.meta_description && <div>Meta description: {day.meta_description}</div>}
                      {day.seo_keywords && day.seo_keywords.length > 0 && (
                        <div>SEO keywords: {day.seo_keywords.join(', ')}</div>
                      )}
                    </div>
                  )}
                  {day.hashtags && day.hashtags.length > 0 && (
                    <div className="mt-2 text-xs text-gray-600">
                      Hashtags: {day.hashtags.map((tag) => `#${tag}`).join(' ')}
                    </div>
                  )}
                  {(day.effort_score !== undefined || day.success_projection !== undefined) && (
                    <div className="mt-2 text-xs text-gray-600">
                      {day.effort_score !== undefined && (
                        <span>Effort: {day.effort_score}</span>
                      )}
                      {day.effort_score !== undefined && day.success_projection !== undefined && (
                        <span> • </span>
                      )}
                      {day.success_projection !== undefined && (
                        <span>Success: {day.success_projection}</span>
                      )}
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    {Object.entries(day.platforms || {}).map(([platform, text]) => (
                      <div key={`${week.week}-${day.day}-${platform}`} className="bg-gray-50 rounded p-2">
                        <div className="text-xs font-semibold text-gray-700 capitalize">{platform}</div>
                        <div className="text-xs text-gray-600 mt-1">{text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>
          );
        })}
      </div>
    );
  };

  const scheduleStructuredPlan = async () => {
    if (!campaignId || !structuredPlan) {
      setUiErrorMessage('Campaign and structured plan are required to schedule.');
      return;
    }

    try {
      setIsSchedulingPlan(true);
      setUiErrorMessage(null);
      setUiSuccessMessage(null);

      const response = await fetchWithAuth(`/api/campaigns/${campaignId}/schedule-structured-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: structuredPlan }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg = errorData.message || errorData.error || 'Schedule API error';
        throw new Error(msg);
      }

      const data = await response.json();
      setUiSuccessMessage(
        `Scheduled ${data.scheduled_count || 0} posts. Skipped ${data.skipped_count || 0}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to schedule the plan. Please try again.';
      console.error('Error scheduling structured plan:', error);
      setUiErrorMessage(message);
    } finally {
      setIsSchedulingPlan(false);
      setShowScheduleConfirm(false);
    }
  };

  const loadAiHistory = async (id: string) => {
    try {
      setIsHistoryLoading(true);
      const response = await fetch(`/api/campaigns/${id}/ai-history`);
      if (!response.ok) {
        throw new Error('Failed to load AI history');
      }
      const data = await response.json();
      setAiHistory(data.history || []);
    } catch (error) {
      console.error('Error loading AI history:', error);
      setUiErrorMessage('Failed to load AI history. Please try again.');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const loadAuditReport = async (id: string) => {
    try {
      setIsAuditLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/audit-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to load audit report');
      }
      const data = await response.json();
      setAuditReport(data);
    } catch (error) {
      console.error('Error loading audit report:', error);
      setAuditReport(null);
    } finally {
      setIsAuditLoading(false);
    }
  };

  const loadHealthReport = async (id: string) => {
    try {
      setIsHealthLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/health-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to load health report');
      }
      const data = await response.json();
      setHealthReport(data);
    } catch (error) {
      console.error('Error loading health report:', error);
      setHealthReport(null);
    } finally {
      setIsHealthLoading(false);
    }
  };

  const handleOptimizeWeek = async () => {
    if (!campaignId || !optimizeWeekNumber) return;
    setIsOptimizingWeek(true);
    try {
      const response = await fetch('/api/campaigns/optimize-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber: optimizeWeekNumber,
          reason: optimizeReason,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to optimize week');
      }
      const data = await response.json();
      setOptimizeResult(data);
      if (data?.health_report) {
        setHealthReport(data.health_report);
      }
    } catch (error) {
      console.error('Error optimizing week:', error);
      setUiErrorMessage('Failed to optimize week. Please try again.');
    } finally {
      setIsOptimizingWeek(false);
    }
  };

  const loadExecutionPlan = async (id: string, force = false) => {
    try {
      setIsExecutionLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/platform-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
          weekNumber: executionWeekNumber,
          force,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to load execution plan');
      }
      const data = await response.json();
      setExecutionPlan(data.plan || null);
      if (data.healthReport) {
        setHealthReport(data.healthReport);
      }
    } catch (error) {
      console.error('Error loading execution plan:', error);
      setExecutionPlan(null);
    } finally {
      setIsExecutionLoading(false);
    }
  };

  const handleApproveScheduling = async () => {
    if (!campaignId) return;
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/scheduler-payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId,
          weekNumber: executionWeekNumber,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to build scheduler payload');
      }
      const data = await response.json();
      setSchedulerPayload(data.payload || null);
      if (data.healthReport) {
        setHealthReport(data.healthReport);
      }
    } catch (error) {
      console.error('Error building scheduler payload:', error);
      setUiErrorMessage('Failed to build scheduler payload. Please try again.');
    }
  };

  const loadContentAssets = async (id: string) => {
    try {
      setIsContentLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch(
        `/api/content/list?companyId=${encodeURIComponent(resolvedCompanyId)}&campaignId=${id}&weekNumber=${contentWeekNumber}`
      );
      if (!response.ok) {
        throw new Error('Failed to load content assets');
      }
      const data = await response.json();
      setContentAssets(data.assets || []);
      const planResponse = await fetch('/api/campaigns/platform-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
          weekNumber: contentWeekNumber,
        }),
      });
      if (planResponse.ok) {
        const planData = await planResponse.json();
        setExecutionPlan(planData.plan || null);
        if (planData.healthReport) {
          setHealthReport(planData.healthReport);
        }
      }
    } catch (error) {
      console.error('Error loading content assets:', error);
      setContentAssets([]);
    } finally {
      setIsContentLoading(false);
    }
  };

  const handleGenerateContent = async (day: string) => {
    if (!campaignId) return;
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/content/generate-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId,
          weekNumber: contentWeekNumber,
          day,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to generate content');
      }
      await loadContentAssets(campaignId);
    } catch (error) {
      console.error('Error generating content:', error);
      setUiErrorMessage('Failed to generate content.');
    }
  };

  const handleRegenerateContent = async (assetId: string) => {
    if (!regenerateInstruction) {
      setUiErrorMessage('Please provide an instruction for regeneration.');
      return;
    }
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/content/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, assetId, instruction: regenerateInstruction }),
      });
      if (!response.ok) {
        throw new Error('Failed to regenerate content');
      }
      await loadContentAssets(campaignId || '');
    } catch (error) {
      console.error('Error regenerating content:', error);
      setUiErrorMessage('Failed to regenerate content.');
    }
  };

  const handleApproveContent = async (assetId: string) => {
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/content/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, assetId }),
      });
      if (!response.ok) {
        throw new Error('Failed to approve content');
      }
      await loadContentAssets(campaignId || '');
    } catch (error) {
      console.error('Error approving content:', error);
      setUiErrorMessage('Failed to approve content.');
    }
  };

  const handleRejectContent = async (assetId: string) => {
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/content/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, assetId, reason: 'Needs revisions' }),
      });
      if (!response.ok) {
        throw new Error('Failed to reject content');
      }
      await loadContentAssets(campaignId || '');
    } catch (error) {
      console.error('Error rejecting content:', error);
      setUiErrorMessage('Failed to reject content.');
    }
  };

  const handleTrackingLinkClick = async (trackingUrl: string, platform: string) => {
    try {
      await fetch('/api/tracking/link-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking_url: trackingUrl,
          campaign_id: campaignId,
          platform,
        }),
      });
    } catch (error) {
      console.error('Tracking link click failed', error);
    } finally {
      window.location.href = trackingUrl;
    }
  };

  const loadPerformanceInsights = async (id: string) => {
    try {
      setIsPerformanceLoading(true);
      if (!ensureCompanyId()) return;
      const analyticsResponse = await fetch('/api/analytics/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
          timeframe: 'latest',
        }),
      });
      if (analyticsResponse.ok) {
        const data = await analyticsResponse.json();
        setAnalyticsReport(data);
      } else {
        setAnalyticsReport(null);
      }
      const learningResponse = await fetch('/api/learning/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
        }),
      });
      if (learningResponse.ok) {
        const data = await learningResponse.json();
        setLearningInsights(data);
      } else {
        setLearningInsights(null);
      }
    } catch (error) {
      console.error('Error loading analytics/learning:', error);
      setAnalyticsReport(null);
      setLearningInsights(null);
    } finally {
      setIsPerformanceLoading(false);
    }
  };

  const handleApplyInsightsToWeek = async () => {
    if (!campaignId) return;
    try {
      const response = await fetch('/api/campaigns/optimize-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber: performanceWeekNumber,
          reason: 'Apply learning insights',
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to apply insights');
      }
      const data = await response.json();
      if (data.health_report) {
        setHealthReport(data.health_report);
      }
    } catch (error) {
      console.error('Error applying insights:', error);
      setUiErrorMessage('Failed to apply insights.');
    }
  };

  const loadCampaignMemory = async (id: string) => {
    try {
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/campaigns/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to load campaign memory');
      }
      const data = await response.json();
      setCampaignMemory(data);
      const overlapResponse = await fetch('/api/campaigns/validate-uniqueness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          campaignId: id,
          proposedPlan: {
            themes: data.pastThemes,
            topics: data.pastTopics,
            hooks: data.pastHooks,
            messages: data.pastContentSummaries,
          },
        }),
      });
      if (overlapResponse.ok) {
        const overlapData = await overlapResponse.json();
        setMemoryOverlap(overlapData);
      } else {
        setMemoryOverlap(null);
      }
    } catch (error) {
      console.error('Error loading campaign memory:', error);
      setCampaignMemory(null);
      setMemoryOverlap(null);
    }
  };

  const loadBusinessReports = async (id: string) => {
    try {
      setIsBusinessLoading(true);
      if (!ensureCompanyId()) return;
      const forecastResponse = await fetch('/api/campaigns/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, campaignId: id }),
      });
      if (forecastResponse.ok) {
        setForecastReport(await forecastResponse.json());
      }
      const roiResponse = await fetch('/api/campaigns/roi-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: id, costInputs: {} }),
      });
      if (roiResponse.ok) {
        setRoiReport(await roiResponse.json());
      }
      const businessResponse = await fetch('/api/campaigns/business-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: resolvedCompanyId, campaignId: id }),
      });
      if (businessResponse.ok) {
        setBusinessReport(await businessResponse.json());
      }
    } catch (error) {
      console.error('Error loading business reports:', error);
      setForecastReport(null);
      setRoiReport(null);
      setBusinessReport(null);
    } finally {
      setIsBusinessLoading(false);
    }
  };

  const handlePlatformIntel = async () => {
    if (!platformIntelAssetId) {
      setUiErrorMessage('Select a content asset to format.');
      return;
    }
    try {
      setIsPlatformIntelLoading(true);
      if (!ensureCompanyId()) return;
      const response = await fetch('/api/platform/format-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: resolvedCompanyId,
          contentAssetId: platformIntelAssetId,
          platform: platformIntelPlatform,
          contentType: platformIntelContentType,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to format content');
      }
      const data = await response.json();
      setPlatformIntelData(data);
    } catch (error) {
      console.error('Error formatting platform content:', error);
      setPlatformIntelData(null);
      setUiErrorMessage('Failed to format content.');
    } finally {
      setIsPlatformIntelLoading(false);
    }
  };

  const extractTargetDay = (text: string): string | undefined => {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const lower = text.toLowerCase();
    const match = days.find((day) => lower.includes(day));
    if (!match) return undefined;
    return match.charAt(0).toUpperCase() + match.slice(1);
  };

  const extractPlatforms = (text: string): string[] | undefined => {
    const candidates = ['linkedin', 'instagram', 'twitter', 'x', 'youtube', 'facebook', 'tiktok'];
    const lower = text.toLowerCase();
    const found = candidates.filter((platform) => lower.includes(platform));
    if (found.length === 0) return undefined;
    return found.map((platform) => (platform === 'x' ? 'twitter' : platform));
  };

  const convertStructuredPlanToProgram = (plan: StructuredPlan) => {
    const platformSet = new Set<string>();
    const weeks = plan.weeks.map((week) => {
      const theme = week.phase_label || week.theme || `Week ${week.week}`;
      let content: Array<{ type: string; platform: string; description: string; day: string }> = [];
      if (week.daily?.length) {
        content = week.daily.flatMap((day) =>
          Object.entries(day.platforms || {}).map(([platform, text]) => {
            platformSet.add(platform);
            return { type: 'post', platform, description: text, day: day.day };
          })
        );
      } else if (week.platform_allocation && Object.keys(week.platform_allocation).length > 0) {
        for (const [platform, count] of Object.entries(week.platform_allocation)) {
          platformSet.add(platform);
          for (let i = 0; i < count; i++) {
            content.push({
              type: 'post',
              platform,
              description: `Content for ${theme} (${platform})`,
              day: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i % 7],
            });
          }
        }
      }

      return { weekNumber: week.week, theme, content };
    });

    return {
      description: 'AI-generated 12-week content program',
      totalContent: weeks.reduce((sum, week) => sum + week.content.length, 0),
      platforms: Array.from(platformSet).map(
        (p) => p.charAt(0).toUpperCase() + p.slice(1)
      ),
      weeks,
    };
  };

  const renderPlanSummary = (plan: StructuredPlan) => {
    const weekCount = plan.weeks.length;
    const dayCount = plan.weeks.reduce((sum, week) => sum + week.daily.length, 0);
    return `${weekCount} weeks • ${dayCount} days`;
  };

  const isBusy = isLoading || isSchedulingPlan;

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex ${isFullscreen ? 'items-stretch justify-stretch p-0' : 'items-center justify-center p-2 sm:p-4'}`}>
      <div className={`bg-white shadow-2xl flex flex-col ${isFullscreen ? 'h-full w-full max-w-none rounded-none' : 'w-[min(95vw,90rem)] h-[min(90vh,calc(100vh-1rem))] min-w-[20rem] min-h-[20rem] rounded-2xl'}`}>
        {/* Header */}
        <div className={`bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-4 flex items-center justify-between ${isFullscreen ? 'rounded-none' : 'rounded-t-2xl'}`}>
          <div>
            <h3 className="text-lg font-semibold">Campaign AI Assistant</h3>
            <p className="text-indigo-100 text-sm">{campaignData?.name || 'Campaign'}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowLearning(!showLearning)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="View Campaign Learnings"
            >
              <BookOpen className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              onClick={onMinimize}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Campaign Learnings Panel */}
        {showLearning && (
          <div className="bg-blue-50 border-b border-blue-200 p-4">
            <h4 className="font-semibold text-blue-900 mb-2">Campaign Learnings ({campaignLearnings.length})</h4>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {campaignLearnings.length > 0 ? (
                campaignLearnings.map((learning, index) => (
                  <div key={index} className="text-sm text-blue-800 bg-blue-100 p-2 rounded">
                    <strong>{learning.campaignName}:</strong> {learning.learnings[0] || 'No learnings available'}
                  </div>
                ))
              ) : (
                <div className="text-sm text-blue-600">No previous campaigns to learn from yet.</div>
              )}
            </div>
          </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-gray-50 border-b border-gray-200 p-4">
            <div className="space-y-4">
              {/* Provider Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">AI Provider</label>
                <div className="flex gap-2">
                  {[
                    { id: 'demo', name: 'Demo AI', icon: Sparkles, color: 'from-purple-500 to-violet-600', status: 'Always Available' },
                    { id: 'gpt', name: 'GPT-4', icon: Zap, color: 'from-green-500 to-emerald-600', status: 'API Required' },
                    { id: 'claude', name: 'Claude 3.5', icon: Brain, color: 'from-orange-500 to-red-600', status: 'API Required' }
                  ].map((provider) => {
                    const Icon = provider.icon;
                    const isConfigured = selectedProvider === provider.id && provider.id !== 'demo';
                    return (
                      <button
                        key={provider.id}
                        onClick={() => handleProviderChange(provider.id as AIProvider)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                          selectedProvider === provider.id
                            ? `bg-gradient-to-r ${provider.color} text-white shadow-lg`
                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <div className="text-left">
                          <div>{provider.name}</div>
                          <div className={`text-xs ${selectedProvider === provider.id ? 'text-white/80' : 'text-gray-500'}`}>
                            {provider.status}
                          </div>
                        </div>
                        {isConfigured && (
                          <CheckCircle className="h-3 w-3 text-white" />
                        )}
                      </button>
                    );
                  })}
                </div>
                
                {/* API Status */}
                <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-900">Current Configuration</span>
                  </div>
                  <div className="text-sm text-blue-800">
                    {selectedProvider === 'claude' && (
                      <div>
                        <strong>Claude 3.5 Sonnet</strong> is configured and ready to use
                        <br />
                        <span className="text-blue-600">✓ API Key configured</span>
                      </div>
                    )}
                    {selectedProvider === 'gpt' && (
                      <div>
                        <strong>GPT-4</strong> is configured and ready to use
                        <br />
                        <span className="text-blue-600">✓ API Key configured</span>
                      </div>
                    )}
                    {selectedProvider === 'demo' && (
                      <div>
                        <strong>Demo Mode</strong> - No API configuration detected
                        <br />
                        <span className="text-orange-600">⚠ Using simulated responses</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* API Keys */}
              {selectedProvider !== 'demo' && (
                <div className="space-y-3">
                  {selectedProvider === 'gpt' && (
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-gray-500" />
                      <span className="text-sm text-gray-600">API key loaded from environment</span>
                    </div>
                  )}
                  {selectedProvider === 'claude' && (
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-gray-500" />
                      <span className="text-sm text-gray-600">API key loaded from environment</span>
                    </div>
                  )}
                </div>
              )}

              {/* Status */}
              <div className="text-xs text-gray-600">
                {selectedProvider === 'demo' ? (
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    Demo mode with campaign learning simulation
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 text-orange-500" />
                    {selectedProvider === 'gpt' ? 'OpenAI' : 'Anthropic'} API with campaign context
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Messages / History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {uiErrorMessage && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
              {uiErrorMessage}
            </div>
          )}
          {uiSuccessMessage && (
            <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg p-3">
              {uiSuccessMessage}
            </div>
          )}

          {activeTab === 'history' ? (
            <div className="space-y-4">
              {isHistoryLoading ? (
                <div className="text-sm text-gray-500">Loading history...</div>
              ) : aiHistory.length === 0 ? (
                <div className="text-sm text-gray-500">No AI history yet.</div>
              ) : (
                aiHistory.map((entry) => (
                  <div key={entry.snapshot_hash} className="border rounded-lg p-4 bg-white">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900">Plan Snapshot</div>
                      <div className="text-xs text-gray-500">
                        {entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-gray-700">
                      Omnivyre: {entry.omnivyre_decision?.recommendation || 'N/A'}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {renderPlanSummary(entry.structured_plan)}
                    </div>
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-gray-700">Scheduled Items</div>
                      {entry.scheduled_posts.length === 0 ? (
                        <div className="text-xs text-gray-500 mt-1">No scheduled posts.</div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {entry.scheduled_posts.map((post) => (
                            <div key={post.id} className="bg-gray-50 rounded p-2 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="capitalize text-gray-700">{post.platform}</span>
                                <span className="text-gray-500">
                                  {post.scheduled_for ? new Date(post.scheduled_for).toLocaleString() : '—'}
                                </span>
                              </div>
                              <div className="text-gray-600 mt-1 line-clamp-2">{post.content}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : activeTab === 'audit' ? (
            <div className="space-y-3">
              {isAuditLoading ? (
                <div className="text-sm text-gray-500">Loading audit report...</div>
              ) : !auditReport ? (
                <div className="text-sm text-gray-500">No audit report available.</div>
              ) : (
                <div className="border rounded-lg p-4 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-900">Campaign Audit Report</div>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        auditReport.status === 'healthy'
                          ? 'bg-green-100 text-green-800'
                          : auditReport.status === 'warning'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {auditReport.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    Confidence score: {auditReport.confidence_score ?? 0}%
                  </div>

                  <div className="border-t pt-3 mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900">Campaign Health</div>
                      {isHealthLoading ? (
                        <span className="text-xs text-gray-500">Loading…</span>
                      ) : (
                        <span
                          title={
                            healthReport?.issues
                              ? healthReport.issues
                                  .map((issue: any) => `${issue.level.toUpperCase()}: ${issue.message}`)
                                  .join(' | ')
                              : 'No issues'
                          }
                          className={`text-xs px-2 py-1 rounded-full ${
                            healthReport?.status === 'healthy'
                              ? 'bg-green-100 text-green-800'
                              : healthReport?.status === 'warning'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {healthReport?.status ?? 'unknown'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      Confidence: {healthReport?.confidence ?? 0}%
                    </div>
                  <div className="h-2 w-full bg-gray-100 rounded">
                    <div
                      className={`h-2 rounded ${
                        (healthReport?.confidence ?? 0) >= 80
                          ? 'bg-green-500'
                          : (healthReport?.confidence ?? 0) >= 50
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, healthReport?.confidence ?? 0))}%` }}
                    />
                  </div>
                    <details className="text-xs text-gray-700">
                      <summary className="cursor-pointer font-semibold">Health report JSON</summary>
                      <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                        {JSON.stringify(healthReport, null, 2)}
                      </pre>
                    </details>
                  </div>

                  <div className="border-t pt-3 mt-3 space-y-2">
                    <div className="text-sm font-semibold text-gray-900">Optimize Week</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={optimizeWeekNumber}
                        onChange={(e) => setOptimizeWeekNumber(Number(e.target.value))}
                        className="w-20 rounded border border-gray-200 px-2 py-1 text-xs"
                      />
                      <input
                        type="text"
                        value={optimizeReason}
                        onChange={(e) => setOptimizeReason(e.target.value)}
                        placeholder="Reason for optimization"
                        className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
                      />
                      <button
                        onClick={handleOptimizeWeek}
                        disabled={isOptimizingWeek}
                        className="px-3 py-1 text-xs rounded bg-indigo-600 text-white disabled:opacity-50"
                      >
                        {isOptimizingWeek ? 'Optimizing…' : 'Optimize'}
                      </button>
                    </div>
                    {optimizeResult && (
                      <div className="text-xs text-gray-600">
                        {optimizeResult.change_summary || 'Optimization complete.'}
                      </div>
                    )}
                  </div>
                  <details className="text-xs text-gray-700">
                    <summary className="cursor-pointer font-semibold">View raw JSON</summary>
                    <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                      {JSON.stringify(auditReport, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          ) : activeTab === 'execution' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={executionWeekNumber}
                  onChange={(e) => setExecutionWeekNumber(Number(e.target.value))}
                  className="w-20 rounded border border-gray-200 px-2 py-1 text-xs"
                />
                <button
                  onClick={() => loadExecutionPlan(campaignId || '', true)}
                  disabled={isExecutionLoading}
                  className="px-3 py-1 text-xs rounded bg-indigo-600 text-white disabled:opacity-50"
                >
                  {isExecutionLoading ? 'Loading…' : 'Regenerate week plan'}
                </button>
                <button
                  onClick={handleApproveScheduling}
                  className="px-3 py-1 text-xs rounded bg-green-600 text-white"
                >
                  Approve for scheduling
                </button>
              </div>
              {isExecutionLoading ? (
                <div className="text-sm text-gray-500">Loading execution plan...</div>
              ) : !executionPlan ? (
                <div className="text-sm text-gray-500">No execution plan available.</div>
              ) : (
                <div className="space-y-2">
                  {executionPlan.days?.map((day: any, index: number) => (
                    <div key={`${day.date}-${day.platform}-${index}`} className="border rounded p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-gray-800">{day.date}</div>
                        <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 capitalize">
                          {day.platform}
                        </span>
                      </div>
                      <div className="mt-1 text-gray-600">
                        {day.contentType} • {day.suggestedTime}
                      </div>
                      <div className="mt-1 text-gray-500">
                        {day.theme}
                        {day.trendUsed ? ` • Trend: ${day.trendUsed}` : ''}
                      </div>
                      <div className="mt-1 text-gray-500">
                        {day.placeholder ? 'Placeholder required' : 'Ready'} • {day.reasoning}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {schedulerPayload && (
                <details className="text-xs text-gray-700">
                  <summary className="cursor-pointer font-semibold">Scheduler payload</summary>
                  <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                    {JSON.stringify(schedulerPayload, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ) : activeTab === 'content' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={contentWeekNumber}
                  onChange={(e) => setContentWeekNumber(Number(e.target.value))}
                  className="w-20 rounded border border-gray-200 px-2 py-1 text-xs"
                />
                <input
                  type="text"
                  value={regenerateInstruction}
                  onChange={(e) => setRegenerateInstruction(e.target.value)}
                  placeholder="Regeneration instruction"
                  className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
                />
              </div>
              {isContentLoading ? (
                <div className="text-sm text-gray-500">Loading content assets...</div>
              ) : contentAssets.length === 0 ? (
                <div className="text-sm text-gray-500">No content assets yet.</div>
              ) : (
                <div className="space-y-2">
                  {contentAssets.map((asset) => (
                    <div key={asset.asset_id} className="border rounded p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-gray-800">
                          {asset.day} • {asset.platform}
                        </div>
                        <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                          {asset.status}
                        </span>
                      </div>
                      <div className="mt-1 text-gray-600">
                        {asset.latest_content?.headline || asset.latest_content?.caption || 'No content'}
                      </div>
                      {asset.latest_content?.tracking_link && (
                        <div className="mt-2 text-gray-600">
                          <button
                            onClick={() =>
                              handleTrackingLinkClick(
                                asset.latest_content.tracking_link,
                                asset.platform
                              )
                            }
                            className="text-indigo-600 hover:text-indigo-700 underline"
                          >
                            Open tracking link
                          </button>
                        </div>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => handleRegenerateContent(asset.asset_id)}
                          className="px-2 py-1 rounded bg-indigo-600 text-white"
                        >
                          Regenerate
                        </button>
                        <button
                          onClick={() => handleApproveContent(asset.asset_id)}
                          className="px-2 py-1 rounded bg-green-600 text-white"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectContent(asset.asset_id)}
                          className="px-2 py-1 rounded bg-red-600 text-white"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {executionPlan?.days?.length && (
                <div className="border-t pt-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2">Generate for day</div>
                  <div className="flex flex-wrap gap-2">
                    {executionPlan.days.map((day: any) => (
                      <button
                        key={day.date}
                        onClick={() => handleGenerateContent(day.date)}
                        className="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs"
                      >
                        {day.date}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'performance' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={performanceWeekNumber}
                  onChange={(e) => setPerformanceWeekNumber(Number(e.target.value))}
                  className="w-20 rounded border border-gray-200 px-2 py-1 text-xs"
                />
                <button
                  onClick={handleApplyInsightsToWeek}
                  className="px-3 py-1 text-xs rounded bg-indigo-600 text-white"
                >
                  Apply insights to week
                </button>
              </div>
              {isPerformanceLoading ? (
                <div className="text-sm text-gray-500">Loading analytics…</div>
              ) : (
                <div className="space-y-3">
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Analytics Report</div>
                    <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                      {JSON.stringify(analyticsReport, null, 2)}
                    </pre>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Learning Insights</div>
                    <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                      {JSON.stringify(learningInsights, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'memory' ? (
            <div className="space-y-3">
              {!campaignMemory ? (
                <div className="text-sm text-gray-500">No memory available.</div>
              ) : (
                <div className="space-y-2">
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Past Themes</div>
                    <div className="text-gray-600">{campaignMemory.pastThemes?.join(', ') || '—'}</div>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Past Topics</div>
                    <div className="text-gray-600">{campaignMemory.pastTopics?.join(', ') || '—'}</div>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Past Hooks</div>
                    <div className="text-gray-600">{campaignMemory.pastHooks?.join(', ') || '—'}</div>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Past Trends</div>
                    <div className="text-gray-600">
                      {campaignMemory.pastTrendsUsed?.join(', ') || '—'}
                    </div>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Overlap Check</div>
                    <div className="text-gray-600">
                      {memoryOverlap?.status || 'unknown'} • score {memoryOverlap?.overlap?.similarityScore ?? 0}
                    </div>
                    <div className="text-gray-600">
                      {memoryOverlap?.suggestions?.join(' ') || ''}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'business' ? (
            <div className="space-y-3">
              {isBusinessLoading ? (
                <div className="text-sm text-gray-500">Loading business intelligence…</div>
              ) : (
                <div className="space-y-3">
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Forecast</div>
                    <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                      {JSON.stringify(forecastReport, null, 2)}
                    </pre>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">ROI</div>
                    <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                      {JSON.stringify(roiReport, null, 2)}
                    </pre>
                  </div>
                  <div className="border rounded p-3 text-xs">
                    <div className="font-semibold text-gray-800">Business Report</div>
                    <pre className="mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded border text-[11px] text-gray-800">
                      {JSON.stringify(businessReport, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'platform' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <select
                  value={platformIntelAssetId}
                  onChange={(e) => setPlatformIntelAssetId(e.target.value)}
                  className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
                >
                  <option value="">Select asset</option>
                  {contentAssets.map((asset) => (
                    <option key={asset.asset_id} value={asset.asset_id}>
                      {asset.day} • {asset.platform}
                    </option>
                  ))}
                </select>
                <select
                  value={platformIntelPlatform}
                  onChange={(e) => setPlatformIntelPlatform(e.target.value)}
                  className="rounded border border-gray-200 px-2 py-1 text-xs"
                >
                  {['linkedin', 'instagram', 'x', 'youtube', 'blog', 'tiktok', 'podcast'].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <select
                  value={platformIntelContentType}
                  onChange={(e) => setPlatformIntelContentType(e.target.value)}
                  className="rounded border border-gray-200 px-2 py-1 text-xs"
                >
                  {['text', 'image', 'video', 'audio', 'carousel', 'blog'].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handlePlatformIntel}
                  disabled={isPlatformIntelLoading}
                  className="px-3 py-1 text-xs rounded bg-indigo-600 text-white disabled:opacity-50"
                >
                  {isPlatformIntelLoading ? 'Loading…' : 'Generate'}
                </button>
              </div>
              {platformIntelData && (
                <div className="space-y-2 text-xs">
                  <div className="border rounded p-2 bg-white">
                    <div className="font-semibold">Formatted Content</div>
                    <div className="text-gray-700">{platformIntelData.variant?.formatted_content || '—'}</div>
                  </div>
                  <div className="border rounded p-2 bg-white">
                    <div className="font-semibold">Promotion Metadata</div>
                    <pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-700">
                      {JSON.stringify(platformIntelData.metadata, null, 2)}
                    </pre>
                  </div>
                  <div className="border rounded p-2 bg-white">
                    <div className="font-semibold">Compliance</div>
                    <pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-700">
                      {JSON.stringify(platformIntelData.compliance, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`flex w-full ${message.type === 'user' ? 'justify-end' : 'justify-start'} px-1 sm:px-2`}>
                <div className={`px-4 py-3 rounded-lg min-w-0 ${
                  message.type === 'user' 
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white max-w-[90%]'
                    : 'bg-gray-100 text-gray-900 w-full'
                }`}>
                  {message.type === 'ai' &&
                  structuredPlan &&
                  structuredPlanMessageId === message.id ? (
                    <div className="text-sm space-y-3">
                      {renderStructuredPlan(structuredPlan)}
                      <button
                        onClick={() => setShowScheduleConfirm(true)}
                        disabled={isBusy || !campaignId || governanceLocked}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 text-sm font-medium disabled:opacity-50"
                      >
                        <Calendar className="h-4 w-4" />
                        Schedule this plan
                      </button>
                    </div>
                  ) : message.type === 'ai' ? (
                    <FormattedAIMessage message={message.message} />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{message.message}</p>
                  )}
                  {message.attachments && message.attachments.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {message.attachments.map((attachment, index) => (
                        <div key={index} className="text-xs opacity-75 flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {attachment}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className={`text-xs mt-2 flex items-center gap-1 ${
                    message.type === 'user' ? 'text-indigo-100' : 'text-gray-500'
                  }`}>
                    <span>{message.timestamp}</span>
                    {message.provider && (
                      <>
                        <span>•</span>
                        <span className="font-medium">{message.provider}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          
          {isTyping && activeTab === 'chat' && (
            <div className="flex justify-start w-full px-1 sm:px-2">
              <div className="bg-gray-100 text-gray-900 px-4 py-3 rounded-lg min-w-0">
                <div className="flex items-center gap-2">
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                  ) : (
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  )}
                  <span className="text-sm text-gray-600">
                    {isSchedulingPlan
                      ? 'Scheduling structured plan...'
                      : modeLoading.generate_plan
                      ? 'Generating structured plan...'
                      : modeLoading.refine_day
                      ? 'Refining selected day...'
                      : modeLoading.platform_customize
                      ? 'Customizing platform content...'
                      : selectedProvider === 'demo'
                      ? 'Demo AI is analyzing campaign data...'
                      : selectedProvider === 'gpt'
                      ? 'GPT-4 is learning from past campaigns...'
                      : 'Claude is reasoning with campaign context...'}
                  </span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Plan Preview Modal */}
        {/* 12-Week Plan Overview — spread across weeks with platform, content type, AI button */}
        {showPlanOverview && structuredPlan && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] mx-4 flex flex-col">
              <div className="bg-gradient-to-r from-purple-500 to-violet-600 text-white p-4 rounded-t-2xl flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold">12-Week Plan Overview</h3>
                  <p className="text-purple-100 text-sm">Platform, content type, and content to create per week</p>
                </div>
                <button
                  onClick={() => setShowPlanOverview(false)}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {structuredPlan.weeks.map((week) => {
                    const themeLabel = week.theme || week.phase_label || `Week ${week.week}`;
                    const platforms = week.platform_allocation
                      ? Object.entries(week.platform_allocation).map(([p, n]) => ({ name: p, count: n }))
                      : [];
                    const contentTypes = week.content_type_mix || [];
                    const hasDaily = week.daily && week.daily.length > 0;
                    return (
                      <div
                        key={week.week}
                        className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-semibold text-gray-900">Week {week.week}</span>
                          <button
                            onClick={() => requestDailyPlanForWeek(week.week)}
                            disabled={isBusy}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 disabled:opacity-50 transition-colors"
                            title="Generate daily plan for this week"
                          >
                            <Sparkles className="h-3 w-3" />
                            AI daily
                          </button>
                        </div>
                        <div className="text-xs text-gray-600 mb-2 font-medium">{themeLabel}</div>
                        
                        <div className="space-y-2 text-xs">
                          <div>
                            <div className="text-gray-500 uppercase tracking-wide mb-1">Platforms</div>
                            <div className="flex flex-wrap gap-1">
                              {platforms.length > 0 ? platforms.map(({ name, count }) => (
                                <span key={name} className="bg-gray-100 px-1.5 py-0.5 rounded capitalize">{name}: {count}</span>
                              )) : <span className="text-gray-400">—</span>}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500 uppercase tracking-wide mb-1">Content to create</div>
                            <ul className="list-disc list-inside text-gray-700 space-y-0.5">
                              {contentTypes.length > 0 ? contentTypes.map((ct, i) => (
                                <li key={i}>{ct}</li>
                              )) : <span className="text-gray-400">—</span>}
                            </ul>
                          </div>
                          <div>
                            <div className="text-gray-500 uppercase tracking-wide mb-1">Available</div>
                            <span className="text-gray-500 italic">(from your content allocation)</span>
                          </div>
                          {hasDaily && (
                            <div className="pt-2 border-t border-gray-100">
                              <div className="text-gray-500 uppercase tracking-wide mb-1">Daily plan</div>
                              <span className="text-green-600">✓ {week.daily!.length} days defined</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              <div className="border-t border-gray-200 p-4 bg-gray-50 rounded-b-2xl">
                <div className="flex justify-between items-center">
                  <button
                    onClick={() => setShowPlanOverview(false)}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Close
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={() => commitPlan()}
                      className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all duration-200 font-medium"
                    >
                      Commit This Plan
                    </button>
                    <button
                      onClick={() => {
                        setShowPlanOverview(false);
                        saveAIContentForPlan(serializeStructuredPlanToText(structuredPlan));
                      }}
                      className="px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all duration-200 font-medium"
                    >
                      Save for Later
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showPlanPreview && !showPlanOverview && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] mx-4 flex flex-col">
              <div className="bg-gradient-to-r from-purple-500 to-violet-600 text-white p-4 rounded-t-2xl flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold">Content Plan Preview</h3>
                  <p className="text-purple-100 text-sm">Review your campaign plan before committing</p>
                </div>
                <button
                  onClick={() => setShowPlanPreview(false)}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6">
                <div className="prose max-w-none">
                  <div className="whitespace-pre-wrap text-gray-800 leading-relaxed">
                    {selectedPlan}
                  </div>
                </div>
              </div>
              
              <div className="border-t border-gray-200 p-4 bg-gray-50 rounded-b-2xl">
                <div className="flex justify-between items-center">
                  <button
                    onClick={() => setShowPlanPreview(false)}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setShowPlanPreview(false);
                        commitPlan(selectedPlan);
                      }}
                      className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all duration-200 font-medium"
                    >
                      Commit This Plan
                    </button>
                    <button
                      onClick={() => {
                        setShowPlanPreview(false);
                        saveAIContentForPlan(selectedPlan);
                      }}
                      className="px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all duration-200 font-medium"
                    >
                      Save for Later
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Date Selection Modal */}
        {showDateSelection && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
              <div className="text-center mb-6">
                <h3 className="text-xl font-bold text-gray-900 mb-2">Select Start Date</h3>
                <p className="text-gray-600">Choose when your campaign should begin</p>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Campaign Start Date
                  </label>
                  <input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    onChange={(e) => {
                      if (e.target.value) {
                        create12WeekPlan(e.target.value);
                      }
                    }}
                  />
                </div>
                
                <div className="flex space-x-3">
                  <button
                    onClick={() => setShowDateSelection(false)}
                    className="flex-1 px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => create12WeekPlan(new Date().toISOString().split('T')[0])}
                    disabled={isLoading}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {isLoading ? 'Creating...' : 'Start Today'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Schedule Plan Confirmation */}
        {showScheduleConfirm && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
              <div className="text-center mb-6">
                <h3 className="text-xl font-bold text-gray-900 mb-2">Schedule This Plan</h3>
                <p className="text-gray-600">
                  This will create scheduled posts for each day and platform in your plan.
                </p>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setShowScheduleConfirm(false)}
                  disabled={isSchedulingPlan}
                  className="flex-1 px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={scheduleStructuredPlan}
                  disabled={isSchedulingPlan || governanceLocked}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isSchedulingPlan ? 'Scheduling...' : 'Confirm & Schedule'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-200">
            <div className="flex flex-wrap gap-2">
              {attachments.map((attachment, index) => (
                <div key={index} className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-lg text-sm">
                  <FileText className="h-3 w-3 text-gray-600" />
                  <span className="text-gray-700">{attachment}</span>
                  <button
                    onClick={() => removeAttachment(index)}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-gray-200">
          {(() => {
            const lastPlanMessage = [...messages].reverse().find((m) => m.type === 'ai' && isWeeklyPlanMessage(m.message));
            const hasViewedPlan = lastPlanMessage && hasViewedPlanMessageId === lastPlanMessage.id;
            return (
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              accept="image/*,video/*,.pdf,.doc,.docx,.txt"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Attach file"
            >
              <Upload className="h-4 w-4 text-gray-600" />
            </button>
            <button disabled={isBusy} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Image className="h-4 w-4 text-gray-600" />
            </button>
            <button disabled={isBusy} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Video className="h-4 w-4 text-gray-600" />
            </button>
            <button disabled={isBusy} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Link className="h-4 w-4 text-gray-600" />
            </button>
            {(lastPlanMessage || structuredPlan) && (
              <>
                <span className="hidden sm:inline text-gray-300 mx-1">|</span>
                <button
                  onClick={() => viewPlan(lastPlanMessage?.message, lastPlanMessage?.id ?? structuredPlanMessageId ?? undefined)}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-sm font-medium transition-colors disabled:opacity-50"
                  title="View plan first"
                >
                  <FileText className="h-3.5 w-3.5" />
                  View Plan
                </button>
                  <button
                    onClick={() => commitPlan(structuredPlan ? undefined : lastPlanMessage?.message)}
                    disabled={isBusy || governanceLocked || (!structuredPlan && !hasViewedPlan)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-sm font-medium transition-colors disabled:opacity-50"
                  title={hasViewedPlan ? 'Commit to create campaign structure' : 'View plan first'}
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  Commit Plan
                </button>
                <button
                  onClick={() => saveAIContentForPlan(lastPlanMessage.message)}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 text-sm font-medium transition-colors disabled:opacity-50"
                  title="Save chat for campaign planning (draft/edit)"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save for Later
                </button>
              </>
            )}
          </div>
            );
          })()}
          
          <div className="flex items-center gap-2">
            <input
              ref={(el) => { inputRef.current = el; }}
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={`Ask ${getProviderName(selectedProvider)} about "${campaignData?.name || 'your campaign'}"...`}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
              disabled={isBusy}
            />
            <ChatVoiceButton
              onTranscription={(text) => setNewMessage(text)}
              disabled={isBusy}
              context="campaign-chat"
              className="p-3 rounded-lg"
            />
            <button
              onClick={sendMessage}
              disabled={(!newMessage.trim() && attachments.length === 0) || isBusy}
              className="p-3 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 text-white rounded-lg transition-all duration-200"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
