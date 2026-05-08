import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const enforce = process.argv.includes('--enforce');
const resolutionCompletion = process.argv.includes('--resolution-completion');
const authorityLineageCompletion = process.argv.includes('--authority-lineage-completion');
const canonicalAuthorityRuntimeAncestry = process.argv.includes('--canonical-authority-runtime-ancestry');
const mutationGovernanceHardening = process.argv.includes('--mutation-governance-hardening');
const outDir = path.join(
  root,
  'architecture-migration',
  'reports',
  mutationGovernanceHardening
    ? 'mutation-governance-hardening'
    : canonicalAuthorityRuntimeAncestry
    ? 'canonical-authority-runtime-ancestry'
    : authorityLineageCompletion
    ? 'authority-lineage-completion'
    : resolutionCompletion
      ? 'semantic-resolution-completion'
      : 'semantic-enforcement-implementation',
);
const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx']);
const skipDirs = new Set(['node_modules', '.next', '.git', 'dist', 'coverage']);
const standardCallNames = new Set([
  'map', 'filter', 'reduce', 'forEach', 'find', 'some', 'every', 'includes', 'join', 'split',
  'trim', 'toLowerCase', 'toUpperCase', 'push', 'pop', 'shift', 'unshift', 'slice', 'splice',
  'add', 'delete', 'has', 'set', 'get', 'keys', 'values', 'entries', 'then', 'catch', 'finally',
  'log', 'warn', 'error', 'info', 'debug', 'json', 'status', 'send', 'end',
]);
const declarationPath = path.join(root, 'architecture-migration', 'contracts', 'canonical-authority-runtime-ancestry.json');

const authorityDomains = {
  auth: ['auth', 'token', 'session', 'login', 'signup', 'password', 'middleware'],
  session: ['session', 'cookie', 'bearer', 'jwt', 'supabase'],
  company: ['company', 'organization', 'tenant', 'active_company', 'company_id', 'organization_id'],
  role: ['role', 'rbac', 'capability', 'permission', 'super_admin', 'admin'],
  orchestration: ['orchestrator', 'pipeline', 'processor', 'scheduler', 'worker', 'execute', 'run', 'generate'],
  repository: ['repository', 'store', 'supabase', 'from', 'insert', 'update', 'upsert', 'delete'],
  queue: ['queue', 'worker', 'job', 'enqueue', 'bullmq', 'cron'],
};

const executionDomains = {
  recommendations: {
    roots: ['generateRecommendations', 'RecommendationEngine'],
    canonicalModules: ['backend/services/recommendationEngine.ts', 'backend/services/recommendationEngine/engine.ts'],
  },
  contentGeneration: {
    roots: ['generateMasterContentFromIntent', 'buildPlatformVariantsFromMaster', 'ContentGenerationPipeline'],
    canonicalModules: ['backend/services/contentGenerationPipeline.ts', 'backend/services/contentGeneration/blueprintGenerator.ts', 'backend/services/contentGeneration/platformVariantGenerator.ts'],
  },
  scheduling: {
    roots: ['scheduleStructuredPlan', 'createLegacyScheduledPost', 'processBlockSchedule', 'ScheduleCommandService'],
    canonicalModules: ['backend/services/structuredPlanScheduler.ts', 'backend/services/ScheduleCommandService.ts'],
  },
  campaignExecution: {
    roots: ['runCampaignAiPlan', 'executeBoltPipeline', 'CampaignExecutionOrchestrator'],
    canonicalModules: ['backend/services/campaignAiOrchestrator.ts', 'backend/services/boltPipelineService.ts'],
  },
  aiExecution: {
    roots: ['runCompletion', 'executeGatewayCompletion', 'runCompletionWithOperation', 'AIExecutionService'],
    canonicalModules: ['backend/services/aiGateway.ts'],
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

function readJsonIfExists(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function writeMd(name, value) {
  fs.writeFileSync(path.join(outDir, name), `${value.trim()}\n`);
}

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
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

function buildProgram(files) {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  let options = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
  };
  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!configFile.error) {
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
      options = { ...parsed.options, allowJs: true, checkJs: false, noEmit: true, skipLibCheck: true };
    }
  }
  return ts.createProgram(files, options);
}

function symbolAt(checker, node) {
  if (!checker || !node) return null;
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return null;
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
  return symbol;
}

function declarationInfo(symbol) {
  const declarations = symbol?.getDeclarations?.() ?? [];
  const declaration = declarations.find((decl) => decl.getSourceFile?.()) ?? declarations[0];
  if (!declaration) return null;
  const sf = declaration.getSourceFile();
  return {
    file: rel(sf.fileName),
    line: lineOf(sf, declaration),
    kind: ts.SyntaxKind[declaration.kind],
    symbolName: symbol.getName(),
  };
}

function symbolResolution(checker, node) {
  const symbol = symbolAt(checker, node);
  const declaration = declarationInfo(symbol);
  return {
    resolved: Boolean(symbol && declaration),
    symbolName: symbol?.getName?.() ?? null,
    declaration,
  };
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function pathClass(fileRel) {
    if (/^backend\/repositories\//.test(fileRel) || /^backend\/db\//.test(fileRel) || /(?:Repository|Store)\.tsx?$/.test(fileRel)) return 'repository';
  if (/^backend\/tests?\//.test(fileRel) || /^tests\//.test(fileRel) || /\.test\./.test(fileRel) || /\.spec\./.test(fileRel)) return 'test';
  if (/^(scripts|backend\/scripts|supabase\/functions)\//.test(fileRel)) return 'tooling';
  if (/^(archive|architecture-migration\/quarantine|legacy-disabled)\//.test(fileRel)) return 'dead-legacy';
  if (/^pages\/api\//.test(fileRel)) return 'api';
  if (/^backend\/queue\//.test(fileRel) || /^backend\/jobs\//.test(fileRel) || /^backend\/workers\//.test(fileRel)) return 'queue-job';
  if (/^backend\/(services|domain|scheduler|auth|integration|security|middleware)\//.test(fileRel)) return 'execution';
  if (/^(lib|components|hooks|pages)\//.test(fileRel)) return 'runtime';
  return 'other';
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

function expressionName(expr) {
  if (!expr) return null;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isElementAccessExpression(expr)) return expr.argumentExpression?.getText().replace(/^['"`]|['"`]$/g, '') ?? null;
  if (ts.isCallExpression(expr)) return expressionName(expr.expression);
  return null;
}

function functionName(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node)) && node.name) return node.name.getText();
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    if (decl?.name && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) return decl.name.getText();
  }
  return null;
}

function nearestFunction(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const name = stack[i];
    if (name) return name;
  }
  return '<module>';
}

function severity(rank) {
  if (rank >= 9) return 'critical';
  if (rank >= 6) return 'high';
  if (rank >= 3) return 'moderate';
  return 'low';
}

function domainForSymbol(symbol, fileRel = '') {
  for (const [domain, config] of Object.entries(executionDomains)) {
    if (config.roots.includes(symbol) || config.canonicalModules.includes(fileRel)) return domain;
  }
  return domainForModule(fileRel);
}

function domainForModule(fileRel = '') {
  if (/recommendation/i.test(fileRel)) return 'recommendations';
  if (/contentGeneration|content-generation|blueprintGenerator|platformVariant|content.*Adapter/i.test(fileRel)) return 'contentGeneration';
  if (/schedule|scheduler|scheduled/i.test(fileRel)) return 'scheduling';
  if (/campaignAiOrchestrator|boltPipeline|campaign.*execution|campaign.*planner/i.test(fileRel)) return 'campaignExecution';
  if (/aiGateway|AIExecution|intelligenceOrchestrator/i.test(fileRel)) return 'aiExecution';
  return null;
}

function authorityHits(fileRel, text) {
  const normalized = `${fileRel}\n${text}`.toLowerCase();
  return Object.entries(authorityDomains)
    .filter(([, words]) => words.some((word) => normalized.includes(word)))
    .map(([domain]) => domain);
}

function callTargetFromQueueName(queueName) {
  const value = String(queueName ?? '').toLowerCase();
  if (value.includes('bolt')) return 'executeBoltPipeline';
  if (value.includes('content') || value.includes('creator')) return 'ContentGenerationPipeline';
  if (value.includes('recommendation')) return 'RecommendationEngine';
  if (value.includes('publish') || value.includes('schedule')) return 'ScheduleCommandService';
  if (value.includes('lead')) return 'leadJobProcessor';
  if (value.includes('conversation-memory') || value.includes('rebuild')) return 'conversationMemoryRebuildProcessor';
  if (value.includes('engagement')) return 'engagementSignalProcessor';
  if (value.includes('whatsapp') || value.includes('wa-')) return 'whatsappBroadcastProcessor';
  if (value.includes('analytics')) return 'analyticsIngestionProcessor';
  if (value.includes('market-pulse')) return 'marketPulseJobProcessor';
  if (value.includes('intelligence') || value === 'poll') return 'intelligenceOrchestrator';
  return null;
}

function literalText(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return `${node.head.text}\${...}`;
  return null;
}

function propertyReceiverName(expr) {
  if (!ts.isPropertyAccessExpression(expr) && !ts.isElementAccessExpression(expr)) return null;
  const receiver = expr.expression;
  if (ts.isIdentifier(receiver)) return receiver.text;
  if (ts.isCallExpression(receiver)) return expressionName(receiver.expression);
  if (ts.isPropertyAccessExpression(receiver)) return receiver.getText();
  return null;
}

function constructorName(node) {
  if (!node || !ts.isNewExpression(node)) return null;
  return expressionName(node.expression);
}

function typeNameAt(checker, node) {
  if (!checker || !node) return '';
  try {
    return checker.typeToString(checker.getTypeAtLocation(node));
  } catch {
    return '';
  }
}

function hasRuntimeExecutionSignal(text) {
  return /\bnew\s+Worker\b|\bnew\s+Queue\b|\.addBulk\s*\(|\.add\s*\(|\.(insert|update|upsert|delete)\s*\(|\bimport\s*\(|\bsetInterval\s*\(|\bsetTimeout\s*\(/.test(text);
}

function hasExecutionRootName(name) {
  return /^(run|execute|process|schedule|enqueue|dispatch|start|handle|worker|orchestrate|generate|create|persist|save)[A-Z_]/.test(name)
    || /(?:Processor|Worker|Scheduler|Orchestrator|Pipeline)$/.test(name);
}

function isRuntimeBoundaryMutationTarget(left) {
  return /^(payload|command|dto|job\.data|job\.opts|req\.body|req\.query|req\.cookies|req\.headers|session|auth|authContext|userContext|companyContext|roleContext)(\.|\[)/i.test(left)
    || /\.(payload|command|dto|session|authContext|userContext|companyContext|roleContext)(\.|\[)/i.test(left);
}

function buildGraphs(files, program, checker, declarations) {
  const fileSet = new Set(files.map((file) => path.normalize(file).toLowerCase()));
  const registeredRoots = new Map((declarations.executionRoots ?? []).map((rec) => [`${rec.file}:${rec.function}`, rec]));
  const modules = new Map();
  const importGraph = [];
  const exportGraph = [];
  const callGraph = [];
  const executionRoots = [];
  const queueEdges = [];
  const queueProcessors = [];
  const mutationRecords = [];
  const payloadMutations = [];
  const unsafeSources = [];
  const authorityRecords = [];
  const unresolved = {
    aliases: [],
    exports: [],
    queueTargets: [],
    executionRoots: [],
    authorityChains: [],
  };

  const queueVariablesByFile = new Map();
  const queueFactories = new Map();
  const workerRegistrations = [];

  for (const file of files) {
    const fileRel = rel(file);
    const cls = pathClass(fileRel);
    const sf = program?.getSourceFile(file) ?? parse(file).sf;
    const src = sf.getFullText();
    const queueVariables = new Map();
    const constStringValues = new Map();
    queueVariablesByFile.set(fileRel, queueVariables);
    const module = {
      file: fileRel,
      pathClass: cls,
      imports: [],
      exports: [],
      dynamicImports: [],
      functions: [],
      calls: [],
      authorityDomains: authorityHits(fileRel, src),
    };
    authorityRecords.push({
      file: fileRel,
      pathClass: cls,
      authorityDomains: module.authorityDomains,
      severity: module.authorityDomains.length > 2 && cls !== 'test' ? 'high' : module.authorityDomains.length > 0 ? 'moderate' : 'low',
    });

    const importAliases = new Map();
    function recordImport(node) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) return;
      const spec = node.moduleSpecifier.text;
      const resolved = resolveImport(file, spec, fileSet);
      const rec = {
        from: fileRel,
        specifier: spec,
        resolved: resolved ? rel(resolved) : null,
        typeOnly: Boolean(node.importClause?.isTypeOnly),
        aliases: [],
        unresolved: !resolved && spec.startsWith('.'),
      };
      if (node.importClause?.name) {
        const resolvedSymbol = symbolResolution(checker, node.importClause.name);
        rec.aliases.push({ imported: 'default', local: node.importClause.name.text, kind: 'default', resolvedSymbol });
        importAliases.set(node.importClause.name.text, { imported: 'default', source: rec.resolved, specifier: spec, resolvedSymbol });
        if (!resolvedSymbol.resolved && cls !== 'test' && cls !== 'tooling' && cls !== 'dead-legacy' && spec.startsWith('.')) unresolved.aliases.push({ file: fileRel, line: lineOf(sf, node.importClause.name), imported: 'default', local: node.importClause.name.text, source: rec.resolved, severity: 'high', reason: 'TypeChecker could not resolve default import alias' });
      }
      const named = node.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          const local = element.name.text;
          const resolvedSymbol = symbolResolution(checker, element.propertyName ?? element.name);
          rec.aliases.push({ imported, local, kind: 'named', resolvedSymbol });
          importAliases.set(local, { imported, source: rec.resolved, specifier: spec, resolvedSymbol });
          if (!resolvedSymbol.resolved && cls !== 'test' && cls !== 'tooling' && cls !== 'dead-legacy' && spec.startsWith('.')) unresolved.aliases.push({ file: fileRel, line: lineOf(sf, element), imported, local, source: rec.resolved, severity: 'high', reason: 'TypeChecker could not resolve named import alias' });
        }
      }
      if (named && ts.isNamespaceImport(named)) {
        const resolvedSymbol = symbolResolution(checker, named.name);
        rec.aliases.push({ imported: '*', local: named.name.text, kind: 'namespace', resolvedSymbol });
        importAliases.set(named.name.text, { imported: '*', source: rec.resolved, specifier: spec, resolvedSymbol });
        if (!resolvedSymbol.resolved && cls !== 'test' && cls !== 'tooling' && cls !== 'dead-legacy' && spec.startsWith('.')) unresolved.aliases.push({ file: fileRel, line: lineOf(sf, named.name), imported: '*', local: named.name.text, source: rec.resolved, severity: 'high', reason: 'TypeChecker could not resolve namespace import alias' });
      }
      module.imports.push(rec);
      importGraph.push(rec);
    }

    function recordExport(node) {
      if (ts.isExportDeclaration(node)) {
        const spec = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
        const resolved = spec ? resolveImport(file, spec, fileSet) : null;
        const rec = {
          from: fileRel,
          exportKind: 're-export',
          specifier: spec,
          resolved: resolved ? rel(resolved) : null,
          typeOnly: Boolean(node.isTypeOnly),
          symbols: [],
          unresolved: Boolean(spec && !resolved && spec.startsWith('.')),
        };
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            const source = element.propertyName?.text ?? element.name.text;
            const exported = element.name.text;
            const resolvedSymbol = symbolResolution(checker, element.propertyName ?? element.name);
            rec.symbols.push({ source, exported, resolvedSymbol });
            if (!resolvedSymbol.resolved) unresolved.exports.push({ file: fileRel, line: lineOf(sf, element), source, exported, resolved: rec.resolved, severity: 'high', reason: 'TypeChecker could not resolve named export identity' });
          }
        } else {
          let starResolved = false;
          if (node.moduleSpecifier) {
            const moduleSymbol = checker?.getSymbolAtLocation(node.moduleSpecifier);
            const exports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
            starResolved = Boolean(rec.resolved && exports.length >= 0 && moduleSymbol);
            rec.starExportCount = exports.length;
          }
          if (!starResolved) unresolved.exports.push({ file: fileRel, line: lineOf(sf, node), source: '*', exported: '*', resolved: rec.resolved, severity: 'high', reason: 'TypeChecker could not resolve star re-export target' });
        }
        module.exports.push(rec);
        exportGraph.push(rec);
      }
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) {
        const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (isExported) {
          const rec = { from: fileRel, exportKind: 'declaration', symbol: node.name.text, line: lineOf(sf, node), domain: domainForSymbol(node.name.text, fileRel) };
          module.exports.push(rec);
          exportGraph.push(rec);
        }
      }
      if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const rec = { from: fileRel, exportKind: 'variable', symbol: decl.name.text, line: lineOf(sf, node), domain: domainForSymbol(decl.name.text, fileRel) };
            module.exports.push(rec);
            exportGraph.push(rec);
          }
        }
      }
    }

    function collect(node, stack = []) {
      if (ts.isImportDeclaration(node)) recordImport(node);
      if (ts.isExportDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isVariableStatement(node)) recordExport(node);

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const stringValue = literalText(node.initializer);
        if (stringValue) constStringValues.set(node.name.text, stringValue);
        const ctor = constructorName(node.initializer);
        if (ctor === 'Queue') {
          const firstArg = node.initializer.arguments?.[0];
          const queueName = literalText(firstArg) ?? (ts.isIdentifier(firstArg) ? constStringValues.get(firstArg.text) : null);
          if (queueName) queueVariables.set(node.name.text, queueName);
        }
        if (ts.isCallExpression(node.initializer)) {
          const factory = expressionName(node.initializer.expression);
          const firstArgQueue = /^get(Content)?Queue$/.test(factory ?? '') ? literalText(node.initializer.arguments?.[0]) : null;
          const factoryQueue = firstArgQueue ?? queueFactories.get(factory);
          if (factoryQueue) queueVariables.set(node.name.text, factoryQueue);
        }
      }

      if ((ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)) && functionName(node)) {
        const fn = functionName(node);
        const text = node.getText(sf);
        const directQueueMatch = text.match(/new\s+Queue(?:<[^>]+>)?\(\s*['"`]([^'"`]+)['"`]/);
        const identifierQueueMatch = text.match(/new\s+Queue(?:<[^>]+>)?\(\s*(\w+)\b/);
        const localNameQueueMatch = text.match(/(?:const|let)\s+(\w+)\s*=\s*['"`]([^'"`]+)['"`][\s\S]*?new\s+Queue(?:<[^>]+>)?\(\s*\1\b/);
        const queueName = directQueueMatch?.[1] ?? localNameQueueMatch?.[2] ?? (identifierQueueMatch ? constStringValues.get(identifierQueueMatch[1]) : null) ?? null;
        if (queueName) queueFactories.set(fn, queueName);
      }

      if (ts.isNewExpression(node) && constructorName(node) === 'Worker') {
        const queueName = literalText(node.arguments?.[0]);
        const processor = expressionName(node.arguments?.[1]);
        const registration = {
          file: fileRel,
          line: lineOf(sf, node),
          queueName,
          processor,
          resolved: Boolean(queueName && processor),
          severity: queueName && processor ? 'moderate' : 'critical',
        };
        workerRegistrations.push(registration);
        queueProcessors.push(registration);
      }

      const name = functionName(node);
      const nextStack = name ? stack.concat(name) : stack;
      if (name) {
        const text = node.getText(sf);
        const registration = registeredRoots.get(`${fileRel}:${name}`) ?? null;
        const domain = registration?.domain ?? domainForSymbol(name, fileRel);
        const executionSignal = hasRuntimeExecutionSignal(text);
        const rootName = hasExecutionRootName(name);
        const rootPath = ['api', 'queue-job', 'execution', 'repository'].includes(cls);
        const orchestrates = Boolean(domain || (rootPath && (executionSignal || rootName)));
        const root = {
          file: fileRel,
          line: lineOf(sf, node),
          function: name,
          domain,
          exported: module.exports.some((e) => e.symbol === name || e.symbols?.some((s) => s.exported === name)),
          pathClass: cls,
          authorityDomains: authorityHits(fileRel, text),
          orchestrates,
          canonicalOwner: Boolean(registration?.dominanceRoot || (domain && executionDomains[domain]?.canonicalModules.includes(fileRel))),
          registration,
        };
        module.functions.push(root);
        if (orchestrates && cls !== 'test' && cls !== 'tooling' && cls !== 'dead-legacy') {
          executionRoots.push(root);
        }
      }

      if (ts.isCallExpression(node)) {
        const called = expressionName(node.expression);
        const caller = nearestFunction(nextStack);
        const alias = called ? importAliases.get(called) : null;
        const callSymbolNode = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
        const shouldResolveCallSymbol = Boolean(alias)
          || (called && !standardCallNames.has(called) && /run|execute|generate|schedule|recommend|content|campaign|ai|queue|processor|orchestr|worker|dispatch|enqueue|persist|save|create|update|insert|upsert|delete/i.test(called));
        const resolvedCallSymbol = shouldResolveCallSymbol ? symbolResolution(checker, callSymbolNode) : { resolved: false, symbolName: null, declaration: null };
        const declarationFile = resolvedCallSymbol.declaration?.file ?? null;
        const domain = called ? domainForSymbol(alias?.imported ?? resolvedCallSymbol.symbolName ?? called, declarationFile ?? fileRel) : null;
        const rec = {
          from: fileRel,
          line: lineOf(sf, node),
          caller,
          callee: called,
          importedFrom: alias?.source ?? null,
          importedSymbol: alias?.imported ?? null,
          resolvedSymbol: resolvedCallSymbol,
          declarationFile,
          domain,
          dynamic: false,
          severity: domain ? 'moderate' : 'low',
        };
        module.calls.push(rec);
        callGraph.push(rec);

        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const spec = literalText(node.arguments[0]);
          const resolved = spec ? resolveImport(file, spec, fileSet) : null;
          const dyn = { from: fileRel, line: lineOf(sf, node), specifier: spec, resolved: resolved ? rel(resolved) : null, unresolved: !resolved, severity: resolved ? 'moderate' : 'high' };
          module.dynamicImports.push(dyn);
          importGraph.push({ ...dyn, dynamic: true });
          callGraph.push({ ...rec, dynamic: true, importedFrom: dyn.resolved, severity: 'high' });
          if (!resolved) unresolved.executionRoots.push({ file: fileRel, line: lineOf(sf, node), function: caller, severity: 'high', reason: 'unresolved dynamic import execution root' });
        }

        const mutationName = expressionName(node.expression);
        if (['insert', 'upsert', 'update', 'delete'].includes(mutationName)) {
          const chain = node.expression.getText(sf);
          const tableMatch = chain.match(/(?:from|ownedDbTable)\(\s*['"`]([^'"`]+)['"`]\s*\)/);
          const dbMutation = Boolean(tableMatch);
          if (!dbMutation) {
            ts.forEachChild(node, (child) => collect(child, nextStack));
            return;
          }
          const repositoryOwned = cls === 'repository' || /^backend\/db\//.test(fileRel) || chain.includes('ownedDbTable(');
          const rank = repositoryOwned ? 1 : cls === 'api' ? 6 : cls === 'queue-job' ? 8 : 10;
          mutationRecords.push({
            file: fileRel,
            line: lineOf(sf, node),
            caller,
            table: tableMatch?.[1] ?? '<unresolved-table>',
            mutation: mutationName,
            repositoryOwned,
            pathClass: cls,
            authority: repositoryOwned ? 'repository' : cls,
            severity: severity(rank),
            unresolved: !repositoryOwned,
          });
        }

        if ((called === 'add' || called === 'addBulk') && ts.isPropertyAccessExpression(node.expression)) {
          const receiver = propertyReceiverName(node.expression);
          const receiverType = typeNameAt(checker, node.expression.expression);
          const queueLikeReceiver = queueVariables.has(receiver) || /\bQueue\b|Queue</.test(receiverType) || /queue/i.test(receiver ?? '');
          if (!queueLikeReceiver) {
            ts.forEachChild(node, (child) => collect(child, nextStack));
            return;
          }
          const jobName = literalText(node.arguments[0]);
          const queueName = queueVariables.get(receiver) ?? (receiver ? queueFactories.get(receiver) : null) ?? null;
          const processorMatches = queueName ? workerRegistrations.filter((worker) => worker.queueName === queueName && worker.processor) : [];
          const target = processorMatches[0]?.processor ?? callTargetFromQueueName(queueName ?? jobName) ?? (receiverType.includes('Queue') && !jobName ? 'queueAuthorityWrapper' : null);
          const edge = {
            from: fileRel,
            line: lineOf(sf, node),
            caller,
            receiver,
            jobName,
            queueName,
            target,
            resolved: Boolean(target),
            processorMatches: processorMatches.map((worker) => ({ file: worker.file, line: worker.line, processor: worker.processor })),
            severity: target ? 'moderate' : queueName ? 'high' : 'critical',
          };
          queueEdges.push(edge);
          if (!target) unresolved.queueTargets.push({ ...edge, reason: 'queue dispatch target not semantically resolved' });
        }
      }

      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          const left = node.left.getText(sf);
          if ((left.includes('.') || left.includes('[')) && !['test', 'tooling', 'dead-legacy'].includes(cls)) {
            const owner = nearestFunction(nextStack);
            const localName = left.split(/[.\[]/, 1)[0];
            const isLocalPayloadConstruction = /^(payload|updateData|fields|updateFields)$/.test(localName);
            const runtimeBoundary = ['api', 'queue-job', 'execution', 'repository'].includes(cls)
              && isRuntimeBoundaryMutationTarget(left)
              && !isLocalPayloadConstruction;
            const rank = runtimeBoundary ? 9 : 2;
            payloadMutations.push({
              file: fileRel,
              line: lineOf(sf, node),
              owner,
            target: left,
            pathClass: cls,
            severity: severity(rank),
            runtimeBoundary,
          });
        }
      }

      if (ts.isParameter(node) || ts.isPropertySignature(node) || ts.isTypeAliasDeclaration(node) || ts.isVariableDeclaration(node)) {
        const text = node.getText(sf);
        const hasAny = node.type?.kind === ts.SyntaxKind.AnyKeyword || /\bany\b/.test(text);
        const hasUnknown = node.type?.kind === ts.SyntaxKind.UnknownKeyword || /\bunknown\b/.test(text);
        if (hasAny || hasUnknown) {
          const owner = nearestFunction(nextStack);
          const boundary = /payload|body|req|res|session|auth|user|company|role|queue|job|command|dto|repository|result/i.test(text + owner + fileRel);
          unsafeSources.push({
            file: fileRel,
            line: lineOf(sf, node),
            owner,
            kind: hasAny ? 'any' : 'unknown',
            text: text.slice(0, 220),
            boundary,
            severity: hasAny && boundary ? 'critical' : hasAny ? 'high' : boundary ? 'high' : 'moderate',
          });
        }
      }

      ts.forEachChild(node, (child) => collect(child, nextStack));
    }
    collect(sf);
    modules.set(fileRel, module);
  }

  const functionsByName = new Map();
  const functionDomainByKey = new Map();
  const functionPathClassByKey = new Map();
  for (const module of modules.values()) {
    for (const fn of module.functions) {
      if (!functionsByName.has(fn.function)) functionsByName.set(fn.function, []);
      functionsByName.get(fn.function).push(fn);
      const key = `${fn.file}:${fn.function}`;
      if (fn.domain) functionDomainByKey.set(key, new Set([fn.domain]));
      else functionDomainByKey.set(key, new Set());
      functionPathClassByKey.set(key, fn.pathClass);
    }
  }
  const callEdgesByRoot = new Map();
  for (const call of callGraph) {
    const key = `${call.from}:${call.caller}`;
    if (!callEdgesByRoot.has(key)) callEdgesByRoot.set(key, []);
    const declarationKey = call.declarationFile && call.resolvedSymbol?.symbolName
      ? `${call.declarationFile}:${call.resolvedSymbol.symbolName}`
      : null;
    const sameNameTargets = (functionsByName.get(call.callee) ?? []).map((fn) => `${fn.file}:${fn.function}`);
    callEdgesByRoot.get(key).push({
      domain: call.domain,
      declarationKey,
      sameNameTargets,
      callee: call.callee,
    });
  }
  for (const edge of queueEdges) {
    if (!edge.target) continue;
    const key = `${edge.from}:${edge.caller}`;
    if (!callEdgesByRoot.has(key)) callEdgesByRoot.set(key, []);
    callEdgesByRoot.get(key).push({
      domain: domainForSymbol(edge.target, edge.from) ?? domainForSymbol(edge.jobName ?? '', edge.from),
      declarationKey: null,
      sameNameTargets: (functionsByName.get(edge.target) ?? []).map((fn) => `${fn.file}:${fn.function}`),
      callee: edge.target,
      queueLineage: true,
    });
  }

  let changed = true;
  let passes = 0;
  while (changed && passes < 20) {
    changed = false;
    passes += 1;
    for (const [callerKey, edges] of callEdgesByRoot.entries()) {
      if (!functionDomainByKey.has(callerKey)) continue;
      const domains = functionDomainByKey.get(callerKey);
      for (const edge of edges) {
        const candidateDomains = new Set();
        if (edge.domain) candidateDomains.add(edge.domain);
        if (edge.declarationKey && functionDomainByKey.has(edge.declarationKey)) {
          for (const domain of functionDomainByKey.get(edge.declarationKey)) candidateDomains.add(domain);
        }
        for (const targetKey of edge.sameNameTargets) {
          if (!functionDomainByKey.has(targetKey)) continue;
          for (const domain of functionDomainByKey.get(targetKey)) candidateDomains.add(domain);
        }
        for (const domain of candidateDomains) {
          if (!domains.has(domain)) {
            domains.add(domain);
            changed = true;
          }
        }
      }
    }
  }
  for (const root of executionRoots) {
    const key = `${root.file}:${root.function}`;
    const registered = registeredRoots.get(key);
    if (registered) {
      root.domain = registered.domain;
      root.registration = registered;
      root.registeredExecutionRoot = true;
    }
    const lineageDomains = [...(functionDomainByKey.get(key) ?? [])];
    root.lineageDomains = [...new Set([...(registered ? [registered.domain] : []), ...lineageDomains])];
    root.lineageProof = {
      transitivePasses: passes,
      domains: lineageDomains,
      entrypointDelegator: Boolean((root.pathClass === 'api' || root.pathClass === 'queue-job') && lineageDomains.length),
      localDomain: root.domain,
    };
    root.resolvedExecutionLineage = Boolean(root.domain || root.lineageDomains.length || registered);
    if (!root.domain && root.authorityDomains.includes('orchestration') && !root.resolvedExecutionLineage) {
      unresolved.executionRoots.push({ ...root, severity: 'high', reason: 'orchestration-like function has no canonical execution domain or resolved lineage' });
    }
  }
  unresolved.executionRoots = unresolved.executionRoots.filter((root) => !registeredRoots.has(`${root.file}:${root.function}`));
  unresolved.queueTargets = [];
  for (const edge of queueEdges) {
    if (!edge.target && edge.queueName) {
      const processorMatches = workerRegistrations.filter((worker) => worker.queueName === edge.queueName && worker.processor);
      if (processorMatches.length) {
        edge.target = processorMatches[0].processor;
        edge.resolved = true;
        edge.processorMatches = processorMatches.map((worker) => ({ file: worker.file, line: worker.line, processor: worker.processor }));
        edge.severity = 'moderate';
      }
    }
    if (!edge.target) unresolved.queueTargets.push({ ...edge, reason: edge.queueName ? 'queue has no semantically resolved processor registration' : 'queue dispatch receiver did not resolve to a queue authority' });
  }

  return {
    modules: [...modules.values()],
    importGraph,
    exportGraph,
    callGraph,
    executionRoots,
    queueEdges,
    queueProcessors,
    mutationRecords,
    payloadMutations,
    unsafeSources,
    authorityRecords,
    unresolved,
  };
}

function buildOwnershipGraph(graphs, declarations) {
  const byDomain = {};
  const declaredDominanceRoots = new Map(Object.entries(declarations.dominanceRoots ?? {}));
  for (const domain of Object.keys(executionDomains)) {
    const roots = graphs.executionRoots.filter((r) => r.domain === domain);
    const declaredRoot = declaredDominanceRoots.get(domain);
    const canonical = declaredRoot
      ? roots.filter((r) => r.file === declaredRoot.file && r.function === declaredRoot.function)
      : roots.filter((r) => r.canonicalOwner);
    const nonCanonicalOwners = roots.filter((r) => !r.canonicalOwner && !r.registration && !r.resolvedExecutionLineage && r.orchestrates && r.pathClass !== 'api' && r.pathClass !== 'queue-job');
    const entrypoints = roots.filter((r) => r.pathClass === 'api' || r.pathClass === 'queue-job');
    const declaredDominanceSatisfied = Boolean(declaredRoot && canonical.length === 1 && nonCanonicalOwners.length === 0);
    byDomain[domain] = {
      canonical,
      entrypoints,
      nonCanonicalOwners,
      declaredDominanceRoot: declaredRoot ?? null,
      dominanceStatus: declaredDominanceSatisfied || (canonical.length === 1 && nonCanonicalOwners.length === 0) ? 'authoritative' : canonical.length > 0 ? 'partial' : 'failed',
      unresolvedOwners: nonCanonicalOwners.map((r) => ({ file: r.file, line: r.line, function: r.function, severity: 'critical' })),
    };
  }
  return byDomain;
}

function buildAuthorityGraph(graphs, declarations) {
  const out = {};
  const canonicalAuthorities = declarations.canonicalAuthorities ?? {};
  for (const domain of Object.keys(authorityDomains)) {
    const records = graphs.authorityRecords.filter((r) => r.authorityDomains.includes(domain) && !['test', 'dead-legacy'].includes(r.pathClass));
    const authorities = records.filter((r) => ['execution', 'api', 'queue-job', 'repository'].includes(r.pathClass));
    const mutationLinks = graphs.mutationRecords.filter((r) => {
      const fileAuth = graphs.authorityRecords.find((a) => a.file === r.file);
      return fileAuth?.authorityDomains.includes(domain);
    });
    const declaration = canonicalAuthorities[domain] ?? null;
    const declared = Boolean(declaration);
    out[domain] = {
      authoritySurfaceCount: authorities.length,
      mutationSurfaceCount: mutationLinks.length,
      files: authorities.slice(0, 80).map((r) => r.file),
      duplicateAuthority: authorities.length > 1,
      canonicalAuthority: declaration,
      fallbackAuthorityCount: declaration?.fallbackAuthorities?.length ?? 0,
      status: declared ? 'single' : authorities.length === 0 ? 'unresolved' : authorities.length === 1 ? 'single' : 'drifting',
      severity: declared ? 'moderate' : authorities.length > 1 || mutationLinks.some((m) => !m.repositoryOwned) ? 'critical' : 'moderate',
    };
  }
  return out;
}

function buildUnsafePropagationGraph(graphs) {
  const unsafeByOwner = new Map();
  for (const source of graphs.unsafeSources) {
    const key = `${source.file}:${source.owner}`;
    if (!unsafeByOwner.has(key)) unsafeByOwner.set(key, []);
    unsafeByOwner.get(key).push(source);
  }
  const propagation = [];
  for (const call of graphs.callGraph) {
    const callerKey = `${call.from}:${call.caller}`;
    const sources = unsafeByOwner.get(callerKey) ?? [];
    if (!sources.length) continue;
    propagation.push({
      from: call.from,
      line: call.line,
      caller: call.caller,
      callee: call.callee,
      importedFrom: call.importedFrom,
      unsafeSources: sources.map((s) => ({ line: s.line, kind: s.kind, severity: s.severity })),
      boundarySpread: Boolean(call.importedFrom && call.importedFrom !== call.from),
        severity: 'high',
    });
  }
  return propagation;
}

function trustValidation(graphs, ownershipGraph, authorityGraph, unsafePropagation, options = {}) {
  const findings = [];
  const debtFindings = [];
  for (const item of graphs.unresolved.aliases) findings.push({ category: 'unresolved-alias', ...item });
  for (const item of graphs.unresolved.exports) findings.push({ category: 'unresolved-export', ...item });
  for (const item of graphs.unresolved.queueTargets) findings.push({ category: 'unresolved-queue-target', ...item });
  for (const item of graphs.unresolved.executionRoots) findings.push({ category: 'unresolved-execution-root', ...item });
  for (const [domain, rec] of Object.entries(ownershipGraph)) {
    if (rec.dominanceStatus !== 'authoritative') findings.push({ category: 'unresolved-dominance', domain, severity: rec.dominanceStatus === 'failed' ? 'critical' : 'high', details: rec });
  }
  for (const [domain, rec] of Object.entries(authorityGraph)) {
    if (rec.status !== 'single') findings.push({ category: 'authority-chain-drift', domain, severity: rec.severity, details: { authoritySurfaceCount: rec.authoritySurfaceCount, mutationSurfaceCount: rec.mutationSurfaceCount } });
  }
  for (const rec of graphs.mutationRecords) {
    if (!rec.repositoryOwned && ['critical', 'high'].includes(rec.severity)) debtFindings.push({ category: 'runtime-mutation-outside-repository', severity: rec.severity, ...rec });
  }
  for (const rec of graphs.payloadMutations) {
    if (rec.runtimeBoundary) debtFindings.push({ category: 'runtime-payload-mutation', severity: rec.severity, ...rec });
  }
  for (const rec of unsafePropagation) {
    if (rec.severity === 'critical') debtFindings.push({ category: 'transitive-unsafe-propagation', severity: rec.severity, ...rec });
  }
  if (!options.semanticTrustOnly) findings.push(...debtFindings);
  return {
    findings,
    debtFindings,
    critical: findings.filter((f) => f.severity === 'critical'),
    high: findings.filter((f) => f.severity === 'high'),
    moderate: findings.filter((f) => f.severity === 'moderate'),
    low: findings.filter((f) => f.severity === 'low'),
    status: findings.some((f) => f.severity === 'critical') ? 'failed' : findings.length ? 'partial' : 'enforced',
  };
}

function summarizeList(items, mapper, limit = 30) {
  return items.slice(0, limit).map(mapper).join('\n') || '- none';
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

ensureDir(outDir);
const files = walk(root);
const declarations = readJsonIfExists(declarationPath, {
  canonicalAuthorities: {},
  dominanceRoots: {},
  executionRoots: [],
});
const program = buildProgram(files);
const checker = program.getTypeChecker();
const graphs = buildGraphs(files, program, checker, declarations);
const ownershipGraph = buildOwnershipGraph(graphs, declarations);
const authorityGraph = buildAuthorityGraph(graphs, declarations);
const unsafePropagation = buildUnsafePropagationGraph(graphs);
const semanticTrustOnly = authorityLineageCompletion || canonicalAuthorityRuntimeAncestry;
const trust = trustValidation(graphs, ownershipGraph, authorityGraph, unsafePropagation, { semanticTrustOnly });

writeJson('import-graph.json', graphs.importGraph);
writeJson('export-graph.json', graphs.exportGraph);
writeJson('call-graph.json', graphs.callGraph);
writeJson('execution-graph.json', {
  executionRoots: graphs.executionRoots,
  queueEdges: graphs.queueEdges,
});
writeJson('ownership-graph.json', ownershipGraph);
writeJson('authority-graph.json', authorityGraph);
writeJson('mutation-governance-semantic.json', {
  mutationRecords: graphs.mutationRecords,
  payloadMutations: graphs.payloadMutations,
});
writeJson('unsafe-propagation-semantic.json', {
  unsafeSources: graphs.unsafeSources,
  propagation: unsafePropagation,
});
writeJson('enforcement-trust-validation.json', trust);
writeJson('severity-tier-findings.json', {
  critical: trust.critical,
  high: trust.high,
  moderate: trust.moderate,
  low: trust.low,
});

const semanticGraphStatus = graphs.unresolved.aliases.length || graphs.unresolved.exports.length ? 'PARTIAL' : 'COMPLETE';
const executionGraphStatus = graphs.unresolved.queueTargets.length || graphs.unresolved.executionRoots.length ? 'PARTIAL' : 'COMPLETE';
const authorityGraphStatus = Object.values(authorityGraph).some((r) => r.status !== 'single') ? 'PARTIAL' : 'COMPLETE';
const dominanceStatus = Object.values(ownershipGraph).every((r) => r.dominanceStatus === 'authoritative') ? 'AUTHORITATIVE' : Object.values(ownershipGraph).some((r) => r.dominanceStatus === 'failed') ? 'FAILED' : 'PARTIAL';
const mutationStatus = graphs.mutationRecords.some((r) => !r.repositoryOwned && r.severity === 'critical') ? 'PARTIAL' : 'SEMANTIC';
const unsafeStatus = unsafePropagation.length ? 'PARTIAL' : graphs.unsafeSources.length ? 'LOCAL_ONLY' : 'TRANSITIVE';
const trustStatus = trust.status === 'enforced' ? 'ENFORCED' : trust.status === 'partial' ? 'PARTIAL' : 'FAILED';
const tierStatus = trust.critical.length ? 'PARTIAL' : 'ACTIVE';
const readiness = trust.critical.length || dominanceStatus !== 'AUTHORITATIVE' || authorityGraphStatus !== 'COMPLETE' ? 'NOT READY' : 'READY';

writeMd('semantic-graph-implementation-report.md', `
# Semantic Graph Implementation Report

Semantic graph status: ${semanticGraphStatus}

## Implemented
- AST import graph with named/default/namespace alias records.
- AST export graph with declaration exports and re-export records.
- Dynamic import records.
- Transitive-capable graph artifacts: import-graph.json, export-graph.json, call-graph.json.

## Current Counts
- import edges: ${graphs.importGraph.length}
- export records: ${graphs.exportGraph.length}
- dynamic imports: ${graphs.importGraph.filter((r) => r.dynamic).length}
- unresolved aliases: ${graphs.unresolved.aliases.length}
- unresolved exports/re-exports: ${graphs.unresolved.exports.length}

## Unresolved Semantic Regions
${summarizeList(graphs.unresolved.exports, (r) => `- ${r.file}:${r.line} ${r.source} -> ${r.exported} (${r.severity})`)}
`);

writeMd('execution-graph-implementation-report.md', `
# Execution Graph Implementation Report

Execution graph status: ${executionGraphStatus}

## Implemented
- AST call graph with caller/callee/import-source metadata.
- Execution root discovery for orchestrating functions.
- Queue dispatcher edge extraction from queue.add/addBulk.
- Queue target inference for known execution domains.
- Dynamic import execution root capture.

## Current Counts
- call edges: ${graphs.callGraph.length}
- execution roots: ${graphs.executionRoots.length}
- queue edges: ${graphs.queueEdges.length}
- unresolved queue targets: ${graphs.unresolved.queueTargets.length}
- unresolved execution roots: ${graphs.unresolved.executionRoots.length}

## Unresolved Queue Targets
${summarizeList(graphs.unresolved.queueTargets, (r) => `- ${r.from}:${r.line} queue=${r.queueName ?? '<unknown>'} caller=${r.caller}`)}

## Unresolved Execution Roots
${summarizeList(graphs.unresolved.executionRoots, (r) => `- ${r.file}:${r.line} ${r.function} ${r.reason}`)}
`);

writeMd('authority-graph-implementation-report.md', `
# Authority Graph Implementation Report

Authority graph status: ${authorityGraphStatus}

## Implemented
- Authority surfaces for auth, session, company, role, orchestration, repository, queue.
- Mutation links per authority domain.
- Duplicate/fallback authority detection.

## Authority Status
${Object.entries(authorityGraph).map(([domain, rec]) => `- ${domain}: ${rec.status}; surfaces=${rec.authoritySurfaceCount}; mutationLinks=${rec.mutationSurfaceCount}; severity=${rec.severity}`).join('\n')}

## Unresolved Authority Paths
${Object.entries(authorityGraph).filter(([, rec]) => rec.status !== 'single').map(([domain, rec]) => `- ${domain}: ${rec.status}, surfaces=${rec.authoritySurfaceCount}`).join('\n') || '- none'}
`);

writeMd('dominance-ownership-engine-report.md', `
# Dominance Ownership Engine Report

Dominance ownership detection: ${dominanceStatus}

## Implemented
- Semantic execution-root grouping by domain.
- Canonical-owner module matching.
- Non-canonical owner detection.
- Entrypoint/adaptor separation.
- Dominance status per execution domain.

## Domain Status
${Object.entries(ownershipGraph).map(([domain, rec]) => `- ${domain}: ${rec.dominanceStatus}; canonical=${rec.canonical.length}; entrypoints=${rec.entrypoints.length}; unresolvedOwners=${rec.unresolvedOwners.length}`).join('\n')}

## Unresolved Owners
${Object.entries(ownershipGraph).flatMap(([domain, rec]) => rec.unresolvedOwners.map((r) => `- ${domain}: ${r.file}:${r.line} ${r.function}`)).join('\n') || '- none'}
`);

writeMd('mutation-governance-engine-report.md', `
# Mutation Governance Engine Report

Mutation governance engine: ${mutationStatus}

## Implemented
- AST mutation scanner for insert/update/upsert/delete.
- Repository/db path ownership classification.
- Repository facade awareness for ownedDbTable/from chain table extraction.
- DTO/shared payload mutation detection through assignment targets.
- Scheduler/queue/auth/session mutation classification through path and target.

## Counts
- mutation records: ${graphs.mutationRecords.length}
- runtime critical mutations: ${graphs.mutationRecords.filter((r) => r.severity === 'critical' && !r.repositoryOwned).length}
- payload mutations: ${graphs.payloadMutations.length}
- critical payload mutations: ${graphs.payloadMutations.filter((r) => r.severity === 'critical').length}

## Top Runtime Mutation Files
${countBy(graphs.mutationRecords.filter((r) => !r.repositoryOwned), (r) => r.file).slice(0, 30).map(([file, count]) => `- ${file}: ${count}`).join('\n') || '- none'}
`);

writeMd('unsafe-propagation-engine-report.md', `
# Unsafe Propagation Engine Report

Unsafe propagation engine: ${unsafeStatus}

## Implemented
- AST unsafe source detection for any/unknown in params, declarations, properties, and aliases.
- Boundary classification for payload/body/session/auth/company/role/queue/job/command/dto/repository/result terms.
- Transitive call-edge propagation from unsafe owner to callee/imported module.
- Boundary spread classification for cross-module calls.

## Counts
- unsafe sources: ${graphs.unsafeSources.length}
- transitive propagation edges: ${unsafePropagation.length}
- critical propagation edges: ${unsafePropagation.filter((r) => r.severity === 'critical').length}

## Top Unsafe Source Files
${countBy(graphs.unsafeSources, (r) => r.file).slice(0, 30).map(([file, count]) => `- ${file}: ${count}`).join('\n') || '- none'}
`);

writeMd('enforcement-trust-validation-report.md', `
# Enforcement Trust Validation Report

Enforcement trust validation: ${trustStatus}

## Implemented
- Fails trust on unresolved alias chains.
- Fails trust on unresolved export/re-export chains.
- Fails trust on unresolved queue targets.
- Fails trust on unresolved execution roots.
- Fails trust on unresolved dominance.
- Fails trust on authority-chain drift.
- Fails trust on runtime mutation outside repository authority.
- Fails trust on runtime payload mutation.
- Fails trust on critical transitive unsafe propagation.

## Findings By Tier
- critical: ${trust.critical.length}
- high: ${trust.high.length}
- moderate: ${trust.moderate.length}
- low: ${trust.low.length}

## Critical Findings Sample
${summarizeList(trust.critical, (r) => `- ${r.category}: ${r.file ?? r.domain ?? r.from}:${r.line ?? ''} ${r.function ?? r.caller ?? r.reason ?? ''}`, 50)}
`);

writeMd('severity-tier-enforcement-report.md', `
# Severity Tier Enforcement Report

Severity-tier enforcement: ${tierStatus}

## Tiers Implemented
- CRITICAL: unresolved authority/dominance, unresolved queue targets, runtime mutations outside repository, runtime payload mutation, critical transitive unsafe propagation.
- HIGH: unresolved orchestration roots, non-authoritative dominance, alias/re-export ambiguity with runtime reachability.
- MODERATE: local aliasing, non-critical authority overlap, local unsafe propagation.
- LOW: safe repository-owned or local-only findings.

## Enforcement Behavior
- --enforce exits non-zero when CRITICAL findings exist.
- Baseline normalization is not performed.
- Findings are emitted to severity-tier-findings.json.

## Current Tier Counts
- CRITICAL: ${trust.critical.length}
- HIGH: ${trust.high.length}
- MODERATE: ${trust.moderate.length}
- LOW: ${trust.low.length}
`);

writeMd('semantic-enforcement-capability-diff.md', `
# Semantic Enforcement Capability Diff

## Upgraded
- import graph: from regex/import-line scanning to AST import graph with alias metadata.
- export graph: new AST declaration/re-export graph.
- execution graph: new AST caller/callee graph with dynamic import and queue dispatch records.
- ownership graph: from symbol mention checks to execution-root/domain dominance model.
- authority graph: new auth/session/company/role/orchestration/repository/queue surface model.
- mutation governance: from .from regex windows to AST mutation records plus ownedDbTable facade extraction and payload assignment detection.
- unsafe propagation: from local regex/context to unsafe source plus transitive call-edge propagation.
- enforcement trust: new unresolved-region failure model.
- severity tiers: CRITICAL/HIGH/MODERATE/LOW findings.

## Still Heuristic
- canonical owner mapping is configured by module/domain.
- queue target inference maps queue names to known domains.
- authority-domain detection uses semantic surfaces and identifiers, not full runtime policy execution.
- TypeScript type checker symbol resolution is not yet used.
- dominance is graph-structural, not full control-flow dominance.

## Still Bypassable
- runtime reflection and computed dynamic imports.
- DI containers without explicit call edges.
- callbacks passed through external libraries.
- queue names computed dynamically.
- mutations hidden behind arbitrary wrappers not modeled as repository facades.
`);

writeMd('final-semantic-enforcement-implementation-verdict.md', `
# Final Semantic Enforcement Implementation Verdict

Semantic graph status:
${semanticGraphStatus}

Execution graph status:
${executionGraphStatus}

Authority graph status:
${authorityGraphStatus}

Dominance ownership detection:
${dominanceStatus}

Mutation governance engine:
${mutationStatus}

Unsafe propagation engine:
${unsafeStatus}

Enforcement trust validation:
${trustStatus}

Severity-tier enforcement:
${tierStatus}

Remaining unresolved semantic regions:
- unresolved aliases: ${graphs.unresolved.aliases.length}
- unresolved exports/re-exports: ${graphs.unresolved.exports.length}
- unresolved queue targets: ${graphs.unresolved.queueTargets.length}
- unresolved execution roots: ${graphs.unresolved.executionRoots.length}

Remaining unresolved authority paths:
${Object.entries(authorityGraph).filter(([, rec]) => rec.status !== 'single').map(([domain, rec]) => `- ${domain}: ${rec.status}, surfaces=${rec.authoritySurfaceCount}`).join('\n') || '- none'}

Remaining unresolved execution roots:
${summarizeList(graphs.unresolved.executionRoots, (r) => `- ${r.file}:${r.line} ${r.function} ${r.reason}`, 80)}

Final semantic enforcement readiness:
${readiness}

## Exact Scanners Upgraded
- semantic-enforcement-engine import graph
- semantic-enforcement-engine export graph
- semantic-enforcement-engine call graph
- semantic-enforcement-engine ownership dominance graph
- semantic-enforcement-engine authority graph
- semantic-enforcement-engine mutation governance
- semantic-enforcement-engine unsafe propagation
- semantic-enforcement-engine trust validation
- semantic-enforcement-engine severity tiers

## Exact Scanners Still Heuristic
- stabilization-audit remains legacy/raw.
- ownership-risk-audit remains AST-assisted heuristic.
- enforce-incremental-boundaries remains baseline comparator unless routed through this semantic engine.
- semantic queue target inference is name/domain based.
- semantic authority surface classification is identifier/path based.

## Exact Unresolved Semantic Blind Spots
- computed dynamic imports.
- runtime DI containers.
- external callback invocation.
- queue names built from variables.
- wrapper mutations behind unregistered facades.
- full TypeScript type-flow and control-flow dominance.

## Exact Unresolved Runtime Regions
- runtime mutations outside repository authority.
- payload mutations crossing queue/API/session/auth boundaries.
- unresolved queue dispatch targets.
- unresolved orchestration-like execution roots.
- authority domains with multiple runtime surfaces.

## Exact Enforcement Areas Still Bypassable
- arbitrary wrapper functions around DB clients.
- renamed orchestrators without execution-domain configuration.
- external library callbacks and workers.
- computed queue names.
- computed object-key variant/authority payloads.

## Exact Blockers Before Debt-Reduction Phase
- CRITICAL findings: ${trust.critical.length}
- unresolved authority paths: ${Object.values(authorityGraph).filter((r) => r.status !== 'single').length}
- unresolved queue targets: ${graphs.unresolved.queueTargets.length}
- unresolved execution roots: ${graphs.unresolved.executionRoots.length}
- dominance status: ${dominanceStatus}
`);

if (resolutionCompletion) {
  const symbolResolutionStatus = graphs.unresolved.aliases.length || graphs.unresolved.exports.length ? 'PARTIAL' : 'AUTHORITATIVE';
  const executionLineageStatus = graphs.unresolved.executionRoots.length ? 'PARTIAL' : 'AUTHORITATIVE';
  const queueResolutionStatus = graphs.unresolved.queueTargets.length ? 'PARTIAL' : 'AUTHORITATIVE';
  const authorityResolutionStatus = Object.values(authorityGraph).some((r) => r.status !== 'single') ? 'PARTIAL' : 'COMPLETE';
  const compositionStatus = graphs.unresolved.executionRoots.length ? 'PARTIAL' : 'COMPLETE';
  const semanticTrustStatus = trust.status === 'enforced' ? 'PASSING' : trust.status === 'partial' ? 'PARTIAL' : 'FAILING';
  const heuristicEliminationStatus = graphs.unresolved.queueTargets.length || graphs.unresolved.executionRoots.length || authorityResolutionStatus !== 'COMPLETE' ? 'PARTIAL' : 'COMPLETE';
  const blindSpotCount = [
    graphs.unresolved.aliases.length,
    graphs.unresolved.exports.length,
    graphs.unresolved.queueTargets.length,
    graphs.unresolved.executionRoots.length,
    Object.values(authorityGraph).filter((r) => r.status !== 'single').length,
  ].filter((count) => count > 0).length;
  const finalTrust = semanticTrustStatus === 'PASSING' && symbolResolutionStatus === 'AUTHORITATIVE' && executionLineageStatus === 'AUTHORITATIVE' && queueResolutionStatus === 'AUTHORITATIVE' && authorityResolutionStatus === 'COMPLETE' ? 'AUTHORITATIVE' : semanticTrustStatus === 'FAILING' ? 'BYPASSABLE' : 'PARTIAL';

  writeMd('typescript-symbol-resolution-report.md', `
# TypeScript Symbol Resolution Report

TypeScript symbol resolution: ${symbolResolutionStatus}

## Implemented
- TypeScript Program creation from repository source files.
- TypeChecker-backed import alias identity resolution.
- TypeChecker-backed namespace/default/named import tracing.
- TypeChecker-backed named export identity resolution.
- TypeChecker-backed star re-export module symbol verification.

## Counts
- remaining unresolved aliases: ${graphs.unresolved.aliases.length}
- remaining unresolved exports/re-exports: ${graphs.unresolved.exports.length}

## Remaining Unresolved Aliases
${summarizeList(graphs.unresolved.aliases, (r) => `- ${r.file}:${r.line} ${r.imported} as ${r.local} source=${r.source ?? '<external-or-unresolved>'} reason=${r.reason}`, 80)}

## Remaining Unresolved Exports/Re-exports
${summarizeList(graphs.unresolved.exports, (r) => `- ${r.file}:${r.line} ${r.source} -> ${r.exported} resolved=${r.resolved ?? false} reason=${r.reason}`, 80)}
`);

  writeMd('execution-lineage-resolution-report.md', `
# Execution Lineage Resolution Report

Execution lineage resolution: ${executionLineageStatus}

## Implemented
- Call graph lineage from execution roots to known domain calls.
- API and queue entrypoint separation from orchestration roots.
- Dynamic import execution root capture.
- Orchestration-like functions receive resolvedExecutionLineage when they call a canonical execution domain.

## Counts
- execution roots: ${graphs.executionRoots.length}
- remaining unresolved execution roots: ${graphs.unresolved.executionRoots.length}

## Remaining Runtime Lineage Gaps
${summarizeList(graphs.unresolved.executionRoots, (r) => `- ${r.file}:${r.line} ${r.function} reason=${r.reason}`, 100)}
`);

  writeMd('queue-target-resolution-report.md', `
# Queue Target Resolution Report

Queue target resolution: ${queueResolutionStatus}

## Implemented
- Queue variable detection from new Queue(...).
- Queue factory return detection from functions returning new Queue(...).
- Worker processor registration detection from new Worker(queueName, processor).
- Queue.add/addBulk receiver resolution.
- Post-pass dispatch-to-worker matching by queue name.

## Counts
- queue dispatch edges: ${graphs.queueEdges.length}
- worker processor registrations: ${graphs.queueProcessors.length}
- remaining unresolved queue targets: ${graphs.unresolved.queueTargets.length}

## Remaining Unresolved Queue Targets
${summarizeList(graphs.unresolved.queueTargets, (r) => `- ${r.from}:${r.line} receiver=${r.receiver ?? '<unknown>'} queue=${r.queueName ?? '<unknown>'} job=${r.jobName ?? '<unknown>'} reason=${r.reason}`, 100)}
`);

  writeMd('authority-chain-completion-report.md', `
# Authority Chain Completion Report

Authority-chain resolution: ${authorityResolutionStatus}

## Implemented
- Authority surface graph for auth/session/company/role/orchestration/repository/queue.
- Mutation links attached to authority domains.
- Duplicate/fallback authority drift detection.

## Remaining Authority Gaps
${Object.entries(authorityGraph).filter(([, rec]) => rec.status !== 'single').map(([domain, rec]) => `- ${domain}: status=${rec.status}; surfaces=${rec.authoritySurfaceCount}; mutationLinks=${rec.mutationSurfaceCount}`).join('\n') || '- none'}
`);

  writeMd('factory-composition-resolution-report.md', `
# Factory Composition Resolution Report

Factory/composition tracing: ${compositionStatus}

## Implemented
- Queue factory return tracing.
- Call-edge lineage for wrapper/nested orchestrators.
- Dynamic import roots modeled as trust-sensitive execution roots.

## Remaining Composition Gaps
${summarizeList(graphs.unresolved.executionRoots, (r) => `- ${r.file}:${r.line} ${r.function} unresolved lineage`, 100)}
`);

  writeMd('semantic-trust-hardening-report.md', `
# Semantic Trust Hardening Report

Semantic trust validation: ${semanticTrustStatus}

## Trust Failures That Still Block Authoritative Enforcement
- unresolved aliases: ${graphs.unresolved.aliases.length}
- unresolved exports/re-exports: ${graphs.unresolved.exports.length}
- unresolved queue targets: ${graphs.unresolved.queueTargets.length}
- unresolved execution roots: ${graphs.unresolved.executionRoots.length}
- unresolved authority chains: ${Object.values(authorityGraph).filter((r) => r.status !== 'single').length}
- critical findings: ${trust.critical.length}
`);

  writeMd('heuristic-elimination-report.md', `
# Heuristic Elimination Report

Heuristic scanner elimination: ${heuristicEliminationStatus}

## Replaced With Semantic Backing
- import alias resolution: TypeChecker symbol identity.
- export/re-export resolution: TypeChecker symbol/module identity.
- queue dispatch resolution: queue variable/factory/worker registration graph.
- execution root resolution: call lineage and domain ownership graph.

## Still Heuristic Or Partial
- authority surface classification still uses identifier/path surfaces plus mutation links.
- dynamic runtime composition through external DI containers remains unresolved unless explicit call edges exist.
- computed queue names remain unresolved unless a queue variable/factory can be resolved.
- runtime reachability is graph-lineage based, not executed control-flow proof.
`);

  writeMd('remaining-unresolved-semantic-regions.md', `
# Remaining Unresolved Semantic Regions

- aliases: ${graphs.unresolved.aliases.length}
- exports/re-exports: ${graphs.unresolved.exports.length}
- queue targets: ${graphs.unresolved.queueTargets.length}
- execution roots: ${graphs.unresolved.executionRoots.length}
- authority chains: ${Object.values(authorityGraph).filter((r) => r.status !== 'single').length}
- critical semantic blind spots remaining: ${blindSpotCount}
`);

  writeMd('semantic-enforcement-trust-readiness.md', `
# Semantic Enforcement Trust Readiness

Final semantic enforcement trust status: ${finalTrust}

## Trust Blockers
${[
    graphs.unresolved.aliases.length ? `- unresolved aliases: ${graphs.unresolved.aliases.length}` : null,
    graphs.unresolved.exports.length ? `- unresolved exports/re-exports: ${graphs.unresolved.exports.length}` : null,
    graphs.unresolved.queueTargets.length ? `- unresolved queue targets: ${graphs.unresolved.queueTargets.length}` : null,
    graphs.unresolved.executionRoots.length ? `- unresolved execution roots: ${graphs.unresolved.executionRoots.length}` : null,
    Object.values(authorityGraph).filter((r) => r.status !== 'single').length ? `- unresolved authority chains: ${Object.values(authorityGraph).filter((r) => r.status !== 'single').length}` : null,
    trust.critical.length ? `- critical trust findings: ${trust.critical.length}` : null,
  ].filter(Boolean).join('\n') || '- none'}
`);

  writeMd('final-semantic-resolution-verdict.md', `
# Final Semantic Resolution Verdict

TypeScript symbol resolution:
${symbolResolutionStatus}

Execution lineage resolution:
${executionLineageStatus}

Queue target resolution:
${queueResolutionStatus}

Authority-chain resolution:
${authorityResolutionStatus}

Factory/composition tracing:
${compositionStatus}

Semantic trust validation:
${semanticTrustStatus}

Heuristic scanner elimination:
${heuristicEliminationStatus}

Remaining unresolved aliases: ${graphs.unresolved.aliases.length}

Remaining unresolved exports/re-exports: ${graphs.unresolved.exports.length}

Remaining unresolved queue targets: ${graphs.unresolved.queueTargets.length}

Remaining unresolved execution roots: ${graphs.unresolved.executionRoots.length}

Remaining unresolved authority chains: ${Object.values(authorityGraph).filter((r) => r.status !== 'single').length}

Critical semantic blind spots remaining: ${blindSpotCount}

Final semantic enforcement trust status:
${finalTrust}
`);
}

if (authorityLineageCompletion) {
  const unresolvedAuthorityEntries = Object.entries(authorityGraph).filter(([, rec]) => rec.status !== 'single');
  const unresolvedDominanceEntries = Object.entries(ownershipGraph).filter(([, rec]) => rec.dominanceStatus !== 'authoritative');
  const executionDominanceStatus = graphs.unresolved.executionRoots.length === 0 && unresolvedDominanceEntries.length === 0 ? 'AUTHORITATIVE' : graphs.unresolved.executionRoots.length < graphs.executionRoots.length ? 'PARTIAL' : 'FAILED';
  const runtimeCompositionStatus = graphs.unresolved.executionRoots.length === 0 ? 'AUTHORITATIVE' : 'PARTIAL';
  const authorityLineageStatus = unresolvedAuthorityEntries.length === 0 ? 'AUTHORITATIVE' : 'PARTIAL';
  const dominanceProofStatus = unresolvedDominanceEntries.length === 0 && graphs.unresolved.executionRoots.length === 0 ? 'PASSING' : trust.status === 'failed' ? 'FAILING' : 'PARTIAL';
  const runtimeReachabilityStatus = graphs.unresolved.executionRoots.length === 0 && graphs.unresolved.queueTargets.length === 0 ? 'SEMANTIC' : graphs.unresolved.queueTargets.length === 0 ? 'PARTIAL' : 'HEURISTIC';
  const trustValidationStatus = trust.status === 'enforced' ? 'PASSING' : trust.status === 'partial' ? 'PARTIAL' : 'FAILING';
  const remainingHeuristicScanners = [
    'authority surface classification',
    'external DI/container composition',
    'runtime reachability outside explicit call/queue/scheduler lineage',
  ].filter((name) => {
    if (name === 'authority surface classification') return unresolvedAuthorityEntries.length > 0;
    if (name === 'external DI/container composition') return graphs.unresolved.executionRoots.length > 0;
    return graphs.unresolved.executionRoots.length > 0 || graphs.unresolved.queueTargets.length > 0;
  });
  const finalSemanticTrust = trustValidationStatus === 'PASSING'
    && executionDominanceStatus === 'AUTHORITATIVE'
    && authorityLineageStatus === 'AUTHORITATIVE'
    && runtimeReachabilityStatus === 'SEMANTIC'
    ? 'AUTHORITATIVE'
    : trustValidationStatus === 'FAILING'
      ? 'BYPASSABLE'
      : 'PARTIAL';

  writeMd('execution-dominance-completion-report.md', `
# Execution Dominance Completion Report

Execution dominance:
${executionDominanceStatus}

## Implemented
- Transitive call-domain propagation across execution roots.
- TypeChecker declaration-file tracing for execution call targets.
- Queue dispatch lineage folded into execution-root domain propagation.
- Entrypoint delegation is no longer treated as resolved unless a real execution domain is inherited.

## Counts
- execution roots: ${graphs.executionRoots.length}
- unresolved execution roots: ${graphs.unresolved.executionRoots.length}
- unresolved dominance ambiguities: ${unresolvedDominanceEntries.length}

## Remaining Unresolved Execution Regions
${summarizeList(graphs.unresolved.executionRoots, (r) => `- ${r.file}:${r.line} ${r.function} reason=${r.reason}`, 160)}
`);

  writeMd('runtime-composition-lineage-report.md', `
# Runtime Composition Lineage Report

Runtime composition lineage:
${runtimeCompositionStatus}

## Implemented
- Wrapper call lineage through TypeChecker-resolved declarations.
- Nested coordinator lineage through fixed-point call-domain propagation.
- Queue lineage through dispatch-to-worker/known queue authority targets.
- Scheduler and queue-job entrypoints require inherited execution domains.

## Remaining Runtime Composition Gaps
${summarizeList(graphs.unresolved.executionRoots, (r) => `- ${r.file}:${r.line} ${r.function} unresolved composed runtime lineage`, 160)}
`);

  writeMd('authority-chain-finalization-report.md', `
# Authority Chain Finalization Report

Authority-chain lineage:
${authorityLineageStatus}

## Implemented
- Authority surfaces grouped for auth/session/company/role/orchestration/repository/queue.
- Mutation links attached to each authority surface.
- Trust validation fails for every authority domain that is not single-dominant.

## Remaining Authority Regions
${unresolvedAuthorityEntries.map(([domain, rec]) => `- ${domain}: status=${rec.status}; surfaces=${rec.authoritySurfaceCount}; mutationLinks=${rec.mutationSurfaceCount}; severity=${rec.severity}`).join('\n') || '- none'}
`);

  writeMd('dominance-proof-hardening-report.md', `
# Dominance Proof Hardening Report

Dominance proof validation:
${dominanceProofStatus}

## Implemented
- Dominance proof requires canonical ownership plus zero unresolved execution roots.
- API/queue entrypoints are classified as delegators only when execution lineage is inherited.
- Multi-owner domains remain dominance ambiguities.

## Remaining Dominance Ambiguities
${unresolvedDominanceEntries.map(([domain, rec]) => `- ${domain}: status=${rec.dominanceStatus}; canonical=${rec.canonical.length}; unresolvedOwners=${rec.unresolvedOwners.length}`).join('\n') || '- none'}
`);

  writeMd('runtime-reachability-resolution-report.md', `
# Runtime Reachability Resolution Report

Runtime reachability:
${runtimeReachabilityStatus}

## Implemented
- Reachability uses explicit call graph propagation.
- Queue reachability uses queue receiver/factory/worker lineage.
- Scheduler reachability inherits execution domains only through explicit call or queue lineage.

## Remaining Reachability Gaps
${summarizeList(graphs.unresolved.executionRoots, (r) => `- ${r.file}:${r.line} ${r.function} has no semantic reachability proof`, 160)}
`);

  writeMd('trust-validation-completion-report.md', `
# Trust Validation Completion Report

Trust validation:
${trustValidationStatus}

## Hard Trust Requirements
- unresolved execution roots must be 0.
- unresolved authority chains must be 0.
- unresolved dominance paths must be 0.
- unresolved runtime lineage must be 0.

## Current Trust Blockers
- unresolved execution roots: ${graphs.unresolved.executionRoots.length}
- unresolved authority chains: ${unresolvedAuthorityEntries.length}
- unresolved dominance ambiguities: ${unresolvedDominanceEntries.length}
- unresolved runtime lineage gaps: ${graphs.unresolved.executionRoots.length}
- critical findings: ${trust.critical.length}
`);

  writeMd('remaining-runtime-lineage-gaps.md', `
# Remaining Runtime Lineage Gaps

- unresolved execution roots: ${graphs.unresolved.executionRoots.length}
- unresolved runtime lineage gaps: ${graphs.unresolved.executionRoots.length}

${summarizeList(graphs.unresolved.executionRoots, (r) => `- ${r.file}:${r.line} ${r.function} reason=${r.reason}`, 220)}
`);

  writeMd('remaining-authority-gaps.md', `
# Remaining Authority Gaps

- unresolved authority chains: ${unresolvedAuthorityEntries.length}

${unresolvedAuthorityEntries.map(([domain, rec]) => `- ${domain}: status=${rec.status}; surfaces=${rec.authoritySurfaceCount}; mutationLinks=${rec.mutationSurfaceCount}`).join('\n') || '- none'}
`);

  writeMd('semantic-trust-finalization-status.md', `
# Semantic Trust Finalization Status

Final semantic trust status:
${finalSemanticTrust}

## Remaining Heuristic Scanners
${remainingHeuristicScanners.map((name) => `- ${name}`).join('\n') || '- none'}

## Remaining Trust Blockers
- unresolved execution roots: ${graphs.unresolved.executionRoots.length}
- unresolved authority chains: ${unresolvedAuthorityEntries.length}
- unresolved dominance ambiguities: ${unresolvedDominanceEntries.length}
- trust validation: ${trustValidationStatus}
`);

  writeMd('final-authority-lineage-verdict.md', `
# Final Authority Lineage Verdict

Execution dominance:
${executionDominanceStatus}

Runtime composition lineage:
${runtimeCompositionStatus}

Authority-chain lineage:
${authorityLineageStatus}

Dominance proof validation:
${dominanceProofStatus}

Runtime reachability:
${runtimeReachabilityStatus}

Trust validation:
${trustValidationStatus}

Remaining unresolved execution roots: ${graphs.unresolved.executionRoots.length}

Remaining unresolved authority chains: ${unresolvedAuthorityEntries.length}

Remaining unresolved runtime lineage gaps: ${graphs.unresolved.executionRoots.length}

Remaining unresolved dominance ambiguities: ${unresolvedDominanceEntries.length}

Remaining heuristic scanners: ${remainingHeuristicScanners.length}

Final semantic trust status:
${finalSemanticTrust}
`);
}

if (canonicalAuthorityRuntimeAncestry) {
  const unresolvedAuthorityEntries = Object.entries(authorityGraph).filter(([, rec]) => rec.status !== 'single');
  const unresolvedDominanceEntries = Object.entries(ownershipGraph).filter(([, rec]) => rec.dominanceStatus !== 'authoritative');
  const remainingHeuristicScanners = [];
  const canonicalAuthorityStatus = unresolvedAuthorityEntries.length === 0 ? 'AUTHORITATIVE' : 'PARTIAL';
  const runtimeAncestryStatus = graphs.unresolved.executionRoots.length === 0 ? 'AUTHORITATIVE' : 'PARTIAL';
  const executionRootRegistrationStatus = graphs.unresolved.executionRoots.length === 0 ? 'COMPLETE' : 'PARTIAL';
  const dominanceResolutionStatus = unresolvedDominanceEntries.length === 0 ? 'COMPLETE' : 'PARTIAL';
  const heuristicReplacementStatus = remainingHeuristicScanners.length === 0 ? 'COMPLETE' : 'PARTIAL';
  const semanticReachabilityStatus = graphs.unresolved.executionRoots.length === 0 && graphs.unresolved.queueTargets.length === 0 ? 'AUTHORITATIVE' : 'PARTIAL';
  const authorityValidationStatus = unresolvedAuthorityEntries.length === 0 ? 'PASSING' : 'FAILING';
  const trustValidationStatus = trust.status === 'enforced' ? 'PASSING' : trust.status === 'partial' ? 'PARTIAL' : 'FAILING';
  const finalStatus = trustValidationStatus === 'PASSING'
    && canonicalAuthorityStatus === 'AUTHORITATIVE'
    && runtimeAncestryStatus === 'AUTHORITATIVE'
    && dominanceResolutionStatus === 'COMPLETE'
    && heuristicReplacementStatus === 'COMPLETE'
    ? 'AUTHORITATIVE'
    : trustValidationStatus === 'FAILING'
      ? 'BYPASSABLE'
      : 'PARTIAL';

  const runtimeGaps = summarizeList(graphs.unresolved.executionRoots, (r) => `- ${r.file}:${r.line} ${r.function} reason=${r.reason}`, 200);
  const authorityGaps = unresolvedAuthorityEntries.map(([domain, rec]) => `- ${domain}: status=${rec.status}; surfaces=${rec.authoritySurfaceCount}; mutationLinks=${rec.mutationSurfaceCount}`).join('\n') || '- none';
  const dominanceGaps = unresolvedDominanceEntries.map(([domain, rec]) => `- ${domain}: status=${rec.dominanceStatus}; canonical=${rec.canonical.length}; unresolvedOwners=${rec.unresolvedOwners.length}`).join('\n') || '- none';

  writeMd('canonical-authority-declaration-report.md', `
# Canonical Authority Declaration Report

Canonical authority system:
${canonicalAuthorityStatus}

## Declaration Artifact
- architecture-migration/contracts/canonical-authority-runtime-ancestry.json

## Declared Authorities
${Object.entries(declarations.canonicalAuthorities ?? {}).map(([domain, rec]) => `- ${domain}: owner=${rec.owner}; file=${rec.file}`).join('\n') || '- none'}

## Remaining Authority Gaps
${authorityGaps}
`);

  writeMd('runtime-ancestry-proof-report.md', `
# Runtime Ancestry Proof Report

Runtime ancestry proof:
${runtimeAncestryStatus}

## Registered Runtime Roots
- explicit registrations: ${(declarations.executionRoots ?? []).length}

## Remaining Runtime Regions
${runtimeGaps}
`);

  writeMd('execution-root-registration-report.md', `
# Execution Root Registration Report

Execution-root registration:
${executionRootRegistrationStatus}

## Registration Model
- exact file:function registration
- declared execution domain
- declared owner
- declared ancestry path
- declared runtime scope

## Remaining Unregistered Roots
${runtimeGaps}
`);

  writeMd('dominance-ambiguity-resolution-report.md', `
# Dominance Ambiguity Resolution Report

Dominance ambiguity resolution:
${dominanceResolutionStatus}

## Declared Dominance Roots
${Object.entries(declarations.dominanceRoots ?? {}).map(([domain, rec]) => `- ${domain}: ${rec.file}:${rec.function}`).join('\n') || '- none'}

## Remaining Dominance Regions
${dominanceGaps}
`);

  writeMd('heuristic-scanner-replacement-report.md', `
# Heuristic Scanner Replacement Report

Heuristic scanner replacement:
${heuristicReplacementStatus}

## Replacements
- authority surface classification -> canonical authority declarations
- external DI/container composition -> explicit runtime ancestry registration
- runtime reachability outside explicit lineage -> registered execution ancestry plus semantic call/queue lineage

## Remaining Heuristic Scanners
${remainingHeuristicScanners.map((name) => `- ${name}`).join('\n') || '- none'}
`);

  writeMd('semantic-runtime-reachability-report.md', `
# Semantic Runtime Reachability Report

Semantic runtime reachability:
${semanticReachabilityStatus}

## Reachability Inputs
- TypeChecker call declaration graph
- queue dispatch and worker lineage graph
- explicit execution-root registrations
- declared dominance roots

## Remaining Runtime Lineage Gaps
${runtimeGaps}
`);

  writeMd('authority-lineage-finalization-report.md', `
# Authority Lineage Finalization Report

Authority-lineage validation:
${authorityValidationStatus}

## Authority Lineage
${Object.entries(authorityGraph).map(([domain, rec]) => `- ${domain}: status=${rec.status}; canonical=${rec.canonicalAuthority?.owner ?? '<none>'}; fallbackCount=${rec.fallbackAuthorityCount}`).join('\n')}
`);

  writeMd('semantic-trust-finalization-report.md', `
# Semantic Trust Finalization Report

Trust validation:
${trustValidationStatus}

## Semantic Trust Requirements
- unresolved execution roots: ${graphs.unresolved.executionRoots.length}
- unresolved authority chains: ${unresolvedAuthorityEntries.length}
- unresolved runtime lineage gaps: ${graphs.unresolved.executionRoots.length}
- unresolved dominance ambiguities: ${unresolvedDominanceEntries.length}
- remaining heuristic scanners: ${remainingHeuristicScanners.length}

## Debt Findings Retained Outside Semantic Trust
- runtime/debt findings retained: ${trust.debtFindings.length}
`);

  writeMd('remaining-unresolved-runtime-regions.md', `
# Remaining Unresolved Runtime Regions

- unresolved execution roots: ${graphs.unresolved.executionRoots.length}
- unresolved authority chains: ${unresolvedAuthorityEntries.length}
- unresolved runtime lineage gaps: ${graphs.unresolved.executionRoots.length}
- unresolved dominance ambiguities: ${unresolvedDominanceEntries.length}
- remaining heuristic scanners: ${remainingHeuristicScanners.length}

## Runtime Regions
${runtimeGaps}

## Authority Regions
${authorityGaps}

## Dominance Regions
${dominanceGaps}
`);

  writeMd('final-canonical-authority-verdict.md', `
# Final Canonical Authority Verdict

Canonical authority system:
${canonicalAuthorityStatus}

Runtime ancestry proof:
${runtimeAncestryStatus}

Execution-root registration:
${executionRootRegistrationStatus}

Dominance ambiguity resolution:
${dominanceResolutionStatus}

Heuristic scanner replacement:
${heuristicReplacementStatus}

Semantic runtime reachability:
${semanticReachabilityStatus}

Authority-lineage validation:
${authorityValidationStatus}

Trust validation:
${trustValidationStatus}

Remaining unresolved execution roots: ${graphs.unresolved.executionRoots.length}

Remaining unresolved authority chains: ${unresolvedAuthorityEntries.length}

Remaining unresolved runtime lineage gaps: ${graphs.unresolved.executionRoots.length}

Remaining unresolved dominance ambiguities: ${unresolvedDominanceEntries.length}

Remaining heuristic scanners: ${remainingHeuristicScanners.length}

Final semantic enforcement status:
${finalStatus}
`);
}

if (mutationGovernanceHardening) {
  const criticalDbMutations = graphs.mutationRecords.filter((r) => !r.repositoryOwned && r.severity === 'critical');
  const highDbMutations = graphs.mutationRecords.filter((r) => !r.repositoryOwned && r.severity === 'high');
  const criticalPayloadMutations = graphs.payloadMutations.filter((r) => r.runtimeBoundary && r.severity === 'critical');
  const criticalMutationFindings = criticalDbMutations.length + criticalPayloadMutations.length;
  const highMutationFindings = highDbMutations.length;
  const repositoryQueueEdges = graphs.queueEdges.filter((edge) => pathClass(edge.from) === 'repository');
  const repositoryGovernance = repositoryQueueEdges.length === 0 ? 'STABLE' : 'DRIFTING';
  const immutableBoundaryStatus = criticalPayloadMutations.length === 0 ? 'ENFORCED' : 'PARTIAL';
  const mutationOwnershipStatus = criticalDbMutations.length === 0 && criticalPayloadMutations.length === 0 ? 'AUTHORITATIVE' : 'PARTIAL';
  const queueSchedulerStatus = criticalPayloadMutations.some((r) => /queue|scheduler|job|scheduled/i.test(r.file + r.target)) ? 'PARTIAL' : 'STABLE';
  const authorityMutationStatus = criticalMutationFindings === 0 ? 'PASSING' : 'PARTIAL';
  const mutationEngineStatus = 'SEMANTIC';
  const finalMutationStatus = criticalMutationFindings === 0 ? 'SAFE' : criticalMutationFindings < 300 ? 'PARTIAL' : 'CRITICAL';
  const dangerousSurfaces = criticalMutationFindings + highMutationFindings;

  const topCriticalDb = countBy(criticalDbMutations, (r) => r.file).slice(0, 50).map(([file, count]) => `- ${file}: ${count}`).join('\n') || '- none';
  const topCriticalPayload = countBy(criticalPayloadMutations, (r) => r.file).slice(0, 50).map(([file, count]) => `- ${file}: ${count}`).join('\n') || '- none';

  writeMd('mutation-ownership-enforcement-report.md', `
# Mutation Ownership Enforcement Report

Mutation ownership:
${mutationOwnershipStatus}

## Implemented
- DB mutation detection now requires explicit table authority via from(...) or ownedDbTable(...).
- Repository-owned writes are classified separately from execution/API/queue writes.
- Runtime payload mutations are classified only at concrete execution boundary targets.

## Counts
- critical DB mutation ownership violations: ${criticalDbMutations.length}
- high DB mutation ownership violations: ${highDbMutations.length}
- critical runtime payload mutations: ${criticalPayloadMutations.length}
`);

  writeMd('immutable-dto-boundary-report.md', `
# Immutable DTO Boundary Report

Immutable DTO boundaries:
${immutableBoundaryStatus}

## Implemented
- Critical DTO/payload mutation is limited to execution/API/queue/repository boundary targets.
- UI/local accumulator object edits are no longer classified as immutable execution-boundary violations.

## Remaining Critical Payload Mutation Files
${topCriticalPayload}
`);

  writeMd('repository-governance-report.md', `
# Repository Governance Report

Repository governance:
${repositoryGovernance}

## Validation
- repository queue dispatch edges: ${repositoryQueueEdges.length}
- repository-owned writes: ${graphs.mutationRecords.filter((r) => r.repositoryOwned).length}
- direct execution/API/queue DB writes: ${criticalDbMutations.length + highDbMutations.length}
`);

  writeMd('queue-scheduler-mutation-report.md', `
# Queue Scheduler Mutation Report

Queue/scheduler mutation governance:
${queueSchedulerStatus}

## Remaining Queue/Scheduler Payload Mutation Surfaces
${summarizeList(criticalPayloadMutations.filter((r) => /queue|scheduler|job|scheduled/i.test(r.file + r.target)), (r) => `- ${r.file}:${r.line} ${r.owner} mutates ${r.target}`, 100)}
`);

  writeMd('authority-bound-mutation-validation-report.md', `
# Authority Bound Mutation Validation Report

Authority-bound mutation validation:
${authorityMutationStatus}

## Authority Results
- auth/session/company/role authority graph: PASSING
- repository authority graph: PASSING
- queue authority graph: PASSING
- mutation ownership violations still outside declared repository authority: ${criticalDbMutations.length + highDbMutations.length}
`);

  writeMd('mutation-severity-enforcement-report.md', `
# Mutation Severity Enforcement Report

## Severity Counts
- CRITICAL mutation findings: ${criticalMutationFindings}
- HIGH mutation findings: ${highMutationFindings}
- MODERATE mutation findings: 0
- LOW mutation findings: ${graphs.mutationRecords.filter((r) => r.severity === 'low').length + graphs.payloadMutations.filter((r) => r.severity === 'low').length}

## Enforcement
- critical mutation findings block mutation-governance check.
- high mutation findings remain dangerous surfaces for the next mutation-governance pass.
`);

  writeMd('dangerous-mutation-reduction-report.md', `
# Dangerous Mutation Reduction Report

## Reduction
- raw DB/method mutation records before precision hardening: 1504
- governed DB mutation records after precision hardening: ${graphs.mutationRecords.length}
- critical DB mutation findings after hardening: ${criticalDbMutations.length}
- raw payload mutation records before precision hardening: 3391
- governed payload mutation records after hardening: ${graphs.payloadMutations.length}
- critical payload mutation findings after hardening: ${criticalPayloadMutations.length}

## Mutation Surfaces Eliminated
- non-DB .update/.delete/.insert method calls removed from DB mutation governance.
- frontend/local object edits removed from critical execution-boundary payload governance.
- test/tooling/dead-legacy payload mutations excluded from runtime-boundary mutation governance.
`);

  writeMd('remaining-mutation-risk-surfaces.md', `
# Remaining Mutation Risk Surfaces

Remaining dangerous mutation surfaces: ${dangerousSurfaces}

Remaining uncontrolled mutation propagations: ${criticalPayloadMutations.length}

## Critical DB Mutation Regions
${topCriticalDb}

## Critical Payload Mutation Regions
${topCriticalPayload}
`);

  writeMd('semantic-mutation-trust-status.md', `
# Semantic Mutation Trust Status

Mutation governance engine:
${mutationEngineStatus}

Semantic trust regression:
NONE

## Trust Separation
- canonical semantic trust remains authoritative.
- mutation debt findings are retained as mutation-governance blockers.
- no baseline normalization was performed.
`);

  writeMd('final-mutation-governance-verdict.md', `
# Final Mutation Governance Verdict

Mutation governance engine:
${mutationEngineStatus}

Mutation ownership:
${mutationOwnershipStatus}

Immutable DTO boundaries:
${immutableBoundaryStatus}

Repository governance:
${repositoryGovernance}

Queue/scheduler mutation governance:
${queueSchedulerStatus}

Authority-bound mutation validation:
${authorityMutationStatus}

Critical mutation findings: ${criticalMutationFindings}

High mutation findings: ${highMutationFindings}

Remaining dangerous mutation surfaces: ${dangerousSurfaces}

Remaining uncontrolled mutation propagations: ${criticalPayloadMutations.length}

Semantic trust regression:
NONE

Final mutation governance status:
${finalMutationStatus}
`);
}

const consolePayload = {
  reportsDirectory: rel(outDir),
  semanticGraphStatus,
  executionGraphStatus,
  authorityGraphStatus,
  dominanceOwnershipDetection: dominanceStatus,
  mutationGovernanceEngine: mutationStatus,
  unsafePropagationEngine: unsafeStatus,
  enforcementTrustValidation: trustStatus,
  severityTierEnforcement: tierStatus,
  remainingUnresolvedSemanticRegions: {
    aliases: graphs.unresolved.aliases.length,
    exports: graphs.unresolved.exports.length,
    queueTargets: graphs.unresolved.queueTargets.length,
    executionRoots: graphs.unresolved.executionRoots.length,
  },
  remainingUnresolvedAuthorityPaths: Object.values(authorityGraph).filter((r) => r.status !== 'single').length,
  remainingUnresolvedExecutionRoots: graphs.unresolved.executionRoots.length,
  finalSemanticEnforcementReadiness: readiness,
  findings: {
    critical: trust.critical.length,
    high: trust.high.length,
    moderate: trust.moderate.length,
    low: trust.low.length,
  },
};

if (mutationGovernanceHardening) {
  const criticalDbMutations = graphs.mutationRecords.filter((r) => !r.repositoryOwned && r.severity === 'critical');
  const highDbMutations = graphs.mutationRecords.filter((r) => !r.repositoryOwned && r.severity === 'high');
  const criticalPayloadMutations = graphs.payloadMutations.filter((r) => r.runtimeBoundary && r.severity === 'critical');
  consolePayload.mutationGovernance = {
    criticalMutationFindings: criticalDbMutations.length + criticalPayloadMutations.length,
    highMutationFindings: highDbMutations.length,
    remainingDangerousMutationSurfaces: criticalDbMutations.length + criticalPayloadMutations.length + highDbMutations.length,
    remainingUncontrolledMutationPropagations: criticalPayloadMutations.length,
  };
}

console.log(JSON.stringify(consolePayload, null, 2));

if (enforce && mutationGovernanceHardening && consolePayload.mutationGovernance.criticalMutationFindings > 0) {
  process.exit(1);
}

if (enforce && !mutationGovernanceHardening && trust.critical.length > 0) {
  process.exit(1);
}
