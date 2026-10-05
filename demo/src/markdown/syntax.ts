import {
  blockTokens,
  gfmParser,
  parseDocument,
  reparse,
  tokenViews as resolveTokenViews,
  type Change,
  type ParseState,
  type Token,
  type TokenView,
} from "@saturn9/markoffset";
import type {
  DisplayChange,
  EditorDocument,
  SyntaxProvider,
  SyntaxSnapshot,
} from "@saturn9/scribeframe";
import {
  buildTextProjection,
  type OffsetRange,
  type TextProjection,
} from "./projection";

export const markdownSyntaxKind = "markdown";

export interface MarkdownSyntaxTokenView {
  readonly token: Token;
  readonly kind: string;
  readonly sourceRange: OffsetRange;
  readonly displayRange: OffsetRange;
}

export interface MarkdownSyntaxSnapshot extends SyntaxSnapshot {
  readonly kind: typeof markdownSyntaxKind;
  readonly projection: TextProjection;
  readonly parseState: ParseState;
  readonly tokens: readonly Token[];
  readonly tokenViews: readonly MarkdownSyntaxTokenView[];
}

export const isMarkdownSyntaxSnapshot = (
  syntax: SyntaxSnapshot,
): syntax is MarkdownSyntaxSnapshot =>
  syntax.kind === markdownSyntaxKind &&
  "projection" in syntax &&
  "parseState" in syntax &&
  "tokenViews" in syntax;

export const requireMarkdownSyntaxSnapshot = (
  syntax: SyntaxSnapshot,
): MarkdownSyntaxSnapshot => {
  if (isMarkdownSyntaxSnapshot(syntax)) return syntax;
  throw new Error(
    `Expected markdown syntax snapshot, received "${syntax.kind}" syntax`,
  );
};

const flattenBlockTokenViews = (
  views: readonly TokenView[],
): readonly TokenView[] =>
  views.flatMap((view) => [
    view,
    ...(view.token.kind === "bullet_list" ||
    view.token.kind === "ordered_list" ||
    view.token.kind === "list_item"
      ? flattenBlockTokenViews(view.children)
      : []),
  ]);

const snapshotFromParseState = (
  projection: TextProjection,
  parseState: ParseState,
  version: number,
): MarkdownSyntaxSnapshot => {
  const tokens = blockTokens(parseState.blocks);
  const tokenViews = flattenBlockTokenViews(resolveTokenViews(parseState.blocks))
    .filter((view) => !view.generated)
    .map(
      (view): MarkdownSyntaxTokenView => {
        const sourceRange = { from: view.start, to: view.end };
        return {
          token: view.token,
          kind: view.token.kind,
          sourceRange,
          displayRange: projection.markdownRangeToDisplay(sourceRange),
        };
      },
    );

  return {
    kind: markdownSyntaxKind,
    version,
    projection,
    parseState,
    tokens,
    tokenViews,
  };
};

export const buildMarkdownSyntaxSnapshot = (
  doc: EditorDocument,
): MarkdownSyntaxSnapshot => {
  const projection = buildTextProjection(doc);
  return snapshotFromParseState(
    projection,
    parseDocument(gfmParser, projection.markdownText),
    0,
  );
};

const displayChangeToMarkdownChange = (
  previous: MarkdownSyntaxSnapshot,
  nextProjection: TextProjection,
  change: DisplayChange,
): Change => {
  const nextInsertedFrom = nextProjection.displayToMarkdown(change.from);
  const nextInsertedTo = nextProjection.displayToMarkdown(
    change.from + change.insert.length,
  );

  return {
    from: previous.projection.displayToMarkdown(change.from),
    to: previous.projection.displayToMarkdown(change.to),
    insert: nextProjection.markdownText.slice(nextInsertedFrom, nextInsertedTo),
  };
};

export const updateMarkdownSyntaxSnapshot = (
  previous: MarkdownSyntaxSnapshot,
  doc: EditorDocument,
  displayChanges: readonly DisplayChange[],
): MarkdownSyntaxSnapshot => {
  const projection = buildTextProjection(doc);
  const nextVersion = previous.version + 1;

  if (displayChanges.length !== 1) {
    return snapshotFromParseState(
      projection,
      parseDocument(gfmParser, projection.markdownText),
      nextVersion,
    );
  }

  const parseState = reparse(
    gfmParser,
    previous.parseState,
    displayChangeToMarkdownChange(previous, projection, displayChanges[0]),
  );

  return parseState.src === projection.markdownText
    ? snapshotFromParseState(projection, parseState, nextVersion)
    : snapshotFromParseState(
        projection,
        parseDocument(gfmParser, projection.markdownText),
        nextVersion,
      );
};

export const markdownSyntaxProvider: SyntaxProvider = {
  create: buildMarkdownSyntaxSnapshot,
  update(previous, doc, displayChanges) {
    return updateMarkdownSyntaxSnapshot(
      requireMarkdownSyntaxSnapshot(previous),
      doc,
      displayChanges,
    );
  },
};
