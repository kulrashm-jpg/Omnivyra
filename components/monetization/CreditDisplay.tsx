/**
 * CreditDisplay — Persistent credit counter with cost preview.
 *
 * Shows current credit balance and optionally the cost of the next action.
 * Appears in header, sidebar, or inline before expensive operations.
 */
import React from 'react';
import { Coins, AlertTriangle, ChevronRight } from 'lucide-react';

interface CreditDisplayProps {
  /** Total remaining credits */
  remaining: number;
  /** Total credits capacity on current plan */
  total?: number;
  /** Cost of the upcoming action (show as preview) */
  actionCost?: number;
  /** Label for the upcoming action (e.g. "Generate blog") */
  actionLabel?: string;
  /** Whether credits are currently loading */
  loading?: boolean;
  /** Called when user clicks to see credit details or upgrade */
  onClick?: () => void;
  /** Visual variant */
  variant?: 'header' | 'inline' | 'card';
  className?: string;
}

export default function CreditDisplay({
  remaining,
  total,
  actionCost,
  actionLabel,
  loading = false,
  onClick,
  variant = 'header',
  className = '',
}: CreditDisplayProps) {
  const isLow = total ? remaining / total < 0.2 : remaining < 50;
  const isDepleted = remaining <= 0;
  const canAfford = actionCost ? remaining >= actionCost : true;

  if (variant === 'header') {
    return (
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          isDepleted
            ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
            : isLow
              ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
              : 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100'
        } ${className}`}
      >
        <Coins className="h-3.5 w-3.5" />
        {loading ? (
          <span className="animate-pulse">...</span>
        ) : (
          <span>{remaining.toLocaleString()}</span>
        )}
        {isDepleted && <AlertTriangle className="h-3 w-3 text-red-500" />}
      </button>
    );
  }

  if (variant === 'inline') {
    return (
      <div className={`flex items-center gap-2 text-xs ${className}`}>
        <Coins className={`h-3.5 w-3.5 ${isDepleted ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-gray-400'}`} />
        <span className={`font-medium ${isDepleted ? 'text-red-600' : 'text-gray-600'}`}>
          {loading ? '...' : `${remaining.toLocaleString()} credits`}
        </span>
        {actionCost !== undefined && (
          <span className={`${canAfford ? 'text-gray-400' : 'text-red-500 font-semibold'}`}>
            · This {actionLabel || 'action'} costs {actionCost}
          </span>
        )}
      </div>
    );
  }

  // Card variant — for use before expensive operations
  return (
    <div
      className={`rounded-lg border ${
        !canAfford ? 'border-red-200 bg-red-50' : isLow ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'
      } p-3 ${className}`}
      role={onClick ? 'button' : undefined}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins className={`h-4 w-4 ${isDepleted ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-indigo-500'}`} />
          <div>
            <p className="text-xs font-semibold text-gray-900">
              {loading ? 'Loading...' : `${remaining.toLocaleString()} credits remaining`}
            </p>
            {total && (
              <div className="flex items-center gap-2 mt-1">
                <div className="w-20 h-1 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${isDepleted ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-indigo-500'}`}
                    style={{ width: `${Math.min(100, Math.round((remaining / total) * 100))}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-400">of {total.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
        {actionCost !== undefined && (
          <div className="text-right">
            <p className={`text-xs font-bold ${canAfford ? 'text-gray-700' : 'text-red-600'}`}>
              {actionCost} credits
            </p>
            <p className="text-[10px] text-gray-400">{actionLabel || 'This action'}</p>
          </div>
        )}
        {onClick && <ChevronRight className="h-4 w-4 text-gray-400 ml-1" />}
      </div>
      {!canAfford && (
        <p className="text-xs text-red-600 mt-2 font-medium">
          Not enough credits. Purchase more or upgrade your plan.
        </p>
      )}
    </div>
  );
}
