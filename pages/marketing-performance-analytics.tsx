import Link from 'next/link';
import Footer from '../components/landing/Footer';
import MarketingPageMeta from '../components/seo/MarketingPageMeta';

export default function MarketingPerformanceAnalyticsPage() {
  return (
    <>
      <MarketingPageMeta
        title="Marketing Performance Analytics | Omnivyra"
        description="Learn how marketing performance analytics helps teams understand conversions, engagement, drop-offs, and the next best actions to improve growth."
        path="/marketing-performance-analytics"
      />
      <main className="min-h-screen bg-[#F5F9FF]" style={{ fontFamily: "'Inter', sans-serif" }}>
        <section className="px-6 py-20 lg:px-8">
          <div className="mx-auto max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">
              Topic page
            </p>
            <h1
              className="mt-4 text-4xl font-bold tracking-tight text-[#0B1F33] sm:text-5xl"
              style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
            >
              Marketing performance analytics
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-[#6B7C93]">
              Marketing performance analytics helps teams understand what is driving results across campaigns, channels, and content. It connects metrics like conversions, engagement, acquisition efficiency, and drop-offs to the decisions that improve growth.
            </p>
          </div>
        </section>

        <section className="px-6 pb-20 lg:px-8">
          <div className="mx-auto grid max-w-4xl gap-6">
            {[
              {
                title: 'What marketing performance analytics measures',
                body: 'A strong analytics system tracks channel performance, funnel behavior, conversion trends, content contribution, and the points where prospects lose momentum.',
              },
              {
                title: 'Why teams struggle to act on analytics',
                body: 'Many teams can see dashboards, but they still cannot identify the next best action because performance data is separated from execution decisions.',
              },
              {
                title: 'How Omnivyra approaches analytics',
                body: 'Omnivyra analyzes marketing performance, funnel behavior, conversion trends, and drop-offs, then translates those signals into prioritized actions teams can execute.',
              },
            ].map((section) => (
              <article key={section.title} className="rounded-2xl border border-gray-200/70 bg-white p-8 shadow-[0_2px_12px_rgba(10,31,68,0.05)]">
                <h2 className="text-2xl font-semibold text-[#0B1F33]">{section.title}</h2>
                <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">{section.body}</p>
              </article>
            ))}
            <p className="text-sm text-[#6B7C93]">
              Next: explore{' '}
              <Link href="/funnel-and-conversion-analysis" className="font-semibold text-[#0A66C2]">
                funnel and conversion analysis
              </Link>{' '}
              or return to the{' '}
              <Link href="/landing" className="font-semibold text-[#0A66C2]">
                Omnivyra landing page
              </Link>
              .
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
