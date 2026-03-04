'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Quote } from 'lucide-react';

const TESTIMONIALS = [
  {
    name: 'Priya Sharma',
    role: 'Head of Marketing, TechFlow',
    avatar: null,
    quote: 'We got our readiness score in under three minutes. Fixed two conversion gaps before launch and saw 2.3x better ROI in the first month.',
    roi: '2.3x ROI',
    speed: 'First results in 48 hrs',
    metric: '3 strategic gaps fixed',
  },
  {
    name: 'Rahul Mehta',
    role: 'Growth Lead, ScaleUp SaaS',
    avatar: null,
    quote: 'Omnivyra caught messaging misalignment we had missed. Speed to insight is unmatched — we run a check before every campaign now.',
    roi: '40% higher conversion',
    speed: 'Insight in under 5 min',
    metric: 'Unified CTA hierarchy',
  },
  {
    name: 'Anita Krishnan',
    role: 'CMO, RetailNext',
    avatar: null,
    quote: 'ROI and speed were the two things we cared about. We got both: clearer structure and faster go-to-market with way less back-and-forth.',
    roi: '1.8x campaign ROI',
    speed: 'Weeks saved per quarter',
    metric: 'Clear execution roadmap',
  },
  {
    name: 'Marcus Chen',
    role: 'VP Growth, FinServe',
    avatar: null,
    quote: 'Finally one place for strategy and execution. No more decks that don’t match what we actually ship. Omnivyra keeps everyone on the same page.',
    roi: 'Single source of truth',
    speed: 'Alignment in minutes',
    metric: 'Fewer alignment meetings',
  },
  {
    name: 'Elena Vasquez',
    role: 'Brand Director, HealthFirst',
    avatar: null,
    quote: 'The AI actually understands our tone and guidelines. We get on-brand suggestions without rewriting everything — it feels like having a sharp strategist in the room.',
    roi: 'On-brand first time',
    speed: 'Draft in seconds',
    metric: 'Less copy-editing',
  },
  {
    name: 'David Okonkwo',
    role: 'Head of Digital, EduTech Pro',
    avatar: null,
    quote: 'Campaign health in one view changed how we work. We see what’s working and what’s drifting before it’s too late. No more guessing from spreadsheets.',
    roi: 'Real-time health view',
    speed: 'Decisions same day',
    metric: 'Drift caught early',
  },
  {
    name: 'Sofia Patel',
    role: 'Social Lead, TravelCo',
    avatar: null,
    quote: 'Our messaging used to be different on every channel. Omnivyra helped us keep one story everywhere without losing platform nuance. Consistency without the chaos.',
    roi: 'Unified messaging',
    speed: 'Cross-channel in one flow',
    metric: 'One narrative, all channels',
  },
  {
    name: 'James Liu',
    role: 'CMO, B2B Labs',
    avatar: null,
    quote: 'We launch with confidence now. Readiness checks and guardrails mean we don’t ship broken campaigns. Our stakeholders actually trust the dashboard.',
    roi: 'Launch confidence',
    speed: 'Pre-launch checks built-in',
    metric: 'Fewer post-launch fixes',
  },
  {
    name: 'Nina Kowalski',
    role: 'Director of Ops, RetailOps',
    avatar: null,
    quote: 'I got hours back every week. Less firefighting, more time on strategy. Omnivyra handles the heavy lifting so we can focus on what moves the needle.',
    roi: 'Hours saved weekly',
    speed: 'Less manual planning',
    metric: 'Strategy over spreadsheets',
  },
  {
    name: 'Alex Rivera',
    role: 'Head of Marketing, ScaleUp',
    avatar: null,
    quote: 'It’s not another bloated tool. Clean UI, clear recommendations, and the intelligence surfaces what we need when we need it. Our team actually adopted it.',
    roi: 'High adoption',
    speed: 'Quick onboarding',
    metric: 'Team actually uses it',
  },
];

const SCROLL_DURATION_MS = 500;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export default function TestimonialsSection() {
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);
  const count = TESTIMONIALS.length;

  // One step per click, wraps in a round (last → first, first → last)
  const go = (direction: 'prev' | 'next') => {
    setIndex((i) => (direction === 'prev' ? (i - 1 + count) % count : (i + 1) % count));
  };

  // Slow, one-by-one scroll animation to the card at index
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const card = el.querySelector(`[data-index="${index}"]`) as HTMLElement | null;
    if (!card) return;

    const startLeft = el.scrollLeft;
    const targetLeft = card.offsetLeft;
    if (startLeft === targetLeft) return;

    isScrollingRef.current = true;
    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / SCROLL_DURATION_MS, 1);
      const eased = easeInOutCubic(t);
      el.scrollLeft = startLeft + (targetLeft - startLeft) * eased;

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        isScrollingRef.current = false;
      }
    };
    requestAnimationFrame(tick);
  }, [index]);

  // Sync index when user scrolls by hand (swipe/drag)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isScrollingRef.current) return;
      const cards = el.querySelectorAll('[data-index]');
      if (!cards.length) return;
      const containerCenter = el.scrollLeft + el.offsetWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      cards.forEach((c, i) => {
        const card = c as HTMLElement;
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const dist = Math.abs(containerCenter - cardCenter);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setIndex((i) => (best !== i ? best : i));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <section className="bg-white px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-3xl font-bold text-gray-900 sm:text-4xl">
          What Marketers Say
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-gray-600">
          Real outcomes on ROI, speed, and execution clarity.
        </p>

        <div className="relative mt-12">
          <div
            ref={scrollRef}
            className="flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4 scroll-smooth scrollbar-hide md:gap-8"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {TESTIMONIALS.map((t, i) => (
              <div
                key={t.name}
                data-index={i}
                className="min-w-[85%] max-w-[85%] snap-center sm:min-w-[420px] sm:max-w-[420px]"
              >
                <div className="rounded-2xl border border-gray-200 bg-[#F5F9FF] p-6 shadow-omnivyra sm:p-8">
                  <Quote className="h-10 w-10 text-[#0B5ED7]/40" />
                  <blockquote className="mt-4 text-gray-700 leading-relaxed">
                    &ldquo;{t.quote}&rdquo;
                  </blockquote>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <span className="rounded-full bg-[#0B5ED7]/10 px-3 py-1 text-sm font-medium text-[#0B5ED7]">
                      {t.roi}
                    </span>
                    <span className="rounded-full bg-[#0B5ED7]/10 px-3 py-1 text-sm font-medium text-[#0B5ED7]">
                      {t.speed}
                    </span>
                    <span className="rounded-full bg-gray-200/80 px-3 py-1 text-sm text-gray-700">
                      {t.metric}
                    </span>
                  </div>
                  <div className="mt-6 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#0B5ED7] to-[#1EA7FF] text-lg font-bold text-white">
                      {t.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{t.name}</div>
                      <div className="text-sm text-gray-500">{t.role}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => go('prev')}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 shadow-omnivyra transition hover:bg-gray-50 hover:border-[#0B5ED7] hover:text-[#0B5ED7]"
              aria-label="Previous testimonial"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="flex gap-2">
              {TESTIMONIALS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={`h-2.5 w-2.5 rounded-full transition ${
                    i === index ? 'bg-[#0B5ED7] scale-110' : 'bg-gray-300 hover:bg-gray-400'
                  }`}
                  aria-label={`Go to testimonial ${i + 1}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => go('next')}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 shadow-omnivyra transition hover:bg-gray-50 hover:border-[#0B5ED7] hover:text-[#0B5ED7]"
              aria-label="Next testimonial"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
