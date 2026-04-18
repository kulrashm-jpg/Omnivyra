import React, { useEffect, useState } from 'react';
import { X, Flame, Sparkles, Trophy } from 'lucide-react';
import type { RewardEvent } from '../../hooks/useRetention';

/**
 * RewardToast — celebratory toast notification.
 *
 * Slides in from bottom, auto-dismisses after 5 seconds.
 * Shows for: first content, first campaign, streak milestones.
 */

interface RewardToastProps {
  reward: RewardEvent | null;
  onDismiss: () => void;
}

const TYPE_CONFIG: Record<string, { icon: React.ElementType; bg: string; border: string; iconBg: string }> = {
  streak: { icon: Flame, bg: 'bg-orange-50', border: 'border-orange-200', iconBg: 'bg-orange-100 text-orange-600' },
  first: { icon: Sparkles, bg: 'bg-blue-50', border: 'border-blue-200', iconBg: 'bg-blue-100 text-blue-600' },
  milestone: { icon: Trophy, bg: 'bg-green-50', border: 'border-green-200', iconBg: 'bg-green-100 text-green-600' },
};

export default function RewardToast({ reward, onDismiss }: RewardToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!reward) {
      setVisible(false);
      return;
    }

    // Slide in
    const showTimer = setTimeout(() => setVisible(true), 100);

    // Auto-dismiss after 5 seconds
    const hideTimer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300); // wait for exit animation
    }, 5000);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [reward, onDismiss]);

  if (!reward) return null;

  const config = TYPE_CONFIG[reward.type] || TYPE_CONFIG.milestone;
  const Icon = config.icon;

  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl border ${config.border} ${config.bg} shadow-lg min-w-[280px]`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${config.iconBg}`}>
          <Icon className="w-4.5 h-4.5" />
        </div>
        <p className="text-sm font-semibold text-gray-800 flex-1">{reward.message}</p>
        <button
          onClick={() => {
            setVisible(false);
            setTimeout(onDismiss, 300);
          }}
          className="text-gray-400 hover:text-gray-600 p-0.5 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
