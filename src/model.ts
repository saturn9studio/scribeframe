export interface Paragraph {
  readonly text: string;
}

export interface EditorDocument {
  readonly paragraphs: readonly Paragraph[];
}

export interface Position {
  readonly paragraph: number;
  readonly offset: number;
}

export interface Selection {
  readonly anchor: Position;
  readonly head: Position;
}

export interface Range {
  readonly from: Position;
  readonly to: Position;
}

interface Segment {
  readonly index: number;
  readonly segment: string;
}

interface SegmenterLike {
  segment(input: string): Iterable<Segment>;
}

type IntlWithSegmenter = typeof Intl & {
  Segmenter?: new (
    locale?: string | string[],
    options?: { granularity: "grapheme" },
  ) => SegmenterLike;
};

const createSegmenter = (): SegmenterLike | null => {
  const intl = Intl as IntlWithSegmenter;
  return intl.Segmenter
    ? new intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
};

const segmenter = createSegmenter();

export const paragraph = (text = ""): Paragraph => ({ text });

export const createDocument = (
  paragraphs: readonly Paragraph[] = [paragraph()],
): EditorDocument => ({
  paragraphs: paragraphs.length > 0 ? [...paragraphs] : [paragraph()],
});

export const documentFromText = (text: string): EditorDocument =>
  createDocument(text.split("\n").map((line) => paragraph(line)));

export const documentToText = (doc: EditorDocument): string =>
  doc.paragraphs.map((item) => item.text).join("\n");

export const comparePositions = (a: Position, b: Position): number =>
  a.paragraph === b.paragraph ? a.offset - b.offset : a.paragraph - b.paragraph;

export const isSamePosition = (a: Position, b: Position): boolean =>
  a.paragraph === b.paragraph && a.offset === b.offset;

export const selectionIsCollapsed = (selection: Selection): boolean =>
  isSamePosition(selection.anchor, selection.head);

export const normalizeRange = (selection: Selection): Range =>
  comparePositions(selection.anchor, selection.head) <= 0
    ? { from: selection.anchor, to: selection.head }
    : { from: selection.head, to: selection.anchor };

export const collapsedSelection = (position: Position): Selection => ({
  anchor: position,
  head: position,
});

export const firstPosition = (): Position => ({ paragraph: 0, offset: 0 });

export const lastPosition = (doc: EditorDocument): Position => {
  const paragraphIndex = Math.max(0, doc.paragraphs.length - 1);
  return {
    paragraph: paragraphIndex,
    offset: doc.paragraphs[paragraphIndex]?.text.length ?? 0,
  };
};

export const clampPosition = (
  doc: EditorDocument,
  position: Position,
): Position => {
  const paragraphIndex = Math.min(
    Math.max(position.paragraph, 0),
    Math.max(0, doc.paragraphs.length - 1),
  );
  const target = doc.paragraphs[paragraphIndex] ?? paragraph();
  return {
    paragraph: paragraphIndex,
    offset: Math.min(Math.max(position.offset, 0), target.text.length),
  };
};

export const clampSelection = (
  doc: EditorDocument,
  selection: Selection,
): Selection => ({
  anchor: clampPosition(doc, selection.anchor),
  head: clampPosition(doc, selection.head),
});

export const absoluteOffset = (
  doc: EditorDocument,
  position: Position,
): number => {
  const clamped = clampPosition(doc, position);
  return doc.paragraphs
    .slice(0, clamped.paragraph)
    .reduce((total, item) => total + item.text.length + 1, clamped.offset);
};

export const positionFromOffset = (
  doc: EditorDocument,
  offset: number,
): Position => {
  let remaining = Math.max(0, offset);

  for (let index = 0; index < doc.paragraphs.length; index += 1) {
    const item = doc.paragraphs[index];
    if (remaining <= item.text.length) {
      return { paragraph: index, offset: remaining };
    }
    remaining -= item.text.length + 1;
  }

  return lastPosition(doc);
};

export const paragraphAbsoluteRange = (
  doc: EditorDocument,
  paragraphIndex: number,
): { from: number; to: number } => {
  const from = absoluteOffset(doc, { paragraph: paragraphIndex, offset: 0 });
  const item = doc.paragraphs[paragraphIndex] ?? paragraph();
  return { from, to: from + item.text.length };
};

export const textInRange = (
  doc: EditorDocument,
  selection: Selection,
): string => {
  const { from, to } = normalizeRange(selection);
  const normalized = {
    from: absoluteOffset(doc, from),
    to: absoluteOffset(doc, to),
  };
  return documentToText(doc).slice(normalized.from, normalized.to);
};

export const previousGraphemeOffset = (
  text: string,
  offset: number,
): number => {
  const target = Math.max(0, Math.min(offset, text.length));
  if (target === 0) return 0;

  if (!segmenter) return target - 1;

  let previous = 0;
  for (const segment of segmenter.segment(text)) {
    if (segment.index >= target) break;
    previous = segment.index;
  }

  return previous;
};

export const nextGraphemeOffset = (text: string, offset: number): number => {
  const target = Math.max(0, Math.min(offset, text.length));
  if (target === text.length) return text.length;

  if (!segmenter) return target + 1;

  for (const segment of segmenter.segment(text)) {
    const end = segment.index + segment.segment.length;
    if (end > target) return end;
  }

  return text.length;
};

const isWhitespace = (text: string): boolean => /\s/u.test(text);

export const previousWordOffset = (text: string, offset: number): number => {
  let current = Math.max(0, Math.min(offset, text.length));
  if (current === 0) return 0;

  let previous = previousGraphemeOffset(text, current);
  while (current > 0 && isWhitespace(text.slice(previous, current))) {
    current = previous;
    previous = previousGraphemeOffset(text, current);
  }

  while (current > 0) {
    previous = previousGraphemeOffset(text, current);
    if (isWhitespace(text.slice(previous, current))) break;
    current = previous;
  }

  return current;
};

export const nextWordOffset = (text: string, offset: number): number => {
  let current = Math.max(0, Math.min(offset, text.length));
  if (current === text.length) return text.length;

  let next = nextGraphemeOffset(text, current);
  while (current < text.length && isWhitespace(text.slice(current, next))) {
    current = next;
    next = nextGraphemeOffset(text, current);
  }

  while (current < text.length) {
    next = nextGraphemeOffset(text, current);
    if (isWhitespace(text.slice(current, next))) break;
    current = next;
  }

  return current;
};

export const previousPosition = (
  doc: EditorDocument,
  position: Position,
): Position => {
  const current = clampPosition(doc, position);
  const item = doc.paragraphs[current.paragraph] ?? paragraph();

  if (current.offset > 0) {
    return {
      paragraph: current.paragraph,
      offset: previousGraphemeOffset(item.text, current.offset),
    };
  }

  if (current.paragraph === 0) return current;

  const previous = doc.paragraphs[current.paragraph - 1] ?? paragraph();
  return { paragraph: current.paragraph - 1, offset: previous.text.length };
};

export const previousWordPosition = (
  doc: EditorDocument,
  position: Position,
): Position => {
  const current = clampPosition(doc, position);
  const item = doc.paragraphs[current.paragraph] ?? paragraph();

  if (current.offset > 0) {
    return {
      paragraph: current.paragraph,
      offset: previousWordOffset(item.text, current.offset),
    };
  }

  if (current.paragraph === 0) return current;

  const previous = doc.paragraphs[current.paragraph - 1] ?? paragraph();
  return { paragraph: current.paragraph - 1, offset: previous.text.length };
};

export const nextPosition = (
  doc: EditorDocument,
  position: Position,
): Position => {
  const current = clampPosition(doc, position);
  const item = doc.paragraphs[current.paragraph] ?? paragraph();

  if (current.offset < item.text.length) {
    return {
      paragraph: current.paragraph,
      offset: nextGraphemeOffset(item.text, current.offset),
    };
  }

  if (current.paragraph >= doc.paragraphs.length - 1) return current;

  return { paragraph: current.paragraph + 1, offset: 0 };
};

export const nextWordPosition = (
  doc: EditorDocument,
  position: Position,
): Position => {
  const current = clampPosition(doc, position);
  const item = doc.paragraphs[current.paragraph] ?? paragraph();

  if (current.offset < item.text.length) {
    return {
      paragraph: current.paragraph,
      offset: nextWordOffset(item.text, current.offset),
    };
  }

  if (current.paragraph >= doc.paragraphs.length - 1) return current;

  return { paragraph: current.paragraph + 1, offset: 0 };
};
