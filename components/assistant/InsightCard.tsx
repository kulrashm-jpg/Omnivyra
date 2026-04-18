import React from 'react';
import Link from 'next/link';
import { ArrowRight, Lightbulb, TrendingUp, CheckCircle2, AlertCircle } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Reusable insight card — can be placed anywhere on any page
// ─────────────────────────────────────────────────────────────────────────────

export type InsightType = 'opportunity' | 'tip' | 'milestone' | 'warning';

interface InsightCardProps {
  type: InsightType;
  title: string;
  description: string;
  action?: string;
  href?: string;
  onDismiss?: () => void;
  className?: string;
}

const STYLES: Record<InsightType, {
  border: string; bg: string; iconBg: string; iconColor: string; icon: React.ElementType;
}> = {
  opportunity: {
    border: 'border-amber-200', bg: 'bg-amber-50', iconBg: 'bg-amber-100', iconColor: 'text-amber-600', icon: TrendingUp,
  },
  tip: {
    border: 'border-blue-200', bg: 'bg-blue-50', iconBg: 'bg-blue-100', iconColor: 'text-blue-600', icon: Lightbulb,
  },
  milestone: {
    border: 'border-green-200', bg: 'bg-green-50', iconBg: 'bg-green-100', iconColor: 'text-green-600', icon: CheckCircle2,
  },
  warning: {
    border: 'border-red-200', bg: 'bg-red-50', iconBg: 'bg-red-100', iconColor: 'text-red-600', icon: AlertCircle,
  },
};

export default function InsightCard({
  type,
  title,
  description,
  action,
  href,
  onDismiss,
  className = '',
}: InsightCardProps) {
  const style = STYLES[type];
  const Icon = style.icon;

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${style.border} ${style.bg} ${className}`}>
      <div className={`w-8 h-8 rounded-lg ${style.iconBg} flex items-center justify-center shrink-0`}>
        <Icon className={`w-4 h-4 ${style.iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{description}</p>
        {action && href && (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 mt-1.5"
          >
            {action}
            <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-gray-400 hover:text-gray-600 text-xs shrink-0 mt-0.5">
          Dismiss
        </button>
      )}
    </div>
  );
}
