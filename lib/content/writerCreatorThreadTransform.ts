import type { SourceTextTransform } from './writerCreatorAttachmentContracts';

export type ThreadTransformResult = {
  transform: SourceTextTransform;
  items: string[];
  complementaryOnly: boolean;
};

function cleanSegment(value: unknown): string {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSource(value: string): string[] {
  return value
    .split(/\n{2,}|\n(?=\d+[\).\s])|(?<=[.!?])\s+/)
    .map(cleanSegment)
    .filter((segment) => segment.length >= 12)
    .slice(0, 12);
}

function summarize(value: string): string {
  const words = cleanSegment(value).split(' ').filter(Boolean);
  return words.slice(0, 18).join(' ');
}

function boundedQuote(value: string): string {
  const words = cleanSegment(value).replace(/^["']|["']$/g, '').split(' ').filter(Boolean);
  return words.slice(0, 22).join(' ');
}

export function transformThreadForVisual(input: {
  sourceText: string;
  transform: SourceTextTransform;
}): ThreadTransformResult {
  const segments = splitSource(input.sourceText);
  if (input.transform === 'support_visual_only' || input.transform === 'none') {
    return {
      transform: input.transform,
      items: [],
      complementaryOnly: true,
    };
  }

  if (input.transform === 'quote') {
    const quote = segments
      .map((segment) => boundedQuote(segment))
      .find((segment) => segment.length <= 140) ?? boundedQuote(segments[0] || input.sourceText);
    return { transform: input.transform, items: quote ? [quote] : [], complementaryOnly: false };
  }

  if (input.transform === 'framework') {
    return {
      transform: input.transform,
      items: segments.slice(0, 5).map((segment, index) => {
        const labels = ['Context', 'Shift', 'Mechanism', 'Proof', 'Action'];
        return `${labels[index] || `Pillar ${index + 1}`}: ${summarize(segment)}`;
      }),
      complementaryOnly: false,
    };
  }

  if (input.transform === 'extract_points') {
    return {
      transform: input.transform,
      items: segments.slice(0, 6).map((segment) => summarize(segment)),
      complementaryOnly: false,
    };
  }

  return {
    transform: 'summarize',
    items: segments.slice(0, 5).map((segment) => summarize(segment)),
    complementaryOnly: false,
  };
}

export class ThreadVisualTransformationEngine {
  transform(input: { sourceText: string; transform: SourceTextTransform }): ThreadTransformResult {
    return transformThreadForVisual(input);
  }
}

export function containsDirectThreadDuplication(input: {
  rawSourceText: string;
  visualItems: string[];
}): boolean {
  const rawSegments = splitSource(input.rawSourceText).map((segment) => segment.toLowerCase());
  return input.visualItems.some((item) => {
    const normalized = cleanSegment(item).toLowerCase();
    return normalized.length >= 24 && rawSegments.includes(normalized);
  });
}
