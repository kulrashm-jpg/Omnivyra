'use client';

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowRight } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import { Loader2 } from 'lucide-react';

// ── Accent color map ────────────────────────────────────────────────────────

type AccentColor = 'purple' | 'orange' | 'pink' | 'blue' | 'amber' | 'violet';

const ACCENT_CLASSES: Record<AccentColor, {
  border: string; bg: string; hoverBg: string; gradient: string;
  cardBorder: string; cardHoverBorder: string; badge: string; text: string;
}> = {
  purple: { border: 'border-purple-200', bg: 'bg-purple-600', hoverBg: 'hover:bg-purple-700', gradient: 'from-purple-50 to-indigo-50', cardBorder: 'border-purple-100', cardHoverBorder: 'hover:border-purple-300', badge: 'bg-purple-100 text-purple-800', text: 'text-purple-700' },
  orange: { border: 'border-orange-200', bg: 'bg-orange-600', hoverBg: 'hover:bg-orange-700', gradient: 'from-orange-50 to-amber-50', cardBorder: 'border-orange-100', cardHoverBorder: 'hover:border-orange-300', badge: 'bg-orange-100 text-orange-800', text: 'text-orange-700' },
  pink:   { border: 'border-pink-200', bg: 'bg-pink-600', hoverBg: 'hover:bg-pink-700', gradient: 'from-pink-50 to-rose-50', cardBorder: 'border-pink-100', cardHoverBorder: 'hover:border-pink-300', badge: 'bg-pink-100 text-pink-800', text: 'text-pink-700' },
  blue:   { border: 'border-blue-200', bg: 'bg-blue-600', hoverBg: 'hover:bg-blue-700', gradient: 'from-blue-50 to-cyan-50', cardBorder: 'border-blue-100', cardHoverBorder: 'hover:border-blue-300', badge: 'bg-blue-100 text-blue-800', text: 'text-blue-700' },
  amber:  { border: 'border-amber-200', bg: 'bg-amber-600', hoverBg: 'hover:bg-amber-700', gradient: 'from-amber-50 to-yellow-50', cardBorder: 'border-amber-100', cardHoverBorder: 'hover:border-amber-300', badge: 'bg-amber-100 text-amber-800', text: 'text-amber-700' },
  violet: { border: 'border-violet-200', bg: 'bg-violet-600', hoverBg: 'hover:bg-violet-700', gradient: 'from-violet-50 to-purple-50', cardBorder: 'border-violet-100', cardHoverBorder: 'hover:border-violet-300', badge: 'bg-violet-100 text-violet-800', text: 'text-violet-700' },
};

// ── Props ───────────────────────────────────────────────────────────────────

interface FormatSelectionPageProps {
  title: string;
  subtitle: string;
  icon: string;
  formats: { value: string; label: string; description: string; wordRange?: string }[];
  generatePath: string;
  accentColor: AccentColor;
  backPath?: string;
  pageTitle?: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function FormatSelectionPage({
  title,
  subtitle,
  icon,
  formats,
  generatePath,
  accentColor,
  backPath = '/command-center/content',
  pageTitle,
}: FormatSelectionPageProps) {
  const router = useRouter();
  const { user, isLoading } = useCompanyContext();
  const c = ACCENT_CLASSES[accentColor];

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!user?.userId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-sm">Sign in to continue.</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{pageTitle || title} | Omnivyra</title>
      </Head>

      <div className={`min-h-screen bg-gradient-to-br ${c.gradient} p-6`}>
        <div className="mx-auto max-w-4xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-xs text-gray-500 mb-1">{subtitle}</p>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <span>{icon}</span> {title}
              </h1>
            </div>
            <Link href={backPath} className="text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </Link>
          </div>

          {/* Format cards grid */}
          <div className={`grid gap-5 ${formats.length <= 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
            {formats.map((fmt) => (
              <button
                key={fmt.value}
                onClick={() => router.push(`${generatePath}?format=${fmt.value}`)}
                className={`group text-left rounded-xl border ${c.cardBorder} ${c.cardHoverBorder} bg-white p-6 shadow-sm hover:shadow-md transition-all duration-200`}
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 group-hover:text-gray-700">
                    {fmt.label}
                  </h3>
                  {fmt.wordRange && (
                    <span className={`shrink-0 ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${c.badge}`}>
                      {fmt.wordRange}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 leading-relaxed mb-5">
                  {fmt.description}
                </p>
                <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${c.text} group-hover:gap-2.5 transition-all`}>
                  Create <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
