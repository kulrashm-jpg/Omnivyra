export type AiOperationType =
  | 'campaign_planning'
  | 'content_master_generation'
  | 'content_variant_generation'
  | 'recommendation_generation'
  | 'schedule_assistance';

export type AiExecutionRequest<TInput = Record<string, unknown>> = {
  organizationId: string;
  companyId: string;
  operationType: AiOperationType;
  schemaVersion: string;
  inputFingerprint: string;
  input: TInput;
};

export type AiExecutionResult<TOutput = Record<string, unknown>> = {
  operationId: string;
  operationType: AiOperationType;
  outputFingerprint: string;
  output: TOutput;
};

export interface AiExecutionContract {
  run<TInput, TOutput>(request: AiExecutionRequest<TInput>): Promise<AiExecutionResult<TOutput>>;
}
