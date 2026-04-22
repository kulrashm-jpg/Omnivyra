import { createCreatorExecutionEngine } from './creatorExecutionEngine';
import { createTextExecutionEngine } from './textExecutionEngine';

export type ExecutionEngineMode = 'text' | 'creator' | 'combined' | 'creator_dependent' | string | undefined;

export function getExecutionEngine(mode: ExecutionEngineMode) {
  if (mode === 'creator') return createCreatorExecutionEngine();
  return createTextExecutionEngine();
}
