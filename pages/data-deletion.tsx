import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/landing/Footer';

export default function DataDeletion() {
  return (
    <>
      <Head>
        <title>Data Deletion Instructions | OmniVyra</title>
        <meta name="description" content="How to request deletion of your personal data from OmniVyra." />
      </Head>
      <div className="min-h-screen bg-[#F5F9FF]">
        <main className="mx-auto max-w-3xl px-6 py-16 lg:px-8 lg:py-24">
          <h1 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl">
            Data Deletion Instructions
          </h1>
          <p className="mt-3 text-sm text-[#6B7C93]">
            Last updated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>

          <div className="mt-10 space-y-8 text-[#0B1F33]">
            <section>
              <h2 className="text-xl font-semibold">Your right to data deletion</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                You have the right to request the deletion of your personal data that OmniVyra holds at any time. This includes account information, usage data, connected platform authorisations, support records, and content or assets associated with your account.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">How to request deletion</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                You can submit a data deletion request using any of the following methods:
              </p>
              <ol className="mt-4 list-decimal space-y-3 pl-5 text-base text-[#6B7C93]">
                <li>
                  <strong className="text-[#0B1F33]">Email request:</strong> Send an email to{' '}
                  <a href="mailto:privacy@omnivyra.com" className="text-[#0A66C2] hover:underline">
                    privacy@omnivyra.com
                  </a>{' '}
                  with the subject line <em>&ldquo;Data Deletion Request&rdquo;</em> and include the email address associated with your account.
                </li>
                <li>
                  <strong className="text-[#0B1F33]">In-app deletion:</strong> Log in to your account, go to <strong>Settings -&gt; Account -&gt; Delete Account</strong>. This schedules your account and associated data for permanent deletion.
                </li>
                <li>
                  <strong className="text-[#0B1F33]">Facebook / Meta data:</strong> If you connected your account through Facebook / Meta login, you can also remove OmniVyra from <strong>Settings &amp; Privacy -&gt; Settings -&gt; Apps and Websites</strong>. We will process the related deletion request after we receive the platform notice.
                </li>
              </ol>
            </section>

            <section>
              <h2 className="text-xl font-semibold">What to include in your request</h2>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-base text-[#6B7C93]">
                <li>The email address associated with your OmniVyra account</li>
                <li>Your company name if your account belongs to a shared workspace</li>
                <li>A short confirmation that you want your personal data deleted</li>
                <li>Any connected platform you also want revoked or removed</li>
              </ul>
              <p className="mt-4 text-sm text-[#6B7C93]">
                We may ask you to verify account ownership before processing deletion so we can protect your data from unauthorised requests.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">What gets deleted</h2>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-base text-[#6B7C93]">
                <li>Account profile and login credentials</li>
                <li>Campaign data, plans, and created content</li>
                <li>Connected social account tokens and permissions</li>
                <li>Usage history and account-linked analytics</li>
                <li>Uploaded assets, generated outputs, and saved drafts</li>
                <li>Support and onboarding records associated with your identity</li>
              </ul>
              <p className="mt-4 text-sm text-[#6B7C93]">
                Aggregated or anonymised analytics that cannot be traced back to you are not subject to deletion and may be retained for product improvement.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">What may be retained</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                In limited cases, we may retain minimal records where required for legal, tax, security, fraud-prevention, or contractual compliance purposes. Where retention is required, we keep only the minimum information necessary for that obligation.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">Processing time</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                We will process your deletion request within <strong className="text-[#0B1F33]">30 days</strong> of receipt and send a confirmation to your email address once complete.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">After deletion</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                Once deletion is complete, you will lose access to your account, reports, workspace history, connected integrations, and generated content associated with that account. This action is permanent and cannot be reversed.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">Questions and related policies</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                If you have any questions about data deletion or your privacy rights, contact us at{' '}
                <a href="mailto:privacy@omnivyra.com" className="text-[#0A66C2] hover:underline">
                  privacy@omnivyra.com
                </a>.
              </p>
              <div className="mt-4 flex flex-wrap gap-4 text-sm">
                <Link href="/privacy" className="text-[#0A66C2] hover:underline">
                  View Privacy Policy
                </Link>
                <Link href="/terms" className="text-[#0A66C2] hover:underline">
                  View Terms of Service
                </Link>
              </div>
            </section>
          </div>

          <div className="mt-12 border-t border-gray-200 pt-6">
            <div className="flex flex-wrap gap-4 text-sm">
              <Link href="/privacy" className="text-[#0A66C2] hover:underline">
                &larr; View Privacy Policy
              </Link>
              <Link href="/terms" className="text-[#0A66C2] hover:underline">
                View Terms of Service
              </Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
