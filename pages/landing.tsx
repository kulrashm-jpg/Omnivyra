import MarketingLandingPage, { LANDING_FAQS } from '../components/landing/MarketingLandingPage';
import MarketingPageMeta, { faqPageJsonLd } from '../components/seo/MarketingPageMeta';

export default function LandingPage() {
  return (
    <>
      {/* /landing renders the same content as / — canonicalPath points search
          engines at the homepage so the two never compete (OPT-006). */}
      <MarketingPageMeta
        title="Active Intelligence for AI-Era Marketing Operations | Omnivyra"
        description="Omnivyra generates Active Intelligence from digital authority signals, visibility reporting, campaigns, content, market context, recommendations, and connected marketing operations."
        path="/landing"
        canonicalPath="/"
        jsonLd={faqPageJsonLd(LANDING_FAQS.map((item) => ({ q: item.question, a: item.answer })))}
      />
      <MarketingLandingPage />
    </>
  );
}
