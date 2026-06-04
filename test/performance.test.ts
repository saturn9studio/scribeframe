import { describe, expect, it, vi } from "vitest";

const modelSpies = vi.hoisted(() => ({
  documentToText: vi.fn(
    (doc: { readonly paragraphs: readonly { readonly text: string }[] }) =>
      doc.paragraphs.map((paragraph) => paragraph.text).join("\n"),
  ),
}));

vi.mock("../src/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/model")>();
  return {
    ...actual,
    documentToText: modelSpies.documentToText,
  };
});

import {
  ModernEditor,
  PluginId,
  createTransaction,
  type EditorPlugin,
  type WidgetDecoration,
  type WidgetRenderer,
} from "../src";

interface Counts {
  mounts: number;
  updates: number;
  destroys: number;
}

const lines = (count: number): string =>
  Array.from({ length: count }, (_value, index) => `line ${index}`).join("\n");

const setViewport = (element: HTMLElement, clientHeight: number): void => {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  element.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 400,
      bottom: clientHeight,
      width: 400,
      height: clientHeight,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
};

const renderedParagraphCount = (container: HTMLElement): number =>
  container.querySelectorAll(".s9-paragraph").length;

const denseWidgetPlugin = (
  counts: Counts,
  paragraphCount: number,
): EditorPlugin<null> => {
  const renderer: WidgetRenderer<{ readonly index: number }> = {
    mount(host, props) {
      counts.mounts += 1;
      host.textContent = `widget ${props.index}`;
      return {
        update(nextProps) {
          counts.updates += 1;
          host.textContent = `widget ${nextProps.index}`;
        },
        destroy() {
          counts.destroys += 1;
          host.textContent = "";
        },
      };
    },
  };

  return {
    id: new PluginId<null>("dense-widget-performance"),
    init: () => null,
    apply: () => null,
    widgets: ({ doc }): readonly WidgetDecoration[] =>
      Array.from({ length: Math.min(paragraphCount, doc.paragraphs.length) }, (
        _value,
        index,
      ) => ({
        key: `dense-widget-performance:${index}`,
        placement: "block",
        range: {
          from: { paragraph: index, offset: 0 },
          to: {
            paragraph: index,
            offset: doc.paragraphs[index]?.text.length ?? 0,
          },
        },
        props: { index },
        render: renderer,
        selection: "block",
      })),
  };
};

describe("editor performance posture", () => {
  it("does not reserialize large documents for selection, text edit, or undo paths", () => {
    const content = lines(5_000);
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new ModernEditor(container, { content });
    modelSpies.documentToText.mockClear();

    editor.selectRange({
      from: { paragraph: 100, offset: 0 },
      to: { paragraph: 100, offset: 0 },
    });
    expect(editor.getContent()).toBe(content);

    editor.dispatch(
      createTransaction(editor.getDocument(), editor.getSelection())
        .replaceSelection("prefix ")
        .build(),
    );
    expect(editor.getContent()).toContain("line 99\nprefix line 100");
    expect(modelSpies.documentToText).not.toHaveBeenCalled();

    modelSpies.documentToText.mockClear();
    editor.undo();
    expect(editor.getContent()).toBe(content);
    expect(modelSpies.documentToText).not.toHaveBeenCalled();

    editor.destroy();
    container.remove();
  });

  it("keeps virtualized large documents and dense widgets bounded to the viewport", () => {
    const container = document.createElement("div");
    setViewport(container, 60);
    document.body.append(container);
    const counts = { mounts: 0, updates: 0, destroys: 0 };

    const editor = new ModernEditor(container, {
      content: lines(10_000),
      plugins: [denseWidgetPlugin(counts, 10_000)],
      virtualization: { estimateParagraphHeight: 20, overscan: 1 },
    });

    expect(renderedParagraphCount(container)).toBeLessThanOrEqual(5);
    expect(counts.mounts).toBeLessThanOrEqual(5);

    editor.scrollToFraction(1);

    expect(renderedParagraphCount(container)).toBeLessThanOrEqual(6);
    expect(counts.mounts).toBeLessThanOrEqual(11);
    expect(counts.destroys).toBeGreaterThan(0);

    editor.destroy();
    container.remove();
  });
});
