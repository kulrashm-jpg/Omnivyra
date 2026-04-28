import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/landing/Footer';

export default function FunnelAndConversionAnalysisPage() {
  return (
    <>
      <Head>
        <title>Funnel and Conversion Analysis | Omnivyra</title>
        <meta
          name="description"
          content="Learn how funnel and conversion analysis reveals drop-offs, bottlenecks, and next best actions so teams can improve marketing performance."
        />
      </Head>
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
              Funnel and conversion analysis
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-[#6B7C93]">
              Funnel and conversion analysis helps teams identify where prospects lose momentum between click, engagement, qualification, and conversion. It turns drop-offs into clear priorities for optimization.
            </p>
          </div>
        </section>

        <section className="px-6 pb-20 lg:px-8">
          <div className="mx-auto grid max-w-4xl gap-6">
            {[
              {
                title: 'What funnel analysis reveals',
                body: 'Teams can see where visitors or leads disengage, which steps cause friction, and which channels are producing weak handoffs.',
              },
              {
                title: 'Why conversion analysis matters',
                body: 'Conversion trends explain whether performance issues come from weak targeting, weak creative, landing page friction, or poor follow-through after initial interest.',
              },
              {
                title: 'How Omnivyra helps',
                body: 'Omnivyra connects funnel behavior, conversion trends, and drop-off analysis with prioritized next best actions so teams can improve outcomes without switching systems.',
              },
            ].map((section) => (
              <article key={section.title} className="rounded-2xl border border-gray-200/70 bg-white p-8 shadow-[0_2px_12px_rgba(10,31,68,0.05)]">
                <h2 className="text-2xl font-semibold text-[#0B1F33]">{section.title}</h2>
                <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">{section.body}</p>
              </article>
            ))}
            <p className="text-sm text-[#6B7C93]">
              Related reading:{' '}
              <Link href="/marketing-performance-analytics" className="font-semibold text-[#0A66C2]">
                marketing performance analytics
              </Link>{' '}
              and the{' '}
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
