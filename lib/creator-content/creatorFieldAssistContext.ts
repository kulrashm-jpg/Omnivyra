export type CreatorFieldAssistContext = {
  workflowType: string | null;
  companyId: string | null;
  activeTemplateId: string | null;
  routedTemplateId: string | null;
  answers: object;
  templateValues: object;
  writerSource: object | null;
};

export type CreatorFieldAssistContextVersion = {
  revision: number;
  context: CreatorFieldAssistContext;
};

export function advanceCreatorFieldAssistContext(
  current: CreatorFieldAssistContextVersion,
  next: CreatorFieldAssistContext,
): CreatorFieldAssistContextVersion {
  const previous = current.context;
  const unchanged =
    previous.workflowType === next.workflowType
    && previous.companyId === next.companyId
    && previous.activeTemplateId === next.activeTemplateId
    && previous.routedTemplateId === next.routedTemplateId
    && previous.answers === next.answers
    && previous.templateValues === next.templateValues
    && previous.writerSource === next.writerSource;

  return unchanged ? current : { revision: current.revision + 1, context: next };
}
