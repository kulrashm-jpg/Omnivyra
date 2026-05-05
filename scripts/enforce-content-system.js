const fs = require('fs');
const path = require('path');

const root = process.cwd();

const scanRoots = [
  'content',
  'lib/blog',
  'lib/content',
  'pages/api/blogs',
  'pages/api/articles',
  'pages/api/guides',
  'pages/api/newsletters',
  'pages/api/stories',
  'pages/api/whitepapers',
  'pages/api/admin/blog',
];

const forbiddenFiles = [
  'lib/blog/blogGenerationEngine.ts',
  'lib/blog/runTemplateBlogGeneration.ts',
  'cards_section_raw.txt',
  'tmp_orig_utf8.tsx',
  'intelligence-full-implementation.txt',
];

const forbiddenRouteDirs = [
  'pages/blog',
  'pages/blogs',
  'pages/company-blog',
  'pages/admin/blog',
];

function walk(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(rel);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [rel] : [];
  });
}

const failures = [];

for (const file of forbiddenFiles) {
  if (fs.existsSync(path.join(root, file))) {
    failures.push(`Forbidden legacy file exists: ${file}`);
  }
}

for (const dir of forbiddenRouteDirs) {
  if (fs.existsSync(path.join(root, dir))) {
    failures.push(`Forbidden legacy route directory exists: ${dir}`);
  }
}

for (const file of scanRoots.flatMap(walk)) {
  const normalized = file.replace(/\\/g, '/');
  const text = fs.readFileSync(path.join(root, file), 'utf8');

  if (
    normalized !== 'content/engine/generator.ts' &&
    /backend\/services\/aiGateway/.test(text)
  ) {
    failures.push(`Direct AI gateway import outside content/engine/generator.ts: ${normalized}`);
  }

  if (
    normalized !== 'content/engine/templateGenerator.ts' &&
    /runTemplateGenerationPath/.test(text) &&
    !/content\/engine\/templateGenerator/.test(text)
  ) {
    failures.push(`Template generation should be called through content/engine/templateGenerator.ts: ${normalized}`);
  }
}

if (failures.length) {
  console.error('Content system enforcement failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Content system enforcement passed.');
