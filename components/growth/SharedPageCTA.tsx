import React from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// SharedPageCTA — conversion CTA for public share pages
//
// Drop this at the bottom of any public /share/* page.
// Shows: branding + "Create your own" CTA.
// ─────────────────────────────────────────────────────────────────────────────

interface SharedPageCTAProps {
  contentType?: 'report' | 'blog' | 'campaign' | 'content';
  className?: string;
}

const CTA_COPY: Record<string, { title: string; subtitle: string; action: string }> = {
  report: {
    title: 'Want your own content analysis?',
    subtitle: 'Get a free Content Readiness Score for your website in 2 minutes.',
    action: 'Analyze my website',
  },
  blog: {
    title: 'Create AI-powered content like this',
    subtitle: 'Generate SEO-optimized blogs, articles, and posts in seconds.',
    action: 'Start writing for free',
  },
  campaign: {
    title: 'Launch your own campaigns',
    subtitle: 'Distribute content across LinkedIn, Twitter, and more from one place.',
    action: 'Start for free',
  },
  content: {
    title: 'Create content like this',
    subtitle: 'AI-powered content creation for teams that want to grow.',
    action: 'Get started free',
  },
};

export default function SharedPageCTA({ contentType = 'content', className = '' }: SharedPageCTAProps) {
  const copy = CTA_COPY[contentType] || CTA_COPY.content;

  return (
    <div className={`bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 rounded-2xl p-6 sm:p-8 text-white text-center ${className}`}>
      <div className="flex items-center justify-center gap-2 mb-3">
        <img src="/logo-white.png" alt="Omnivyra" className="h-6 w-auto" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <span className="text-sm font-semibold text-white/80">Omnivyra</span>
      </div>

      <h3 className="text-xl sm:text-2xl font-bold mb-2">{copy.title}</h3>
      <p className="text-sm text-blue-100 max-w-md mx-auto mb-5">{copy.subtitle}</p>

      <Link
        href="/create-account"
        className="inline-flex items-center gap-2 px-6 py-3 bg-white text-blue-700 font-semibold text-sm rounded-xl hover:bg-blue-50 transition-colors shadow-lg"
      >
        <Sparkles className="w-4 h-4" />
        {copy.action}
        <ArrowRight className="w-4 h-4" />
      </Link>

      <p className="text-xs text-blue-200 mt-4">
        Free to start. No credit card required.
      </p>
    </div>
  );
}
