import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const outDir = path.join(root, 'architecture-migration', 'reports');
const exts = new Set(['.ts', '.tsx', '.js', '.jsx']);
const textExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.cjs', '.mjs', '.txt']);
const skipDirs = new Set(['node_modules', '.next', '.git']);

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function writeMd(name, value) {
  fs.writeFileSync(path.join(outDir, name), `${value.trim()}\n`);
}

function walk(dir, results = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, results);
    else results.push(full);
  }
  return results;
}

function lineRecords(files, predicate) {
  const records = [];
  for (const file of files) {
    if (!textExts.has(path.extname(file))) continue;
    let src;
    try {
      src = read(file);
    } catch {
      continue;
    }
    const lines = src.split(/\r?\n/);
    lines.forEach((text, index) => {
      const record = predicate(text, index + 1, file, lines);
      if (record) records.push(record);
    });
  }
  return records;
}

function gitStatus() {
  const raw = execFileSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' });
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const status = line.slice(0, 2);
    const file = line.slice(3).replace(/\\/g, '/');
    return { status, file };
  });
}

function isArchitectureTarget(file) {
  return [
    /^backend\/domain\/campaigns\//,
    /^backend\/services\/campaignAiOrchestrator/,
    /^backend\/services\/aiGateway\.ts$/,
    /^backend\/services\/dailyContentDistributionPlanService\.ts$/,
    /^backend\/services\/boltPipelineService\.ts$/,
    /^backend\/services\/structuredPlanScheduler\.ts$/,
    /^backend\/services\/boltScheduleBlockProcessor\.ts$/,
    /^backend\/services\/boltContentGenerationForSchedule\.ts$/,
    /^backend\/services\/contentGeneration\//,
    /^backend\/queue\/jobProcessors\/(boltContentJobProcessor|contentGenerationProcessor)\.ts$/,
    /^backend\/services\/recommendation/,
    /^backend\/services\/intelligence\/recommendations\//,
    /^backend\/db\//,
    /^pages\/api\/(activity-workspace|scheduler|schedule|social|recommendations|campaigns)/,
    /^components\//,
    /^hooks\//,
    /^pages\/(?!api\/)/,
    /^lib\/(content-analyzer|blog|shared|api-client|contracts|schemas)/,
    /^architecture-migration\//
  ].some((rx) => rx.test(file));
}

function isSafeArchive(file, status) {
  return status.includes('D') && /\.(md|txt|png|html|tsbuildinfo|err|json|sql)$/i.test(file)
    || /^archive\//.test(file)
    || /^docs\/archive\//.test(file)
    || /^tmp_/.test(path.basename(file))
    || /\.(tsbuildinfo|log|err)$/i.test(file)
    || /^audit-.*\.json$/i.test(file);
}

function isRuntime(file) {
  return /^(backend|components|hooks|pages|lib|config|middleware|modules|store|types|utils)\//.test(file)
    || ['package.json', 'eslint.config.js', '.eslintrc.json', 'tsconfig.json'].includes(file);
}

function classifyWorktree(statusEntries) {
  const categories = {
    activeRequired: [],
    safeArchive: [],
    inProgressUserWork: [],
    architectureTargets: []
  };
  const overlapConflicts = [];
  for (const entry of statusEntries) {
    const file = entry.file;
    const tags = [];
    if (isArchitectureTarget(file)) tags.push('ARCHITECTURE_TARGETS');
    if (isSafeArchive(file, entry.status)) tags.push('SAFE_ARCHIVE');
    if (isRuntime(file)) tags.push('ACTIVE_REQUIRED');
    if (!isArchitectureTarget(file) && !isSafeArchive(file, entry.status)) tags.push('IN_PROGRESS_USER_WORK');

    if (tags.includes('ARCHITECTURE_TARGETS')) categories.architectureTargets.push(entry);
    if (tags.includes('SAFE_ARCHIVE')) categories.safeArchive.push(entry);
    if (tags.includes('ACTIVE_REQUIRED')) categories.activeRequired.push(entry);
    if (tags.includes('IN_PROGRESS_USER_WORK')) categories.inProgressUserWork.push(entry);
    if (tags.length > 1) overlapConflicts.push({ ...entry, categories: tags });
  }
  return {
    counts: Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, value.length])),
    categories,
    overlapConflicts,
    architectureTargetFilesCurrentlyDirty: categories.architectureTargets
  };
}

function frontendBackendImports(files) {
  const frontRoots = /^(hooks|components|pages)\//;
  const apiRoute = /^pages\/api\//;
  const importRe = /\bimport(?:[\s\S]*?)from\s+['"]([^'"]*backend\/[^'"]*)['"]|\brequire\(\s*['"]([^'"]*backend\/[^'"]*)['"]\s*\)/;
  return lineRecords(files, (text, line, file) => {
    const fileRel = rel(file);
    if (!frontRoots.test(fileRel) || apiRoute.test(fileRel)) return null;
    const match = text.match(importRe);
    if (!match) return null;
    return {
      file: fileRel,
      line,
      importedModule: match[1] || match[2],
      importDirection: 'frontend->backend',
      severity: 'warn'
    };
  });
}

function variantContamination(files) {
  const scope = /^(backend\/domain|backend\/services|pages\/api\/campaigns)\//;
  const rx = /\b(bolt_run_id|bolt_text_only|creatorMode|strategyMode|creator_dependent|campaignMode|campaign_mode|isCreator|creatorPayload)\b|creator payload/i;
  return lineRecords(files, (text, line, file) => {
    const fileRel = rel(file);
    if (!scope.test(fileRel) || !rx.test(text)) return null;
    return { file: fileRel, line, text: text.trim(), severity: 'warn' };
  });
}

function deprecatedRoutes(files) {
  return lineRecords(files, (text, line, file) => {
    const fileRel = rel(file);
    if (!fileRel.startsWith('pages/api/') || !/ROUTE_DEPRECATED/.test(text)) return null;
    const route = `/api/${fileRel.slice('pages/api/'.length).replace(/\.(ts|tsx|js|jsx)$/, '').replace(/\/index$/, '')}`;
    return { file: fileRel, line, route, severity: 'warn' };
  });
}

function directDbWrites(files) {
  const records = [];
  for (const file of files) {
    const fileRel = rel(file);
    if (!/^(backend|pages\/api)\//.test(fileRel)) continue;
    if (/^backend\/db\//.test(fileRel) || /^backend\/repositories\//.test(fileRel)) continue;
    if (!exts.has(path.extname(file))) continue;
    const lines = read(file).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const tableMatch = lines[i].match(/\.from\(\s*['"`]([^'"`]+)['"`]\s*\)/);
      if (!tableMatch) continue;
      const windowText = lines.slice(i, Math.min(lines.length, i + 8)).join(' ');
      const mutationMatch = windowText.match(/\.(insert|upsert|update|delete)\s*\(/);
      if (!mutationMatch) continue;
      records.push({
        file: fileRel,
        line: i + 1,
        table: tableMatch[1],
        mutation: mutationMatch[1],
        ownership: 'outside-repository',
        severity: 'warn'
      });
    }
  }
  return records;
}

function duplicateExecutionOwners(files) {
  const rx = /\b(generateRecommendations|buildPlatformVariantsFromMaster|generateMasterContentFromIntent|runCampaignAiPlan|processBlockSchedule|createLegacyScheduledPost|scheduleStructuredPlan)\b/;
  return lineRecords(files, (text, line, file) => {
    const fileRel = rel(file);
    if (!/^(backend|lib|pages\/api)\//.test(fileRel) || !rx.test(text)) return null;
    return { file: fileRel, line, ownerSymbol: text.match(rx)[1], text: text.trim(), severity: 'warn' };
  });
}

function oversizedFiles(files) {
  const records = [];
  for (const file of files) {
    const fileRel = rel(file);
    if (!exts.has(path.extname(file))) continue;
    if (/^(archive|architecture-migration|node_modules)\//.test(fileRel)) continue;
    const lines = read(file).split(/\r?\n/).length;
    if (lines > 500) records.push({ file: fileRel, lines, maxAllowed: 500, severity: 'warn' });
  }
  return records.sort((a, b) => b.lines - a.lines);
}

function boundaryLeaks(files) {
  const scope = /^(backend\/domain\/campaigns|backend\/services\/structuredPlanScheduler\.ts|pages\/api\/campaigns\/ai\/plan\.ts|pages\/api\/activity-workspace\/content\.ts)/;
  const rx = /\b(any|unknown|Record<string, any>|Record<string, unknown>)\b|JSON\.parse|req\.body/;
  return lineRecords(files, (text, line, file) => {
    const fileRel = rel(file);
    if (!scope.test(fileRel) || !rx.test(text)) return null;
    return { file: fileRel, line, text: text.trim(), severity: 'warn' };
  });
}

function resolveImport(from, spec, fileSet) {
  if (spec.startsWith('@/')) {
    spec = `./${spec.slice(2)}`;
    from = path.join(root, 'index.ts');
  }
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  const candidates = [];
  for (const ext of exts) candidates.push(base + ext);
  for (const ext of exts) candidates.push(path.join(base, `index${ext}`));
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate).toLowerCase();
    if (fileSet.has(normalized)) return normalized;
  }
  return null;
}

function dependencyCycles(files) {
  const sourceFiles = files.filter((file) => exts.has(path.extname(file)) && !rel(file).startsWith('architecture-migration/'));
  const fileSet = new Set(sourceFiles.map((file) => path.normalize(file).toLowerCase()));
  const graph = new Map();
  const importRe = /import(?:[\s\S]*?)from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const file of sourceFiles) {
    const deps = [];
    const src = read(file);
    let match;
    while ((match = importRe.exec(src))) {
      const spec = match[1] || match[2];
      const resolved = resolveImport(file, spec, fileSet);
      if (resolved) deps.push(resolved);
    }
    graph.set(path.normalize(file).toLowerCase(), deps);
  }
  const cycles = [];
  const seen = new Set();
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const canonical = (cycle) => {
    const nodes = cycle.slice(0, -1);
    let best = null;
    for (let i = 0; i < nodes.length; i++) {
      const rotated = nodes.slice(i).concat(nodes.slice(0, i));
      const key = rotated.join('>');
      if (best === null || key < best) best = key;
    }
    return best;
  };
  function dfs(node) {
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const dep of graph.get(node) || []) {
      if (!graph.has(dep)) continue;
      if (visiting.has(dep)) {
        const index = stack.indexOf(dep);
        const cycle = stack.slice(index).concat(dep);
        const key = canonical(cycle);
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push({
            chain: cycle.map((item) => rel(item)),
            severity: 'warn'
          });
        }
      } else {
        dfs(dep);
      }
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of graph.keys()) dfs(node);
  return cycles;
}

function duplicateRoutes(files) {
  const apiFiles = files.filter((file) => rel(file).startsWith('pages/api/') && exts.has(path.extname(file)));
  const byRoute = new Map();
  for (const file of apiFiles) {
    const fileRel = rel(file);
    const route = `/api/${fileRel.slice('pages/api/'.length).replace(/\.(ts|tsx|js|jsx)$/, '').replace(/\/index$/, '')}`;
    if (!byRoute.has(route)) byRoute.set(route, []);
    byRoute.get(route).push(fileRel);
  }
  return [...byRoute.entries()]
    .filter(([, routeFiles]) => routeFiles.length > 1)
    .map(([route, routeFiles]) => ({ route, files: routeFiles, severity: 'warn' }));
}

function deprecatedRouteUsage(files, deprecated) {
  const usageExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.md']);
  const usageRoots = /^(components|hooks|pages|lib|backend|config|middleware|architecture-migration)\//;
  const textFiles = files.filter((file) => {
    const fileRel = rel(file);
    return usageExts.has(path.extname(file))
      && usageRoots.test(fileRel)
      && !fileRel.startsWith('architecture-migration/reports/')
      && !fileRel.startsWith('archive/');
  });
  const usage = deprecated.map((route) => {
    const routeWithoutApi = route.route.replace(/^\/api\//, '');
    const fragments = [
      route.route,
      routeWithoutApi,
      routeWithoutApi.replace(/\[[^\]]+\]/g, '')
    ].filter((item) => item && item.length > 2);
    return { ...route, fragments, classification: 'UNKNOWN', references: [] };
  });
  for (const file of textFiles) {
    const fileRel = rel(file);
    const src = read(file);
    const lines = src.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const text = lines[index];
      for (const route of usage) {
        if (fileRel === route.file) continue;
        if (!route.fragments.some((fragment) => text.includes(fragment))) continue;
        route.references.push({ file: fileRel, line: index + 1, text: text.trim().slice(0, 240) });
      }
    }
  }
  return usage.map((route) => {
    const classification = route.references.length > 0
      ? route.references.some((ref) => /pages\/api|components|hooks|pages\//.test(ref.file)) ? 'ACTIVE' : 'INTERNAL_ONLY'
      : 'UNKNOWN';
    const { fragments, ...rest } = route;
    return { ...rest, classification };
  });
}

function executionMap(title, entries) {
  const lines = [`# ${title}`, '', '## Entrypoints'];
  entries.entrypoints.forEach((item) => lines.push(`- ${item}`));
  lines.push('', '## Orchestration Owners');
  entries.owners.forEach((item) => lines.push(`- ${item}`));
  lines.push('', '## DB Mutation Points');
  entries.dbMutations.forEach((item) => lines.push(`- ${item}`));
  lines.push('', '## Queue Boundaries');
  entries.queues.forEach((item) => lines.push(`- ${item}`));
  lines.push('', '## API Boundaries');
  entries.apis.forEach((item) => lines.push(`- ${item}`));
  lines.push('', '## Duplicate Ownership Points');
  entries.duplicates.forEach((item) => lines.push(`- ${item}`));
  return lines.join('\n');
}

ensureDir(outDir);
const files = walk(root);
const statusEntries = gitStatus();
const classification = classifyWorktree(statusEntries);
const fbi = frontendBackendImports(files);
const cycles = dependencyCycles(files);
const dbWrites = directDbWrites(files);
const variants = variantContamination(files);
const deprecated = deprecatedRoutes(files);
const duplicateOwners = duplicateExecutionOwners(files);
const oversized = oversizedFiles(files);
const leaks = boundaryLeaks(files);
const routeDuplicates = duplicateRoutes(files);
const usage = deprecatedRouteUsage(files, deprecated);

writeJson('worktree-classification.json', classification);
writeJson('frontend-backend-imports.json', fbi);
writeJson('dependency-cycles.json', cycles);
writeJson('direct-db-writes.json', dbWrites);
writeJson('variant-contamination.json', variants);
writeJson('deprecated-routes.json', deprecated);
writeJson('duplicate-execution-owners.json', duplicateOwners);
writeJson('oversized-files.json', oversized);
writeJson('boundary-leaks.json', leaks);
writeJson('duplicate-routes.json', routeDuplicates);
writeJson('deprecated-route-usage.json', usage);

writeMd('execution-map-campaign-generation.md', executionMap('Campaign Generation Execution Map', {
  entrypoints: ['pages/api/campaigns/ai/plan.ts', 'pages/api/campaigns/regenerate-blueprint.ts', 'pages/api/recommendations/[id]/create-campaign.ts', 'backend/services/boltPipelineService.ts'],
  owners: ['backend/services/campaignAiOrchestrator.ts', 'backend/domain/campaigns/generateWeeklyStructure.ts', 'backend/services/boltPipelineService.ts'],
  dbMutations: dbWrites.filter((r) => /campaign|daily_content_plan|weekly_content/.test(r.table)).slice(0, 30).map((r) => `${r.file}:${r.line} ${r.mutation} ${r.table}`),
  queues: ['backend/queue/jobProcessors/boltContentJobProcessor.ts', 'backend/workers/campaignPlanningWorker.ts'],
  apis: ['pages/api/campaigns/**', 'pages/api/recommendations/**'],
  duplicates: duplicateOwners.filter((r) => ['runCampaignAiPlan'].includes(r.ownerSymbol)).map((r) => `${r.file}:${r.line} ${r.ownerSymbol}`)
}));

writeMd('execution-map-scheduling-flow.md', executionMap('Scheduling Flow Execution Map', {
  entrypoints: ['pages/api/scheduler/schedule.ts', 'pages/api/activity-workspace/schedule.ts', 'pages/api/social/post.ts', 'pages/api/schedule/posts.ts'],
  owners: ['backend/services/structuredPlanScheduler.ts', 'backend/services/boltScheduleBlockProcessor.ts', 'backend/queue/jobProcessors/boltContentJobProcessor.ts'],
  dbMutations: dbWrites.filter((r) => r.table === 'scheduled_posts').map((r) => `${r.file}:${r.line} ${r.mutation} ${r.table}`),
  queues: ['backend/queue/jobProcessors/publishProcessor.ts', 'backend/queue/jobProcessors/boltContentJobProcessor.ts'],
  apis: ['pages/api/scheduler/**', 'pages/api/schedule/**', 'pages/api/activity-workspace/schedule.ts', 'pages/api/social/post.ts'],
  duplicates: duplicateOwners.filter((r) => ['scheduleStructuredPlan', 'createLegacyScheduledPost', 'processBlockSchedule'].includes(r.ownerSymbol)).map((r) => `${r.file}:${r.line} ${r.ownerSymbol}`)
}));

writeMd('execution-map-content-generation.md', executionMap('Content Generation Execution Map', {
  entrypoints: ['pages/api/activity-workspace/content.ts', 'backend/queue/jobProcessors/boltContentJobProcessor.ts', 'backend/queue/jobProcessors/contentGenerationProcessor.ts', 'backend/domain/from-lib/post/runPostGeneration.ts', 'backend/domain/from-lib/thread/runThreadGeneration.ts'],
  owners: ['backend/services/contentGeneration/blueprintGenerator.ts', 'backend/services/contentGeneration/platformVariantGenerator.ts', 'backend/services/boltContentGenerationForSchedule.ts', 'backend/services/boltScheduleBlockProcessor.ts'],
  dbMutations: dbWrites.filter((r) => /content|daily_content|asset|variant/.test(r.table)).slice(0, 30).map((r) => `${r.file}:${r.line} ${r.mutation} ${r.table}`),
  queues: ['backend/queue/jobProcessors/contentGenerationProcessor.ts', 'backend/queue/jobProcessors/boltContentJobProcessor.ts'],
  apis: ['pages/api/activity-workspace/content.ts', 'pages/api/content/**'],
  duplicates: duplicateOwners.filter((r) => ['generateMasterContentFromIntent', 'buildPlatformVariantsFromMaster'].includes(r.ownerSymbol)).map((r) => `${r.file}:${r.line} ${r.ownerSymbol}`)
}));

writeMd('execution-map-recommendation-generation.md', executionMap('Recommendation Generation Execution Map', {
  entrypoints: ['pages/api/recommendations/generate.ts', 'pages/api/recommendations/detected-opportunities.ts', 'backend/services/recommendationScheduler.ts', 'backend/services/intelligence/intelligenceOrchestrator.ts'],
  owners: ['backend/services/recommendationEngine.ts', 'backend/services/recommendationEngine/engine.ts', 'backend/services/recommendationEngineService.ts', 'backend/services/intelligence/recommendations/generateRecommendations.ts'],
  dbMutations: dbWrites.filter((r) => /recommendation/.test(r.table)).map((r) => `${r.file}:${r.line} ${r.mutation} ${r.table}`),
  queues: ['backend/services/recommendationJobProcessor.ts', 'backend/services/recommendationScheduler.ts'],
  apis: ['pages/api/recommendations/**'],
  duplicates: duplicateOwners.filter((r) => r.ownerSymbol === 'generateRecommendations').map((r) => `${r.file}:${r.line} ${r.ownerSymbol}`)
}));

writeMd('execution-map-ai-execution.md', executionMap('AI Execution Map', {
  entrypoints: ['backend/services/aiGateway.ts', 'pages/api/campaigns/ai/plan.ts', 'pages/api/activity-workspace/content.ts'],
  owners: ['backend/services/aiGateway.ts', 'backend/services/campaignAiOrchestrator.ts', 'backend/services/unifiedContentGenerationEngine.ts'],
  dbMutations: dbWrites.filter((r) => /ai|audit|campaign|recommendation/.test(r.table)).slice(0, 30).map((r) => `${r.file}:${r.line} ${r.mutation} ${r.table}`),
  queues: ['backend/queue/**', 'backend/workers/**'],
  apis: ['pages/api/ai/**', 'pages/api/campaigns/ai/**', 'pages/api/activity-workspace/content.ts'],
  duplicates: duplicateOwners.filter((r) => ['runCampaignAiPlan', 'generateMasterContentFromIntent', 'generateRecommendations'].includes(r.ownerSymbol)).map((r) => `${r.file}:${r.line} ${r.ownerSymbol}`)
}));

writeMd('execution-map-persistence-mutation-flow.md', executionMap('Persistence Mutation Flow Map', {
  entrypoints: ['pages/api/**', 'backend/services/**', 'backend/jobs/**', 'backend/queue/**'],
  owners: ['backend/db/* stores', 'backend/services/* direct Supabase callers', 'pages/api/* direct Supabase callers'],
  dbMutations: dbWrites.slice(0, 200).map((r) => `${r.file}:${r.line} ${r.mutation} ${r.table}`),
  queues: ['backend/queue/**', 'backend/workers/**', 'backend/jobs/**'],
  apis: ['pages/api/**'],
  duplicates: ['Multiple non-repository layers mutate Supabase directly; see direct-db-writes.json']
}));

writeMd('migration-order.md', `
# Safe Migration Order

1. Freeze reports and warning baselines in architecture-migration/reports.
2. Promote frontend/backend import warnings to CI-visible non-blocking output.
3. Extract shared DTOs and validators into production shared/contracts and shared/schemas.
4. Move frontend imports from backend internals to shared contracts and API clients.
5. Introduce repository implementations behind existing DB behavior.
6. Route scheduling writes through ScheduleRepository and ScheduleCommandService.
7. Route content generation through a single ContentGenerationPipeline facade.
8. Route recommendation snapshots through RecommendationSnapshotRepository.
9. Extract campaign variant adapters and remove variant fields from campaign core contracts.
10. Delete duplicate weekly-structure API helper after all imports resolve to domain/core.
11. Quarantine deprecated routes by classification: DEAD first, INTERNAL_ONLY behind internal router, UNKNOWN after telemetry decision, ACTIVE after replacement.
12. Break dependency cycles by ports/interfaces from outer modules inward.
13. Split oversized files only after ownership boundaries are enforced.
14. Promote warnings to blocking in this order: frontend/backend imports, deprecated routes, duplicate execution owners, direct DB writes, variant contamination, dependency cycles, file size.
`);

writeJson('warning-counts.json', {
  frontendBackendImports: fbi.length,
  dependencyCycles: cycles.length,
  directDbWrites: dbWrites.length,
  duplicateExecutionOwners: duplicateOwners.length,
  deprecatedRoutes: deprecated.length,
  oversizedFiles: oversized.length,
  variantContamination: variants.length,
  anyUnknownLeaks: leaks.length,
  duplicateRoutes: routeDuplicates.length
});

console.log(JSON.stringify({
  reportsDirectory: rel(outDir),
  warningCounts: {
    frontendBackendImports: fbi.length,
    dependencyCycles: cycles.length,
    directDbWrites: dbWrites.length,
    duplicateExecutionOwners: duplicateOwners.length,
    deprecatedRoutes: deprecated.length,
    oversizedFiles: oversized.length,
    variantContamination: variants.length,
    anyUnknownLeaks: leaks.length,
    duplicateRoutes: routeDuplicates.length
  },
  dirtyCounts: classification.counts,
  architectureTargetDirtyCount: classification.architectureTargetFilesCurrentlyDirty.length
}, null, 2));
