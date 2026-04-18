import FormatSelectionPage from '../../components/content/FormatSelectionPage';

const CASE_STUDY_FORMATS = [
  {
    value: 'case-study',
    label: 'Case Study',
    description: 'A proof-led customer success narrative covering challenge, intervention, measurable outcomes, and takeaways.',
    wordRange: '1,200-2,000 words',
  },
];

export default function CaseStudyCreatePage() {
  return (
    <FormatSelectionPage
      title="Create a Case Study"
      subtitle="Choose the proof structure that best fits the customer story, business outcome, and level of credibility you want the case study to establish."
      icon="📈"
      formats={CASE_STUDY_FORMATS}
      generatePath="/case-studies/intelligence"
      accentColor="amber"
      pageTitle="Create Case Study"
    />
  );
}
