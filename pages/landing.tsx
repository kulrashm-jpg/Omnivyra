import Head from 'next/head';
import MarketingLandingPage, { LANDING_FAQS } from '../components/landing/MarketingLandingPage';

export default function LandingPage() {
  return (
    <>
      <Head>
        <title>Marketing Performance Analytics and Action System | Omnivyra</title>
        <meta
          name="description"
          content="Omnivyra helps teams analyze marketing performance, identify trends and drop-offs, prioritize next best actions, and execute from one system."
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: LANDING_FAQS.map((item) => ({
                '@type': 'Question',
                name: item.question,
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: item.answer,
                },
              })),
            }),
          }}
        />
      </Head>
      <MarketingLandingPage />
    </>
  );
}
