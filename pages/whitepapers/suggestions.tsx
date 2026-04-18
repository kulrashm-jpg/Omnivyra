import ManagedSuggestionsPage from '../../components/content/ManagedSuggestionsPage';

export default function WhitepaperSuggestionsPage() {
  return (
    <ManagedSuggestionsPage
      contentType="whitepaper"
      title="Whitepaper Suggestions"
      stepLabel="Step 3 of 4 - Fine-tune content direction"
      heading="Whitepaper Suggestions"
      theme="slate"
      generatePath="/whitepapers/generate"
      backPath="/whitepapers/template"
    />
  );
}
