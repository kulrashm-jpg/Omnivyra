import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import Footer from '../components/landing/Footer';
import { getAboutImages } from '../lib/unsplashAboutImages';
import type { AboutImages, AboutImage } from '../lib/unsplashAboutImages';

// ── Reusable image block ───────────────────────────────────────────────────────

function SectionImage({
  image,
  alt,
  className = '',
}: {
  image: AboutImage;
  alt: string;
  className?: string;
}) {
  return (
    <div className={`relative w-full overflow-hidden rounded-2xl ${className}`}>
      <Image
        src={image.url}
        alt={alt}
        width={1400}
        height={787}
        className="w-full h-full object-cover"
        sizes="(max-width: 768px) 100vw, (max-width: 1280px) 80vw, 1200px"
      />
      <a
        href={`${image.photoUrl}?utm_source=omnivyra&utm_medium=referral`}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-2 right-3 text-[10px] text-white/70 hover:text-white transition-colors"
      >
        Photo by {image.credit} · Unsplash
      </a>
    </div>
  );
}

// ── Who This Is For — card ─────────────────────────────────────────────────────

type AudienceCard = {
  icon: string;
  role: string;
  need: string;
};

const AUDIENCE: AudienceCard[] = [
  { icon: '📊', role: 'CMOs & Marketing Leaders', need: 'Need clarity before committing budget' },
  { icon: '🚀', role: 'Founders', need: 'Need results without mastering everything' },
  { icon: '🤝', role: 'Teams', need: 'Need alignment across moving parts' },
  { icon: '⚡', role: 'Creators & Operators', need: 'Need consistent, predictable growth' },
];

// ── What Changes — benefit grid ───────────────────────────────────────────────

const BENEFITS = [
  { icon: '✓', text: 'You stop second-guessing' },
  { icon: '✓', text: 'You catch issues earlier' },
  { icon: '✓', text: 'You spend with confidence' },
  { icon: '✓', text: 'You work with structure' },
  { icon: '✓', text: 'You reduce firefighting' },
  { icon: '✓', text: 'You move with direction' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AboutPage({ hero, chaos, disconnected, connected, blueprint }: AboutImages) {
  return (
    <div className="min-h-screen bg-[#F5F9FF] font-sans">

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 1 — HERO
      ══════════════════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0A1F44] via-[#0A3872] to-[#0A66C2]">
        {/* Decorative orbs */}
        <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-[#0A66C2]/30 blur-[120px]" />
        <div className="pointer-events-none absolute top-20 right-0 h-72 w-72 rounded-full bg-[#3FA9F5]/20 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 h-64 w-[600px] rounded-full bg-[#0A66C2]/20 blur-[80px]" />

        <div className="relative mx-auto max-w-5xl px-6 pt-24 pb-20 sm:pt-32 sm:pb-28 text-center">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-white/80 mb-8">
            About Omnivyra
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl leading-[1.1]">
            Clarity,{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#3FA9F5] to-white">
              before you commit.
            </span>
          </h1>

          <p className="mt-6 mx-auto max-w-2xl text-lg text-white/75 leading-relaxed sm:text-xl">
            Omnivyra helps you understand your marketing — before you spend, before you scale, before you guess.
          </p>

          <p className="mt-4 text-base text-white/50 italic">
            Most marketing problems don't start in execution. They start before it.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/get-free-credits"
              className="rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-[#0A1F44] shadow-lg hover:bg-white/90 transition-all"
            >
              Get Free Credits
            </Link>
            <Link
              href="/features"
              className="rounded-full border border-white/30 bg-white/10 px-8 py-3.5 text-sm font-semibold text-white backdrop-blur-sm hover:bg-white/20 transition-all"
            >
              See How It Works
            </Link>
          </div>
        </div>

        {/* Hero image */}
        <div className="mx-auto max-w-5xl px-6 pb-0">
          <div className="relative aspect-[16/7] overflow-hidden rounded-t-2xl shadow-2xl">
            <Image
              src={hero.url}
              alt="Abstract clarity visual"
              fill
              className="object-cover opacity-80"
              priority
              sizes="(max-width: 1280px) 100vw, 1280px"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0A1F44]/60 to-transparent" />
            <a
              href={`${hero.photoUrl}?utm_source=omnivyra&utm_medium=referral`}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-3 right-4 text-[10px] text-white/60 hover:text-white transition-colors"
            >
              Photo by {hero.credit} · Unsplash
            </a>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 2 — THE REALITY
      ══════════════════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-[#0B1F33]">
        {/* Subtle orb */}
        <div className="pointer-events-none absolute top-0 right-0 h-80 w-80 rounded-full bg-[#0A66C2]/15 blur-[100px]" />

        <div className="relative mx-auto max-w-6xl px-6 py-14 sm:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-14 items-stretch">

            {/* Left: text */}
            <div className="flex flex-col justify-center">
              <div className="inline-block w-fit rounded-full bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-white/60 mb-5">
                The Reality
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl leading-tight">
                Marketing didn't get simpler.
                <br />
                <span className="text-[#3FA9F5]">It just got faster.</span>
              </h2>

              {/* Stat row */}
              <div className="mt-8 grid grid-cols-3 gap-3">
                {[
                  { num: '14+', label: 'avg channels per brand' },
                  { num: '40%', label: 'budget spent without clarity' },
                  { num: '3×', label: 'more tools than 5 years ago' },
                ].map(({ num, label }) => (
                  <div key={num} className="rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-center">
                    <p className="text-2xl font-bold text-[#3FA9F5]">{num}</p>
                    <p className="mt-1 text-xs text-white/50 leading-snug">{label}</p>
                  </div>
                ))}
              </div>

              <p className="mt-7 text-white/60 leading-relaxed text-sm">
                And less time to ask:{' '}
                <span className="text-white/90 font-medium italic">Is this ready? Will this work? What are we missing?</span>
              </p>
              <p className="mt-4 text-white/60 leading-relaxed text-sm">
                Most teams move forward anyway.{' '}
                <strong className="text-white font-semibold">They launch first. Understand later.</strong>
              </p>

              <div className="mt-6 rounded-xl border-l-4 border-[#3FA9F5] bg-white/5 px-5 py-4">
                <p className="text-sm text-[#3FA9F5] font-medium leading-relaxed">
                  Not because they lack effort — but because they lacked visibility before execution.
                </p>
              </div>
            </div>

            {/* Right: image */}
            <div className="relative overflow-hidden rounded-2xl min-h-[280px]">
              <Image
                src={chaos.url}
                alt="Marketing analytics dashboard showing multiple channel performance"
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
              {/* Dark overlay bottom */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B1F33]/70 via-transparent to-transparent" />
              {/* Caption */}
              <div className="absolute bottom-4 left-4 right-4">
                <p className="text-xs text-white/40 italic">Tracking more channels — seeing less of what matters</p>
              </div>
              <a
                href={`${chaos.photoUrl}?utm_source=omnivyra&utm_medium=referral`}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute bottom-2 right-3 text-[9px] text-white/30 hover:text-white/60 transition-colors"
              >
                {chaos.credit} · Unsplash
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 3 — THE GAP
      ══════════════════════════════════════════════════════════════════════════ */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-14 sm:py-20">

          {/* Section label + heading — full width */}
          <div className="mb-10">
            <div className="inline-block rounded-full bg-amber-100 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-amber-700 mb-4">
              The Gap
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-20 items-end">
              <h2 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl leading-tight">
                The problem isn't effort.
                <br />
                <span className="text-[#0A66C2]">It's what you can't see.</span>
              </h2>
              <p className="text-[#6B7C93] text-base leading-relaxed">
                Automation increased speed — not clarity. More activity doesn't mean better outcomes.
                Without structure, it creates noise.
              </p>
            </div>
          </div>

          {/* 3 symptom cards + image side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch">

            {/* Cards — span 2 cols */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              {[
                {
                  label: 'Disconnected',
                  desc: 'Channels, content and campaigns run in silos — no shared view of readiness.',
                  icon: '⛓️',
                  color: 'border-red-200 bg-red-50',
                  dot: 'bg-red-400',
                },
                {
                  label: 'Reactive',
                  desc: 'Problems surface mid-campaign. Fixes happen after spend, not before it.',
                  icon: '🔥',
                  color: 'border-amber-200 bg-amber-50',
                  dot: 'bg-amber-400',
                },
                {
                  label: 'Evaluated too late',
                  desc: 'Budgets are committed before anyone checks whether the system is ready.',
                  icon: '⏱️',
                  color: 'border-orange-200 bg-orange-50',
                  dot: 'bg-orange-400',
                },
              ].map(({ label, desc, icon, color, dot }) => (
                <div key={label} className={`flex items-start gap-4 rounded-2xl border ${color} px-5 py-4`}>
                  <span className="text-xl mt-0.5 shrink-0">{icon}</span>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`h-2 w-2 rounded-full ${dot} shrink-0`} />
                      <p className="text-sm font-bold text-[#0B1F33]">{label}</p>
                    </div>
                    <p className="text-xs text-[#6B7C93] leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}

              {/* Punchline */}
              <div className="rounded-2xl border-l-4 border-[#0A66C2] bg-[#F5F9FF] px-5 py-4 mt-1">
                <p className="text-sm font-semibold text-[#0B1F33] leading-relaxed">
                  Without structure, speed becomes a liability — not an advantage.
                </p>
              </div>
            </div>

            {/* Image — span 3 cols */}
            <div className="lg:col-span-3 relative overflow-hidden rounded-2xl min-h-[360px] shadow-lg">
              <Image
                src={disconnected.url}
                alt="Marketing performance gap — activity vs results"
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 60vw"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-[#0B1F33]/50 via-transparent to-transparent" />
              {/* Floating label */}
              <div className="absolute top-5 left-5 rounded-xl bg-white/90 backdrop-blur-sm px-4 py-3 shadow-lg max-w-[200px]">
                <p className="text-xs font-bold text-red-600 mb-0.5">Gap identified</p>
                <p className="text-xs text-[#6B7C93] leading-snug">Activity high. Results unclear. No structure in between.</p>
              </div>
              <a
                href={`${disconnected.photoUrl}?utm_source=omnivyra&utm_medium=referral`}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute bottom-2 right-3 text-[9px] text-white/40 hover:text-white/70 transition-colors"
              >
                {disconnected.credit} · Unsplash
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 4 — WHO THIS IS FOR
      ══════════════════════════════════════════════════════════════════════════ */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="text-center mb-14">
            <div className="inline-block rounded-full bg-[#0A66C2]/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-[#0A66C2] mb-6">
              Who It's For
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl">
              If you're responsible for growth,
              <br className="hidden sm:block" />
              <span className="text-[#0A66C2]"> this was built for you.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {AUDIENCE.map(({ icon, role, need }) => (
              <div
                key={role}
                className="group relative rounded-2xl border border-gray-100 bg-[#F5F9FF] p-6 hover:border-[#0A66C2]/30 hover:shadow-md transition-all duration-200"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm text-2xl">
                  {icon}
                </div>
                <h3 className="text-base font-semibold text-[#0B1F33] leading-snug mb-2">{role}</h3>
                <p className="text-sm text-[#6B7C93] leading-relaxed">{need}</p>
                <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-2xl bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <p className="text-[#6B7C93] text-base">
              Different roles. Same pressure.{' '}
              <span className="font-semibold text-[#0B1F33]">"We need this to work."</span>
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 5 — WHAT OMNIVYRA DOES
      ══════════════════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-[#0A1F44]">
        {/* Full-bleed image as section background — right half */}
        <div className="absolute inset-y-0 right-0 w-full lg:w-1/2">
          <Image
            src={connected.url}
            alt="Team building unified marketing strategy"
            fill
            className="object-cover object-center opacity-30 lg:opacity-50"
            sizes="(max-width: 1024px) 100vw, 50vw"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0A1F44] via-[#0A1F44]/80 to-[#0A1F44]/20 lg:via-[#0A1F44]/60 lg:to-transparent" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 py-14 sm:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
            {/* Text — full left half */}
            <div>
              <div className="inline-block rounded-full border border-white/20 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-white/70 mb-5">
                What We Built
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl leading-tight">
                So we built{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#3FA9F5] to-white">
                  something different.
                </span>
              </h2>
              <p className="mt-5 text-white/60 text-sm leading-relaxed">
                Omnivyra starts before execution — not during it.
              </p>

              {/* 4-step connected flow */}
              <div className="mt-7 relative">
                {/* Vertical connector */}
                <div className="absolute left-[19px] top-8 bottom-8 w-px bg-gradient-to-b from-[#3FA9F5]/60 to-[#3FA9F5]/10" />
                <div className="space-y-4">
                  {[
                    { step: '01', text: 'Understand your current state', sub: 'Audit readiness before anything else' },
                    { step: '02', text: 'Identify gaps early',            sub: "Surface what's missing, not what's broken" },
                    { step: '03', text: 'Align everything to campaigns',  sub: 'One view — channels, content, conversion' },
                    { step: '04', text: 'Move forward with clarity',      sub: 'Spend with confidence, not hope' },
                  ].map(({ step, text, sub }) => (
                    <div key={step} className="flex items-start gap-4 pl-1">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#3FA9F5]/40 bg-[#3FA9F5]/10 text-xs font-bold text-[#3FA9F5]">
                        {step}
                      </div>
                      <div className="pt-1">
                        <p className="text-sm font-semibold text-white">{text}</p>
                        <p className="text-xs text-white/40 mt-0.5">{sub}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 rounded-2xl border border-[#3FA9F5]/20 bg-white/5 backdrop-blur-sm px-5 py-4">
                <p className="text-sm text-white/75 leading-relaxed">
                  Not by adding more tools — but by{' '}
                  <strong className="text-white">connecting everything into one system</strong>{' '}
                  — your campaign planning software and marketing insights platform in one place.
                </p>
              </div>
            </div>

            {/* Right col: floating stat cards over the image */}
            <div className="hidden lg:flex flex-col justify-center gap-4 pl-8">
              {[
                { label: 'Pre-execution clarity', value: 'Before you spend' },
                { label: 'Gap detection',         value: 'Before launch' },
                { label: 'One connected view',    value: 'Not 7 dashboards' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md px-5 py-4">
                  <p className="text-xs text-white/40 uppercase tracking-widest mb-1">{label}</p>
                  <p className="text-base font-bold text-white">{value}</p>
                </div>
              ))}
              <a
                href={`${connected.photoUrl}?utm_source=omnivyra&utm_medium=referral`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] text-white/20 hover:text-white/40 transition-colors mt-2 self-end"
              >
                {connected.credit} · Unsplash
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 6 — WHAT CHANGES
      ══════════════════════════════════════════════════════════════════════════ */}
      <section className="bg-[#F5F9FF]">
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
          <div className="text-center mb-14">
            <div className="inline-block rounded-full bg-emerald-100 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-emerald-700 mb-6">
              The Difference
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl">
              What changes when you
              <span className="text-[#0A66C2]"> have clarity</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {BENEFITS.map(({ text }) => (
              <div
                key={text}
                className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-white px-6 py-5 shadow-sm hover:shadow-md hover:border-[#0A66C2]/20 transition-all"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5]">
                  <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <span className="text-sm font-semibold text-[#0B1F33]">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 7 — PHILOSOPHY
      ══════════════════════════════════════════════════════════════════════════ */}
      <section className="bg-[#F5F9FF]">
        <div className="mx-auto max-w-6xl px-6 py-14 sm:py-20">

          {/* Full-width image with overlay — sits above the text content */}
          <div className="relative overflow-hidden rounded-2xl mb-10 shadow-lg">
            <div className="aspect-[21/7] relative">
              <Image
                src={blueprint.url}
                alt="Marketing team working as a structured system"
                fill
                className="object-cover object-top"
                sizes="(max-width: 1280px) 100vw, 1280px"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#0A1F44]/80 via-[#0A1F44]/50 to-transparent" />
              {/* Overlay text */}
              <div className="absolute inset-0 flex items-center px-8 sm:px-12">
                <div className="max-w-lg">
                  <div className="inline-block rounded-full bg-white/10 border border-white/20 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-white/70 mb-4">
                    Our Philosophy
                  </div>
                  <p className="text-2xl sm:text-3xl font-bold text-white leading-snug">
                    Marketing works better when it's treated{' '}
                    <span className="text-[#3FA9F5]">like a system.</span>
                  </p>
                  <p className="mt-3 text-white/60 text-sm leading-relaxed">
                    Campaigns, content, channels, and conversion are connected — not isolated.
                  </p>
                </div>
              </div>
            </div>
            <a
              href={`${blueprint.photoUrl}?utm_source=omnivyra&utm_medium=referral`}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-2 right-3 text-[9px] text-white/30 hover:text-white/60 transition-colors"
            >
              {blueprint.credit} · Unsplash
            </a>
          </div>

          {/* Content below the image */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Before/After */}
            <div className="lg:col-span-1 grid grid-cols-2 gap-4 content-start">
              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-5">
                <p className="text-xs font-bold text-red-500 uppercase tracking-wide mb-2">Treated separately</p>
                <p className="text-sm text-red-700 leading-snug">Unpredictable outcomes. Reactive decisions.</p>
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-5">
                <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-2">Treated as a system</p>
                <p className="text-sm text-emerald-700 leading-snug">Scalable, structured, confident execution.</p>
              </div>
            </div>

            {/* AI callout */}
            <div className="rounded-2xl border border-violet-100 bg-violet-50 px-6 py-5">
              <p className="text-xs font-bold text-violet-600 uppercase tracking-widest mb-2">On AI</p>
              <p className="text-sm text-violet-800 leading-relaxed font-medium">
                AI doesn't fix broken systems. It amplifies what already exists.
              </p>
              <p className="text-xs text-violet-600 mt-2 leading-relaxed">
                Strong foundations in your content strategy and SEO analysis enable clarity — not confusion.
              </p>
            </div>

            {/* Closing principle */}
            <div className="rounded-2xl bg-gradient-to-br from-[#0A1F44] to-[#0A66C2] px-6 py-5 flex flex-col justify-between">
              <div className="text-2xl text-white/20 font-serif leading-none">"</div>
              <div>
                <p className="text-base font-bold text-white leading-snug">
                  Structure creates clarity.
                </p>
                <p className="text-sm text-white/60 mt-1">Clarity enables growth.</p>
              </div>
              <p className="text-xs text-white/30 mt-4 uppercase tracking-widest">Omnivyra</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 8 — FINAL CTA
      ══════════════════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0A1F44] via-[#0A3872] to-[#0A66C2]">
        <div className="pointer-events-none absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-[#3FA9F5]/20 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 right-1/4 h-48 w-96 rounded-full bg-white/5 blur-[80px]" />

        <div className="relative mx-auto max-w-3xl px-6 py-24 sm:py-32 text-center">
          {/* Decorative line */}
          <div className="mx-auto mb-8 h-px w-24 bg-gradient-to-r from-transparent via-white/30 to-transparent" />

          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-5xl leading-tight">
            If you had clarity,
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#3FA9F5] to-white">
              what would you do differently?
            </span>
          </h2>

          <p className="mt-6 text-lg text-white/65">
            Now you don't have to guess.
          </p>

          <div className="mt-10">
            <Link
              href="/get-free-credits"
              className="inline-flex items-center gap-2 rounded-full bg-white px-10 py-4 text-sm font-bold text-[#0A1F44] shadow-xl hover:bg-white/90 transition-all hover:scale-105"
            >
              👉 Get Free Credits
            </Link>
          </div>

          <p className="mt-6 text-xs text-white/40">
            No credit card required · 300 credits free · Start in minutes
          </p>

          <div className="mx-auto mt-12 h-px w-24 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        </div>
      </section>

      <Footer />
    </div>
  );
}

export async function getStaticProps() {
  const images = await getAboutImages();
  return {
    props: images,
    revalidate: 86400,
  };
}
