import {
  type BlockDecoration,
  type EditorDecoration,
  type InlineDecoration,
  type WidgetContext,
  type WidgetDecoration,
  type WidgetHandle,
  type WidgetRenderer,
  absoluteOffset,
  collapsedSelection,
  documentToText,
  type EditorDocument,
  type EditorPlugin,
  type Position,
  PluginId,
  type Range,
  positionFromOffset,
  type SyntaxSnapshot,
} from "@saturn9/scribeframe";
import {
  isMarkdownSyntaxSnapshot,
  requireMarkdownSyntaxSnapshot,
  type MarkdownSyntaxSnapshot,
  type MarkdownSyntaxTokenView,
} from "./syntax";

interface EmptyPluginState {
  readonly version: 0;
}

const emptyState: EmptyPluginState = { version: 0 };

export const markdownPluginId = new PluginId<EmptyPluginState>("markdown");
export const codeBlockWidgetPluginId =
  new PluginId<EmptyPluginState>("code-block-widgets");

const inline = (
  from: number,
  to: number,
  className: string,
): InlineDecoration => ({
  kind: "inline",
  from,
  to,
  attrs: { class: className },
});

const block = (paragraph: number, className: string): BlockDecoration => ({
  kind: "block",
  paragraph,
  attrs: { class: className },
});

const rangesForPattern = (
  text: string,
  pattern: RegExp,
  className: string,
): InlineDecoration[] =>
  [...text.matchAll(pattern)].flatMap((match) => {
    if (match.index === undefined) return [];
    const full = match[0];
    const markerLength = full.startsWith("**") || full.startsWith("==") ? 2 : 1;
    const from = match.index;
    const to = from + full.length;
    return [
      inline(from, from + markerLength, "s9-md-markup"),
      inline(from + markerLength, to - markerLength, className),
      inline(to - markerLength, to, "s9-md-markup"),
    ];
  });

const markdownSyntax = (syntax: SyntaxSnapshot): MarkdownSyntaxSnapshot => {
  if (isMarkdownSyntaxSnapshot(syntax)) return syntax;
  return requireMarkdownSyntaxSnapshot(syntax);
};

const headingMarkerRange = (
  syntax: MarkdownSyntaxSnapshot,
  token: MarkdownSyntaxTokenView,
): { readonly from: number; readonly to: number } | null => {
  const source = syntax.projection.markdownText.slice(
    token.sourceRange.from,
    token.sourceRange.to,
  );
  const match = source.match(/^( {0,3})(#{1,6})(?:[ \t]|$)/);
  if (!match) return null;

  const sourceFrom = token.sourceRange.from + match[1].length;
  const sourceTo = sourceFrom + match[2].length;
  return syntax.projection.markdownRangeToDisplay({
    from: sourceFrom,
    to: sourceTo,
  });
};

export const markdownPlugin = (): EditorPlugin<EmptyPluginState> => ({
  id: markdownPluginId,
  init: () => emptyState,
  apply: () => emptyState,
  decorations: ({ doc, syntax }) => {
    const text = documentToText(doc);
    const snapshot = markdownSyntax(syntax);
    const headingDecorations = snapshot.tokenViews.flatMap((token) => {
      if (token.kind !== "heading") return [];
      const range = token.displayRange;
      const marker = headingMarkerRange(snapshot, token);
      return [
        block(positionFromOffset(doc, range.from).paragraph, "s9-md-heading-block"),
        ...(marker ? [inline(marker.from, marker.to, "s9-md-markup")] : []),
      ];
    });

    return [
      ...headingDecorations,
      ...rangesForPattern(text, /\*\*[^*\n]+?\*\*/g, "s9-md-strong"),
      ...rangesForPattern(text, /(?<!\*)\*[^*\n]+?\*(?!\*)/g, "s9-md-em"),
      ...rangesForPattern(text, /==[^=\n]+?==/g, "s9-md-highlight"),
    ];
  },
});

interface CodeBlockInstance {
  readonly key: `code-block-widgets:${string}`;
  readonly range: Range;
  readonly markup: string;
  readonly language: string;
  readonly content: string;
}

const findCodeBlocks = (
  doc: EditorDocument,
  syntax: SyntaxSnapshot,
): CodeBlockInstance[] => {
  const snapshot = markdownSyntax(syntax);

  return snapshot.tokenViews
    .filter((token) => token.kind === "fence")
    .map((token) => {
      const range = selectionFromAbsoluteRange(
        doc,
        token.displayRange.from,
        token.displayRange.to,
      );
      return {
        key: `code-block-widgets:${range.anchor.paragraph}`,
        range: {
          from: range.anchor,
          to: range.head,
        },
        markup: token.token.markup ?? "```",
        language: token.token.info ?? "",
        content: (token.token.content ?? "").replace(/\n$/, ""),
      };
    });
};

const sourceForCodeBlock = (
  markup: string,
  language: string,
  content: string,
): string => `${markup}${language}\n${content}\n${markup}`;

class CodeBlockWidgetRenderer
  implements WidgetRenderer<{
    readonly markup: string;
    readonly language: string;
    readonly content: string;
  }>
{
  mount(
    host: HTMLElement,
    props: {
      readonly markup: string;
      readonly language: string;
      readonly content: string;
    },
    context: WidgetContext,
  ): WidgetHandle<{
    readonly markup: string;
    readonly language: string;
    readonly content: string;
  }> {
    let markup = props.markup;
    const root = document.createElement("div");
    root.className = "s9-code-widget";

    const header = document.createElement("div");
    header.className = "s9-code-widget-header";

    const label = document.createElement("span");
    label.className = "s9-code-widget-label";
    label.textContent = "Code block";

    const language = document.createElement("input");
    language.className = "s9-code-widget-language";
    language.placeholder = "language";
    language.value = props.language;
    language.readOnly = context.readOnly;

    const textarea = document.createElement("textarea");
    textarea.className = "s9-code-widget-textarea";
    textarea.value = props.content;
    textarea.readOnly = context.readOnly;
    textarea.spellcheck = false;

    const commit = () => {
      if (context.readOnly) return;
      context.replaceSelf(
        sourceForCodeBlock(markup, language.value.trim(), textarea.value),
      );
    };

    language.addEventListener("input", commit);
    textarea.addEventListener("input", commit);
    textarea.addEventListener("keydown", (event) => event.stopPropagation());
    language.addEventListener("keydown", (event) => event.stopPropagation());

    header.append(label, language);
    root.append(header, textarea);
    host.replaceChildren(root);

    return {
      update(nextProps) {
        markup = nextProps.markup;
        language.readOnly = context.readOnly;
        textarea.readOnly = context.readOnly;
        if (document.activeElement !== language) {
          language.value = nextProps.language;
        }
        if (document.activeElement !== textarea) {
          textarea.value = nextProps.content;
        }
      },
      destroy() {
        host.replaceChildren();
      },
    };
  }
}

const codeBlockRenderer = new CodeBlockWidgetRenderer();

export const codeBlockWidgetPlugin = (): EditorPlugin<EmptyPluginState> => ({
  id: codeBlockWidgetPluginId,
  init: () => emptyState,
  apply: () => emptyState,
  instances: ({ doc, syntax }) =>
    findCodeBlocks(doc, syntax).map((block) => ({
      key: block.key,
      kind: "code-block",
      range: block.range,
      data: {
        language: block.language,
        content: block.content,
      },
      identity: { kind: "derived", fingerprint: block.key },
    })),
  widgets: ({ doc, syntax }) =>
    findCodeBlocks(doc, syntax).map(
      (block): WidgetDecoration<{
        readonly markup: string;
        readonly language: string;
        readonly content: string;
      }> => ({
        key: block.key,
        placement: "block",
        range: block.range,
        props: {
          markup: block.markup,
          language: block.language,
          content: block.content,
        },
        render: codeBlockRenderer,
        selection: "block",
      }),
    ),
  decorations: ({ doc, syntax }) =>
    findCodeBlocks(doc, syntax).map((block): EditorDecoration => {
      const from = absoluteOffset(doc, block.range.from);
      const to = absoluteOffset(doc, block.range.to);
      return inline(from, to, "s9-md-code-block-source");
    }),
});

export const positionFromAbsolute = (
  doc: EditorDocument,
  offset: number,
): Position => positionFromOffset(doc, offset);

export const selectionFromAbsoluteRange = (
  doc: EditorDocument,
  from: number,
  to: number,
) => ({
  anchor: positionFromAbsolute(doc, from),
  head: positionFromAbsolute(doc, to),
});

export const selectionAtAbsolute = (doc: EditorDocument, offset: number) =>
  collapsedSelection(positionFromAbsolute(doc, offset));
