import type {
  EditorDecoration,
  WidgetDecoration,
  WidgetKey,
} from "./decorations.js";
import type { Position, Range } from "./model.js";

export type EditorInteractionType = "activate";

export interface EditorInteractionModifiers {
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

export interface DecorationInteractionTarget {
  readonly kind: "decoration";
  readonly decoration: EditorDecoration;
  readonly range: Range;
}

export interface WidgetInteractionTarget {
  readonly kind: "widget";
  readonly key: WidgetKey;
  readonly widget: WidgetDecoration;
  readonly range: Range;
}

export type EditorInteractionTarget =
  | DecorationInteractionTarget
  | WidgetInteractionTarget;

export interface RenderedInteractionHit {
  readonly position: Position | null;
  readonly targets: readonly EditorInteractionTarget[];
  readonly decorations: readonly DecorationInteractionTarget[];
  readonly widgets: readonly WidgetInteractionTarget[];
}

export interface EditorInteraction extends RenderedInteractionHit {
  readonly type: EditorInteractionType;
  readonly event: MouseEvent;
  readonly modifiers: EditorInteractionModifiers;
}
