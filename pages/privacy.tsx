import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/landing/Footer';

export default function PrivacyPolicy() {
  return (
    <>
      <Head>
        <title>Privacy Policy | Omnivyra</title>
        <meta name="description" content="Omnivyra Privacy Policy — how we collect, use, and protect your personal data." />
      </Head>
      <div className="min-h-screen bg-[#F5F9FF]">
        <main className="mx-auto max-w-3xl px-6 py-16 lg:px-8 lg:py-24">
          <h1 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl">Privacy Policy</h1>
          <p className="mt-3 text-sm text-[#6B7C93]">Last updated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

          <div className="mt-10 space-y-8 text-[#0B1F33]">
            <section>
              <h2 className="text-xl font-semibold">1. What we collect</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                We collect information you provide directly (name, email, company details), data from connected social accounts (with your permission), usage data, and technical data such as IP address and browser type.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">2. How we use your data</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                We use your data to provide and improve the Omnivyra platform, generate personalised marketing intelligence, send service-related communications, and comply with legal obligations. We do not sell your personal data to third parties.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">3. Third-party integrations</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                Omnivyra integrates with third-party services including Facebook / Meta, LinkedIn, and Google. When you connect these accounts, we access only the permissions you explicitly grant. You can revoke access at any time from your account settings or directly from the third-party platform.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">4. Data retention</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                We retain your personal data for as long as your account is active. You may request deletion at any time — see our{' '}
                <Link href="/data-deletion" className="text-[#0A66C2] hover:underline">
                  Data Deletion Instructions
                </Link>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">5. Your rights</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                You have the right to access, correct, export, or delete your personal data. To exercise any of these rights, contact us at{' '}
                <a href="mailto:privacy@omnivyra.com" className="text-[#0A66C2] hover:underline">
                  privacy@omnivyra.com
                </a>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">6. Contact</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                For privacy-related questions, contact us at{' '}
                <a href="mailto:privacy@omnivyra.com" className="text-[#0A66C2] hover:underline">
                  privacy@omnivyra.com
                </a>.
              </p>
            </section>
          </div>

          <div className="mt-12 border-t border-gray-200 pt-6 flex gap-6">
            <Link href="/data-deletion" className="text-sm text-[#0A66C2] hover:underline">
              Data Deletion Instructions &rarr;
            </Link>
            <Link href="/terms" className="text-sm text-[#0A66C2] hover:underline">
              Terms of Service &rarr;
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
