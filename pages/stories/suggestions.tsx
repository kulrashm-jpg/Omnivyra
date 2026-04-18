import ManagedSuggestionsPage from '../../components/content/ManagedSuggestionsPage';

export default function StorySuggestionsPage() {
  return (
    <ManagedSuggestionsPage
      contentType="story"
      title="Story Suggestions"
      stepLabel="Step 3 of 4 - Fine-tune content direction"
      heading="Story Suggestions"
      theme="pink"
      generatePath="/stories/generate"
      backPath="/stories/template"
    />
  );
}
