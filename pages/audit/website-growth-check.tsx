import Head from 'next/head';
import FreeAuditInput from '../../components/FreeAuditInput';
import Footer from '../../components/landing/Footer';

const WHAT_YOU_GET = [
  { icon: '🔍', title: 'SEO Visibility', desc: 'Where your site ranks and what is stopping it from appearing in searches.' },
  { icon: '🎯', title: 'Conversion Friction', desc: 'The exact points where visitors hesitate, drop off, or leave without acting.' },
  { icon: '💬', title: 'Messaging Clarity', desc: 'Whether your value proposition is immediately understood — or ignored.' },
  { icon: '🛡', title: 'Trust Signals', desc: 'Social proof, credentials, and credibility gaps that cost you leads.' },
  { icon: '📊', title: 'Traffic Leakage', desc: 'Where qualified visitors exit without converting — and how to fix it.' },
  { icon: '⚡', title: 'Speed & UX', desc: 'Performance and usability issues that silently drive visitors away.' },
];

const EXAMPLE_SCORES = [
  { label: 'SEO Visibility', score: 58, color: 'bg-amber-400' },
  { label: 'Conversion Readiness', score: 67, color: 'bg-blue-500' },
  { label: 'Messaging Clarity', score: 52, color: 'bg-rose-400' },
  { label: 'Trust Signals', score: 71, color: 'bg-emerald-500' },
  { label: 'User Experience', score: 62, color: 'bg-indigo-400' },
];

export default function WebsiteGrowthCheck() {
  return (
    <>
      <Head>
        <title>Website Growth Check | Free AI Audit | Omnivyra</title>
        <meta name="description" content="Run a 60-second AI website audit to discover what is silently losing you customers — traffic, leads, and conversions." />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF]">


        {/* Hero */}
        <section
          className="px-6 py-20 sm:py-28 lg:px-8"
          style={{ background: 'linear-gradient(150deg, #0A1F44 0%, #0A3A7A 40%, #0A66C2 100%)' }}
        >
          <div className="mx-auto max-w-4xl text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-[#3FA9F5]">
              Free Website Audit
            </p>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
              Is Your Website Silently<br className="hidden sm:block" /> Losing Customers?
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/80">
              Run a 60-second AI website growth check. Get a clear score, your biggest friction points, and a prioritised action plan — instantly.
            </p>
            <div className="mx-auto mt-10 max-w-xl">
              <FreeAuditInput
                inputLabel="Website URL"
                placeholder="https://yourwebsite.com"
                buttonText="Check My Website"
              />
            </div>
            <p className="mt-4 text-xs text-white/40">No credit card &middot; Takes under 60 seconds &middot; Instant results</p>
          </div>
        </section>

        {/* The Problem */}
        <section className="bg-white px-6 py-16 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-[#0B1F33] sm:text-3xl">
              Most websites are leaking revenue — invisibly
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[#6B7C93]">
              Founders invest in design, ads, and content — then wonder why leads are inconsistent. Without clarity on <strong className="text-[#0B1F33]">why visitors leave</strong>, you keep guessing. And spending. Without fixing what actually matters.
            </p>
            <div className="mt-8 inline-block rounded-xl border border-[#0A66C2]/20 bg-[#F5F9FF] px-5 py-3 text-sm font-semibold text-[#0A66C2]">
              You don&rsquo;t lack traffic. You lack conversion clarity.
            </div>
          </div>
        </section>

        {/* What You Get */}
        <section className="px-6 py-16 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight text-[#0B1F33] sm:text-3xl">
              What your audit reveals
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
            <p className="mt-3 text-center text-sm text-[#6B7C93]">Here is what your personalised report looks like.</p>
            <div className="mt-8 rounded-2xl border border-gray-200 bg-[#F5F9FF] p-6 shadow-[0_4px_20px_rgba(10,31,68,0.08)]">
              <div className="mb-5 flex items-baseline gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#6B7C93]">Website Intelligence Score</span>
                <span className="text-4xl font-bold text-[#0A66C2]">62</span>
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
                + AI-generated summary, 3 priority fixes, and a step-by-step action plan.
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
              Get your free website score now
            </h2>
            <p className="mt-3 text-base text-white/70">
              Instant results. No signup required to run your first audit.
            </p>
            <div className="mx-auto mt-8 max-w-xl">
              <FreeAuditInput placeholder="https://yourwebsite.com" buttonText="Run Free Audit" />
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
