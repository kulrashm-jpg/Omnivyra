import ManagedIntelligencePage from '../../components/content/ManagedIntelligencePage';

const CASE_STUDY_FORMATS = [
  {
    value: 'case-study',
    label: 'Case Study',
    description: 'A proof-led customer success narrative covering challenge, intervention, measurable outcomes, and takeaways.',
    wordRange: '1,200-2,000 words',
  },
];

export default function CaseStudyIntelligencePage() {
  return (
    <ManagedIntelligencePage
      contentType="case-study"
      pageTitle="Case Study Intelligence"
      eyebrow="Case Study Intelligence"
      heading="Create a Case Study"
      icon="📈"
      accentClassName="text-amber-700"
      accentSurfaceClassName="from-amber-50 via-white to-orange-50"
      backPath="/case-studies/create"
      createPath="/case-studies/create"
      templatePath="/case-studies/template"
      generatePath="/case-studies/generate"
      formatOptions={CASE_STUDY_FORMATS}
      defaultFormat="case-study"
    />
  );
}
