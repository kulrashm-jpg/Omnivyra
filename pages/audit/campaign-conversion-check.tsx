import Head from 'next/head';
import FreeAuditInput from '../../components/FreeAuditInput';
import Footer from '../../components/landing/Footer';

const WHAT_YOU_GET = [
  { icon: '🛬', title: 'Landing Page Readiness', desc: 'Whether the page your campaign sends traffic to is built to convert — or repel.' },
  { icon: '🎯', title: 'Audience-Message Match', desc: 'How well your creative and copy align with the people actually seeing your ads.' },
  { icon: '⚡', title: 'Conversion Blockers', desc: 'Friction points that prevent visitors from taking the next step after clicking your ad.' },
  { icon: '💰', title: 'Budget Efficiency', desc: 'Whether your spend is going to the channels and audiences most likely to convert.' },
  { icon: '📊', title: 'Funnel Drop-off', desc: 'Where campaign traffic stalls between click and conversion — and what to do about it.' },
];

const EXAMPLE_SCORES = [
  { label: 'Landing Page Match', score: 64, color: 'bg-amber-400' },
  { label: 'Audience Alignment', score: 51, color: 'bg-rose-400' },
  { label: 'Conversion Flow', score: 72, color: 'bg-emerald-500' },
  { label: 'Budget Allocation', score: 58, color: 'bg-amber-400' },
  { label: 'Creative Relevance', score: 69, color: 'bg-blue-500' },
];

export default function CampaignConversionCheck() {
  return (
    <>
      <Head>
        <title>Campaign Conversion Check | Free AI Audit | Omnivyra</title>
        <meta name="description" content="Find out why your campaign traffic isn't converting. Get an instant AI audit with clear, prioritised fixes." />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF]">


        {/* Hero */}
        <section
          className="px-6 py-20 sm:py-28 lg:px-8"
          style={{ background: 'linear-gradient(150deg, #0A1F44 0%, #0A3A7A 40%, #0A66C2 100%)' }}
        >
          <div className="mx-auto max-w-4xl text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-[#3FA9F5]">
              Free Campaign Audit
            </p>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
              Is Your Campaign Traffic<br className="hidden sm:block" /> Actually Converting?
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/80">
              You&rsquo;re spending on ads — but the ROI doesn&rsquo;t add up. Get an AI audit that pinpoints the real reason your campaigns aren&rsquo;t delivering.
            </p>
            <div className="mx-auto mt-10 max-w-xl">
              <FreeAuditInput
                inputLabel="Campaign Landing Page URL"
                placeholder="https://yourlandingpage.com"
                buttonText="Check My Campaign"
              />
            </div>
            <p className="mt-4 text-xs text-white/40">No credit card &middot; Takes under 60 seconds &middot; Instant results</p>
          </div>
        </section>

        {/* The Problem */}
        <section className="bg-white px-6 py-16 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-center text-2xl font-bold tracking-tight text-[#0B1F33] sm:text-3xl">
              Ad spend without conversion is just cost
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                { title: 'The traffic looks fine', body: 'Clicks are coming in — but they bounce. The problem isn\'t the ad, it\'s what happens after the click.' },
                { title: 'The audience is wrong', body: 'Broad targeting brings volume but kills relevance. The wrong visitor will never convert, regardless of your offer.' },
                { title: 'The landing page breaks trust', body: 'A mismatch between the ad promise and the landing page experience destroys conversion before it starts.' },
              ].map((item) => (
                <div key={item.title} className="rounded-2xl border border-gray-200/80 bg-[#F5F9FF] p-5">
                  <h3 className="text-sm font-semibold text-[#0B1F33]">{item.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-[#6B7C93]">{item.body}</p>
                </div>
              ))}
            </div>
            <p className="mt-8 text-center text-sm font-semibold text-[#0A66C2]">
              The problem isn&rsquo;t your budget. It&rsquo;s your conversion readiness.
            </p>
          </div>
        </section>

        {/* What You Get */}
        <section className="px-6 py-16 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight text-[#0B1F33] sm:text-3xl">
              What your campaign audit reveals
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {WHAT_YOU_GET.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_2px_12px_rgba(10,31,68,0.06)] transition-shadow hover:shadow-[0_6px_20px_rgba(10,31,68,0.10)]"
                >
                  <span className="text-2xl">{item.icon}</span>
                  <h3 className="mt-3 text-sm font-semibold text-[#0B1F33]">{item.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#6B7C93]">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Example Report */}
        <section className="bg-white px-6 py-16 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-center text-2xl font-bold tracking-tight text-[#0B1F33] sm:text-3xl">
              Example report
            </h2>
            <p className="mt-3 text-center text-sm text-[#6B7C93]">Here is what your personalised campaign conversion report looks like.</p>
            <div className="mt-8 rounded-2xl border border-gray-200 bg-[#F5F9FF] p-6 shadow-[0_4px_20px_rgba(10,31,68,0.08)]">
              <div className="mb-5 flex items-baseline gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#6B7C93]">Campaign Readiness Score</span>
                <span className="text-4xl font-bold text-[#0A66C2]">63</span>
                <span className="text-lg text-gray-400">/100</span>
              </div>
              <div className="space-y-3">
                {EXAMPLE_SCORES.map((item) => (
                  <div key={item.label}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-[#0B1F33]">{item.label}</span>
                      <span className="font-semibold text-[#0B1F33]">{item.score}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-gray-200">
                      <div className={`h-1.5 rounded-full ${item.color}`} style={{ width: `${item.score}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-xs text-[#6B7C93]">
                + Ranked list of conversion blockers with specific, actionable fixes for your campaign.
              </p>
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section
          className="px-6 py-20 sm:py-24 lg:px-8"
          style={{ background: 'linear-gradient(150deg, #0A1F44 0%, #0A66C2 100%)' }}
        >
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Stop spending on campaigns that don&rsquo;t convert
            </h2>
            <p className="mt-3 text-base text-white/70">
              Know exactly what to fix before you spend another penny.
            </p>
            <div className="mx-auto mt-8 max-w-xl">
              <FreeAuditInput placeholder="https://yourlandingpage.com" buttonText="Check My Campaign" />
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
