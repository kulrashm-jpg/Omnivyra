import type {
  BlockFormat,
  BlockListStyle,
  BlockSurface,
  BlockTextAlign,
  BlockTone,
  BlockWeight,
  ContentBlock,
} from './blockTypes';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const ALIGN_CLASS: Record<BlockTextAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
};

const WEIGHT_CLASS: Record<BlockWeight, string> = {
  regular: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
};

const TONE_CLASS: Record<BlockTone, string> = {
  default: 'text-[#3D4F61]',
  brand: 'text-[#0B1F33]',
  muted: 'text-[#6B7C93]',
  accent: 'text-[#0A66C2]',
  success: 'text-emerald-700',
  warning: 'text-amber-800',
  danger: 'text-red-700',
};

const SURFACE_CLASS: Record<BlockSurface, string> = {
  none: '',
  subtle: 'bg-gray-50',
  soft: 'rounded-2xl border border-gray-200 bg-white/80 px-5 py-4',
  strong: 'rounded-2xl border border-[#0A66C2]/15 bg-[#F5F9FF] px-5 py-4',
};

const INDENT_CLASS: Record<0 | 1 | 2 | 3, string> = {
  0: '',
  1: 'ml-4',
  2: 'ml-8',
  3: 'ml-12',
};

const SPACING_CLASS = {
  top: {
    none: '',
    xs: 'mt-1',
    sm: 'mt-3',
    md: 'mt-6',
    lg: 'mt-10',
  },
  bottom: {
    none: '',
    xs: 'mb-1',
    sm: 'mb-3',
    md: 'mb-6',
    lg: 'mb-10',
  },
} as const;

const LIST_STYLE_CLASS: Record<BlockListStyle, string> = {
  default: '',
  disc: 'list-disc',
  circle: 'list-[circle]',
  square: 'list-[square]',
  decimal: 'list-decimal',
  'upper-roman': 'list-[upper-roman]',
};

export function getBlockFormat(block: ContentBlock): BlockFormat {
  return block.format ?? {};
}

export function getFormattedBlockClass(
  block: ContentBlock,
  baseClass = '',
): string {
  const format = getBlockFormat(block);
  return cx(
    baseClass,
    format.align ? ALIGN_CLASS[format.align] : '',
    format.weight ? WEIGHT_CLASS[format.weight] : '',
    format.tone ? TONE_CLASS[format.tone] : '',
    format.surface ? SURFACE_CLASS[format.surface] : '',
    typeof format.indent === 'number' ? INDENT_CLASS[format.indent] : '',
    format.spacingTop ? SPACING_CLASS.top[format.spacingTop] : '',
    format.spacingBottom ? SPACING_CLASS.bottom[format.spacingBottom] : '',
    format.lead ? 'text-[1.125rem] leading-8' : '',
  );
}

export function getFormattedListClass(
  block: ContentBlock,
  baseClass = '',
): string {
  const format = getBlockFormat(block);
  return cx(
    getFormattedBlockClass(block, baseClass),
    format.listStyle ? LIST_STYLE_CLASS[format.listStyle] : '',
  );
}

export function withBlockFormat<T extends ContentBlock>(block: T, format: Partial<BlockFormat>): T {
  return {
    ...block,
    format: {
      ...(block.format ?? {}),
      ...format,
    },
  };
}
