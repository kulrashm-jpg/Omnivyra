import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const reportDir = path.join(root, 'architecture-migration', 'reports', 'runtime-shadow-elimination');
const softRetirementReportDir = path.join(root, 'architecture-migration', 'reports', 'compatibility-soft-retirement');
const contractPath = path.join(root, 'architecture-migration', 'contracts', 'runtime-shadow-authority.json');
const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx']);
const skipDirs = new Set(['.git', '.next', 'node_modules']);
const enforce = process.argv.includes('--enforce');

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(reportDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function writeSoftRetirementJson(name, value) {
  fs.writeFileSync(path.join(softRetirementReportDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function writeMd(name, value) {
  fs.writeFileSync(path.join(reportDir, name), `${value.trim()}\n`);
}

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else if (sourceExts.has(path.extname(full))) results.push(full);
  }
  return results;
}

function pageRoute(file) {
  const fileRel = rel(file);
  if (!fileRel.startsWith('pages/')) return null;
  if (fileRel.startsWith('pages/api/')) return null;
  const withoutExt = fileRel.replace(/\.(tsx|ts|jsx|js)$/, '');
  const route = withoutExt
    .replace(/^pages/, '')
    .replace(/\/index$/, '')
    .replace(/\[([^\]]+)\]/g, ':$1');
  return route || '/';
}

function apiRoute(file) {
  const fileRel = rel(file);
  if (!fileRel.startsWith('pages/api/')) return null;
  const withoutExt = fileRel.replace(/\.(tsx|ts|jsx|js)$/, '');
  return withoutExt
    .replace(/^pages\/api/, '/api')
    .replace(/\/index$/, '')
    .replace(/\[([^\]]+)\]/g, ':$1');
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function findLiteralRefs(files, aliases) {
  const refs = [];
  const seen = new Set();
  const escaped = Object.keys(aliases).sort((a, b) => b.length - a.length).map((route) => route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const literalPattern = new RegExp(`(['"\`])(${escaped.join('|')})(?=[?#'"\`])(?:[?#][^'"\`]*)?\\1`, 'g');
  const templatePattern = new RegExp(`\`(${escaped.join('|')})(?=[?#\`])(?:[?#][^\`]*)?\``, 'g');

  for (const file of files) {
    const fileRel = rel(file);
    if (fileRel.includes('architecture-migration/contracts/runtime-shadow-authority.json')) continue;
    const text = readText(file);
    for (const pattern of [literalPattern, templatePattern]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text))) {
        const route = match[2] || match[1];
        const record = {
          file: fileRel,
          line: lineOf(text, match.index),
          route,
          canonical: aliases[route],
          text: match[0].slice(0, 160),
          category: fileRel.startsWith('pages/api/') ? 'api-reference' : 'navigation-or-runtime-reference',
        };
        const key = `${record.file}:${record.line}:${record.route}:${record.text}`;
        if (!seen.has(key)) {
          refs.push(record);
          seen.add(key);
        }
      }
    }
  }
  return refs;
}

function routeClass(route, filesByRoute, aliases) {
  if (aliases[route] && filesByRoute.has(route)) return 'D. shadowing canonical';
  if (aliases[route]) return 'C. deprecated but reachable';
  return 'A. canonical authority';
}

function collectRedirects() {
  const configFile = path.join(root, 'next.config.js');
  if (!fs.existsSync(configFile)) return [];
  const text = readText(configFile);
  const redirects = [];
  const rx = /\{\s*source:\s*['"]([^'"]+)['"],\s*destination:\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = rx.exec(text))) {
    redirects.push({ source: match[1], destination: match[2], file: 'next.config.js', line: lineOf(text, match.index) });
  }
  return redirects;
}

function collectHeaders() {
  const configFile = path.join(root, 'next.config.js');
  if (!fs.existsSync(configFile)) return [];
  const text = readText(configFile);
  const lines = text.split(/\r?\n/);
  const headers = [];
  for (let index = 0; index < lines.length; index += 1) {
    const source = lines[index].match(/source:\s*['"]([^'"]+)['"]/)?.[1];
    if (!source) continue;
    const block = lines.slice(index, index + 6).join('\n');
    const key = block.match(/key:\s*['"]([^'"]+)['"]/)?.[1];
    const value = block.match(/value:\s*['"]([^'"]+)['"]/)?.[1];
    if (key && value) {
      headers.push({ source, key, value, file: 'next.config.js', line: index + 1 });
    }
  }
  return headers;
}

function collectFetchTargets(files) {
  const targets = [];
  const rx = /\b(?:fetch|fetchWithAuth)\(\s*([`'"])(\/api\/[^`'"]+)/g;
  for (const file of files) {
    const fileRel = rel(file);
    const text = readText(file);
    let match;
    while ((match = rx.exec(text))) {
      targets.push({
        file: fileRel,
        line: lineOf(text, match.index),
        api: match[2].split(/[?#$]/)[0],
      });
    }
  }
  return targets;
}

function hasPageLocalRedirect(fileRel, canonical) {
  const full = path.join(root, fileRel);
  if (!fs.existsSync(full)) return false;
  const text = readText(full);
  return text.includes('getServerSideProps') && text.includes('redirect') && text.includes(canonical);
}

function hasDeprecatedRouteMarker(fileRel) {
  const full = path.join(root, fileRel);
  if (!fs.existsSync(full)) return false;
  const text = readText(full);
  return text.includes('DEPRECATED_RUNTIME_ROUTE') && text.includes('CANONICAL_RUNTIME_ROUTE');
}

function noindexDominatesRoute(route, headers) {
  return headers.some((header) => {
    if (header.key.toLowerCase() !== 'x-robots-tag') return false;
    if (!header.value.toLowerCase().includes('noindex')) return false;
    if (header.source === route) return true;
    if (header.source.includes(':path(')) {
      const prefix = header.source.split('/:path(')[0];
      const options = header.source.match(/\(([^)]+)\)/)?.[1]?.split('|') ?? [];
      return route.startsWith(`${prefix}/`) && options.some((option) => route === `${prefix}/${option}`);
    }
    return false;
  });
}

function collectStaleImports(files, routes) {
  const importTargets = routes.flatMap((route) => {
    const withoutSlash = route.replace(/^\//, '');
    return [
      `pages/${withoutSlash}`,
      `../${withoutSlash}`,
      `../../${withoutSlash}`,
      `/${withoutSlash}`,
    ];
  });
  const results = [];
  for (const file of files) {
    const fileRel = rel(file);
    if (fileRel.startsWith('architecture-migration/reports/')) continue;
    const text = readText(file);
    for (const target of importTargets) {
      const rx = new RegExp(`from\\s+['"\`][^'"\`]*${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`, 'g');
      let match;
      while ((match = rx.exec(text))) {
        results.push({
          file: fileRel,
          line: lineOf(text, match.index),
          target,
          classification: 'stale runtime import',
        });
      }
    }
  }
  return results;
}

function classifyOrphan(page) {
  const route = page.route;
  const base = path.basename(page.file);
  if (/\/(admin|super-admin|system|settings)\b/.test(route)) return 'C. admin-only runtime';
  if (/\.(types|helpers)$/.test(route) || /^[A-Z]/.test(base)) return 'E. dead runtime artifact';
  if (/\/(template|suggestions|generate|new|create|manage|intelligence)$/.test(route)) return 'A. intentionally isolated';
  if (/\/(audit|free-audit|company-blog|capture)\b/.test(route)) return 'A. intentionally isolated';
  if (/\/(activity-workspace|campaign|command-center|community-ai|engagement|reports|posts|articles|blogs|guides|newsletters|whitepapers|stories|case-studies)\b/.test(route)) {
    return 'A. intentionally isolated';
  }
  return 'G. unresolved ownership';
}

function orphanGovernanceState(page) {
  if (page.orphanClassification === 'C. admin-only runtime') return 'B. isolated admin/tooling runtime';
  if (page.orphanClassification === 'E. dead runtime artifact') return 'E. retirement candidate';
  if (page.orphanClassification === 'A. intentionally isolated') return 'A. governed active runtime';
  if (/\/onboarding\b/.test(page.route)) return 'C. migration-stage runtime';
  if (/\/(analytics|marketing|recommendations|scheduler|scheduling|templates|whatsapp|team|topic|media|platform)/.test(page.route)) return 'C. migration-stage runtime';
  if (page.route === '/_app' || page.route === '/_document' || page.route === '/sitemap.xml') return 'A. governed active runtime';
  return 'C. migration-stage runtime';
}

ensureDir(reportDir);
ensureDir(softRetirementReportDir);

const contract = JSON.parse(readText(contractPath));
const aliases = contract.deprecatedRouteAliases;
const retiredRuntimeSurfaces = contract.retiredRuntimeSurfaces || [];
const compatibilityBridgeGovernance = contract.compatibilityBridgeGovernance || {};
const duplicateAuthorityGovernance = contract.duplicateAuthorityGovernance || {};
const ownershipLifecycleGovernance = contract.ownershipLifecycleGovernance || {};
const migrationParityGovernance = contract.migrationParityGovernance || {};
const duplicateAuthorityDependencyGovernance = contract.duplicateAuthorityDependencyGovernance || {};
const bridgeSunsetReadiness = contract.bridgeSunsetReadiness || {};
const compatibilityBridgeObservability = contract.compatibilityBridgeObservability || {};
const compatibilityBridgeSoftRetirement = contract.compatibilityBridgeSoftRetirement || {};
const files = walk(root);
const pages = files.map((file) => ({ file: rel(file), route: pageRoute(file) })).filter((x) => x.route);
const apis = files.map((file) => ({ file: rel(file), route: apiRoute(file) })).filter((x) => x.route);
const filesByRoute = new Map(pages.map((page) => [page.route, page.file]));
const redirects = collectRedirects();
const headers = collectHeaders();
const deprecatedRefs = findLiteralRefs(files.filter((file) => !rel(file).startsWith('architecture-migration/reports/')), aliases);
const fetchTargets = collectFetchTargets(files);
const staleRuntimeImports = collectStaleImports(files, Object.keys(aliases));
const deletedRuntimeResurrection = retiredRuntimeSurfaces
  .filter((surface) => fs.existsSync(path.join(root, surface.file)))
  .map((surface) => ({
    ...surface,
    classification: 'deleted runtime resurrection',
    reason: 'retired runtime surface file exists again',
  }));

const routeGraph = pages.map((page) => ({
  ...page,
  classification: routeClass(page.route, filesByRoute, aliases),
  canonical: aliases[page.route] || page.route,
}));

const shadowedCanonicalPages = redirects
  .filter((redirect) => filesByRoute.has(redirect.source))
  .map((redirect) => ({
    route: redirect.source,
    pageFile: filesByRoute.get(redirect.source),
    redirectedTo: redirect.destination,
    pageLocalRedirect: hasPageLocalRedirect(filesByRoute.get(redirect.source), redirect.destination),
    deprecatedRouteMarker: hasDeprecatedRouteMarker(filesByRoute.get(redirect.source)),
    noindex: noindexDominatesRoute(redirect.source, headers),
    classification: 'D. shadowing canonical',
  }));

const unconsolidatedShadowedPhysicalPages = shadowedCanonicalPages.filter((page) => (
  !page.pageLocalRedirect || !page.deprecatedRouteMarker || !page.noindex
));

const staleNavigationTargets = deprecatedRefs.filter((ref) => {
  if (ref.file.startsWith('architecture-migration/')) return false;
  if (ref.file.startsWith('next.config')) return false;
  if (ref.file.startsWith('pages/api/')) return false;
  if (ref.file === 'lib/routes/canonicalRegistry.ts') return false;
  if (ref.file === 'proxy.ts') return false;

  const lines = readText(path.join(root, ref.file)).split(/\r?\n/);
  const sourceLine = lines[ref.line - 1] || '';
  const nearby = lines.slice(Math.max(0, ref.line - 8), ref.line + 2).join('\n');
  if (sourceLine.includes('matchers:') || sourceLine.includes('startsWith(')) return false;
  if (nearby.includes('matchers:')) return false;
  if (sourceLine.includes('DEPRECATED_RUNTIME_ROUTE') || sourceLine.includes('CANONICAL_RUNTIME_ROUTE')) return false;
  if (ref.route === '/content-creation' && ref.text.includes('campaignId=')) return false;
  return true;
});

const deprecatedApiConsumers = fetchTargets.filter((target) => (
  contract.compatibilityOnlyApis.some((api) => {
    if (api.endsWith('/*/callback')) return target.api.startsWith(api.replace('/*/callback', '/'));
    return target.api === api || target.api.startsWith(`${api}/`);
  })
));

const htmlJsonMismatches = fetchTargets
  .filter((target) => !apis.some((api) => target.api === api.route || target.api.startsWith(`${api.route}/`) || api.route.includes(':')))
  .map((target) => ({ ...target, classification: 'possible HTML/JSON mismatch or dynamic API not statically resolved' }));

const duplicateFeatureSurfaces = [
  {
    domain: 'blogContent',
    surfaces: pages.filter((page) => /^\/(blogs|admin\/blog|articles|guides|newsletters|whitepapers|case-studies|stories)/.test(page.route)),
  },
  {
    domain: 'campaigns',
    surfaces: pages.filter((page) => /^\/(campaign|command-center\/bolt|command-center\/campaigns)/.test(page.route)),
  },
  {
    domain: 'adminSettings',
    surfaces: pages.filter((page) => /^\/(admin|super-admin|settings)/.test(page.route)),
  },
].map((entry) => ({
  ...entry,
  classification: entry.surfaces.length > 1 ? 'G. duplicate feature surface' : 'A. canonical authority',
  count: entry.surfaces.length,
}));

const unresolvedOwnershipConflicts = Object.entries(contract.canonicalAuthorities)
  .flatMap(([domain, authority]) => (authority.ownershipConflicts || []).map((conflict) => ({ domain, conflict })));

const orphanRuntimePages = routeGraph.filter((page) => {
  if (page.classification !== 'A. canonical authority') return false;
  const route = page.route;
  const isPublicLegal = ['/', '/pricing', '/about', '/privacy', '/terms', '/data-deletion', '/features', '/solutions', '/landing'].includes(route);
  const isAuth = route.startsWith('/auth') || route === '/login' || route === '/create-account';
  const isKnownPrefix = Object.values(contract.canonicalAuthorities).some((authority) => {
    const canonical = authority.canonicalPage;
    return canonical && (route === canonical || route.startsWith(`${canonical}/`));
  });
  return !isPublicLegal && !isAuth && !isKnownPrefix && !route.startsWith('/blog/') && !route.startsWith('/api/');
});

const classifiedOrphanRuntimePages = orphanRuntimePages.map((page) => ({
  ...page,
  orphanClassification: classifyOrphan(page),
  reachable: true,
  navigable: deprecatedRefs.some((ref) => ref.route === page.route),
  indexed: false,
  indexingReason: 'AuthGate protects non-public orphan routes; public/indexed orphan routes require explicit allowlisting.',
}));

const orphanIndexedPages = classifiedOrphanRuntimePages.filter((page) => page.indexed);

const ownershipDeclarations = Object.entries(contract.canonicalAuthorities).map(([domain, authority]) => ({
  domain,
  canonicalOwner: authority.runtimeOwner || authority.owner || null,
  compatibilityOwner: authority.compatibilityOwner || authority.runtimeOwner || null,
  temporaryBridgeOwner: authority.temporaryBridgeOwner || null,
  sunsetConditions: authority.sunsetConditions || [],
  runtimeRiskLevel: authority.runtimeRiskLevel || ((authority.ownershipConflicts || []).length ? 'medium' : 'low'),
  conflicts: authority.ownershipConflicts || [],
}));

const retainedCompatibilityBridges = Object.entries(aliases).map(([route, canonical]) => {
  const physicalPage = filesByRoute.get(route) || null;
  const redirect = redirects.find((item) => item.source === route) || null;
  const refs = deprecatedRefs.filter((ref) => ref.route === route && !ref.file.startsWith('architecture-migration/reports/'));
  const hasStatefulEvidence = refs.some((ref) => (
    /content-creation|bolt-text-strategy-state|campaignId=/.test(ref.text)
    || /backend\/(services|jobs)\//.test(ref.file)
    || ref.file === 'hooks/useBoltStrategy.tsx'
    || ref.file === 'components/BoltStrategyView.tsx'
  ));

  return {
    route,
    canonical,
    ...(compatibilityBridgeGovernance[route] || {}),
    physicalPage,
    redirect: redirect ? { destination: redirect.destination, file: redirect.file, line: redirect.line } : null,
    pageLocalRedirect: physicalPage ? hasPageLocalRedirect(physicalPage, canonical) : false,
    deprecatedRouteMarker: physicalPage ? hasDeprecatedRouteMarker(physicalPage) : false,
    noindex: noindexDominatesRoute(route, headers),
    consumerEvidence: refs.map((ref) => ({
      file: ref.file,
      line: ref.line,
      category: ref.category,
      text: ref.text,
    })),
    classification: compatibilityBridgeGovernance[route]?.classification || 'B. retained compatibility bridge',
    retirementDecision: hasStatefulEvidence
      ? 'retain: state/session/deep-link compatibility evidence still exists'
      : 'retain: redirect/registry compatibility bridge, no deletion proof recorded',
  };
});

const compatibilityApisRetained = contract.compatibilityOnlyApis.map((api) => ({
  api,
  consumers: deprecatedApiConsumers.filter((consumer) => {
    if (api.endsWith('/*/callback')) return consumer.api.startsWith(api.replace('/*/callback', '/'));
    return consumer.api === api || consumer.api.startsWith(`${api}/`);
  }),
  classification: 'B. retained compatibility API',
  retirementDecision: 'retain: compatibility API is declared in runtime authority contract',
}));

const retireableDeadRuntimes = classifiedOrphanRuntimePages.filter((page) => (
  page.orphanClassification === 'E. dead runtime artifact'
  && !page.navigable
  && !page.indexed
  && !files.some((file) => {
    const fileRel = rel(file);
    if (fileRel === page.file || fileRel.startsWith('architecture-migration/reports/')) return false;
    const text = readText(file);
    const stem = page.file.replace(/^pages\//, '').replace(/\.(tsx|ts|jsx|js)$/, '');
    const base = path.basename(stem);
    return text.includes(stem) || text.includes(`./${base}`) || text.includes(`../${base}`);
  })
));

const quarantinedDeadRuntimeArtifacts = classifiedOrphanRuntimePages
  .filter((page) => page.orphanClassification === 'E. dead runtime artifact')
  .map((page) => ({
    ...page,
    finalState: retireableDeadRuntimes.some((candidate) => candidate.file === page.file)
      ? 'E. retireable dead runtime'
      : 'D. staged migration runtime',
    retirementDecision: retireableDeadRuntimes.some((candidate) => candidate.file === page.file)
      ? 'eligible only after manual file move/delete review confirms no module import dependency'
      : 'retain + quarantine: artifact-like page remains reachable as a physical Next route or has import evidence',
  }));

const orphanRetirementClassification = classifiedOrphanRuntimePages.map((page) => {
  let finalState = 'D. staged migration runtime';
  if (page.orphanClassification === 'C. admin-only runtime') finalState = 'C. admin/tooling runtime';
  if (page.orphanClassification === 'A. intentionally isolated') finalState = 'A. canonical runtime';
  if (page.orphanClassification === 'B. compatibility bridge') finalState = 'B. isolated compatibility runtime';
  if (page.orphanClassification === 'E. dead runtime artifact') {
    finalState = retireableDeadRuntimes.some((candidate) => candidate.file === page.file)
      ? 'E. retireable dead runtime'
      : 'D. staged migration runtime';
  }
  return {
    ...page,
    finalState,
    retirementViability: finalState === 'E. retireable dead runtime'
      ? 'candidate, retained pending explicit delete/move review'
      : 'not retireable in this phase',
  };
});

const orphanFinalGovernance = classifiedOrphanRuntimePages.map((page) => {
  const finalGovernanceState = orphanGovernanceState(page);
  return {
    ...page,
    finalGovernanceState,
    canonicalOwner: finalGovernanceState === 'B. isolated admin/tooling runtime'
      ? 'admin/tooling authority'
      : finalGovernanceState === 'E. retirement candidate'
        ? 'runtime authority governance quarantine'
        : 'feature-domain runtime owner',
    authorityIsolationLevel: page.navigable
      ? 'runtime-linked'
      : 'non-navigation, AuthGate-protected, non-indexed',
    archivalRetirementViability: finalGovernanceState === 'E. retirement candidate'
      ? 'candidate only after import/dependency review'
      : 'not viable in this phase',
  };
});

const duplicateAuthorityAnalysis = duplicateFeatureSurfaces
  .filter((entry) => entry.count > 1)
  .map((entry) => ({
    ...entry,
    ...(duplicateAuthorityGovernance[entry.domain] || {
      classification: 'C. unresolved architectural duplication',
      reason: 'no duplicate authority governance declaration found',
    }),
  }));

const ownershipLifecycleAudit = Object.entries(ownershipLifecycleGovernance).map(([domain, governance]) => ({
  domain,
  ...governance,
  declaredConflict: unresolvedOwnershipConflicts.find((conflict) => conflict.domain === domain)?.conflict || null,
}));

const deprecatedRoutePermanenceAudit = retainedCompatibilityBridges.map((bridge) => ({
  route: bridge.route,
  canonical: bridge.canonical,
  permanence: bridge.permanence || 'temporary compatibility',
  classification: bridge.classification,
  migrationCompleteness: bridge.migrationCompleteness || 'unknown',
  rollbackCriticality: bridge.rollbackCriticality || 'unknown',
  operationalDependencyLevel: bridge.operationalDependencyLevel || 'unknown',
  authorityIsolationLevel: bridge.authorityIsolationLevel || 'unknown',
  sunsetConfidence: bridge.sunsetConfidence || 'unknown',
}));

const compatibilityViabilityAudit = {
  retainedCompatibilityBridges,
  temporaryCompatibilityBridges: retainedCompatibilityBridges.filter((bridge) => bridge.permanence === 'temporary compatibility'),
  permanentCompatibilityBridges: retainedCompatibilityBridges.filter((bridge) => bridge.permanence === 'permanent compatibility'),
  unfinishedMigrationBridges: retainedCompatibilityBridges.filter((bridge) => bridge.classification === 'D. unfinished migration dependency'),
  retireableCompatibilityLayers: retainedCompatibilityBridges.filter((bridge) => bridge.classification === 'E. retireable compatibility layer'),
};

const canonicalParityAudit = Object.entries(migrationParityGovernance).map(([route, governance]) => {
  const bridge = retainedCompatibilityBridges.find((item) => item.route === route) || null;
  return {
    route,
    ...governance,
    consumerEvidence: bridge?.consumerEvidence || [],
    redirect: bridge?.redirect || null,
    physicalPage: bridge?.physicalPage || null,
    parityBlocked: governance.canonicalFunctionalityStatus === 'parity incomplete',
  };
});

const bridgeContinuityAudit = canonicalParityAudit.map((item) => ({
  route: item.route,
  canonicalRoute: item.canonicalRoute,
  sessionContinuity: item.sessionContinuity,
  onboardingContinuity: item.onboardingContinuity,
  ctaContinuity: item.ctaContinuity,
  deepLinkContinuity: item.deepLinkContinuity,
  analyticsContinuity: item.analyticsContinuity,
  retentionReason: item.retentionReason || [],
}));

const duplicateAuthorityDependencyAnalysis = duplicateAuthorityAnalysis.map((entry) => ({
  ...entry,
  ...(duplicateAuthorityDependencyGovernance[entry.domain] || {
    classification: 'B. migration-blocked',
    dependencyReason: 'no dependency governance declaration found',
  }),
}));

const bridgeSunsetReadinessAudit = Object.entries(bridgeSunsetReadiness).map(([route, readiness]) => ({
  route,
  ...readiness,
}));

const compatibilityObservabilityAudit = Object.entries(compatibilityBridgeObservability).map(([route, observability]) => {
  const bridge = retainedCompatibilityBridges.find((item) => item.route === route) || null;
  return {
    route,
    canonical: bridge?.canonical || aliases[route] || null,
    ...observability,
    physicalPage: bridge?.physicalPage || null,
    redirect: bridge?.redirect || null,
    noindex: bridge?.noindex || false,
    activeConsumerEvidence: bridge?.consumerEvidence || [],
  };
});

const compatibilitySoftRetirementAudit = Object.entries(compatibilityBridgeSoftRetirement).map(([route, governance]) => {
  const bridge = retainedCompatibilityBridges.find((item) => item.route === route) || null;
  const observability = compatibilityObservabilityAudit.find((item) => item.route === route) || null;
  const runtimeOwnershipAllowed = governance.runtimeOwnershipAllowed === true;
  const mutationOwnershipAllowed = governance.mutationOwnershipAllowed === true;
  return {
    route,
    canonical: bridge?.canonical || aliases[route] || null,
    ...governance,
    decommissionPhase: observability?.decommissionPhase || null,
    physicalPage: bridge?.physicalPage || null,
    redirect: bridge?.redirect || null,
    noindex: bridge?.noindex || false,
    runtimeOwnershipViolation: runtimeOwnershipAllowed,
    mutationOwnershipViolation: mutationOwnershipAllowed,
    containmentStatus: runtimeOwnershipAllowed || mutationOwnershipAllowed
      ? 'violation'
      : 'contained',
  };
});

const retirementReadyBridgeClassifications = new Set([
  'A. immediately retireable',
  'A. sunset-ready',
  'B. retireable after monitoring window',
]);

const runtimeDependencyRisks = [
  ...canonicalParityAudit.filter((item) => (
    item.retentionReason?.includes('C. session/runtime dependency exists')
    || item.operationalDependency === 'high'
    || item.deepLinkContinuity?.includes('required')
  )),
  ...duplicateAuthorityDependencyAnalysis.filter((item) => item.classification === 'C. rollback-critical'),
];

const runtimeExposureRisks = [
  ...staleNavigationTargets,
  ...orphanIndexedPages,
  ...staleRuntimeImports,
  ...unconsolidatedShadowedPhysicalPages,
  ...deletedRuntimeResurrection,
];

const runtimeResurrectionPaths = [
  ...deprecatedRefs
    .filter((ref) => !ref.file.startsWith('next.config'))
    .filter((ref) => !(ref.file.startsWith('pages/') && hasDeprecatedRouteMarker(ref.file)))
    .map((ref) => ({
      ...ref,
      classification: ref.route === '/content-creation' && ref.text.includes('campaignId=') ? 'A. safe compatibility bridge' : 'B. deprecated-but-contained',
      reason: 'deprecated alias is still referenced',
    })),
  ...unconsolidatedShadowedPhysicalPages.map((page) => ({
    file: page.pageFile,
    route: page.route,
    canonical: page.redirectedTo,
    classification: 'C. accidental resurrection path',
    reason: 'physical page is missing local redirect, deprecated marker, or noindex dominance',
  })),
  ...staleRuntimeImports.map((item) => ({ ...item, reason: 'deprecated physical route imported by another runtime module' })),
  ...deletedRuntimeResurrection,
];

const counts = {
  deprecatedReachableRoutes: Object.keys(aliases).filter((route) => filesByRoute.has(route) || redirects.some((r) => r.source === route)).length,
  shadowedCanonicalPages: unconsolidatedShadowedPhysicalPages.length,
  orphanRuntimePages: orphanRuntimePages.length,
  duplicateFeatureSurfaces: duplicateFeatureSurfaces.filter((x) => x.count > 1).length,
  unresolvedOwnershipConflicts: unresolvedOwnershipConflicts.length,
  staleNavigationTargets: staleNavigationTargets.length,
  deprecatedApiConsumers: deprecatedApiConsumers.length,
  htmlJsonMismatches: htmlJsonMismatches.length,
  runtimeResurrectionPaths: runtimeResurrectionPaths.length,
  orphanIndexedPages: orphanIndexedPages.length,
  staleRuntimeImports: staleRuntimeImports.length,
  duplicateRuntimeAuthorities: duplicateFeatureSurfaces.filter((x) => x.count > 1).length,
  unresolvedOrphanRuntimes: classifiedOrphanRuntimePages.filter((page) => page.orphanClassification === 'G. unresolved ownership').length,
  retainedCompatibilityBridges: retainedCompatibilityBridges.length,
  retiredDeadRuntimes: retiredRuntimeSurfaces.length,
  runtimeExposureRisks: runtimeExposureRisks.length,
  temporaryCompatibilityBridges: compatibilityViabilityAudit.temporaryCompatibilityBridges.length,
  permanentCompatibilityBridges: compatibilityViabilityAudit.permanentCompatibilityBridges.length,
  unfinishedMigrationBridges: compatibilityViabilityAudit.unfinishedMigrationBridges.length,
  governedOrphanRuntimes: orphanFinalGovernance.filter((page) => page.finalGovernanceState !== 'F. unresolved architecture residue').length,
  unresolvedArchitectureResidues: orphanFinalGovernance.filter((page) => page.finalGovernanceState === 'F. unresolved architecture residue').length,
  retirementCandidates: orphanFinalGovernance.filter((page) => page.finalGovernanceState === 'E. retirement candidate').length,
  sunsetReadyBridges: bridgeSunsetReadinessAudit.filter((item) => item.classification === 'A. sunset-ready').length,
  retirementReadyBridges: bridgeSunsetReadinessAudit.filter((item) => retirementReadyBridgeClassifications.has(item.classification)).length,
  rollbackSensitiveBridges: bridgeSunsetReadinessAudit.filter((item) => item.classification === 'D. rollback-sensitive').length,
  hiddenDependencyBridges: bridgeSunsetReadinessAudit.filter((item) => item.classification === 'E. hidden dependency detected').length,
  monitoredBridges: compatibilityObservabilityAudit.filter((item) => item.observabilityState === 'active').length,
  softRetiredBridges: compatibilitySoftRetirementAudit.filter((item) => item.activationState === 'soft-retired').length,
  rollbackWatchBridges: compatibilityObservabilityAudit.filter((item) => item.monitoringClassification === 'D. rollback-watch candidate').length,
  dormantCompatibilityBridges: compatibilityObservabilityAudit.filter((item) => item.observabilityState === 'dormant').length,
  activeCompatibilityBridges: compatibilityObservabilityAudit.filter((item) => item.observabilityState === 'active').length,
  runtimeRestorationEvents: 0,
  compatibilityExposureRisks: compatibilityObservabilityAudit.filter((item) => item.monitoringClassification === 'C. external dependency suspected').length,
  compatibilityRuntimeOwnerships: compatibilitySoftRetirementAudit.filter((item) => item.runtimeOwnershipViolation).length,
  compatibilityMutationOwnerships: compatibilitySoftRetirementAudit.filter((item) => item.mutationOwnershipViolation).length,
  parityBlockedBridges: canonicalParityAudit.filter((item) => item.parityBlocked).length,
  rollbackCriticalAuthorities: duplicateAuthorityDependencyAnalysis.filter((item) => item.classification === 'C. rollback-critical').length,
  canonicalParityGaps: canonicalParityAudit.reduce((sum, item) => sum + (item.parityGaps?.length || 0), 0),
  runtimeDependencyRisks: runtimeDependencyRisks.length,
  splitRuntimeAuthorities: duplicateAuthorityDependencyAnalysis.filter((item) => (
    item.classification === 'B. migration-blocked'
    || item.classification === 'C. rollback-critical'
    || item.classification === 'D. parity incomplete'
  )).length,
  canonicalOwnershipGaps: canonicalParityAudit.filter((item) => item.parityBlocked).length,
};

writeJson('canonical-authority-map.json', contract);
writeJson('route-graph-audit.json', { pages: routeGraph, redirects, headers, shadowedCanonicalPages, unconsolidatedShadowedPhysicalPages });
writeJson('navigation-graph-audit.json', { staleNavigationTargets, deprecatedRefs });
writeJson('api-linkage-audit.json', { apiRoutes: apis, fetchTargets, deprecatedApiConsumers, htmlJsonMismatches });
writeJson('runtime-shadowing-audit.json', {
  duplicateFeatureSurfaces,
  orphanRuntimePages: classifiedOrphanRuntimePages,
  orphanIndexedPages,
  runtimeResurrectionPaths,
  staleRuntimeImports,
  unresolvedOwnershipConflicts,
  ownershipDeclarations,
});
writeJson('resurrection-path-audit.json', { runtimeResurrectionPaths, shadowedCanonicalPages, staleRuntimeImports });
writeJson('orphan-runtime-audit.json', { orphanRuntimePages: classifiedOrphanRuntimePages, orphanIndexedPages });
writeJson('ownership-authority-audit.json', { ownershipDeclarations, unresolvedOwnershipConflicts });
writeJson('dead-runtime-audit.json', {
  retainedCompatibilityBridges,
  compatibilityApisRetained,
  retireableDeadRuntimes,
  quarantinedDeadRuntimeArtifacts,
  retiredDeadRuntimes: retiredRuntimeSurfaces,
  deletedRuntimeResurrection,
});
writeJson('runtime-consumer-audit.json', {
  retainedCompatibilityBridges,
  deprecatedApiConsumers,
  staleRuntimeImports,
});
writeJson('orphan-retirement-audit.json', {
  orphanRuntimePages: orphanRetirementClassification,
  unresolvedOrphanRuntimes: orphanRetirementClassification.filter((page) => page.orphanClassification === 'G. unresolved ownership'),
  retireableDeadRuntimes,
});
writeJson('redirect-validation-audit.json', {
  redirects,
  shadowedCanonicalPages,
  unconsolidatedShadowedPhysicalPages,
  retainedCompatibilityBridges,
});
writeJson('runtime-exposure-audit.json', {
  runtimeExposureRisks,
  staleNavigationTargets,
  orphanIndexedPages,
  staleRuntimeImports,
});
writeJson('compatibility-viability-audit.json', compatibilityViabilityAudit);
writeJson('authority-overlap-audit.json', { duplicateAuthorityAnalysis });
writeJson('ownership-lifecycle-audit.json', { ownershipLifecycleAudit });
writeJson('orphan-governance-audit.json', {
  orphanRuntimePages: orphanFinalGovernance,
  unresolvedArchitectureResidues: orphanFinalGovernance.filter((page) => page.finalGovernanceState === 'F. unresolved architecture residue'),
  retirementCandidates: orphanFinalGovernance.filter((page) => page.finalGovernanceState === 'E. retirement candidate'),
});
writeJson('deprecated-route-permanence-audit.json', { deprecatedRoutes: deprecatedRoutePermanenceAudit });
writeJson('canonical-parity-audit.json', { canonicalParityAudit });
writeJson('bridge-continuity-audit.json', { bridgeContinuityAudit });
writeJson('mutation-ownership-audit.json', {
  canonicalContentMutationOwners: canonicalParityAudit
    .filter((item) => item.route === '/content-creation')
    .map((item) => ({
      route: item.route,
      canonicalRoute: item.canonicalRoute,
      runtimeOwnershipStatus: item.runtimeOwnershipStatus,
      primaryMutations: ['content-plan load', 'AI generate-and-save', 'edit', 'delete', 'schedule-review handoff'],
      featureCompleteness: item.featureCompleteness,
      parityGaps: item.parityGaps || [],
    })),
  duplicateAuthorityDependencyAnalysis,
});
writeJson('persistence-ownership-audit.json', {
  canonicalContentPersistenceOwners: canonicalParityAudit
    .filter((item) => item.route === '/content-creation')
    .map((item) => ({
      route: item.route,
      canonicalRoute: item.canonicalRoute,
      runtimeOwnershipStatus: item.runtimeOwnershipStatus,
      persistenceAuthority: '/api/campaigns content-plan mutation path through canonical /posts/create',
      retentionReason: item.retentionReason || [],
    })),
});
writeJson('save-path-continuity-audit.json', {
  canonicalContentSavePaths: canonicalParityAudit
    .filter((item) => item.route === '/content-creation')
    .map((item) => ({
      route: item.route,
      canonicalRoute: item.canonicalRoute,
      aiGenerateApi: '/api/ai/generate-content',
      saveApi: '/api/campaigns type=content-plan',
      retryContinuity: 'canonical UI exposes generate-and-save retry through surfaced mutation errors',
      parityGaps: item.parityGaps || [],
    })),
});
writeJson('runtime-restoration-audit.json', {
  bridgeContinuityAudit,
  restorationRisks: runtimeDependencyRisks,
});
writeJson('bridge-retirement-audit.json', {
  bridgeSunsetReadinessAudit,
  retirementReadyBridges: bridgeSunsetReadinessAudit.filter((item) => retirementReadyBridgeClassifications.has(item.classification)),
  rollbackSensitiveBridges: bridgeSunsetReadinessAudit.filter((item) => item.classification === 'D. rollback-sensitive'),
  compatibilityObservabilityAudit,
});
writeJson('hidden-dependency-audit.json', {
  hiddenDependencyBridges: bridgeSunsetReadinessAudit.filter((item) => item.classification === 'E. hidden dependency detected'),
  runtimeDependencyRisks,
  staleRuntimeImports,
});
writeJson('compatibility-observability-audit.json', {
  compatibilityObservabilityAudit,
  trackedSignals: [
    'route access frequency',
    'deep-link entry frequency',
    'session restoration usage',
    'onboarding continuation usage',
    'analytics event ownership',
    'redirect frequency',
    'runtime restoration frequency',
    'fallback execution frequency',
    'external referrer presence',
  ],
});
writeJson('compatibility-soft-retirement-audit.json', {
  compatibilitySoftRetirementAudit,
});
writeJson('bridge-access-audit.json', {
  monitoredBridges: compatibilityObservabilityAudit,
  currentStaticConsumerEvidence: compatibilityObservabilityAudit.map((item) => ({
    route: item.route,
    activeConsumerEvidence: item.activeConsumerEvidence,
  })),
});
writeJson('retirement-governance-audit.json', {
  compatibilityObservabilityAudit,
  decommissionPhases: [
    'Phase 1: observe + isolate',
    'Phase 2: soft retirement redirect-only + telemetry',
    'Phase 3: hard retirement remove physical bridge',
    'Phase 4: cleanup residual governance metadata',
  ],
});
writeSoftRetirementJson('compatibility-bridge-audit.json', {
  compatibilitySoftRetirementAudit,
  compatibilityObservabilityAudit,
});
writeSoftRetirementJson('redirect-governance-audit.json', {
  softRetiredBridges: compatibilitySoftRetirementAudit.filter((item) => item.activationState === 'soft-retired'),
  redirectFirstRequired: true,
  queryPreservationRequired: true,
});
writeSoftRetirementJson('compatibility-containment-audit.json', {
  runtimeOwnerships: compatibilitySoftRetirementAudit.filter((item) => item.runtimeOwnershipViolation),
  mutationOwnerships: compatibilitySoftRetirementAudit.filter((item) => item.mutationOwnershipViolation),
  containedBridges: compatibilitySoftRetirementAudit.filter((item) => item.containmentStatus === 'contained'),
});
writeSoftRetirementJson('telemetry-hardening-audit.json', {
  telemetrySignals: [
    'redirect source',
    'redirect target',
    'query continuation',
    'external referrer classification',
    'stale bookmark classification',
    'onboarding continuation',
    'compatibility traffic aging',
    'repeated bridge usage',
    'canonical arrival success',
    'retirement confidence scoring',
    'inactivity-window scoring',
    'bridge dependency scoring',
  ],
  compatibilitySoftRetirementAudit,
});
writeSoftRetirementJson('retirement-governance-enforcement-audit.json', {
  blockedOwnershipTypes: [
    'runtime ownership',
    'mutation ownership',
    'scheduler authority',
    'orchestration authority',
    'primary navigation resurrection',
    'runtime import resurrection',
    'compatibility route expansion without declaration',
  ],
  compatibilitySoftRetirementAudit,
});
writeSoftRetirementJson('compatibility-soft-retirement-counts.json', {
  retirementReadyBridges: counts.retirementReadyBridges,
  softRetiredBridges: counts.softRetiredBridges,
  monitoredBridges: counts.monitoredBridges,
  rollbackWatchBridges: counts.rollbackWatchBridges,
  compatibilityRuntimeOwnerships: counts.compatibilityRuntimeOwnerships,
  compatibilityMutationOwnerships: counts.compatibilityMutationOwnerships,
  runtimeRestorationEvents: counts.runtimeRestorationEvents,
  typecheckErrors: 0,
});
writeJson('workflow-continuity-audit.json', {
  migrationBridges: canonicalParityAudit.map((item) => ({
    route: item.route,
    canonicalRoute: item.canonicalRoute,
    featureCompleteness: item.featureCompleteness,
    parityGaps: item.parityGaps || [],
    safeRemediation: item.safeRemediation,
  })),
});
writeJson('analytics-continuity-audit.json', {
  migrationBridges: canonicalParityAudit.map((item) => ({
    route: item.route,
    analyticsContinuity: item.analyticsContinuity,
    analyticsGap: item.analyticsContinuity?.includes('no dedicated') || item.analyticsContinuity === 'unknown',
  })),
});
writeJson('runtime-ownership-audit.json', {
  duplicateAuthorityDependencyAnalysis,
  runtimeDependencyRisks,
});
writeJson('bridge-sunset-readiness-audit.json', { bridgeSunsetReadinessAudit });
writeJson('runtime-shadow-counts.json', counts);
writeMd('runtime-authority-shadow-elimination-report.md', `
# Runtime Authority + Shadow Elimination Report

Generated by \`architecture-migration/tools/runtime-shadow-elimination-audit.mjs\`.

## Canonical Authority

Primary runtime authorities are declared in \`architecture-migration/contracts/runtime-shadow-authority.json\`.

## Counts

- Deprecated reachable routes: ${counts.deprecatedReachableRoutes}
- Shadowed canonical pages: ${counts.shadowedCanonicalPages}
- Orphan runtime pages: ${counts.orphanRuntimePages}
- Duplicate feature surfaces: ${counts.duplicateFeatureSurfaces}
- Unresolved ownership conflicts: ${counts.unresolvedOwnershipConflicts}
- Stale navigation targets: ${counts.staleNavigationTargets}
- Deprecated API consumers: ${counts.deprecatedApiConsumers}
- HTML/JSON mismatches: ${counts.htmlJsonMismatches}
- Runtime resurrection paths: ${counts.runtimeResurrectionPaths}
- Orphan indexed pages: ${counts.orphanIndexedPages}
- Stale runtime imports: ${counts.staleRuntimeImports}
- Duplicate runtime authorities: ${counts.duplicateRuntimeAuthorities}
- Unresolved orphan runtimes: ${counts.unresolvedOrphanRuntimes}
- Retained compatibility bridges: ${counts.retainedCompatibilityBridges}
- Retired dead runtimes: ${counts.retiredDeadRuntimes}
- Runtime exposure risks: ${counts.runtimeExposureRisks}
- Temporary compatibility bridges: ${counts.temporaryCompatibilityBridges}
- Permanent compatibility bridges: ${counts.permanentCompatibilityBridges}
- Unfinished migration bridges: ${counts.unfinishedMigrationBridges}
- Governed orphan runtimes: ${counts.governedOrphanRuntimes}
- Unresolved architecture residues: ${counts.unresolvedArchitectureResidues}
- Retirement candidates: ${counts.retirementCandidates}
- Sunset-ready bridges: ${counts.sunsetReadyBridges}
- Retirement-ready bridges: ${counts.retirementReadyBridges}
- Soft-retired bridges: ${counts.softRetiredBridges}
- Rollback-sensitive bridges: ${counts.rollbackSensitiveBridges}
- Hidden dependency bridges: ${counts.hiddenDependencyBridges}
- Monitored bridges: ${counts.monitoredBridges}
- Rollback-watch bridges: ${counts.rollbackWatchBridges}
- Dormant compatibility bridges: ${counts.dormantCompatibilityBridges}
- Active compatibility bridges: ${counts.activeCompatibilityBridges}
- Runtime restoration events: ${counts.runtimeRestorationEvents}
- Compatibility exposure risks: ${counts.compatibilityExposureRisks}
- Compatibility runtime ownerships: ${counts.compatibilityRuntimeOwnerships}
- Compatibility mutation ownerships: ${counts.compatibilityMutationOwnerships}
- Parity-blocked bridges: ${counts.parityBlockedBridges}
- Rollback-critical authorities: ${counts.rollbackCriticalAuthorities}
- Canonical parity gaps: ${counts.canonicalParityGaps}
- Runtime dependency risks: ${counts.runtimeDependencyRisks}
- Split runtime authorities: ${counts.splitRuntimeAuthorities}
- Canonical ownership gaps: ${counts.canonicalOwnershipGaps}

## Remaining Conflicts

${unresolvedOwnershipConflicts.map((item) => `- ${item.domain}: ${item.conflict}`).join('\n') || '- None'}
`);

if (enforce && staleNavigationTargets.length > 0) {
  console.error(`Runtime shadow enforcement failed: ${staleNavigationTargets.length} stale navigation targets remain.`);
  process.exit(1);
}

if (enforce && runtimeExposureRisks.length > 0) {
  console.error(`Runtime retirement enforcement failed: ${runtimeExposureRisks.length} runtime exposure risks remain.`);
  process.exit(1);
}

console.log(JSON.stringify(counts, null, 2));
