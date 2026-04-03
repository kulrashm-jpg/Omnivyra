import { AsyncLocalStorage } from 'node:async_hooks';

type IntelligenceExecutionContext = {
  mode: 'background_job' | 'api_read';
  source: string;
};

const store = new AsyncLocalStorage<IntelligenceExecutionContext>();

export async function runInBackgroundJobContext<T>(source: string, task: () => Promise<T>): Promise<T> {
  return store.run({ mode: 'background_job', source }, task);
}

export async function runInApiReadContext<T>(source: string, task: () => Promise<T>): Promise<T> {
  return store.run({ mode: 'api_read', source }, task);
}

export function assertBackgroundJobContext(serviceName: string): void {
  const current = store.getStore();
  if (!current || current.mode !== 'background_job') {
    throw new Error(`${serviceName} can only run inside a background job context.`);
  }
}

export function assertApiReadContext(serviceName: string): void {
  const current = store.getStore();
  if (!current || current.mode !== 'api_read') {
    throw new Error(`${serviceName} can only run inside an API read context.`);
  }
}
