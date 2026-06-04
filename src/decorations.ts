import { EditorDocument, Position, Range } from "./model";
import type { SyntaxSnapshot } from "./syntax";
import { Transaction } from "./transaction";

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

export interface AnnotationDecoration<TData = unknown> {
  readonly kind: "annotation";
  readonly key: WidgetKey;
  readonly from: number;
  readonly to: number;
  readonly annotationKind: string;
  readonly data: TData;
  readonly className?: string;
}

export type EditorDecoration =
  | InlineDecoration
  | BlockDecoration
  | AnnotationDecoration;

export type WidgetPlacement = "inline" | "block" | "gutter" | "overlay";
export type WidgetSelectionBehavior = "inline" | "atom" | "block";

export interface WidgetContext {
  readonly key: WidgetKey;
  readonly readOnly: boolean;
  dispatch(transaction: Transaction): void;
  replaceSelf(text: string): void;
  replaceContent(text: string): void;
  deleteSelf(): void;
  focusEditor(position?: Position): void;
}

export interface WidgetHandle<TProps = unknown> {
  update(props: TProps): void;
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

export interface ExtensionInstance<TData = unknown> {
  readonly key: WidgetKey;
  readonly kind: string;
  readonly range: Range;
  readonly contentRange?: Range;
  readonly blockRange?: Range;
  readonly data: TData;
  readonly identity: ExtensionIdentity;
}

export type ExtensionIdentity =
  | { readonly kind: "persistent"; readonly id: string }
  | { readonly kind: "derived"; readonly fingerprint: string }
  | { readonly kind: "ephemeral" };

export interface RenderOutput {
  readonly decorations: readonly EditorDecoration[];
  readonly widgets: readonly WidgetDecoration[];
  readonly instances: readonly ExtensionInstance[];
}

export const emptyRenderOutput = (): RenderOutput => ({
  decorations: [],
  widgets: [],
  instances: [],
});

export interface EditorSnapshot {
  readonly doc: EditorDocument;
  readonly selection: import("./model").Selection;
  readonly content: string;
  readonly readOnly: boolean;
  readonly syntax: SyntaxSnapshot;
}
