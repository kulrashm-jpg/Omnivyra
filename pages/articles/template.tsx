import ManagedTemplateSelectionPage from '../../components/content/ManagedTemplateSelectionPage';

export default function ArticleTemplatePage() {
  return (
    <ManagedTemplateSelectionPage
      contentType="article"
      pageTitle="Article Templates"
      heading="Choose an Article Template"
      subtitle="Select the template family that best fits the article format you chose, then continue with a managed or custom layout."
      accentColor="orange"
      backPath="/articles/create"
      suggestionsPath="/articles/suggestions"
      generatePath="/articles/generate"
    />
  );
}
