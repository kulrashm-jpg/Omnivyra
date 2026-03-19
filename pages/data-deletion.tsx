import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/landing/Footer';

export default function DataDeletion() {
  return (
    <>
      <Head>
        <title>Data Deletion Instructions | Omnivyra</title>
        <meta name="description" content="How to request deletion of your personal data from Omnivyra." />
      </Head>
      <div className="min-h-screen bg-[#F5F9FF]">
        <main className="mx-auto max-w-3xl px-6 py-16 lg:px-8 lg:py-24">
          <h1 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl">
            Data Deletion Instructions
          </h1>
          <p className="mt-3 text-sm text-[#6B7C93]">Last updated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

          <div className="mt-10 space-y-8 text-[#0B1F33]">
            <section>
              <h2 className="text-xl font-semibold">Your right to data deletion</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                You have the right to request the deletion of your personal data that Omnivyra holds at any time. This includes account information, usage data, and any data collected through connected integrations (including Facebook / Meta login).
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
                  <strong className="text-[#0B1F33]">In-app deletion:</strong> Log in to your account, go to <strong>Settings → Account → Delete Account</strong>. This will immediately schedule your account and all associated data for permanent deletion.
                </li>
                <li>
                  <strong className="text-[#0B1F33]">Facebook / Meta data:</strong> If you connected your account via Facebook login, you can also initiate data removal directly through Facebook by visiting <strong>Settings &amp; Privacy → Settings → Apps and Websites</strong> and removing Omnivyra from your connected apps. We will be notified and process the deletion within 30 days.
                </li>
              </ol>
            </section>

            <section>
              <h2 className="text-xl font-semibold">What gets deleted</h2>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-base text-[#6B7C93]">
                <li>Account profile and login credentials</li>
                <li>Campaign data, plans, and content you created</li>
                <li>Connected social account tokens and permissions</li>
                <li>Usage history and analytics associated with your account</li>
              </ul>
              <p className="mt-4 text-sm text-[#6B7C93]">
                Aggregated, anonymised analytics that cannot be traced back to you are not subject to deletion and may be retained for service improvement.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">Processing time</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                We will process your deletion request within <strong className="text-[#0B1F33]">30 days</strong> of receipt and send a confirmation to your email address once complete.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">Questions</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                If you have any questions about data deletion or your privacy rights, contact us at{' '}
                <a href="mailto:privacy@omnivyra.com" className="text-[#0A66C2] hover:underline">
                  privacy@omnivyra.com
                </a>.
              </p>
            </section>
          </div>

          <div className="mt-12 border-t border-gray-200 pt-6">
            <Link href="/privacy" className="text-sm text-[#0A66C2] hover:underline">
              &larr; View Privacy Policy
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
