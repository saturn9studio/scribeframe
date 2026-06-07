import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EditorPlugin,
  ScribeFrame,
  PluginId,
  type EditorInteraction,
} from "../src";

const originalElementsFromPoint = document.elementsFromPoint;
const originalElementFromPoint = document.elementFromPoint;

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
});
