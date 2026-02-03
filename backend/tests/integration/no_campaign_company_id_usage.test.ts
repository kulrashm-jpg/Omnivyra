import fs from 'fs';
import path from 'path';

const targetDirectories = [
  path.resolve(__dirname, '../../../pages/api'),
  path.resolve(__dirname, '../../../backend/services'),
];

const allowedExtensions = new Set(['.ts', '.tsx']);

const forbiddenPatterns = [
  "campaigns').eq('company_id",
  'campaigns").eq("company_id',
  ".from('campaigns').eq('company_id'",
];

const collectFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile() && allowedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
};

describe('No campaigns.company_id usage', () => {
  it('rejects campaigns.company_id queries', () => {
    const violations: string[] = [];
    for (const dir of targetDirectories) {
      const files = collectFiles(dir);
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        if (forbiddenPatterns.some((pattern) => content.includes(pattern))) {
          violations.push(file);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Forbidden usage: campaigns.company_id detected. Use campaign_versions mapping instead.\n` +
          `Files:\n${violations.join('\n')}`
      );
    }
  });
});
