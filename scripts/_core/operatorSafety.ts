type TargetEnvironment = 'local' | 'staging' | 'production';

type OperatorSafetyOptions = {
  scriptName: string;
  mutationTarget: string;
  intendedAction: string;
  example: string;
  args?: string[];
};

type OperatorSafetyDecision = {
  allowed: boolean;
  targetEnv: TargetEnvironment | null;
  dryRun: boolean;
  applyMode: boolean;
};

const MUTATION_INTENT_FLAGS = new Set([
  '--apply',
  '--execute',
  '--i-understand-this-mutates-data',
]);

const SAFETY_PREFIXES = [
  '--target-env=',
];

const SAFETY_FLAGS = new Set([
  '--apply',
  '--execute',
  '--i-understand-this-mutates-data',
  '--confirm-production-impact',
]);

// Operator governance stays console-only here: no telemetry, no runtime hooks.
function safeExit(reason: string, example: string): OperatorSafetyDecision {
  console.warn('');
  console.warn('[operator-safety] Refusing to continue before any mutation-capable logic runs.');
  console.warn(`[operator-safety] Reason: ${reason}`);
  console.warn('[operator-safety] Safe usage example:');
  console.warn(`  ${example}`);
  console.warn('');
  return { allowed: false, targetEnv: null, dryRun: true, applyMode: false };
}

export function getOperatorArgs(args = process.argv.slice(2)): string[] {
  return args.filter((arg) => !SAFETY_FLAGS.has(arg) && !SAFETY_PREFIXES.some((prefix) => arg.startsWith(prefix)));
}

export function requireExplicitMutationIntent(args = process.argv.slice(2)): boolean {
  return args.some((arg) => MUTATION_INTENT_FLAGS.has(arg));
}

export function requireTargetEnvironment(args = process.argv.slice(2)): TargetEnvironment | null {
  const raw = args.find((arg) => arg.startsWith('--target-env='))?.slice('--target-env='.length);
  if (raw === 'local' || raw === 'staging' || raw === 'production') return raw;
  return null;
}

export function requireProductionConfirmation(targetEnv: TargetEnvironment | null, args = process.argv.slice(2)): boolean {
  return targetEnv !== 'production' || args.includes('--confirm-production-impact');
}

export function detectRemoteSupabase(targetEnv: TargetEnvironment | null): void {
  const candidates = [
    process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_DB_URL,
    process.env.DATABASE_URL,
  ].filter(Boolean) as string[];

  const remote = candidates.find((value) => {
    const lower = value.toLowerCase();
    return !lower.includes('localhost')
      && !lower.includes('127.0.0.1')
      && !lower.includes('0.0.0.0')
      && !lower.includes('host.docker.internal')
      && !lower.includes('supabase_db_');
  });

  if (remote && targetEnv === 'local') {
    console.warn('[operator-safety] WARNING: target-env=local but Supabase connection does not look local.');
  } else if (remote) {
    console.warn('[operator-safety] WARNING: non-local Supabase connection detected.');
  }
}

export function printOperatorBanner(options: OperatorSafetyOptions, decision: OperatorSafetyDecision): void {
  console.log('========================================');
  console.log('OPERATOR MUTATION SCRIPT');
  console.log(`ENVIRONMENT: ${decision.targetEnv ?? 'unspecified'}`);
  console.log(`MUTATION TARGET: ${options.mutationTarget}`);
  console.log(`MUTATION CLASSIFICATION: ${options.mutationTarget}`);
  console.log(`DRY RUN: ${decision.dryRun ? 'yes' : 'no'}`);
  console.log('========================================');
  console.log(`[operator-safety] timestamp=${new Date().toISOString()}`);
  console.log(`[operator-safety] script=${options.scriptName}`);
  console.log(`[operator-safety] requested_environment=${decision.targetEnv ?? 'unspecified'}`);
  console.log(`[operator-safety] mode=${decision.applyMode ? 'apply' : 'dry-run'}`);
  console.log(`[operator-safety] mutation_classification=${options.mutationTarget}`);
  console.log('');
}

export function enforceOperatorSafety(options: OperatorSafetyOptions): OperatorSafetyDecision {
  const args = options.args ?? process.argv.slice(2);
  const targetEnv = requireTargetEnvironment(args);
  const applyMode = requireExplicitMutationIntent(args);
  const decision: OperatorSafetyDecision = {
    allowed: false,
    targetEnv,
    dryRun: !applyMode,
    applyMode,
  };

  printOperatorBanner(options, decision);

  if (!targetEnv) {
    return safeExit('Missing --target-env=local|staging|production.', options.example);
  }

  detectRemoteSupabase(targetEnv);

  if (!requireProductionConfirmation(targetEnv, args)) {
    return safeExit('target-env=production requires --confirm-production-impact.', options.example);
  }

  if (!applyMode) {
    console.warn(`[operator-safety] Intended action preview: ${options.intendedAction}`);
    return safeExit('Missing explicit mutation intent flag: --apply, --execute, or --i-understand-this-mutates-data.', options.example);
  }

  return { ...decision, allowed: true };
}
