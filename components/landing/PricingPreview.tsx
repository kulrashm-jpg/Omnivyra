'use client';

import React from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';

const plans = [
  {
    name: 'Starter',
    description: 'For small teams and single campaigns.',
    features: ['Readiness analysis', 'Up to 3 campaigns', 'Email support'],
  },
  {
    name: 'Campaign Marketer',
    description: 'For growing marketing teams.',
    features: ['Everything in Starter', 'Unlimited campaigns', 'Priority support', 'API access'],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    description: 'Custom solutions for large organizations.',
    features: ['Everything in Campaign Marketer', 'Dedicated success manager', 'SLA', 'Custom integrations'],
  },
];

export default function PricingPreview() {
  return (
    <section className="bg-white px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-3xl font-bold text-gray-900 sm:text-4xl">
          Simple, Transparent Pricing
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-gray-600">
          Choose the plan that fits your team. No hidden fees.
        </p>
        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl border p-6 shadow-omnivyra ${
                plan.highlighted
                  ? 'border-[#0B5ED7] bg-[#F5F9FF] ring-2 ring-[#0B5ED7]/30'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <h3 className="text-xl font-semibold text-gray-900">{plan.name}</h3>
              <p className="mt-2 text-sm text-gray-600">{plan.description}</p>
              <ul className="mt-6 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                    <Check className="h-5 w-5 shrink-0 text-[#0B5ED7]" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link
            href="/pricing"
            className="inline-flex items-center rounded-omnivyra landing-btn-primary px-6 py-3 text-base font-semibold"
          >
            View Full Pricing
          </Link>
        </div>
      </div>
    </section>
  );
}
