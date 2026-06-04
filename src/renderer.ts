import {
  EditorDecoration,
  WidgetContext,
  WidgetDecoration,
  WidgetHandle,
  WidgetKey,
} from "./decorations";
import {
  EditorDocument,
  Position,
  Selection,
  absoluteOffset,
  clampPosition,
  collapsedSelection,
  comparePositions,
  normalizeRange,
  paragraphAbsoluteRange,
  positionFromOffset,
  selectionIsCollapsed,
  isSamePosition,
} from "./model";
import { type Transaction, createTransaction } from "./transaction";

interface TextSegment {
  readonly node: Text;
  readonly paragraph: number;
  readonly from: number;
  readonly to: number;
}

interface WidgetRecord<TProps = unknown> {
  readonly host: HTMLElement;
  readonly handle: WidgetHandle<TProps>;
}

interface WidgetFocusSnapshot {
  readonly element: HTMLElement;
  readonly widgetKey: WidgetKey;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
}

interface SelectionRect {
  readonly rect: DOMRect;
  readonly widgetKey?: WidgetKey;
}

interface VirtualWindow {
  readonly from: number;
  readonly to: number;
  readonly beforeHeight: number;
  readonly afterHeight: number;
  readonly virtualized: boolean;
}

export interface VerticalPositionResult {
  readonly position: Position;
  readonly preferredX: number;
}

export interface RendererVirtualizationOptions {
  readonly enabled?: boolean;
  readonly overscan?: number;
  readonly estimateParagraphHeight?: number;
}

export interface RendererRevealOptions {
  readonly block?: "nearest" | "start" | "center" | "end";
  readonly padding?: number;
}

export interface RendererScrollState {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly fraction: number;
}

export interface RendererOptions {
  readonly scrollContainer?: HTMLElement;
  readonly virtualization?: RendererVirtualizationOptions | false;
}

export interface RendererInput {
  readonly doc: EditorDocument;
  readonly selection: Selection;
  readonly readOnly: boolean;
  readonly decorations: readonly EditorDecoration[];
  readonly widgets: readonly WidgetDecoration[];
}

export interface RendererActions {
  dispatch(transaction: Transaction): void;
  focusEditor(position?: Position): void;
}

const isInlineDecoration = (
  decoration: EditorDecoration,
): decoration is Extract<EditorDecoration, { kind: "inline" }> =>
  decoration.kind === "inline";

const isBlockDecoration = (
  decoration: EditorDecoration,
): decoration is Extract<EditorDecoration, { kind: "block" }> =>
  decoration.kind === "block";

const isRangeDecoration = (
  decoration: EditorDecoration,
): decoration is Extract<EditorDecoration, { from: number; to: number }> =>
  decoration.kind === "inline" || decoration.kind === "annotation";

const classNamesForRange = (
  decorations: readonly EditorDecoration[],
  from: number,
  to: number,
): string[] =>
  decorations.filter(isRangeDecoration).flatMap((decoration) => {
    if (decoration.to <= from || decoration.from >= to) return [];
    if (isInlineDecoration(decoration)) {
      return decoration.attrs.class ? [decoration.attrs.class] : [];
    }
    return decoration.className ? [decoration.className] : [];
  });

const splitPointsForParagraph = (
  doc: EditorDocument,
  paragraphIndex: number,
  decorations: readonly EditorDecoration[],
): number[] => {
  const { from: paragraphFrom, to: paragraphTo } = paragraphAbsoluteRange(
    doc,
    paragraphIndex,
  );
  const paragraphLength = paragraphTo - paragraphFrom;
  const points = new Set<number>([0, paragraphLength]);

  decorations.filter(isRangeDecoration).forEach((decoration) => {
    if (decoration.to <= paragraphFrom || decoration.from >= paragraphTo) return;
    points.add(Math.max(0, decoration.from - paragraphFrom));
    points.add(Math.min(paragraphLength, decoration.to - paragraphFrom));
  });

  return [...points].sort((a, b) => a - b);
};

const setAttributes = (
  element: HTMLElement,
  decorations: readonly Extract<EditorDecoration, { kind: "inline" }>[],
  from: number,
  to: number,
): void => {
  decorations.forEach((decoration) => {
    if (decoration.to <= from || decoration.from >= to) return;
    Object.entries(decoration.attrs)
      .filter(([name]) => name !== "class")
      .forEach(([name, value]) => element.setAttribute(name, value));
  });
};

const setBlockAttributes = (
  element: HTMLElement,
  decorations: readonly Extract<EditorDecoration, { kind: "block" }>[],
  paragraphIndex: number,
): void => {
  decorations
    .filter((decoration) => decoration.paragraph === paragraphIndex)
    .forEach((decoration) => {
      Object.entries(decoration.attrs).forEach(([name, value]) => {
        if (name === "class") {
          const classNames = value.split(/\s+/).filter(Boolean);
          if (classNames.length > 0) {
            element.classList.add(...classNames);
          }
          return;
        }
        element.setAttribute(name, value);
      });
    });
};

export class Renderer {
  private surface: HTMLElement;
  private readonly caret: HTMLElement;
  private readonly selectionLayer: HTMLElement;
  private readonly scrollContainer: HTMLElement;
  private readonly virtualization: Required<RendererVirtualizationOptions>;
  private readonly paragraphHeights = new Map<number, number>();
  private readonly segments: TextSegment[] = [];
  private readonly widgets = new Map<WidgetKey, WidgetRecord>();
  private currentInput: RendererInput | null = null;
  private currentWidgets = new Map<WidgetKey, WidgetDecoration>();
  private currentWindow: VirtualWindow = {
    from: 0,
    to: 0,
    beforeHeight: 0,
    afterHeight: 0,
    virtualized: false,
  };

  private readonly handleScroll = (): void => {
    if (!this.currentInput || !this.currentWindow.virtualized) return;
    this.render(this.currentInput);
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: RendererActions,
    options: RendererOptions = {},
  ) {
    this.root.classList.add("s9-editor");
    this.scrollContainer = options.scrollContainer ?? root;
    this.virtualization = {
      enabled:
        options.virtualization !== false &&
        (options.virtualization?.enabled ?? true),
      overscan:
        options.virtualization === false
          ? 0
          : (options.virtualization?.overscan ?? 4),
      estimateParagraphHeight:
        options.virtualization === false
          ? 36
          : (options.virtualization?.estimateParagraphHeight ?? 36),
    };
    this.surface = document.createElement("div");
    this.surface.className = "s9-editor-surface";
    this.selectionLayer = document.createElement("div");
    this.selectionLayer.className = "s9-selection-layer";
    this.selectionLayer.setAttribute("aria-hidden", "true");
    this.caret = document.createElement("div");
    this.caret.className = "s9-caret";
    this.caret.setAttribute("aria-hidden", "true");
    this.root.append(this.surface, this.selectionLayer, this.caret);
    this.scrollContainer.addEventListener("scroll", this.handleScroll, {
      passive: true,
    });
  }

  render(input: RendererInput): void {
    const focusSnapshot = this.captureWidgetFocus(input.widgets);
    this.currentInput = input;
    this.currentWidgets = new Map(input.widgets.map((widget) => [widget.key, widget]));
    this.segments.length = 0;
    const window = this.virtualWindow(input.doc);
    const mountedWidgetKeys = new Set<WidgetKey>();

    const nextSurface = document.createElement("div");
    nextSurface.className = "s9-editor-surface";

    if (window.virtualized) {
      nextSurface.append(this.spacer("before", window.beforeHeight));
    }

    for (
      let paragraphIndex = window.from;
      paragraphIndex < window.to;
      paragraphIndex += 1
    ) {
      const item = input.doc.paragraphs[paragraphIndex];
      if (!item) continue;

      input.widgets
        .filter(
          (widget) =>
            widget.placement === "block" &&
            widget.range.from.paragraph === paragraphIndex,
        )
        .forEach((widget) => {
          mountedWidgetKeys.add(widget.key);
          nextSurface.append(this.hostForWidget(widget, input));
        });

      const paragraphElement = document.createElement("p");
      paragraphElement.className = "s9-paragraph";
      if (item.text.length === 0) {
        paragraphElement.classList.add("s9-paragraph-empty");
      }
      setBlockAttributes(
        paragraphElement,
        input.decorations.filter(isBlockDecoration),
        paragraphIndex,
      );
      paragraphElement.dataset.paragraph = `${paragraphIndex}`;

      if (this.isParagraphCoveredByBlockWidget(input.doc, paragraphIndex, input.widgets)) {
        paragraphElement.classList.add("s9-covered-by-widget");
      }

      const points = splitPointsForParagraph(
        input.doc,
        paragraphIndex,
        input.decorations,
      );

      if (item.text.length === 0) {
        paragraphElement.append(document.createTextNode("\u200b"));
      } else {
        points.slice(0, -1).forEach((point, index) => {
          const nextPoint = points[index + 1];
          if (point === nextPoint) return;

          const span = document.createElement("span");
          const text = item.text.slice(point, nextPoint);
          const textNode = document.createTextNode(text);
          const paragraphRange = paragraphAbsoluteRange(input.doc, paragraphIndex);
          const absFrom = paragraphRange.from + point;
          const absTo = paragraphRange.from + nextPoint;
          const classes = [
            ...classNamesForRange(input.decorations, absFrom, absTo),
          ];

          if (classes.length > 0) span.className = classes.join(" ");
          setAttributes(
            span,
            input.decorations.filter(isInlineDecoration),
            absFrom,
            absTo,
          );
          span.dataset.paragraph = `${paragraphIndex}`;
          span.dataset.from = `${point}`;
          span.append(textNode);
          paragraphElement.append(span);
          this.segments.push({
            node: textNode,
            paragraph: paragraphIndex,
            from: point,
            to: nextPoint,
          });
        });
      }

      nextSurface.append(paragraphElement);
    }

    if (window.virtualized) {
      nextSurface.append(this.spacer("after", window.afterHeight));
    }

    this.destroyMissingWidgets([...mountedWidgetKeys]);
    this.surface.replaceWith(nextSurface);
    this.surface = nextSurface;
    this.currentWindow = window;
    this.measureRenderedParagraphHeights();
    this.restoreWidgetFocus(focusSnapshot);
    this.updateSelectionOverlay(input);
    this.updateCaret();
  }

  destroy(): void {
    this.scrollContainer.removeEventListener("scroll", this.handleScroll);
    this.widgets.forEach((record) => record.handle.destroy());
    this.widgets.clear();
    this.currentWidgets.clear();
    this.segments.length = 0;
    this.paragraphHeights.clear();
    this.currentInput = null;
    this.root.replaceChildren();
    this.root.classList.remove("s9-editor");
  }

  positionAtPoint(x: number, y: number): Position | null {
    const caret = this.caretFromPoint(x, y);
    if (!caret) return this.positionFromParagraphElement(x, y);

    const segment = this.segments.find((item) => item.node === caret.node);
    if (!segment) return this.positionFromParagraphElement(x, y);

    return {
      paragraph: segment.paragraph,
      offset: Math.min(segment.to, segment.from + caret.offset),
    };
  }

  syncInputProxy(textarea: HTMLTextAreaElement): void {
    const rect = this.measurePosition(
      this.currentInput?.selection.head ?? { paragraph: 0, offset: 0 },
    );
    if (!rect) return;

    const rootRect = this.root.getBoundingClientRect();
    const scrollOffset = this.rootScrollOffset();
    textarea.style.left = `${rect.left - rootRect.left + scrollOffset.left}px`;
    textarea.style.top = `${rect.top - rootRect.top + scrollOffset.top}px`;
    textarea.style.height = `${Math.max(16, rect.height)}px`;
  }

  getScrollState(): RendererScrollState {
    const scrollHeight = this.scrollHeight();
    const clientHeight = this.scrollContainer.clientHeight;
    const scrollTop = this.scrollContainer.scrollTop;
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);

    return {
      scrollTop,
      scrollHeight,
      clientHeight,
      fraction: maxScrollTop === 0 ? 0 : scrollTop / maxScrollTop,
    };
  }

  scrollToFraction(fraction: number): void {
    const scrollHeight = this.scrollHeight();
    const clientHeight = this.scrollContainer.clientHeight;
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    this.setScrollTop(Math.max(0, Math.min(1, fraction)) * maxScrollTop);
  }

  revealPosition(position: Position, options: RendererRevealOptions = {}): void {
    const input = this.currentInput;
    if (!input) return;

    const clamped = clampPosition(input.doc, position);
    const top = this.paragraphTop(clamped.paragraph);
    const bottom = top + this.paragraphHeight(clamped.paragraph);
    this.revealVerticalRange(top, bottom, options);
  }

  revealSelection(selection: Selection, options: RendererRevealOptions = {}): void {
    this.revealPosition(selection.head, options);
  }

  positionVerticallyFrom(
    position: Position,
    direction: -1 | 1,
    preferredX?: number,
  ): VerticalPositionResult {
    const input = this.currentInput;
    if (!input) {
      return { position, preferredX: preferredX ?? 0 };
    }

    const rect = this.measurePosition(position);
    const x = preferredX ?? rect?.left ?? 0;
    if (rect) {
      const yStep = this.verticalLineStep(position, rect);
      const target = this.positionAtPoint(
        x,
        rect.top + rect.height / 2 + direction * yStep,
      );
      if (target && !isSamePosition(target, position)) {
        return { position: target, preferredX: x };
      }
    }

    return {
      position: this.fallbackVerticalPosition(input.doc, position, direction),
      preferredX: x,
    };
  }

  positionAtLineBoundaryFrom(
    position: Position,
    boundary: "start" | "end",
  ): Position {
    const input = this.currentInput;
    if (!input) return position;

    const clamped = clampPosition(input.doc, position);
    const rect = this.measurePosition(clamped);
    const paragraphElement = this.paragraphElement(clamped.paragraph);
    if (rect && paragraphElement) {
      const paragraphRect = paragraphElement.getBoundingClientRect();
      const x = boundary === "start"
        ? paragraphRect.left + 1
        : paragraphRect.right - 1;
      const target = this.positionAtPoint(x, rect.top + rect.height / 2);
      if (target?.paragraph === clamped.paragraph) return target;
    }

    const paragraph = input.doc.paragraphs[clamped.paragraph];
    return {
      paragraph: clamped.paragraph,
      offset: boundary === "start" ? 0 : paragraph?.text.length ?? 0,
    };
  }

  private virtualWindow(doc: EditorDocument): VirtualWindow {
    const paragraphCount = doc.paragraphs.length;
    const clientHeight = this.scrollContainer.clientHeight;

    if (!this.virtualization.enabled || clientHeight <= 0 || paragraphCount === 0) {
      return {
        from: 0,
        to: paragraphCount,
        beforeHeight: 0,
        afterHeight: 0,
        virtualized: false,
      };
    }

    const overscanPixels =
      this.virtualization.overscan * this.virtualization.estimateParagraphHeight;
    const visibleTop = Math.max(0, this.scrollContainer.scrollTop - overscanPixels);
    const visibleBottom =
      this.scrollContainer.scrollTop + clientHeight + overscanPixels;

    let from = 0;
    let beforeHeight = 0;
    while (
      from < paragraphCount &&
      beforeHeight + this.paragraphHeight(from) <= visibleTop
    ) {
      beforeHeight += this.paragraphHeight(from);
      from += 1;
    }

    let to = from;
    let coveredHeight = beforeHeight;
    while (to < paragraphCount && coveredHeight < visibleBottom) {
      coveredHeight += this.paragraphHeight(to);
      to += 1;
    }

    if (to === from && from < paragraphCount) {
      coveredHeight += this.paragraphHeight(to);
      to += 1;
    }

    return {
      from,
      to,
      beforeHeight,
      afterHeight: Math.max(0, this.documentHeight(doc) - coveredHeight),
      virtualized: true,
    };
  }

  private spacer(kind: "before" | "after", height: number): HTMLElement {
    const element = document.createElement("div");
    element.className = `s9-virtual-spacer s9-virtual-spacer-${kind}`;
    element.setAttribute("aria-hidden", "true");
    element.style.height = `${Math.max(0, height)}px`;
    return element;
  }

  private measureRenderedParagraphHeights(): void {
    this.surface
      .querySelectorAll<HTMLElement>(".s9-paragraph[data-paragraph]")
      .forEach((paragraphElement) => {
        const paragraphIndex = Number(paragraphElement.dataset.paragraph);
        const rect = paragraphElement.getBoundingClientRect();
        if (Number.isFinite(paragraphIndex) && rect.height > 0) {
          this.paragraphHeights.set(paragraphIndex, rect.height);
        }
      });
  }

  private paragraphHeight(paragraphIndex: number): number {
    return (
      this.paragraphHeights.get(paragraphIndex) ??
      this.virtualization.estimateParagraphHeight
    );
  }

  private paragraphTop(paragraphIndex: number): number {
    let top = 0;
    for (let index = 0; index < paragraphIndex; index += 1) {
      top += this.paragraphHeight(index);
    }
    return top;
  }

  private documentHeight(doc: EditorDocument): number {
    return doc.paragraphs.reduce(
      (total, _paragraph, index) => total + this.paragraphHeight(index),
      0,
    );
  }

  private scrollHeight(): number {
    const virtualHeight = this.currentInput
      ? this.documentHeight(this.currentInput.doc)
      : 0;
    return Math.max(this.scrollContainer.scrollHeight, virtualHeight);
  }

  private setScrollTop(scrollTop: number): void {
    const maxScrollTop = Math.max(
      0,
      this.scrollHeight() - this.scrollContainer.clientHeight,
    );
    this.scrollContainer.scrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
    this.renderAfterScrollChange();
  }

  private renderAfterScrollChange(): void {
    if (this.currentInput) {
      this.render(this.currentInput);
    }
  }

  private revealVerticalRange(
    top: number,
    bottom: number,
    options: RendererRevealOptions,
  ): void {
    const padding = options.padding ?? 0;
    const clientHeight = this.scrollContainer.clientHeight;
    const viewportTop = this.scrollContainer.scrollTop;
    const viewportBottom = viewportTop + clientHeight;
    const block = options.block ?? "nearest";
    const target =
      block === "start"
        ? top - padding
        : block === "end"
          ? bottom - clientHeight + padding
          : block === "center"
            ? top - (clientHeight - (bottom - top)) / 2
            : this.nearestScrollTop(top, bottom, viewportTop, viewportBottom, padding);

    this.setScrollTop(target);
  }

  private nearestScrollTop(
    top: number,
    bottom: number,
    viewportTop: number,
    viewportBottom: number,
    padding: number,
  ): number {
    if (top >= viewportTop + padding && bottom <= viewportBottom - padding) {
      return viewportTop;
    }

    return top < viewportTop + padding
      ? top - padding
      : bottom - (viewportBottom - viewportTop) + padding;
  }

  private hostForWidget(
    widget: WidgetDecoration,
    input: RendererInput,
  ): HTMLElement {
    const existing = this.widgets.get(widget.key);
    if (existing) {
      this.updateWidget(existing, widget);
      existing.host.classList.toggle("s9-widget-readonly", input.readOnly);
      return existing.host;
    }

    const host = document.createElement("div");
    host.className = `s9-widget s9-widget-${widget.placement}`;
    host.dataset.widgetKey = widget.key;
    const context = this.createWidgetContext(widget.key);
    const handle = widget.render.mount(host, widget.props, context);
    this.widgets.set(widget.key, { host, handle });
    this.updateWidget({ host, handle }, widget);

    host.classList.toggle("s9-widget-readonly", input.readOnly);

    return host;
  }

  private updateWidget<TProps>(
    record: WidgetRecord<TProps>,
    widget: WidgetDecoration<TProps>,
  ): void {
    record.handle.update(widget.props);
    record.host.dataset.widgetKey = widget.key;
  }

  private createWidgetContext(key: WidgetKey): WidgetContext {
    const renderer = this;
    const lookup = (): WidgetDecoration => {
      const widget = renderer.currentWidgets.get(key);
      if (!widget) {
        throw new Error(`Widget ${key} is no longer mounted`);
      }
      return widget;
    };

    return {
      key,
      get readOnly() {
        return renderer.currentInput?.readOnly ?? false;
      },
      dispatch: (transaction) => this.actions.dispatch(transaction),
      replaceSelf: (text) => {
        const widget = lookup();
        const input = this.requireInput();
        this.actions.dispatch(
          createTransaction(input.doc, input.selection)
            .replaceRange(widget.range.from, widget.range.to, text)
            .build(),
        );
      },
      replaceContent: (text) => {
        const widget = lookup();
        if (!widget.contentRange) return;
        const input = this.requireInput();
        this.actions.dispatch(
          createTransaction(input.doc, input.selection)
            .replaceRange(widget.contentRange.from, widget.contentRange.to, text)
            .build(),
        );
      },
      deleteSelf: () => {
        const widget = lookup();
        const input = this.requireInput();
        this.actions.dispatch(
          createTransaction(input.doc, input.selection)
            .replaceRange(widget.range.from, widget.range.to, "")
            .build(),
        );
      },
      focusEditor: (position) => this.actions.focusEditor(position),
    };
  }

  private captureWidgetFocus(
    widgets: readonly WidgetDecoration[],
  ): WidgetFocusSnapshot | null {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;

    const host = element.closest<HTMLElement>(".s9-widget[data-widget-key]");
    if (!host || !this.root.contains(host)) return null;

    const widgetKey = host.dataset.widgetKey as WidgetKey | undefined;
    if (!widgetKey || !widgets.some((widget) => widget.key === widgetKey)) {
      return null;
    }

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) {
      return {
        element,
        widgetKey,
        selectionStart: element.selectionStart,
        selectionEnd: element.selectionEnd,
      };
    }

    return {
      element,
      widgetKey,
      selectionStart: null,
      selectionEnd: null,
    };
  }

  private restoreWidgetFocus(snapshot: WidgetFocusSnapshot | null): void {
    if (!snapshot) return;
    if (!this.widgets.has(snapshot.widgetKey)) return;
    if (!this.root.contains(snapshot.element)) return;

    snapshot.element.focus({ preventScroll: true });

    if (
      snapshot.selectionStart === null ||
      snapshot.selectionEnd === null ||
      !(
        snapshot.element instanceof HTMLInputElement ||
        snapshot.element instanceof HTMLTextAreaElement
      )
    ) {
      return;
    }

    const selectionStart = Math.min(
      snapshot.selectionStart,
      snapshot.element.value.length,
    );
    const selectionEnd = Math.min(
      snapshot.selectionEnd,
      snapshot.element.value.length,
    );
    snapshot.element.setSelectionRange(selectionStart, selectionEnd);
  }

  private requireInput(): RendererInput {
    if (!this.currentInput) {
      throw new Error("Renderer input is not available");
    }
    return this.currentInput;
  }

  private destroyMissingWidgets(nextKeys: readonly WidgetKey[]): void {
    const liveKeys = new Set(nextKeys);
    this.widgets.forEach((record, key) => {
      if (liveKeys.has(key)) return;
      record.handle.destroy();
      record.host.remove();
      this.widgets.delete(key);
    });
  }

  private isParagraphCoveredByBlockWidget(
    doc: EditorDocument,
    paragraphIndex: number,
    widgets: readonly WidgetDecoration[],
  ): boolean {
    const range = paragraphAbsoluteRange(doc, paragraphIndex);
    return widgets.some((widget) => {
      if (widget.placement !== "block") return false;
      const widgetFrom = absoluteOffset(doc, widget.range.from);
      const widgetTo = absoluteOffset(doc, widget.range.to);
      return range.to >= widgetFrom && range.from <= widgetTo;
    });
  }

  private updateSelectionOverlay(input: RendererInput): void {
    this.selectionLayer.replaceChildren();
    if (selectionIsCollapsed(input.selection)) return;

    this.selectionRects(input).forEach(({ rect, widgetKey }) => {
      const element = this.selectionRectElement(rect);
      if (!element) return;
      if (widgetKey) element.dataset.widgetKey = widgetKey;
      this.selectionLayer.append(element);
    });
  }

  private selectionRects(input: RendererInput): SelectionRect[] {
    return [
      ...this.textSelectionRects(input),
      ...this.widgetSelectionRects(input),
    ];
  }

  private textSelectionRects(input: RendererInput): SelectionRect[] {
    const range = normalizeRange(input.selection);

    return input.doc.paragraphs.flatMap((item, paragraphIndex) => {
      const fromOffset =
        paragraphIndex === range.from.paragraph ? range.from.offset : 0;
      const toOffset =
        paragraphIndex === range.to.paragraph ? range.to.offset : item.text.length;

      if (paragraphIndex < range.from.paragraph || paragraphIndex > range.to.paragraph) {
        return [];
      }

      if (fromOffset < toOffset) {
        return this.rectsForParagraphRange(paragraphIndex, fromOffset, toOffset);
      }

      if (this.shouldPaintEmptyParagraph(input.doc, paragraphIndex, range)) {
        return this.fallbackParagraphSelectionRect(paragraphIndex);
      }

      return [];
    });
  }

  private rectsForParagraphRange(
    paragraphIndex: number,
    fromOffset: number,
    toOffset: number,
  ): SelectionRect[] {
    const rects = this.segments
      .filter(
        (segment) =>
          segment.paragraph === paragraphIndex &&
          segment.to > fromOffset &&
          segment.from < toOffset,
      )
      .flatMap((segment) =>
        this.rectsForTextSegment(
          segment,
          Math.max(fromOffset, segment.from),
          Math.min(toOffset, segment.to),
        ),
      );

    return rects.length > 0
      ? rects.map((rect) => ({ rect }))
      : this.fallbackParagraphSelectionRect(paragraphIndex);
  }

  private rectsForTextSegment(
    segment: TextSegment,
    fromOffset: number,
    toOffset: number,
  ): DOMRect[] {
    const range = document.createRange();
    range.setStart(segment.node, Math.max(0, fromOffset - segment.from));
    range.setEnd(segment.node, Math.max(0, toOffset - segment.from));
    const rects =
      typeof range.getClientRects === "function"
        ? Array.from(range.getClientRects())
        : [];
    range.detach();
    return rects.filter((rect) => rect.width !== 0 || rect.height !== 0);
  }

  private fallbackParagraphSelectionRect(paragraphIndex: number): SelectionRect[] {
    const rect = this.paragraphElement(paragraphIndex)?.getBoundingClientRect();
    return rect && (rect.width !== 0 || rect.height !== 0) ? [{ rect }] : [];
  }

  private shouldPaintEmptyParagraph(
    doc: EditorDocument,
    paragraphIndex: number,
    range: { readonly from: Position; readonly to: Position },
  ): boolean {
    const item = doc.paragraphs[paragraphIndex];
    if (!item || item.text.length > 0) return false;

    const position = { paragraph: paragraphIndex, offset: 0 };
    return (
      comparePositions(range.from, position) <= 0 &&
      comparePositions(position, range.to) < 0
    );
  }

  private widgetSelectionRects(input: RendererInput): SelectionRect[] {
    const range = normalizeRange(input.selection);
    const selectionFrom = absoluteOffset(input.doc, range.from);
    const selectionTo = absoluteOffset(input.doc, range.to);

    return input.widgets.flatMap((widget) => {
      if (widget.selection === "inline") return [];

      const widgetFrom = absoluteOffset(input.doc, widget.range.from);
      const widgetTo = absoluteOffset(input.doc, widget.range.to);
      if (widgetTo <= selectionFrom || widgetFrom >= selectionTo) return [];

      const rect = this.widgets.get(widget.key)?.host.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return [];
      return [{ rect, widgetKey: widget.key }];
    });
  }

  private selectionRectElement(rect: DOMRect): HTMLElement | null {
    if (rect.width === 0 && rect.height === 0) return null;

    const rootRect = this.root.getBoundingClientRect();
    const scrollOffset = this.rootScrollOffset();
    const element = document.createElement("div");
    element.className = "s9-selection-rect";
    element.style.left = `${rect.left - rootRect.left + scrollOffset.left}px`;
    element.style.top = `${rect.top - rootRect.top + scrollOffset.top}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
    return element;
  }

  private updateCaret(): void {
    const input = this.currentInput;
    if (!input || !selectionIsCollapsed(input.selection)) {
      this.caret.classList.add("s9-caret-hidden");
      return;
    }

    const rect = this.measurePosition(input.selection.head);
    if (!rect) {
      this.caret.classList.add("s9-caret-hidden");
      return;
    }

    const rootRect = this.root.getBoundingClientRect();
    const scrollOffset = this.rootScrollOffset();
    this.caret.classList.remove("s9-caret-hidden");
    this.caret.style.left = `${rect.left - rootRect.left + scrollOffset.left}px`;
    this.caret.style.top = `${rect.top - rootRect.top + scrollOffset.top}px`;
    this.caret.style.height = `${Math.max(16, rect.height)}px`;
  }

  private rootScrollOffset(): { readonly left: number; readonly top: number } {
    return this.scrollContainer === this.root
      ? {
          left: this.scrollContainer.scrollLeft,
          top: this.scrollContainer.scrollTop,
        }
      : { left: 0, top: 0 };
  }

  measurePosition(position: Position): DOMRect | null {
    const input = this.currentInput;
    if (!input) return null;

    const clamped = clampPosition(input.doc, position);
    const segment = this.segments.find(
      (item) =>
        item.paragraph === clamped.paragraph &&
        item.from <= clamped.offset &&
        item.to >= clamped.offset,
    );

    if (segment) {
      const range = document.createRange();
      const offset = Math.min(
        segment.node.length,
        Math.max(0, clamped.offset - segment.from),
      );
      range.setStart(segment.node, offset);
      range.setEnd(segment.node, offset);
      const rect =
        typeof range.getBoundingClientRect === "function"
          ? range.getBoundingClientRect()
          : null;
      range.detach();
      if (rect && (rect.width !== 0 || rect.height !== 0)) return rect;
    }

    const paragraphElement = this.surface.querySelector<HTMLElement>(
      `[data-paragraph="${clamped.paragraph}"]`,
    );
    return (
      paragraphElement?.getBoundingClientRect() ??
      (this.currentWindow.virtualized
        ? this.virtualParagraphRect(clamped.paragraph)
        : null)
    );
  }

  private virtualParagraphRect(paragraphIndex: number): DOMRect {
    const rootRect = this.root.getBoundingClientRect();
    const scrollOffset = this.rootScrollOffset();
    const top = rootRect.top + this.paragraphTop(paragraphIndex) - scrollOffset.top;
    const height = this.paragraphHeight(paragraphIndex);
    return {
      left: rootRect.left,
      top,
      right: rootRect.right,
      bottom: top + height,
      width: rootRect.width,
      height,
      x: rootRect.left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  private fallbackVerticalPosition(
    doc: EditorDocument,
    position: Position,
    direction: -1 | 1,
  ): Position {
    const current = clampPosition(doc, position);
    const paragraphIndex = current.paragraph + direction;
    if (paragraphIndex < 0 || paragraphIndex >= doc.paragraphs.length) {
      return current;
    }

    return {
      paragraph: paragraphIndex,
      offset: Math.min(
        current.offset,
        doc.paragraphs[paragraphIndex]?.text.length ?? 0,
      ),
    };
  }

  private verticalLineStep(position: Position, rect: DOMRect): number {
    const paragraphElement = this.paragraphElement(position.paragraph);
    const lineHeight = paragraphElement
      ? Number.parseFloat(getComputedStyle(paragraphElement).lineHeight)
      : Number.NaN;

    return Number.isFinite(lineHeight) && lineHeight > 0
      ? lineHeight
      : Math.max(1, rect.height);
  }

  private caretFromPoint(
    x: number,
    y: number,
  ): { node: Text; offset: number } | null {
    type CaretPositionDocument = Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => globalThis.Range | null;
    };

    const doc = document as CaretPositionDocument;
    const position = doc.caretPositionFromPoint?.(x, y);
    if (position?.offsetNode instanceof Text) {
      return { node: position.offsetNode, offset: position.offset };
    }

    const range = doc.caretRangeFromPoint?.(x, y);
    if (range?.startContainer instanceof Text) {
      return { node: range.startContainer, offset: range.startOffset };
    }

    return null;
  }

  private positionFromParagraphElement(x: number, y: number): Position | null {
    const element =
      typeof document.elementFromPoint === "function"
        ? document.elementFromPoint(x, y)
        : null;
    const paragraphElement = element?.closest<HTMLElement>("[data-paragraph]");
    const input = this.currentInput;
    if (!paragraphElement || !input) return null;

    const paragraphIndex = Number(paragraphElement.dataset.paragraph ?? "0");
    const paragraph = input.doc.paragraphs[paragraphIndex];
    if (!paragraph) return null;

    return collapsedSelection({
      paragraph: paragraphIndex,
      offset: paragraph.text.length,
    }).head;
  }

  private paragraphElement(paragraphIndex: number): HTMLElement | null {
    return this.surface.querySelector<HTMLElement>(
      `.s9-paragraph[data-paragraph="${paragraphIndex}"]`,
    );
  }

  selectAll(): Selection {
    const input = this.requireInput();
    return {
      anchor: { paragraph: 0, offset: 0 },
      head: positionFromOffset(
        input.doc,
        Math.max(0, input.doc.paragraphs.reduce((total, item) => total + item.text.length + 1, -1)),
      ),
    };
  }
}
