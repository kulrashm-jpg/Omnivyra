import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/landing/Footer';

export default function TermsOfService() {
  return (
    <>
      <Head>
        <title>Terms of Service | Omnivyra</title>
        <meta name="description" content="Omnivyra Terms of Service — the rules and conditions that govern your use of the Omnivyra platform." />
      </Head>
      <div className="min-h-screen bg-[#F5F9FF]">
        <main className="mx-auto max-w-3xl px-6 py-16 lg:px-8 lg:py-24">
          <h1 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl">Terms of Service</h1>
          <p className="mt-3 text-sm text-[#6B7C93]">Last updated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

          <div className="mt-10 space-y-8 text-[#0B1F33]">
            <section>
              <h2 className="text-xl font-semibold">1. Acceptance of terms</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                By accessing or using the Omnivyra platform (the &ldquo;Service&rdquo;), you agree to be bound by these Terms of Service. If you do not agree, you may not use the Service. These terms apply to every user, workspace member, and visitor.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">2. Your account</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. You must provide accurate information at signup and keep it up to date. You must be at least 18 years old, or the age of majority in your jurisdiction, to use the Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">3. Acceptable use</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                You agree not to use the Service to:
              </p>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-base text-[#6B7C93]">
                <li>Violate any applicable law, regulation, or third-party right</li>
                <li>Generate or distribute spam, malware, or deceptive content</li>
                <li>Attempt to gain unauthorised access to the Service, other accounts, or related systems</li>
                <li>Reverse engineer, scrape, or interfere with the Service&rsquo;s normal operation</li>
                <li>Resell or sublicense the Service without our written permission</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold">4. Connected platforms</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                Omnivyra integrates with third-party platforms including Facebook / Meta, LinkedIn, and Google. When you connect these accounts, you authorise Omnivyra to access only the permissions you grant. Your use of those platforms remains subject to each platform&rsquo;s own terms, and you are responsible for ensuring your activity on Omnivyra complies with them.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">5. Your content</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                You retain ownership of the content, assets, and data you upload or create through the Service (&ldquo;Your Content&rdquo;). You grant Omnivyra a limited, non-exclusive licence to host, process, and display Your Content solely to operate and improve the Service for you. You are responsible for ensuring you have the rights to use Your Content on the Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">6. AI-generated outputs</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                The Service uses generative AI to produce drafts, recommendations, and analyses. AI outputs may contain inaccuracies and should be reviewed before publishing or relying on them. You are responsible for the use, distribution, and consequences of any AI-generated output you publish through the Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">7. Plans, billing, and credits</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                Some features require a paid plan or credits. Fees are billed in advance and are non-refundable except where required by law. Credits and plan entitlements may expire as described at purchase. We may change pricing or plan features with reasonable notice; continued use after changes constitutes acceptance.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">8. Service availability and changes</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                We work hard to keep the Service available, but we do not guarantee uninterrupted or error-free operation. We may add, modify, or discontinue features at any time. We will give reasonable notice of material reductions in functionality where practical.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">9. Suspension and termination</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                We may suspend or terminate access to the Service if you breach these terms, if required by law, or to protect the integrity or security of the Service or other users. You may stop using the Service at any time. On termination, your right to use the Service ends immediately; data retention follows our{' '}
                <Link href="/privacy" className="text-[#0A66C2] hover:underline">Privacy Policy</Link>{' '}and{' '}
                <Link href="/data-deletion" className="text-[#0A66C2] hover:underline">Data Deletion Instructions</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">10. Disclaimers</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that AI outputs, analytics, or recommendations will be accurate, complete, or suitable for your specific business decisions.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">11. Limitation of liability</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                To the maximum extent permitted by law, Omnivyra and its affiliates are not liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or goodwill arising from your use of the Service. Our total aggregate liability for any claim relating to the Service will not exceed the amount you paid to Omnivyra in the twelve months preceding the event giving rise to the claim.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">12. Indemnification</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                You agree to indemnify and hold Omnivyra harmless from any claim, demand, or damages arising from Your Content, your use of the Service, or your breach of these terms or any applicable law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">13. Changes to these terms</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                We may update these terms from time to time. When we make material changes, we will update the &ldquo;Last updated&rdquo; date above and, where appropriate, notify you in-app or by email. Continued use of the Service after changes take effect constitutes acceptance of the updated terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold">14. Contact</h2>
              <p className="mt-3 text-base leading-relaxed text-[#6B7C93]">
                For questions about these terms, contact us at{' '}
                <a href="mailto:support@omnivyra.com" className="text-[#0A66C2] hover:underline">
                  support@omnivyra.com
                </a>.
              </p>
            </section>
          </div>

          <div className="mt-12 border-t border-gray-200 pt-6 flex gap-6">
            <Link href="/privacy" className="text-sm text-[#0A66C2] hover:underline">
              Privacy Policy &rarr;
            </Link>
            <Link href="/data-deletion" className="text-sm text-[#0A66C2] hover:underline">
              Data Deletion Instructions &rarr;
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
