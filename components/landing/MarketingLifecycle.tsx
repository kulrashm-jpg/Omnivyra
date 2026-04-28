'use client';

import React from 'react';
import {
  Search,
  Crosshair,
  Map,
  PenLine,
  Share2,
  LineChart,
  type LucideIcon,
} from 'lucide-react';

const stages: {
  icon: LucideIcon;
  title: string;
  description: string;
}[] = [
  {
    icon: Search,
    title: 'Discover',
    description:
      'Omnivyra analyzes your website, messaging, and campaign structure to understand how prepared you are to attract and convert your audience.',
  },
  {
    icon: Crosshair,
    title: 'Align',
    description:
      'AI evaluates positioning, audience focus, and value communication to ensure your campaigns begin with strategic clarity.',
  },
  {
    icon: Map,
    title: 'Plan',
    description:
      'Based on insights, Omnivyra recommends the most effective marketing approach, including content direction and engagement strategy.',
  },
  {
    icon: PenLine,
    title: 'Create',
    description:
      'Generate campaign-ready marketing content aligned with your messaging, audience intent, and brand positioning.',
  },
  {
    icon: Share2,
    title: 'Distribute',
    description:
      'Schedule and publish content across marketing channels to maintain consistent brand presence and audience engagement.',
  },
  {
    icon: LineChart,
    title: 'Learn',
    description:
      'Omnivyra continuously analyzes campaign signals and engagement patterns to refine and improve marketing outcomes.',
  },
];

function FlowArrow() {
  return (
    <div className="hidden flex-shrink-0 items-center justify-center px-1 lg:flex" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    </div>
  );
}

export default function MarketingLifecycle() {
  const row1 = stages.slice(0, 3);
  const row2 = stages.slice(3, 6);

  return (
    <section className="bg-[#F5F9FF] px-4 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
          How Omnivyra Powers Your Marketing
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg leading-relaxed text-gray-600">
          From insight to engagement — Omnivyra helps you understand, plan, create, and amplify marketing impact.
        </p>

        {/* Desktop: 2 rows of 3 cards with flow arrows */}
        <div className="mt-16 hidden lg:block lg:mt-20">
          <div className="flex flex-wrap items-stretch justify-center gap-3">
            {row1.map((stage, i) => (
              <React.Fragment key={stage.title}>
                <LifecycleCard {...stage} className="lg:min-w-[280px] lg:max-w-[300px]" />
                {i < row1.length - 1 && (
                  <div className="flex flex-shrink-0 items-center px-1">
                    <FlowArrow />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-stretch justify-center gap-3">
            {row2.map((stage, i) => (
              <React.Fragment key={stage.title}>
                <LifecycleCard {...stage} className="lg:min-w-[280px] lg:max-w-[300px]" />
                {i < row2.length - 1 && (
                  <div className="flex flex-shrink-0 items-center px-1">
                    <FlowArrow />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Tablet: 2 per row | Mobile: 1 per row */}
        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2 lg:mt-0 lg:hidden">
          {stages.map((stage) => (
            <LifecycleCard key={stage.title} {...stage} />
          ))}
        </div>

        {/* Footer line */}
        <p className="mx-auto mt-12 max-w-xl text-center text-sm font-medium tracking-wide text-gray-500 sm:mt-16">
          A continuous intelligence loop designed to strengthen every campaign.
        </p>
      </div>
    </section>
  );
}

function LifecycleCard({
  icon: Icon,
  title,
  description,
  className = '',
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      className={`group relative flex flex-col rounded-[16px] border border-[#E6EEF8] bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(11,94,215,0.04)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#D4E2F5] hover:shadow-[0_8px_24px_rgba(11,94,215,0.08),0_0_0_1px_rgba(30,107,255,0.08)] ${className}`}
      style={{ minHeight: '180px' }}
    >
      <div className="mb-4 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EDF4FF] text-[#1E6BFF] transition-colors duration-300 group-hover:bg-[#D6E8FF]">
        <Icon className="h-5 w-5" strokeWidth="1.75" />
      </div>
      <h3 className="font-semibold tracking-tight text-gray-900">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-gray-600">{description}</p>
    </div>
  );
}
