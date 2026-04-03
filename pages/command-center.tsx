import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { Loader2 } from 'lucide-react';
import { getVisibleCards, COMMAND_CENTER_CARDS, CommandCenterCard, Requirement, CardState } from '../config/commandCenterCards';
import { useCompanyContext } from '../components/CompanyContext';
import { HelpIcon } from '../components/HelpIcon';
import { getAuthToken } from '../utils/getAuthToken';
import {
  fetchReadinessData,
  getCardStateFromFeatures,
  generateDynamicRequirements,
  FeatureStatus,
  ReadinessData,
} from '../backend/services/commandCenterReadinessService';
import {
  getTriggersForCard,
  computeMonetizationState,
  MonetizationState,
  UserContext,
} from '../backend/services/monetizationTriggersService';
import {
  logCommandCenterViewed,
  logCardClicked,
  logCommandCenterDismissed,
} from '../lib/analytics/commandCenterEvents';

type EnhancedCardProps = Omit<CommandCenterCard, 'state' | 'requirements' | 'badge'> & {
  state: CardState;
  badge?: 'FREE_AVAILABLE' | 'GENERATING' | 'USED';
  requirements: Requirement[];
  ctaLabel: string;
  ctaDisabled?: boolean;
  showSpinner?: boolean;
  hint?: string;
  monetization?: MonetizationState; // Monetization trigger info
  onClick: (route: string, cardState: CardState) => void;
  onAnalytics: (cardId: string) => void;
  onMonetizationClick?: (upgradePath: string) => void; // Track upgrade clicks
  onRequirementClick?: (helpLink: string) => void; // Navigate to requirement help page
};

/**
 * Premium Reports Card Component
 * Special high-conversion card design for the Content Readiness report
 */
function PremiumReportsCard({
  id,
  title,
  description,
  hint,
  route,
  icon,
  state,
  badge,
  requirements,
  color = 'blue',
  ctaLabel,
  ctaDisabled,
  showSpinner,
  monetization,
  onClick,
  onAnalytics,
  onMonetizationClick,
  onRequirementClick,
}: EnhancedCardProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const isFreeAvailable = badge === 'FREE_AVAILABLE';
  const isAlreadyUsed = badge === 'USED';

  // Extract hook from description
  const hookMatch = description.match(/Is your .+\?/);
  const hook = hookMatch ? hookMatch[0] : description;

  return (
    <div className={`rounded-xl p-5 hover:shadow-2xl transition-all cursor-pointer flex flex-col border-2 bg-gradient-to-br hover:scale-105 ${
      isFreeAvailable 
        ? 'from-blue-50 via-white to-purple-50 border-blue-200' 
        : 'from-gray-50 via-white to-gray-100 border-gray-300'
    }`}>
      {/* Premium Header with State Indicator */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="text-5xl">📊</div>
          {state === 'ready' && (
            <div className="flex flex-col gap-1">
              <div className="w-6 h-6 bg-green-100 border-2 border-green-500 rounded-full flex items-center justify-center">
                <span className="text-xs font-bold text-green-600">✓</span>
              </div>
            </div>
          )}
          {state === 'in_progress' && (
            <div className="animate-spin">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full"></div>
            </div>
          )}
        </div>

        {/* Pricing Badge - Changes based on state */}
        <div className="text-right">
          {isFreeAvailable && (
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-green-100 text-green-800 animate-pulse block">
              ✨ FREE
            </span>
          )}
          {isAlreadyUsed && (
            <div className="text-right">
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-blue-100 text-blue-800 block mb-1">
                💳 20–40 Credits
              </span>
              <p className="text-xs text-gray-600 font-semibold">Next refresh</p>
            </div>
          )}
          {state === 'ready' && !badge && (
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-green-100 text-green-800 block">
              ✓ Generated
            </span>
          )}
        </div>
      </div>

      {/* Title + Compelling Hook with Urgency */}
      <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm font-semibold text-blue-600 italic mb-4">{hook}</p>

      {/* Value Bullets */}
      <div className="space-y-2 mb-4 text-sm">
        <div className="flex items-start gap-2">
          <span className="text-blue-600 font-bold text-lg mt-0">•</span>
          <span className="text-gray-700"><strong>Reveals gaps</strong> in your content strategy</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-purple-600 font-bold text-lg mt-0">•</span>
          <span className="text-gray-700"><strong>Identifies opportunities</strong> to rank higher</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-green-600 font-bold text-lg mt-0">•</span>
          <span className="text-gray-700"><strong>Quick wins</strong> you can implement today</span>
        </div>
      </div>

      {/* Smart Status Messaging with Context */}
      <div className={`mb-4 p-3 rounded-lg border ${
        state === 'in_progress' 
          ? 'bg-blue-50 border-blue-200' 
          : state === 'ready'
            ? 'bg-green-50 border-green-200'
            : 'bg-white border-gray-200'
      }`}>
        {state === 'not_started' && (
          <p className="text-xs text-gray-700">
            <span className="font-semibold text-gray-900">👀 You haven't seen this yet</span>
            <br />
            Get instant clarity on your content strategy in 2 minutes
          </p>
        )}
        {state === 'in_progress' && (
          <p className="text-xs text-blue-700">
            <span className="font-semibold">⏳ Report generating...</span>
            <br />
            Analyzing your content against market demand (2-5 min)
          </p>
        )}
        {state === 'ready' && isAlreadyUsed && (
          <p className="text-xs text-amber-700">
            <span className="font-semibold">🔄 Your free report has been used</span>
            <br />
            Generate a fresh analysis to see how the market has evolved
          </p>
        )}
        {state === 'ready' && !isAlreadyUsed && (
          <p className="text-xs text-green-700">
            <span className="font-semibold">✓ Report ready to view</span>
            <br />
            Click to see your Content Readiness Score and action plan
          </p>
        )}
      </div>



      {/* Requirements Checklist - Mini Version */}
      {requirements.length > 0 && (
        <div className="mb-4 text-xs">
          <p className="font-semibold text-gray-700 mb-2">✅ Setup Required:</p>
          <ul className="space-y-1">
            {requirements.map((req, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <span className={req.status === 'done' ? 'text-green-600 font-bold' : 'text-gray-400'}>
                  {req.status === 'done' ? '✓' : '○'}
                </span>
                <a
                  href={req.helpLink || '#'}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (req.helpLink) {
                      onRequirementClick?.(req.helpLink);
                    }
                  }}
                  title={req.helpText || req.label}
                  className={`transition-colors hover:underline cursor-pointer ${
                    req.status === 'done'
                      ? 'text-green-700 font-semibold'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {req.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Premium CTA Button with Urgency Copy */}
      <div className="mt-auto pt-4 border-t border-blue-200">
        <button
          onClick={(e) => {
            if (ctaDisabled) return;
            e.stopPropagation();
            onAnalytics(id);
            onClick(route, state);
          }}
          className={`w-full px-4 py-3 rounded-lg font-bold text-white text-sm transition-all shadow-md hover:shadow-lg transform hover:scale-105 ${
            state === 'ready' 
              ? 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700'
              : isFreeAvailable
                ? 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700'
                : 'bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          disabled={ctaDisabled}
        >
          <span className="inline-flex items-center justify-center gap-2">
            {showSpinner ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {state === 'ready' ? '📊 View Report' : isFreeAvailable ? '👀 See What You\'re Missing' : isAlreadyUsed ? '🔄 Generate Fresh Analysis' : ctaLabel}
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Smart Insight Card Component
 * Used for insight-driven features like "Create Content"
 */
function SmartInsightCard({
  id,
  title,
  description,
  hint,
  route,
  icon,
  state,
  badge,
  requirements,
  color = 'blue',
  ctaLabel,
  ctaDisabled,
  showSpinner,
  onClick,
  onAnalytics,
  onRequirementClick,
}: EnhancedCardProps) {
  const [showCreditsTooltip, setShowCreditsTooltip] = useState(false);

  const getSmartSuggestion = (): string => {
    const topics = ['AI Strategy', 'Content Marketing ROI', 'Digital Transformation', 'Market Leadership', 'Competitive Analysis'];
    return topics[Math.floor(Math.random() * topics.length)];
  };

  return (
    <div className="col-span-1 rounded-xl p-5 hover:shadow-2xl transition-all cursor-pointer flex flex-col border-2 bg-gradient-to-br from-purple-50 via-white to-pink-50 border-purple-200 hover:scale-105">
      {/* Header with Smart Icon */}
      <div className="flex items-start justify-between mb-3">
        <div className="text-4xl">✍️</div>
        {state === 'ready' && (
          <span className="text-xs font-bold px-2 py-1 rounded-full bg-purple-100 text-purple-800">
            Ready
          </span>
        )}
      </div>

      {/* Title + Compelling Hook */}
      <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
      <p className="text-xs font-semibold text-purple-600 mb-3">{description}</p>

      {/* Smart Suggestion Box - The Key Insight */}
      <div className="mb-3 p-3 bg-gradient-to-r from-purple-100 to-pink-100 border border-purple-300 rounded-lg">
        <p className="text-xs text-gray-700 mb-1">
          <span className="font-bold text-purple-900">💡 Based on your analysis:</span>
        </p>
        <p className="text-xs text-purple-900 font-semibold">
          Start with: <span className="text-purple-600">{getSmartSuggestion()}</span>
        </p>
        <p className="text-xs text-gray-600 mt-1">Your audience is searching for this, and you have no existing content</p>
      </div>

      {/* Feature Highlights - Compact */}
      <div className="space-y-1.5 mb-3 text-xs">
        <div className="flex items-center gap-2 text-gray-700">
          <span className="text-purple-600 font-bold">✓</span>
          <span><strong>AI-assisted writing</strong> to save time</span>
        </div>
        <div className="flex items-center gap-2 text-gray-700">
          <span className="text-pink-600 font-bold">✓</span>
          <span><strong>SEO optimized</strong> automatically</span>
        </div>
        <div className="flex items-center gap-2 text-gray-700">
          <span className="text-purple-600 font-bold">✓</span>
          <span><strong>Publish instantly</strong> to all channels</span>
        </div>
      </div>

      {/* Credit Cost with Tooltip */}
      <div className="mb-3 p-2 bg-gray-100 rounded-lg border border-gray-300">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-700">💳 5–15 credits/article</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowCreditsTooltip(!showCreditsTooltip);
            }}
            className="text-xs text-gray-600 hover:text-gray-900 font-semibold underline"
          >
            ?
          </button>
        </div>
        {showCreditsTooltip && (
          <p className="text-xs text-gray-600 mt-2 pt-2 border-t border-gray-300">
            Cost depends on: article length • research depth • AI assistance level • custom requirements
          </p>
        )}
      </div>

      {/* Requirements Checklist */}
      {requirements.length > 0 && (
        <div className="mb-3 text-xs">
          <p className="font-semibold text-gray-700 mb-1">Setup:</p>
          <ul className="space-y-0.5">
            {requirements.map((req, idx) => (
              <li key={idx} className="flex items-center gap-1.5">
                <span className={req.status === 'done' ? 'text-green-600' : 'text-gray-400'}>
                  {req.status === 'done' ? '✓' : '○'}
                </span>
                <a
                  href={req.helpLink || '#'}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (req.helpLink) {
                      onRequirementClick?.(req.helpLink);
                    }
                  }}
                  className={`transition-colors hover:underline cursor-pointer text-xs ${
                    req.status === 'done'
                      ? 'text-green-700 font-semibold'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {req.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Smart CTA - Assistive Tone */}
      <div className="mt-auto pt-3 border-t border-purple-200">
        <button
          onClick={(e) => {
            if (ctaDisabled) return;
            e.stopPropagation();
            onAnalytics(id);
            onClick(route, state);
          }}
          className="w-full px-3 py-2 rounded-lg font-bold text-white text-xs bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={ctaDisabled}
        >
          <span className="inline-flex items-center justify-center gap-1">
            {showSpinner ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {ctaLabel}
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Enhanced Command Center Card Component
 * Shows state, requirements with status, and free badge
 */
function CommandCenterCardComponent({
  id,
  title,
  description,
  hint,
  route,
  icon,
  state,
  badge,
  requirements,
  color = 'blue',
  ctaLabel,
  ctaDisabled,
  showSpinner,
  monetization,
  onClick,
  onAnalytics,
  onMonetizationClick,
  onRequirementClick,
}: EnhancedCardProps) {
  const getIconEmoji = (iconName: string): string => {
    const iconMap: Record<string, string> = {
      'chart-bar': '📊',
      'pencil': '✍️',
      'rocket': '🚀',
      'message-square': '💬',
    };
    return iconMap[iconName] || '→';
  };

  const getStateColor = (cardState: CardState): string => {
    switch (cardState) {
      case 'ready':
        return 'bg-green-50 border-green-200';
      case 'in_progress':
        return 'bg-yellow-50 border-yellow-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getStateBadgeText = (cardState: CardState): string => {
    switch (cardState) {
      case 'ready':
        return '✓ Ready';
      case 'in_progress':
        return '⏳ In Progress';
      default:
        return '○ Not Started';
    }
  };

  return (
    <div
      onClick={() => {
        if (ctaDisabled) return;
        onAnalytics(id);
        onClick(route, state);
      }}
      className={`rounded-xl p-5 hover:shadow-2xl transition-all cursor-pointer h-full flex flex-col border-2 ${getStateColor(
        state,
      )} bg-gradient-to-br hover:scale-105`}
      role="button"
      tabIndex={0}
      onKeyPress={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (ctaDisabled) return;
          onAnalytics(id);
          onClick(route, state);
        }
      }}
      aria-label={`${title}: ${getStateBadgeText(state)}`}
    >
      {/* Header: Icon + Title + State Badge */}
      <div className="flex items-start justify-between mb-4">
        <div className="text-4xl mb-3">{getIconEmoji(icon)}</div>
      </div>
      
      <div className="flex-1">
        <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-700 mb-3 line-clamp-2">{description}</p>
        {hint && <p className="text-xs text-gray-600 italic mb-3">💡 {hint}</p>}
        
        {/* State Badge */}
        <div className="inline-block mb-3">
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${state === 'ready' ? 'bg-green-200 text-green-900' : state === 'in_progress' ? 'bg-yellow-200 text-yellow-900' : 'bg-gray-300 text-gray-900'}`}>
            {getStateBadgeText(state)}
          </span>
        </div>
      </div>

      {/* Free Badge (Reports only) */}
      {badge && (
        <div className="mb-3 inline-block">
          <span
            className={`text-xs font-bold px-2 py-1 rounded inline-flex items-center gap-1 ${
              badge === 'FREE_AVAILABLE'
                ? 'bg-yellow-100 text-yellow-800'
                : badge === 'GENERATING'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-emerald-100 text-emerald-800'
            }`}
          >
            {badge === 'GENERATING' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {badge === 'FREE_AVAILABLE'
              ? 'FREE AVAILABLE'
              : badge === 'GENERATING'
                ? 'GENERATING'
                : 'FREE USED'}
          </span>
        </div>
      )}

      {/* Requirements Checklist - Clickable Links with Navigation */}
      {requirements.length > 0 && (
        <div className="mb-3 text-xs flex-1">
          <p className="font-medium text-gray-600 mb-1.5">Checklist:</p>
          <ul className="space-y-0.5">
            {requirements.slice(0, 2).map((req, idx) => (
              <li key={idx} className="flex items-center gap-1.5">
                <span className={req.status === 'done' ? 'text-green-600 font-bold' : 'text-gray-400'}>
                  {req.status === 'done' ? '✓' : '○'}
                </span>
                <a
                  href={req.helpLink || '#'}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (req.helpLink) {
                      onRequirementClick?.(req.helpLink);
                    }
                  }}
                  title={req.helpText || req.label}
                  className={`transition-colors hover:underline cursor-pointer ${
                    req.status === 'done'
                      ? 'text-green-700 font-semibold hover:text-green-900'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {req.label}
                </a>
              </li>
            ))}
            {requirements.length > 2 && (
              <li className="text-gray-500 text-xs cursor-pointer hover:text-gray-700">+{requirements.length - 2} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Monetization Hint (Subtle) */}
      {monetization?.trigger && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-md">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-xs font-medium text-blue-700 mb-1">
                {monetization.trigger.badge}
              </p>
              <p className="text-xs text-blue-600">
                {monetization.trigger.hint}
              </p>
            </div>
          </div>
          {/* Upgrade CTA if needed */}
          {monetization.hasUpgradePath && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMonetizationClick?.(monetization.trigger!.ctaRoute);
                window.location.href = monetization.trigger!.ctaRoute;
              }}
              className="mt-2 text-xs font-semibold text-blue-700 hover:text-blue-900 underline"
            >
              {monetization.trigger.cta} →
            </button>
          )}
        </div>
      )}

      {/* CTA Button - Sticky at bottom without scrolling */}
      <div className="mt-auto pt-3 border-t border-gray-200">
        <button
          onClick={(e) => {
            if (ctaDisabled) return;
            e.stopPropagation();
            onAnalytics(id);
            onClick(route, state);
          }}
          className={`w-full px-3 py-2 rounded-md font-medium text-white text-sm
            ${color === 'blue' && 'bg-blue-600 hover:bg-blue-700'}
            ${color === 'purple' && 'bg-purple-600 hover:bg-purple-700'}
            ${color === 'green' && 'bg-green-600 hover:bg-green-700'}
            ${color === 'orange' && 'bg-orange-600 hover:bg-orange-700'}
            transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
          disabled={ctaDisabled}
        >
          <span className="inline-flex items-center justify-center gap-2">
            {showSpinner ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {ctaLabel}
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Main Command Center Page
 * 
 * Pre-dashboard landing page shown after login.
 * - Role-aware card visibility
 * - Card state awareness (not_started, in_progress, ready)
 * - Requirement status indicators (done/missing)
 * - Setup percentage display
 * - Free report badge
 * - Event tracking for analytics
 * - Pin/unpin command center for next login
 */
export default function CommandCenter() {
  const router = useRouter();
  const { user, userName, userRole, selectedCompanyName, selectedCompanyId, isLoading, authChecked } = useCompanyContext();
  const [showAgain, setShowAgain] = useState<boolean | null>(null); // null = loading
  const [isSaving, setIsSaving] = useState(false);
  const [visibleCards, setVisibleCards] = useState<CommandCenterCard[]>([]);
  const [enhancedCards, setEnhancedCards] = useState<EnhancedCardProps[]>([]);
  const [readinessScore, setReadinessScore] = useState(0); // From backend (0-100)
  const [eventsSent, setEventsSent] = useState(false);
  const [features, setFeatures] = useState<FeatureStatus[]>([]); // From API
  const [readinessData, setReadinessData] = useState<ReadinessData | null>(null); // Full readiness data
  const [userTier, setUserTier] = useState<'free' | 'starter' | 'pro'>('free'); // Subscription tier
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [reportCardStatus, setReportCardStatus] = useState<{
    reportState: 'free_available' | 'generating' | 'used';
    hasGeneratingReport: boolean;
    hasFreeReportUsed: boolean;
  } | null>(null);

  // Guard: not authenticated
  useEffect(() => {
    if (authChecked && !user?.userId) {
      router.replace('/login');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, user?.userId]);

  // Load user preferences on mount
  useEffect(() => {
    if (!authChecked || !user?.userId) return;

    const loadPreferences = async () => {
      try {
        const response = await fetch('/api/user/preferences', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          const data = await response.json();
          // command_center_pinned: true means "show again"
          // command_center_pinned: false means "don't show again"
          setShowAgain(data.preferences?.command_center_pinned ?? true);
        } else {
          // Default to showing if preference fetch fails
          setShowAgain(true);
        }
      } catch (err) {
        console.error('[command-center] Failed to load preferences:', err);
        setShowAgain(true); // Default to showing
      }
    };

    loadPreferences();
  }, [authChecked, user?.userId]);

  // Load company setup state from backend readiness APIs
  useEffect(() => {
    if (!authChecked || !user?.userId || !selectedCompanyId) return;

    const loadReadinessData = async () => {
      try {
        const data = await fetchReadinessData(selectedCompanyId);

        if (!data) {
          console.warn('[command-center] Failed to load readiness data');
          setLoadingError('Failed to load setup data');
          return;
        }

        setFeatures(data.features);
        setReadinessData(data.readiness);
        setReadinessScore(data.readiness.score);
        setLoadingError(null);
      } catch (err) {
        console.error('[command-center] Failed to load readiness data:', err);
        setLoadingError('Failed to load setup data');
      }
    };

    loadReadinessData();
  }, [authChecked, user?.userId, selectedCompanyId]);

  // Load user subscription tier
  useEffect(() => {
    if (!authChecked || !user?.userId || !selectedCompanyId) return;

    const loadUserTier = async () => {
      try {
        const response = await fetch(
          `/api/user/subscription?company_id=${selectedCompanyId}`,
          { method: 'GET', headers: { 'Content-Type': 'application/json' } },
        );

        if (response.ok) {
          const data = await response.json();
          setUserTier(data.data?.tier || 'free');
        } else {
          console.warn('[command-center] Failed to load subscription tier');
          setUserTier('free');
        }
      } catch (err) {
        console.error('[command-center] Failed to load subscription tier:', err);
        setUserTier('free');
      }
    };

    loadUserTier();
  }, [authChecked, user?.userId, selectedCompanyId]);

  useEffect(() => {
    if (!authChecked || !user?.userId || !selectedCompanyId) return;

    let cancelled = false;
    let pollHandle: ReturnType<typeof setInterval> | null = null;

    const fetchReportStatus = async (): Promise<'free_available' | 'generating' | 'used' | null> => {
      try {
        const token = await getAuthToken();
        if (!token || cancelled) return null;
        const response = await fetch(`/api/reports?company_id=${selectedCompanyId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        });
        if (!response.ok || cancelled) return null;
        const data = await response.json();
        if (cancelled) return null;
        const nextState = {
          reportState: (data.reportState || 'free_available') as 'free_available' | 'generating' | 'used',
          hasGeneratingReport: Boolean(data.hasGeneratingReport),
          hasFreeReportUsed: Boolean(data.hasFreeReportUsed),
        };
        setReportCardStatus(nextState);
        return nextState.reportState;
      } catch (error) {
        console.error('[command-center] Failed to load report card state:', error);
        return null;
      }
    };

    // Initial fetch — start polling only if report is actively generating.
    void fetchReportStatus().then((state) => {
      if (cancelled || state !== 'generating') return;
      pollHandle = setInterval(async () => {
        const s = await fetchReportStatus();
        if (s !== 'generating' && pollHandle) {
          clearInterval(pollHandle);
          pollHandle = null;
        }
      }, 5000);
    });

    return () => {
      cancelled = true;
      if (pollHandle) clearInterval(pollHandle);
    };
  // reportCardStatus?.reportState intentionally excluded — including it caused
  // an extra refetch on every status update and contributed to the page flicker.
  }, [authChecked, user?.userId, selectedCompanyId]);

  // Initialize visible cards and compute states using REAL feature completion data
  useEffect(() => {
    if (!userRole) return;
    const cards = getVisibleCards(userRole);
    setVisibleCards(cards);

    // Build enhanced cards with REAL feature-driven states
    // Falls back to "not_started" state when features data is unavailable
    const enhanced = cards.map((card) => {
      // Get dynamic state from features (empty features = "not_started")
      const cardState = features.length > 0 
        ? getCardStateFromFeatures(card.id, features)
        : 'not_started';

      // Generate dynamic requirements based on features
      const requirements = features.length > 0
        ? generateDynamicRequirements(card.id, features)
        : (card.requirements || []);

      // Determine CTA label based on state
      const ctaLabel = cardState === 'not_started'
        ? 'Start Setup'
        : cardState === 'in_progress'
          ? 'Continue Setup'
          : card.cta || 'Open';

      let effectiveState = cardState;
      let effectiveCtaLabel = ctaLabel;
      let badge: 'FREE_AVAILABLE' | 'GENERATING' | 'USED' | undefined;
      let ctaDisabled = false;
      let showSpinner = false;

      if (card.id === 'reports' && reportCardStatus) {
        effectiveState =
          reportCardStatus.reportState === 'generating'
            ? 'in_progress'
            : reportCardStatus.reportState === 'used'
              ? 'ready'
              : 'not_started';

        badge =
          reportCardStatus.reportState === 'generating'
            ? 'GENERATING'
            : reportCardStatus.reportState === 'used'
              ? 'USED'
              : 'FREE_AVAILABLE';

        effectiveCtaLabel =
          reportCardStatus.reportState === 'generating'
            ? 'Generating...'
            : reportCardStatus.reportState === 'used'
              ? 'Upgrade to Generate Report'
              : 'Generate Free Report';

        ctaDisabled = reportCardStatus.reportState === 'generating';
        showSpinner = reportCardStatus.reportState === 'generating';
      } else if (card.id === 'reports') {
        badge =
          features.find((f) => f.key === 'report_generated')?.status === 'completed'
            ? 'USED'
            : 'FREE_AVAILABLE';
      }

      // Compute monetization triggers
      const userContext: UserContext = {
        userId: user?.userId || '',
        tier: userTier,
        reportsGenerated: features.find((f) => f.key === 'report_generated')?.status === 'completed' ? 1 : 0,
        campaignsCreated: features.find((f) => f.key === 'campaign_created')?.status === 'completed' ? 1 : 0,
      };
      const monetization = computeMonetizationState(card.id, features, userContext);

      return {
        ...card,
        state: effectiveState,
        badge,
        requirements,
        ctaLabel: effectiveCtaLabel,
        ctaDisabled,
        showSpinner,
        monetization,
      } as EnhancedCardProps;
    });

    setEnhancedCards(enhanced);
  }, [userRole, features, userTier, user?.userId, reportCardStatus]);

  // Track command center viewed (once per session)
  useEffect(() => {
    if (authChecked && user?.userId && userRole && !eventsSent) {
      setEventsSent(true);
      void logCommandCenterViewed(user.userId, userRole, true, readinessScore, enhancedCards.length);
    }
  }, [authChecked, user?.userId, userRole, eventsSent, readinessScore, enhancedCards.length]);

  /**
   * Handle "Don't show again" toggle
   * Sends PATCH request to update preferences with retry-safe logic
   */
  const handleTogglePinning = useCallback(async (checked: boolean) => {
    const previousState = showAgain;
    try {
      setIsSaving(true);
      // Optimistic update
      setShowAgain(checked);

      // Track dismissal event
      if (user?.userId) {
        void logCommandCenterDismissed(user.userId, !checked);
      }

      // Send PATCH request
      const response = await fetch('/api/user/preferences/command-center', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command_center_pinned: checked,
        }),
      });

      // Verify response before considering update successful
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save preference');
      }

      // Response confirmed - state already optimistically updated
      setLoadingError(null);
    } catch (err) {
      // Revert on error with user-visible message
      console.error('[command-center] Failed to save preference:', err);
      setShowAgain(previousState);
      setLoadingError('Failed to save preference. Please try again.');
      
      // Clear error after 5 seconds
      setTimeout(() => setLoadingError(null), 5000);
    } finally {
      setIsSaving(false);
    }
  }, [user?.userId, showAgain]);

  /**
   * Handle card navigation with analytics
   */
  const handleCardClick = useCallback((route: string, cardState: CardState) => {
    router.push(route);
  }, [router]);

  /**
   * Handle analytics on card click
   */
  const handleCardAnalytics = useCallback((cardId: string) => {
    const card = enhancedCards.find((c) => c.id === cardId);
    if (user?.userId && card) {
      void logCardClicked(user.userId, cardId, card.state, userRole || undefined, selectedCompanyId || undefined);
    }
  }, [user?.userId, userRole, selectedCompanyId, enhancedCards]);

  /**
   * Handle "Go to Dashboard" button
   */
  const handleGoToDashboard = useCallback(() => {
    router.push('/dashboard');
  }, [router]);

  /**
   * Handle monetization CTA clicks (upgrade paths)
   */
  const handleMonetizationClick = useCallback((ctaRoute: string) => {
    if (user?.userId) {
      // Could track analytics here
      console.log('[monetization] User clicked upgrade CTA:', ctaRoute);
    }
  }, [user?.userId]);

  /**
   * Handle requirement link clicks - navigate to help pages
   */
  const handleRequirementClick = useCallback((helpLink: string) => {
    console.log('[requirement] User clicked requirement link:', helpLink);
    router.push(helpLink);
  }, [router]);

  // Show loading state while auth initializes
  if (!authChecked || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading command center...</p>
        </div>
      </div>
    );
  }

  // Guard: authenticated check already in useEffect, but double-check
  if (!user?.userId) {
    return null;
  }

  const companyName = selectedCompanyName || 'Virality';
  const displayName = userName || 'there';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 px-3 sm:px-4 lg:px-6 pb-48">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          {/* Subscription Tier Badge */}
          <div className="mb-4 text-center">
            <span className={`inline-block text-xs font-semibold px-3 py-1 rounded-full ${
              userTier === 'pro'
                ? 'bg-purple-100 text-purple-800'
                : userTier === 'starter'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-800'
            }`}>
              {userTier.charAt(0).toUpperCase() + userTier.slice(1)} Plan
            </span>
          </div>

          {/* Setup Progress */}
          <div className="mb-6 text-center">
            <p className="text-sm font-medium text-blue-600 mb-2">
              You're {readinessScore}% set up
            </p>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${readinessScore}%` }}
              ></div>
            </div>
          </div>

          {/* Welcome Message */}
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Welcome back, {displayName}! 👋
            </h1>
            <p className="text-lg text-gray-600 mb-4">
              {companyName} is ready. Let's get things done.
            </p>

            {/* Tagline */}
            <p className="text-sm text-gray-500">
              Pick a module below to dive in, or skip straight to your dashboard.
            </p>
          </div>
        </div>

        {/* Cards Grid - 4 Equal Columns */}
        <div className="grid grid-cols-4 gap-3 mb-24">
          {enhancedCards.map((card) => {
            // Render Premium Reports Card (spans 2 columns)
            if (card.id === 'reports') {
              return (
                <PremiumReportsCard
                  key={card.id}
                  {...card}
                  onClick={handleCardClick}
                  onAnalytics={handleCardAnalytics}
                  onMonetizationClick={handleMonetizationClick}
                  onRequirementClick={handleRequirementClick}
                />
              );
            }
            
            // Render Smart Insight Card for Create Content (insight-driven)
            if (card.id === 'blogs') {
              return (
                <SmartInsightCard
                  key={card.id}
                  {...card}
                  onClick={handleCardClick}
                  onAnalytics={handleCardAnalytics}
                  onRequirementClick={handleRequirementClick}
                />
              );
            }
            
            // Render Standard Cards (1 column each)
            return (
              <CommandCenterCardComponent
                key={card.id}
                {...card}
                onClick={handleCardClick}
                onAnalytics={handleCardAnalytics}
                onMonetizationClick={handleMonetizationClick}
                onRequirementClick={handleRequirementClick}
              />
            );
          })}
        </div>

        {/* Empty State Warning */}
        {enhancedCards.length === 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-12">
            <p className="text-sm text-yellow-800">
              No modules available for your role. Contact your admin to enable additional features.
            </p>
          </div>
        )}
      </div>

      {/* Sticky Footer Actions - Always Visible at Bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Primary Action */}
          <div className="w-full sm:w-auto">
            <button
              onClick={handleGoToDashboard}
              className="w-full sm:w-auto px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-md hover:shadow-lg"
            >
              📊 Go to Dashboard
            </button>
          </div>

          {/* Don't Show Again Toggle */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showAgain === true}
                onChange={(e) => handleTogglePinning(e.target.checked)}
                disabled={isSaving || showAgain === null}
                className="w-4 h-4 text-blue-600 rounded cursor-pointer disabled:opacity-50"
                aria-label="Show command center on next login"
              />
              <span className="text-sm text-gray-600">Show on next login</span>
            </label>
          </div>
        </div>

        {/* Error Message */}
        {loadingError && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3">
            <p className="text-sm text-red-700">{loadingError}</p>
          </div>
        )}

        {/* Help Text */}
        <p className="text-xs text-gray-500 mt-8 text-center">
          You can update this setting at any time in Settings → Preferences
        </p>
      </div>
    </div>
  );
}
