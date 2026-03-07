'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/router';

type FreeAuditInputProps = {
  /** Label for the URL input */
  inputLabel?: string;
  /** Placeholder text for the URL field */
  placeholder?: string;
  /** Button text */
  buttonText?: string;
  /** Optional variant: 'default' | 'compact' */
  variant?: 'default' | 'compact';
  /** Optional class name for the container */
  className?: string;
};

export default function FreeAuditInput({
  inputLabel = 'Website URL',
  placeholder = 'https://yourwebsite.com',
  buttonText = 'Run Free Audit',
  variant = 'default',
  className = '',
}: FreeAuditInputProps) {
  const [url, setUrl] = useState('');
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (trimmed) {
      router.push({
        pathname: '/free-audit/start',
        query: { url: trimmed },
      });
    } else {
      router.push('/free-audit/start');
    }
  };

  const isCompact = variant === 'compact';

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div
        className={
          isCompact
            ? 'flex flex-col gap-3 sm:flex-row sm:gap-3'
            : 'flex flex-col gap-3 sm:flex-row sm:gap-4'
        }
      >
        <div className="flex-1 min-w-0">
          <label htmlFor="audit-url" className="sr-only">
            {inputLabel}
          </label>
          <input
            id="audit-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 placeholder-gray-400 shadow-sm transition focus:border-[#0B5ED7] focus:outline-none focus:ring-2 focus:ring-[#0B5ED7]/20 sm:py-3.5"
            aria-label={inputLabel}
          />
        </div>
        <button
          type="submit"
          className="landing-btn-primary shrink-0 rounded-xl px-6 py-3 text-base font-semibold sm:py-3.5"
        >
          {buttonText}
        </button>
      </div>
    </form>
  );
}
