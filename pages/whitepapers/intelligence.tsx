import ManagedIntelligencePage from '../../components/content/ManagedIntelligencePage';
import { WHITEPAPER_FORMAT_OPTIONS } from '../../lib/blog/blogStructureTemplates';

export default function WhitepaperIntelligencePage() {
  return (
    <ManagedIntelligencePage
      contentType="whitepaper"
      pageTitle="Whitepaper Intelligence"
      eyebrow="Whitepaper Intelligence"
      heading="Create a Whitepaper"
      icon="📄"
      accentClassName="text-blue-700"
      accentSurfaceClassName="from-slate-50 via-white to-blue-50"
      backPath="/whitepapers/create"
      createPath="/whitepapers/create"
      templatePath="/whitepapers/template"
      generatePath="/whitepapers/generate"
      formatOptions={WHITEPAPER_FORMAT_OPTIONS}
      defaultFormat="research"
      creationModePicker={{
        enabled: true,
        flavor: 'longform',
        editorPath: '/whitepapers/new',
      }}
    />
  );
}
