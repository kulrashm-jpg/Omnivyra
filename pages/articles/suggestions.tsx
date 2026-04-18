import ManagedSuggestionsPage from '../../components/content/ManagedSuggestionsPage';

export default function ArticleSuggestionsPage() {
  return (
    <ManagedSuggestionsPage
      contentType="article"
      title="Article Suggestions"
      stepLabel="Step 3 of 4 - Fine-tune content direction"
      heading="Article Suggestions"
      theme="blue"
      generatePath="/articles/generate"
      backPath="/articles/template"
    />
  );
}
