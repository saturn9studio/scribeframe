import { EditorDocument, Position, Range } from "./model.js";
import type { SyntaxSnapshot } from "./syntax.js";
import { Transaction } from "./transaction.js";

export type PluginName = string;
export type WidgetKey = `${PluginName}:${string}`;

export interface InlineDecoration {
  readonly kind: "inline";
  readonly from: number;
  readonly to: number;
  readonly attrs: Readonly<Record<string, string>>;
}

export interface BlockDecoration {
  readonly kind: "block";
  readonly paragraph: number;
  readonly attrs: Readonly<Record<string, string>>;
}

export type EditorDecoration =
  | InlineDecoration
  | BlockDecoration;

export type WidgetPlacement = "inline" | "block";
export type WidgetSelectionBehavior = "inline" | "atom" | "block";

export interface WidgetReplaceOptions {
  readonly history?: "merge" | "boundary";
}

export interface WidgetContext {
  readonly key: WidgetKey;
  readonly readOnly: boolean;
  dispatch(transaction: Transaction): void;
  replaceSelf(text: string, options?: WidgetReplaceOptions): void;
  replaceContent(text: string, options?: WidgetReplaceOptions): void;
  deleteSelf(): void;
  focusEditor(position?: Position): void;
}

export interface WidgetHandle<TProps = unknown> {
  update(props: TProps): void;
  focus?(): boolean | void;
  destroy(): void;
}

export interface WidgetRenderer<TProps = unknown> {
  mount(
    host: HTMLElement,
    props: TProps,
    context: WidgetContext,
  ): WidgetHandle<TProps>;
}

export interface WidgetDecoration<TProps = unknown> {
  readonly key: WidgetKey;
  readonly placement: WidgetPlacement;
  readonly range: Range;
  readonly contentRange?: Range;
  readonly props: TProps;
  readonly render: WidgetRenderer<TProps>;
  readonly selection: WidgetSelectionBehavior;
}

export interface RenderOutput {
  readonly decorations: readonly EditorDecoration[];
  readonly widgets: readonly WidgetDecoration[];
}

export interface EditorSnapshot {
  readonly doc: EditorDocument;
  readonly selection: import("./model.js").Selection;
  readonly content: string;
  readonly readOnly: boolean;
  readonly syntax: SyntaxSnapshot;
}
