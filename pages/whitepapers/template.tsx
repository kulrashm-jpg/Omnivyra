import ManagedTemplateSelectionPage from '../../components/content/ManagedTemplateSelectionPage';

export default function WhitepaperTemplatePage() {
  return (
    <ManagedTemplateSelectionPage
      contentType="whitepaper"
      pageTitle="Whitepaper Templates"
      heading="Choose a Whitepaper Template"
      subtitle="Select the recommended whitepaper family for your chosen format, or reuse a saved custom template before generating."
      accentColor="blue"
      backPath="/whitepapers/create"
      suggestionsPath="/whitepapers/suggestions"
      generatePath="/whitepapers/generate"
    />
  );
}
