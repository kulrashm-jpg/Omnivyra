import React from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// PoweredByBadge — subtle branding for shared/exported outputs
//
// Add to: exported PDFs, shared content previews, public pages.
// Keep it subtle — visible but not intrusive.
// ─────────────────────────────────────────────────────────────────────────────

interface PoweredByBadgeProps {
  variant?: 'light' | 'dark' | 'inline';
  className?: string;
}

export default function PoweredByBadge({ variant = 'light', className = '' }: PoweredByBadgeProps) {
  const baseUrl = 'https://omnivyra.com';

  if (variant === 'inline') {
    return (
      <span className={`text-xs text-gray-400 ${className}`}>
        Generated with{' '}
        <a href={baseUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-500 hover:text-blue-600">
          OmniVyra
        </a>
      </span>
    );
  }

  return (
    <a
      href={baseUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        variant === 'dark'
          ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      } ${className}`}
    >
      <span className="w-3 h-3 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600" />
      Generated with OmniVyra
    </a>
  );
}
