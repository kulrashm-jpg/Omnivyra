import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Footer from '../components/landing/Footer';
import { Check } from 'lucide-react';

type Currency = 'INR' | 'USD';

const PRICING = {
  INR: {
    starter: '₹4,999',
    marketer: '₹19,999',
    enterprise: 'Contact Sales',
  },
  USD: {
    starter: '$59',
    marketer: '$249',
    enterprise: 'Contact Sales',
  },
};

const plans = [
  {
    key: 'starter',
    name: 'Starter',
    description: 'For small teams and single campaigns.',
    features: ['Readiness analysis', 'Up to 3 campaigns', 'Email support'],
  },
  {
    key: 'marketer',
    name: 'Campaign Marketer',
    description: 'For growing marketing teams.',
    features: ['Everything in Starter', 'Unlimited campaigns', 'Priority support', 'API access'],
    highlighted: true,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    description: 'Custom solutions for large organizations.',
    features: ['Everything in Campaign Marketer', 'Dedicated success manager', 'SLA', 'Custom integrations'],
  },
];

function getDefaultCurrency(): Currency {
  if (typeof window === 'undefined') return 'USD';
  return navigator.language?.includes('en-IN') ? 'INR' : 'USD';
}

export default function PricingPage() {
  const [currency, setCurrency] = useState<Currency>('USD');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCurrency(getDefaultCurrency());
  }, []);

  const price = (key: keyof typeof PRICING.INR) => PRICING[currency][key];

  return (
    <div className="min-h-screen bg-[#F5F9FF]">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-center text-4xl font-bold text-gray-900 sm:text-5xl">
          Pricing
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-center text-gray-600">
          Choose the plan that fits your team. Geo-based currency shown by default.
        </p>

        <div className="mt-8 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => setCurrency('INR')}
            className={`rounded-omnivyra px-4 py-2 text-sm font-semibold ${
              currency === 'INR'
                ? 'bg-gradient-to-r from-[#0B5ED7] to-[#1EA7FF] text-white'
                : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            INR
          </button>
          <button
            type="button"
            onClick={() => setCurrency('USD')}
            className={`rounded-omnivyra px-4 py-2 text-sm font-semibold ${
              currency === 'USD'
                ? 'bg-gradient-to-r from-[#0B5ED7] to-[#1EA7FF] text-white'
                : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            USD
          </button>
        </div>

        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.key}
              className={`rounded-2xl border p-8 shadow-omnivyra ${
                plan.highlighted
                  ? 'border-[#0B5ED7] bg-white ring-2 ring-[#0B5ED7]/30'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <h2 className="text-xl font-semibold text-gray-900">{plan.name}</h2>
              <p className="mt-2 text-sm text-gray-600">{plan.description}</p>
              <div className="mt-6 text-3xl font-bold text-gray-900">
                {mounted ? price(plan.key as keyof typeof PRICING.INR) : '—'}
              </div>
              <ul className="mt-6 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                    <Check className="h-5 w-5 shrink-0 text-[#0B5ED7]" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                className={`mt-8 block w-full rounded-omnivyra py-3 text-center font-semibold ${
                  plan.highlighted
                    ? 'landing-btn-primary'
                    : 'landing-btn-secondary'
                }`}
              >
                Get Started
              </Link>
            </div>
          ))}
        </div>
      </div>
      <Footer />
    </div>
  );
}
