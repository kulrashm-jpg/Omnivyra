import React from 'react';
import Image from 'next/image';
import Footer from '../components/landing/Footer';
import { getAboutImages } from '../lib/unsplashAboutImages';
import type { AboutImage } from '../lib/unsplashAboutImages';

type AboutPageProps = {
  architectural: AboutImage | null;
  systems: AboutImage | null;
};

function AboutImageBlock({
  image,
  placeholderLabel,
  className = '',
}: {
  image: AboutImage | null;
  placeholderLabel: string;
  className?: string;
}) {
  if (!image) {
    return (
      <div
        className={`aspect-[2.5/1] w-full rounded-lg border border-gray-200/80 bg-gradient-to-br from-gray-50 to-gray-100/80 flex items-center justify-center ${className}`}
      >
        <span className="text-sm text-gray-400">{placeholderLabel}</span>
      </div>
    );
  }
  return (
    <div className={`relative aspect-[2.5/1] w-full overflow-hidden rounded-lg border border-gray-200/80 ${className}`}>
      <Image
        src={image.url}
        alt=""
        fill
        className="object-cover"
        sizes="(max-width: 1024px) 100vw, 1280px"
      />
      <a
        href={`${image.photoUrl}?utm_source=omnivyra&utm_medium=referral`}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-2 right-2 text-[10px] text-white/90 underline hover:text-white"
      >
        Photo by {image.credit} on Unsplash
      </a>
    </div>
  );
}

export default function AboutPage({ architectural, systems }: AboutPageProps) {
  return (
    <div className="min-h-screen bg-[#FAFBFC]">
      {/* ——— 1. Hero (Repositioning Layer) ——— */}
      <header className="border-b border-gray-200/80 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <h1 className="text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
            Engineering Clarity Into Modern Marketing.
          </h1>
          <p className="mt-6 text-xl text-gray-600 leading-relaxed">
            Omnivyra exists to reduce complexity, restore structure, and bring intelligent discipline to how campaigns are built and executed.
          </p>
          <div className="mt-10 space-y-4 text-gray-600 leading-relaxed">
            <p>
              Marketing complexity has increased: more channels, more automation, more pressure to move fast. Leaders rarely have time to audit every structural detail of a campaign before budget is committed. Many teams operate without clarity into readiness—whether conversion paths are coherent, whether messaging holds up, whether execution risk is contained. Omnivyra exists to provide that clarity before money is spent.
            </p>
          </div>
        </div>
      </header>

      {/* Related image: Unsplash (architecture / structure theme) */}
      <div className="mx-auto max-w-5xl px-6 py-12 sm:py-16" data-image-placement="architectural-grid">
        <AboutImageBlock
          image={architectural}
          placeholderLabel="Abstract architectural / workflow visual"
        />
      </div>

      {/* ——— 2. The Real Problem (Structural Pressure) ——— */}
      <section className="border-t border-gray-200/60 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Marketing Is Moving Faster Than Its Architecture.
          </h2>
          <div className="mt-8 space-y-6 text-gray-600 leading-relaxed">
            <p>
              CMOs face execution pressure from the board and the market. Founders are expected to drive growth without always having deep marketing clarity. Teams jump to execution—tactics, channels, content—without a shared view of readiness. Budgets are deployed before structural evaluation: conversion paths, messaging coherence, and execution risk are often discovered only after spend has begun.
            </p>
            <p>
              Automation amplifies the problem. When structure is missing, more volume does not mean better outcomes; it means more chaos. The real constraint is not tools—it is the discipline to evaluate and strengthen the system before scaling it.
            </p>
          </div>
        </div>
      </section>

      {/* ——— 3. Who We Serve ——— */}
      <section className="border-t border-gray-200/60 bg-[#FAFBFC]">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            For Those Responsible for Growth — With or Without Marketing Expertise.
          </h2>
          <div className="mt-8 space-y-6 text-gray-600 leading-relaxed">
            <p>
              Omnivyra serves CMOs who carry performance accountability and need visibility into campaign readiness before execution. It serves marketing leaders who are scaling automation and want structure, not just volume. It serves founders who must market but lack the time to become experts in every structural detail. It serves business owners who do not fully understand marketing mechanics but are responsible for growth. It serves teams who need clarity before committing budget—so that when they spend, they spend with confidence.
            </p>
            <p>
              The common thread is reduced uncertainty. Whether you are an expert or not, Omnivyra is built to surface what matters: readiness, gaps, and risk—before money and time are committed.
            </p>
          </div>
        </div>
      </section>

      {/* Related image: Unsplash (systems / network theme) */}
      <div className="mx-auto max-w-5xl px-6 py-12 sm:py-16" data-image-placement="systems-overlay">
        <AboutImageBlock
          image={systems}
          placeholderLabel="Systems / architecture visual"
          className="bg-gradient-to-br from-gray-100/80 to-gray-50"
        />
      </div>

      {/* ——— 4. The Benefit We Deliver ——— */}
      <section className="border-t border-gray-200/60 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            What This Means for You.
          </h2>
          <div className="mt-10 space-y-12">
            <div>
              <h3 className="text-lg font-medium text-gray-900">Reduced decision ambiguity</h3>
              <p className="mt-2 text-gray-600 leading-relaxed">
                You get a structured view of campaign readiness before you commit. That means fewer “should we or shouldn’t we” moments and clearer criteria for when to proceed, pause, or fix.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900">Clearer campaign readiness</h3>
              <p className="mt-2 text-gray-600 leading-relaxed">
                Readiness is not a guess. It is evaluated against conversion structure, messaging strength, and execution risk—so you know where you stand before launch, not after.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900">Stronger conversion paths</h3>
              <p className="mt-2 text-gray-600 leading-relaxed">
                Gaps in CTAs, messaging, and funnel flow are surfaced early. Fixing them before spend reduces wasted budget and improves the likelihood that execution actually converts.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900">Confidence before spend</h3>
              <p className="mt-2 text-gray-600 leading-relaxed">
                Budget is deployed with a clearer picture of risk and readiness. That shifts the default from “spend and hope” to “evaluate, then spend.”
              </p>
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900">Structured visibility into marketing systems</h3>
              <p className="mt-2 text-gray-600 leading-relaxed">
                Marketing is treated as a system. You gain visibility into how structure, messaging, and conversion fit together—so scaling and automation rest on a solid base.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900">Less reactive firefighting</h3>
              <p className="mt-2 text-gray-600 leading-relaxed">
                When readiness is evaluated up front, fewer surprises appear mid-campaign. Teams spend less time fixing what could have been caught earlier and more time executing with intention.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ——— 5. Our Philosophy ——— */}
      <section className="border-t border-gray-200/60 bg-[#FAFBFC]">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Marketing Should Be Engineered, Not Improvised.
          </h2>
          <div className="mt-8 space-y-6 text-gray-600 leading-relaxed">
            <p>
              Marketing is a system. Channels, messaging, conversion paths, and execution are interconnected. When they are treated as ad hoc tactics, outcomes become unpredictable. When they are treated as architecture—with structure, evaluation, and discipline—they become manageable and scalable.
            </p>
            <p>
              AI and automation must operate within that structure. They amplify what exists: if the foundation is weak, automation amplifies chaos; if the foundation is clear, automation amplifies clarity. Discipline enables creativity—constraints and visibility free teams to focus on what matters. Architecture enables scale. Structure reduces risk.
            </p>
            <p>
              Omnivyra is built on that philosophy: not as a replacement for judgment, but as a layer that brings engineering rigor to how marketing is planned and executed.
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

export async function getStaticProps() {
  const { architectural, systems } = await getAboutImages();
  return {
    props: { architectural, systems },
    revalidate: 86400, // refresh daily
  };
}
