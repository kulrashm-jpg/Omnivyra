import Head from 'next/head';
import FreeAuditInput from '../../components/FreeAuditInput';
import Footer from '../../components/landing/Footer';

const WHAT_YOU_GET = [
  { icon: '🧲', title: 'Lead Capture Gaps', desc: 'Every point where a potential lead arrives but leaves without taking action.' },
  { icon: '📝', title: 'Form & CTA Analysis', desc: 'Whether your calls-to-action are compelling enough to convert intent into action.' },
  { icon: '🎯', title: 'Offer Clarity', desc: 'How clearly your offer communicates value to the right audience.' },
  { icon: '🔗', title: 'Funnel Flow', desc: 'Where visitors stall or drop between awareness and conversion.' },
  { icon: '💬', title: 'Messaging Alignment', desc: 'Whether your copy speaks to pain points or just describes features.' },
];

const EXAMPLE_SCORES = [
  { label: 'Lead Capture Setup', score: 54, color: 'bg-rose-400' },
  { label: 'CTA Effectiveness', score: 61, color: 'bg-amber-400' },
  { label: 'Offer Clarity', score: 48, color: 'bg-rose-500' },
  { label: 'Funnel Continuity', score: 70, color: 'bg-emerald-500' },
  { label: 'Audience Alignment', score: 65, color: 'bg-blue-500' },
];

export default function LeadGenerationCheck() {
  return (
    <>
      <Head>
        <title>Lead Generation Check | Free AI Audit | Omnivyra</title>
        <meta name="description" content="Find out why your website isn't generating leads. Get an instant AI audit with clear fixes." />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF]">


        {/* Hero */}
        <section
          className="px-6 py-20 sm:py-28 lg:px-8"
          style={{ background: 'linear-gradient(150deg, #0A1F44 0%, #0A3A7A 40%, #0A66C2 100%)' }}
        >
          <div className="mx-auto max-w-4xl text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-[#3FA9F5]">
              Free Lead Generation Audit
            </p>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
              Find Out Why Your Website<br className="hidden sm:block" /> Isn&rsquo;t Generating Leads
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/80">
              Your site gets visitors — but they don&rsquo;t convert. Get an AI-powered audit that pinpoints exactly where leads are lost and what to fix first.
            </p>
            <div className="mx-auto mt-10 max-w-xl">
              <FreeAuditInput
                inputLabel="Website URL"
                placeholder="https://yourwebsite.com"
                buttonText="Check My Lead Generation"
              />
            </div>
            <p className="mt-4 text-xs text-white/40">No credit card &middot; Takes under 60 seconds &middot; Instant results</p>
          </div>
        </section>

        {/* The Problem */}
        <section className="bg-white px-6 py-16 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-center text-2xl font-bold tracking-tight text-[#0B1F33] sm:text-3xl">
              Traffic without leads is just noise
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                { title: 'Weak first impression', body: 'Visitors decide in 3 seconds. If your headline doesn\'t speak to their problem, they leave.' },
                { title: 'No clear next step', body: 'Confusing CTAs or buried forms mean visitors don\'t know what to do — so they do nothing.' },
                { title: 'Wrong audience fit', body: 'Traffic that doesn\'t match your offer will never convert, no matter how good your copy is.' },
              ].map((item) => (
                <div key={item.title} className="rounded-2xl border border-gray-200/80 bg-[#F5F9FF] p-5">
                  <h3 className="text-sm font-semibold text-[#0B1F33]">{item.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-[#6B7C93]">{item.body}</p>
                </div>
              ))}
            </div>
            <p className="mt-8 text-center text-sm font-semibold text-[#0A66C2]">
              The fix isn&rsquo;t more traffic. It&rsquo;s a better-converting site.
            </p>
          </div>
        </section>

        {/* What You Get */}
        <section className="px-6 py-16 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight text-[#0B1F33] sm:text-3xl">
              What your lead generation audit reveals
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
            <p className="mt-3 text-center text-sm text-[#6B7C93]">Here is what your personalised lead generation report looks like.</p>
            <div className="mt-8 rounded-2xl border border-gray-200 bg-[#F5F9FF] p-6 shadow-[0_4px_20px_rgba(10,31,68,0.08)]">
              <div className="mb-5 flex items-baseline gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#6B7C93]">Lead Generation Score</span>
                <span className="text-4xl font-bold text-[#0A66C2]">59</span>
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
                + Prioritised fixes ranked by lead impact, with specific recommendations for your site.
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
              Stop losing leads you already earned
            </h2>
            <p className="mt-3 text-base text-white/70">
              Find out what&rsquo;s blocking conversions — in under 60 seconds.
            </p>
            <div className="mx-auto mt-8 max-w-xl">
              <FreeAuditInput placeholder="https://yourwebsite.com" buttonText="Check My Lead Generation" />
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
