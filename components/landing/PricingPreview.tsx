'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

type Currency = 'INR' | 'USD' | 'EUR';

/** Single source: plan keys and display prices per currency. */
const PRICING: Record<Currency, Record<string, string>> = {
  INR: { starter: '₹4,999', growth: '₹19,999', pro: '₹49,999', enterprise: 'Custom' },
  USD: { starter: '$59', growth: '$249', pro: '$599', enterprise: 'Custom' },
  EUR: { starter: '€55', growth: '€229', pro: '€549', enterprise: 'Custom' },
};

const CURRENCIES: Currency[] = ['INR', 'USD', 'EUR'];

type PlanKey = 'starter' | 'growth' | 'pro' | 'enterprise';

const plans: {
  key: PlanKey;
  name: string;
  subtitle: string;
  period: string;
  credits: string;
  customPricing?: boolean;
  features: string[];
  cta: string;
  highlighted: boolean;
  buttonVariant: 'outline' | 'primary' | 'dark';
}[] = [
  {
    key: 'starter',
    name: 'Starter',
    subtitle: 'Text-First Campaigns',
    period: '/ month',
    credits: '5,000 AI Credits',
    features: [
      'Campaign readiness scan (basic)',
      'Blog & article generation',
      'Social media text posts',
      'Content calendar planning',
      'Content scheduling',
      'Content sharing to connected channels',
      'Basic market insights',
    ],
    cta: 'Start Campaigns',
    highlighted: false,
    buttonVariant: 'outline',
  },
  {
    key: 'growth',
    name: 'Growth',
    subtitle: 'Multi-Format Campaigns',
    period: '/ month',
    credits: '25,000 AI Credits',
    features: [
      'Everything in Starter',
      'Multi-format campaign planning',
      'Video & creative placeholders',
      'Campaign asset guidance',
      'Competitor insights',
      'Market pulse monitoring',
      'Website publishing support',
    ],
    cta: 'Grow My Campaigns',
    highlighted: true,
    buttonVariant: 'primary',
  },
  {
    key: 'pro',
    name: 'Pro',
    subtitle: 'Marketing Intelligence',
    period: '/ month',
    credits: '75,000 AI Credits',
    features: [
      'Everything in Growth',
      'Google Analytics integration',
      'Conversion intelligence',
      'Deep campaign diagnostics',
      'Full SEO website analysis',
      'Team collaboration',
      'Advanced reporting',
    ],
    cta: 'Scale Marketing',
    highlighted: false,
    buttonVariant: 'primary',
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    subtitle: 'Strategic AI Infrastructure',
    period: '',
    credits: 'Custom AI Capacity',
    customPricing: true,
    features: [
      'Custom AI workflows',
      'Advanced competitor intelligence',
      'Market monitoring automation',
      'Unlimited team members',
      'Custom integrations',
      'Dedicated support',
    ],
    cta: 'Contact Sales',
    highlighted: false,
    buttonVariant: 'dark',
  },
];

function getDefaultCurrency(): Currency {
  if (typeof window === 'undefined') return 'USD';
  const lang = navigator.language ?? '';
  if (lang.includes('en-IN') || lang.includes('hi')) return 'INR';
  if (/^(de|fr|es|it|nl|pt|pl|el|cs|ro|hu|sk|bg|hr|sl|et|lv|lt|mt)$/i.test(lang.split('-')[0])) return 'EUR';
  return 'USD';
}

export default function PricingPreview() {
  const [currency, setCurrency] = useState<Currency>('USD');
  const [mounted, setMounted] = useState(false);
  const [creditsExpanded, setCreditsExpanded] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCurrency(getDefaultCurrency());
  }, []);

  const getPrice = (plan: (typeof plans)[number]) => {
    if (plan.customPricing) return 'Custom Pricing';
    return mounted ? `${PRICING[currency][plan.key]} ${plan.period}` : '—';
  };

  return (
    <section className="bg-[#F5F9FF] px-4 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-7xl">
        <h2 className="text-center text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
          Flexible AI Pricing
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-lg text-gray-600">
          Choose the plan that matches your marketing scale.
        </p>

        <div className="mt-8 flex justify-center gap-2">
          {CURRENCIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCurrency(c)}
              className={`rounded-[16px] px-4 py-2 text-sm font-semibold transition-colors ${
                currency === c
                  ? 'bg-gradient-to-r from-[#0B5ED7] to-[#1EA7FF] text-white'
                  : 'border border-[#E6EEF8] bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div
          className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4"
          style={{ gap: '24px' }}
        >
          {plans.map((plan) => (
            <PricingCard
              key={plan.key}
              plan={plan}
              priceDisplay={getPrice(plan)}
            />
          ))}
        </div>

        {/* How AI Credits Work - Collapsible (section footer, unchanged) */}
        <div className="mx-auto mt-12 max-w-2xl overflow-hidden rounded-[16px] border border-[#E6EEF8] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <button
            type="button"
            onClick={() => setCreditsExpanded(!creditsExpanded)}
            className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-gray-50/50"
          >
            <span className="text-lg font-semibold tracking-tight text-gray-900">
              How AI Credits Work
            </span>
            {creditsExpanded ? (
              <ChevronUp className="h-5 w-5 shrink-0 text-gray-500" />
            ) : (
              <ChevronDown className="h-5 w-5 shrink-0 text-gray-500" />
            )}
          </button>
          {creditsExpanded && (
            <div className="border-t border-[#E6EEF8] px-6 pb-6 pt-4">
              <p className="text-[15px] leading-relaxed text-gray-600">
                Every action on Omnivyra consumes AI credits.
              </p>
              <p className="mt-4 text-sm font-medium text-gray-700">Example usage:</p>
              <ul className="mt-2 space-y-1.5 text-sm text-gray-600">
                <li>Website scan → ~10 credits</li>
                <li>Generate blog → ~6 credits</li>
                <li>Campaign plan → ~12 credits</li>
                <li>Market insight → ~15 credits</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PricingCard({
  plan,
  priceDisplay,
}: {
  plan: (typeof plans)[number];
  priceDisplay: string;
}) {
  const isHighlighted = plan.highlighted;

  return (
    <div
      className={`group relative flex flex-col rounded-[16px] border p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(11,94,215,0.04)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08),0_8px_32px_rgba(11,94,215,0.12)] ${
        isHighlighted
          ? 'scale-[1.02] border-[#0B5ED7] bg-[#F5F9FF] shadow-[0_0_0_1px_rgba(11,94,215,0.25),0_8px_32px_rgba(11,94,215,0.12)] hover:shadow-[0_0_0_1px_rgba(11,94,215,0.35),0_12px_40px_rgba(11,94,215,0.16)]'
          : 'border-[#E6EEF8] bg-white'
      }`}
      style={{ padding: '32px' }}
    >
      {isHighlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="rounded-full bg-[#0B5ED7] px-3 py-1 text-xs font-semibold text-white">
            Most Popular
          </span>
        </div>
      )}
      <h3 className="text-xl font-semibold tracking-tight text-gray-900">{plan.name}</h3>
      <p className="mt-1 text-sm text-gray-500">{plan.subtitle}</p>
      <div className="mt-4 flex items-baseline flex-wrap gap-1">
        <span className="text-2xl font-semibold text-gray-900">{priceDisplay}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-[#0B5ED7]">{plan.credits}</p>
      <div className="my-6 border-t border-[#E6EEF8]" />
      <ul className="flex-1 space-y-2.5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[14px] text-gray-600">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#0B5ED7]" />
            {f}
          </li>
        ))}
      </ul>
      <Link
        href="/login"
        className={`mt-8 block w-full rounded-xl py-3.5 text-center text-[15px] font-semibold transition-all duration-200 ${
          plan.buttonVariant === 'outline'
            ? 'border-2 border-[#0B5ED7] bg-white text-[#0B5ED7] hover:bg-[#0B5ED7]/5'
            : plan.buttonVariant === 'dark'
              ? 'bg-gray-800 text-white hover:bg-gray-900'
              : 'bg-[#0B5ED7] text-white shadow-md hover:bg-[#094db8] hover:shadow-lg'
        }`}
      >
        {plan.cta}
      </Link>
    </div>
  );
}
