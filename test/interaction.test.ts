import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EditorPlugin,
  ScribeFrame,
  PluginId,
  WidgetDecoration,
  WidgetRenderer,
  type EditorInteraction,
} from "../src";

type CaretPositionDocument = Document & {
  caretPositionFromPoint?: (
    x: number,
    y: number,
  ) => { offsetNode: Node; offset: number } | null;
};

const originalElementsFromPoint = document.elementsFromPoint;
const originalElementFromPoint = document.elementFromPoint;
const originalCaretPositionFromPoint = (
  document as CaretPositionDocument
).caretPositionFromPoint;

const stubPointLookup = (element: () => Element | null): void => {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => {
      const current = element();
      return current ? [current] : [];
    },
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => element(),
  });
};

const restorePointLookup = (): void => {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: originalElementsFromPoint,
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: originalElementFromPoint,
  });
  (document as CaretPositionDocument).caretPositionFromPoint =
    originalCaretPositionFromPoint;
};

const textNodeContaining = (container: HTMLElement, text: string): Text => {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent === text) return node as Text;
    node = walker.nextNode();
  }
  throw new Error(`Text node not found: ${text}`);
};

const interactionPlugin = (
  interactions: EditorInteraction[],
): EditorPlugin<null> => ({
  id: new PluginId<null>("interaction"),
  init: () => null,
  apply: () => null,
  decorations: () => [
    {
      kind: "inline",
      from: 0,
      to: 5,
      attrs: {
        class: "interactive",
        "data-kind": "demo",
      },
    },
  ],
  props: {
    handleInteraction({ interaction }) {
      interactions.push(interaction);
      return true;
    },
  },
});

const inlineWidgetInteractionPlugin = (
  interactions: EditorInteraction[],
): EditorPlugin<null> => {
  const renderer: WidgetRenderer = {
    mount(host) {
      host.textContent = "■";
      return {
        update() {},
        destroy() {
          host.textContent = "";
        },
      };
    },
  };

  return {
    id: new PluginId<null>("inline-widget-interaction"),
    init: () => null,
    apply: () => null,
    widgets: (): readonly WidgetDecoration[] => [
      {
        key: "inline-widget-interaction:marker",
        placement: "inline",
        range: {
          from: { paragraph: 0, offset: 2 },
          to: { paragraph: 0, offset: 4 },
        },
        props: {},
        render: renderer,
        selection: "atom",
      },
    ],
    props: {
      handleInteraction({ interaction }) {
        interactions.push(interaction);
        return true;
      },
    },
  };
};

const dispatchActivation = (
  element: Element,
  options: MouseEventInit = {},
): void => {
  element.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: 1,
      clientY: 1,
      detail: 1,
      ...options,
    }),
  );
  document.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: 1,
      clientY: 1,
      detail: 1,
      ...options,
    }),
  );
};

describe("editor interactions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    restorePointLookup();
  });

  it("routes rendered decoration activation to plugin props", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const interactions: EditorInteraction[] = [];
    const editor = new ScribeFrame(container, {
      content: "hello",
      plugins: [interactionPlugin(interactions)],
    });
    stubPointLookup(() => container.querySelector(".interactive"));

    const decorated = container.querySelector(".interactive");
    expect(decorated).not.toBeNull();
    dispatchActivation(decorated!);

    expect(interactions).toHaveLength(1);
    expect(interactions[0]?.type).toBe("activate");
    expect(interactions[0]?.decorations[0]?.decoration).toMatchObject({
      kind: "inline",
      from: 0,
      to: 5,
      attrs: {
        class: "interactive",
        "data-kind": "demo",
      },
    });
    expect(interactions[0]?.targets.map((target) => target.kind)).toEqual([
      "decoration",
    ]);

    editor.destroy();
    container.remove();
  });

  it("does not activate decorations when shift-click extends selection", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const interactions: EditorInteraction[] = [];
    const editor = new ScribeFrame(container, {
      content: "hello",
      plugins: [interactionPlugin(interactions)],
    });
    stubPointLookup(() => container.querySelector(".interactive"));

    const decorated = container.querySelector(".interactive");
    expect(decorated).not.toBeNull();
    dispatchActivation(decorated!, { shiftKey: true });

    expect(interactions).toEqual([]);

    editor.destroy();
    container.remove();
  });

  it("does not activate a target that was only under the release point", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const interactions: EditorInteraction[] = [];
    const editor = new ScribeFrame(container, {
      content: "hello",
      plugins: [interactionPlugin(interactions)],
    });
    let pointTarget: Element | null = null;
    stubPointLookup(() => pointTarget);

    container.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 1,
        clientY: 1,
        detail: 1,
      }),
    );
    pointTarget = container.querySelector(".interactive");
    document.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 2,
        clientY: 1,
        detail: 1,
      }),
    );

    expect(interactions).toEqual([]);

    editor.destroy();
    container.remove();
  });

  it("does not activate a decoration after a drag creates a selection", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const interactions: EditorInteraction[] = [];
    const editor = new ScribeFrame(container, {
      content: "hello",
      plugins: [interactionPlugin(interactions)],
    });
    stubPointLookup(() => container.querySelector(".interactive"));
    (document as CaretPositionDocument).caretPositionFromPoint = (x) => ({
      offsetNode: textNodeContaining(container, "hello"),
      offset: Math.max(0, Math.min(5, Math.round(x))),
    });

    const decorated = container.querySelector(".interactive");
    expect(decorated).not.toBeNull();
    decorated?.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 1,
        clientY: 1,
        detail: 1,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        buttons: 1,
        clientX: 3,
        clientY: 1,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 3,
        clientY: 1,
        detail: 1,
      }),
    );

    expect(editor.getSelection()).toEqual({
      anchor: { paragraph: 0, offset: 1 },
      head: { paragraph: 0, offset: 3 },
    });
    expect(interactions).toEqual([]);

    editor.destroy();
    container.remove();
  });

  it("routes rendered inline widget activation to plugin props", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const interactions: EditorInteraction[] = [];
    const editor = new ScribeFrame(container, {
      content: "a 🟩 mark",
      plugins: [inlineWidgetInteractionPlugin(interactions)],
    });
    stubPointLookup(() => container.querySelector(".s9-widget-inline"));

    const widget = container.querySelector(".s9-widget-inline");
    expect(widget).not.toBeNull();
    dispatchActivation(widget!);

    expect(interactions).toHaveLength(1);
    expect(interactions[0]?.widgets[0]?.key).toBe("inline-widget-interaction:marker");
    expect(interactions[0]?.targets.map((target) => target.kind)).toEqual([
      "widget",
    ]);

    editor.destroy();
    container.remove();
  });
});
