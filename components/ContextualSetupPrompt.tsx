import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { X, ArrowRight, Sparkles, Globe, Link2, Users } from 'lucide-react';
import { useSetupProgress } from '../hooks/useSetupProgress';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type PromptContext =
  | 'content'     // user is creating content
  | 'campaign'    // user is in campaigns
  | 'engagement'  // user is in engagement
  | 'report'      // user wants a report
  | 'general';    // fallback

interface NudgeConfig {
  key: string;
  icon: React.ElementType;
  message: string;
  action: string;
  href: string;
  condition: (setup: ReturnType<typeof useSetupProgress>) => boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Nudge rules — context-driven, not blocking
// ─────────────────────────────────────────────────────────────────────────────

const NUDGES: Record<PromptContext, NudgeConfig[]> = {
  content: [
    {
      key: 'content-website',
      icon: Globe,
      message: 'Add your website for more relevant content suggestions',
      action: 'Add website',
      href: '/company-profile',
      condition: (s) => !s.items.find((i) => i.key === 'website_connected')?.completed,
    },
    {
      key: 'content-profile',
      icon: Sparkles,
      message: 'Tell us about your audience to improve content quality',
      action: 'Complete profile',
      href: '/company-profile',
      condition: (s) => !s.level1Complete,
    },
  ],
  campaign: [
    {
      key: 'campaign-social',
      icon: Link2,
      message: 'Connect a social account to publish campaigns directly',
      action: 'Connect accounts',
      href: '/social-platforms',
      condition: (s) => !s.items.find((i) => i.key === 'social_accounts_connected')?.completed,
    },
    {
      key: 'campaign-profile',
      icon: Users,
      message: 'Add your business details for better campaign targeting',
      action: 'Complete profile',
      href: '/company-profile',
      condition: (s) => !s.level1Complete,
    },
  ],
  engagement: [
    {
      key: 'engagement-social',
      icon: Link2,
      message: 'Connect your social accounts to monitor conversations',
      action: 'Connect accounts',
      href: '/social-platforms',
      condition: (s) => !s.items.find((i) => i.key === 'social_accounts_connected')?.completed,
    },
  ],
  report: [
    {
      key: 'report-website',
      icon: Globe,
      message: 'Add your website URL to generate a content readiness report',
      action: 'Add website',
      href: '/company-profile',
      condition: (s) => !s.items.find((i) => i.key === 'website_connected')?.completed,
    },
  ],
  general: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Component — inline, dismissible, non-blocking
// ─────────────────────────────────────────────────────────────────────────────

interface ContextualSetupPromptProps {
  context: PromptContext;
  className?: string;
}

export default function ContextualSetupPrompt({ context, className = '' }: ContextualSetupPromptProps) {
  const setup = useSetupProgress();
  const [localDismissed, setLocalDismissed] = useState<Set<string>>(new Set());

  // Find the first applicable, non-dismissed nudge for this context
  const nudges = NUDGES[context] || [];
  const nudge = nudges.find(
    (n) => n.condition(setup) && !setup.isNudgeDismissed(n.key) && !localDismissed.has(n.key)
  );

  if (!nudge || setup.loading) return null;

  const handleDismiss = () => {
    setup.dismissNudge(nudge.key);
    setLocalDismissed((prev) => new Set(prev).add(nudge.key));
  };

  return (
    <div className={`flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl ${className}`}>
      <nudge.icon className="w-4 h-4 text-blue-500 shrink-0" />
      <p className="text-sm text-blue-800 flex-1">{nudge.message}</p>
      <Link
        href={nudge.href}
        className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors"
      >
        {nudge.action}
        <ArrowRight className="w-3 h-3" />
      </Link>
      <button
        onClick={handleDismiss}
        className="shrink-0 text-blue-300 hover:text-blue-500 transition-colors p-0.5"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
