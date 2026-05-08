import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const trueRiskDir = path.join(root, 'architecture-migration', 'reports', 'forensic-rebaseline');
const trueRiskBaselinePath = path.join(trueRiskDir, 'true-risk-enforcement-baseline.json');
const phase6BaselinePath = path.join(root, 'architecture-migration', 'reports', 'phase6-baseline-warning-counts.json');
const phase5BaselinePath = path.join(root, 'architecture-migration', 'reports', 'phase5-baseline-warning-counts.json');
const phase4BaselinePath = path.join(root, 'architecture-migration', 'reports', 'phase4-baseline-warning-counts.json');
const phase3BaselinePath = path.join(root, 'architecture-migration', 'reports', 'phase3-baseline-warning-counts.json');
const phase2BaselinePath = path.join(root, 'architecture-migration', 'reports', 'phase2-baseline-warning-counts.json');
const phase1BaselinePath = path.join(root, 'architecture-migration', 'reports', 'phase1', 'warning-counts.json');
const baselinePath = fs.existsSync(phase6BaselinePath)
  ? phase6BaselinePath
  : fs.existsSync(phase5BaselinePath)
    ? phase5BaselinePath
  : fs.existsSync(phase4BaselinePath)
    ? phase4BaselinePath
  : fs.existsSync(phase3BaselinePath)
    ? phase3BaselinePath
  : fs.existsSync(phase2BaselinePath)
    ? phase2BaselinePath
    : fs.existsSync(phase1BaselinePath)
    ? phase1BaselinePath
    : path.join(root, 'architecture-migration', 'reports', 'warning-counts.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

run('node', ['architecture-migration/tools/stabilization-audit.mjs']);
run('node', ['architecture-migration/tools/ownership-risk-audit.mjs']);
let semanticTrustFailure = null;
try {
  run('node', ['architecture-migration/tools/semantic-enforcement-engine.mjs', '--enforce']);
} catch (error) {
  semanticTrustFailure = error.stderr?.toString?.() || error.stdout?.toString?.() || error.message;
}

const currentPath = path.join(root, 'architecture-migration', 'reports', 'warning-counts.json');
const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
const trueRiskCurrentPath = path.join(trueRiskDir, 'true-risk-baseline.json');
const trueRiskCurrent = JSON.parse(fs.readFileSync(trueRiskCurrentPath, 'utf8'));
const trueRiskBaseline = fs.existsSync(trueRiskBaselinePath)
  ? JSON.parse(fs.readFileSync(trueRiskBaselinePath, 'utf8'))
  : trueRiskCurrent;
const failures = [];

if (semanticTrustFailure) {
  failures.push(`semanticEnforcementTrust=failed; ${semanticTrustFailure.slice(0, 500)}`);
}

if (current.frontendBackendImports !== 0) {
  failures.push(`frontendBackendImports=${current.frontendBackendImports}; expected 0`);
}
if (current.deprecatedRoutes !== 0) {
  failures.push(`deprecatedRoutes=${current.deprecatedRoutes}; expected 0`);
}
if (current.variantContamination !== 0) {
  failures.push(`variantContamination=${current.variantContamination}; expected 0`);
}
for (const key of [
  'runtimeDbWriteRisks',
  'trueDuplicateOrchestrationOwners',
  'runtimeDependencyCycles',
  'mixedRuntimeOversizedFiles'
]) {
  if (trueRiskCurrent[key] > trueRiskBaseline[key]) {
    failures.push(`${key}=${trueRiskCurrent[key]}; true-risk baseline ${trueRiskBaseline[key]}`);
  }
}
if ((trueRiskCurrent.p0?.unsafeAnyPropagation ?? 0) > (trueRiskBaseline.p0?.unsafeAnyPropagation ?? 0)) {
  failures.push(`unsafeAnyPropagation=${trueRiskCurrent.p0.unsafeAnyPropagation}; true-risk baseline ${trueRiskBaseline.p0.unsafeAnyPropagation}`);
}

if (failures.length > 0) {
  console.error(JSON.stringify({ status: 'failed', failures, current, baseline, trueRiskCurrent, trueRiskBaseline }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ status: 'passed', current, baseline, trueRiskCurrent, trueRiskBaseline }, null, 2));
