'use client';

import React from 'react';
import { Search, Layout, MessageSquare, Zap } from 'lucide-react';

const steps = [
  {
    icon: Search,
    title: 'Scan',
    description: 'We scan your website and campaign structure to map CTAs and messaging.',
  },
  {
    icon: Layout,
    title: 'Map',
    description: 'Conversion hierarchy and funnel gaps are identified automatically.',
  },
  {
    icon: MessageSquare,
    title: 'Evaluate',
    description: 'AI evaluates messaging strength and positioning against your goals.',
  },
  {
    icon: Zap,
    title: 'Act',
    description: 'Get a readiness score and actionable recommendations before you spend.',
  },
];

export default function HowItWorks() {
  return (
    <section className="bg-[#F5F9FF] px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-3xl font-bold text-gray-900 sm:text-4xl">
          How It Works
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-gray-600">
          From scan to score in minutes — no credit card, no commitment.
        </p>
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-omnivyra"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#0B5ED7] to-[#1EA7FF] text-white">
                <Icon className="h-6 w-6" />
              </div>
              <h3 className="mt-4 font-semibold text-gray-900">{title}</h3>
              <p className="mt-2 text-sm text-gray-600">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
