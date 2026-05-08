import Head from 'next/head';
import MarketingLandingPage, { LANDING_FAQS } from '../components/landing/MarketingLandingPage';

export default function LandingPage() {
  return (
    <>
      <Head>
        <title>Active Intelligence for AI-Era Marketing Operations | Omnivyra</title>
        <meta
          name="description"
          content="Omnivyra generates Active Intelligence from digital authority signals, visibility reporting, campaigns, content, market context, recommendations, and connected marketing operations."
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
