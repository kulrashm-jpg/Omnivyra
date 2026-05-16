import { collectAuthDiagnostics } from '../auth/authDiagnostics';
import { collectEnvironmentDiagnostics } from '../environment/environmentDiagnostics';
import { collectOperatorDiagnostics } from '../operator/operatorDiagnostics';
import { buildReport, loadLocalEnvForDiagnostics, printReport, type DiagnosticCheck } from '../_shared';
import { collectStartupDiagnostics } from './startupDiagnostics';

function compact(checks: DiagnosticCheck[], prefix: string): DiagnosticCheck[] {
  return checks.map((check) => ({
    ...check,
    name: `${prefix}.${check.name}`,
    details: check.details?.slice(0, 10),
  }));
}

export function collectRuntimeDriftSnapshot(): DiagnosticCheck[] {
  return [
    ...compact(collectStartupDiagnostics(), 'startup'),
    ...compact(collectAuthDiagnostics(), 'auth'),
    ...compact(collectEnvironmentDiagnostics(), 'environment'),
    ...compact(collectOperatorDiagnostics(), 'operator'),
  ];
}

export function runRuntimeDriftSnapshot(): void {
  loadLocalEnvForDiagnostics();
  printReport(buildReport('runtime-drift-snapshot', collectRuntimeDriftSnapshot()));
}

if (require.main === module) {
  runRuntimeDriftSnapshot();
}
