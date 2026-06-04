import { documentToText, type EditorDocument } from "@saturn9/scribeframe";

export type ProjectionBias = -1 | 1;

export interface OffsetRange {
  readonly from: number;
  readonly to: number;
}

export interface TextProjection {
  readonly displayText: string;
  readonly markdownText: string;
  displayToMarkdown(offset: number): number;
  markdownToDisplay(offset: number, bias?: ProjectionBias): number;
  displayRangeToMarkdown(range: OffsetRange): OffsetRange;
  markdownRangeToDisplay(range: OffsetRange): OffsetRange;
}

const clampOffset = (text: string, offset: number): number =>
  Math.min(Math.max(offset, 0), text.length);

export const buildTextProjection = (doc: EditorDocument): TextProjection => {
  const text = documentToText(doc);

  return {
    displayText: text,
    markdownText: text,
    displayToMarkdown(offset) {
      return clampOffset(text, offset);
    },
    markdownToDisplay(offset) {
      return clampOffset(text, offset);
    },
    displayRangeToMarkdown(range) {
      return {
        from: this.displayToMarkdown(range.from),
        to: this.displayToMarkdown(range.to),
      };
    },
    markdownRangeToDisplay(range) {
      return {
        from: this.markdownToDisplay(range.from),
        to: this.markdownToDisplay(range.to),
      };
    },
  };
};
