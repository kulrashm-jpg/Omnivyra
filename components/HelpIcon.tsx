import React, { useState, useRef, useEffect } from 'react';

interface HelpIconProps {
  helpText: string;
  helpLink?: string;
  label?: string; // Requirement label for accessibility
}

/**
 * HelpIcon Component
 * 
 * Shows a "?" icon with a tooltip that displays contextual help text.
 * On mobile, tapping shows the tooltip; on desktop, hovering shows it.
 * If helpLink exists, adds a clickable "Learn more →" button.
 */
export function HelpIcon({ helpText, helpLink, label }: HelpIconProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [position, setPosition] = useState<'top' | 'bottom'>('top');
  const tooltipRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);

  /**
   * Calculate tooltip position to prevent screen overflow
   */
  useEffect(() => {
    if (!showTooltip || !tooltipRef.current || !iconRef.current) return;

    const iconRect = iconRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    // If tooltip would overflow top, position below
    if (iconRect.top - tooltipRect.height - 8 < 0) {
      setPosition('bottom');
    } else {
      setPosition('top');
    }
  }, [showTooltip]);

  /**
   * Handle click outside to close tooltip
   */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        showTooltip &&
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node) &&
        iconRef.current &&
        !iconRef.current.contains(e.target as Node)
      ) {
        setShowTooltip(false);
      }
    };

    if (showTooltip) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showTooltip]);

  const handleNavigate = () => {
    if (helpLink) {
      window.location.href = helpLink;
      setShowTooltip(false);
    }
  };

  return (
    <div className="relative inline-block">
      {/* Help Icon Button */}
      <button
        ref={iconRef}
        onClick={() => setShowTooltip(!showTooltip)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="ml-1 inline-flex items-center justify-center w-4.5 h-4.5 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-colors cursor-help"
        aria-label={`Help: ${label || helpText}`}
        type="button"
      >
        <span className="text-xs font-semibold">?</span>
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div
          ref={tooltipRef}
          className={`absolute z-50 w-56 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg pointer-events-auto
            ${position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}
            left-1/2 transform -translate-x-1/2`}
          role="tooltip"
        >
          {/* Tooltip Content */}
          <p className="leading-relaxed">{helpText}</p>

          {/* Learn More Link */}
          {helpLink && (
            <button
              onClick={handleNavigate}
              className="mt-2 text-blue-300 hover:text-blue-100 font-medium text-xs flex items-center gap-1 transition-colors"
              type="button"
            >
              Learn more →
            </button>
          )}

          {/* Tooltip Arrow */}
          <div
            className={`absolute w-2 h-2 bg-gray-900 transform rotate-45
              ${position === 'top' ? '-bottom-1 top-auto' : '-top-1 bottom-auto'}
              left-1/2 -translate-x-1/2`}
          />
        </div>
      )}
    </div>
  );
}
