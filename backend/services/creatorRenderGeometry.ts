export type LayoutBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  text?: string;
  role?: string;
};

export type GeometryValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  boxes: LayoutBox[];
  contrastRatio?: number;
};

function overlaps(a: LayoutBox, b: LayoutBox): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const values = [0, 2, 4].map((offset) => parseInt(clean.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = values.map((value) => (
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  ));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(foreground) || !/^#[0-9a-f]{6}$/i.test(background)) return 4.5;
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

export function estimateTextBox(input: {
  id: string;
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  fontSize: number;
  maxLines: number;
  role?: string;
}): LayoutBox {
  const charsPerLine = Math.max(1, Math.floor(input.maxWidth / Math.max(1, input.fontSize * 0.56)));
  const lineCount = Math.max(1, Math.min(input.maxLines, Math.ceil(input.text.length / charsPerLine)));
  return {
    id: input.id,
    x: input.x,
    y: input.y,
    width: input.maxWidth,
    height: Math.ceil(lineCount * input.fontSize * 1.28),
    fontSize: input.fontSize,
    text: input.text,
    role: input.role,
  };
}

export function validateLayoutGeometry(input: {
  width: number;
  height: number;
  boxes: LayoutBox[];
  minFontSize?: number;
  safePadding?: number;
  foreground?: string;
  background?: string;
}): GeometryValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const minFontSize = input.minFontSize ?? 18;
  const safePadding = input.safePadding ?? 48;
  const contrast = input.foreground && input.background
    ? contrastRatio(input.foreground, input.background)
    : undefined;

  for (const box of input.boxes) {
    if (box.x < safePadding || box.y < safePadding || box.x + box.width > input.width - safePadding || box.y + box.height > input.height - safePadding) {
      errors.push(`overflow:${box.id}`);
    }
    if (typeof box.fontSize === 'number' && box.fontSize < minFontSize) {
      errors.push(`tiny_typography:${box.id}`);
    }
    if (box.text && box.text.length > 0 && box.height <= 0) {
      errors.push(`unmeasured_text:${box.id}`);
    }
  }

  for (let i = 0; i < input.boxes.length; i += 1) {
    for (let j = i + 1; j < input.boxes.length; j += 1) {
      if (overlaps(input.boxes[i], input.boxes[j])) {
        errors.push(`collision:${input.boxes[i].id}:${input.boxes[j].id}`);
      }
    }
  }

  if (typeof contrast === 'number' && contrast < 4.5) {
    errors.push('contrast_below_accessibility_threshold');
  } else if (typeof contrast === 'number' && contrast < 7) {
    warnings.push('contrast_below_enhanced_threshold');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    boxes: input.boxes,
    contrastRatio: contrast,
  };
}
