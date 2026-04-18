import ManagedSuggestionsPage from '../../components/content/ManagedSuggestionsPage';

export default function GuideSuggestionsPage() {
  return (
    <ManagedSuggestionsPage
      contentType="guide"
      title="Guide Suggestions"
      stepLabel="Step 3 of 4 - Fine-tune content direction"
      heading="Guide Suggestions"
      theme="violet"
      generatePath="/guides/generate"
      backPath="/guides/template"
    />
  );
}
