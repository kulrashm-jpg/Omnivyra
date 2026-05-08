import { createCreatorExecutionEngine } from './creatorExecutionEngine';
import { createTextExecutionEngine } from './textExecutionEngine';

export type ExecutionEngineMode = string | undefined;

export function getExecutionEngine(mode: ExecutionEngineMode) {
  if (mode === 'creator') return createCreatorExecutionEngine();
  return createTextExecutionEngine();
}
