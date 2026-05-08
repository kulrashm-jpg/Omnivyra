import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const outDir = path.join(root, 'architecture-migration', 'reports', 'forensic-rebaseline');
const rawReportsDir = path.join(root, 'architecture-migration', 'reports');
const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx']);
const skipDirs = new Set(['node_modules', '.next', '.git']);

const executionDomains = {
  recommendations: {
    canonicalOwners: ['RecommendationEngine', 'generateRecommendations'],
    symbols: ['generateRecommendations', 'recommendationEngine', 'RecommendationEngine'],
  },
  contentGeneration: {
    canonicalOwners: ['ContentGenerationPipeline'],
    symbols: ['generateMasterContentFromIntent', 'buildPlatformVariantsFromMaster', 'ContentGenerationPipeline'],
  },
  scheduling: {
    canonicalOwners: ['ScheduleCommandService'],
    symbols: ['scheduleStructuredPlan', 'createLegacyScheduledPost', 'processBlockSchedule', 'ScheduleCommandService'],
  },
  campaignExecution: {
    canonicalOwners: ['CampaignExecutionOrchestrator'],
    symbols: ['runCampaignAiPlan', 'executeBoltPipeline', 'CampaignExecutionOrchestrator'],
  },
  aiExecution: {
    canonicalOwners: ['AIExecutionService'],
    symbols: ['runCompletion', 'runWithRetry', 'AIExecutionService'],
  },
};

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
    else if (sourceExts.has(path.extname(full))) results.push(full);
  }
  return results;
}

function parse(file) {
  const src = read(file);
  const kind = file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return {
    src,
    sf: ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind),
  };
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function pathClass(fileRel) {
  if (/^backend\/repositories\//.test(fileRel) || /^backend\/db\//.test(fileRel)) return 'repository';
  if (/^backend\/tests?\//.test(fileRel) || /\.test\./.test(fileRel) || /\.spec\./.test(fileRel)) return 'test';
  if (/^(archive|architecture-migration\/quarantine|legacy-disabled)\//.test(fileRel)) return 'dead-legacy';
  if (/^pages\/api\//.test(fileRel)) return 'api';
  if (/^backend\/queue\//.test(fileRel) || /^backend\/jobs\//.test(fileRel)) return 'queue-job';
  if (/^backend\/(services|domain|scheduler|auth|integration)\//.test(fileRel)) return 'execution';
  return 'other';
}

function moduleName(fileRel) {
  return fileRel.replace(/\.(ts|tsx|js|jsx)$/, '');
}

function propertyName(expr) {
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return null;
}

function chainText(node, sf) {
  return node.getText(sf).slice(0, 800);
}

function findFromTable(node, sf) {
  const text = chainText(node, sf);
  const match = text.match(/\.from\(\s*['"`]([^'"`]+)['"`]\s*\)/);
  return match?.[1] ?? null;
}

function collectDirectDbWrites(files) {
  const records = [];
  for (const file of files) {
    const fileRel = rel(file);
    const cls = pathClass(fileRel);
    const { sf } = parse(file);
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const mutation = propertyName(node.expression);
        if (['insert', 'upsert', 'update', 'delete'].includes(mutation)) {
          const table = findFromTable(node.expression, sf);
          if (table) {
            const repositoryOwned = cls === 'repository';
            const testOnly = cls === 'test';
            const deadLegacy = cls === 'dead-legacy';
            const executionReachable = !testOnly && !deadLegacy && cls !== 'other';
            const severity = repositoryOwned
              ? 'safe'
              : testOnly
                ? 'ignore'
                : deadLegacy
                  ? 'low'
                  : cls === 'api'
                    ? 'medium'
                    : cls === 'queue-job'
                      ? 'high'
                      : 'critical';
            const score = { safe: 0, ignore: 0, low: 1, medium: 5, high: 8, critical: 10 }[severity];
            records.push({
              file: fileRel,
              line: lineOf(sf, node),
              table,
              mutationType: mutation,
              repositoryOwned,
              executionReachable,
              ownershipSeverity: severity,
              canonicalOwnerMissing: !repositoryOwned && !testOnly,
              runtimeRiskScore: score,
              pathClass: cls,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
  return records;
}

function hasOrchestrationSignals(bodyText) {
  const signals = [
    /\bawait\b/g,
    /\.from\(/g,
    /\.insert\(|\.update\(|\.upsert\(|\.delete\(/g,
    /\bqueue\b|\benqueue\b|\bprocessor\b/i,
    /\brun[A-Z]|\bexecute[A-Z]|\bgenerate[A-Z]|\bschedule[A-Z]|\bprocess[A-Z]/,
    /\btry\s*{/,
  ];
  let score = 0;
  for (const rx of signals) if (rx.test(bodyText)) score += 1;
  return score >= 3;
}

function symbolDomain(name) {
  for (const [domain, config] of Object.entries(executionDomains)) {
    if (config.symbols.includes(name)) return domain;
  }
  return null;
}

function functionName(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) return node.name.getText();
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    if (decl?.name && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
      return decl.name.getText();
    }
  }
  return null;
}

function collectDuplicateExecutionRisk(files) {
  const records = [];
  const graph = {};
  for (const domain of Object.keys(executionDomains)) {
    graph[domain] = { canonicalOwners: executionDomains[domain].canonicalOwners, owners: [], adapters: [], entrypoints: [], violations: [] };
  }
  for (const file of files) {
    const fileRel = rel(file);
    const cls = pathClass(fileRel);
    const { sf } = parse(file);
    function classifySymbol(name, node) {
      const domain = symbolDomain(name);
      if (!domain) return;
      const text = node.getText(sf);
      const canonical = executionDomains[domain].canonicalOwners.includes(name) || executionDomains[domain].canonicalOwners.some((owner) => fileRel.toLowerCase().includes(owner.toLowerCase()));
      const isTest = cls === 'test';
      const isApi = cls === 'api';
      const isQueue = cls === 'queue-job';
      const isDead = cls === 'dead-legacy';
      const orchestrates = hasOrchestrationSignals(text);
      const kind = canonical
        ? 'canonical-owner'
        : isTest
          ? 'test/mock/reference'
          : isDead
            ? 'dead-flow'
            : isApi
              ? 'api-entrypoint'
              : isQueue
                ? 'queue-entrypoint'
                : orchestrates
                  ? 'duplicate-orchestration-owner'
                  : 'adapter/delegator';
      const violation = kind === 'duplicate-orchestration-owner';
      const record = {
        domain,
        file: fileRel,
        line: lineOf(sf, node),
        symbol: name,
        ownershipClass: kind,
        canonicalOwner: canonical,
        duplicateOrchestrationViolation: violation,
        runtimeRiskScore: violation ? 9 : isApi || isQueue ? 4 : 0,
      };
      records.push(record);
      if (kind === 'canonical-owner') graph[domain].owners.push(record);
      else if (kind === 'api-entrypoint' || kind === 'queue-entrypoint') graph[domain].entrypoints.push(record);
      else if (kind === 'adapter/delegator') graph[domain].adapters.push(record);
      else if (violation) graph[domain].violations.push(record);
    }
    function visit(node) {
      const name = functionName(node);
      if (name) classifySymbol(name, node);
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
  return { records, graph };
}

function importRecords(file, sf) {
  const records = [];
  sf.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      records.push({
        spec: node.moduleSpecifier.text,
        typeOnly: Boolean(node.importClause?.isTypeOnly),
        barrel: false,
      });
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      records.push({
        spec: node.moduleSpecifier.text,
        typeOnly: Boolean(node.isTypeOnly),
        barrel: true,
      });
    }
  });
  return records;
}

function resolveImport(from, spec, fileSet) {
  if (spec.startsWith('@/')) {
    spec = `./${spec.slice(2)}`;
    from = path.join(root, 'index.ts');
  }
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  const candidates = [];
  for (const ext of sourceExts) candidates.push(base + ext);
  for (const ext of sourceExts) candidates.push(path.join(base, `index${ext}`));
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate).toLowerCase();
    if (fileSet.has(normalized)) return normalized;
  }
  return null;
}

function collectDependencyCycles(files) {
  const fileSet = new Set(files.map((file) => path.normalize(file).toLowerCase()));
  const graph = new Map();
  const edgeMeta = new Map();
  for (const file of files) {
    const { sf } = parse(file);
    const from = path.normalize(file).toLowerCase();
    const deps = [];
    for (const rec of importRecords(file, sf)) {
      const resolved = resolveImport(file, rec.spec, fileSet);
      if (!resolved) continue;
      deps.push(resolved);
      edgeMeta.set(`${from}>${resolved}`, rec);
    }
    graph.set(from, deps);
  }
  const cycles = [];
  const seen = new Set();
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function cycleKey(cycle) {
    return cycle.map((item) => rel(item)).join('>');
  }
  function classify(cycle) {
    const chain = cycle.map((item) => rel(item));
    if (chain.length === 2 && chain[0] === chain[1]) return 'self-cycle';
    if (chain.some((item) => /^backend\/tests?\//.test(item) || /\.test\./.test(item))) return 'test-only-cycle';
    const metas = [];
    for (let i = 0; i < cycle.length - 1; i++) metas.push(edgeMeta.get(`${cycle[i]}>${cycle[i + 1]}`));
    if (metas.some((meta) => meta?.typeOnly)) return 'type-only-cycle';
    if (metas.some((meta) => meta?.barrel)) return 'barrel/export-cycle';
    return 'runtime-cycle';
  }
  function dfs(node) {
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const dep of graph.get(node) || []) {
      if (!graph.has(dep)) continue;
      if (visiting.has(dep)) {
        const index = stack.indexOf(dep);
        const cycle = stack.slice(index).concat(dep);
        const key = cycleKey(cycle);
        if (!seen.has(key)) {
          seen.add(key);
          const cycleClass = classify(cycle);
          cycles.push({
            chain: cycle.map((item) => rel(item)),
            cycleClass,
            runtimeSeverity: cycleClass === 'runtime-cycle' ? 'critical' : cycleClass === 'barrel/export-cycle' ? 'medium' : 'low',
            blockingIsolationCycle: cycleClass === 'runtime-cycle',
            ownershipDomainsInvolved: [...new Set(cycle.map((item) => rel(item).split('/').slice(0, 3).join('/')))],
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

function collectOversizedRisk(files) {
  const records = [];
  const detectors = {
    orchestration: /\bexecute\b|\borchestr|pipeline|workflow|run[A-Z]|process[A-Z]/i,
    persistence: /(?:ownedDbTable|supabase|db|client|repository)\s*(?:\)|\.)\s*\.?\s*(?:from|insert|update|upsert|delete)\s*\(|\b(?:supabase|db|client)\s*\.from\s*\(|\.from\s*\([^)]*\)\s*\.\s*(?:insert|update|upsert|delete)\s*\(/i,
    validation: /zod|schema|validate|parse[A-Z]|safeParse|assert/i,
    mapping: /\bmap[A-Z]|\bnormalize|transform|adapter|to[A-Z]|from[A-Z]/,
    rendering: /\b(?:React|useState|useEffect)\b|className=|<\/?[A-Z][A-Za-z0-9]{2,}\b|<\/?(?:div|span|section|article|button|form|input|p|h[1-6])\b/i,
    queueCoordination: /\b(?:queue|enqueue|BullMQ|QueueScheduler)\b|\b(?:queue|workQueue|contentQueue|schedulerQueue)\s*\.\s*add\s*\(|addBulk\(|\bWorker\b|\bProcessor\b|\bprocessJob\b|\bjobProcessor\b/i,
    scoring: /score|rank|weight|confidence|priority/i,
    promptConstruction: /prompt|messages|systemPrompt|userPrompt|llm/i,
    authority: /\brequireCapability\b|\bCapability\b|\bprincipal\b|\bauthContext\b|\bpermission\b|\bauthorize\b|\bauthenticate\b|\bresolveUserContext\b|\badminOnly\b|\btrustedPrincipal\b|\bSessionAuthority\b|\bRoleAuthority\b|\bAuthAuthority\b/i,
  };
  function stripNonCodeText(value) {
    return value
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\r\n]*/g, ' ')
      .replace(/`(?:\\[\s\S]|[^`\\])*`/g, ' ')
      .replace(/'(?:\\.|[^'\\])*'/g, ' ')
      .replace(/"(?:\\.|[^"\\])*"/g, ' ');
  }
  for (const file of files) {
    const fileRel = rel(file);
    if (/^(archive|architecture-migration)\//.test(fileRel)) continue;
    const src = read(file);
    const codeOnly = stripNonCodeText(src);
    const lines = src.split(/\r?\n/).length;
    if (lines <= 500) continue;
    const ownership = Object.entries(detectors).filter(([, rx]) => rx.test(codeOnly)).map(([key]) => key);
    const cls = pathClass(fileRel);
    const frontendRuntime = /^(components|hooks|pages\/(?!api\/))\//.test(fileRel);
    const apiOrBackendRuntime = /^(backend\/(services|domain|scheduler|queue|jobs|workers|auth|integration|security|middleware)|pages\/api|lib\/(server|auth|anomaly|redis|blog|content))\//.test(fileRel);
    const uiOnly = frontendRuntime && ownership.includes('rendering');
    const typeAggregation = /types|contracts|schema|\.d\.ts/i.test(fileRel);
    const tooling = /^scripts\//.test(fileRel);
    const mixedOrchestrationPersistence = ownership.includes('orchestration') && ownership.includes('persistence');
    const mixedQueueMutation = ownership.includes('queueCoordination') && ownership.includes('persistence');
    const mixedAuthorityExecution = ownership.includes('authority') && ownership.includes('orchestration') && !typeAggregation;
    const dangerousMixed = apiOrBackendRuntime && (mixedOrchestrationPersistence || mixedQueueMutation || mixedAuthorityExecution);
    const mixedRuntime = cls !== 'test' && cls !== 'dead-legacy' && !uiOnly && !typeAggregation && !tooling && dangerousMixed;
    const classification = mixedRuntime
      ? 'mixed-runtime-ownership'
      : uiOnly
        ? 'render-only-ui'
        : typeAggregation
          ? 'type-or-schema-aggregation'
          : tooling
            ? 'tooling-script'
            : 'isolated-large-single-purpose';
    records.push({
      file: fileRel,
      lines,
      ownershipConcerns: ownership,
      ownershipCount: ownership.length,
      dangerousOwnership: {
        mixedOrchestrationPersistence,
        mixedQueueMutation,
        mixedAuthorityExecution,
      },
      classification,
      mixedRuntimeRiskScore: mixedRuntime ? Math.min(10, ownership.length + Math.floor(lines / 1000)) : 1,
      splitPriority: mixedRuntime ? (lines > 1200 ? 'P0' : 'P1') : 'P2',
    });
  }
  return records.sort((a, b) => b.mixedRuntimeRiskScore - a.mixedRuntimeRiskScore || b.lines - a.lines);
}

function collectBoundaryLeakRisk(files) {
  const records = [];
  for (const file of files) {
    const fileRel = rel(file);
    const cls = pathClass(fileRel);
    const src = read(file);
    const lines = src.split(/\r?\n/);
    lines.forEach((text, index) => {
      const hit = /\bany\b|Record<string,\s*any>|Record<string,\s*unknown>|\bunknown\b|JSON\.parse|req\.body/.test(text);
      if (!hit) return;
      const context = lines.slice(Math.max(0, index - 4), Math.min(lines.length, index + 6)).join('\n');
      const schemaValidation = /safeParse|\.parse\(|zod|z\.|schema|validate|assert|typeof|Array\.isArray/.test(context);
      const jsonParse = /JSON\.parse/.test(text);
      const unsafeAny = /\bany\b|Record<string,\s*any>/.test(text);
      const unknown = /Record<string,\s*unknown>|\bunknown\b/.test(text);
      const mutation = /\.from\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\[[^\]]+\]\s*=|\.push\(/.test(context);
      const severity = cls === 'test'
        ? 'ignore'
        : unsafeAny
          ? 'critical'
          : unknown && mutation && !schemaValidation
            ? 'critical'
            : jsonParse && !schemaValidation
              ? 'critical'
              : unknown && schemaValidation
                ? 'low'
                : 'medium';
      records.push({
        file: fileRel,
        line: index + 1,
        text: text.trim(),
        propagationPath: mutation ? 'boundary-to-mutation-context' : 'local-boundary-or-type-context',
        schemaValidationPresent: schemaValidation,
        runtimeMutationPossible: mutation,
        severityTier: severity,
        leakClass: unsafeAny
          ? 'unsafe-any-propagation'
          : unknown && mutation && !schemaValidation
            ? 'unsafe-unknown-mutation'
            : unknown && schemaValidation
              ? 'safe-narrowed-unknown'
              : jsonParse && schemaValidation
                ? 'schema-validated-json-parse'
                : jsonParse
                  ? 'unsafe-json-parse'
                  : 'serialization-or-schema-bridge',
      });
    });
  }
  return records;
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = typeof key === 'function' ? key(item) : item[key];
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function buildRiskRanking({ db, duplicate, cycles, oversized, leaks }) {
  const scores = new Map();
  function add(file, category, score) {
    if (!scores.has(file)) scores.set(file, { module: file, riskScore: 0, riskCategories: {}, executionCriticality: 'normal', migrationPriority: 'P2', blockerSeverity: 'none' });
    const rec = scores.get(file);
    rec.riskScore += score;
    rec.riskCategories[category] = (rec.riskCategories[category] || 0) + 1;
  }
  db.forEach((r) => add(r.file, 'runtimeMutation', r.runtimeRiskScore * 5));
  duplicate.records.forEach((r) => add(r.file, 'duplicateOrchestration', r.runtimeRiskScore * 4));
  cycles.filter((r) => r.blockingIsolationCycle).forEach((r) => r.chain.slice(0, -1).forEach((file) => add(file, 'runtimeCycle', 30)));
  leaks.forEach((r) => add(r.file, 'boundaryLeak', r.severityTier === 'critical' ? 20 : r.severityTier === 'medium' ? 8 : 1));
  oversized.forEach((r) => add(r.file, 'oversizedMixedRuntime', r.classification === 'mixed-runtime-ownership' ? r.mixedRuntimeRiskScore * 3 : 1));
  for (const rec of scores.values()) {
    rec.executionCriticality = rec.riskScore >= 100 ? 'critical' : rec.riskScore >= 50 ? 'high' : rec.riskScore >= 20 ? 'medium' : 'low';
    rec.migrationPriority = rec.riskScore >= 100 ? 'P0' : rec.riskScore >= 50 ? 'P1' : 'P2';
    rec.blockerSeverity = rec.riskScore >= 100 ? 'blocking' : rec.riskScore >= 50 ? 'major' : rec.riskScore >= 20 ? 'moderate' : 'minor';
  }
  return [...scores.values()].sort((a, b) => b.riskScore - a.riskScore);
}

function readRawCounts() {
  const file = path.join(rawReportsDir, 'warning-counts.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(read(file));
}

function tierSummary({ db, duplicate, cycles, oversized, leaks }) {
  return {
    P0: {
      runtimeCycles: cycles.filter((r) => r.blockingIsolationCycle).length,
      directDbWritesOutsideRepositories: db.filter((r) => ['critical', 'high'].includes(r.ownershipSeverity)).length,
      duplicateOrchestrationOwners: duplicate.records.filter((r) => r.duplicateOrchestrationViolation).length,
      unsafeAnyPropagation: leaks.filter((r) => r.severityTier === 'critical' && r.leakClass === 'unsafe-any-propagation').length,
      frontendBackendImports: readRawCounts().frontendBackendImports ?? 0,
      deprecatedRoutes: readRawCounts().deprecatedRoutes ?? 0,
      variantContamination: readRawCounts().variantContamination ?? 0,
    },
    P1: {
      mixedRuntimeOversizedFiles: oversized.filter((r) => r.classification === 'mixed-runtime-ownership').length,
      unsafeUnknownBoundaries: leaks.filter((r) => r.severityTier === 'critical' && r.leakClass !== 'unsafe-any-propagation').length,
    },
    P2: {
      typeOnlyCycles: cycles.filter((r) => r.cycleClass === 'type-only-cycle').length,
      schemaBridges: leaks.filter((r) => ['safe-narrowed-unknown', 'schema-validated-json-parse', 'serialization-or-schema-bridge'].includes(r.leakClass)).length,
      isolatedOversizedFiles: oversized.filter((r) => r.classification !== 'mixed-runtime-ownership').length,
    },
  };
}

ensureDir(outDir);
const files = walk(root);
const directDbWritesRisk = collectDirectDbWrites(files);
const duplicateRisk = collectDuplicateExecutionRisk(files);
const dependencyCyclesRisk = collectDependencyCycles(files);
const oversizedFilesRisk = collectOversizedRisk(files);
const boundaryLeaksRisk = collectBoundaryLeakRisk(files);
const architectureRiskRanking = buildRiskRanking({
  db: directDbWritesRisk,
  duplicate: duplicateRisk,
  cycles: dependencyCyclesRisk,
  oversized: oversizedFilesRisk,
  leaks: boundaryLeaksRisk,
});
const rawBaseline = readRawCounts();
const trueRiskBaseline = {
  runtimeDbWriteRisks: directDbWritesRisk.filter((r) => ['critical', 'high'].includes(r.ownershipSeverity)).length,
  apiAdapterDbWriteRisks: directDbWritesRisk.filter((r) => r.ownershipSeverity === 'medium').length,
  repositoryOwnedWrites: directDbWritesRisk.filter((r) => r.repositoryOwned).length,
  ignoredTestWrites: directDbWritesRisk.filter((r) => r.ownershipSeverity === 'ignore').length,
  trueDuplicateOrchestrationOwners: duplicateRisk.records.filter((r) => r.duplicateOrchestrationViolation).length,
  runtimeDependencyCycles: dependencyCyclesRisk.filter((r) => r.blockingIsolationCycle).length,
  criticalUnsafeLeaks: boundaryLeaksRisk.filter((r) => r.severityTier === 'critical').length,
  mixedRuntimeOversizedFiles: oversizedFilesRisk.filter((r) => r.classification === 'mixed-runtime-ownership').length,
  p0: tierSummary({ db: directDbWritesRisk, duplicate: duplicateRisk, cycles: dependencyCyclesRisk, oversized: oversizedFilesRisk, leaks: boundaryLeaksRisk }).P0,
};

writeJson('direct-db-writes-risk.json', directDbWritesRisk);
writeJson('duplicate-execution-risk.json', duplicateRisk.records);
writeJson('dependency-cycles-risk.json', dependencyCyclesRisk);
writeJson('oversized-files-risk.json', oversizedFilesRisk);
writeJson('boundary-leaks-risk.json', boundaryLeaksRisk);
writeJson('architecture-risk-ranking.json', architectureRiskRanking);
writeJson('raw-metrics-baseline.json', rawBaseline);
writeJson('true-risk-baseline.json', trueRiskBaseline);
writeJson('true-risk-summary.json', {
  rawCounts: rawBaseline,
  trueRiskCounts: trueRiskBaseline,
  directDbWritesBySeverity: countBy(directDbWritesRisk, 'ownershipSeverity'),
  duplicateOwnershipByClass: countBy(duplicateRisk.records, 'ownershipClass'),
  cyclesByClass: countBy(dependencyCyclesRisk, 'cycleClass'),
  oversizedByClass: countBy(oversizedFilesRisk, 'classification'),
  leaksByClass: countBy(boundaryLeaksRisk, 'leakClass'),
});
writeJson('ownership-graph.json', {
  executionDomains: duplicateRisk.graph,
  topRiskModules: architectureRiskRanking.slice(0, 50),
});
writeMd('architecture-enforcement-tiers.md', `
# Architecture Enforcement Tiers

## P0
- Runtime dependency cycles.
- Direct DB writes outside repositories in services, domains, queues, jobs, schedulers, auth, and integration execution paths.
- Duplicate orchestration owners.
- Unsafe any propagation.
- Frontend/backend imports.
- Deprecated active routes.
- Variant contamination.

## P1
- Mixed-runtime oversized files.
- Unsafe unknown boundaries without narrowing or schema validation.

## P2
- Type-only cycles.
- Schema bridges.
- Serialization unknowns.
- Isolated oversized files.
`);
writeMd('execution-domain-risk-map.md', Object.entries(duplicateRisk.graph).map(([domain, graph]) => {
  const lines = [`# ${domain}`, '', `Canonical owners: ${graph.canonicalOwners.join(', ') || 'none'}`, '', '## Duplicate orchestration violations'];
  graph.violations.forEach((item) => lines.push(`- ${item.file}:${item.line} ${item.symbol}`));
  lines.push('', '## Entrypoints');
  graph.entrypoints.forEach((item) => lines.push(`- ${item.file}:${item.line} ${item.ownershipClass} ${item.symbol}`));
  lines.push('', '## Adapters');
  graph.adapters.forEach((item) => lines.push(`- ${item.file}:${item.line} ${item.symbol}`));
  return lines.join('\n');
}).join('\n\n'));

const output = {
  reportsDirectory: rel(outDir),
  ownershipAwareCounts: {
    runtimeDbWriteRisks: trueRiskBaseline.runtimeDbWriteRisks,
    trueDuplicateOrchestrationOwners: trueRiskBaseline.trueDuplicateOrchestrationOwners,
    runtimeDependencyCycles: trueRiskBaseline.runtimeDependencyCycles,
    criticalUnsafeLeaks: trueRiskBaseline.criticalUnsafeLeaks,
    mixedRuntimeOversizedFiles: trueRiskBaseline.mixedRuntimeOversizedFiles,
  },
  severityTiers: tierSummary({ db: directDbWritesRisk, duplicate: duplicateRisk, cycles: dependencyCyclesRisk, oversized: oversizedFilesRisk, leaks: boundaryLeaksRisk }),
};

console.log(JSON.stringify(output, null, 2));

if (process.argv.includes('--enforce-runtime-cycles') && trueRiskBaseline.runtimeDependencyCycles > 0) {
  process.exit(1);
}
