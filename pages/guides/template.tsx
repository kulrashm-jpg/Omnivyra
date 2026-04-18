import ManagedTemplateSelectionPage from '../../components/content/ManagedTemplateSelectionPage';

export default function GuideTemplatePage() {
  return (
    <ManagedTemplateSelectionPage
      contentType="guide"
      pageTitle="Guide Templates"
      heading="Choose a Guide Template"
      subtitle="Pick a practical guide layout, then continue with the recommended family or one of your saved custom templates."
      accentColor="violet"
      backPath="/guides/create"
      suggestionsPath="/guides/suggestions"
      generatePath="/guides/generate"
    />
  );
}
