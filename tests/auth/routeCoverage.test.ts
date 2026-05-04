import fs from 'fs';
import path from 'path';

const API_ROOT = path.join(process.cwd(), 'pages', 'api');

function listApiRoutes(dir = API_ROOT): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listApiRoutes(fullPath);
    if (!entry.isFile()) return [];
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

function toRoute(filePath: string): string {
  const relative = path.relative(API_ROOT, filePath).replace(/\\/g, '/');
  return `/api/${relative.replace(/\.(ts|tsx)$/, '').replace(/\/index$/, '')}`;
}

describe('API route auth coverage', () => {
  it('requires every API route to use applyAuthGuard or AUTH EXEMPT marker', () => {
    const uncovered = listApiRoutes()
      .filter((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        return !source.includes('applyAuthGuard') && !source.includes('AUTH EXEMPT');
      })
      .map(toRoute)
      .sort();

    if (uncovered.length > 0) {
      throw new Error(`Uncovered API routes:\n${uncovered.join('\n')}`);
    }
  });
});
